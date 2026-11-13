'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {EventEmitter}=require('node:events');
const {QQOwnerRemarkSession}=require('../src/bot/qq-owner-remark-session.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
function harness(){
  const messages=[],events={},client={ready:true,closed:false,generation:1,accountId:'100001',ownerId:'200001',socket:{readyState:1},
    async readOwnerRemark(_signal,{assertCurrent}){assertCurrent();return {accountId:this.accountId,ownerId:this.ownerId,nickname:'PRIVATE_NICKNAME',remark:'PRIVATE_REMARK',fetchedAt:new Date().toISOString(),source:'bridge-cache'};}};
  const service={status:'connected',client,config:{channel:'qq',mode:'deepseek',qqAccountId:'100001',qqOwnerId:'200001',qqUrl:'ws://127.0.0.1:3001'},secret:{qqToken:'SYNTHETIC_PRIVATE_BRIDGE_TOKEN'},socialStore:{config:()=>({enabled:true,name:'鲸鱼娘',characterId:'synthetic-whale'})},generation:1,
    imageBinding(){if(this.status!=='connected')throw Object.assign(Error('PRIVATE'),{code:'disconnected'});return {status:this.status,channel:'qq',generation:this.generation,scopeId:'private-root:whale',accountId:client.accountId,ownerId:client.ownerId,role:'鲸鱼娘',client};},
    snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};}};
  const accounts={selectedId:'whale',get(id){if(id!=='whale')throw Error('PRIVATE');return service;},snapshot(){return {selectedId:this.selectedId,accounts:[]};},async close(){}};
  const runtime={async getConnection(){return {ownershipVerified:true,endpointId:'synthetic-endpoint'};}};
  const qqConsole={state:{instances:[{accountId:'100001',processRunning:true,login:{identityVerified:true,accountId:'100001',online:true},runtimeRevision:'synthetic-revision',bridges:[{serverName:'synthetic',enabled:true,loopbackOnly:true,hasToken:true,port:3001}]}]},runtime,epoch:0,busy:new Set(),closed:false,installationSettings:{current:{kind:'legacy'}},clients:new Map([['100001',{publicId:'synthetic-revision',endpointId:'synthetic-endpoint'}]]),check(r,e){if(r!==this.runtime||e!==this.epoch)throw Object.assign(Error('Synthetic changed'),{code:'changed'});},profiles(){return {connection:()=>({accountId:'100001',url:service.config.qqUrl,token:service.secret.qqToken,serverName:'synthetic'})};},snapshot(){return this.state;},async close(){}};
  class InertRemarkClient{
    constructor(options){Object.assign(this,options,{generation:1,ready:false,closed:false,accountId:options.expectedAccountId,socket:new EventEmitter()});this.socket.readyState=1;}
    async connect(signal){if(signal.aborted)throw Object.assign(Error('Synthetic cancelled'),{code:'cancelled'});this.ready=true;}
    close(){if(this.closed)return;this.closed=true;this.ready=false;this.socket.readyState=3;this.socket.emit('close');}
    readOwnerRemark(...args){return client.readOwnerRemark.apply(this,args);}
    async setOwnerRemark(){throw Error('No synthetic writes expected.');}
  }
  // VM-only envelope normalization; real main and modules share one realm.
  class InjectedSession extends QQOwnerRemarkSession{constructor(options){super({...options,capture:value=>({...options.capture(value)}),verifyContext:async(...args)=>({...await options.verifyContext(...args)}),clientFactory:options=>new InertRemarkClient(options)});}}
  const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed(){return false;},webContents:{send(_topic,value){messages.push(value);}}};
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:id==='./bot/qq-owner-remark-session.cjs'?{QQOwnerRemarkSession:InjectedSession}:fromMain(id)};
  vm.runInNewContext(source+'\nmodule.exports={captureOwnerRemark,ownerRemarkPanel,publish,fullSnapshot,setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},stopping:qqStopping};',context,{filename:main});
  const api=context.module.exports;api.setup(service,accounts,win,qqConsole);
  return {api,service,accounts,qqConsole,win,client,messages,events,request:{accountId:'whale',panelId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}};
}
test('main owner capability requires saved exact QQ and observed runtime, without contact reads',()=>{
  const f=harness();assert.equal(f.api.ownerRemarkPanel.availability(f.request).available,true);assert.equal(f.messages.length,0);
  f.accounts.selectedId='other';assert.equal(f.api.ownerRemarkPanel.availability(f.request).reason,'changed');f.accounts.selectedId='whale';
  f.qqConsole.state.instances=[{accountId:'300001'}];assert.equal(f.api.ownerRemarkPanel.availability(f.request).available,false);
});
test('target/global runtime mutations block contact writes while another account operation does not',()=>{
  const f=harness();for(const marker of ['100001','qq-components','qq-orphan-cleanup']){f.qqConsole.busy.add(marker);assert.throws(()=>f.api.captureOwnerRemark(f.request),{code:'operation_in_progress'});f.qqConsole.busy.clear();}
  f.api.stopping.add('100001');assert.throws(()=>f.api.captureOwnerRemark(f.request),{code:'operation_in_progress'});f.api.stopping.clear();
  f.qqConsole.busy.add('300001');assert.equal(f.api.captureOwnerRemark(f.request).qqAccountId,'100001');
});
test('main lifecycle observation discards private panel data after service generation, runtime epoch or visibility changes',async()=>{
  for(const change of [f=>f.service.generation++,f=>f.qqConsole.epoch++,f=>{f.qqConsole.runtime={};},f=>{f.win.visible=false;},f=>{f.win.minimized=true;},f=>{f.service.status='disconnected';}]){
    const f=harness();const baseline=await f.api.ownerRemarkPanel.read(f.request);assert.equal(baseline.observed.remark,'PRIVATE_REMARK');change(f);f.api.publish();assert.equal(f.api.ownerRemarkPanel.session,null);await f.api.ownerRemarkPanel.close();
    assert.doesNotMatch(JSON.stringify(f.messages),/PRIVATE_REMARK|PRIVATE_NICKNAME|ticketId|private-root/);
  }
});
test('main snapshot omits remark baselines, names, tickets and private restore values while a panel is open',async()=>{
  const f=harness();await f.api.ownerRemarkPanel.read(f.request);const data=f.api.fullSnapshot();assert.doesNotMatch(JSON.stringify(data),/PRIVATE_REMARK|PRIVATE_NICKNAME|ticketId|private-root/);await f.api.ownerRemarkPanel.close();
});
test('before-quit closes the owned remark panel without creating a QQ write or persisting contact data',async()=>{
  const f=harness();await f.api.ownerRemarkPanel.read(f.request);let prevented=false;f.events['before-quit']({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(f.api.ownerRemarkPanel.session,null);await f.api.ownerRemarkPanel.close();
});
test('only the five fixed remark routes are exposed; window and account lifecycle paths clear the panel',()=>{
  const preload=fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8');
  for(const method of ['Availability','Read','Set','Restore','Close']){
    assert(preload.includes(`qqOwnerRemark${method}: value => ipcRenderer.invoke('arcade:qqOwnerRemark${method}',value)`));
    assert(source.includes(`register('qqOwnerRemark${method}',value=>ownerRemarkResult(`));
  }
  assert(!preload.includes('set_friend_remark'));assert(!preload.includes('friendId'));
  for(const event of ['hide','minimize'])assert(source.includes(`win.on('${event}',()=>void Promise.allSettled([closeImages(),closeQQVoices(),ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),friendRequestsPanel.close(),firstSetupPanel.close()]))`));
});
