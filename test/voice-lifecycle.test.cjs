'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const mainFile=path.resolve(__dirname,'../src/main.cjs');
const source=fs.readFileSync(mainFile,'utf8');
const fromMain=createRequire(mainFile);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function mainHarness(){
  const instances=[],runtimes=[],probes=[],probePlan={closeFailures:0};
  class Voice {
    constructor(options){this.options=options;this.scope=options.scope;this.state={status:'idle',scope:this.scope,mode:'push-to-talk'};this.closes=0;this.interrupts=0;this.events=[];instances.push(this);}
    snapshot(){return {...this.state};}
    async startListening(options){this.starts=(this.starts||0)+1;this.started=options;this.state.status='listening';return this.snapshot();}
    finishListening(){this.finishes=(this.finishes||0)+1;this.state.status='recognizing';return this.snapshot();}
    confirmTranscript(){this.confirms=(this.confirms||0)+1;return this.snapshot();}
    async close(reason){this.closes++;this.closed=true;this.state.status='closed';this.state.reason=reason;await this.closeGate?.promise;this.record('session-closed',{reason});}
    async interrupt(reason){this.interrupts++;this.state.status='idle';this.state.reason=reason;this.options.onChange();return this.snapshot();}
    record(event,extra){this.events.push({event,...extra});}
    diagnostics(){return {scope:this.scope,mode:this.state.mode,events:structuredClone(this.events),speech:{events:[],audioLevels:[]}};}
  }
  const sent=[];
  const service=id=>({config:{mode:'claude',channel:'qq'},status:'connected',generation:1,incomingCount:0,socialScope:`${id}-scope`,
    socialStore:{config:()=>({characterId:id})},socialController(){return {};},socialReply(){return '';},snapshot(){return {social:{active:true,config:{enabled:false}},incomingCount:this.incomingCount};}});
  const a=service('a'),b=service('b'),accounts={selectedId:'a',snapshot(){return {selectedId:this.selectedId};}};
  const context={__dirname:path.dirname(mainFile),module:{exports:{}},process:{argv:[],env:{}},setInterval,clearInterval,
    require:id=>{
      if(id==='electron')return {app:{requestSingleInstanceLock:()=>false,quit(){},on(){}}};
      if(id==='./core/files.cjs')return {readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]};
      if(id==='./voice/conversation.cjs')return {VoiceConversation:Voice};
      if(id==='./voice/runtime.cjs')return {createVoiceRuntime(options){const backend=options.backend||'windows',speech={backend};runtimes.push({options,backend,speech});return {backend,speech};},voiceCapabilities:async options=>{const probe={failures:probePlan.closeFailures,closes:0,async close(){this.closes++;if(this.failures-->0)throw Error('synthetic probe exit unconfirmed');}};probes.push(probe);try{await probePlan.gate?.promise;return {selectedBackend:'windows'};}finally{await options.closeRuntime(probe);}}};
      return fromMain(id);
    }};
  vm.runInNewContext(source+`\nmodule.exports={checkVoiceCapabilities,startVoice,finishVoice,confirmVoice,closeOwnedVoice,interruptVoice,closeVoice,publish,getVoiceEvidence,voiceSnapshot,receiptCount:()=>voiceReceipts.size,
    setup:(a,m,w)=>{bot=a;accounts=m;win=w;},select:a=>{bot=a;},current:()=>voice};`,context,{filename:mainFile});
  const api=context.module.exports;
  api.setup(a,accounts,{isDestroyed:()=>false,webContents:{send:(_channel,state)=>sent.push(state)}});
  return {api,a,b,accounts,instances,runtimes,probes,probePlan,sent,bind:(accountId='a',panelId='panel-a')=>({accountId,panelId}),
    start:(accountId='a',panelId='panel-a')=>api.startVoice({accountId,panelId,mode:'push-to-talk'})};
}

test('successive recordings in the same account panel reuse the resident voice runtime',async()=>{
  const h=mainHarness(),options={...h.bind(),backend:'windows',mode:'push-to-talk'};
  await h.api.startVoice(options);const first=h.api.current();
  first.state.status='idle'; // Previous manual recording/reply ended normally.
  await h.api.startVoice({...options,locale:'zh-CN'});
  assert.equal(h.api.current(),first);assert.equal(h.instances.length,1);assert.equal(h.runtimes.length,1);
  assert.equal(first.closes,0);assert.equal(first.starts,2);assert.equal(first.started.locale,'zh-CN');
  assert.equal(first.started.backend,undefined,'runtime selection must not leak into provider listening options');
  await h.api.closeOwnedVoice(h.bind());assert.equal(first.closes,1);
});

test('switching backend in the same panel closes the resident runtime and creates the explicit replacement',async()=>{
  const h=mainHarness(),binding=h.bind();
  await h.api.startVoice({...binding,backend:'windows',mode:'push-to-talk'});const first=h.api.current();first.state.status='idle';
  await h.api.startVoice({...binding,backend:'local-neural',mode:'push-to-talk'});const next=h.api.current();
  assert.notEqual(next,first);assert.equal(first.closes,1);assert.equal(next.closes,0);
  assert.equal(h.instances.length,2);assert.deepEqual(h.runtimes.map(runtime=>runtime.backend),['windows','local-neural']);
  assert.equal(next.options.speech,h.runtimes[1].speech);assert.equal(next.starts,1);
  await h.api.closeOwnedVoice(binding);assert.equal(next.closes,1);
});

test('QQ input interrupts TTS after the local model turn has ended, exactly once',async()=>{
  const h=mainHarness();await h.start();const voice=h.api.current();voice.state.status='speaking';
  h.b.incomingCount++;h.api.publish();assert.equal(voice.interrupts,0,'another account must not stop playback');
  h.a.incomingCount++;h.api.publish();await tick();
  assert.equal(voice.interrupts,1);assert.equal(voice.state.status,'idle');
  assert.equal(voice.state.reason,'qq-message');
  assert.equal(voice.events[0].event,'channel-interruption');
  h.api.publish();assert.equal(voice.interrupts,1,'state updates must not repeatedly interrupt');
});

test('closed diagnostics survive microphone shutdown without retaining conversation text',async()=>{
  const h=mainHarness();await h.start();const voice=h.api.current();
  voice.state.transcript='private words';voice.state.reply='private reply';
  await h.api.closeVoice('window-hidden');
  const summary=h.api.voiceSnapshot(),receipt=h.api.getVoiceEvidence(h.bind());
  assert.equal(summary.reason,'window-hidden');assert.equal(summary.diagnosticsAvailable,true);
  assert.equal(receipt.sessionState,'ended');assert.equal(receipt.reason,'window-hidden');assert.equal(receipt.recordingRetained,false);
  assert.ok(receipt.events.some(event=>event.event==='session-closed'));
  assert.equal(JSON.stringify({summary,receipt}).includes('private'),false);
});

test('ended receipts require selected account, original panel and unchanged companion scope',async()=>{
  const h=mainHarness();await h.start();await h.api.closeVoice();
  assert.throws(()=>h.api.getVoiceEvidence(h.bind('a','different-panel')),/belongs/);
  h.accounts.selectedId='b';h.api.select(h.b);
  assert.equal(h.api.voiceSnapshot(),null);assert.throws(()=>h.api.getVoiceEvidence(h.bind()),/owns/);
  h.accounts.selectedId='a';h.api.select(h.a);h.a.socialScope='changed';
  assert.equal(h.api.voiceSnapshot(),null);assert.throws(()=>h.api.getVoiceEvidence(h.bind()),/belongs/);
});

test('late close cannot replace a newer receipt and archives remain bounded',async()=>{
  const h=mainHarness();await h.start();const old=h.api.current();old.closeGate=deferred();
  const closing=h.api.closeVoice('window-hidden');await tick();
  const next=h.start('a','next-panel');await tick();assert.equal(h.instances.length,1);old.closeGate.resolve();await Promise.all([closing,next]);await h.api.closeVoice('manual-close');
  assert.equal(h.api.getVoiceEvidence(h.bind('a','next-panel')).reason,'manual-close');
  assert.throws(()=>h.api.getVoiceEvidence(h.bind()),/belongs/);
  for(let i=0;i<8;i++){h.accounts.selectedId=`account-${i}`;await h.start(`account-${i}`,`panel-${i}`);await h.api.closeVoice();}
  assert.equal(h.api.receiptCount(),6);
});

test('a destroyed old account panel cannot close or interrupt the new account voice',async()=>{
  const h=mainHarness();await h.start();const old=h.api.current();
  h.accounts.selectedId='b';h.api.select(h.b);await h.start('b','panel-b');const current=h.api.current();
  assert.equal(old.closes,1);
  await h.api.closeOwnedVoice(h.bind());await h.api.interruptVoice(h.bind());
  h.api.finishVoice(h.bind());assert.equal(current.finishes,undefined);
  assert.throws(()=>h.api.confirmVoice({...h.bind(),draftId:'old',text:'old'}),/owns/);assert.equal(current.confirms,undefined);
  assert.equal(h.api.current(),current);assert.equal(current.closes,0);assert.equal(current.interrupts,0);
  await h.api.closeOwnedVoice(h.bind('b','panel-b'));assert.equal(current.closes,1);assert.equal(h.api.current(),null);
});

test('a replaced panel on the same account cannot close its successor',async()=>{
  const h=mainHarness();await h.start();await h.start('a','replacement-panel');const current=h.api.current();
  await h.api.closeOwnedVoice(h.bind());assert.equal(h.api.current(),current);assert.equal(current.closes,0);
  await assert.rejects(h.api.closeOwnedVoice(),/current voice conversation/);
});

test('closing a panel cancels its pending start while an earlier host is shutting down',async()=>{
  const h=mainHarness();await h.start();const old=h.api.current();old.closeGate=deferred();
  const start=h.start('a','next-panel');await tick();
  const closing=h.api.closeOwnedVoice(h.bind('a','next-panel'));await tick();old.closeGate.resolve();await closing;
  await assert.rejects(start,/startup was cancelled/);assert.equal(h.instances.length,1);assert.equal(h.api.current(),null);
});

test('late completion of an older start cannot replace a new account voice',async()=>{
  const h=mainHarness();await h.start();const old=h.api.current();old.closeGate=deferred();
  const stale=h.start('a','waiting-panel');await tick();
  h.accounts.selectedId='b';h.api.select(h.b);const next=h.start('b','panel-b');await tick();assert.equal(h.instances.length,1);old.closeGate.resolve();await next;const current=h.api.current();
  await assert.rejects(stale,/startup was cancelled/);
  assert.equal(h.api.current(),current);assert.equal(current.closes,0);
});

test('account change and disconnected service close microphone and playback',async()=>{
  const h=mainHarness();await h.start();const first=h.api.current();
  h.accounts.selectedId='b';h.api.select(h.b);h.api.publish();await tick();
  assert.equal(first.closes,1);assert.equal(h.api.current(),null);
  await h.start('b','panel-b');const second=h.api.current();h.b.status='disconnecting';h.api.publish();await tick();
  assert.equal(second.closes,1);assert.equal(h.api.current(),null);
});

test('host binds every panel action and destroys the microphone panel when leaving chat',async()=>{
  const calls=[],panels=[];let counter=0;
  const nodes=[],document={body:{dataset:{view:'bot'}},querySelector:()=>({prepend(){},append(){}})};
  const window={arcade:Object.fromEntries(['voiceStart','voiceFinish','voiceConfirm','voiceClose','voiceInterrupt','voiceEvidence','voiceCapabilities'].map(name=>[name,async value=>{calls.push({name,value});return {status:'idle'};}])),
    ArcadeVoice:{createPanel({api}){const panel={api,element:{append(){},querySelector:()=>({append(){},after(){}}),scrollIntoView(){} },render(state){this.state=state;},destroy(reason){this.destroyed=true;void api.voiceClose(reason);}};panels.push(panel);return panel;}}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/ui/voice-host.js'),'utf8'),{
    window,document,crypto:{randomUUID:()=>`panel-${++counter}`},$:()=>({append(){}}),el:(_tag,className)=>{const node={className,setAttribute(){},remove(){},focus(){}};nodes.push(node);return node;},action:fn=>fn(),
  });
  const state=id=>({accounts:{selectedId:id},config:{language:'zh'},bot:{social:{active:true}}});
  window.renderVoice(state('a'));nodes.findLast(n=>n.className==='secondary voice-entry').onclick();await panels[0].api.voiceStart({mode:'push-to-talk'});
  window.renderVoice(state('b'));nodes.findLast(n=>n.className==='secondary voice-entry').onclick();await panels[1].api.voiceStart({mode:'push-to-talk'});
  await panels[1].api.voiceFinish();assert.equal(calls.find(call=>call.name==='voiceFinish').value.panelId,'panel-2');
  await panels[1].api.voiceConfirm({draftId:'draft',text:'corrected'});const confirmed=calls.find(call=>call.name==='voiceConfirm');assert.equal(confirmed.value.panelId,'panel-2');assert.equal(confirmed.value.text,'corrected');
  await assert.rejects(panels[0].api.voiceInterrupt(),/Voice is closing/);
  assert.equal(calls.filter(call=>call.name==='voiceInterrupt').length,0,'A retired panel must not dispatch an interrupt to its successor.');
  const oldClose=calls.find(call=>call.name==='voiceClose');assert.equal(oldClose.value.accountId,'a');assert.equal(oldClose.value.panelId,'panel-1');
  const starts=calls.filter(call=>call.name==='voiceStart');assert.equal(starts[1].value.accountId,'b');assert.equal(starts[1].value.panelId,'panel-2');
  window.renderVoice({...state('b'),voice:{accountId:'a',panelId:'panel-1',status:'speaking'}});assert.equal(panels[1].state.status,'idle');
  document.body.dataset.view='work';window.renderVoice(state('b'));assert.equal(panels[1].destroyed,true);
  assert.equal(calls.filter(call=>call.name==='voiceClose').at(-1).value.accountId,'b');
  document.body.dataset.view='bot';
  window.renderVoice({...state('b'),bot:{social:{active:false}},voice:{status:'closed',accountId:'b',panelId:'panel-2',diagnosticsAvailable:true,reason:'window-hidden'}});
  nodes.findLast(n=>n.className==='secondary voice-entry').onclick();
  assert.equal(panels[2].state.reason,'window-hidden');assert.equal(panels[2].state.canStart,false);
  await panels[2].api.voiceEvidence();await panels[2].api.voiceStart({});
  assert.equal(calls.findLast(call=>call.name==='voiceEvidence').value.panelId,'panel-2');
  assert.equal(calls.findLast(call=>call.name==='voiceStart').value.panelId,'panel-3','old receipt must not reuse stale controls');
  window.renderVoice({...state('b'),voice:{accountId:'b',panelId:'panel-2',status:'error',diagnosticsAvailable:true}});await panels[2].api.voiceEvidence();assert.equal(calls.findLast(call=>call.name==='voiceEvidence').value.panelId,'panel-2','unfinished former diagnostics retain their own export binding');assert.equal(panels[2].state.status,'idle','old failed state is not presented as a new active recording');
});

test('two close calls for one pending session share its completion, not an early closed snapshot',async()=>{
  const h=mainHarness();await h.start();const first=h.api.current();first.closeGate=deferred();
  let completed=0;const one=h.api.closeOwnedVoice(h.bind()).then(value=>{completed++;return value;});await tick();
  const two=h.api.closeOwnedVoice(h.bind()).then(value=>{completed++;return value;});await tick();
  assert.equal(completed,0);assert.equal(first.closes,1);assert.equal(h.api.voiceSnapshot().status,'closing');
  assert.equal(h.api.getVoiceEvidence(h.bind()).sessionState,'closing');assert.equal(h.api.getVoiceEvidence(h.bind()).closeConfirmed,false);
  first.closeGate.resolve();const results=await Promise.all([one,two]);
  assert.equal(completed,2);for(const result of results){assert.equal(result.closeConfirmed,true);assert.equal(result.accountId,'a');assert.equal(result.panelId,'panel-a');}
  assert.equal(h.api.voiceSnapshot().status,'closed');
});

test('failed capability cleanup retains the original probe; repeated Check cannot create a replacement first',async()=>{
  const h=mainHarness();h.probePlan.closeFailures=2;
  await assert.rejects(h.api.checkVoiceCapabilities(h.bind()),/probe exit unconfirmed/);const probe=h.probes[0];assert.equal(probe.closes,1);
  await assert.rejects(h.api.checkVoiceCapabilities(h.bind()),/probe exit unconfirmed/);assert.equal(h.probes.length,1);assert.equal(probe.closes,2);
  const closed=await h.api.closeOwnedVoice(h.bind());assert.equal(closed.closeConfirmed,true);assert.equal(probe.closes,3);
  h.probePlan.closeFailures=0;await h.api.checkVoiceCapabilities(h.bind());assert.equal(h.probes.length,2);assert.equal(h.probes[1].closes,1);
});

test('a failed probe is retried before a microphone starts; late old-panel close does not stop the new microphone',async()=>{
  const h=mainHarness();h.probePlan.closeFailures=1;
  await assert.rejects(h.api.checkVoiceCapabilities(h.bind()),/probe exit unconfirmed/);await h.start('a','new-panel');
  assert.equal(h.probes[0].closes,2);const current=h.api.current();await h.api.closeOwnedVoice(h.bind());assert.equal(current.closes,0);await h.api.closeOwnedVoice(h.bind('a','new-panel'));
});

test('close waits for an in-flight capability request and its exact probe cleanup',async()=>{
 const h=mainHarness();h.probePlan.gate=deferred();const checking=h.api.checkVoiceCapabilities(h.bind());await tick();assert.equal(h.probes.length,1);
 let completed=false;const closing=h.api.closeOwnedVoice(h.bind()).then(value=>{completed=true;return value;});await tick();assert.equal(completed,false);assert.equal(h.probes[0].closes,0);
 h.probePlan.gate.resolve();await checking;assert.equal((await closing).closeConfirmed,true);assert.equal(h.probes[0].closes,1);
});

test('new microphone admission waits for a previous capability request, and cannot start a parallel probe',async()=>{
 const h=mainHarness();h.probePlan.gate=deferred();const checking=assert.rejects(h.api.checkVoiceCapabilities(h.bind()),/Voice selection changed/);await tick();
 const starting=h.start('a','new-panel');await tick();assert.equal(h.instances.length,0);assert.throws(()=>h.api.checkVoiceCapabilities(h.bind('a','new-panel')),/End the current voice/);
 h.probePlan.gate.resolve();await checking;await starting;assert.equal(h.probes[0].closes,1);assert.equal(h.instances.length,1);await h.api.closeOwnedVoice(h.bind('a','new-panel'));
});

test('failed close remains owned and retries the exact former session; later close cannot stop a successor',async()=>{
  const h=mainHarness();await h.start();const first=h.api.current(),ordinary=first.close.bind(first);let attempts=0;
  first.close=async reason=>{if(++attempts===1)throw Error('synthetic unconfirmed exit');return ordinary(reason);};
  await assert.rejects(h.api.closeOwnedVoice(h.bind()),/unconfirmed exit/);assert.equal(h.api.voiceSnapshot().status,'error');
  assert.equal(h.api.getVoiceEvidence(h.bind()).sessionState,'unconfirmed');assert.equal(h.api.getVoiceEvidence(h.bind()).closeConfirmed,false);
  assert.equal((await h.api.interruptVoice(h.bind())).status,'error');
  const retry=await h.api.closeOwnedVoice(h.bind());assert.equal(attempts,2);assert.equal(retry.closeConfirmed,true);
  await h.start('a','new-panel');const successor=h.api.current();await h.api.closeOwnedVoice(h.bind());
  assert.equal(h.api.current(),successor);assert.equal(successor.closes,0);assert.equal(attempts,2);
  await h.api.closeOwnedVoice(h.bind('a','new-panel'));
});

test('a new start waits for an old retirement and a later old-panel close leaves the successor intact',async()=>{
  const h=mainHarness();await h.start();const first=h.api.current();first.closeGate=deferred();
  const closing=h.api.closeOwnedVoice(h.bind());await tick();h.accounts.selectedId='b';h.api.select(h.b);
  const next=h.start('b','panel-b');await tick();assert.equal(h.instances.length,1);
  const again=h.api.closeOwnedVoice(h.bind());await tick();assert.equal(first.closes,1);
  first.closeGate.resolve();await Promise.all([closing,again,next]);const successor=h.api.current();assert.equal(h.instances.length,2);assert.equal(successor.closes,0);
  await h.api.closeOwnedVoice(h.bind());assert.equal(successor.closes,0);await h.api.closeOwnedVoice(h.bind('b','panel-b'));
});

test('closing a pending start prevents microphone creation after an earlier retirement settles',async()=>{
  const h=mainHarness();await h.start();const first=h.api.current();first.closeGate=deferred();
  const starting=h.start('a','new-panel');await tick();const stopped=h.api.closeOwnedVoice(h.bind('a','new-panel'));await tick();
  first.closeGate.resolve();await assert.rejects(starting,/startup was cancelled/);const result=await stopped;
  assert.equal(result.closeConfirmed,true);assert.equal(result.panelId,'new-panel');assert.equal(h.instances.length,1);assert.equal(h.api.current(),null);
});
