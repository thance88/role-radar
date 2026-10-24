/* Hands-free voice. Default: Whisper running in this browser (whisper-worker.js).
   Alternatives: the stt edge function (OpenAI, needs OPENAI_API_KEY) and Chrome's built-in recognition as last resort.
   Choose with rrListen.use("local"|"cloud"|"chrome"); the choice is remembered. */
(function(){
const btn=$("vMic"),hint=$("vHint");
let on=false,engine=null,cloudReady=null;
let pref="local";try{pref=localStorage.getItem("rr-stt")||"local"}catch(e){}
function ui(){btn.classList.toggle("on",on);btn.textContent=on?"Listening":"Listen";btn.setAttribute("aria-pressed",String(on))}
function status(t){hint.textContent=t}
async function sttReady(){if(cloudReady!==null)return cloudReady;try{const {data}=await window.__sb.functions.invoke("stt",{body:{ping:true}});cloudReady=!!(data&&data.ready)}catch(e){cloudReady=false}return cloudReady}
function nameList(){const names=new Set();
  try{roles.filter(r=>!["discarded","rejected"].includes(r.st)).forEach(r=>names.add(r.co));people().forEach(o=>names.add(o.name));
    prospects.filter(p=>p.st==="suggested").forEach(p=>{names.add(p.name);names.add(p.co)});cos.slice(0,80).forEach(c=>names.add(c.name))}catch(e){}
  return [...names].filter(Boolean)}
function vocab(){let t="";try{const c=curCard();if(c)t=c.title}catch(e){}
  return ("Voice commands for a job search tracker: yes, no, not yet, drop it, skip, later, back, edit, approve, send, shortlist, discard, track, debrief, follow up, to do. Names: "+nameList().concat(t?[t]:[]).join(", ")).slice(0,1400)}
/* ---- name repair for local Whisper, which can't take a vocabulary list ---- */
const norm=s=>s.toLowerCase().normalize("NFD").replace(/(^|\s)(and|&)(?=\s|$)/g," ").replace(/[^a-z0-9]/g,"");
const skel=s=>{s=norm(s).replace(/ph/g,"f").replace(/wh/g,"w").replace(/ck|c|q/g,"k").replace(/z/g,"s").replace(/y/g,"i");return (s[0]||"")+s.slice(1).replace(/[aeiouh]/g,"").replace(/(.)\1+/g,"$1")};
function lev(a,b){const m=a.length,n=b.length;if(!m)return n;if(!n)return m;let p=[...Array(n+1).keys()];
  for(let i=1;i<=m;i++){const c=[i];for(let j=1;j<=n;j++)c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=c}return p[n]}
const KEEP=new Set("yes no not yet drop it skip later back edit approve send done track debrief follow up to do the a with call move moved remind me about for at in on of".split(" "));
function fixNames(text){
  const names=nameList().map(n=>n.replace(/\s*\(.*?\)\s*/g," ").trim()).filter(n=>norm(n).length>=4).sort((a,b)=>b.split(/\s+/).length-a.split(/\s+/).length||b.length-a.length);
  if(!names.length)return text;
  let words=text.split(/\s+/),lock=words.map(()=>false);
  for(const name of names){const k=name.split(/\s+/).length,target=norm(name);
    for(const span of (k===1?[1,2]:[k,k-1])){if(span<1)continue;
      for(let i=0;i+span<=words.length;i++){const win=words.slice(i,i+span);
        if(lock.slice(i,i+span).some(Boolean)||win.some(w=>KEEP.has(norm(w)))||/^(and|&)$/i.test(win[0])||/^(and|&)[.,]?$/i.test(win[win.length-1]))continue;
        const got=norm(win.join(" "));if(!got)continue;if(got===target&&win.join(" ").replace(/[.,!?;:]+$/,"")===name){lock.fill(true,i,i+span);continue}if(got[0]!==target[0])continue;
        const sim=1-lev(got,target)/Math.max(got.length,target.length);const ga=skel(win.join(" ")),ta=skel(name);
        const sim2=ta.length>=4?1-lev(ga,ta)/Math.max(ga.length,ta.length):0;
        if(sim>=0.78||sim2>=0.8){const tail=(win[win.length-1].match(/[.,!?;:]+$/)||[""])[0];const parts=name.split(/\s+/);parts[parts.length-1]+=tail;words.splice(i,span,...parts);lock.splice(i,span,...parts.map(()=>true));i+=parts.length-1;}
      }}}
  return words.join(" ")}
function clean(t){t=String(t||"").replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g," ").replace(/\s+/g," ").trim();
  if(!t||/^(you|thank you|thanks for watching|bye|okay|\.+)[.!]?$/i.test(t))return "";return t}
/* ---- local Whisper worker ---- */
let worker=null,wState="off",wDevice="",wSeq=0;const wWait={};
function loadWorker(){if(worker)return;wState="loading";
  try{worker=new Worker("whisper-worker.js",{type:"module"})}catch(e){wState="error";return}
  worker.onmessage=e=>{const d=e.data;
    if(d.type==="progress"){wState="loading";if(on&&!W.speaking&&!W.busy)status("Downloading speech model, first time only: "+d.pct+"% of "+d.mb+" MB")}
    else if(d.type==="ready"){wState="ready";wDevice=d.device;if(on&&!W.busy)status("Listening…");if(W.queue.length)drain()}
    else if(d.type==="error"){wState="error";console.warn("Local Whisper failed:",d.message);fallback()}
    else if(d.type==="text"){const r=wWait[d.id];delete wWait[d.id];if(r)r(d)}};
  worker.onerror=e=>{wState="error";console.warn("Whisper worker error",e.message);fallback()};
  worker.postMessage({type:"load"})}
function localRun(audio){return new Promise(res=>{const id=++wSeq;wWait[id]=res;worker.postMessage({type:"run",id,audio},[audio.buffer])})}
async function fallback(){if(!on||engine!=="l")return;W.queue=[];
  if(await sttReady()){engine="w";toast("On-device speech model couldn't load; using cloud transcription.");status("Listening…")}
  else{stopCapture();engine=null;if(startC())toast("On-device speech model couldn't load; using Chrome's recognition.",true);else{on=false;ui()}}}
/* ---- capture + pause detection (shared by local and cloud) ---- */
let stream=null,actx=null,proc=null,src=null;
const W={speaking:false,frames:[],pre:[],floor:0.008,loud:0,lastLoud:0,start:0,queue:[],busy:false,rate:16000};
function rms(a){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*a[i];return Math.sqrt(s/a.length)}
function to16k(chunks,rate){let n=0;chunks.forEach(c=>n+=c.length);const all=new Float32Array(n);let o=0;chunks.forEach(c=>{all.set(c,o);o+=c.length});
  if(rate===16000)return all;const ratio=rate/16000,len=Math.floor(n/ratio),out=new Float32Array(len);
  for(let i=0;i<len;i++){const s=Math.floor(i*ratio),e=Math.min(n,Math.floor((i+1)*ratio));let a=0;for(let j=s;j<e;j++)a+=all[j];out[i]=a/Math.max(1,e-s)}return out}
function toWav(pcmF){const pcm=new Int16Array(pcmF.length);for(let i=0;i<pcmF.length;i++)pcm[i]=Math.max(-1,Math.min(1,pcmF[i]))*0x7fff;
  const buf=new ArrayBuffer(44+pcm.length*2),dv=new DataView(buf);const w=(p,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(p+i,s.charCodeAt(i))};
  w(0,"RIFF");dv.setUint32(4,36+pcm.length*2,true);w(8,"WAVE");w(12,"fmt ");dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);
  dv.setUint32(24,16000,true);dv.setUint32(28,32000,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);w(36,"data");dv.setUint32(40,pcm.length*2,true);
  new Int16Array(buf,44).set(pcm);return new Uint8Array(buf)}
function b64(u8){let s="";for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s)}
async function transcribe(pcm){
  if(engine==="l"){const d=await localRun(pcm);if(d.error)throw new Error(d.error);return fixNames(clean(d.text))}
  const {data,error}=await window.__sb.functions.invoke("stt",{body:{audio:b64(toWav(pcm)),prompt:vocab()}});if(error)throw error;return clean(data&&data.text)}
async function drain(){if(W.busy)return;if(engine==="l"&&wState!=="ready")return;W.busy=true;
  while(W.queue.length&&on){const pcm=W.queue.shift();status("Transcribing…");
    try{const t=await transcribe(pcm);
      if(t){status("Heard: "+t);while(deckBusy)await new Promise(r=>setTimeout(r,200));$("vIn").value=t;await voiceSubmit()}
      else status("Listening…")}
    catch(e){console.warn(e);status("Couldn't transcribe that one. Try again.")}}
  W.busy=false}
function onFrame(data,rate){const level=rms(data),now=performance.now(),frameMs=data.length/rate*1000;
  const thr=Math.max(0.012,W.floor*3.2);
  if(!W.speaking){W.floor=W.floor*0.97+Math.min(level,0.05)*0.03;W.pre.push(new Float32Array(data));while(W.pre.length*frameMs>450)W.pre.shift();
    if(level>thr){W.loud++;if(W.loud>=2){W.speaking=true;W.frames=W.pre.slice();W.pre=[];W.start=now;W.lastLoud=now;if(!W.busy)status("Hearing you…")}}else W.loud=0;return}
  W.frames.push(new Float32Array(data));if(level>thr*0.7)W.lastLoud=now;
  if(now-W.lastLoud>1100||now-W.start>28000){W.speaking=false;W.loud=0;const dur=now-W.start,frames=W.frames;W.frames=[];
    if(dur>450){W.queue.push(to16k(frames,rate));
      if(engine==="l"&&wState!=="ready")status("Got it. Waiting for the speech model to finish loading…");drain()}
    else if(!W.busy)status("Listening…")}}
async function startCapture(){
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
  const AC=window.AudioContext||window.webkitAudioContext;try{actx=new AC({sampleRate:16000})}catch(e){actx=new AC()}
  src=actx.createMediaStreamSource(stream);proc=actx.createScriptProcessor(2048,1,1);proc.onaudioprocess=e=>{if(on&&engine!=="c")onFrame(e.inputBuffer.getChannelData(0),actx.sampleRate)};
  const mute=actx.createGain();mute.gain.value=0;src.connect(proc);proc.connect(mute);mute.connect(actx.destination)}
function stopCapture(){try{proc&&proc.disconnect();src&&src.disconnect();actx&&actx.close();stream&&stream.getTracks().forEach(t=>t.stop())}catch(e){}proc=src=actx=stream=null;W.speaking=false;W.frames=[];W.pre=[];W.queue=[]}
/* ---- Chrome recognition (last resort) ---- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,buf="",flushT=null,lastStart=0;
function flush(){const t=buf.trim();buf="";if(!t)return;if(deckBusy){toast("Still working on the last one");return}$("vIn").value=t;voiceSubmit()}
function startC(){if(!SR){toast("Open this site in Chrome to use the microphone.",true);return false}
  rec=new SR();rec.lang="en-GB";rec.continuous=true;rec.interimResults=true;
  rec.onresult=e=>{let live="";for(let i=e.resultIndex;i<e.results.length;i++){const r=e.results[i];const t=r[0].transcript.trim();if(r.isFinal){if(t)buf=(buf+" "+t).trim()}else live+=" "+t}
    const shown=(buf+" "+live).trim();if(shown)status("… "+shown);clearTimeout(flushT);if(!buf)return;flushT=setTimeout(flush,!live.trim()&&wordClass(buf)?550:1600)};
  rec.onend=()=>{if(on&&engine==="c"){setTimeout(()=>{if(on){try{lastStart=Date.now();rec.start()}catch(e){}}},Date.now()-lastStart<1000?800:50)}};
  rec.onerror=e=>{if(e.error==="not-allowed"||e.error==="service-not-allowed"){on=false;ui();toast("Allow the microphone for this site (the icon in the address bar).",true)}};
  lastStart=Date.now();rec.start();engine="c";status("Listening (basic recognition)…");return true}
function stopC(){try{rec&&rec.abort()}catch(e){}rec=null}
/* ---- control ---- */
async function start(auto){
  try{
    if(pref==="chrome"){if(!startC())return}
    else if(pref==="cloud"&&await sttReady()){await startCapture();engine="w";status("Listening…")}
    else if(pref!=="cloud"&&(window.Worker&&window.WebAssembly)){await startCapture();engine="l";loadWorker();
      status(wState==="ready"?"Listening…":"Loading the speech model…");if(wState==="error"){on=true;await fallback()}}
    else if(await sttReady()){await startCapture();engine="w";status("Listening…")}
    else if(!startC())return;
    on=true;ui();try{localStorage.setItem("rr-listen","1")}catch(x){}
  }catch(e){on=false;ui();stopCapture();
    if(auto){status("Tap Listen, or press Space")}else toast(e&&e.name==="NotAllowedError"?"Allow the microphone for this site (the icon in the address bar).":"Couldn't start the microphone.",true)}}
function stop(){on=false;if(engine==="c")stopC();else stopCapture();engine=null;ui();try{localStorage.setItem("rr-listen","0")}catch(x){}setVoiceHint($("today").hidden?null:curCard())}
btn.hidden=false;btn.onclick=()=>on?stop():start(false);
document.addEventListener("keydown",e=>{if(e.code==="Space"&&!e.target.closest("input,textarea,select,button,dialog")){e.preventDefault();on?stop():start(false)}});
window.rrListen={start,stop,use(p){pref=p;try{localStorage.setItem("rr-stt",p)}catch(e){}if(on){stop();start(false)}},
  get on(){return on},get engine(){return engine},get model(){return wState+(wDevice?" ("+wDevice+")":"")},fixNames};
let auto=false;try{auto=localStorage.getItem("rr-listen")!=="0"}catch(e){}
if(auto)setTimeout(()=>{if(!on)start(true)},1500);
ui();
})();
