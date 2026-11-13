'use strict';
// Actual main IPC handlers + production controller/inbox; inert client/runtime.
// All identities and request text are synthetic. No Electron, QQ or model runs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),{EventEmitter}=require('node:events');
const ownerFriendModule=require('../src/bot/qq-owner-friend-setup.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',PANEL2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tick=()=>new Promise(resolve=>setImmediate(resolve)),defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
function fixture(t){
  const handlers=new Map(),events={},windowEvents={},messages=[],clients=[],writes=[],proofs=[],now=Date.now();
  let connectHold=null,proofHold=null,proofFailure=null,writeHold=null,writeOutcome='accepted',connects=0,role='deepseek-whale';
  const service={status:'disconnected',credentialState:'ready',generation:1,config:{channel:'qq',mode:'deepseek',qqAccountId:'100001',qqOwnerId:'200001',qqUrl:'ws://127.0.0.1:3001'},secret:{qqToken:'SYNTHETIC_PRIVATE_BRIDGE_TOKEN'},
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
    constructor(options){this.options=options;this.receiveOwnerMessages=options.receiveOwnerMessages;this.ready=false;this.closed=false;this.generation=1;this.accountId=options.expectedAccountId;this.ownerId=options.ownerId;this.socket=new EventEmitter();this.socket.readyState=1;clients.push(this);}
    async connect(signal){await connectHold?.promise;if(signal.aborted)throw Object.assign(Error('Synthetic cancelled'),{code:'cancelled'});this.ready=true;this.connectedAt=now;}
    close(){if(this.closed)return;this.closed=true;this.ready=false;this.socket.readyState=3;this.socket.emit('close');}
    async decideFriendRequest(input,{assertCurrent}){try{assertCurrent();}catch(error){return {outcome:'not_submitted',code:error.code};}writes.push({...input});await writeHold?.promise;return {outcome:writeOutcome};}
    receive(userId='200001'){this.options.onFriendRequest({post_type:'request',request_type:'friend',self_id:this.accountId,user_id:userId,time:Math.floor(now/1000),comment:'SYNTHETIC_PRIVATE_REQUEST_COMMENT',flag:'SYNTHETIC_PRIVATE_REQUEST_FLAG'},{client:this,generation:this.generation});}
  }
  class InjectedOwnerFriendSetup extends ownerFriendModule.OwnerFriendSetup{constructor(options){super({...options,now:()=>now,clientFactory:value=>new InertClient(value)});}}
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}},ipcMain:{handle(name,fn){assert(!handlers.has(name));handlers.set(name,fn);}}}
      :id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}
      :id==='./bot/qq-owner-friend-setup.cjs'?{...ownerFriendModule,OwnerFriendSetup:InjectedOwnerFriendSetup}:fromMain(id)};
  const hideLine=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])win.on(event,()=>void closeOwnerFriendSetup()"));
  const accountLine=source.split('\n').find(line=>line.includes("register('accountConnect'"));
  const botLine=source.split('\n').find(line=>line.includes("register('botConnect'"));
  const connectFunction=source.match(/const connectCompanion=id=>\{[\s\S]*?\n    \};/)?.[0];
  assert(hideLine&&accountLine&&botLine&&connectFunction,'Actual production lifecycle bindings must be exercised');
  vm.runInNewContext(source+`\nmodule.exports={registerOwnerFriendHandlers,captureOwnerFriendSetup,verifyOwnerFriendSetup,ownerFriendSetup,closeOwnerFriendSetup,publish,fullSnapshot,stopping:qqStopping,setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},setQuitting:value=>quitting=value,bindLifecycle:()=>{${connectFunction}\n${hideLine}\n${accountLine}\n${botLine}\n}};`,context,{filename:main});
  const api=context.module.exports;api.setup(service,accounts,win,qqConsole);api.registerOwnerFriendHandlers();api.bindLifecycle();
  const event={sender:win.webContents,senderFrame:win.webContents.mainFrame},input={accountId:'whale',panelId:PANEL};
  const invoke=(suffix,value=input,override=event)=>handlers.get(`arcade:qqOwnerFriend${suffix}`)(override,value);
  t.after(async()=>{connectHold?.resolve();proofHold?.resolve();writeHold?.resolve();await api.ownerFriendSetup.close();});
  return {api,service,accounts,connection,runtime,qqConsole,win,clients,writes,proofs,messages,events,input,invoke,handlers,event,
    emit:name=>{for(const fn of windowEvents[name]||[])fn();},set connectHold(value){connectHold=value;},set proofHold(value){proofHold=value;},set proofFailure(value){proofFailure=value;},set writeHold(value){writeHold=value;},set writeOutcome(value){writeOutcome=value;},set role(value){role=value;},get connects(){return connects;}};
}

test('five trusted main IPC handlers expose an owner-only management connection without AI',async t=>{
  const f=fixture(t);assert.equal([...f.handlers.keys()].filter(key=>key.startsWith('arcade:qqOwnerFriend')).length,5);
  for(const event of [{sender:{},senderFrame:f.event.senderFrame},{sender:f.event.sender,senderFrame:{url:f.event.senderFrame.url}},{sender:f.event.sender,senderFrame:f.event.senderFrame}]){
    if(event.sender===f.event.sender&&event.senderFrame===f.event.senderFrame)continue;
    await assert.rejects(f.invoke('Availability',f.input,event),/Untrusted sender/);
  }
  const available=await f.invoke('Availability');assert.equal(available.ok,true);assert.equal(available.available,true);assert.equal(f.proofs.length,0);assert.equal(f.clients.length,0);
  const start=await f.invoke('Start');assert.equal(start.ok,true);assert.equal(start.status,'listening');assert.equal(start.inbox.items.length,0);assert.equal(f.proofs.length,2);assert.equal(f.clients[0].options.receiveOwnerMessages,false);assert.equal(f.clients[0].options.allowOwnerVoice,false);
  f.clients[0].receive('300001');assert.equal((await f.invoke('Read')).inbox.items.length,0);f.clients[0].receive();const read=await f.invoke('Read');assert.equal(read.inbox.items.length,1);assert.equal(read.inbox.items[0].applicantId,'200001');assert.equal(read.inbox.complete,false);
  assert.doesNotMatch(JSON.stringify(read),/SYNTHETIC_PRIVATE_BRIDGE_TOKEN|SYNTHETIC_PRIVATE_REQUEST_FLAG|ws:\/\//);assert.equal(f.service.status,'disconnected');assert.equal(f.connects,0);
});

test('main rejects hidden, unselected, active, unverified or ambiguous contexts before creating clients',async t=>{
  const changes=[f=>f.win.visible=false,f=>f.win.minimized=true,f=>f.api.setQuitting(true),f=>f.accounts.selectedId='other',f=>f.service.status='connected',f=>f.service.credentialState='locked',f=>f.qqConsole.state.instances[0].login.accountId='300001',f=>f.qqConsole.state.instances[0].login.online=false,f=>f.qqConsole.state.instances[0].processRunning=false,f=>f.qqConsole.state.instances[0].bridges.push({...f.qqConsole.state.instances[0].bridges[0]}),f=>f.connection.token='SYNTHETIC_OTHER_BRIDGE_TOKEN',f=>f.qqConsole.busy.add('qq-components'),f=>f.api.stopping.add('100001')];
  for(const change of changes){const f=fixture(t);change(f);assert.equal((await f.invoke('Availability')).available,false);assert.equal((await f.invoke('Start')).ok,false);assert.equal(f.clients.length,0);assert.equal(f.proofs.length,0);}
});

test('fresh runtime proof discards scope changes after its await and never opens a temporary client',async t=>{
  for(const change of [f=>f.service.generation++,f=>f.role='different',f=>f.qqConsole.epoch++,f=>f.qqConsole.installationSettings.current={kind:'legacy'},f=>f.qqConsole.runtime={},f=>f.qqConsole.clients.get('100001').endpointId='different',f=>f.connection.token='SYNTHETIC_CHANGED_TOKEN',f=>f.qqConsole.state.instances[0].runtimeRevision='different',f=>f.accounts.selectedId='other']){
    const f=fixture(t),hold=defer();f.proofHold=hold;const pending=f.invoke('Start');await tick();assert.equal(f.proofs.length,1);change(f);hold.resolve();const result=await pending;assert.equal(result.ok,false);assert.equal(f.clients.length,0);assert.equal(f.writes.length,0);
  }
});

test('changes while connecting close the exact temporary client without opening AI',async t=>{
  const f=fixture(t),hold=defer();f.connectHold=hold;const pending=f.invoke('Start');await tick();assert.equal(f.clients.length,1);f.service.generation++;hold.resolve();const result=await pending;assert.equal(result.ok,false);assert.equal(f.clients[0].closed,true);assert.equal(f.api.ownerFriendSetup.session,null);assert.equal(f.connects,0);
});

test('unsupported request fields and non-boolean decisions cannot create a capability or write',async t=>{
  const f=fixture(t);for(const patch of [{url:'ws://127.0.0.1:9999'},{ownerId:'300001'},{flag:'SYNTHETIC_RAW_FLAG'},{panelId:'not-a-uuid'}])assert.equal((await f.invoke('Start',{...f.input,...patch})).code,'invalid_request');
  await f.invoke('Start');f.clients[0].receive();const requestId=(await f.invoke('Read')).inbox.items[0].requestId;
  for(const approve of [1,'true',null])assert.equal((await f.invoke('Decide',{...f.input,requestId,approve})).code,'invalid_request');assert.equal(f.writes.length,0);
});

test('a management operation beginning during decision verification prevents submission',async t=>{
  const f=fixture(t);await f.invoke('Start');f.clients[0].receive();const requestId=(await f.invoke('Read')).inbox.items[0].requestId,hold=defer();f.proofHold=hold;
  const pending=f.invoke('Decide',{...f.input,requestId,approve:false});await tick();f.qqConsole.busy.add('qq-setup');hold.resolve();const result=await pending;assert.equal(result.ok,true);assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'operation_in_progress');assert.equal(f.writes.length,0);
});

test('accepted and unknown submissions retain captured identities after close and are never replayed',async t=>{
  for(const outcome of ['accepted','unknown']){const f=fixture(t);f.writeOutcome=outcome;await f.invoke('Start');f.clients[0].receive();const requestId=(await f.invoke('Read')).inbox.items[0].requestId,hold=defer();f.writeHold=hold;
    const input={...f.input,requestId,approve:true},pending=f.invoke('Decide',input);await tick();assert.equal(f.writes.length,1);const closing=f.invoke('Close');f.win.visible=false;f.api.publish();hold.resolve();const result=await pending;await closing;
    assert.equal(result.ok,true);assert.equal(result.outcome,outcome);assert.equal(result.accountId,'whale');assert.equal(result.panelId,PANEL);assert.equal(result.qqAccountId,'100001');assert.equal(result.ownerId,'200001');assert.equal(f.writes.length,1);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE/);
    f.win.visible=true;assert.equal((await f.invoke('Decide',input)).ok,false);assert.equal(f.writes.length,1);assert.equal(f.connects,0);
  }
});

test('hide and minimize close only the current session, and reopening creates a usable new session',async t=>{
  for(const name of ['hide','minimize']){const f=fixture(t);await f.invoke('Start');f.emit(name);await f.api.ownerFriendSetup.retiring;assert.equal(f.api.ownerFriendSetup.closed,false);assert.equal(f.clients[0].closed,true);
    const next={...f.input,panelId:PANEL2};assert.equal((await f.invoke('Start',next)).ok,true);assert.equal((await f.invoke('Close',f.input)).closed,true);assert.equal(f.clients[1].closed,false);assert.equal((await f.invoke('Read',next)).status,'listening');}
});

test('snapshot observation revokes changed management context without broadcasting request data',async t=>{
  const f=fixture(t);await f.invoke('Start');f.clients[0].receive();f.service.generation++;f.api.publish();await f.api.ownerFriendSetup.retiring;assert.equal(f.api.ownerFriendSetup.session,null);assert.equal(f.clients[0].closed,true);
  assert.doesNotMatch(JSON.stringify(f.messages),/SYNTHETIC_PRIVATE|requestId|owner-friend-setup/);assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/SYNTHETIC_PRIVATE|requestId|owner-friend-setup/);
});

test('normal AI connect waits for temporary management retirement; selection changes block old bot connect',async t=>{
  for(const channel of ['accountConnect','botConnect']){const f=fixture(t);await f.invoke('Start');f.clients[0].receive();const requestId=(await f.invoke('Read')).inbox.items[0].requestId,hold=defer();f.writeHold=hold;
    const deciding=f.invoke('Decide',{...f.input,requestId,approve:true});await tick();const connecting=f.handlers.get(`arcade:${channel}`)(f.event,'whale');await tick();assert.equal(f.connects,0);assert.equal(f.clients[0].closed,true);
    if(channel==='botConnect')f.accounts.selectedId='other';hold.resolve();await deciding;
    if(channel==='botConnect')await assert.rejects(connecting,{code:'changed'});else{await connecting;assert.equal(f.connects,1);}
  }
});

test('quit permanently closes only the temporary listener and does not decide outstanding requests',async t=>{
  const f=fixture(t);await f.invoke('Start');f.clients[0].receive();let prevented=false;f.events['before-quit']({preventDefault(){prevented=true;}});assert.equal(prevented,true);await f.api.ownerFriendSetup.retiring;assert.equal(f.api.ownerFriendSetup.closed,true);assert.equal(f.clients[0].closed,true);assert.equal(f.writes.length,0);assert.equal(f.connects,0);
});

test('preload forwards only the five fixed management channels and errors omit raw details',async t=>{
  const f=fixture(t),calls=[],exposed={};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld(name,value){exposed[name]=value;}},ipcRenderer:{invoke:(...value)=>{calls.push(value);}}};}});
  for(const action of ['Availability','Start','Read','Decide','Close'])exposed.arcade[`qqOwnerFriend${action}`](f.input);assert.equal(calls.length,5);assert(calls.every(([channel,input])=>channel.startsWith('arcade:qqOwnerFriend')&&input===f.input));
  f.proofFailure=Object.assign(Error('SYNTHETIC_PRIVATE_PATH_TOKEN'),{code:'private_but_valid_code'});const result=await f.invoke('Start');assert.equal(result.code,'invalid_response');assert.doesNotMatch(JSON.stringify(result),/PRIVATE|private_but/);
});
