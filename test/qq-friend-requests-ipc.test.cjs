'use strict';
// Main-process VM harness with a real in-memory inbox; no Electron window or QQ.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {FriendRequestInbox}=require('../src/bot/qq-friend-requests.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main),PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tick=()=>new Promise(resolve=>setImmediate(resolve)),defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
function harness(t){
  const messages=[],events={},calls=[],now=Date.now();
  const client={ready:true,closed:false,generation:1,connectedAt:now,accountId:'100001',ownerId:'200001',socket:{readyState:1},
    async decideFriendRequest(input,{assertCurrent}){await this.gate?.promise;try{assertCurrent();calls.push(input);await this.afterWrite?.promise;return {outcome:'accepted'};}catch(error){return {outcome:'not_submitted',code:error.code};}}};
  const service={status:'connected',config:{channel:'qq',mode:'deepseek'},generation:1,
    imageBinding(){if(this.status!=='connected')throw Object.assign(Error('PRIVATE'),{code:'disconnected'});return {status:this.status,channel:'qq',generation:this.generation,scopeId:'private-root:whale',accountId:client.accountId,ownerId:client.ownerId,role:'鲸鱼娘',client};},
    snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};}};
  service.friendRequests=new FriendRequestInbox({getBinding:()=>service.imageBinding(),now:()=>now});
  const accounts={selectedId:'whale',get(id){if(id!=='whale')throw Error('PRIVATE');return service;},snapshot(){return {selectedId:this.selectedId,accounts:[]};},async close(){}};
  const qqConsole={state:{instances:[{accountId:'100001'}]},runtime:{},epoch:0,busy:new Set(),closed:false,snapshot(){return this.state;},async close(){}};
  const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed(){return false;},webContents:{send(_topic,value){messages.push(value);}}};
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
  vm.runInNewContext(source+'\nmodule.exports={captureFriendRequests,friendRequestsPanel,publish,fullSnapshot,setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},stopping:qqStopping};',context,{filename:main});
  const api=context.module.exports;api.setup(service,accounts,win,qqConsole);
  const input={accountId:'whale',panelId:PANEL},receive=()=>service.friendRequests.receive({post_type:'request',request_type:'friend',self_id:'100001',user_id:'300001',time:Math.floor(now/1000),comment:'PRIVATE_REQUEST_COMMENT',flag:'PRIVATE_REQUEST_FLAG'},{client,generation:client.generation});
  t.after(async()=>{await api.friendRequestsPanel.close();await service.friendRequests?.close();});
  return {api,service,accounts,qqConsole,win,client,messages,events,input,receive,calls};
}
test('main requires a selected verified service, discovered actual QQ and its connection inbox',async t=>{
  const f=harness(t);assert.equal(f.api.captureFriendRequests(f.input).inbox,f.service.friendRequests);assert(f.receive());const result=await f.api.friendRequestsPanel.read(f.input);assert.equal(result.inbox.items.length,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_REQUEST_FLAG|private-root/);
  f.accounts.selectedId='other';assert.throws(()=>f.api.captureFriendRequests(f.input),{code:'changed'});f.accounts.selectedId='whale';f.qqConsole.state.instances=[{accountId:'300001'}];assert.throws(()=>f.api.captureFriendRequests(f.input),{code:'changed'});
  f.qqConsole.state.instances=[{accountId:'100001'}];const inbox=f.service.friendRequests;f.service.friendRequests=null;assert.throws(()=>f.api.captureFriendRequests(f.input),{code:'disconnected'});f.service.friendRequests=inbox;assert.equal(f.calls.length,0);
});
test('target and global management operations block decisions; another unrelated account does not',async t=>{
  const f=harness(t);for(const marker of ['100001','qq-components','qq-orphan-cleanup','qq-setup']){f.qqConsole.busy.add(marker);assert.throws(()=>f.api.captureFriendRequests(f.input),{code:'operation_in_progress'});f.qqConsole.busy.clear();}
  f.api.stopping.add('100001');assert.throws(()=>f.api.captureFriendRequests(f.input),{code:'operation_in_progress'});f.api.stopping.clear();f.qqConsole.busy.add('300001');assert.equal(f.api.captureFriendRequests(f.input).qqAccountId,'100001');
});
test('snapshot publication invalidates changed capabilities without publishing request content or flags',async t=>{
  for(const change of [f=>f.service.generation++,f=>f.client.generation++,f=>{f.client.socket={readyState:1};},f=>f.qqConsole.epoch++,f=>{f.qqConsole.runtime={};},f=>{f.win.visible=false;},f=>{f.win.minimized=true;},f=>{f.service.status='disconnected';}]){
    const f=harness(t);f.receive();await f.api.friendRequestsPanel.read(f.input);change(f);f.api.publish();assert.equal(f.api.friendRequestsPanel.panel,null);await f.api.friendRequestsPanel.close();
    assert.doesNotMatch(JSON.stringify(f.messages),/PRIVATE_REQUEST|requestId|private-root/);assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/PRIVATE_REQUEST|requestId|private-root/);
  }
});
test('a management change during fixed client preflight prevents the decision write',async t=>{
  const f=harness(t);f.receive();const list=await f.api.friendRequestsPanel.read(f.input),requestId=list.inbox.items[0].requestId;f.client.gate=defer();const pending=f.api.friendRequestsPanel.decide({...f.input,requestId,approve:true});await tick();f.qqConsole.busy.add('qq-components');f.client.gate.resolve();const result=await pending;assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'operation_in_progress');assert.equal(f.calls.length,0);
});
test('a verified acceptance remains attached to the old panel when visibility changes after the write',async t=>{
  const f=harness(t);f.receive();const list=await f.api.friendRequestsPanel.read(f.input),requestId=list.inbox.items[0].requestId;f.client.afterWrite=defer();const pending=f.api.friendRequestsPanel.decide({...f.input,requestId,approve:false});await tick();assert.equal(f.calls.length,1);f.win.visible=false;f.api.publish();f.client.afterWrite.resolve();const result=await pending;assert.equal(result.outcome,'accepted');assert.equal(result.accountId,'whale');assert.equal(result.qqAccountId,'100001');assert.equal(result.panelId,PANEL);assert.equal(result.approve,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_REQUEST/);
});
test('before-quit closes panel access without treating pending requests as decisions',async t=>{
  const f=harness(t);f.receive();await f.api.friendRequestsPanel.read(f.input);let prevented=false;f.events['before-quit']({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(f.api.friendRequestsPanel.panel,null);await f.api.friendRequestsPanel.close();assert.equal(f.calls.length,0);assert.equal(f.service.friendRequests.closed,false);
});
test('only three fixed request IPC methods are exposed and normal account/window exits close the panel',()=>{
  const preload=fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8');
  for(const method of ['Read','Decide','Close']){assert(preload.includes(`qqFriendRequests${method}: value => ipcRenderer.invoke('arcade:qqFriendRequests${method}',value)`));assert(source.includes(`register('qqFriendRequests${method}',value=>friendRequestsResult(`));}
  assert(!preload.includes('set_friend_add_request'));assert(!preload.includes('friendId'));assert(!preload.includes('flag:'));
  for(const event of ['hide','minimize'])assert(source.includes(`win.on('${event}',()=>void Promise.allSettled([closeImages(),closeQQVoices(),ownerRemarkPanel.closeCurrent(),ownerHistorySession.closeCurrent(),friendRequestsPanel.close(),firstSetupPanel.close()]))`));
  assert(source.includes('friendRequestsPanel.observe();'));
});
