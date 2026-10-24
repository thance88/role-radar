/* Runs Whisper on this computer (WebGPU when available, otherwise WebAssembly). Model is cached by the browser after the first download. */
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
env.allowLocalModels = false;
let asr = null, loading = null;
const seen = {};
function prog(p){ if(p.status==="progress"&&p.total){ seen[p.file]=[p.loaded,p.total]; let a=0,b=0; for(const k in seen){a+=seen[k][0];b+=seen[k][1]} postMessage({type:"progress",pct:Math.round(a/b*100),mb:Math.round(b/1048576)}) } }
async function hasGpu(){ try{ return !!(navigator.gpu && await navigator.gpu.requestAdapter()) }catch(e){ return false } }
async function load(){
  const tries=[]; if(await hasGpu()) tries.push(["onnx-community/whisper-base.en",{device:"webgpu",dtype:{encoder_model:"fp32",decoder_model_merged:"q4"}}]);
  tries.push(["Xenova/whisper-base.en",{device:"wasm",dtype:"q8"}]);
  let err=null;
  for(const [model,opts] of tries){
    try{ for(const k in seen) delete seen[k];
      const p=await pipeline("automatic-speech-recognition",model,{...opts,progress_callback:prog});
      await p(new Float32Array(16000)); asr=p; postMessage({type:"ready",device:opts.device}); return }
    catch(e){ err=e }
  }
  postMessage({type:"error",message:String(err&&err.message||err)});
}
onmessage = async e => {
  const d=e.data;
  if(d.type==="load"){ if(!loading) loading=load(); return }
  if(d.type==="run"){
    try{ if(loading) await loading; const out=await asr(d.audio); postMessage({type:"text",id:d.id,text:String(out&&out.text||"")}) }
    catch(err){ postMessage({type:"text",id:d.id,text:"",error:String(err&&err.message||err)}) }
  }
};
