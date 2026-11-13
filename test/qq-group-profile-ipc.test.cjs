'use strict';
// Actual main handlers + production session/controller/client + localhost WS.
// Every account, group, token and name below is synthetic. No real QQ/model.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const sessionModule=require('../src/bot/qq-group-profile-session.cjs');
const {QQGroupProfile}=require('../src/bot/qq-group-profile.cjs');
const {QQGroupProfileTransport}=require('../src/bot/qq-group-profile-transport.cjs');
const {QQClient}=require('../src/bot/qq.cjs');
const {fixture:bridge,ACCOUNT,OWNER,GROUP,OTHER,flush,deferred}=require('./helpers/qq-group-profile-fixture.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',PANEL2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function fixture(t){
 const wire=await bridge(t),handlers=new Map(),events={},windowEvents={},messages=[],clients=[],proofs=[];
 let proofHold=null,proofFailure=null,confirmHold=null,character='synthetic-character',connects=0;
 const service={client:wire.client,status:'disconnected',credentialState:'ready',generation:1,config:{channel:'qq',mode:'deepseek',qqAccountId:ACCOUNT,qqOwnerId:OWNER,qqUrl:wire.options.url},secret:{qqToken:wire.options.token},
  socialStore:{config:()=>({characterId:character})},snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};}};
 const accounts={selectedId:'whale',get(id){if(id!=='whale')throw Error('SYNTHETIC_PRIVATE_PROFILE');return service;},snapshot(){return {selectedId:this.selectedId,accounts:[]};},async close(){},connect(){connects++;return {connected:true};}};
 const connection={accountId:ACCOUNT,serverName:'agent-arcade',url:wire.options.url,token:wire.options.token};
 const runtime={async getConnection(id){proofs.push(id);await proofHold?.promise;if(proofFailure)throw proofFailure;return {ownershipVerified:true,endpointId:'synthetic-endpoint'};}};
 const qqConsole={runtime,epoch:1,closed:false,busy:new Set(),installationSettings:{current:{kind:'legacy'}},
  state:{instances:[{accountId:ACCOUNT,processRunning:true,login:{identityVerified:true,online:true,accountId:ACCOUNT},runtimeRevision:'synthetic-revision',bridges:[{serverName:'agent-arcade',enabled:true,loopbackOnly:true,hasToken:true,port:Number(new URL(wire.options.url).port)}]}]},
  clients:new Map([[ACCOUNT,{publicId:'synthetic-revision',endpointId:'synthetic-endpoint'}]]),profiles(){return {connection(accountId,serverName){assert.equal(accountId,connection.accountId);assert.equal(serverName,connection.serverName);return {...connection};}};},
  check(r,e){if(this.closed||this.runtime!==r||this.epoch!==e)throw Object.assign(Error('SYNTHETIC_PRIVATE_RUNTIME'),{code:'changed'});},snapshot(){return this.state;},async close(){}};
 const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed(){return false;},show(){this.visible=true;},focus(){},on(name,fn){(windowEvents[name]||=[]).push(fn);},
  webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href},send(_name,value){messages.push(value);}}};
 class ObservedController extends QQGroupProfile{async confirm(...args){const result=await super.confirm(...args);await confirmHold?.promise;return result;}}
 class InjectedSession extends sessionModule.QQGroupProfileSession{constructor(options){super({...options,
  // Main runs in a VM realm; shallow transfer preserves exact captured refs.
  capture:input=>({...options.capture(input)}),verifyContext:async(...args)=>({...await options.verifyContext(...args)}),
  clientFactory:options=>{const client=new QQClient({...wire.options,...options});clients.push(client);return client;},
  controllerFactory:options=>new ObservedController({...options,transport:new QQGroupProfileTransport()})});}}
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
  require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}},ipcMain:{handle(name,fn){assert(!handlers.has(name));handlers.set(name,fn);}}}
   :id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}
   :id==='./bot/qq-group-profile-session.cjs'?{...sessionModule,QQGroupProfileSession:InjectedSession}:fromMain(id)};
 const hide=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])win.on(event,()=>void groupProfileSession.closeCurrent()"));
 const connect=source.split('\n').find(line=>line.includes("register('accountConnect'"));
 const connectFunction=source.match(/const connectCompanion=id=>\{[\s\S]*?\n    \};/)?.[0];assert(hide&&connect&&connectFunction);
 vm.runInNewContext(source+`\nmodule.exports={registerGroupProfileHandlers,captureGroupProfile,verifyGroupProfile,groupProfileSession,publish,fullSnapshot,stopping:qqStopping,setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},setQuitting:value=>quitting=value,bindLifecycle:()=>{${connectFunction}\n${hide}\n${connect}\n}};`,context,{filename:main});
 const api=context.module.exports;api.setup(service,accounts,win,qqConsole);api.registerGroupProfileHandlers();api.bindLifecycle();
 const event={sender:win.webContents,senderFrame:win.webContents.mainFrame},input={accountId:'whale',panelId:PANEL,groupId:GROUP};
 const invoke=(suffix,value=input,override=event)=>handlers.get(`arcade:qqGroupProfile${suffix}`)(override,value);
 t.after(async()=>{proofHold?.resolve();confirmHold?.resolve();await api.groupProfileSession.close();});
 const preview=async(value='Synthetic revised group')=>{const read=await invoke('Read');assert.equal(read.ok,true);const out=await invoke('Preview',{...input,observationId:read.profile.observationId,field:'name',value});assert.equal(out.ok,true);return out.preview;};
 return {...wire,api,service,accounts,connection,runtime,qqConsole,win,clients,proofs,messages,events,input,invoke,handlers,event,preview,
  emit:name=>{for(const fn of windowEvents[name]||[])fn();},set proofHold(value){proofHold=value;},set proofFailure(value){proofFailure=value;},set confirmHold(value){confirmHold=value;},set character(value){character=value;},get connects(){return connects;}};
}
test('actual five trusted handlers use the selected profile and separate request-only loopback connection',async t=>{
 for(const status of ['disconnected','connected']){const f=await fixture(t);f.service.status=status;assert.equal(f.handlers.size,6);
  await assert.rejects(f.invoke('Read',f.input,{sender:{},senderFrame:f.event.senderFrame}),/Untrusted sender/);
  const read=await f.invoke('Read');assert.equal(read.ok,true);assert.equal(read.accountId,'whale');assert.equal(read.qqAccountId,ACCOUNT);assert.equal(read.groupId,GROUP);assert.equal(read.profile.groupId,GROUP);assert.equal(read.profile.accountId,undefined);assert.equal(f.proofs.length,2);
  assert.notEqual(f.clients[0],f.client);assert.equal(f.clients[0].receiveOwnerMessages,false);assert.equal(f.connects,0);await f.invoke('Close');assert.equal(f.clients[0].closed,true);assert.equal(f.client.ready,true);assert.equal(f.writes().length,0);
 }
});
test('main rejects hidden, unselected, locked, offline, ambiguous and lifecycle-busy scopes before connecting',async t=>{
 for(const change of [f=>f.win.visible=false,f=>f.win.minimized=true,f=>f.api.setQuitting(true),f=>f.accounts.selectedId='other',f=>f.service.status='connecting',f=>f.service.credentialState='locked',f=>f.qqConsole.state.instances[0].login.accountId=OWNER,f=>f.qqConsole.state.instances[0].login.online=false,f=>f.qqConsole.state.instances[0].processRunning=false,f=>f.qqConsole.state.instances[0].bridges.push({...f.qqConsole.state.instances[0].bridges[0]}),f=>f.connection.token='SYNTHETIC_OTHER_TOKEN',f=>f.qqConsole.busy.add('qq-components'),f=>f.api.stopping.add(ACCOUNT)]){
  const f=await fixture(t);change(f);assert.equal((await f.invoke('Read')).ok,false);assert.equal(f.clients.length,0);assert.equal(f.writes().length,0);
 }
});
test('fresh main proof rejects changed service, installation, endpoint or selection after its await',async t=>{
 for(const change of [f=>f.service.generation++,f=>f.character='other',f=>f.qqConsole.epoch++,f=>f.qqConsole.installationSettings.current={kind:'legacy'},f=>f.qqConsole.runtime={},f=>f.qqConsole.clients.get(ACCOUNT).endpointId='other',f=>f.connection.token='SYNTHETIC_CHANGED_TOKEN',f=>f.accounts.selectedId='other']){
  const f=await fixture(t),hold=deferred();f.proofHold=hold;const reading=f.invoke('Read');await flush();assert.equal(f.proofs.length,1);change(f);hold.resolve();assert.equal((await reading).ok,false);assert.equal(f.clients.length,0);assert.equal(f.writes().length,0);
 }
});
test('a renderer candidate never authorizes an unlisted group or arbitrary target/action',async t=>{
 const f=await fixture(t);for(const value of [{...f.input,groupId:Number(GROUP)},{...f.input,panelId:'bad'},{...f.input,url:f.options.url},{...f.input,action:'set_group_name'},{...f.input,ownerId:OWNER}])assert.equal((await f.invoke('Read',value)).code,'invalid_request');
 const other=await f.invoke('Read',{...f.input,groupId:'77777777'});assert.equal(other.code,'group_not_joined');assert.equal(f.state.requests.filter(row=>row.action==='get_group_info').length,0);assert.equal(f.writes().length,0);
});
test('real main read-preview-confirm projects one-use receipt and synchronous dismiss preserves baseline',async t=>{
 const f=await fixture(t),read=await f.invoke('Read'),p=await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,field:'name',value:'First'});
 const dismiss=f.invoke('Dismiss'),q=await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,field:'name',value:'Second'});await dismiss;assert.equal(q.ok,true);assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.preview.ticketId})).code,'stale_ticket');
 const out=await f.invoke('Confirm',{...f.input,ticketId:q.preview.ticketId});assert.equal(out.ok,true);assert.equal(out.change.outcome,'accepted');assert.equal(out.change.acknowledgement,'bridge-reported-success');assert.equal(out.change.observation.state,'observed_match');assert.equal(out.change.groupId,GROUP);assert.equal(out.change.accountId,undefined);assert.equal(f.writes().length,1);
 assert.equal((await f.invoke('Confirm',{...f.input,ticketId:q.preview.ticketId})).code,'stale_ticket');assert.equal(f.writes().length,1);assert(!JSON.stringify(out).includes('PRIVATE_'));
});
test('changed role or starting runtime operation consumes confirmation without submitting',async t=>{
 for(const mode of ['role','busy']){const f=await fixture(t),p=await f.preview();let hold;
  if(mode==='role')f.state.role='admin';else{hold=deferred();f.proofHold=hold;}
  const changing=f.invoke('Confirm',{...f.input,ticketId:p.ticketId});if(hold){await flush();f.qqConsole.busy.add('qq-setup');hold.resolve();}
  const out=await changing;assert.equal(out.change.outcome,'not_submitted');assert.equal(out.change.code,mode==='role'?'role_changed':'operation_in_progress');assert.equal(f.writes().length,0);f.qqConsole.busy.clear();assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.ticketId})).code,'stale_ticket');
 }
});
test('late accepted or unknown result retains captured identities after close, and is never retried',async t=>{
 for(const mode of ['accepted','unknown']){const f=await fixture(t),p=await f.preview(),hold=deferred();f.confirmHold=hold;if(mode==='unknown')f.state.native={};
  const changing=f.invoke('Confirm',{...f.input,ticketId:p.ticketId});while(!f.writes().length)await flush();while(f.api.groupProfileSession.session.controller.operation)await flush();
  const closing=f.invoke('Close');f.win.visible=false;hold.resolve();const out=await changing;await closing;assert.equal(out.ok,true);assert.equal(out.change.outcome,mode);assert.equal(out.accountId,'whale');assert.equal(out.panelId,PANEL);assert.equal(out.qqAccountId,ACCOUNT);assert.equal(out.groupId,GROUP);assert.equal(f.writes().length,1);assert.equal(f.client.ready,true);
 }
});
test('hide/minimize is reusable, stale closes are exact, publish does not disclose names or tickets',async t=>{
 for(const event of ['hide','minimize']){const f=await fixture(t);await f.preview();f.emit(event);await f.api.groupProfileSession.retiring;assert.equal(f.api.groupProfileSession.closed,false);const next={...f.input,panelId:PANEL2};assert.equal((await f.invoke('Read',next)).ok,true);await f.invoke('Close',f.input);assert.equal(f.clients[1].ready,true);f.service.generation++;f.api.publish();await f.api.groupProfileSession.retiring;assert.equal(f.clients[1].closed,true);assert.doesNotMatch(JSON.stringify(f.messages),/Synthetic group|synthetic-local-token|ticketId|observationId/);assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/Synthetic group|synthetic-local-token|ticketId|observationId/);}
});
test('AI connect and quit retire the owned session without starting QQ or consuming a pending preview',async t=>{
 const f=await fixture(t);await f.preview();await f.handlers.get('arcade:accountConnect')(f.event,'whale');assert.equal(f.connects,1);assert.equal(f.clients[0].closed,true);assert.equal(f.client.ready,true);assert.equal(f.writes().length,0);
 await f.preview();let prevented=false;f.events['before-quit']({preventDefault(){prevented=true;}});await f.api.groupProfileSession.retiring;assert.equal(prevented,true);assert.equal(f.api.groupProfileSession.closed,true);assert.equal(f.clients[1].closed,true);assert.equal(f.writes().length,0);
});
test('production captured panel/group evidence and preload methods are strict, errors stay fixed',async t=>{
 const f=await fixture(t);await f.invoke('Read');const binding=f.api.groupProfileSession.session.binding,signal=new AbortController().signal;assert.equal(binding.panelId,PANEL);assert.equal(binding.groupId,GROUP);
 for(const change of [{panelId:undefined},{panelId:'bad'},{profileId:'other'},{groupId:0}])await assert.rejects(f.api.verifyGroupProfile({...binding,...change},{signal}));
 assert.deepEqual(JSON.parse(JSON.stringify(await f.api.verifyGroupProfile(binding,{signal}))),{verified:true});
 const exposed={},calls=[];vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld(name,value){exposed[name]=value;}},ipcRenderer:{invoke:(...args)=>calls.push(args)}};}});
 for(const suffix of ['Read','Preview','Confirm','Dismiss','Close'])exposed.arcade['qqGroupProfile'+suffix](f.input);assert.equal(calls.length,5);assert(calls.every(([channel,input])=>channel.startsWith('arcade:qqGroupProfile')&&input===f.input));
 f.proofFailure=Object.assign(Error('SYNTHETIC_PRIVATE_TOKEN_PATH'),{code:'private_failure'});const out=await f.invoke('Read');assert.equal(out.ok,false);assert.doesNotMatch(JSON.stringify(out),/PRIVATE|private_failure/);
});
