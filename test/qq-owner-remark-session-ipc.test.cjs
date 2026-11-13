'use strict';
// Production main/session/panel/controller/client with a synthetic local bridge.
// No real QQ, contact data, account process, Electron window or model is used.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),{once}=require('node:events');
const {WebSocketServer,WebSocket}=require('ws');
const {QQClient}=require('../src/bot/qq.cjs'),{QQOwnerRemark}=require('../src/bot/qq-owner-remark.cjs'),{QQOwnerRemarkPanel}=require('../src/bot/qq-owner-remark-panel.cjs');
const sessionModule=require('../src/bot/qq-owner-remark-session.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const ACCOUNT='100001',OWNER='200001',PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NEXT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tick=()=>new Promise(resolve=>setImmediate(resolve)),defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
async function until(predicate){const deadline=Date.now()+3000;while(!predicate()){if(Date.now()>=deadline)assert.fail('Synthetic management operation did not reach its test boundary');await tick();}}
async function fixture(t){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const wire={self:ACCOUNT,online:true,remark:' Synthetic original ',present:true,mode:'ok',requests:[]};
 server.on('connection',socket=>socket.on('message',raw=>{const row=JSON.parse(raw);wire.requests.push(row);const reply=data=>{if(socket.readyState===1)socket.send(JSON.stringify({status:'ok',retcode:0,echo:row.echo,data}));};
  if(row.action==='get_login_info')return reply({user_id:wire.self,nickname:'Synthetic self'});
  if(row.action==='get_status')return reply({online:wire.online,good:true});
  if(row.action==='get_friend_list')return reply(wire.present?[{user_id:OWNER,nickname:'SYNTHETIC_PRIVATE_NICKNAME',remark:wire.remark},{user_id:'300001',nickname:'PRIVATE_OTHER_NAME',remark:'PRIVATE_OTHER_REMARK'}]:[]);
  if(row.action==='set_friend_remark'){assert.deepEqual(Object.keys(row.params).sort(),['remark','user_id']);assert.equal(row.params.user_id,OWNER);wire.remark=row.params.remark;return reply(wire.mode==='unknown'?{}:null);}
  assert.fail('Unexpected fixed owner action');
 }));
 const handlers=new Map(),events={},windowEvents={},messages=[],clients=[],proofs=[],url=`ws://127.0.0.1:${server.address().port}`;
 let proofHold=null,proofFailure=null,deliveryHold=null,character='synthetic-character',role='Synthetic role',connects=0;
 const aiClient={ready:true,closed:false,generation:1,accountId:ACCOUNT,ownerId:OWNER,socket:{readyState:1},close(){this.closed=true;this.ready=false;}};
 const service={client:aiClient,status:'disconnected',credentialState:'ready',generation:1,imagePersona:{id:character,name:{zh:role}},config:{channel:'qq',mode:'deepseek',qqAccountId:ACCOUNT,qqOwnerId:OWNER,qqUrl:url},secret:{qqToken:'SYNTHETIC_PRIVATE_TOKEN'},
  socialStore:{config:()=>({enabled:true,characterId:character,name:role})},snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};},
  imageBinding(){if(this.status!=='connected')throw Object.assign(Error('Synthetic disconnected'),{code:'disconnected'});return {status:this.status,channel:'qq',scopeId:'synthetic-profile:character',generation:this.generation,accountId:ACCOUNT,ownerId:OWNER,role,client:aiClient};}};
 const accounts={selectedId:'whale',get(id){if(id!=='whale')throw Error('PRIVATE_PROFILE');return service;},snapshot(){return {selectedId:this.selectedId,accounts:[]};},async close(){},connect(){connects++;return {connected:true};}};
 const connection={accountId:ACCOUNT,serverName:'agent-arcade',url,token:service.secret.qqToken},runtime={async getConnection(id){proofs.push(id);await proofHold?.promise;if(proofFailure)throw proofFailure;return {ownershipVerified:true,endpointId:'synthetic-endpoint'};}};
 const qqConsole={runtime,epoch:1,closed:false,busy:new Set(),installationSettings:{current:{kind:'legacy'}},state:{instances:[{accountId:ACCOUNT,processRunning:true,login:{identityVerified:true,online:true,accountId:ACCOUNT},runtimeRevision:'synthetic-revision',bridges:[{serverName:'agent-arcade',enabled:true,loopbackOnly:true,hasToken:true,port:server.address().port}]}]},clients:new Map([[ACCOUNT,{publicId:'synthetic-revision',endpointId:'synthetic-endpoint'}]]),profiles(){return {connection:()=>({...connection})};},check(r,e){if(this.closed||this.runtime!==r||this.epoch!==e)throw Object.assign(Error('PRIVATE_RUNTIME'),{code:'changed'});},snapshot(){return this.state;},async close(){}};
 const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed(){return false;},show(){this.visible=true;},focus(){},on(name,fn){(windowEvents[name]||=[]).push(fn);},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href},send(_name,value){messages.push(value);}}};
 class HeldController extends QQOwnerRemark{async set(...args){const receipt=await super.set(...args);await deliveryHold?.promise;return receipt;}}
 class InjectedSession extends sessionModule.QQOwnerRemarkSession{constructor(options){super({...options,
  // Transfer only the VM realm container, preserving all exact captured refs.
  capture:input=>({...options.capture(input)}),verifyContext:async(...args)=>({...await options.verifyContext(...args)}),
  clientFactory:options=>{const client=new QQClient({...options,timeoutMs:150,socketFactory:(...args)=>new WebSocket(...args)});clients.push(client);return client;},
  panelFactory:options=>new QQOwnerRemarkPanel({...options,controllerFactory:options=>new HeldController(options)})});}}
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
  require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}},ipcMain:{handle(name,fn){assert(!handlers.has(name));handlers.set(name,fn);}}}
   :id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}
   :id==='./bot/qq-owner-remark-session.cjs'?{...sessionModule,QQOwnerRemarkSession:InjectedSession}:fromMain(id)};
 const registrations=source.split('\n').filter(line=>line.includes("register('qqOwnerRemark"));assert.equal(registrations.length,5);
 const hide=source.split('\n').filter(line=>line.includes("win.on('hide'")&&line.includes('ownerRemarkPanel')).join('\n');assert(hide);
 const connect=source.split('\n').find(line=>line.includes("register('accountConnect'")),connectFunction=source.match(/const connectCompanion=id=>\{[\s\S]*?\n    \};/)?.[0];assert(connect&&connectFunction);
 vm.runInNewContext(source+`\nmodule.exports={ownerRemarkPanel,captureOwnerRemark,captureFriendRequests,publish,fullSnapshot,stopping:qqStopping,setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},setQuitting:value=>quitting=value,bind:()=>{${registrations.join('\n')}\n${hide}\n${connectFunction}\n${connect}\n}};`,context,{filename:main});
 const api=context.module.exports;api.setup(service,accounts,win,qqConsole);api.bind();const input={accountId:'whale',panelId:PANEL},event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 const invoke=(suffix,value=input,override=event)=>handlers.get('arcade:qqOwnerRemark'+suffix)(override,value);
 t.after(async()=>{proofHold?.resolve();deliveryHold?.resolve();await api.ownerRemarkPanel.close();for(const client of clients)client.close();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
 return {api,wire,service,accounts,aiClient,connection,runtime,qqConsole,win,clients,proofs,messages,events,input,event,invoke,handlers,server,writes:()=>wire.requests.filter(row=>row.action==='set_friend_remark'),emit:name=>{for(const fn of windowEvents[name]||[])fn();},
  set proofHold(v){proofHold=v;},set proofFailure(v){proofFailure=v;},set deliveryHold(v){deliveryHold=v;},set character(v){character=v;},set role(v){role=v;},get connects(){return connects;}};
}
test('actual remark handlers support AI-off fixed-owner read/set/explicit restore over a separate socket',async t=>{
 const f=await fixture(t);await assert.rejects(f.invoke('Read',f.input,{sender:{},senderFrame:f.event.senderFrame}),/Untrusted sender/);
 const available=await f.invoke('Availability');assert.equal(available.available,true);assert.equal(available.recipient.accountId,ACCOUNT);assert.equal(available.recipient.ownerId,OWNER);assert.equal(f.clients.length,0);assert.equal(f.wire.requests.length,0);
 const original=f.wire.remark,row=await f.invoke('Read');assert.equal(row.ok,true);assert.equal(row.accountId,'whale');assert.equal(row.panelId,PANEL);assert.equal(row.recipient.accountId,ACCOUNT);assert.equal(row.observed.remark,original);assert.notEqual(f.clients[0],f.aiClient);assert.equal(f.clients[0].receiveOwnerMessages,false);assert.equal(f.clients[0].allowOwnerVoice,false);
 const changed=await f.invoke('Set',{...f.input,ticketId:row.ticketId,remark:' New synthetic remark '});assert.equal(changed.outcome,'accepted');assert.equal(changed.observation.state,'observed_match');const fresh=await f.invoke('Read');assert.equal(fresh.restore.value,original);
 assert.equal((await f.invoke('Restore',{...f.input,ticketId:fresh.ticketId})).outcome,'accepted');assert.equal(f.wire.remark,original);assert(f.writes().every(row=>row.params.user_id===OWNER));assert.equal(f.service.status,'disconnected');assert.equal(f.connects,0);await f.invoke('Close');assert.equal(f.aiClient.closed,false);
});
test('new management availability does not relax the connected friend-request capture',async t=>{
 const f=await fixture(t);assert.equal((await f.invoke('Availability')).available,true);f.service.friendRequests={};assert.throws(()=>f.api.captureFriendRequests(f.input),{code:'disconnected'});
 f.service.status='connected';assert.equal(f.api.captureFriendRequests(f.input).inbox,f.service.friendRequests);const row=await f.invoke('Read');assert.equal(row.ok,true);await f.invoke('Close');assert.equal(f.aiClient.closed,false);assert.equal(f.service.status,'connected');
});
test('invalid renderer targets, missing runtime proof and wrong selected identity never create a capability',async t=>{
 const f=await fixture(t);for(const extra of [{ownerId:'300001'},{url:'ws://127.0.0.1:9999'},{action:'set_friend_remark'}])assert.equal((await f.invoke('Read',{...f.input,...extra})).code,'invalid_request');
 for(const mutate of [()=>f.win.visible=false,()=>f.accounts.selectedId='other',()=>f.qqConsole.state.instances[0].login.accountId=OWNER]){mutate();assert.equal((await f.invoke('Read')).ok,false);f.win.visible=true;f.accounts.selectedId='whale';f.qqConsole.state.instances[0].login.accountId=ACCOUNT;}
 assert.equal(f.clients.length,0);assert.equal(f.writes().length,0);
});
test('fresh main proof rechecks profile/runtime/installation/owner/bridge after its await',async t=>{
 for(const change of [f=>f.service.generation++,f=>f.character='other',f=>f.role='Other',f=>f.qqConsole.epoch++,f=>f.qqConsole.installationSettings.current={kind:'legacy'},f=>f.qqConsole.clients.get(ACCOUNT).endpointId='other',f=>f.service.config.qqOwnerId='300001',f=>f.connection.token='DIFFERENT_SYNTHETIC_TOKEN']){
  const f=await fixture(t),hold=defer();f.proofHold=hold;const pending=f.invoke('Read');await tick();assert.equal(f.proofs.length,1);change(f);hold.resolve();assert.equal((await pending).ok,false);assert.equal(f.clients.length,0);assert.equal(f.writes().length,0);
 }
});
test('a pre-submit runtime operation consumes the ticket and cannot be retried when busy clears',async t=>{
 const f=await fixture(t),row=await f.invoke('Read'),hold=defer();f.proofHold=hold;const input={...f.input,ticketId:row.ticketId,remark:'Synthetic attempted'},changing=f.invoke('Set',input);await tick();f.qqConsole.busy.add('qq-setup');hold.resolve();const out=await changing;assert.equal(out.outcome,'not_submitted');assert.equal(out.code,'operation_in_progress');assert.equal(f.writes().length,0);f.qqConsole.busy.clear();assert.equal((await f.invoke('Set',input)).code,'stale_ticket');
});
test('accepted and unknown receipts remain attributed after close and never affect a later panel',async t=>{
 for(const mode of ['ok','unknown']){const f=await fixture(t),row=await f.invoke('Read'),hold=defer();f.deliveryHold=hold;f.wire.mode=mode;const pending=f.invoke('Set',{...f.input,ticketId:row.ticketId,remark:'Synthetic new'});
  await until(()=>f.writes().length>0);await until(()=>!f.api.ownerRemarkPanel.session.panel.panel.controller.operation);const closing=f.invoke('Close');hold.resolve();const result=await pending;await closing;
  assert.equal(result.outcome,mode==='ok'?'accepted':'unknown');assert.equal(result.accountId,'whale');assert.equal(result.panelId,PANEL);assert.equal(result.recipient.accountId,ACCOUNT);assert.equal(result.recipient.ownerId,OWNER);assert.equal(f.writes().length,1);
  assert.equal((await f.invoke('Read',{...f.input,panelId:NEXT})).ok,true);await f.invoke('Close',f.input);assert.equal(f.clients.at(-1).ready,true);assert.equal(f.aiClient.closed,false);
 }
});
test('hide retires only management and can reopen; snapshots never include private baselines or tickets',async t=>{
 const f=await fixture(t);await f.invoke('Read');f.emit('hide');await f.api.ownerRemarkPanel.retiring;assert.equal(f.clients[0].closed,true);assert.equal(f.api.ownerRemarkPanel.closed,false);assert.equal((await f.invoke('Read',{...f.input,panelId:NEXT})).ok,true);
 f.service.generation++;f.api.publish();await f.api.ownerRemarkPanel.retiring;assert.equal(f.clients[1].closed,true);assert.doesNotMatch(JSON.stringify(f.messages),/SYNTHETIC_PRIVATE|Synthetic original|ticketId/);assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/SYNTHETIC_PRIVATE|Synthetic original|ticketId/);assert.equal(f.aiClient.closed,false);
});
test('AI connect and quit retire management without writing or closing the independent AI client',async t=>{
 const f=await fixture(t);await f.invoke('Read');await f.handlers.get('arcade:accountConnect')(f.event,'whale');assert.equal(f.clients[0].closed,true);assert.equal(f.connects,1);assert.equal(f.aiClient.closed,false);
 await f.invoke('Read',{...f.input,panelId:NEXT});let prevented=false;f.events['before-quit']({preventDefault(){prevented=true;}});await f.api.ownerRemarkPanel.retiring;assert.equal(prevented,true);assert.equal(f.clients[1].closed,true);assert.equal(f.writes().length,0);
});
test('main errors stay fixed and restore never accepts renderer original data',async t=>{
 const f=await fixture(t),row=await f.invoke('Read');assert.equal((await f.invoke('Restore',{...f.input,ticketId:row.ticketId,remark:'Forged original'})).code,'invalid_request');f.proofFailure=Object.assign(Error('PRIVATE_TOKEN_PATH'),{code:'private_failure'});const out=await f.invoke('Read');assert.equal(out.ok,false);assert.doesNotMatch(JSON.stringify(out),/PRIVATE|private_failure/);assert.equal(f.writes().length,0);
});
