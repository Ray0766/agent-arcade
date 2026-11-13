'use strict';
// Actual main handlers + production session/controller/client + localhost WS.
// Every account, contact, token and name below is synthetic. No real QQ/model.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const sessionModule=require('../src/bot/qq-contact-admin-session.cjs');
const {QQContactAdmin}=require('../src/bot/qq-contact-admin.cjs');
const {QQContactAdminTransport}=require('../src/bot/qq-contact-admin-transport.cjs');
const {QQClient}=require('../src/bot/qq.cjs');
const {fixture:bridge,ACCOUNT,OWNER,TARGET,flush,deferred}=require('./helpers/qq-contact-admin-fixture.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',PANEL2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function fixture(t){
 const wire=await bridge(t),handlers=new Map(),events={},windowEvents={},messages=[],clients=[],proofs=[];
 let proofHold=null,proofFailure=null,confirmHold=null,character='synthetic-character',connects=0;
 const service={client:wire.client,status:'disconnected',credentialState:'ready',generation:1,config:{channel:'qq',mode:'deepseek',qqAccountId:ACCOUNT,qqOwnerId:OWNER,qqUrl:wire.options.url},secret:{qqToken:wire.options.token},
  async disconnect(){this.status='disconnected';},socialStore:{config:()=>({characterId:character})},snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};}};
 const accounts={selectedId:'whale',get(id){if(id!=='whale')throw Error('SYNTHETIC_PRIVATE_PROFILE');return service;},snapshot(){return {selectedId:this.selectedId,accounts:[]};},async close(){},connect(){connects++;return {connected:true};}};
 const connection={accountId:ACCOUNT,serverName:'agent-arcade',url:wire.options.url,token:wire.options.token};
 const runtime={async getConnection(id){proofs.push(id);await proofHold?.promise;if(proofFailure)throw proofFailure;return {ownershipVerified:true,endpointId:'synthetic-endpoint'};}};
 const qqConsole={runtime,epoch:1,closed:false,busy:new Set(),installationSettings:{current:{kind:'legacy'}},
  state:{instances:[{accountId:ACCOUNT,processRunning:true,login:{identityVerified:true,online:true,accountId:ACCOUNT},runtimeRevision:'synthetic-revision',bridges:[{serverName:'agent-arcade',enabled:true,loopbackOnly:true,hasToken:true,port:Number(new URL(wire.options.url).port)}]}]},
  clients:new Map([[ACCOUNT,{publicId:'synthetic-revision',endpointId:'synthetic-endpoint'}]]),profiles(){return {connection(accountId,serverName){assert.equal(accountId,connection.accountId);assert.equal(serverName,connection.serverName);return {...connection};}};},
  check(r,e){if(this.closed||this.runtime!==r||this.epoch!==e)throw Object.assign(Error('SYNTHETIC_PRIVATE_RUNTIME'),{code:'changed'});},snapshot(){return this.state;},async close(){}};
 const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed(){return false;},show(){this.visible=true;},focus(){},on(name,fn){(windowEvents[name]||=[]).push(fn);},
  webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href},send(_name,value){messages.push(value);}}};
 class ObservedController extends QQContactAdmin{async confirm(...args){const result=await super.confirm(...args);await confirmHold?.promise;return result;}}
 class InjectedSession extends sessionModule.QQContactAdminSession{constructor(options){super({...options,
  // Main runs in a VM realm; shallow transfer preserves exact captured refs.
  capture:input=>({...options.capture(input)}),verifyContext:async(...args)=>({...await options.verifyContext(...args)}),
  clientFactory:options=>{const client=new QQClient({...wire.options,...options});clients.push(client);return client;},
  controllerFactory:options=>new ObservedController({...options,transport:new QQContactAdminTransport({now:()=>wire.state.now}),now:()=>wire.state.now,monotonic:()=>wire.state.mono})});}}
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
  require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}},ipcMain:{handle(name,fn){assert(!handlers.has(name));handlers.set(name,fn);}}}
   :id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}
   :id==='./bot/qq-contact-admin-session.cjs'?{...sessionModule,QQContactAdminSession:InjectedSession}:fromMain(id)};
 const hide=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])win.on(event,()=>void contactAdminSession.closeCurrent()"));
 const disconnect=source.split('\n').find(line=>line.includes("register('botDisconnect'"));
 const connect=source.split('\n').find(line=>line.includes("register('accountConnect'"));
 const connectFunction=source.match(/const connectCompanion=id=>\{[\s\S]*?\n    \};/)?.[0];assert(hide&&connect&&connectFunction);
 vm.runInNewContext(source+`\nmodule.exports={registerContactAdminHandlers,captureSelfProfile,verifySelfProfile,contactAdminSession,publish,fullSnapshot,stopping:qqStopping,setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},setQuitting:value=>quitting=value,bindLifecycle:()=>{${connectFunction}\n${hide}\n${connect}\n${disconnect}\n}};`,context,{filename:main});
 const api=context.module.exports;api.setup(service,accounts,win,qqConsole);api.registerContactAdminHandlers();api.bindLifecycle();
 const event={sender:win.webContents,senderFrame:win.webContents.mainFrame},input={accountId:'whale',panelId:PANEL,contactId:TARGET};
 const invoke=(suffix,value=input,override=event)=>handlers.get(`arcade:qqContactAdmin${suffix}`)(override,value);
 t.after(async()=>{proofHold?.resolve();confirmHold?.resolve();await api.contactAdminSession.close();});
 const preview=async(value='Synthetic revised remark')=>{const read=await invoke('Read');assert.equal(read.ok,true);const out=await invoke('Preview',{...input,observationId:read.profile.observationId,operation:'remark',value});assert.equal(out.ok,true);return out.preview;};
 return {...wire,api,service,accounts,connection,runtime,qqConsole,win,clients,proofs,messages,events,input,invoke,handlers,event,preview,
  emit:name=>{for(const fn of windowEvents[name]||[])fn();},set proofHold(value){proofHold=value;},set proofFailure(value){proofFailure=value;},set confirmHold(value){confirmHold=value;},set character(value){character=value;},get connects(){return connects;}};
}

test('five trusted contact handlers own a request-only socket and keep configured owner unchanged',async t=>{
 for(const status of ['connected','disconnected']){const f=await fixture(t);f.service.status=status;
  const read=await f.invoke('Read');assert.equal(read.ok,true);assert.equal(read.qqAccountId,ACCOUNT);assert.equal(read.contactId,TARGET);assert.equal(read.profile.isOwner,false);
  assert.equal(f.clients.length,1);assert.equal(f.clients[0].receiveOwnerMessages,false);assert.equal(f.clients[0].ownerId,OWNER);assert.equal(f.connects,0);
  await f.invoke('Close');assert.equal(f.clients[0].closed,true);assert.equal(f.client.ready,true);assert.equal(f.writes().length,0);
  await assert.rejects(f.invoke('Read',f.input,{sender:{},senderFrame:{}}));
 }
});

test('main requires selected visible unlocked exact online QQ before opening management',async t=>{
 for(const change of [f=>f.win.visible=false,f=>f.win.minimized=true,f=>f.api.setQuitting(true),f=>f.accounts.selectedId='other',f=>f.service.status='connecting',f=>f.service.credentialState='locked',f=>f.qqConsole.state.instances[0].login.accountId=OWNER,f=>f.qqConsole.state.instances[0].login.online=false,f=>f.qqConsole.state.instances[0].processRunning=false,f=>f.qqConsole.state.instances[0].bridges.push({...f.qqConsole.state.instances[0].bridges[0]}),f=>f.connection.token='SYNTHETIC_OTHER_TOKEN',f=>f.qqConsole.busy.add('qq-components'),f=>f.api.stopping.add(ACCOUNT)]){
  const f=await fixture(t);change(f);assert.equal((await f.invoke('Read')).ok,false);assert.equal(f.clients.length,0);assert.equal(f.writes().length,0);
 }
});

test('main runtime proof is rechecked after awaits; no stale profile or endpoint can connect',async t=>{
 for(const change of [f=>f.service.generation++,f=>f.character='other',f=>f.qqConsole.epoch++,f=>f.qqConsole.installationSettings.current={kind:'legacy'},f=>f.qqConsole.runtime={},f=>f.qqConsole.clients.get(ACCOUNT).endpointId='other',f=>f.connection.token='SYNTHETIC_CHANGED_TOKEN',f=>f.accounts.selectedId='other']){
  const f=await fixture(t),hold=deferred();f.proofHold=hold;const reading=f.invoke('Read');await flush();assert.equal(f.proofs.length,1);change(f);hold.resolve();assert.equal((await reading).ok,false);assert.equal(f.clients.length,0);assert.equal(f.writes().length,0);
 }
});

test('renderer candidates cannot supply another action, raw identity or arbitrary contact mutation',async t=>{
 const f=await fixture(t);
 for(const value of [{...f.input,contactId:Number(TARGET)},{...f.input,panelId:'bad'},{...f.input,url:f.options.url},{...f.input,action:'delete_friend'},{...f.input,friend_id:OWNER},{...f.input,ownerId:TARGET}])assert.equal((await f.invoke('Read',value)).ok,false);
 assert.equal((await f.invoke('Read',{...f.input,contactId:'77777777'})).ok,false);assert.equal(f.writes().length,0);
});

test('read-preview-confirm keeps exact target, one-use remark and independent cached observation',async t=>{
 const f=await fixture(t),read=await f.invoke('Read'),p=await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,operation:'remark',value:'First'});
 const dismiss=f.invoke('Dismiss'),q=await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,operation:'remark',value:'Second'});await dismiss;assert.equal(q.ok,true);
 assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.preview.ticketId})).ok,false);
 for(const override of [{contactId:OWNER},{value:'Other'},{operation:'delete'},{params:{user_id:OWNER}}])assert.equal((await f.invoke('Confirm',{...f.input,ticketId:q.preview.ticketId,...override})).ok,false);
 const out=await f.invoke('Confirm',{...f.input,ticketId:q.preview.ticketId});assert.equal(out.ok,true);assert.equal(out.change.outcome,'accepted');assert.equal(out.change.acknowledgement,'bridge-action-only');assert.equal(out.change.bridgeResponse,'received');assert.equal(out.change.observation.state,'observed_match');
 assert.equal(out.contactId,TARGET);assert.equal(out.change.contactId,TARGET);assert.deepEqual(f.writes()[0].params,{user_id:TARGET,remark:'Second'});assert.equal(f.writes().length,1);
 assert.equal((await f.invoke('Confirm',{...f.input,ticketId:q.preview.ticketId})).ok,false);assert.equal(f.writes().length,1);assert(!JSON.stringify(out).includes('PRIVATE_'));
});

test('deleting connected configured owner does not change local authority or upgrade unknown result',async t=>{
 const f=await fixture(t);f.service.status='connected';const input={...f.input,contactId:OWNER},read=await f.invoke('Read',input);assert.equal(read.profile.isOwner,true);
 const p=await f.invoke('Preview',{...input,observationId:read.profile.observationId,operation:'delete',value:{block:true,deleteBoth:false}});assert.equal(p.ok,true);
 const out=await f.invoke('Confirm',{...input,ticketId:p.preview.ticketId});assert.equal(out.ok,true);assert.equal(out.change.outcome,'unknown');assert.equal(out.change.bridgeResponse,'received');assert.equal(out.change.additionalEffectsUnverifiable,true);
 assert.deepEqual(out.change.deleteOptions,{block:true,deleteBoth:false});assert(Object.values(out.change.localEffects).every(value=>value===false));assert.equal(f.service.status,'connected');assert.equal(f.service.config.qqOwnerId,OWNER);assert.equal(f.clients[0].ownerId,OWNER);assert.equal(f.connects,0);
 assert.deepEqual(f.writes()[0].params,{user_id:OWNER,temp_block:true,temp_both_del:false});assert.equal(f.writes().length,1);
});

test('deadline crossing inside main verification consumes the preview without any write',async t=>{
 const f=await fixture(t),p=await f.preview(),hold=deferred();f.proofHold=hold;
 const changing=f.invoke('Confirm',{...f.input,ticketId:p.ticketId});await flush();f.state.mono+=300001;hold.resolve();
 const out=await changing;assert.equal(out.change.outcome,'not_submitted');assert.equal(out.change.code,'expired_ticket');assert.equal(f.writes().length,0);
 assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.ticketId})).ok,false);
});

test('late accepted results stay bound to the old contact after close and do not touch AI socket',async t=>{
 const f=await fixture(t),p=await f.preview(),hold=deferred();f.confirmHold=hold;
 const changing=f.invoke('Confirm',{...f.input,ticketId:p.ticketId});while(!f.writes().length)await flush();while(f.api.contactAdminSession.session.controller.operation)await flush();
 const closing=f.invoke('Close');f.win.visible=false;hold.resolve();const out=await changing;await closing;
 assert.equal(out.ok,true);assert.equal(out.change.outcome,'accepted');assert.equal(out.accountId,'whale');assert.equal(out.qqAccountId,ACCOUNT);assert.equal(out.contactId,TARGET);assert.equal(out.panelId,PANEL);assert.equal(f.writes().length,1);assert.equal(f.client.ready,true);
});

test('hide/minimize retires only the management socket and later stale close cannot close a new panel',async t=>{
 for(const name of ['hide','minimize']){const f=await fixture(t);await f.preview();f.emit(name);await f.api.contactAdminSession.retiring;assert.equal(f.api.contactAdminSession.closed,false);
  const next={...f.input,panelId:PANEL2};assert.equal((await f.invoke('Read',next)).ok,true);await f.invoke('Close',f.input);assert.equal(f.clients[1].ready,true);
  f.service.generation++;f.api.publish();await f.api.contactAdminSession.retiring;assert.equal(f.clients[1].closed,true);assert.doesNotMatch(JSON.stringify(f.messages),/Synthetic contact|synthetic-local-token|ticketId|observationId/);
 }
});

test('connect, legacy disconnect and application quit await owned contact retirement without a write',async t=>{
 const f=await fixture(t);await f.preview();await f.handlers.get('arcade:accountConnect')(f.event,'whale');assert.equal(f.connects,1);assert.equal(f.clients[0].closed,true);
 await f.preview();await f.handlers.get('arcade:botDisconnect')(f.event);assert.equal(f.clients[1].closed,true);assert.equal(f.writes().length,0);
 await f.preview();let prevented=false;f.events['before-quit']({preventDefault(){prevented=true;}});await f.api.contactAdminSession.retiring;assert.equal(prevented,true);assert.equal(f.api.contactAdminSession.closed,true);assert.equal(f.clients[2].closed,true);assert.equal(f.client.ready,true);assert.equal(f.writes().length,0);
});

test('five preload calls expose fixed methods only and private proof errors stay sanitized',async t=>{
 const f=await fixture(t),exposed={},calls=[];vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld(name,value){exposed[name]=value;}},ipcRenderer:{invoke:(...args)=>calls.push(args)}};}});
 for(const suffix of ['Read','Preview','Confirm','Dismiss','Close'])exposed.arcade['qqContactAdmin'+suffix](f.input);assert.equal(calls.length,5);assert(calls.every(([channel,input])=>channel.startsWith('arcade:qqContactAdmin')&&input===f.input));
 f.proofFailure=Object.assign(Error('SYNTHETIC_PRIVATE_TOKEN_PATH'),{code:'private_failure'});const out=await f.invoke('Read');assert.equal(out.ok,false);assert.doesNotMatch(JSON.stringify(out),/PRIVATE|private_failure/);
});
