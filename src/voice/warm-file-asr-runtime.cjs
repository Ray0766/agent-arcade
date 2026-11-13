'use strict';
// Main-process binding for one resident file recognizer. No account or audio
// value reaches the worker key or a log; object identities stay in this process.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {readFileAsrRuntime}=require('./file-asr-runtime.cjs');
const unavailable=()=>Object.assign(Error('Local QQ voice settings changed or are unavailable.'),{code:'asr_unavailable'});
function runtimeSnapshot(root){
  try{
    const options=readFileAsrRuntime(root),file=path.join(root,'local-voice.json');
    const stamp=value=>{const s=fs.statSync(value);return [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs];};
    // Detect configuration/runtime replacement between jobs and while waiting
    // for cleanup. This is metadata coherence, not model-file authentication.
    const revision=createHash('sha256').update(JSON.stringify([options,stamp(file),stamp(options.pythonPath),stamp(options.modelPath)])).digest('hex');
    return Object.freeze({options:Object.freeze(options),revision});
  }catch{throw unavailable();}
}
function createWarmFileAsrProvider({root,gate,readRuntime=runtimeSnapshot,createAsr=options=>new (require('./qwen-warm-file-asr.cjs').QwenWarmFileAsr)(options)}={}){
  if(typeof root!=='string'||!root||typeof readRuntime!=='function'||typeof createAsr!=='function'||['retryCleanup','prepare','acquire'].some(k=>typeof gate?.[k]!=='function'))throw unavailable();
  const objects=new WeakMap();let sequence=0;
  const objectId=value=>{if(!value||!['object','function'].includes(typeof value))throw unavailable();if(!objects.has(value))objects.set(value,++sequence);return objects.get(value);};
  return Object.freeze({pipelineOptions(){
    const snapshot=readRuntime(root);
    const current=()=>{if(readRuntime(root).revision!==snapshot.revision)throw unavailable();};
    return Object.freeze({keepWarm:true,createAsr(){current();return createAsr(snapshot.options);},async acquireLease(value){
      if(!value||typeof value.scopeId!=='string'||!value.scopeId||!/^\d{5,12}$/.test(value.accountId)||!/^\d{5,12}$/.test(value.ownerId)||!Number.isSafeInteger(value.generation)||!Number.isSafeInteger(value.clientGeneration))throw unavailable();
      current();const reuseKey=createHash('sha256').update(JSON.stringify([snapshot.revision,value.scopeId,value.accountId,value.ownerId,value.generation,value.clientGeneration,objectId(value.client),objectId(value.socket),objectId(value.dispatcher)])).digest('hex');
      await gate.retryCleanup();await gate.prepare({reuseKey,signal:value.signal});current();
      const lease=gate.acquire({...value,reuseKey});
      return Object.freeze({...lease,reuseKey,assertCurrent(){current();return lease.assertCurrent();}});
    }});
  }});
}
module.exports={runtimeSnapshot,createWarmFileAsrProvider};
