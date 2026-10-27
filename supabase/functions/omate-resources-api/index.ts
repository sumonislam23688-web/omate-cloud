import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_ANON_KEY')||'',S=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const admin=createClient(U,S,{auth:{persistSession:false,autoRefreshToken:false}});
const pub=createClient(U,K,{auth:{persistSession:false,autoRefreshToken:false}});
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store'};
const json=(a,status=200)=>new Response(JSON.stringify(a),{status,headers:CORS});
const sv=(a,n=120)=>String(a??'').trim().slice(0,n);
const iv=(v,a,b,f)=>Number.isFinite(Number(v))?Math.max(a,Math.min(b,Math.floor(Number(v)))):f;
const keys=a=>Array.isArray(a)?a.map(x=>sv(x,100)).filter(Boolean).slice(0,80):sv(a,1000).split(/[,，、;\n]/).map(s=>s.trim()).filter(Boolean).slice(0,80);
const ai=()=>new Supabase.ai.Session('gte-small');
const embed=async s=>{
 const out=await ai().run(sv(s,1500),{mean_pool:true,normalize:true});
 if(!Array.isArray(out)||out.length!==384||out.some(x=>!Number.isFinite(x)))throw Error('invalid_embeddings');
 return out;
};
const eq=(entry,text)=>entry.some(s=>text.toLocaleLowerCase().includes(s.toLocaleLowerCase()));
const worldMatch=(r,txt)=>{
 if(r.is_constant)return true;
 const a=r.keywords||[], b=r.secondary_keywords||[];
 const hasA=eq(a,txt),hasB=eq(b,txt),logic=r.trigger_logic;
 if(!a.length)return false;
 if(logic==='andAll')return hasA&&b.length>0&&b.every(k=>txt.toLocaleLowerCase().includes(k.toLocaleLowerCase()));
 if(logic==='notAny')return hasA&&!hasB;
 if(logic==='notAll')return hasA&&!(b.length>0&&b.every(k=>txt.toLocaleLowerCase().includes(k.toLocaleLowerCase())));
 return hasA&&(!b.length||hasB);
};
const token=req=>(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
const uu=id=>typeof id==='string'&&/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);
const fields='id,resource_type,title,content,source_file,keywords,secondary_keywords,is_constant,enabled,position,depth,order_weight,trigger_logic,probability,metadata,created_at,updated_at';
async function resolve(owner,space,query){
 const scan=sv(query,2200),txt=scan.toLocaleLowerCase();
 const {data:base,error}=await admin.from('omate_resources').select(fields).eq('owner_id',owner).eq('conversation_key',space).eq('enabled',true)
  .in('resource_type',['long_term','prompt','worldbook']).order('order_weight',{ascending:false}).limit(400);
 if(error)throw error;
 const fixed=[],world=[];
 for(const x of base||[]){
  if(x.resource_type==='long_term'||x.resource_type==='prompt')fixed.push(x);
  else if(worldMatch(x,txt) && Math.random()*100 < (x.probability??100))world.push(x);
 }
 // Sorted by priority, a finite context budget; keep raw depth/position metadata so client can place it.
 const byWeight=(a,b)=>(b.order_weight||0)-(a.order_weight||0);
 fixed.sort(byWeight);world.sort(byWeight);
 const used=[],budget=8000;
 let count=0;
 for(const x of [...fixed,...world]){
  if(used.length>=25||count+x.content.length>budget)continue;
  used.push(x);count+=x.content.length;
 }
 let knowledge=[],vector_state='no_knowledge';
 if(scan){
  try{
   const vector=await embed(scan);
   const {data:matches,error:ve}=await admin.rpc('omate_match_resources',{p_owner:owner,p_space:space,p_query_embedding:vector,p_limit:6});
   if(ve)throw ve;
   knowledge=matches||[];vector_state='semantic';
  }catch(e){
   vector_state='unavailable';
   console.error('resource semantic lookup unavailable',e instanceof Error?e.message:String(e));
  }
 }

 // keyword_fallback_v84: MCP-synced knowledge may have no vector yet; do not silently ignore it.
 if(scan&&knowledge.length<6){
  const {data:docs,error:de}=await admin.from("omate_resources").select("id,title,content,resource_type,keywords")
   .eq("owner_id",owner).eq("conversation_key",space).eq("resource_type","knowledge").eq("enabled",true).limit(150);
  if(!de){
   const current=new Set(knowledge.map(x=>x.id)),terms=txt.split(/[\s,，。！？:：;；]+/).filter(x=>x.length>=2).slice(0,20);
   for(const d of docs||[]){
    if(current.has(d.id))continue;
    const matches=Array.isArray(d.keywords)&&d.keywords.some(x=>x&&txt.includes(x.toLocaleLowerCase()))||
      terms.some(w=>(d.title||"").toLocaleLowerCase().includes(w))||
     Array.from({length:Math.max(0,txt.length-2)},(_,i)=>txt.slice(i,i+3))
      .filter(w=>/[\u3400-\u9fff]{2,}/.test(w)).slice(0,35)
      .some(w=>(d.content||"").toLocaleLowerCase().includes(w));
    if(matches){knowledge.push(d);current.add(d.id);if(knowledge.length>=6)break}
   }
   if(vector_state==="unavailable")vector_state="keyword_fallback";
  }
 }
 return {ok:true,memory_space:space,always:used.filter(x=>x.resource_type!=='worldbook'),worldbook:used.filter(x=>x.resource_type==='worldbook'),knowledge:knowledge.slice(0,6),vector_state,counts:{fixed:fixed.length,triggered_worldbook:world.length,injected:used.length,knowledge:knowledge.length}};
}
Deno.serve(async(req)=>{
 try{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  let body;try{body=await req.json()}catch{return json({error:'invalid_json'},400)}
  const action=sv(body?.action,40),space=sv(body?.conversation_key,181);
  if(!space||space.length>180)return json({error:'invalid_memory_space'},400);
  const bearer=token(req);
  let owner='';
  if(action==='resolve_service'&&S&&bearer===S){
   owner=sv(body.owner_id,50);
   if(!uu(owner))return json({error:'invalid_owner'},400);
   return json(await resolve(owner,space,body.query||''));
  }
  if(!bearer)return json({error:'login_required'},401);
  const {data:{user},error:authError}=await pub.auth.getUser(bearer);
  if(authError||!user)return json({error:'invalid_session'},401);
  owner=user.id;
  
 if(action==='active_turn')return json({ok:true,available:false,complete:false,entries:[],retired:true,reason:'四大资料由资料库手动管理，请调用resolve。'});
 if(action==='backup_status')return json({ok:true,retired:true,has_applied_backup:false,counts:{},total:0});
if(action==='resolve')return json(await resolve(owner,space,body.query||''));
  if(action==='list_page'){
    const type=sv(body.resource_type,40),offset=iv(body.offset,0,1000000,0),size=iv(body.limit,1,150,100);
    let q=admin.from('omate_resources').select(fields,{count:'exact'})
      .eq('owner_id',owner).eq('conversation_key',space)
      .order('created_at',{ascending:true}).order('id',{ascending:true})
      .range(offset,offset+size-1);
    if(type)q=q.eq('resource_type',type);
    const {data,error,count}=await q;if(error)throw error;
    return json({ok:true,count,offset,limit:size,resources:data||[],has_more:offset+(data||[]).length<(count||0)});
  }
  if(action==='count'||action==='list'){
   const type=sv(body.resource_type,40);
   let q=admin.from('omate_resources').select(fields,{count:'exact'}).eq('owner_id',owner).eq('conversation_key',space).order('created_at',{ascending:false}).limit(150);
   if(type)q=q.eq('resource_type',type);
   const {data,error,count}=await q;if(error)throw error;
   return json({ok:true,count,resources:action==='list'?data||[]:[]});
  }
  if(action==='delete'){
   if(!uu(body.id))return json({error:'invalid_id'},400);
   const {data,error}=await admin.from('omate_resources').delete().eq('owner_id',owner).eq('conversation_key',space).eq('id',body.id).select('id').maybeSingle();
   if(error)throw error;
   return json({ok:true,deleted:!!data});
  }
  if(action==='update'){
    if(!uu(body.id))return json({error:'invalid_id'},400);
    if(typeof body.content!=='string'||body.content.length>20000)return json({error:'content_too_large_or_invalid',max:20000},400);
    const type=sv(body.resource_type,24),content=sv(body.content,20000);
    if(!['long_term','prompt','worldbook','knowledge'].includes(type))return json({error:'invalid_type'},400);
    if(!content)return json({error:'content_required'},400);
    const patch={
      resource_type:type,title:sv(body.title,160),content,
      keywords:keys(body.keywords),secondary_keywords:keys(body.secondary_keywords),
      is_constant:!!body.is_constant,enabled:body.enabled!==false,
      position:sv(body.position,30)||'after_char',depth:iv(body.depth,0,200,0),
      order_weight:iv(body.order_weight,-100000,100000,100),
      trigger_logic:['andAny','andAll','notAny','notAll'].includes(body.trigger_logic)?body.trigger_logic:'andAny',
      probability:iv(body.probability,0,100,100),
      metadata:typeof body.metadata==='object'&&body.metadata&&!Array.isArray(body.metadata)?body.metadata:{},
      updated_at:new Date().toISOString()
    };
    let vector_state='not_required';
    if(type==='knowledge'){
      try{patch.embedding=await embed(content);vector_state='ready'}
      catch(e){patch.embedding=null;vector_state='keyword_fallback'}
    }
    const {data:result,error}=await admin.from('omate_resources').update(patch)
      .eq('owner_id',owner).eq('conversation_key',space).eq('id',body.id)
      .select('id,updated_at').maybeSingle();
    if(error)throw error;
    if(!result)return json({error:'not_found'},404);
    return json({ok:true,resource:result,vector_state});
  }
  if(action==='save'){
   if(typeof body.content!=='string'||body.content.length>20000)return json({error:'content_too_large_or_invalid',max:20000},400);
    const type=sv(body.resource_type,24),content=sv(body.content,20000);
   if(!['long_term','prompt','worldbook','knowledge'].includes(type))return json({error:'invalid_type'},400);
   if(!content)return json({error:'content_required'},400);
   const data={
    owner_id:owner,conversation_key:space,resource_type:type,
    title:sv(body.title,160),content,source_file:sv(body.source_file,160),
    keywords:keys(body.keywords),secondary_keywords:keys(body.secondary_keywords),
    is_constant:!!body.is_constant,enabled:body.enabled!==false,
    position:sv(body.position,30)||'after_char',
    depth:iv(body.depth,0,200,0),order_weight:iv(body.order_weight,-100000,100000,100),
    trigger_logic:['andAny','andAll','notAny','notAll'].includes(body.trigger_logic)?body.trigger_logic:'andAny',
    probability:iv(body.probability,0,100,100),
    metadata:typeof body.metadata==='object'&&body.metadata&&!Array.isArray(body.metadata)?body.metadata:{}
   };
   let vector_state='not_required';
   if(type==='knowledge'){
    try{data.embedding=await embed(content);vector_state='ready'}
    catch(e){vector_state='failed';console.error('embedding generation unavailable',e instanceof Error?e.message:String(e));}
   }
   const {data:result,error}=await admin.from('omate_resources').insert(data).select('id,created_at').single();
   if(error)throw error;
   return json({ok:true,resource:result,vector_state});
  }
  return json({error:'unsupported_action'},400);
 }catch(e){
  console.error('resources API error',e instanceof Error?e.message:String(e));
  return json({error:'resource_request_failed'},500);
 }
});
