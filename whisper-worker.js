/* Runs speech recognition on this computer (Moonshine base, built for short live commands; about 0.1 s per command on an M series Mac) (WebGPU when available, otherwise WebAssembly). Model is cached by the browser after the first download. */
import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
env.allowLocalModels = false;
let asr = null, loading = null;
const seen = {};
function prog(p){ if(p.status==="progress"&&p.total){ seen[p.file]=[p.loaded,p.total]; let a=0,b=0; for(const k in seen){a+=seen[k][0];b+=seen[k][1]} postMessage({type:"progress",pct:Math.round(a/b*100),mb:Math.round(b/1048576)}) } }
async function hasGpu(){ try{ return !!(navigator.gpu && await navigator.gpu.requestAdapter()) }catch(e){ return false } }
async function load(){
  const M="onnx-community/moonshine-base-ONNX",tries=[];
  if(await hasGpu()) tries.push([M,{device:{encoder_model:"webgpu",decoder_model_merged:"wasm"},dtype:{encoder_model:"fp32",decoder_model_merged:"q8"}}]);
  tries.push([M,{device:"wasm",dtype:"q8"}]);
  let err=null;
  for(const [model,opts] of tries){
    try{ for(const k in seen) delete seen[k];
      const p=await pipeline("automatic-speech-recognition",model,{...opts,progress_callback:prog});
      await p(new Float32Array(16000)); asr=p; postMessage({type:"ready",device:typeof opts.device==="string"?opts.device:"webgpu+wasm"}); return }
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
