'use strict';
// Execute the real main functions/registered capability callback in a VM.
// Providers and the app are inert; no microphone, child process or model runs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{AsrGate}=require('../src/voice/asr-gate.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};},tick=()=>new Promise(resolve=>setImmediate(resolve));
const prefix="register('voiceCapabilities', ",start=source.indexOf(prefix),end=source.indexOf("\n    register('voiceStart'",start);
assert(start>=0&&end>start);const capsCallback=source.slice(start+prefix.length,end).trim().replace(/\);$/,'');
function harness(){
  const state={runtimes:[],voices:[],caps:[],retryCalls:0,cleanup:null};let gate;
  class Gate extends AsrGate{constructor(){super();gate=this;}async retryCleanup(){state.retryCalls++;await state.cleanup?.promise;return super.retryCleanup();}}
  class Voice{constructor(options){this.options=options;this.scope=options.scope;this.closed=false;this.state={status:'idle',scope:this.scope,mode:'push-to-talk'};this.starts=0;state.voices.push(this);}snapshot(){return this.state;}record(){}diagnostics(){return {scope:this.scope,events:[],speech:{}};}async close(){this.closed=true;await this.closeGate?.promise;await this.options.speech.close();}async startListening(){this.starts++;this.state.status='listening';return this.state;}async interrupt(){}}
  const service=id=>({status:'connected',generation:1,incomingCount:0,socialScope:`${id}-scope`,config:{channel:'qq'},socialStore:{config:()=>({characterId:'claude-ju'})},socialController(){if(this.status!=='connected')throw Error('synthetic disconnected');return {};},socialReply(){return '';},snapshot(){return {social:{active:true,config:{enabled:false}}};}});
  const a=service('a'),b=service('b'),accounts={selectedId:'a',snapshot:()=>({accounts:[],selectedId:accounts.selectedId})};
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},setInterval,clearInterval,AbortController,
    require:name=>{if(name==='electron')return {app:{requestSingleInstanceLock:()=>false,quit(){},on(){}}};if(name==='./core/files.cjs')return {readJSON:(_p,f)=>f,atomicJSON(){},drainInbox:()=>[]};if(name==='./voice/asr-gate.cjs')return {AsrGate:Gate};if(name==='./voice/conversation.cjs')return {VoiceConversation:Voice};if(name==='./voice/runtime.cjs')return {createVoiceRuntime:options=>{const lease=options.backend==='windows'?null:options.acquireAsrLease?.(),speech={async close(){lease?.release();}};state.runtimes.push({options,speech});return {backend:options.backend||'local-neural',speech};},voiceCapabilities:async options=>{state.caps.push(options);const lease=options.backend==='windows'?null:options.acquireAsrLease?.();try{return {selectedBackend:options.backend};}finally{lease?.release();}}};return fromMain(name);}};
  vm.runInNewContext(source+`\nmodule.exports={startVoice,closeVoice,closeOwnedVoice,current:()=>voice,capabilities:${capsCallback},setup:(s,a)=>{bot=s;accounts=a;win={isDestroyed:()=>false,webContents:{send(){}}};},select:s=>{bot=s;},quit:()=>{quitting=true;}};`,context,{filename:main});
  const api=context.module.exports;api.setup(a,accounts);return {api,a,b,accounts,state,gate,options:{accountId:'a',panelId:'panel-a',backend:'local-neural',mode:'push-to-talk'}};
}
const changes={account:h=>{h.accounts.selectedId='b';h.api.select(h.b);},service:h=>h.api.select(h.b),generation:h=>h.a.generation++,scope:h=>{h.a.socialScope='changed-role-scope';},incoming:h=>h.a.incomingCount++,quitting:h=>h.api.quit()};
test('pending retirement rechecks account, service, role scope, generation and incoming input before microphone creation',async t=>{
  for(const [name,change]of Object.entries(changes))await t.test(name,async()=>{const h=harness();await h.api.startVoice(h.options);const old=h.api.current();old.closeGate=defer();const pending=h.api.startVoice({...h.options,panelId:'panel-next'});await tick();change(h);old.closeGate.resolve();await assert.rejects(pending,/cancelled|changed/);assert.equal(h.state.runtimes.length,1);assert.equal(old.starts,1);await h.api.closeVoice();});
});
test('cleanup retry await rechecks account, service, role scope, generation and incoming input before microphone creation',async t=>{
  for(const [name,change]of Object.entries(changes))await t.test(name,async()=>{const h=harness();h.state.cleanup=defer();const pending=h.api.startVoice(h.options);await tick();assert.equal(h.state.retryCalls,1);change(h);h.state.cleanup.resolve();await assert.rejects(pending,/cancelled|changed/);assert.equal(h.state.runtimes.length,0);assert.equal(h.state.voices.length,0);await h.api.closeVoice();});
});
test('closing the pending panel during cleanup prevents any new microphone provider',async()=>{
  const h=harness();h.state.cleanup=defer();const pending=h.api.startVoice(h.options);await tick();await h.api.closeOwnedVoice({accountId:'a',panelId:'panel-a'});h.state.cleanup.resolve();await assert.rejects(pending,/cancelled|changed/);assert.equal(h.state.runtimes.length,0);
});
test('an active QQ ASR owner cannot be evicted by main start; explicit Windows fallback still works',async()=>{
  const h=harness(),qq=h.gate.acquire({scopeId:'synthetic-qq',jobId:'record'});await assert.rejects(h.api.startVoice(h.options),{code:'busy'});qq.assertCurrent();assert.equal(h.state.voices.length,0);
  await h.api.startVoice({...h.options,backend:'windows'});assert.equal(h.state.voices[0].starts,1);qq.assertCurrent();await h.api.closeVoice();qq.release();
});
test('a previously failed close is retried before acquiring a microphone lease',async()=>{
  const h=harness(),old=h.gate.acquire({scopeId:'old-probe',jobId:'old'});let closed=0;old.retainRecovery(()=>{closed++;old.release();});await h.api.startVoice(h.options);assert.equal(closed,1);assert.equal(h.state.voices[0].starts,1);await h.api.closeVoice();const other=h.gate.acquire({scopeId:'qq',jobId:'new'});other.release();
});
test('actual capability IPC callback rechecks selection after cleanup and never probes a stale account',async t=>{
  const changes={account:h=>{h.accounts.selectedId='b';h.api.select(h.b);},service:h=>h.api.select(h.b),generation:h=>h.a.generation++,character:h=>{h.a.socialStore.config=()=>({characterId:'deepseek-whale'});},quitting:h=>h.api.quit()};
  for(const [name,mutate]of Object.entries(changes))await t.test(name,async()=>{const h=harness();h.state.cleanup=defer();const pending=h.api.capabilities({accountId:'a',panelId:'caps',backend:'local-neural'});await tick();mutate(h);h.state.cleanup.resolve();await assert.rejects(pending,/selection changed/);assert.equal(h.state.caps.length,0);assert.equal(h.state.voices.length,0);});
});
test('capability IPC owns and releases a temporary lease without opening a microphone',async()=>{
  const h=harness();const result=await h.api.capabilities({accountId:'a',panelId:'caps',backend:'local-neural'});assert.equal(result.selectedBackend,'local-neural');assert.equal(h.state.caps.length,1);assert.equal(h.state.voices.length,0);const qq=h.gate.acquire({scopeId:'qq',jobId:'next'});qq.release();
});
