import {syncWindow} from "./context.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.95.0";
const u=Deno.env.get("SUPABASE_URL")||"",p=Deno.env.get("SUPABASE_ANON_KEY")||"",s=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const pub=createClient(u,p,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=createClient(u,s,{auth:{persistSession:false,autoRefreshToken:false}});
const CORS={"Content-Type":"application/json;charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Authorization,apikey,Content-Type"};
const send=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:CORS});
const val=(x,n)=>typeof x==="string"?x.slice(0,n):"";
Deno.serve(async req=>{
 try{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(req.method!=="POST")return send({error:"method_not_allowed"},405);
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return send({error:"login_required"},401);
  const {data:{user},error:ae}=await pub.auth.getUser(token);
  if(ae||!user)return send({error:"invalid_session"},401);
  let body;try{body=await req.json()}catch{return send({error:"invalid_json"},400)}
  const space=val(body?.conversation_key,181).trim(),act=val(body?.action,20);
  if(!space||space.length>180)return send({error:"invalid_space"},400);
  const query=()=>admin.from("omate_context_window").select("messages,updated_at").eq("owner_id",user.id).eq("conversation_key",space);
  if(act==="read"){
    const {data,error}=await query().maybeSingle();if(error)throw error;
    const messages=Array.isArray(data?.messages)?data.messages:[];
    return send({ok:true,limit:40,round_limit:20,count:messages.length,messages,updated_at:data?.updated_at??null});
  }
  if(act==="sync"){
    return send(await syncWindow(admin,user.id,space,body.messages));
  }
  if(act==="clear"){
   if(body?.confirmation!==space)return send({error:"confirmation_required"},400);
   const {error}=await admin.from("omate_context_window").delete().eq("owner_id",user.id).eq("conversation_key",space);
   if(error)throw error;
   return send({ok:true,cleared:true});
  }
  return send({error:"unsupported_action"},400);
 }catch(e){console.error("cloud context window error",e instanceof Error?e.message:"unknown");return send({error:"context_window_failed"},500);}
});
