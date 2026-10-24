/* Hands-free voice. Preferred: record each utterance and transcribe it with a Whisper-class model
   (stt edge function, with your names and companies as vocabulary). Fallback: Chrome's built-in recognition. */
(function(){
const btn=$("vMic"),hint=$("vHint");
let on=false,engine=null,ready=null;
function ui(){btn.classList.toggle("on",on);btn.textContent=on?"Listening":"Listen";btn.setAttribute("aria-pressed",String(on))}
function status(t){hint.textContent=t}
async function sttReady(){if(ready!==null)return ready;try{const {data}=await window.__sb.functions.invoke("stt",{body:{ping:true}});ready=!!(data&&data.ready)}catch(e){ready=false}return ready}
function vocab(){const names=new Set();
  try{roles.filter(r=>!["discarded","rejected"].includes(r.st)).forEach(r=>names.add(r.co));people().forEach(o=>names.add(o.name));
    prospects.filter(p=>p.st==="suggested").forEach(p=>{names.add(p.name);names.add(p.co)});cos.slice(0,80).forEach(c=>names.add(c.name));
    const c=curCard();if(c)names.add(c.title)}catch(e){}
  return ("Voice commands for a job search tracker: yes, no, not yet, drop it, skip, later, back, edit, approve, send, shortlist, discard, track, debrief, follow up, to do. Names: "+[...names].filter(Boolean).join(", ")).slice(0,1400)}
/* ---------- engine 1: record + transcribe ---------- */
let stream=null,actx=null,proc=null,src=null;
const W={speaking:false,frames:[],pre:[],floor:0.008,loud:0,lastLoud:0,start:0,queue:[],busy:false};
function rms(a){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*a[i];return Math.sqrt(s/a.length)}
function toWav(chunks,rate){let n=0;chunks.forEach(c=>n+=c.length);const ratio=rate/16000,len=Math.floor(n/ratio),pcm=new Int16Array(len);
  const all=new Float32Array(n);let o=0;chunks.forEach(c=>{all.set(c,o);o+=c.length});
  for(let i=0;i<len;i++){const v=all[Math.floor(i*ratio)];pcm[i]=Math.max(-1,Math.min(1,v))*0x7fff}
  const buf=new ArrayBuffer(44+pcm.length*2),dv=new DataView(buf);const w=(p,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(p+i,s.charCodeAt(i))};
  w(0,"RIFF");dv.setUint32(4,36+pcm.length*2,true);w(8,"WAVE");w(12,"fmt ");dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);
  dv.setUint32(24,16000,true);dv.setUint32(28,32000,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);w(36,"data");dv.setUint32(40,pcm.length*2,true);
  new Int16Array(buf,44).set(pcm);return new Uint8Array(buf)}
function b64(u8){let s="";for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s)}
async function drain(){if(W.busy)return;W.busy=true;
  while(W.queue.length){const wav=W.queue.shift();status("Transcribing…");
    try{const {data,error}=await window.__sb.functions.invoke("stt",{body:{audio:b64(wav),prompt:vocab()}});
      if(error)throw error;const t=String(data&&data.text||"").trim();
      if(t&&!/^(thanks for watching|thank you\.?|you)$/i.test(t)){status("Heard: "+t);
        while(deckBusy)await new Promise(r=>setTimeout(r,200));$("vIn").value=t;await voiceSubmit()}
      else status("Listening…")}
    catch(e){status("Couldn't transcribe that one. Try again.")}}
  W.busy=false;if(on)status("Listening…")}
function onFrame(data,rate){const level=rms(data),now=performance.now(),frameMs=data.length/rate*1000;
  const thr=Math.max(0.012,W.floor*3.2);
  if(!W.speaking){W.floor=W.floor*0.97+Math.min(level,0.05)*0.03;W.pre.push(new Float32Array(data));while(W.pre.length*frameMs>450)W.pre.shift();
    if(level>thr){W.loud++;if(W.loud>=2){W.speaking=true;W.frames=W.pre.slice();W.pre=[];W.start=now;W.lastLoud=now;status("Hearing you…")}}else W.loud=0;return}
  W.frames.push(new Float32Array(data));if(level>thr*0.7)W.lastLoud=now;
  if(now-W.lastLoud>1100||now-W.start>45000){W.speaking=false;W.loud=0;const dur=now-W.start;const frames=W.frames;W.frames=[];
    if(dur>450){W.queue.push(toWav(frames,rate));drain()}else status("Listening…")}}
async function startW(){
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
  actx=new (window.AudioContext||window.webkitAudioContext)();src=actx.createMediaStreamSource(stream);
  proc=actx.createScriptProcessor(2048,1,1);proc.onaudioprocess=e=>{if(on)onFrame(e.inputBuffer.getChannelData(0),actx.sampleRate)};
  const mute=actx.createGain();mute.gain.value=0;src.connect(proc);proc.connect(mute);mute.connect(actx.destination);
  engine="w";status("Listening…")}
function stopW(){try{proc&&proc.disconnect();src&&src.disconnect();actx&&actx.close();stream&&stream.getTracks().forEach(t=>t.stop())}catch(e){}proc=src=actx=stream=null;W.speaking=false;W.frames=[];W.pre=[]}
/* ---------- engine 2: Chrome recognition (fallback) ---------- */
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
/* ---------- control ---------- */
async function start(auto){
  try{
    if(await sttReady()){await startW()}else if(!startC())return;
    on=true;ui();try{localStorage.setItem("rr-listen","1")}catch(x){}
  }catch(e){on=false;ui();
    if(auto){status("Tap Listen, or press Space")}else toast(e&&e.name==="NotAllowedError"?"Allow the microphone for this site (the icon in the address bar).":"Couldn't start the microphone.",true)}}
function stop(){on=false;if(engine==="w")stopW();else stopC();engine=null;ui();try{localStorage.setItem("rr-listen","0")}catch(x){}setVoiceHint($("today").hidden?null:curCard())}
btn.hidden=false;btn.onclick=()=>on?stop():start(false);
document.addEventListener("keydown",e=>{if(e.code==="Space"&&!e.target.closest("input,textarea,select,button,dialog")){e.preventDefault();on?stop():start(false)}});
window.rrListen={start,stop,get on(){return on},get engine(){return engine}};
let auto=false;try{auto=localStorage.getItem("rr-listen")!=="0"}catch(e){}
if(auto)setTimeout(()=>{if(!on)start(true)},1500);
ui();
})();
