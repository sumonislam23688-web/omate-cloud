export function normalizeMessages(rows) {
 if(!Array.isArray(rows)||rows.length<1||rows.length>20)throw Error('expected_1_to_20_messages');
 return rows.map(x=>{
  if(!x||!['user','assistant'].includes(x.role)||typeof x.content!=='string'||!x.content.trim()||x.content.length>32000)throw Error('invalid_or_oversize_message');
  if(/<LivePage\b|<script\b|<style\b/i.test(x.content))throw Error('body_text_only');
  const row={role:x.role,content:x.content.trim()};
  if(x.id!==undefined){if(typeof x.id!=='string'||!x.id||x.id.length>180)throw Error('invalid_message_id');row.id=x.id;}
  return row;
 });
}
export function mergeMessages(prev,latest){
 const same=(a,b)=>a.id&&b.id?a.id===b.id&&a.role===b.role&&a.content===b.content:a.role===b.role&&a.content===b.content;
 let overlap=0;
 for(let k=Math.min(prev.length,latest.length);k>0;k--){if(prev.slice(-k).every((m,i)=>same(m,latest[i]))){overlap=k;break;}}
 if(!overlap)for(let i=0;i<=prev.length-latest.length;i++)if(latest.every((m,j)=>same(m,prev[i+j])))return {messages:prev.slice(-20),added:0,dropped:0,overlap:latest.length,stale_snapshot:true};
 const joined=prev.concat(latest.slice(overlap));
 return {messages:joined.slice(-20),added:latest.length-overlap,dropped:Math.max(0,joined.length-20),overlap};
}
export async function syncWindow(db,owner,space,rows){
 const latest=normalizeMessages(rows);
 for(let attempt=0;attempt<5;attempt++){
  const {data:old,error}=await db.from('omate_context_window').select('messages,updated_at').eq('owner_id',owner).eq('conversation_key',space).maybeSingle();
  if(error)throw error;
  const prev=Array.isArray(old?.messages)?old.messages.slice(-20):[];
  const result=mergeMessages(prev,latest);
  if(!result.added)return {ok:true,...result,limit:20,count:result.messages.length,updated_at:old?.updated_at||null};
  const updated_at=new Date(Math.max(Date.now(),Date.parse(old?.updated_at||'')+1||0)).toISOString();
  const row={owner_id:owner,conversation_key:space,messages:result.messages,updated_at};
  if(old){
   const {data,error:we}=await db.from('omate_context_window').update(row).eq('owner_id',owner).eq('conversation_key',space).eq('updated_at',old.updated_at).select('updated_at').maybeSingle();
   if(we)throw we;if(!data)continue;
  }else{
   const {error:we}=await db.from('omate_context_window').insert(row);
   if(we?.code==='23505')continue;if(we)throw we;
  }
  return {ok:true,...result,limit:20,count:result.messages.length,updated_at,note:'仅包含已上传正文；未调用工具的轮次不会自动补齐。'};
 }
 throw Error('context_conflict_retry');
}
