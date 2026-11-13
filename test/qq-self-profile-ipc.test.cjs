'use strict';
// Actual main IPC handlers + production self-profile session/controller; inert client/runtime.
// All identities and request text are synthetic. No Electron, QQ or model runs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),{EventEmitter}=require('node:events');
const profileModule=require('../src/bot/qq-self-profile-panel.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',PANEL2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tick=()=>new Promise(resolve=>setImmediate(resolve)),defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
function fixture(t){
  const handlers=new Map(),events={},windowEvents={},messages=[],clients=[],writes=[],proofs=[],now=Date.now();
  let connectHold=null,proofHold=null,proofFailure=null,writeHold=null,writeOutcome='accepted',connects=0,role='deepseek-whale',signature='SYNTHETIC_PRIVATE_SIGNATURE',nickname='Synthetic QQ',readHold=null;
  const aiClient={closed:false,close(){this.closed=true;}};
  const service={client:aiClient,status:'disconnected',credentialState:'ready',generation:1,config:{channel:'qq',mode:'deepseek',qqAccountId:'100001',qqOwnerId:'200001',qqUrl:'ws://127.0.0.1:3001'},secret:{qqToken:'SYNTHETIC_PRIVATE_BRIDGE_TOKEN'},
    socialStore:{config:()=>({characterId:role})},snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};}};
  const accounts={selectedId:'whale',get(id){if(id!=='whale')throw Error('SYNTHETIC_PRIVATE_PROFILE');return service;},snapshot(){return {selectedId:this.selectedId,accounts:[]};},async close(){},connect(){connects++;return {connected:true};}};
  const connection={accountId:'100001',serverName:'agent-arcade',url:'ws://127.0.0.1:3001',token:service.secret.qqToken};
  const runtime={async getConnection(id){proofs.push(id);await proofHold?.promise;if(proofFailure)throw proofFailure;return {ownershipVerified:true,endpointId:'synthetic-endpoint'};}};
  const qqConsole={runtime,epoch:1,closed:false,busy:new Set(),installationSettings:{current:{kind:'legacy'}},
    state:{instances:[{accountId:'100001',processRunning:true,login:{identityVerified:true,online:true,accountId:'100001'},runtimeRevision:'synthetic-revision',bridges:[{serverName:'agent-arcade',enabled:true,loopbackOnly:true,hasToken:true,port:3001}]}]},
    clients:new Map([['100001',{publicId:'synthetic-revision',endpointId:'synthetic-endpoint'}]]),
    profiles(){return {connection(accountId,serverName){assert.equal(accountId,connection.accountId);assert.equal(serverName,connection.serverName);return {...connection};}};},
    check(r,e){if(this.closed||this.runtime!==r||this.epoch!==e)throw Object.assign(Error('SYNTHETIC_PRIVATE_RUNTIME'),{code:'changed'});},snapshot(){return this.state;},async close(){}};
  const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed(){return false;},show(){this.visible=true;},focus(){},
    on(name,fn){(windowEvents[name]||=[]).push(fn);},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href},send(_name,value){messages.push(value);}}};
  class InertClient{
    constructor(options){this.options=options;this.receiveOwnerMessages=options.receiveOwnerMessages;this.ready=false;this.closed=false;this.generation=1;this.expectedAccountId=options.expectedAccountId;this.accountId=options.expectedAccountId;this.ownerId=options.ownerId;this.socket=new EventEmitter();this.socket.readyState=1;clients.push(this);}
    async connect(signal){await connectHold?.promise;if(signal.aborted)throw Object.assign(Error('Synthetic cancelled'),{code:'cancelled'});this.ready=true;this.connectedAt=now;}
    close(){if(this.closed)return;this.closed=true;this.ready=false;this.socket.readyState=3;this.socket.emit('close');}
    async readSelfProfile(signal,{assertCurrent}){await readHold?.promise;assertCurrent();return {accountId:this.accountId,nickname:{supported:true,value:nickname},signature:{supported:true,value:signature},source:'bridge-observed',fetchedAt:new Date(now).toISOString()};}
    async setSelfSignature(value,signal,{assertCurrent,expectedValue}){try{assertCurrent();if(signature!==expectedValue)return {outcome:'not_submitted',code:'baseline_changed'};}catch(error){return {outcome:'not_submitted',code:error.code};}writes.push({value});await writeHold?.promise;if(writeOutcome==='accepted')signature=value;return {outcome:writeOutcome,...(writeOutcome==='accepted'?{acknowledgement:'bridge-action-only'}:{code:'change_unknown'})};}
    async setSelfNickname(value,signal,{assertCurrent,expectedValue,expectedSignature}){try{assertCurrent();if(nickname!==expectedValue||signature!==expectedSignature)return {outcome:'not_submitted',code:'baseline_changed'};}catch(error){return {outcome:'not_submitted',code:error.code};}writes.push({field:'nickname',value});await writeHold?.promise;if(writeOutcome==='accepted')nickname=value;return {outcome:writeOutcome,...(writeOutcome==='accepted'?{acknowledgement:'bridge-reported-success'}:{code:writeOutcome==='rejected'?'profile_rejected':'change_unknown'})};}
    receive(userId='200001'){this.options.onFriendRequest({post_type:'request',request_type:'friend',self_id:this.accountId,user_id:userId,time:Math.floor(now/1000),comment:'SYNTHETIC_PRIVATE_REQUEST_COMMENT',flag:'SYNTHETIC_PRIVATE_REQUEST_FLAG'},{client:this,generation:this.generation});}
  }
  class InjectedProfilePanel extends profileModule.QQSelfProfilePanel{constructor(options){super({...options,clientFactory:value=>new InertClient(value)});}}
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}},ipcMain:{handle(name,fn){assert(!handlers.has(name));handlers.set(name,fn);}}}
      :id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}
      :id==='./bot/qq-self-profile-panel.cjs'?{...profileModule,QQSelfProfilePanel:InjectedProfilePanel}:fromMain(id)};
  const hideLine=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])win.on(event,()=>void selfProfilePanel.closeCurrent()"));
  const accountLine=source.split('\n').find(line=>line.includes("register('accountConnect'"));
  const botLine=source.split('\n').find(line=>line.includes("register('botConnect'"));
  const connectFunction=source.match(/const connectCompanion=id=>\{[\s\S]*?\n    \};/)?.[0];
  assert(hideLine&&accountLine&&botLine&&connectFunction,'Actual production lifecycle bindings must be exercised');
  vm.runInNewContext(source+`\nmodule.exports={registerSelfProfileHandlers,captureSelfProfile,verifySelfProfile,selfProfilePanel,publish,fullSnapshot,stopping:qqStopping,setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},setQuitting:value=>quitting=value,bindLifecycle:()=>{${connectFunction}\n${hideLine}\n${accountLine}\n${botLine}\n}};`,context,{filename:main});
  const api=context.module.exports;api.setup(service,accounts,win,qqConsole);api.registerSelfProfileHandlers();api.bindLifecycle();
  const event={sender:win.webContents,senderFrame:win.webContents.mainFrame},input={accountId:'whale',panelId:PANEL};
  const invoke=(suffix,value=input,override=event)=>handlers.get(`arcade:qqSelfProfile${suffix}`)(override,value);
  t.after(async()=>{connectHold?.resolve();proofHold?.resolve();writeHold?.resolve();await api.selfProfilePanel.close();});
  return {api,service,aiClient,accounts,connection,runtime,qqConsole,win,clients,writes,proofs,messages,events,input,invoke,handlers,event,
    emit:name=>{for(const fn of windowEvents[name]||[])fn();},set readHold(value){readHold=value;},set connectHold(value){connectHold=value;},set proofHold(value){proofHold=value;},set proofFailure(value){proofFailure=value;},set writeHold(value){writeHold=value;},set writeOutcome(value){writeOutcome=value;},set role(value){role=value;},get connects(){return connects;}};
}

async function preview(f,value='New synthetic signature'){
 const read=await f.invoke('Read');assert.equal(read.ok,true);const result=await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,field:'signature',value});assert.equal(result.ok,true);return result.preview;
}
test('actual trusted main handlers use an independent request-only socket with AI disconnected or connected',async t=>{
 for(const status of ['disconnected','connected']){const f=fixture(t);f.service.status=status;
  assert.equal([...f.handlers.keys()].filter(key=>key.startsWith('arcade:qqSelfProfile')).length,5);
  await assert.rejects(f.invoke('Read',f.input,{sender:{},senderFrame:f.event.senderFrame}),/Untrusted sender/);
  const read=await f.invoke('Read');assert.equal(read.ok,true);assert.equal(read.accountId,'whale');assert.equal(read.qqAccountId,'100001');assert.equal(read.profile.values.nickname,'Synthetic QQ');assert.equal(read.profile.capabilities.editable.nickname,true);assert(!Object.hasOwn(read.profile,'accountId'));assert.equal(f.proofs.length,2);
  assert.equal(f.clients[0].options.receiveOwnerMessages,false);assert.equal(f.clients[0].options.allowOwnerVoice,false);assert.equal(f.clients[0].options.onFriendRequest,undefined);assert.notEqual(f.clients[0],f.aiClient);assert.equal(f.connects,0);assert.equal(f.service.status,status);
  await f.invoke('Close');assert.equal(f.clients[0].closed,true);assert.equal(f.aiClient.closed,false);
 }
});

test('actual five-handler contract accepts nickname with whole-profile disclosure and field-correlated outcomes',async t=>{
 for(const outcome of ['accepted','rejected','unknown']){const f=fixture(t),read=await f.invoke('Read');f.writeOutcome=outcome;const preview=await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,field:'nickname',value:'New synthetic nickname'});assert.equal(preview.ok,true);assert.equal(preview.preview.preservationGuaranteed,false);assert.equal(preview.preview.preservedFieldsSource,'bridge-read-at-submit');const result=await f.invoke('Confirm',{...f.input,ticketId:preview.preview.ticketId});assert.equal(result.ok,true);assert.equal(result.accountId,f.input.accountId);assert.equal(result.panelId,f.input.panelId);assert.equal(result.change.field,'nickname');assert.equal(result.change.outcome,outcome);assert.equal(f.writes.length,1);assert.equal(f.writes[0].field,'nickname');if(outcome==='accepted')assert.equal(result.change.acknowledgement,'bridge-reported-success');else assert.equal(result.change.acknowledgement,undefined);assert.equal((await f.invoke('Confirm',{...f.input,ticketId:preview.preview.ticketId})).code,'stale_ticket');}
});

test('nickname ticket is consumed before fresh main verification and keeps its field on cancellation',async t=>{
 const f=fixture(t),read=await f.invoke('Read'),preview=await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,field:'nickname',value:'New nickname'}),held=defer();f.proofHold=held;const pending=f.invoke('Confirm',{...f.input,ticketId:preview.preview.ticketId});await tick();f.role='changed-role';held.resolve();const result=await pending;assert.equal(result.change.outcome,'not_submitted');assert.equal(result.change.field,'nickname');assert.equal(result.change.preservationGuaranteed,false);assert.equal(f.writes.length,0);assert.equal((await f.invoke('Confirm',{...f.input,ticketId:preview.preview.ticketId})).ok,false);
});
test('hidden, unselected, locked, offline, ambiguous and lifecycle-busy contexts create no capability',async t=>{
 const changes=[f=>f.win.visible=false,f=>f.win.minimized=true,f=>f.api.setQuitting(true),f=>f.accounts.selectedId='other',f=>f.service.status='connecting',f=>f.service.credentialState='locked',f=>f.qqConsole.state.instances[0].login.accountId='300001',f=>f.qqConsole.state.instances[0].login.online=false,f=>f.qqConsole.state.instances[0].processRunning=false,f=>f.qqConsole.state.instances[0].bridges.push({...f.qqConsole.state.instances[0].bridges[0]}),f=>f.connection.token='SYNTHETIC_OTHER_TOKEN',f=>f.qqConsole.busy.add('qq-components'),f=>f.api.stopping.add('100001')];
 for(const change of changes){const f=fixture(t);change(f);assert.equal((await f.invoke('Read')).ok,false);assert.equal(f.clients.length,0);assert.equal(f.proofs.length,0);assert.equal(f.aiClient.closed,false);}
});
test('fresh runtime proof rejects each changed profile, installation, endpoint and bridge scope before connecting',async t=>{
 for(const change of [f=>f.service.generation++,f=>f.role='other-character',f=>f.qqConsole.epoch++,f=>f.qqConsole.installationSettings.current={kind:'legacy'},f=>f.qqConsole.runtime={},f=>f.qqConsole.clients.get('100001').endpointId='other',f=>f.connection.token='SYNTHETIC_CHANGED_TOKEN',f=>f.qqConsole.state.instances[0].runtimeRevision='other',f=>f.accounts.selectedId='other']){
  const f=fixture(t),hold=defer();f.proofHold=hold;const reading=f.invoke('Read');await tick();assert.equal(f.proofs.length,1);change(f);hold.resolve();assert.equal((await reading).ok,false);assert.equal(f.clients.length,0);assert.equal(f.writes.length,0);
 }
});
test('change during owned client startup closes only that client and does not start AI',async t=>{
 const f=fixture(t),hold=defer();f.connectHold=hold;const reading=f.invoke('Read');await tick();assert.equal(f.clients.length,1);f.service.generation++;hold.resolve();assert.equal((await reading).ok,false);await f.api.selfProfilePanel.retiring;assert.equal(f.clients[0].closed,true);assert.equal(f.aiClient.closed,false);assert.equal(f.connects,0);
});
test('strict private IPC rejects arbitrary paths, fields, accounts and signatures without writes',async t=>{
 const f=fixture(t);for(const extra of [{url:'ws://127.0.0.1:9999'},{ownerId:'300001'},{path:'C:/private.png'},{token:'PRIVATE'}])assert.equal((await f.invoke('Read',{...f.input,...extra})).code,'invalid_request');
 const read=await f.invoke('Read');for(const field of ['avatar','sex','birthday'])assert.equal((await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,field,value:'x'})).code,'invalid_request');
 assert.equal((await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,field:'signature',value:'x'.repeat(121)})).code,'invalid_value');assert.equal(f.writes.length,0);
});
test('editing dismisses synchronously without clearing the baseline or racing a new preview',async t=>{
 const f=fixture(t),read=await f.invoke('Read'),one=await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,field:'signature',value:'One'}),beforeProofs=f.proofs.length;
 const dismiss=f.invoke('Dismiss'),two=await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,field:'signature',value:'Two'});await dismiss;assert.equal(two.ok,true);assert.notEqual(two.preview.ticketId,one.preview.ticketId);assert.equal(f.proofs.length,beforeProofs);
 const old=await f.invoke('Confirm',{...f.input,ticketId:one.preview.ticketId});assert.equal(old.code,'stale_ticket');const result=await f.invoke('Confirm',{...f.input,ticketId:two.preview.ticketId});assert.equal(result.change.outcome,'accepted');assert.equal(result.change.acknowledgement,'bridge-action-only');assert.equal(result.change.observation.state,'observed_match');assert.equal(f.writes.length,1);assert(!Object.hasOwn(result.change,'accountId'));assert(!Object.hasOwn(two.preview,'accountId'));
});
test('runtime operations beginning during confirm verification prevent submission and consume the preview',async t=>{
 const f=fixture(t),p=await preview(f),hold=defer();f.proofHold=hold;const changing=f.invoke('Confirm',{...f.input,ticketId:p.ticketId});await tick();f.qqConsole.busy.add('qq-setup');hold.resolve();const out=await changing;assert.equal(out.ok,true);assert.equal(out.change.outcome,'not_submitted');assert.equal(out.change.code,'operation_in_progress');assert.equal(f.writes.length,0);f.qqConsole.busy.clear();assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.ticketId})).code,'stale_ticket');
});
test('late accepted and unknown changes preserve captured identities after close and never retry',async t=>{
 for(const outcome of ['accepted','unknown']){const f=fixture(t),p=await preview(f),hold=defer();f.writeHold=hold;f.writeOutcome=outcome;const changing=f.invoke('Confirm',{...f.input,ticketId:p.ticketId});await tick();assert.equal(f.writes.length,1);const closing=f.invoke('Close');f.win.visible=false;f.api.publish();hold.resolve();const result=await changing;await closing;assert.equal(result.ok,true);assert.equal(result.change.outcome,outcome);assert.equal(result.accountId,'whale');assert.equal(result.panelId,PANEL);assert.equal(result.qqAccountId,'100001');assert.equal(f.writes.length,1);assert.equal(f.aiClient.closed,false);f.win.visible=true;assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.ticketId})).ok,false);}
});
test('hide/minimize can reopen a fresh session and a delayed old close cannot close its replacement',async t=>{
 for(const event of ['hide','minimize']){const f=fixture(t);await f.invoke('Read');f.emit(event);await f.api.selfProfilePanel.retiring;assert.equal(f.api.selfProfilePanel.closed,false);assert.equal(f.clients[0].closed,true);const next={...f.input,panelId:PANEL2};assert.equal((await f.invoke('Read',next)).ok,true);await f.invoke('Close',f.input);assert.equal(f.clients[1].closed,false);assert.equal(f.aiClient.closed,false);}
});
test('publish revokes changed sessions without broadcasting QQ profile strings, tokens or tickets',async t=>{
 const f=fixture(t);await preview(f);f.service.generation++;f.api.publish();await f.api.selfProfilePanel.retiring;assert.equal(f.api.selfProfilePanel.session,null);assert.equal(f.clients[0].closed,true);assert.doesNotMatch(JSON.stringify(f.messages),/SYNTHETIC_PRIVATE|ticketId|observationId|bridge-action-only/);assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/SYNTHETIC_PRIVATE|ticketId|observationId|bridge-action-only/);
});
test('AI connect waits for management retirement without a self-wait and keeps an old change receipt',async t=>{
 const f=fixture(t),p=await preview(f),hold=defer();f.writeHold=hold;const changing=f.invoke('Confirm',{...f.input,ticketId:p.ticketId});await tick();const connecting=f.handlers.get('arcade:accountConnect')(f.event,'whale');await tick();assert.equal(f.connects,0);assert.equal(f.clients[0].closed,true);hold.resolve();assert.equal((await changing).change.outcome,'accepted');await connecting;assert.equal(f.connects,1);assert.equal(f.aiClient.closed,false);
});
test('quit retires the owned management session and does not submit any outstanding preview',async t=>{
 const f=fixture(t);await preview(f);let prevented=false;f.events['before-quit']({preventDefault(){prevented=true;}});assert.equal(prevented,true);await f.api.selfProfilePanel.retiring;assert.equal(f.api.selfProfilePanel.closed,true);assert.equal(f.clients[0].closed,true);assert.equal(f.writes.length,0);
});
test('preload exposes only five fixed methods and main errors never return upstream text',async t=>{
 const f=fixture(t),calls=[],exposed={};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld(name,value){exposed[name]=value;}},ipcRenderer:{invoke:(...value)=>calls.push(value)}};}});
 for(const name of ['Read','Preview','Confirm','Dismiss','Close'])exposed.arcade['qqSelfProfile'+name](f.input);assert.equal(calls.length,5);assert(calls.every(([channel,input])=>channel.startsWith('arcade:qqSelfProfile')&&input===f.input));f.proofFailure=Object.assign(Error('SYNTHETIC_PRIVATE_TOKEN_PATH'),{code:'private_failure'});const out=await f.invoke('Read');assert.equal(out.ok,false);assert.doesNotMatch(JSON.stringify(out),/PRIVATE|private_failure/);
});
test('actual main verification requires the panel identity retained by the production session projection',async t=>{
 const f=fixture(t),read=await f.invoke('Read');assert.equal(read.ok,true);const binding=f.api.selfProfilePanel.session.binding;assert.equal(binding.panelId,PANEL);assert.equal(binding.profileId,'whale');const signal=new AbortController().signal;
 for(const altered of [{...binding,panelId:undefined},{...binding,panelId:'not-a-panel'},{...binding,profileId:'other'}])await assert.rejects(f.api.verifySelfProfile(altered,{signal}));
 assert.deepEqual(JSON.parse(JSON.stringify(await f.api.verifySelfProfile(binding,{signal}))),{verified:true});assert.equal(f.writes.length,0);
});

