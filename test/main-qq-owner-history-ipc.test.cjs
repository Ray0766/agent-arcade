'use strict';
// Actual production main registration/lifecycle with its session and transport.
// Native QQ, Electron and credentials are inert.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),{EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'..'),historyModule=require('../src/bot/qq-owner-history-session.cjs');
const main=path.join(root,'src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main),PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(t){
 const handlers=new Map(),windowEvents={},clients=[],requests=[],messages=[];let hold=null;
 const ai={ready:true,closed:false};const service={client:ai,status:'disconnected',credentialState:'ready',generation:1,config:{channel:'qq',mode:'deepseek',qqAccountId:'100001',qqOwnerId:'200001',qqUrl:'ws://127.0.0.1:3001'},secret:{qqToken:'SYNTHETIC_PRIVATE_TOKEN'},socialStore:{config:()=>({characterId:'deepseek-whale'})},snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};}};
 const accounts={selectedId:'whale',get(id){if(!['whale','next'].includes(id))throw Error('invalid');return service;},select(id){this.selectedId=id;return service;},snapshot(){return {selectedId:this.selectedId,accounts:[]};},disconnect:async()=>{service.status='disconnected';service.generation++;},close:async()=>{}};
 const runtime={async getConnection(){return {ownershipVerified:true,endpointId:'synthetic-endpoint'};}};
 const qqConsole={runtime,epoch:1,closed:false,busy:new Set(),installationSettings:{current:{kind:'legacy'}},state:{instances:[{accountId:'100001',processRunning:true,login:{identityVerified:true,online:true,accountId:'100001'},runtimeRevision:'synthetic-revision',bridges:[{serverName:'agent-arcade',enabled:true,loopbackOnly:true,hasToken:true,port:3001}]}]},clients:new Map([['100001',{publicId:'synthetic-revision',endpointId:'synthetic-endpoint'}]]),profiles(){return {connection:()=>({accountId:'100001',serverName:'agent-arcade',url:'ws://127.0.0.1:3001',token:service.secret.qqToken})};},check(r,e){if(this.runtime!==r||this.epoch!==e||this.closed)throw Object.assign(Error('changed'),{code:'changed'});},snapshot(){return this.state;},close:async()=>{}};
 const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed:()=>false,on(name,fn){(windowEvents[name]||=[]).push(fn);},webContents:{mainFrame:{url:pathToFileURL(path.join(root,'src/ui/index.html')).href},send(_name,value){messages.push(value);}}};
 class InertClient{
  constructor(options){Object.assign(this,options);this.ready=false;this.closed=false;this.generation=1;this.accountId=options.expectedAccountId;this.socket=new EventEmitter();this.socket.readyState=1;clients.push(this);}
  async connect(signal){if(signal.aborted)throw Object.assign(Error('aborted'),{code:'aborted'});this.ready=true;}
  close(){if(this.closed)return;this.closed=true;this.ready=false;this.socket.readyState=3;this.socket.emit('close');}
  async _request(action,params,signal){requests.push({action,params});if(action==='get_login_info')return {user_id:this.accountId};if(action==='get_status')return {online:true,good:true};if(action==='get_friend_list')return [{user_id:this.ownerId}];if(action==='send_private_msg'){if(hold)await hold;if(signal.aborted)throw Object.assign(Error('aborted'),{code:'aborted'});return {message_id:124};}assert.equal(action,'get_friend_msg_history');if(hold)await hold; if(signal.aborted)throw Object.assign(Error('aborted'),{code:'aborted'});return {messages:[{self_id:this.accountId,user_id:this.ownerId,sender:{user_id:this.ownerId},message_type:'private',sub_type:'friend',message_id:123,real_seq:'99',time:1700000000,message:[{type:'text',data:{text:'SYNTHETIC_PRIVATE_HISTORY'}}]}]};}
 }
 class Injected extends historyModule.QQOwnerHistorySession{constructor(options){super({...options,capture:v=>({...options.capture(v)}),verifyContext:async(...args)=>({...await options.verifyContext(...args)}),clientFactory:o=>new InertClient(o)});}}
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle(name,fn){assert(!handlers.has(name));handlers.set(name,fn);}}}:id==='./core/files.cjs'?{readJSON:(_f,f)=>f,atomicJSON(){},drainInbox:()=>[]}:id==='./bot/qq-owner-history-session.cjs'?{...historyModule,QQOwnerHistorySession:Injected}:fromMain(id)};
 const registration=source.split('\n').filter(line=>line.includes("register('qqOwnerHistory"));assert.equal(registration.length,8);
 const life=source.split('\n').filter(line=>line.includes('ownerHistorySession.closeCurrent()')&&(line.includes("win.on('hide',")||line.includes("win.on('minimize',")||line.includes("register('accountSelect',")||line.includes("register('accountDisconnect',")));assert.equal(life.length,4);
 vm.runInNewContext(source+`\nmodule.exports={ownerHistorySession,publish,setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},bind:()=>{${registration.join('\n')}\n${life.join('\n')}}};`,context,{filename:main});const api=context.module.exports;api.setup(service,accounts,win,qqConsole);api.bind();const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 const input={accountId:'whale',panelId:PANEL};const invoke=(name,value,ev=event)=>handlers.get('arcade:'+name)(ev,value);t.after(async()=>{hold=null;await api.ownerHistorySession.close();});return {api,clients,requests,messages,accounts,service,qqConsole,win,ai,input,invoke,event,emit:name=>{for(const f of windowEvents[name]||[])f();},setHold:p=>{hold=p;}};
}
test('actual registered IPC uses shared production capture/verification and main-frame trust',async t=>{const f=fixture(t);await assert.rejects(f.invoke('qqOwnerHistoryRead',{...f.input,cursor:null},{sender:{},senderFrame:f.event.senderFrame}),/Untrusted/);assert.equal(f.clients.length,0);const result=await f.invoke('qqOwnerHistoryRead',{...f.input,cursor:null});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.page.rows[0].parts[0].text,'SYNTHETIC_PRIVATE_HISTORY');assert.equal(f.clients[0].receiveOwnerMessages,false);assert.equal(f.ai.closed,false);assert(!JSON.stringify(f.messages).includes('SYNTHETIC_PRIVATE_HISTORY'));await f.invoke('qqOwnerHistoryClose',f.input);assert.equal(f.clients[0].closed,true);});
test('actual hide, minimize and account selection retire pending/read history',async t=>{for(const mode of ['hide','minimize','select']){const f=fixture(t);let release;f.setHold(new Promise(r=>{release=r;}));const pending=f.invoke('qqOwnerHistoryRead',{...f.input,cursor:null});for(let waited=0;!f.requests.some(r=>r.action==='get_friend_msg_history');waited++){if(waited>1000)throw Error('Synthetic history read never entered');await tick();}let ended;if(mode==='hide'){f.win.visible=false;f.emit('hide');}else if(mode==='minimize'){f.win.minimized=true;f.emit('minimize');}else ended=f.invoke('accountSelect','next');release();const result=await pending;await ended;await f.api.ownerHistorySession.retiring;assert.equal(result.ok,false,mode);assert.equal(f.clients[0].closed,true,mode);assert.equal(f.ai.closed,false,mode);assert(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_HISTORY'));}});
test('actual accountDisconnect and publish observation retire the bound panel only',async t=>{for(const mode of ['disconnect','publish']){const f=fixture(t);await f.invoke('qqOwnerHistoryRead',{...f.input,cursor:null});if(mode==='disconnect')await f.invoke('accountDisconnect','whale');else{f.service.generation++;f.api.publish();}await f.api.ownerHistorySession.retiring;assert.equal(f.clients[0].closed,true,mode);assert.equal(f.ai.closed,false);}});

test('actual Open/Send/Query IPC keeps owner fixed without AI/history and rejects retired panels',async t=>{
 const f=fixture(t),submissionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 await assert.rejects(f.invoke('qqOwnerHistoryOpen',f.input,{sender:{},senderFrame:f.event.senderFrame}),/Untrusted/);
 const opened=await f.invoke('qqOwnerHistoryOpen',f.input);assert.equal(opened.ok,true);assert.equal(f.requests.length,0);
 const r=await f.invoke('qqOwnerHistorySend',{...f.input,submissionId,text:'SYNTHETIC_MANUAL_TEXT'});
 assert.equal(r.ok,true);assert.equal(r.submission.outcome,'accepted');assert.equal(r.ownerId,'200001');
 assert.equal(f.requests.filter(q=>q.action==='send_private_msg').length,1);assert.equal(f.requests.filter(q=>q.action==='get_friend_msg_history').length,0);
 assert.equal(f.ai.closed,false);assert(!JSON.stringify(f.messages).includes('SYNTHETIC_MANUAL_TEXT'));
 assert.equal((await f.invoke('qqOwnerHistorySendQuery',{...f.input,submissionId})).submission.outcome,'accepted');
 await f.invoke('qqOwnerHistoryClose',f.input);
 const late=await f.invoke('qqOwnerHistorySend',{...f.input,submissionId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',text:'LATE'});
 assert.equal(late.ok,false);assert.equal(late.code,'changed');assert.equal(f.requests.filter(q=>q.action==='send_private_msg').length,1);
});
test('actual hide after attempted write yields unknown and closes the owned sender',async t=>{
 const f=fixture(t);await f.invoke('qqOwnerHistoryOpen',f.input);let release;f.setHold(new Promise(r=>{release=r;}));
 const p=f.invoke('qqOwnerHistorySend',{...f.input,submissionId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',text:'SYNTHETIC_PENDING'});
 for(let n=0;!f.requests.some(q=>q.action==='send_private_msg');n++){assert(n<1500);await tick();}
 f.win.visible=false;f.emit('hide');release();const r=await p;assert.equal(r.ok,true);assert.equal(r.submission.outcome,'unknown');
 await f.api.ownerHistorySession.retiring;assert.equal(f.clients[0].closed,true);assert.equal(f.ai.closed,false);assert(!JSON.stringify(f.messages).includes('SYNTHETIC_PENDING'));
});
test('old panel close cannot revoke a newly admitted owner composer',async t=>{
 const f=fixture(t);await f.invoke('qqOwnerHistoryOpen',f.input);const next={...f.input,panelId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'};
 await f.invoke('qqOwnerHistoryOpen',next);await f.invoke('qqOwnerHistoryClose',f.input);
 const r=await f.invoke('qqOwnerHistorySend',{...next,submissionId:'ffffffff-ffff-4fff-8fff-ffffffffffff',text:'NEW_PANEL'});
 assert.equal(r.submission.outcome,'accepted');
});

test('actual three image IPC registrations enforce main-frame trust and the selected history page',async t=>{
 const f=fixture(t),read=await f.invoke('qqOwnerHistoryRead',{...f.input,cursor:null});assert.equal(read.ok,true);
 const pageId=read.page.pageId,requestId='99999999-9999-4999-8999-999999999999',imageId='88888888-8888-4888-8888-888888888888';
 for(const [name,value] of [['qqOwnerHistoryImagePage',{...f.input,pageId}],['qqOwnerHistoryImagePreview',{...f.input,pageId,imageId,requestId}],['qqOwnerHistoryImageClose',{...f.input,pageId,requestId}]])await assert.rejects(f.invoke(name,value,{sender:{},senderFrame:f.event.senderFrame}),/Untrusted/);
 const count=f.requests.length,selected=await f.invoke('qqOwnerHistoryImagePage',{...f.input,pageId});assert.equal(selected.ok,true);assert.equal(selected.selected,true);assert.equal(selected.ownerId,'200001');
 const missing=await f.invoke('qqOwnerHistoryImagePreview',{...f.input,pageId,imageId,requestId});assert.equal(missing.ok,false);assert.equal(missing.code,'changed');assert.equal(f.requests.length,count);
 const injected=await f.invoke('qqOwnerHistoryImagePreview',{...f.input,pageId,imageId,requestId,url:'https://private.invalid'});assert.equal(injected.ok,false);assert.equal(injected.code,'invalid_request');
 assert.equal((await f.invoke('qqOwnerHistoryImageClose',{...f.input,pageId,requestId})).closed,true);assert.equal(f.ai.closed,false);
});

