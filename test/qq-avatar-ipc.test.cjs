'use strict';
// Production main IPC + avatar session, synthetic native picker/client, real temp files.
// No real QQ account, model or user picture participates in these boundary checks.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),{EventEmitter}=require('node:events');
const avatarModule=require('../src/bot/qq-avatar-session.cjs'),{png,native}=require('./helpers/fixture-image.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',PANEL2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tick=()=>new Promise(resolve=>setImmediate(resolve)),defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
function fixture(t){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-avatar-ipc-')),file=path.join(temp,'synthetic.png'),uploadRoot=path.join(temp,'uploads');fs.writeFileSync(file,png());
 const handlers=new Map(),events={},windowEvents={},clients=[],requests=[],pickers=[];let pickerHold=null,proofHold=null,pickerError=null,pickerCancel=false,avatarResult=null;
 const service={status:'disconnected',credentialState:'ready',generation:1,config:{channel:'qq',mode:'deepseek',qqAccountId:'100001',qqOwnerId:'200001',qqUrl:'ws://127.0.0.1:3001'},secret:{qqToken:'SYNTHETIC_AVATAR_BRIDGE_TOKEN'},socialStore:{config:()=>({characterId:'deepseek-whale'})}};
 const accounts={selectedId:'whale',get(id){if(id!=='whale')throw Error('Synthetic wrong profile');return service;},async close(){}};
 const connection={accountId:'100001',serverName:'agent-arcade',url:service.config.qqUrl,token:service.secret.qqToken};
 const runtime={async getConnection(){await proofHold?.promise;return {ownershipVerified:true,endpointId:'synthetic-endpoint'};}};
 const qqConsole={runtime,epoch:1,closed:false,busy:new Set(),installationSettings:{current:{kind:'legacy'}},state:{instances:[{accountId:'100001',processRunning:true,login:{identityVerified:true,online:true,accountId:'100001'},runtimeRevision:'synthetic-revision',bridges:[{serverName:'agent-arcade',enabled:true,loopbackOnly:true,hasToken:true,port:3001}]}]},clients:new Map([['100001',{publicId:'synthetic-revision',endpointId:'synthetic-endpoint'}]]),profiles:()=>({connection:()=>({...connection})}),check(r,e){if(this.runtime!==r||this.epoch!==e)throw Object.assign(Error('Synthetic changed'),{code:'changed'});},async close(){}};
 const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},on(name,fn){(windowEvents[name]||=[]).push(fn);},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href}}};
 class Client{
  constructor(options){this.options=options;this.receiveOwnerMessages=options.receiveOwnerMessages;this.accountId=this.expectedAccountId=options.expectedAccountId;this.ownerId=options.ownerId;this.ready=false;this.closed=false;this.generation=1;this.socket=new EventEmitter();this.socket.readyState=1;clients.push(this);}
  async connect(signal){if(signal.aborted)throw Object.assign(Error('Synthetic cancelled'),{code:'cancelled'});this.ready=true;}
  close(){if(this.closed)return;this.closed=true;this.ready=false;this.socket.readyState=3;this.socket.emit('close');}
  async _request(action,params,signal){if(signal?.aborted)throw Object.assign(Error('Synthetic cancelled'),{code:'cancelled'});requests.push({action,params});if(action==='get_login_info')return {user_id:'100001'};if(action==='get_status')return {online:true,good:true};if(action==='set_qq_avatar'){assert.equal(path.dirname(params.file),uploadRoot);assert(fs.existsSync(params.file));return avatarResult;}throw Error('Unexpected action');}
 }
 class InjectedAvatar extends avatarModule.QQAvatarSession{constructor(options){super({...options,clientFactory:o=>new Client(o),nativeImage:native(),uploadRoot});}}
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
  require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}},ipcMain:{handle(name,fn){assert(!handlers.has(name));handlers.set(name,fn);}},dialog:{async showOpenDialog(target,options){assert.equal(target,win);pickers.push(options);await pickerHold?.promise;if(pickerError)throw pickerError;return pickerCancel?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[file]};}}}
   :id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:id==='./bot/qq-avatar-session.cjs'?{...avatarModule,QQAvatarSession:InjectedAvatar}:fromMain(id)};
 const hideLine=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])win.on(event,()=>void avatarPanel.closeCurrent()"));assert(hideLine);
 vm.runInNewContext(source+`\nmodule.exports={registerAvatarHandlers,avatarPanel,setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},setImagePicker:value=>imagePickerBusy=value,bindLifecycle:()=>{${hideLine}}};`,context,{filename:main});
 const api=context.module.exports;api.setup(service,accounts,win,qqConsole);api.registerAvatarHandlers();api.bindLifecycle();const event={sender:win.webContents,senderFrame:win.webContents.mainFrame},input={accountId:'whale',panelId:PANEL};
 const invoke=(name,value=input,e=event)=>handlers.get('arcade:qqAvatar'+name)(e,value);
 t.after(async()=>{pickerHold?.resolve();proofHold?.resolve();await api.avatarPanel.close();fs.rmSync(temp,{recursive:true,force:true});});
 return {api,service,accounts,win,event,input,invoke,clients,requests,pickers,file,uploadRoot,handlers,events,emit(name){for(const fn of windowEvents[name]||[])fn();},set pickerHold(v){pickerHold=v;},set proofHold(v){proofHold=v;},set pickerError(v){pickerError=v;},set pickerCancel(v){pickerCancel=v;},set avatarResult(v){avatarResult=v;}};
}
test('actual main avatar entry opens only its own request socket without an AI connection',async t=>{
 const f=fixture(t);assert.equal(fs.existsSync(f.uploadRoot),false);assert.equal(f.handlers.size,6);await assert.rejects(f.invoke('Read',f.input,{sender:{},senderFrame:f.event.senderFrame}),/Untrusted sender/);
 const read=await f.invoke('Read');assert.equal(read.ok,true);assert.equal(read.qqAccountId,'100001');assert.equal(read.kind,'qq-avatar');assert.equal(read.profile.currentAvatar.state,'unavailable');assert.equal(f.clients[0].options.receiveOwnerMessages,false);assert.equal(f.clients[0].options.allowOwnerVoice,false);assert.equal(f.clients[0].options.onFriendRequest,undefined);assert.equal(f.service.status,'disconnected');await f.invoke('Close');assert.equal(f.clients[0].closed,true);
});
test('main rejects arbitrary file, target or token inputs before opening the picker',async t=>{
 const f=fixture(t);await f.invoke('Read');for(const extra of [{file:f.file},{qqAccountId:'300001'},{url:'file:///private.png'},{token:'PRIVATE'}]){assert.equal((await f.invoke('Pick',{...f.input,...extra})).code,'invalid_request');}assert.equal(f.pickers.length,0);assert(!f.requests.some(r=>r.action==='set_qq_avatar'));
});
test('actual picker keeps original intact and cancellation consumes the previous preview',async t=>{
 const f=fixture(t);await f.invoke('Read');const before=fs.readFileSync(f.file),pick=await f.invoke('Pick');assert.equal(pick.ok,true);assert(pick.draft.preview.startsWith('data:image/png;base64,'));assert(!JSON.stringify(pick).includes(f.file));assert.equal(f.pickers[0].filters[0].extensions.join('|'),'png|jpg|jpeg');assert(fs.readFileSync(f.file).equals(before));f.pickerCancel=true;assert.equal((await f.invoke('Pick')).cancelled,true);assert.equal((await f.invoke('Confirm',{...f.input,ticketId:pick.draft.ticketId})).code,'stale_ticket');
});
test('closing while the native picker is open prevents a late picture from becoming a ticket',async t=>{
 const f=fixture(t);await f.invoke('Read');const hold=defer();f.pickerHold=hold;const picked=f.invoke('Pick');await tick();assert.equal(f.pickers.length,1);const closing=f.invoke('Close');hold.resolve();assert.equal((await picked).ok,false);await closing;assert.equal(f.api.avatarPanel.session,null);assert(!f.requests.some(r=>r.action==='set_qq_avatar'));assert.equal(fs.readdirSync(f.uploadRoot).length,0);
});
test('native picker is mutually exclusive with an existing image picker and errors are redacted',async t=>{
 const f=fixture(t);await f.invoke('Read');f.api.setImagePicker(true);assert.equal((await f.invoke('Pick')).code,'operation_in_progress');assert.equal(f.pickers.length,0);f.api.setImagePicker(false);f.pickerError=Error('SYNTHETIC_PRIVATE_PATH_AND_TOKEN');const result=await f.invoke('Pick');assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|TOKEN/);
});
test('changed verified runtime before confirm submits nothing and consumes the preview',async t=>{
 const f=fixture(t);await f.invoke('Read');const p=await f.invoke('Pick'),hold=defer();f.proofHold=hold;const write=f.invoke('Confirm',{...f.input,ticketId:p.draft.ticketId});await tick();f.service.generation++;hold.resolve();const result=await write;assert.equal(result.change.outcome,'not_submitted');assert(!f.requests.some(r=>r.action==='set_qq_avatar'));
});
test('actual main confirm submits one private file and removes only that upload after explicit success',async t=>{
 const f=fixture(t);await f.invoke('Read');const p=await f.invoke('Pick'),value={...f.input,ticketId:p.draft.ticketId};const changed=await f.invoke('Confirm',value);assert.equal(changed.change.outcome,'accepted');assert.equal(changed.change.acknowledgement,'bridge-reported-success');assert.equal(changed.change.visibleResult,'unverified');assert.equal(changed.change.temporaryFile,'removed');assert.equal(f.requests.filter(r=>r.action==='set_qq_avatar').length,1);assert.equal((await f.invoke('Confirm',value)).code,'stale_ticket');assert.equal(fs.readdirSync(f.uploadRoot).length,0);assert(fs.existsSync(f.file));
});
test('unknown receipt retains a private upload and explicit cleanup does not resubmit it',async t=>{
 const f=fixture(t);await f.invoke('Read');const p=await f.invoke('Pick');f.avatarResult={};const changed=await f.invoke('Confirm',{...f.input,ticketId:p.draft.ticketId});assert.equal(changed.change.outcome,'unknown');assert.equal(changed.change.temporaryFile,'retained');assert.equal(fs.readdirSync(f.uploadRoot).length,2);const cleaned=await f.invoke('Cleanup');assert.equal(cleaned.cleanup.removed,1);assert.equal(f.requests.filter(r=>r.action==='set_qq_avatar').length,1);assert(fs.existsSync(f.file));
});
test('hide/minimize closes only the owned session and old panel close leaves a replacement intact',async t=>{
 for(const name of ['hide','minimize']){const f=fixture(t);await f.invoke('Read');f.emit(name);await f.api.avatarPanel.retiring;assert.equal(f.clients[0].closed,true);const next={...f.input,panelId:PANEL2};assert.equal((await f.invoke('Read',next)).ok,true);await f.invoke('Close',f.input);assert.equal(f.clients[1].closed,false);assert.equal(f.service.status,'disconnected');}
});
test('actual main close during pending proof creates no client; preload exposes only fixed avatar IPC',async t=>{
 const f=fixture(t),hold=defer();f.proofHold=hold;const read=f.invoke('Read');await tick();const closing=f.invoke('Close');hold.resolve();assert.equal((await read).ok,false);await closing;assert.equal(f.clients.length,0);
 const exposed={},calls=[];vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld(n,v){exposed[n]=v;}},ipcRenderer:{invoke:(...args)=>calls.push(args)}})});for(const name of ['Read','Pick','Confirm','Dismiss','Cleanup','Close'])exposed.arcade['qqAvatar'+name](f.input);assert.equal(calls.length,6);assert(calls.every(([channel,input])=>channel.startsWith('arcade:qqAvatar')&&input===f.input));
});
