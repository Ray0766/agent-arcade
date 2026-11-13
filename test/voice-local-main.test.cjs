'use strict';
// Execute actual main functions and actual registered IPC. All account,
// provider and audio objects are inert; no network, model, mic or child host.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const mainFile=path.resolve(process.env.ARCADE_VOICE_MAIN_FILE||path.join(__dirname,'../src/main.cjs'));
const source=fs.readFileSync(process.env.ARCADE_VOICE_MAIN_SNAPSHOT||mainFile,'utf8'),fromMain=createRequire(mainFile);
const defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function harness(){
 const instances=[],runtimes=[],probes=[],calls=[],handlers=new Map(),sent=[];
 const plan={cleanup:null,probe:null,closeFailures:0};
 class Gate extends fromMain('./voice/asr-gate.cjs').AsrGate {async retryCleanup(){await plan.cleanup?.promise;return super.retryCleanup();}}
 class Voice {
  constructor(options){this.options=options;this.scope=options.scope;this.state={status:'idle',scope:this.scope,mode:'push-to-talk'};this.closes=0;this.interrupts=0;this.events=[];instances.push(this);}
  snapshot(){return {...this.state};}
  async startListening(options){this.starts=(this.starts||0)+1;this.started=options;this.state.status='listening';return this.snapshot();}
  finishListening(){this.finishes=(this.finishes||0)+1;return this.snapshot();}
  confirmTranscript(value){this.confirms=(this.confirms||0)+1;this.confirmed=value;return this.snapshot();}
  async close(reason){this.closes++;await this.closeGate?.promise;if(this.closeFailures-->0)throw Error('Synthetic close unconfirmed');this.closed=true;this.state.status='closed';this.state.reason=reason;this.record('session-closed',{reason});}
  async interrupt(reason){this.interrupts++;this.state.status='idle';this.state.reason=reason;this.options.onChange();return this.snapshot();}
  record(event,extra){this.events.push({event,...extra});}
  diagnostics(){return {scope:this.scope,mode:this.state.mode,events:structuredClone(this.events),speech:{events:[],audioLevels:[]}};}
 }
 const service=id=>{
  const s={config:{mode:'api',channel:'qq'},status:'disconnected',generation:1,incomingCount:0,socialScope:`${id}-qq-scope`,
   client:{ready:true,generation:1,socket:{},accountId:id,ownerId:'owner'},dispatcher:{},
   localActive:true,localGeneration:1,localCharacter:`${id}-character`,localSettings:'settings-1',
   socialStore:{config:()=>({characterId:`${id}-qq-character`,enabled:true})},
   socialController(){if(this.status!=='connected')throw Error('QQ disconnected');calls.push({kind:'social-controller',id});return this.dispatcher;},
   async socialReply(text,options){calls.push({kind:'channel',id,text,options});return {outcome:'reply_ended',text:'channel reply'};},
   localConversationContext(){if(!this.localActive)throw Error('App unavailable');return {kind:'local',dispatcher:this.localEngine,scope:`${id}-local-scope`,character:this.localCharacter,settings:this.localSettings,generation:this.localGeneration};},
   localSnapshot(){return {state:this.localActive?'active':'stopped',characterId:this.localCharacter,generation:this.localGeneration};},
   snapshot(){return {status:this.status,social:{active:this.status==='connected',config:{enabled:true}},local:this.localSnapshot(),incomingCount:this.incomingCount};}
  };
  s.localEngine={async respondLocally(text,options){calls.push({kind:'local',id,text,options});await s.replyGate?.promise;return {outcome:'reply_ended',text:'local reply'};}};
  return s;
 };
 const a=service('a'),b=service('b'),services=new Map([['a',a],['b',b]]);
 const accounts={selectedId:'a',services,get:id=>services.get(id),snapshot(){return {selectedId:this.selectedId,accounts:[]};}};
 const frame={url:require('node:url').pathToFileURL(path.join(path.dirname(mainFile),'ui/index.html')).href};
 const win={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,webContents:{mainFrame:frame,send:(_name,state)=>sent.push(state)}};
 const context={__dirname:path.dirname(mainFile),module:{exports:{}},process:{argv:[],env:{}},setInterval,clearInterval,AbortController,AbortSignal,
  require:id=>{
   if(id==='electron')return {app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}};
   if(id==='./core/files.cjs')return {readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]};
   if(id==='./voice/asr-gate.cjs')return {AsrGate:Gate};
   if(id==='./voice/conversation.cjs')return {VoiceConversation:Voice};
   if(id==='./voice/runtime.cjs')return {
    createVoiceRuntime(options){const backend=options.backend||'windows',speech={backend};runtimes.push({options,backend,speech});return {backend,speech};},
    async voiceCapabilities(options){const probe={closes:0,async close(){this.closes++;if(plan.closeFailures-->0)throw Error('Synthetic probe unconfirmed');}};probes.push({probe,options});try{await plan.probe?.promise;return {selectedBackend:'windows'};}finally{await options.closeRuntime(probe);}}
   };
   return fromMain(id);
  }};
 const names=['voiceStart','voiceCapabilities','voiceFinish','voiceConfirm','voiceInterrupt','voiceClose'];
 const registrations=names.map(name=>{const lines=source.split(/\r?\n/).filter(line=>line.trim().startsWith(`register('${name}',`));assert.equal(lines.length,1);return lines[0];}).join('\n');
 vm.runInNewContext(source+`\nmodule.exports={publish,voiceSnapshot,getVoiceEvidence,closeVoice,current:()=>voice,receiptCount:()=>voiceReceipts.size,
 setup:(s,m,w)=>{bot=s;accounts=m;win=w;},select:s=>{bot=s;},kind:k=>desktopConversations.choices.set(accounts.selectedId,{service:bot,kind:k}),
 registerAll:()=>{${registrations}}};`,context,{filename:mainFile});
 const api=context.module.exports;api.setup(a,accounts,win);api.kind('local');api.registerAll();
 const invoke=(name,value,{untrusted=false}={})=>handlers.get(`arcade:${name}`)({sender:untrusted?{}:win.webContents,senderFrame:frame},value);
 const binding=(s=a,panelId='voice-panel')=>({accountId:s===a?'a':'b',panelId,sourceKind:'local',localGeneration:s.localGeneration,localCharacterId:s.localCharacter});
 return {api,a,b,accounts,plan,instances,runtimes,probes,calls,sent,invoke,binding,
  start:(value=binding())=>invoke('voiceStart',{...value,backend:'windows',mode:'push-to-talk'}),
  select:s=>{accounts.selectedId=s===a?'a':'b';api.select(s);api.kind('local');}};
}

test('offline App voice uses its local persona and captured dispatcher through actual IPC',async()=>{
 const h=harness(),binding=h.binding();
 const caps=await h.invoke('voiceCapabilities',binding);assert.equal(caps.sourceKind,'local');assert.equal(caps.localGeneration,1);assert.equal(h.probes[0].options.characterId,h.a.localCharacter);assert.equal(h.probes[0].probe.closes,1);
 await assert.rejects(h.invoke('voiceStart',{...binding,mode:'push-to-talk'},{untrusted:true}),/Untrusted/);
 await h.start();const voice=h.api.current();assert.equal(voice.scope,'a:app:a-local-scope');assert.equal(h.runtimes[0].options.characterId,h.a.localCharacter);
 const result=await voice.options.respond('synthetic local words',{signal:new AbortController().signal,voice:true});assert.equal(result.text,'local reply');assert.equal(h.calls.filter(c=>c.kind==='local').length,1);assert.equal(h.calls.filter(c=>c.kind!=='local').length,0);
 assert.equal(h.api.voiceSnapshot().sourceKind,'local');await h.invoke('voiceClose',binding);
});

test('QQ input and channel reconnection leave App speech alone; channel speech still interrupts once',async()=>{
 const h=harness();await h.start();const local=h.api.current();local.state.status='speaking';
 h.a.incomingCount++;h.a.generation++;h.a.client.generation++;h.a.client.socket={};h.a.status='connected';h.api.publish();await tick();assert.equal(local.interrupts,0);assert.equal(local.closes,0);assert.equal(h.api.current(),local);
 await h.invoke('voiceClose',h.binding());h.api.kind('channel');const channel={accountId:'a',panelId:'channel-panel',sourceKind:'channel'};await h.start(channel);const voice=h.api.current();voice.state.status='speaking';h.a.incomingCount++;h.api.publish();await tick();assert.equal(voice.interrupts,1);h.api.publish();assert.equal(voice.interrupts,1);await h.invoke('voiceClose',channel);
});

test('pending App ASR preparation rechecks the full local identity and cancels closed ownership',async t=>{
 const changes={generation:h=>h.a.localGeneration++,character:h=>{h.a.localCharacter='other';},settings:h=>{h.a.localSettings='changed';},dispatcher:h=>{h.a.localEngine={respondLocally:async()=>{throw Error('must not call');}};},credentialsCleared:h=>{h.a.localActive=false;},account:h=>h.select(h.b),source:h=>h.api.kind('channel')};
 for(const [name,change]of Object.entries(changes))await t.test(name,async()=>{const h=harness();h.plan.cleanup=defer();const started=h.start(),settled=assert.rejects(started,/changed|unavailable|disconnected/i);await tick();change(h);h.plan.cleanup.resolve();await settled;assert.equal(h.runtimes.length,0);await h.api.closeVoice();});
 const h=harness();h.plan.cleanup=defer();const pending=h.start(),rejected=assert.rejects(pending,/changed|cancelled/i);await tick();await h.invoke('voiceClose',h.binding());h.plan.cleanup.resolve();await rejected;assert.equal(h.runtimes.length,0);
});

test('capability probe late completion is discarded after local source changes and still closes its exact probe',async()=>{
 const h=harness();h.plan.probe=defer();const pending=h.invoke('voiceCapabilities',h.binding()),rejected=assert.rejects(pending,/changed/i);await tick();assert.equal(h.probes.length,1);h.a.localGeneration++;h.plan.probe.resolve();await rejected;assert.equal(h.probes[0].probe.closes,1);assert.equal(h.runtimes.length,0);
});

test('stale source fields cannot finish, interrupt, confirm, inspect or close a later same-panel App session',async()=>{
 const h=harness(),old=h.binding();await h.start();await h.invoke('voiceClose',old);h.a.localGeneration++;const current=h.binding();await h.start(current);const voice=h.api.current();
 await h.invoke('voiceFinish',old);await h.invoke('voiceInterrupt',old);assert.equal(voice.finishes,undefined);assert.equal(voice.interrupts,0);
 await assert.rejects(h.invoke('voiceConfirm',{...old,draftId:'old',text:'old'}),/changed|owns/i);
 const prior=h.api.getVoiceEvidence(old);assert.equal(prior.sessionState,'ended');assert.equal(prior.localGeneration,old.localGeneration,'An old request may read its own retained receipt, never the active successor.');
 await h.invoke('voiceClose',old);assert.equal(h.api.current(),voice);assert.equal(voice.closes,0);
 const oldChannel={accountId:'a',panelId:current.panelId,sourceKind:'channel'};await h.invoke('voiceClose',oldChannel);assert.equal(h.api.current(),voice);
 await h.invoke('voiceClose',current);assert.equal(voice.closes,1);assert.throws(()=>h.api.getVoiceEvidence(old),/changed|belongs|owns/i,'A replaced receipt must not be projected back onto the old source.');
});

test('late provider completion belongs only to captured local dispatcher and cannot cross generation',async()=>{
 const h=harness();await h.start();const voice=h.api.current();h.a.replyGate=defer();const pending=voice.options.respond('synthetic words',{signal:new AbortController().signal,voice:true}),rejected=assert.rejects(pending,/changed/i);await tick();assert.equal(h.calls.length,1);h.a.localGeneration++;h.a.localEngine={respondLocally:async()=>{throw Error('New engine must not receive the old turn.');}};h.api.publish();h.a.replyGate.resolve();await rejected;await tick();assert.equal(h.calls.length,1);assert.equal(voice.closes,1);assert.equal(h.api.current(),null);
});

test('failed App speech cleanup remains diagnosable after local Stop and retries the exact owned host',async()=>{
 const h=harness(),binding=h.binding();await h.start();const voice=h.api.current();voice.closeFailures=1;h.a.localActive=false;
 await assert.rejects(h.invoke('voiceClose',binding),/unconfirmed/);const snapshot=h.api.voiceSnapshot();assert.equal(snapshot.status,'error');assert.equal(snapshot.sourceKind,'local');assert.equal(snapshot.localGeneration,binding.localGeneration);
 const evidence=h.api.getVoiceEvidence(binding);assert.equal(evidence.sessionState,'unconfirmed');assert.equal(evidence.closeConfirmed,false);
 h.api.kind('channel');assert.equal(h.api.voiceSnapshot(),null);assert.throws(()=>h.api.getVoiceEvidence(binding),/belongs/);h.api.kind('local');await h.invoke('voiceClose',binding);assert.equal(voice.closes,2);assert.equal(h.api.getVoiceEvidence(binding).sessionState,'ended');
});

test('same App panel reuses its voice host; explicit backend change retires it and strips source fields from speech options',async()=>{
 const h=harness(),binding=h.binding();await h.start();const first=h.api.current();first.state.status='idle';await h.start();assert.equal(h.api.current(),first);assert.equal(first.starts,2);assert.equal(first.closes,0);
 for(const field of ['sourceKind','localGeneration','localCharacterId','accountId','panelId','backend'])assert.equal(first.started[field],undefined);
 await h.invoke('voiceStart',{...binding,mode:'push-to-talk',backend:'local-neural'});assert.equal(first.closes,1);assert.notEqual(h.api.current(),first);assert.equal(h.runtimes.length,2);await h.invoke('voiceClose',binding);
});
