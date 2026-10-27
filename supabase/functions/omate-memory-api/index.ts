import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json; charset=utf-8"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:cors});
const value = (v, max=200) => typeof v === "string" ? v.trim().slice(0, max) : "";
const uuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

Deno.serve(async (req) => {
  if(req.method === "OPTIONS") return new Response(null, {status:204, headers:cors});
  if(req.method !== "POST") return json({error:"method_not_allowed"},405);
  const authHeader = req.headers.get("authorization") || "";
  if(!/^Bearer\s+\S+$/i.test(authHeader)) return json({error:"login_required"},401);
  const supabaseUrl=Deno.env.get("SUPABASE_URL");
  const anonKey=Deno.env.get("SUPABASE_ANON_KEY");
  if(!supabaseUrl || !anonKey) return json({error:"server_not_configured"},503);
  try {
    const client = createClient(supabaseUrl, anonKey, {
      global: {headers:{Authorization:authHeader}},
      auth: {persistSession:false, autoRefreshToken:false}
    });
    const token=authHeader.replace(/^Bearer\s+/i, "");
    const {data:{user}, error:userError}=await client.auth.getUser(token);
    if(userError || !user) return json({error:"invalid_session"},401);
    let body;
    try {body=await req.json();}catch {return json({error:"invalid_json"},400);}
    const action = value(body?.action,24);
    const conversation = value(body?.conversation_key,180);
    if(!conversation) return json({error:"conversation_required"},400);
    const base = () => client.from("omate_memory").select("id,conversation_key,actor_key,memory_type,content,source,importance,chat_ref,occurred_at,created_at,updated_at").eq("owner_id",user.id).eq("conversation_key",conversation);

    if(action==="delete_private_chat") {
      const target=value(body?.target_id,180).trim();
      if(!target||!(/^(?:omate:char|npc:[^\\n\\r]+|person:char:[^\\n\\r]+)$/.test(target)))
        return json({error:"invalid_private_target"},400);
      if(body?.confirm_target!==target)return json({error:"confirmation_required"},400);
      const tag="私聊 "+target;
      // Only delete indexed chat-specific events. Do not touch other characters'
      // memories, group posts, or generic long-term facts without an ownership tag.
      // Separate exact filters rather than a dynamic OR expression; contact names
      // are user supplied and must never become query syntax.
      const {data:byRef,error:refError}=await client.from("omate_memory").delete()
        .eq("owner_id",user.id).eq("conversation_key",conversation).eq("chat_ref",target).select("id");
      if(refError)throw refError;
      let oldRows=[];
      if(tag.length<=32){
        const {data,error}=await client.from("omate_memory").delete()
          .eq("owner_id",user.id).eq("conversation_key",conversation).eq("source",tag).select("id");
        if(error)throw error;oldRows=data||[];
      }
      return json({ok:true,deleted:(byRef||[]).length+oldRows.length,
        scope:"only_private_chat_events",note:"Unattributed MCP facts and mixed-source context are not deleted."});
    }
    if(action==="read_phone_summary"){
      const {data,error}=await base().eq("memory_type","phone_digest").like("event_key","manual:%").order("updated_at",{ascending:false}).limit(16);
      if(error)throw error;
      return json({ok:true,available:!!data?.length,summary_length:(data||[]).reduce((n,r)=>n+r.content.length,0),count:data?.length||0,updated_at:data?.[0]?.updated_at||null});
    }
    if(action==="upsert_phone_summary"){
      const content=value(body?.content,11500);
      if(!content)return json({error:"content_required"},400);
      const eventKey="phone:current";
      const row={owner_id:user.id,conversation_key:conversation,event_key:eventKey,actor_key:"phone",memory_type:"phone_summary",source:"livepage_phone",content,importance:4,chat_ref:null,updated_at:new Date().toISOString()};
      const {error}=await client.from("omate_memory").upsert(row,{onConflict:"owner_id,conversation_key,event_key"});
      if(error)throw error;
      return json({ok:true,summary_saved:true});
    }
    if(action==="read_current_phone_summary"){
      const {data,error}=await base().eq("memory_type","phone_summary").order("updated_at",{ascending:false}).limit(1);
      if(error)throw error;
      return json({ok:true,available:!!data?.length,content:data?.[0]?.content||"",updated_at:data?.[0]?.updated_at||null});
    }
    if(action==="save_batch"){
      const events=Array.isArray(body?.events)?body.events:[];
      if(events.length>12)return json({error:"batch_too_large"},400);
      if(!events.length)return json({ok:true,inserted:0,duplicates:0,processed_keys:[]});
      const processed=[];
      const rows=[];
      for(const e of events){
        const eventKey=value(e?.event_key,150),content=value(e?.content,2200);
        if(!/^v5:[a-z0-9]+$/i.test(eventKey)||!content)return json({error:"invalid_event"},400);
        const ref=value(e?.chat_ref,180)||null;
        if(ref&&!/^(?:omate:char|npc:[^\n\r]+|person:char:[^\n\r]+)$/.test(ref))return json({error:"invalid_chat_ref"},400);
        processed.push(eventKey);
        rows.push({owner_id:user.id,conversation_key:conversation,event_key:eventKey,actor_key:value(e?.actor_key,80)||"unknown",memory_type:value(e?.memory_type,32)==="private"?"private":"event",source:value(e?.source,32)||"livepage",content,importance:3,chat_ref:ref});
      }
      const {data,error}=await client.from("omate_memory").upsert(rows,{onConflict:"owner_id,conversation_key,event_key",ignoreDuplicates:true}).select("event_key");
      if(error)throw error;
      return json({ok:true,inserted:(data||[]).length,duplicates:rows.length-(data||[]).length,processed_keys:processed});
    }
    if(action==="check_event_keys"){
      const keys=Array.isArray(body?.event_keys)?body.event_keys:[];
      if(keys.length>200||keys.some(k=>typeof k!=="string"||k.length>150||!/^[a-zA-Z0-9:_|.-]+$/.test(k)))return json({error:"invalid_event_keys"},400);
      if(!keys.length)return json({ok:true,existing_keys:[],missing_keys:[]});
      const unique=[...new Set(keys)];
      const {data,error}=await base().select("event_key").in("event_key",unique);
      if(error)throw error;
      const found=new Set((data||[]).map(x=>x.event_key));
      return json({ok:true,existing_keys:unique.filter(k=>found.has(k)),missing_keys:unique.filter(k=>!found.has(k))});
    }
    if(action==="save_manual_digest"){
      if(typeof body.content!=="string"||body.content.length>11500)return json({error:"digest_too_large_or_invalid",max:11500},400);
      const key=value(body.digest_key,120),content=body.content.trim();
      if(typeof body.digest_key!=="string"||body.digest_key.length>120||!key||!/^[a-zA-Z0-9:_|.-]+$/.test(key)||!content)return json({error:"invalid_digest"},400);
      const eventKey="manual:"+key;
      const row={owner_id:user.id,conversation_key:conversation,event_key:eventKey,
        actor_key:value(body.actor_key,80)||"user",memory_type:"phone_digest",
        source:value(body.source,32)||"livepage_manual",content,chat_ref:value(body.chat_ref,180)||null,importance:5,updated_at:new Date().toISOString()};
      // INSERT with ON CONFLICT DO NOTHING prevents a concurrent retry overwriting an edit.
      const {data,error}=await client.from("omate_memory").upsert(row,{
        onConflict:"owner_id,conversation_key,event_key",ignoreDuplicates:body.replace!==true
      }).select("id,content,updated_at").maybeSingle();
      if(error)throw error;
      const {data:stored,error:readError}=await client.from("omate_memory").select("id,content,chat_ref,updated_at").eq("owner_id",user.id).eq("conversation_key",conversation).eq("event_key",eventKey).maybeSingle();
      if(readError)throw readError;
      if(!stored)return json({error:"digest_readback_failed"},500);
      return json({ok:true,saved:!!data,duplicate:!data,event_key:eventKey,id:stored.id,chat_ref:stored.chat_ref||null,updated_at:stored.updated_at,
        verified:stored.content===content,conflict:stored.content!==content});
    }
    if(action==="save") {
      const content=value(body?.content,12000);
      if(!content) return json({error:"content_required"},400);
      const actor=value(body?.actor_key,80) || "unknown";
      const type=value(body?.memory_type,32) || "fact";
      const source=value(body?.source,32) || "livepage";
      const chatRef=value(body?.chat_ref,180)||null;
      if(chatRef && !/^(?:omate:char|npc:[^\n\r]+|person:char:[^\n\r]+)$/.test(chatRef))return json({error:"invalid_chat_ref"},400);
      const importance=Number.isInteger(body?.importance) ? Math.max(1,Math.min(5,body.importance)) : 3;
      const {data,error}=await client.from("omate_memory").insert({owner_id:user.id,conversation_key:conversation,actor_key:actor,memory_type:type,source,content,importance,chat_ref:chatRef}).select("id,created_at").single();
      if(error) throw error;
      return json({ok:true,memory:data});
    }
    if(action==="search" || action==="recent") {
      const term=value(body?.query,100).replace(/[,%_()"'\\]/g,"");
      const limit=Math.max(1,Math.min(20, Number(body?.limit)||8));
      const target=value(body?.chat_ref,180);
      if(target && !/^(?:omate:char|npc:[^\n\r]+|person:char:[^\n\r]+)$/.test(target))return json({error:"invalid_chat_ref"},400);
      let q=base().order("created_at",{ascending:false}).limit(limit);
      // 联系人查询严格匹配 chat_ref；未标记的旧数据只供全局管理查看，不混入联系人记忆。
      if(target)q=q.eq("chat_ref",target);
      else q=q.is("chat_ref",null);
      if(action==="search" && term) q=q.ilike("content", "%"+term+"%");
      const {data,error}=await q;
      if(error) throw error;
      return json({ok:true,memories:data || []});
    }
    if(action==="update") {
      if(!uuid(body?.id)) return json({error:"valid_id_required"},400);
      const content=value(body?.content,12000);
      if(!content) return json({error:"content_required"},400);
      const {data,error}=await client.from("omate_memory").update({content,updated_at:new Date().toISOString()})
        .eq("owner_id",user.id).eq("conversation_key",conversation).eq("id",body.id)
        .select("id,updated_at").maybeSingle();
      if(error) throw error;
      return json({ok:!!data,memory:data});
    }
    return json({error:"unknown_action"},400);
  } catch(e) {
    console.error("omate-memory-api operation failed", e instanceof Error ? e.name : "unknown");
    return json({error:"database_request_failed"},500);
  }
});

