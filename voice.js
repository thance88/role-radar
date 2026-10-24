/* always-on microphone: Chrome speech recognition, continuous */
(function(){
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,on=false,lastStart=0,autoTry=false,buf="",flushT=null;
function flush(){const t=buf.trim();buf="";if(!t)return;if(deckBusy){toast("Still working on the last one");return}$("vIn").value=t;voiceSubmit()}
const btn=$("vMic"),hint=$("vHint");
function ui(){btn.classList.toggle("on",on);btn.textContent=on?"Listening":"Listen";btn.setAttribute("aria-pressed",String(on))}
function interim(t){if(t)hint.textContent="… "+t;}
function start(){if(!SR){toast("Open this site in Chrome to use the microphone.",true);return}
  if(rec){try{rec.abort()}catch(e){}}
  rec=new SR();rec.lang="en-GB";rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
  rec.onresult=e=>{let live="";for(let i=e.resultIndex;i<e.results.length;i++){const r=e.results[i];const t=r[0].transcript.trim();
    if(r.isFinal){if(t)buf=(buf+" "+t).trim()}else live+=" "+t}
    const shown=(buf+" "+live).trim();if(shown)interim(shown);
    clearTimeout(flushT);if(!buf)return;
    /* short answers go straight away; longer speech waits for a pause so a sentence is not cut up */
    const quick=!live.trim()&&wordClass(buf);flushT=setTimeout(flush,quick?550:1600)};
  rec.onend=()=>{if(on){const wait=Date.now()-lastStart<1000?800:50;setTimeout(()=>{if(on){try{lastStart=Date.now();rec.start()}catch(e){}}},wait)}else ui()};
  rec.onerror=e=>{if(autoTry&&(e.error==="not-allowed"||e.error==="service-not-allowed")){autoTry=false;on=false;ui();hint.textContent="Tap Listen, or press Space";return}autoTry=false;if(e.error==="not-allowed"||e.error==="service-not-allowed"||e.error==="audio-capture"){on=false;ui();toast(e.error==="audio-capture"?"No microphone found.":"Allow the microphone for this site (the icon in the address bar).",true);try{localStorage.setItem("rr-listen","0")}catch(x){}}};
  try{lastStart=Date.now();rec.start();on=true;ui();try{localStorage.setItem("rr-listen","1")}catch(x){}}catch(e){}}
function stop(){on=false;try{rec&&rec.stop()}catch(e){}ui();try{localStorage.setItem("rr-listen","0")}catch(x){}setVoiceHint($("today").hidden?null:curCard())}
btn.hidden=false;btn.onclick=()=>on?stop():start();
document.addEventListener("keydown",e=>{if(e.code==="Space"&&!e.target.closest("input,textarea,select,button,dialog")){e.preventDefault();on?stop():start()}});
window.rrListen={start,stop,get on(){return on}};
let auto=false;try{auto=localStorage.getItem("rr-listen")!=="0"}catch(e){}
if(auto&&SR){const kick=()=>{if(!on){autoTry=true;start()}};setTimeout(kick,1200)}
ui();
})();
