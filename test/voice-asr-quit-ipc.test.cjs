'use strict';
// Executes production shutdown and the real ASR gate in an inert VM.
// No Electron window, process, microphone, provider or account connection runs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main),{AsrGate}=fromMain('./voice/asr-gate.cjs');
const defer=()=>{let resolve;return {promise:new Promise(value=>resolve=value),resolve};},tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(remote=null){
 if(remote&&!remote.observe)remote.observe=()=>{};
 const state={events:[],sent:[],quitCalls:0,shows:0,focuses:0,accountBarrier:null,accountError:null,gateResult:null,gateCloseCalls:0,retryCalls:0};let gate;
 class Gate extends AsrGate{constructor(){super();gate=this;}async retryCleanup(){state.events.push('gate-retry');state.retryCalls++;return super.retryCleanup();}async close(){state.events.push('gate-close');state.gateCloseCalls++;if(state.gateResult)return state.gateResult;return super.close();}}
 const handlers=new Map(),app={requestSingleInstanceLock:()=>false,quit(){state.quitCalls++;state.events.push('app-quit');},on(name,callback){handlers.set(name,callback);}};
 class Panel{observe(){}async close(){state.events.push('panel-close');}}
 class Renderer{get busy(){return false;}async cancel(){state.events.push('media-cancel');return {cancelled:true};}}
 const bot={config:{mode:'api',channel:'qq'},status:'connected',generation:1,incomingCount:0,socialScope:'synthetic-scope',snapshot:()=>({social:{active:false,config:{enabled:false}}})};
 const accounts={selectedId:'a',snapshot:()=>({selectedId:'a',accounts:[]}),async close(){state.events.push('accounts-close-start');await state.accountBarrier?.promise;state.events.push('accounts-close-finished');if(state.accountError)throw state.accountError;}};
 const win={isDestroyed:()=>false,show(){state.shows++;},focus(){state.focuses++;},webContents:{send(_channel,value){state.sent.push(JSON.parse(JSON.stringify(value)));}}};
 const console={snapshot:()=>({}),async close(){state.events.push('console-close');}},components={snapshot:()=>({}),async close(){state.events.push('components-close');return {closed:true};}},workbench={snapshot:()=>({}),reconcile:value=>value,async close(){state.events.push('workbench-close');}};
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},setInterval,clearInterval,AbortController,
  require:name=>{if(name==='electron')return {app};if(name==='./core/files.cjs')return {readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]};if(name==='./core/integration.cjs')return {installed:()=>false};if(name==='./voice/asr-gate.cjs')return {AsrGate:Gate};if(name==='./voice/qq-render.cjs')return {QQVoiceRenderer:Renderer};if(name==='./bot/qq-owner-remark-panel.cjs')return {QQOwnerRemarkPanel:Panel};if(name==='./bot/qq-friend-requests-panel.cjs')return {QQFriendRequestsPanel:Panel};if(name==='./bot/qq-first-setup-panel.cjs')return {QQFirstSetupPanel:Panel};return fromMain(name);}};
 vm.runInNewContext(source+`\nmodule.exports={setup:(b,a,w,c,p,k,r)=>{bot=b;accounts=a;win=w;qqConsole=c;qqComponents=p;workbench=k;remotePanel=r;},setTransfer:(p,j,l=null)=>{transferPanel=p;transferJobs=j;transferLocal=l;},pending:()=>shutdownTask,flags:()=>({quitting,cleanedUp,problem}),setLanguage:l=>config.language=l};`,context,{filename:main});
 const api=context.module.exports;api.setup(bot,accounts,win,console,components,workbench,remote);state.quitCalls=0;state.events=[];
 const quit=()=>{let prevented=0;handlers.get('before-quit')({preventDefault(){prevented++;}});return {prevented};};
 return {api,state,gate,quit,components};
}
function warm(f){
 const state={closeCalls:0,barrier:null,fail:false,markClosed:true};
 const resource={closed:false,busy:false,async close(){state.closeCalls++;f.state.events.push('host-close-start');await state.barrier?.promise;if(state.fail)throw Error('PRIVATE_PROCESS_PATH');if(state.markClosed)this.closed=true;f.state.events.push('host-close-finished');return {closed:true};}};
 const lease=f.gate.acquire({scopeId:'warm-qq',jobId:'old',reuseKey:'opaque'});lease.attachResource(resource);lease.park({reuseKey:'opaque',resource,closeIdle:()=>resource.close()});return {state,resource,lease};
}
test('before-quit waits for all settled app cleanup then confirmed ASR exit before app.quit',async()=>{
 const f=fixture(),idle=warm(f);f.state.accountBarrier=defer();idle.state.barrier=defer();assert.equal(f.quit().prevented,1);await tick();assert.equal(f.state.gateCloseCalls,0);assert.equal(f.state.retryCalls,0);assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);
 f.state.accountBarrier.resolve();await tick();assert.equal(f.state.gateCloseCalls,1);assert.equal(idle.state.closeCalls,1);assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);idle.state.barrier.resolve();await f.api.pending();assert.equal(idle.resource.closed,true);assert.equal(f.state.quitCalls,1);assert.equal(f.api.flags().cleanedUp,true);assert(f.state.events.indexOf('accounts-close-finished')<f.state.events.indexOf('gate-retry'));assert(f.state.events.indexOf('host-close-finished')<f.state.events.indexOf('app-quit'));assert.equal(f.quit().prevented,0);
});
test('failed exact idle close retains its proof, shows a fixed problem and allows a second Quit',async()=>{
 const f=fixture(),idle=warm(f);idle.state.fail=true;assert.equal(f.quit().prevented,1);await f.api.pending();assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);assert.equal(f.api.flags().quitting,false);assert.match(f.api.flags().problem,/exit is unconfirmed/);assert.doesNotMatch(f.api.flags().problem,/PRIVATE/);assert.equal(f.state.shows,1);assert.equal(f.state.focuses,1);assert(f.state.sent.some(value=>value.problem.includes('exit is unconfirmed')));assert.equal(idle.resource.closed,false);assert.equal(f.api.pending(),null);
 idle.state.fail=false;assert.equal(f.quit().prevented,1);await f.api.pending();assert.equal(f.state.quitCalls,1);assert.equal(f.api.flags().cleanedUp,true);assert.equal(idle.resource.closed,true);assert.equal(idle.state.closeCalls,2);
});
test('an unconfirmed closed property cannot be replaced by a successful callback receipt',async()=>{
 const f=fixture(),idle=warm(f);idle.state.markClosed=false;f.api.setLanguage('zh');f.quit();await f.api.pending();assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);assert.match(f.api.flags().problem,/无法确认本机语音进程已退出/);idle.state.markClosed=true;f.quit();await f.api.pending();assert.equal(f.state.quitCalls,1);
});
test('concurrent Quit events share one cleanup instead of evicting or closing the same host twice',async()=>{
 const f=fixture(),idle=warm(f);idle.state.barrier=defer();assert.equal(f.quit().prevented,1);await tick();const first=f.api.pending();assert.equal(f.quit().prevented,1);assert.equal(f.api.pending(),first);assert.equal(idle.state.closeCalls,1);assert.equal(f.state.gateCloseCalls,1);idle.state.barrier.resolve();await first;assert.equal(f.state.quitCalls,1);assert.equal(idle.state.closeCalls,1);
});
test('failed allSettled participant does not skip subsequent ASR ownership checks',async()=>{
 const f=fixture(),idle=warm(f);f.state.accountError=Error('PRIVATE_ACCOUNT_ERROR');idle.state.barrier=defer();f.quit();await tick();assert.equal(idle.state.closeCalls,1);assert.equal(f.state.quitCalls,0);idle.state.barrier.resolve();await f.api.pending();assert.equal(f.state.quitCalls,1);assert.equal(idle.resource.closed,true);
});
test('active ASR recovery must finish and release before shutdown is accepted',async()=>{
 const f=fixture(),active=f.gate.acquire({scopeId:'active',jobId:'failed-job'}),done=defer();let closed=0;active.retainRecovery(async()=>{await done.promise;closed++;active.release();});f.quit();await tick();assert.equal(f.state.gateCloseCalls,0);assert.equal(f.state.quitCalls,0);done.resolve();await f.api.pending();assert.equal(closed,1);assert.equal(f.state.gateCloseCalls,1);assert.equal(f.state.quitCalls,1);
});
test('active inference without verified cleanup remains owned and the app stays available for retry',async()=>{
 const f=fixture(),active=f.gate.acquire({scopeId:'active',jobId:'running'});f.quit();await f.api.pending();assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);active.assertCurrent();active.release();f.quit();await f.api.pending();assert.equal(f.state.quitCalls,1);
});
test('a malformed gate close result prevents app.quit even when no idle host is present',async()=>{
 const f=fixture();f.state.gateResult={closed:false};f.quit();await f.api.pending();assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);assert.equal(f.api.flags().quitting,false);f.state.gateResult=null;f.quit();await f.api.pending();assert.equal(f.state.quitCalls,1);
});

test('remote helper exit failure survives allSettled, permits retry and still cleans ASR',async()=>{
 let calls=0;const remote={async close(){if(++calls===1)throw Object.assign(Error('PRIVATE_AUTH_PATH'),{code:'passkey_unavailable'});return {closed:true};}},f=fixture(remote),idle=warm(f);
 f.api.setLanguage('zh');f.quit();await f.api.pending();assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);assert.equal(f.api.flags().quitting,false);
 assert.match(f.api.flags().problem,/通行密钥验证助手/);assert.doesNotMatch(f.api.flags().problem,/PRIVATE/);assert.equal(idle.resource.closed,true);
 f.quit();await f.api.pending();assert.equal(calls,2);assert.equal(f.state.quitCalls,1);assert.equal(f.api.flags().cleanedUp,true);
});

test('quit waits for its existing remote helper close and rejects a malformed receipt',async()=>{
 const gate=defer();let calls=0,valid=false;const f=fixture({async close(){calls++;await gate.promise;return {closed:valid};}});
 f.quit();await tick();assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);f.quit();assert.equal(calls,1);
 gate.resolve();await f.api.pending();assert.equal(f.state.quitCalls,0);assert.match(f.api.flags().problem,/Remote management cleanup is unconfirmed/);
 valid=true;f.quit();await f.api.pending();assert.equal(calls,2);assert.equal(f.state.quitCalls,1);
});

test('an initialized remote owner cannot report a falsy exit receipt as success',async()=>{
 for(const receipt of [undefined,null,false]){const f=fixture({async close(){return receipt;}});f.quit();await f.api.pending();assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);assert.match(f.api.flags().problem,/Remote management cleanup is unconfirmed/);}
});

test('transfer cleanup must confirm exit before its journal closes, while parent cleanup still runs',async()=>{
 for(const receipt of [undefined,null,false,{closed:false}]){
  let parentCalls=0,transferCalls=0,journalCalls=0,valid=false;
  const f=fixture({async close(){parentCalls++;return {closed:true};}});
  f.api.setTransfer({observe(){},async close(){transferCalls++;return valid?{closed:true}:receipt;}},{async settleRetirementCleanup(){return {closed:true};},close(){journalCalls++;return {closed:true};}});
  f.quit();await f.api.pending();assert.equal(parentCalls,1);assert.equal(transferCalls,1);assert.equal(journalCalls,0);assert.equal(f.state.quitCalls,0);assert.match(f.api.flags().problem,/Remote management cleanup is unconfirmed/);
  valid=true;f.quit();await f.api.pending();assert.equal(parentCalls,2);assert.equal(transferCalls,2);assert.equal(journalCalls,1);assert.equal(f.state.quitCalls,1);
 }
});

test('synchronous transfer close failure does not skip parent cleanup or close the journal',async()=>{
 let parentCalls=0,journalCalls=0;const f=fixture({async close(){parentCalls++;return {closed:true};}});
 f.api.setTransfer({observe(){},close(){throw Object.assign(Error('PRIVATE_TRANSFER_PATH'),{code:'file_cleanup_unconfirmed'});}},{async settleRetirementCleanup(){return {closed:true};},close(){journalCalls++;return {closed:true};}});
 f.quit();await f.api.pending();assert.equal(parentCalls,1);assert.equal(journalCalls,0);assert.equal(f.state.quitCalls,0);assert.match(f.api.flags().problem,/remote file operation or its local temporary files/);assert.doesNotMatch(f.api.flags().problem,/PRIVATE/);
});

test('local records cleanup blocks Quit until its exact owner settles, without skipping remote or voice cleanup',async()=>{
 const barrier=defer();let localCalls=0,parentCalls=0,journalCalls=0,valid=false;
 const f=fixture({async close(){parentCalls++;return {closed:true};}}),idle=warm(f);
 f.api.setTransfer({observe(){},async close(){return {closed:true};}},
  {async settleRetirementCleanup(){return {closed:true};},close(){journalCalls++;return {closed:true};}},
  {observe(){},async close(){localCalls++;await barrier.promise;return valid?{closed:true}:{closed:false};}});
 f.quit();await tick();assert.equal(localCalls,1);assert.equal(parentCalls,1);assert.equal(journalCalls,0);assert.equal(f.state.quitCalls,0);
 barrier.resolve();await f.api.pending();assert.equal(journalCalls,0);assert.equal(f.state.quitCalls,0);assert.equal(idle.resource.closed,true);
 valid=true;f.quit();await f.api.pending();assert.equal(localCalls,2);assert.equal(journalCalls,1);assert.equal(f.state.quitCalls,1);
});

test('retained retirement gate and actual journal close each require a positive receipt before Quit',async()=>{
 for(const broken of ['gate','journal']){
  let valid=false,journalCalls=0;const f=fixture();
  f.api.setTransfer({observe(){},async close(){return {closed:true};}},
   {async settleRetirementCleanup(){return {closed:valid||broken!=='gate'};},close(){journalCalls++;return {closed:valid||broken!=='journal'};}});
  f.quit();await f.api.pending();assert.equal(f.state.quitCalls,0);assert.equal(journalCalls,broken==='gate'?0:1);
  valid=true;f.quit();await f.api.pending();assert.equal(f.state.quitCalls,1);
 }
});

test('remote file retirement stays retryable and identifies the file operation in both languages',async()=>{
 for(const lang of ['zh','en']){
  let calls=0;const remote={async close(){if(++calls===1)throw Object.assign(Error('PRIVATE_DOWNLOAD_PATH'),{code:'file_cleanup_unconfirmed'});return {closed:true};}},f=fixture(remote),idle=warm(f);
  f.api.setLanguage(lang);f.quit();await f.api.pending();assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);assert.equal(f.api.flags().quitting,false);assert.equal(idle.resource.closed,true);
  assert.match(f.api.flags().problem,lang==='zh'?/远程文件操作或本机临时文件/:/remote file operation or its local temporary files/);assert.doesNotMatch(f.api.flags().problem,/PRIVATE|Passkey|通行密钥/);
  f.quit();await f.api.pending();assert.equal(calls,2);assert.equal(f.state.quitCalls,1);assert.equal(f.api.flags().cleanedUp,true);
 }
});

test('an unknown remote cleanup error does not falsely attribute failure to credentials or voice',async()=>{
 const f=fixture({async close(){throw Object.assign(Error('PRIVATE_FAILURE'),{code:'unrecognized_provider_code'});}});f.api.setLanguage('zh');f.quit();await f.api.pending();assert.equal(f.state.quitCalls,0);assert.match(f.api.flags().problem,/远程管理的清理尚未确认/);assert.doesNotMatch(f.api.flags().problem,/PRIVATE|通行密钥|语音/);
});

test('component cleanup failure keeps the app alive for retry without discarding ASR cleanup',async()=>{
 for(const lang of ['zh','en']){
  const f=fixture(),idle=warm(f);let calls=0;
  f.components.close=async()=>{if(++calls===1)throw Object.assign(Error('PRIVATE_COMPONENT_PATH'),{code:'node_repair_cleanup_unconfirmed'});return {closed:true};};
  f.api.setLanguage(lang);f.quit();await f.api.pending();
  assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);assert.equal(idle.resource.closed,true);
  assert.match(f.api.flags().problem,lang==='zh'?/QQ 组件操作的清理/:/QQ component operation cleanup/);assert.doesNotMatch(f.api.flags().problem,/PRIVATE/);
  f.quit();await f.api.pending();assert.equal(calls,2);assert.equal(f.state.quitCalls,1);
 }
});

test('component cleanup waits for its exact owner and requires a positive close receipt',async()=>{
 for(const receipt of [undefined,null,{},false,{closed:false}]){
  const f=fixture(),barrier=defer();let valid=false,calls=0;
  f.components.close=async()=>{calls++;await barrier.promise;return valid?{closed:true}:receipt;};
  f.quit();await tick();assert.equal(f.state.quitCalls,0);f.quit();assert.equal(calls,1);
  barrier.resolve();await f.api.pending();assert.equal(f.state.quitCalls,0);assert.equal(f.api.flags().cleanedUp,false);
  valid=true;f.quit();await f.api.pending();assert.equal(calls,2);assert.equal(f.state.quitCalls,1);
 }
});
