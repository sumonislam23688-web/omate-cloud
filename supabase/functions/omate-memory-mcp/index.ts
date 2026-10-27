import {syncWindow} from "./context.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const U=Deno.env.get("SUPABASE_URL")||"";
const K=Deno.env.get("SUPABASE_ANON_KEY")||"";
const S=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const admin = U&&S ? createClient(U,S,{auth:{persistSession:false,autoRefreshToken:false}}) : null;
const publicClient=U&&K ? createClient(U,K,{auth:{persistSession:false,autoRefreshToken:false}}) : null;
const headers={
 "Content-Type":"application/json; charset=utf-8",
 "Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Methods":"POST,OPTIONS",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type,accept,mcp-protocol-version,mcp-session-id",
 "Cache-Control":"no-store"
};
const reply=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{...headers,...extra}});
const str=(v,n=120)=>typeof v==="string"?v.trim().slice(0,n):"";
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const secret=()=> "omcp_"+Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
const authValue=r=>(r.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
const validSpace=s=>s.length>0&&s.length<=180;
const output=(id,value)=>({jsonrpc:"2.0",id,result:value});
const err=(id,code,message)=>({jsonrpc:"2.0",id,error:{code,message}});
const tools=[
{name:"push_main_chat_messages",description:"将 OMate 本轮确实可见的最近最多20条正文消息写入云端20条滚动缓存。仅在主聊天 Agent 实际调用后才更新，不保证平台每轮自动执行。",inputSchema:{type:"object",properties:{messages:{type:"array",minItems:1,maxItems:20,items:{type:"object",properties:{id:{type:"string"},role:{type:"string",enum:["user","assistant"]},content:{type:"string"}},required:["role","content"]}}},required:["messages"],additionalProperties:false}},
{name:"get_phone_snapshot",description:"获取 LivePage 微信、朋友圈、微博、会话列表与重要状态的最新整体摘要，用于 OMate 角色正文聊天回复。返回的是已确认上传的手机内容而非未经证实的消息；可与 recent_memory/search_memory 互补，不等于无限完整历史。",inputSchema:{type:"object",properties:{},additionalProperties:false}},
{name:"get_livepage_digest",description:"读取已上传的整机最新摘要与近期微信、朋友圈、微博事件。主聊天回答与手机有关的问题时优先使用，以当前故事空间内确实保存的数据为准。",inputSchema:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:16}},additionalProperties:false}},
 {name:"search_memory",description:"查找用户手动确认上传的手机摘要。回答涉及过去事实、人物、地点、承诺时先使用此工具。只查询当前用户已配对的记忆空间，不自动读取 OMate 世界书或知识库。",inputSchema:{type:"object",properties:{query:{type:"string",description:"简短的主题、姓名或关键词（建议2到8个字）"},limit:{type:"integer",minimum:1,maximum:12}},required:["query"],additionalProperties:false}},
 {name:"memory_status",description:"检查云端共享记忆是否连接、显示当前剧情空间的记忆总数和最近更新时间。不返回密钥，不修改记忆。",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"recent_memory",description:"读取当前剧情空间最近确认上传的手机摘要，适合了解最新剧情。",inputSchema:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:20}},additionalProperties:false}},
];
function textResult(value,isError=false){return {content:[{type:"text",text:JSON.stringify(value)}],isError};}
async function authorize(req){
 const token=authValue(req);
 if(!/^omcp_[0-9a-f]{64}$/.test(token))return null;
 const hash=await sha(token);
 const {data,error}=await admin.from("omate_mcp_access").select("owner_id,conversation_key,expires_at,revoked_at").eq("token_hash",hash).maybeSingle();
 if(error||!data||data.revoked_at||Date.parse(data.expires_at)<=Date.now())return null;
 return data;
}
async function pair(req){
 const userToken=authValue(req);
 if(!publicClient||!admin)return reply({error:"server_unavailable"},503);
 if(!userToken)return reply({error:"login_required"},401);
 const {data:{user},error:authError}=await publicClient.auth.getUser(userToken);
 if(authError||!user)return reply({error:"invalid_user_session"},401);
 let body={};try{body=await req.json()}catch{return reply({error:"invalid_json"},400)}
 const space=str(body?.conversation_key,181);
 if(!validSpace(space))return reply({error:"invalid_memory_space"},400);
 if(body.action==="status"){
   const {data,error}=await admin.from("omate_mcp_access").select("expires_at,created_at")
     .eq("owner_id",user.id).eq("conversation_key",space).is("revoked_at",null).gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(1);
   if(error)throw error;
   return reply({ok:true,paired:!!data?.length,expires_at:data?.[0]?.expires_at||null});
 }
 if(body.action==="revoke"){
   const {error}=await admin.from("omate_mcp_access").update({revoked_at:new Date().toISOString()})
     .eq("owner_id",user.id).eq("conversation_key",space).is("revoked_at",null);
   if(error)throw error;
   return reply({ok:true,revoked:true});
 }
 if(body.action!=="pair")return reply({error:"unsupported_action"},400);
 const token=secret(), token_hash=await sha(token);
 const now=new Date().toISOString();
 const {error:e1}=await admin.from("omate_mcp_access").update({revoked_at:now})
   .eq("owner_id",user.id).eq("conversation_key",space).is("revoked_at",null);
 if(e1)throw e1;
 const expires_at=new Date(Date.now()+90*24*3600*1000).toISOString();
 const {error:e2}=await admin.from("omate_mcp_access").insert({owner_id:user.id,conversation_key:space,token_hash,expires_at});
 if(e2)throw e2;
 return reply({ok:true,token,conversation_key:space,expires_at,header_name:"Authorization",header_value:"Bearer "+token});
}

async function toolCall(name,args,account){
 const owner=account.owner_id,space=account.conversation_key;
 

if(name==="push_main_chat_messages")return await syncWindow(admin,owner,space,args.messages);
if(name==="get_livepage_digest"||name==="get_phone_snapshot"){
 const limit=Math.max(1,Math.min(16,Number(args.limit)||10));
 const {data,error}=await admin.from("omate_memory").select("id,content,source,created_at,updated_at,occurred_at")
  .eq("owner_id",owner).eq("conversation_key",space).eq("memory_type","phone_digest").like("event_key","manual:%")
  .order("updated_at",{ascending:false}).order("id",{ascending:false}).limit(limit);
 if(error)throw error;
 const events=(data||[]).map(r=>({id:r.id,time:r.occurred_at||r.created_at,updated_at:r.updated_at,source:r.source,summary:r.content}));
 return {ok:true,memory_space:space,available:events.length>0,events,
  summary:events.map(r=>r.summary).join("\n\n"),phone_summary:events.map(r=>r.summary).join("\n\n"),
  updated_at:data?.[0]?.updated_at||null,summary_updated_at:data?.[0]?.updated_at||null,
  note:"仅返回用户在小手机确认上传的摘要；不包含四大资料、未上传内容或旧自动整机快照。"};
}
if(name==="memory_status"){
   const {data,error,count}=await admin.from("omate_memory").select("created_at",{count:"exact"})
     .eq("owner_id",owner).eq("conversation_key",space).order("created_at",{ascending:false}).limit(1);
   if(error)throw error;
   return {ok:true,connected:true,memory_space:space,memory_count:count??0,latest_memory_at:data?.[0]?.created_at||null};
 }
 const base=()=>admin.from("omate_memory").select("id,content,actor_key,memory_type,source,importance,created_at,occurred_at").eq("owner_id",owner).eq("conversation_key",space).eq("memory_type","phone_digest").like("event_key","manual:%");
 const limit=Math.max(1,Math.min(20,Number(args.limit)||8));
 if(name==="recent_memory"){
   const {data,error}=await base().order("created_at",{ascending:false}).limit(limit);
   if(error)throw error;
   return {memory_space:space,memories:data||[],count:data?.length||0};
 }
 if(name==="search_memory"){
   const query=str(args.query,100);
   if(!query)return {error:"query_required"};
   const key=query.replace(/[%_,()"'\\]/g," ").trim().slice(0,36);
   let hits=[];
   if(key){
     const {data,error}=await base().ilike("content","%"+key+"%").order("created_at",{ascending:false}).limit(limit);
     if(error)throw error;
     hits=data||[];
   }
   if(hits.length)return {memory_space:space,match_type:"keyword",memories:hits,count:hits.length};
   const {data,error}=await base().order("created_at",{ascending:false}).limit(Math.min(limit,5));
   if(error)throw error;
   return {memory_space:space,match_type:"no_keyword_match_recent_fallback",warning:"没有搜索到确切关键词，下面只是最近记录，不能当成相关事实",memories:data||[],count:data?.length||0};
 }
 return {error:"unknown_tool"};
}
Deno.serve(async(req)=>{
 try{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
  const path=new URL(req.url).pathname;
  const origin=req.headers.get("Origin");
  if(origin&&origin!=="null"&&!/^https?:\/\/(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|[^/]+\.omate\.org)$/.test(origin)){
    return reply({error:"origin_not_allowed"},403);
  }
  if(req.method!=="POST")return reply({error:"method_not_allowed"},405,{Allow:"POST, OPTIONS"});
  if(path.endsWith("/pair"))return await pair(req);
  if(!admin)return reply({error:"server_unavailable"},503);
  const account=await authorize(req);
  if(!account)return reply({error:"invalid_or_expired_pairing_token"},401,{"WWW-Authenticate":"Bearer"});
  let body;try{body=await req.json()}catch{return reply(err(null,-32700,"Parse error"),400)}
  if(!body||body.jsonrpc!=="2.0"||typeof body.method!=="string")return reply(err(body?.id??null,-32600,"Invalid Request"),400);
  const id=body.id??null;
  if(body.method.startsWith("notifications/"))return new Response(null,{status:202,headers});
  if(body.method==="initialize"){
    return reply(output(id,{protocolVersion:"2025-03-26",capabilities:{tools:{listChanged:false}},serverInfo:{name:"omate-shared-memory",version:"2.0.0"}}));
  }
  if(body.method==="ping")return reply(output(id,{}));
  if(body.method==="tools/list")return reply(output(id,{tools}));
  if(body.method==="tools/call"){
    const name=str(body.params?.name,64),args=body.params?.arguments||{};
    if(!tools.some(t=>t.name===name))return reply(output(id,textResult({error:"unknown_tool"},true)));
    const data=await toolCall(name,args,account);
    return reply(output(id,textResult(data,!!data?.error)));
  }
  return reply(err(id,-32601,"Method not found"),404);
 }catch(e){
  console.error("omate MCP request failed",e instanceof Error?e.name:"unknown");
  return reply({jsonrpc:"2.0",id:null,error:{code:-32603,message:"Internal error"}},500);
 }
});
