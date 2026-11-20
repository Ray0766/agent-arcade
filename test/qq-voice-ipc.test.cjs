'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const mainFile=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(mainFile,'utf8'),fromMain=createRequire(mainFile),ticketId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function harness({oneShot=false}={}){
  const calls=[],pickers=[],instances=[],events={},client={generation:1,socket:{}},hosts=[],renderSettings={available:true,revision:'a'.repeat(64)};
  class Voice {
    constructor(options){this.scope=options.scope;this.state={status:'idle',scope:this.scope,mode:'push-to-talk'};this.events=[];instances.push(this);}
    snapshot(){return {...this.state};}record(event,data){this.events.push({event,...data});}diagnostics(){return {events:this.events,speech:{events:[]},scope:this.scope};}
    async startListening(){calls.push(['microphone']);this.state.status='listening';return this.snapshot();}
    async close(){this.closed=true;this.state.status='closed';calls.push(['desktop-close']);await this.closeGate?.promise;}
  }
  const service={generation:1,scopeId:'profile:ju',socialScope:'profile:ju-social',incomingCount:0,config:{mode:'api',channel:'qq'},status:'connected',resets:0,selected:false,
    voiceBinding(){return {status:this.status,channel:'qq',generation:this.generation,scopeId:this.scopeId,client,accountId:'100001',ownerId:this.ownerId||'200001',role:'橘'};},voiceSnapshot(){return {busy:false};},socialController(){return {};},socialReply(){return '';},
    imageBinding(){return this.voiceBinding();},imageSnapshot(){return {busy:false};},async resetImages(){calls.push(['image-reset']);},
    snapshot(){return {status:this.status,social:{config:{enabled:false}},voiceMedia:{draft:this.selected?{ticketId}:null}};},
    async selectVoice(file,{signal}){calls.push(['select',file,signal]);this.selected=true;return {ticketId,kind:'voice',sampleRate:32000,channels:1,bits:16,durationSeconds:1,bytes:64044,expiresAt:Date.now()+300000,preview:'data:audio/wav;base64,AAAA',recipient:{accountId:'100001',ownerId:'200001',role:'橘'},privatePath:'PRIVATE_FILE'};},
    async prepareVoice(bytes,{signal}){calls.push(['prepare',Buffer.from(bytes),signal]);return this.selectVoice('MAIN_OWNED_TTS',{signal});},
    async sendVoice(value,{signal}){calls.push(['send',value,signal]);return {ticketId,outcome:'accepted',messageId:'123',kind:'voice',privatePath:'PRIVATE_FILE'};},discardVoice(value){calls.push(['discard',value]);this.selected=false;return {discarded:true,privatePath:'PRIVATE_FILE'};},async resetVoices(){this.resets++;this.selected=false;await this.resetGate?.promise;}
  };
  const accounts={selectedId:'primary',get(id){if(id!=='primary')throw Error('Unknown');return service;},snapshot(){return {selectedId:this.selectedId};}},win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed:()=>false,webContents:{send(){}}};
  const context={__dirname:path.dirname(mainFile),module:{exports:{}},process:{argv:[],env:{}},setInterval,clearInterval,AbortController,
    require:id=>{
      if(id==='electron')return {app:{requestSingleInstanceLock:()=>false,quit(){},on(name,listener){events[name]=listener;}},dialog:{showOpenDialog(_win,options){calls.push(['picker',options]);const gate=deferred();pickers.push(gate);return gate.promise;}}};
      if(id==='./core/files.cjs')return {readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]};
      // Three legacy one-shot teardown checks retain their explicit cold renderer.
      // The normal fixture and separate warm IPC suite use the production policy.
      if(id==='./voice/qq-render.cjs'&&oneShot){const Base=fromMain(id).QQVoiceRenderer;return {QQVoiceRenderer:class extends Base{constructor(options){super({...options,captureRuntime:undefined});}}};}
      if(id==='./voice/conversation.cjs')return {VoiceConversation:Voice};
      if(id==='./voice/runtime.cjs')return {createVoiceRuntime:()=>({speech:{},backend:'windows'}),voiceCapabilities:async()=>({}),voiceRenderAvailability:()=>({available:renderSettings.available}),voiceRenderRevision:()=>renderSettings.revision,createVoiceRenderRuntime:()=>{const host={async render(text,{signal}){calls.push(['render',text,signal]);await renderSettings.renderGate?.promise;const bytes=require('./helpers/fixture-wav.cjs').wav();return {cleaned:true,wav:bytes,sampleRate:32000,channels:1,bits:16,frames:8000,durationSeconds:.25};},async close(){calls.push(['render-close']);await renderSettings.closeGate?.promise;if(renderSettings.closeError)throw Object.assign(Error('private'),{code:'voice_exit_timeout'});this.closed=true;}};hosts.push(host);return host;}};
      return fromMain(id);
    }};
  vm.runInNewContext(source+'\nmodule.exports={pickQQVoice,sendQQVoice,discardQQVoice,closeOwnedQQVoice,closeQQVoices,observeQQVoiceBinding,pickQQImage,startVoice,closeOwnedVoice,closeVoice,qqVoiceResult,qqVoiceAvailability,renderQQVoice,cancelQQVoiceRender,setup:(s,a,w)=>{bot=s;accounts=a;win=w;},panel:()=>voiceMediaPanel,desktop:()=>voice,quitting:()=>{quitting=true;},setHost:p=>{hostGate=hostPlatform.capabilities({platform:p});},unsupportedChannel};',context,{filename:mainFile});const api=context.module.exports;api.setup(service,accounts,win);
  return {api,service,accounts,win,calls,pickers,instances,events,hosts,renderSettings,request:{accountId:'primary',panelId:'wave-1'},async pick(request=this.request){const pending=api.pickQQVoice(request);await tick();pickers.at(-1).resolve({canceled:false,filePaths:['C:\\Original\\fixture.wav']});return pending;}};
}
test('main voice picker exposes only the canonical bounded preview and fixed owner, without sending or recording',async()=>{
  const f=harness(),result=await f.pick();assert.equal(result.accountId,'primary');assert.equal(result.panelId,'wave-1');assert.equal(result.draft.recipient.ownerId,'200001');assert.equal(result.draft.durationSeconds,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|Original|scopeId|client/);assert.equal(f.calls.filter(row=>['send','microphone'].includes(row[0])).length,0);const picker=f.calls.find(row=>row[0]==='picker')[1];assert.deepEqual(JSON.parse(JSON.stringify(picker.filters[0].extensions)),['wav']);await f.api.closeQQVoices();
});
test('path, recipient, text synthesis and arbitrary QQ parameters are rejected before any picker or send',async()=>{
  for(const extra of [{path:'C:\\secret.wav'},{ownerId:'300001'},{text:'synthesize me'},{action:'send_group_msg'},{url:'https://elsewhere'}]){const f=harness();await assert.rejects(f.api.pickQQVoice({...f.request,...extra}),{code:'invalid_request'});assert.equal(f.calls.length,0);}
  const f=harness();await f.pick();await assert.rejects(f.api.sendQQVoice({...f.request,ticketId,to:'300001'}),{code:'invalid_request'});assert(!f.calls.some(row=>row[0]==='send'));await f.api.closeQQVoices();
});
test('cancelled or malformed native selection never reads a file and clears the pending panel',async()=>{
  for(const selection of [{canceled:true,filePaths:[]},{canceled:false,filePaths:['a.wav','b.wav']}]){const f=harness(),pending=f.api.pickQQVoice(f.request);await tick();f.pickers[0].resolve(selection);if(selection.canceled)assert.equal((await pending).cancelled,true);else await assert.rejects(pending,{code:'invalid_request'});assert(!f.calls.some(row=>row[0]==='select'));assert.equal(f.api.panel(),null);assert.equal(f.service.resets,1);}
});
test('account, connection generations, character scope, client or recipient changes reject a late native picker selection',async()=>{
  for(const change of [f=>{f.accounts.selectedId='other';},f=>{f.service.generation++;},f=>{f.service.voiceBinding().client.generation=2;},f=>{f.service.scopeId='dragon';},f=>{const before=f.service.voiceBinding;f.service.voiceBinding=function(){return {...before.call(this),client:{}};};},f=>{f.service.ownerId='300001';}]){const f=harness(),pending=f.api.pickQQVoice(f.request);await tick();change(f);f.pickers[0].resolve({canceled:false,filePaths:['C:\\Original\\fixture.wav']});await assert.rejects(pending,{code:'changed'});assert(!f.calls.some(row=>row[0]==='select'));assert.equal(f.api.panel(),null);}
});
test('closing, hiding, minimizing or quitting invalidates a pending WAV and cannot reopen its panel',async()=>{
  for(const action of ['close','hide','minimize','quit']){const f=harness(),pending=f.api.pickQQVoice(f.request);await tick();if(action==='close')await f.api.closeOwnedQQVoice(f.request);if(action==='hide')f.win.visible=false;if(action==='minimize')f.win.minimized=true;if(action==='quit')f.api.quitting();f.api.observeQQVoiceBinding();f.pickers[0].resolve({canceled:false,filePaths:['C:\\Original\\fixture.wav']});await assert.rejects(pending,{code:'changed'});assert(!f.calls.some(row=>row[0]==='select'));assert.equal(f.api.panel(),null);}
});
test('one media picker at a time and old-panel close cannot invalidate its successor',async()=>{
  const f=harness(),pending=f.api.pickQQVoice(f.request);await tick();await assert.rejects(f.api.pickQQVoice(f.request),{code:'operation_in_progress'});await assert.rejects(f.api.pickQQImage(f.request),{code:'operation_in_progress'});f.pickers[0].resolve({canceled:false,filePaths:['C:\\Original\\fixture.wav']});await pending;await f.api.closeOwnedQQVoice({...f.request,panelId:'old'});assert.notEqual(f.api.panel(),null);assert.equal(f.service.resets,0);await f.api.closeQQVoices();
});
test('late media parsing is aborted and cannot publish into a replacement account',async()=>{
  const f=harness(),gate=deferred();let signal;f.service.selectVoice=async(_file,options)=>{signal=options.signal;return gate.promise;};const pending=f.pick();await tick();await f.api.closeOwnedQQVoice(f.request);assert(signal.aborted);gate.resolve({privatePath:'PRIVATE'});await assert.rejects(pending,{code:'changed'});assert.equal(f.api.panel(),null);
});
test('oversized, remote or mismatched owner previews never cross the main process boundary',async()=>{
  for(const patch of [{preview:'https://remote/audio.wav'},{bytes:4*1024*1024+1},{durationSeconds:31},{channels:2},{sampleRate:8000},{recipient:{accountId:'100001',ownerId:'300001',role:'other'}}]){const f=harness(),select=f.service.selectVoice.bind(f.service);f.service.selectVoice=async(...args)=>({...await select(...args),...patch});await assert.rejects(f.pick(),{code:'invalid_response'});assert.equal(f.api.panel(),null);}
});
test('accepted and unknown sends stay bound to their captured panel after an account change without replay',async()=>{
  for(const outcome of ['accepted','unknown']){const f=harness();await f.pick();const gate=deferred();let attempts=0;f.service.sendVoice=()=>{attempts++;return gate.promise;};const pending=f.api.sendQQVoice({...f.request,ticketId});await tick();f.accounts.selectedId='other';f.api.observeQQVoiceBinding();gate.resolve({ticketId,kind:'voice',outcome,messageId:'456',privatePath:'PRIVATE'});const result=await pending;assert.equal(result.accountId,'primary');assert.equal(result.panelId,'wave-1');assert.equal(result.outcome,outcome);assert.equal(attempts,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);assert.equal(f.api.panel(),null);}
});
test('unknown post-send responses are not retry instructions and not-sent codes have a fixed allowlist',async()=>{
  const f=harness();await f.pick();f.service.sendVoice=async()=>({ticketId,kind:'voice',outcome:'accepted',messageId:null});assert.equal((await f.api.sendQQVoice({...f.request,ticketId})).outcome,'unknown');f.service.sendVoice=async()=>({ticketId,kind:'voice',outcome:'not_sent',code:'private_token_value'});assert.equal((await f.api.sendQQVoice({...f.request,ticketId})).code,'voice_failed');await f.api.closeQQVoices();
  assert.deepEqual(JSON.parse(JSON.stringify(await f.api.qqVoiceResult(()=>{throw Object.assign(Error('PRIVATE'),{code:'private_identifier'});}))),{ok:false,code:'voice_failed'});
});
test('discard only clears its owned ticket and strips any backend extra fields',async()=>{
  const f=harness();await f.pick();assert.throws(()=>f.api.discardQQVoice({...f.request,panelId:'other',ticketId}),{code:'stale_ticket'});assert.deepEqual(JSON.parse(JSON.stringify(f.api.discardQQVoice({...f.request,ticketId}))),{discarded:true});assert(!f.calls.some(row=>row[0]==='send'));await f.api.closeQQVoices();
});
test('choosing a WAV closes desktop voice before presenting any preview',async()=>{
  const f=harness();await f.api.startVoice({accountId:'primary',panelId:'desktop',mode:'push-to-talk'});const current=f.api.desktop();assert.equal(current.state.status,'listening');await f.pick();assert.equal(current.closed,true);assert.equal(f.api.desktop(),null);assert(f.calls.findIndex(row=>row[0]==='desktop-close')<f.calls.findIndex(row=>row[0]==='picker'));await f.api.closeQQVoices();
});
test('desktop voice waits for WAV invalidation and its old drawer cannot close the new microphone session',async()=>{
  const f=harness();await f.pick();f.service.resetGate=deferred();const starting=f.api.startVoice({accountId:'primary',panelId:'desktop',mode:'push-to-talk'});await tick();assert.equal(f.api.panel(),null);assert.equal(f.service.selected,false);assert(!f.calls.some(row=>row[0]==='microphone'));await f.api.closeOwnedQQVoice(f.request);f.service.resetGate.resolve();await starting;assert.equal(f.api.desktop().state.status,'listening');await f.api.closeVoice();
});
test('closing a new WAV panel while the previous desktop host shuts down never opens a late picker',async()=>{
  const f=harness();await f.api.startVoice({accountId:'primary',panelId:'desktop',mode:'push-to-talk'});const current=f.api.desktop();current.closeGate=deferred();const picking=f.api.pickQQVoice(f.request);await tick();await f.api.closeOwnedQQVoice(f.request);current.closeGate.resolve();await assert.rejects(picking,{code:'changed'});assert.equal(f.pickers.length,0);
});
test('preload and main expose fixed voice media/render entry points, not recording or generic QQ commands',()=>{
  const preload=fs.readFileSync(path.join(__dirname,'../src/preload.cjs'),'utf8');for(const method of ['Pick','Send','Discard','Close','Availability','Render','CancelRender']){assert(preload.includes(`qqVoice${method}: value => ipcRenderer.invoke('arcade:qqVoice${method}',value)`));assert(source.includes(`register('qqVoice${method}',value=>qqVoiceResult(`));}for(const forbidden of ['qqVoiceRecord','qqVoiceTarget','send_group_msg'])assert(!preload.includes(forbidden));
  assert(source.includes('voiceFactory:options=>new QQOwnerVoice(options)'));assert(source.includes('closeQQVoices(),accounts?.close()'));
});

test('render availability checks only current scope and configuration without starting speech or selecting files',()=>{
  const f=harness();assert.equal(f.api.qqVoiceAvailability(f.request).available,true);assert.equal(f.hosts.length,0);assert.equal(f.calls.length,0);f.renderSettings.available=false;assert.equal(f.api.qqVoiceAvailability(f.request).reason,'voice_render_unavailable');f.accounts.selectedId='other';assert.throws(()=>f.api.qqVoiceAvailability(f.request),{code:'changed'});
});

test('one-shot compatibility: render progress is projected only to its exact live panel and never starts or completes a job',async()=>{
  const f=harness({oneShot:true});f.renderSettings.renderGate=deferred();f.renderSettings.closeGate=deferred();const pending=f.api.renderQQVoice({...f.request,text:'私有语音正文'});await tick();
  f.hosts[0].diagnostics=()=>({events:[{event:'ready',text:'PRIVATE_TEXT',path:'PRIVATE_PATH'}],pid:123});
  assert.equal(f.api.qqVoiceAvailability(f.request).progress.stage,'preparing');assert.equal(f.api.qqVoiceAvailability({...f.request,panelId:'another-panel'}).progress.stage,'idle');
  f.hosts[0].diagnostics=()=>({events:[{event:'render-start',id:'PRIVATE_ID'}]});const observed=f.api.qqVoiceAvailability(f.request);assert.equal(observed.progress.stage,'generating');assert.doesNotMatch(JSON.stringify(observed),/PRIVATE|私有|pid/);
  f.renderSettings.renderGate.resolve();await tick();assert.equal(f.api.qqVoiceAvailability(f.request).progress.stage,'finalizing');assert(!f.calls.some(row=>row[0]==='prepare'));
  f.service.generation++;assert.throws(()=>f.api.qqVoiceAvailability(f.request),{code:'changed'});f.renderSettings.closeGate.resolve();await assert.rejects(pending,{code:'changed'});assert.equal(f.hosts.length,1);assert(!f.calls.some(row=>['prepare','send','microphone'].includes(row[0])));
});
test('one-shot compatibility: explicit render yields a fixed-owner draft only after its host exits; no send, microphone or picker',async()=>{
  const f=harness({oneShot:true});f.renderSettings.closeGate=deferred();const pending=f.api.renderQQVoice({...f.request,text:'晚安。'});await tick();assert.equal(f.hosts.length,1);assert(!f.calls.some(row=>row[0]==='prepare'));await assert.rejects(f.api.pickQQVoice(f.request),{code:'operation_in_progress'});f.renderSettings.closeGate.resolve();const result=await pending;assert.equal(result.draft.recipient.ownerId,'200001');assert.equal(f.hosts[0].closed,true);assert.equal(f.calls.filter(row=>['send','microphone','picker'].includes(row[0])).length,0);assert.doesNotMatch(JSON.stringify(result),/MAIN_OWNED|PRIVATE|晚安/);await f.api.closeQQVoices();
});
test('render rejects paths, voice overrides, recipients and invalid text before any host starts',async()=>{
  for(const extra of [{path:'C:\\secret.wav'},{ownerId:'300001'},{voice:'other'},{action:'send_group_msg'},{wav:'AAAA'}]){const f=harness();await assert.rejects(f.api.renderQQVoice({...f.request,text:'你好',...extra}),{code:'invalid_request'});assert.equal(f.hosts.length,0);}
  for(const text of ['', 'x'.repeat(121),'\ud800','hello\u0000']){const f=harness();await assert.rejects(f.api.renderQQVoice({...f.request,text}),{code:'voice_render_limit'});assert.equal(f.hosts.length,0);}
});
test('cancel waits for actual host cleanup and no draft can appear after scope change',async()=>{
  const f=harness();f.renderSettings.renderGate=deferred();f.renderSettings.closeGate=deferred();const rendering=f.api.renderQQVoice({...f.request,text:'你好'}).catch(error=>error);await tick();let stopped=false;const cancel=f.api.cancelQQVoiceRender(f.request).then(()=>{stopped=true;});await tick();assert.equal(stopped,false);f.renderSettings.renderGate.resolve();await tick();assert(!f.calls.some(row=>row[0]==='prepare'));f.renderSettings.closeGate.resolve();await cancel;assert.equal((await rendering).code,'cancelled');assert.equal(f.service.selected,false);assert.equal(f.api.panel(),null);
});
test('render checks account and connection again after synthesis before creating any ticket',async()=>{
  for(const change of [f=>{f.accounts.selectedId='other';},f=>{f.service.generation++;},f=>{f.service.voiceBinding().client.generation=3;},f=>{f.service.scopeId='dragon';}]){const f=harness();f.renderSettings.renderGate=deferred();const pending=f.api.renderQQVoice({...f.request,text:'你好'});await tick();change(f);f.renderSettings.renderGate.resolve();await assert.rejects(pending,{code:'changed'});assert(!f.calls.some(row=>row[0]==='prepare'));assert.equal(f.api.panel(),null);}
});
test('closing during old desktop shutdown cannot start a late generator',async()=>{
  const f=harness();await f.api.startVoice({accountId:'primary',panelId:'desktop',mode:'push-to-talk'});f.api.desktop().closeGate=deferred();const gate=f.api.desktop().closeGate;const pending=f.api.renderQQVoice({...f.request,text:'你好'});await tick();await f.api.closeOwnedQQVoice(f.request);gate.resolve();await assert.rejects(pending,{code:'changed'});assert.equal(f.hosts.length,0);
});
test('one-shot compatibility: unconfirmed render exit remains blocked and an old-panel cancellation cannot report success for the owning job',async()=>{
  const f=harness({oneShot:true});f.renderSettings.closeError=true;await assert.rejects(f.api.renderQQVoice({...f.request,text:'你好'}),{code:'voice_render_exit_unconfirmed'});assert.equal(f.api.panel(),null);await assert.rejects(f.api.cancelQQVoiceRender(f.request),{code:'voice_render_exit_unconfirmed'});await assert.rejects(f.api.renderQQVoice({...f.request,text:'再试'}),{code:'operation_in_progress'});assert.equal(f.hosts.length,1);f.renderSettings.closeError=false;assert.equal((await f.api.cancelQQVoiceRender(f.request)).cancelled,true);assert.equal(f.hosts[0].closed,true);assert(!f.calls.some(row=>row[0]==='prepare'));
});
test('an obsolete panel close cannot cancel a fresh renderer job',async()=>{
  const f=harness();f.renderSettings.renderGate=deferred();const request={...f.request,panelId:'fresh-panel'};const pending=f.api.renderQQVoice({...request,text:'你好'});await tick();await f.api.closeOwnedQQVoice(f.request);assert.equal(f.calls.find(row=>row[0]==='render')[2].aborted,false);f.renderSettings.renderGate.resolve();await pending;assert.equal(f.api.panel().panelId,'fresh-panel');await f.api.closeQQVoices();
});

test('Darwin group WAV IPC preflights the exact group and prevents stale or private sends',async()=>{
  const f=harness(), groupId='543210', roleId='card-0123456789abcdef', group={...f.request,groupId};
  f.api.setHost('darwin');
  const owner=f.service.voiceBinding.bind(f.service), select=f.service.selectVoice.bind(f.service);
  const route={}, client=owner().client;
  let revision='first';
  f.service.voiceBinding=id=>{
    if(id!==groupId)throw Object.assign(Error('Not in the group list'),{code:'group_unavailable'});
    return {...owner(),scopeId:'profile:group',groupId,route,role:'试用搭档',roleId,groupRevision:revision};
  };
  client.verifyGroupVoiceTarget=async(id,signal,{assertCurrent})=>{
    assert.equal(id,groupId);assert.equal(signal.aborted,false);assertCurrent();f.calls.push(['verify-group',id]);
    return {accountId:'100001',groupId,revision};
  };
  f.service.selectVoice=async(file,options)=>{
    assert.equal(options.groupId,groupId);const draft=await select(file,options);
    return {...draft,recipient:{accountId:'100001',groupId,role:'试用搭档',roleId}};
  };
  f.renderSettings.available=false;
  const lookup=f.api.qqVoiceAvailability(group);
  assert.equal(lookup.groupId,groupId);assert.equal(lookup.available,false);
  assert.equal(lookup.reason,'voice_render_unavailable');
  assert.equal(f.api.unsupportedChannel('qqVoicePick'),false);
  assert.equal(f.api.unsupportedChannel('qqRuntimeRefresh'),true);
  assert.equal(f.api.unsupportedChannel('voiceStart'),true);
  await assert.rejects(f.api.pickQQVoice(f.request),{code:'group_unavailable'});
  await assert.rejects(f.api.pickQQVoice({...group,groupId:'654321'}),{code:'group_unavailable'});
  const picked=await f.pick(group);
  assert.equal(picked.groupId,groupId);
  assert.deepEqual(JSON.parse(JSON.stringify(picked.draft.recipient)),{accountId:'100001',groupId,role:'试用搭档',roleId});
  assert(f.calls.findIndex(row=>row[0]==='verify-group')<f.calls.findIndex(row=>row[0]==='picker'));
  await assert.rejects(f.api.sendQQVoice({...f.request,ticketId}),{code:'stale_ticket'});
  await assert.rejects(f.api.sendQQVoice({...group,groupId:'654321',ticketId}),{code:'stale_ticket'});
  revision='rejoined';
  await assert.rejects(f.api.sendQQVoice({...group,ticketId}),{code:'changed'});
  assert.equal(f.calls.filter(row=>row[0]==='send').length,0);
  await f.api.closeQQVoices();
});
