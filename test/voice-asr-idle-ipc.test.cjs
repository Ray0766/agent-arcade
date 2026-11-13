'use strict';
// Warm-idle desktop handoff regressions; original entry coverage stays separate.
// Execute the real desktop entry functions in a VM.
// Providers and the app are inert; no microphone, child process or model runs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{AsrGate}=require('../src/voice/asr-gate.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};},tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
  const state={runtimes:[],voices:[],caps:[],retryCalls:0,closeIdleCalls:0,cleanup:null};let gate;
  class Gate extends AsrGate{constructor(){super();gate=this;}async retryCleanup(){state.retryCalls++;await state.cleanup?.promise;return super.retryCleanup();}async closeIdle(options){state.closeIdleCalls++;return super.closeIdle(options);}}
  class Voice{constructor(options){this.options=options;this.scope=options.scope;this.closed=false;this.state={status:'idle',scope:this.scope,mode:'push-to-talk'};this.starts=0;state.voices.push(this);}snapshot(){return this.state;}record(){}diagnostics(){return {scope:this.scope,events:[],speech:{}};}async close(){this.closed=true;await this.closeGate?.promise;await this.options.speech.close();}async startListening(){this.starts++;this.state.status='listening';return this.state;}async interrupt(){}}
  const service=id=>({status:'connected',generation:1,incomingCount:0,socialScope:`${id}-scope`,config:{channel:'qq'},socialStore:{config:()=>({characterId:'claude-ju'})},socialController(){if(this.status!=='connected')throw Error('synthetic disconnected');return {};},socialReply(){return '';},snapshot(){return {social:{active:true,config:{enabled:false}}};}});
  const a=service('a'),b=service('b'),accounts={selectedId:'a',snapshot:()=>({accounts:[],selectedId:accounts.selectedId})};
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},setInterval,clearInterval,AbortController,
    require:name=>{if(name==='electron')return {app:{requestSingleInstanceLock:()=>false,quit(){},on(){}}};if(name==='./core/files.cjs')return {readJSON:(_p,f)=>f,atomicJSON(){},drainInbox:()=>[]};if(name==='./voice/asr-gate.cjs')return {AsrGate:Gate};if(name==='./voice/conversation.cjs')return {VoiceConversation:Voice};if(name==='./voice/runtime.cjs')return {createVoiceRuntime:options=>{const lease=options.backend==='windows'?null:options.acquireAsrLease?.(),speech={async close(){lease?.release();}};state.runtimes.push({options,speech});return {backend:options.backend||'local-neural',speech};},voiceCapabilities:async options=>{state.caps.push(options);const lease=options.backend==='windows'?null:options.acquireAsrLease?.();try{return {selectedBackend:options.backend};}finally{lease?.release();}}};return fromMain(name);}};
  vm.runInNewContext(source+`\nmodule.exports={startVoice,closeVoice,closeOwnedVoice,current:()=>voice,setup:(s,a)=>{bot=s;accounts=a;win={isDestroyed:()=>false,webContents:{send(){}}};},select:s=>{bot=s;},quit:()=>{quitting=true;}};`,context,{filename:main});
  const api=context.module.exports;api.setup(a,accounts);return {api,a,b,accounts,state,gate,options:{accountId:'a',panelId:'panel-a',backend:'local-neural',mode:'push-to-talk'}};
}
const changes={account:h=>{h.accounts.selectedId='b';h.api.select(h.b);},service:h=>h.api.select(h.b),generation:h=>h.a.generation++,scope:h=>{h.a.socialScope='changed-role-scope';},incoming:h=>h.a.incomingCount++,quitting:h=>h.api.quit()};
function warmIdle(h){
  const state={closeCalls:0,barrier:null,fail:false};
  const resource={closed:false,busy:false,async close(){state.closeCalls++;await state.barrier?.promise;if(state.fail)throw Object.assign(Error('PRIVATE_WORKER_PATH'),{code:'asr_exit_unconfirmed'});this.closed=true;return {closed:true};}};
  const lease=h.gate.acquire({scopeId:'warm-qq',jobId:'warm-old',reuseKey:'opaque-binding-key'});lease.attachResource(resource);lease.park({reuseKey:'opaque-binding-key',resource,closeIdle:()=>resource.close()});
  return {state,resource,lease};
}
test('desktop waits for independently confirmed warm idle exit before creating a microphone provider',async()=>{
  const h=harness(),warm=warmIdle(h);warm.state.barrier=defer();const pending=h.api.startVoice(h.options);await tick();assert.equal(h.state.closeIdleCalls,1);assert.equal(warm.state.closeCalls,1);assert.equal(warm.resource.closed,false);assert.equal(h.state.runtimes.length,0);assert.equal(h.state.voices.length,0);
  warm.state.barrier.resolve();await pending;assert.equal(warm.resource.closed,true);assert.equal(h.state.voices[0].starts,1);await h.api.closeVoice();
});
test('unconfirmed idle exit prevents both local-neural and Windows provider creation',async t=>{
  for(const backend of ['local-neural','windows'])await t.test(backend,async()=>{const h=harness(),warm=warmIdle(h);warm.state.fail=true;await assert.rejects(h.api.startVoice({...h.options,backend}),{code:'asr_exit_unconfirmed'});assert.equal(h.state.runtimes.length,0);assert.equal(h.state.voices.length,0);assert.equal(warm.resource.closed,false);assert.throws(()=>h.gate.acquire({scopeId:'other',jobId:'new'}),{code:'busy'});warm.state.fail=false;await h.gate.retryCleanup();assert.equal(warm.resource.closed,true);});
});
test('idle-close await rechecks every captured conversation identity before opening the microphone',async t=>{
  for(const [name,change]of Object.entries(changes))await t.test(name,async()=>{const h=harness(),warm=warmIdle(h);warm.state.barrier=defer();const pending=h.api.startVoice(h.options);await tick();assert.equal(warm.state.closeCalls,1);change(h);warm.state.barrier.resolve();await assert.rejects(pending,/cancelled|changed/);assert.equal(h.state.runtimes.length,0);assert.equal(h.state.voices.length,0);assert.equal(warm.resource.closed,true);});
});
test('closing the owning panel while idle retirement waits cannot start a late microphone',async()=>{
  const h=harness(),warm=warmIdle(h);warm.state.barrier=defer();const pending=h.api.startVoice(h.options);await tick();await h.api.closeOwnedVoice({accountId:'a',panelId:'panel-a'});warm.state.barrier.resolve();await assert.rejects(pending,/cancelled|changed/);assert.equal(h.state.runtimes.length,0);assert.equal(warm.resource.closed,true);
});
test('busy active QQ inference is never closed by either desktop backend',async()=>{
  const h=harness(),active=h.gate.acquire({scopeId:'active-qq',jobId:'inference',reuseKey:'active-key'}),resource={closed:false,busy:true,closeCalls:0,async close(){this.closeCalls++;this.closed=true;return {closed:true};}};active.attachResource(resource);
  await assert.rejects(h.api.startVoice(h.options),{code:'busy'});assert.equal(resource.closeCalls,0);active.assertCurrent();await h.api.startVoice({...h.options,backend:'windows'});assert.equal(h.state.closeIdleCalls,2);assert.equal(h.state.voices[0].starts,1);assert.equal(resource.closeCalls,0);active.assertCurrent();await h.api.closeVoice();resource.closed=true;active.release();
});
