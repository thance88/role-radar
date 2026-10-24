/* Role Radar website: stand-ins for the Claude artifact runtime (db, sample, mcp) backed by Supabase */
(function(){
const SB_URL="https://ytpzvgmciysnztewxhnz.supabase.co", SB_KEY="sb_publishable_uAIQ6nSsiayO6Qcr6CrCxQ_5jZj3Ukr", OWNER="timothy.hancer1@gmail.com";
const sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
window.__sb=sb;
const GSCOPE="https://www.googleapis.com/auth/calendar.events";
async function signIn(){await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname,scopes:GSCOPE,queryParams:{access_type:"offline",prompt:"consent"}}})}
window.rrSignIn=signIn;
window.rrSignOut=async()=>{await sb.auth.signOut();location.reload()};
function gate(msg){let g=document.getElementById("gate");if(!g){g=document.createElement("div");g.id="gate";document.body.appendChild(g)}
  g.innerHTML=`<div class="gbox"><div class="eyebrow">Private</div><h1>Role Radar</h1><p>${msg}</p><button id="gateBtn">Sign in with Google</button></div>`;
  document.getElementById("gateBtn").onclick=signIn}
let resolveSession;const sessionP=new Promise(r=>resolveSession=r);
async function onSession(s){
  if(!s)return;
  if(String(s.user&&s.user.email||"").toLowerCase()!==OWNER){gate("This site is private. You are signed in as "+(s.user&&s.user.email)+".");return}
  const g=document.getElementById("gate");if(g)g.remove();
  if(s.provider_refresh_token){try{await sb.functions.invoke("gcal",{body:{action:"store",refresh_token:s.provider_refresh_token}})}catch(e){}}
  resolveSession(s);
}
document.addEventListener("DOMContentLoaded",()=>{
  sb.auth.getSession().then(({data})=>{if(data.session)onSession(data.session);else gate("Sign in with your Google account to open your tracker. Allow Calendar so calls can be moved by voice.")});
});
sb.auth.onAuthStateChange((ev,s)=>{if(ev==="SIGNED_IN"||ev==="INITIAL_SESSION")onSession(s)});

/* db */
const cache={},subs={},loading={};let fireT={};
const clone=o=>JSON.parse(JSON.stringify(o));
const snap=c=>({docs:Object.entries(cache[c]||{}).map(([id,d])=>({id,exists:true,data:()=>clone(d)}))});
function fire(c){clearTimeout(fireT[c]);fireT[c]=setTimeout(()=>(subs[c]||[]).forEach(f=>{try{f(snap(c))}catch(e){console.error(e)}}),30)}
async function load(c){if(loading[c])return loading[c];loading[c]=(async()=>{const out={};let from=0;
  for(;;){const {data,error}=await sb.from("docs").select("id,data").eq("col",c).range(from,from+999);if(error)throw error;data.forEach(r=>out[r.id]=r.data);if(data.length<1000)break;from+=1000}
  cache[c]=out})();return loading[c]}
let channel=null;
function live(){if(channel)return;channel=sb.channel("docs-live").on("postgres_changes",{event:"*",schema:"public",table:"docs"},p=>{
  const r=(p.new&&p.new.col)?p.new:p.old;if(!r||!cache[r.col])return;
  if(p.eventType==="DELETE")delete cache[r.col][r.id];else cache[r.col][r.id]=p.new.data;fire(r.col)}).subscribe(st=>{if(st==="CHANNEL_ERROR"||st==="TIMED_OUT"){channel=null;setTimeout(live,5000)}})}
document.addEventListener("visibilitychange",()=>{if(!document.hidden){Object.keys(cache).forEach(c=>{loading[c]=null;load(c).then(()=>fire(c)).catch(()=>{})})}});
function docRef(c,id){return{
  get:async()=>{const {data,error}=await sb.from("docs").select("data").eq("col",c).eq("id",id).maybeSingle();if(error)throw error;return{exists:!!data,id,data:()=>data?clone(data.data):undefined}},
  set:async d=>{const {error}=await sb.from("docs").upsert({col:c,id,data:d});if(error)throw error;if(cache[c]){cache[c][id]=clone(d);fire(c)}},
  update:async patch=>{const {data,error}=await sb.rpc("doc_merge",{p_col:c,p_id:id,p_patch:patch});if(error)throw error;if(cache[c]){cache[c][id]=data;fire(c)}},
  delete:async()=>{const {error}=await sb.from("docs").delete().eq("col",c).eq("id",id);if(error)throw error;if(cache[c]){delete cache[c][id];fire(c)}},
  onSnapshot:(f,err)=>{const h=s=>{const d=(s.docs.find(x=>x.id===id));f({exists:!!d,id,data:()=>d?d.data():undefined})};(subs[c]=subs[c]||[]).push(h);load(c).then(()=>h(snap(c))).catch(e=>err&&err(e));return()=>{subs[c]=(subs[c]||[]).filter(x=>x!==h)}}}}
function colRef(c){return{
  onSnapshot:(f,err)=>{(subs[c]=subs[c]||[]).push(f);live();load(c).then(()=>f(snap(c))).catch(e=>{console.error(e);err&&err(e)});return()=>{subs[c]=(subs[c]||[]).filter(x=>x!==f)}},
  get:async()=>{loading[c]=null;await load(c);return snap(c)},
  doc:id=>docRef(c,id),
  add:async d=>{const id=Date.now().toString(36)+Math.random().toString(36).slice(2,7);await docRef(c,id).set(d);return{id}}}}
const db={collection:colRef,doc:p=>{const i=p.indexOf("/");return docRef(p.slice(0,i),p.slice(i+1))}};

/* sample: Claude through the ai edge function */
async function ask(prompt,opts){const {data,error}=await sb.functions.invoke("ai",{body:{prompt:typeof prompt==="string"?prompt:JSON.stringify(prompt),tier:opts&&opts.modelTier}});
  if(error){let m="";try{m=(await error.context.json()).error}catch(e){}throw{code:m==="no_key"?"not_granted":"upstream_error",message:m||String(error.message||error)}}
  return{text:data.text||"",truncated:false}}
const sample=Object.assign(async(p,o)=>ask(p,o),{json:async(p,o)=>{const {text}=await ask(p,o);const m=text.match(/\{[\s\S]*\}/);if(!m)throw{code:"bad_json",message:text};return JSON.parse(m[0])}});

/* mcp: Google Calendar through the gcal edge function */
const mcp={callTool:async(server,tool,input)=>{
  if(server!=="Google Calendar")throw{code:"server_not_connected",message:server};
  const {data,error}=await sb.functions.invoke("gcal",{body:{tool,input}});
  if(error){let m="";try{m=(await error.context.json()).error}catch(e){}throw{code:m==="needs_google"?"needs_reauth":"upstream_error",message:m}}
  return{payload:data}}};

window.claude={use:async n=>{if(n==="db"){await sessionP;return db}if(n==="sample"){await sessionP;return sample}if(n==="mcp"){await sessionP;return mcp}return null}};
})();
