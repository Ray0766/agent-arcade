'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const mainFile=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(mainFile,'utf8'),fromMain=createRequire(mainFile),ticketId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function harness(platform='win32'){
  const calls=[],picker=deferred(),client={
    async verifyGroupImageTarget(groupId,_signal,{assertCurrent}){
      assertCurrent();calls.push(['verify',groupId]);
      return {accountId:'100001',groupId,revision:'joined-a',groupName:'重名群'};
    },
  },service={generation:1,scopeId:'profile:ju',config:{mode:'api',channel:'qq'},status:'connected',resets:0,
    imageTargetBinding(groupId){
      if(this.status!=='connected')throw Object.assign(Error('Private failure'),{code:'disconnected'});
      if(groupId!==undefined&&!['500001','500002'].includes(groupId))throw Object.assign(Error('Unknown group'),{code:'group_unavailable'});
      return {status:this.status,channel:'qq',generation:this.generation,scopeId:this.scopeId,client,accountId:'100001',ownerId:'200001',role:'橘',
        ...(groupId===undefined?{}:{groupId,roleId:'character-a',groupRevision:'joined-a'})};
    },imageSnapshot(){return {busy:false};},
    snapshot(){return {status:this.status,social:{config:{enabled:false}}};},
    async selectImage(file,{groupId,groupName}){calls.push(['select',file]);return {ticketId,kind:'image',width:1,height:1,bytes:68,expiresAt:Date.now()+300000,preview:'data:image/png;base64,AAAA',recipient:{accountId:'100001',role:'橘',...(groupId===undefined?{ownerId:'200001'}:{groupId,groupName,roleId:'character-a'})},privatePath:'MUST_NOT_LEAK'};},
    async sendImage(value){calls.push(['send',value]);return {ticketId,outcome:'accepted',messageId:'123',kind:'image',privatePath:'MUST_NOT_LEAK'};},discardImage(value){calls.push(['discard',value]);return {discarded:true};},async resetImages(){this.resets++;await this.resetGate?.promise;}
  };
  const accounts={selectedId:'primary',get(id){if(id!=='primary')throw Error('Unknown');return service;},snapshot(){return {selectedId:this.selectedId};}},win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed:()=>false,webContents:{send(){}}};
  const context={__dirname:path.dirname(mainFile),module:{exports:{}},process:{argv:[],env:{}},setInterval,clearInterval,AbortController,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},dialog:{showOpenDialog(_win,options){calls.push(['picker',options]);return picker.promise;}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
  vm.runInNewContext(source+'\nmodule.exports={pickQQImage,sendQQImage,discardQQImage,closeOwnedImage,closeImages,observeImageBinding,setup:(s,a,w,p)=>{bot=s;accounts=a;win=w;hostGate={platform:p};},panel:()=>imagePanel};',context,{filename:mainFile});const api=context.module.exports;api.setup(service,accounts,win,platform);
  return {api,service,accounts,win,client,calls,picker,request:{accountId:'primary',panelId:'panel-1',...(platform==='darwin'?{groupId:'500001'}:{})},async pick(){const promise=api.pickQQImage(this.request);await tick();picker.resolve({canceled:false,filePaths:['C:\\Original\\fixture.png']});return promise;}};
}
test('main picker captures the current QQ binding and exposes only bounded preview fields',async()=>{const f=harness(),result=await f.pick();assert.equal(result.accountId,'primary');assert.equal(result.panelId,'panel-1');assert.equal(result.draft.recipient.ownerId,'200001');assert.doesNotMatch(JSON.stringify(result),/MUST_NOT_LEAK|Original|scopeId|client/);assert.equal(f.calls.filter(row=>row[0]==='send').length,0);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0][1].filters[0].extensions)),['png','jpg','jpeg']);});
test('extra path, destination and action parameters never reach the picker or sender',async()=>{for(const extra of [{path:'C:\\secret.png'},{ownerId:'300001'},{action:'send_group_msg'}]){const f=harness();await assert.rejects(f.api.pickQQImage({...f.request,...extra}),{code:'invalid_request'});assert.equal(f.calls.length,0);}const f=harness();await f.pick();await assert.rejects(f.api.sendQQImage({...f.request,ticketId,to:'300001'}),{code:'invalid_request'});assert.equal(f.calls.filter(row=>row[0]==='send').length,0);});
test('cancelled file selection does not decode or send a file',async()=>{const f=harness(),promise=f.api.pickQQImage(f.request);await tick();f.picker.resolve({canceled:true,filePaths:[]});assert.equal((await promise).cancelled,true);assert.equal(f.calls.length,1);await f.api.closeOwnedImage(f.request);assert.equal(f.service.resets,1);});
test('generation or role scope changes while the native dialog is open invalidate its selection',async()=>{for(const field of ['generation','scopeId']){const f=harness(),promise=f.api.pickQQImage(f.request);await tick();f.service[field]=field==='generation'?2:'profile:dragon';f.picker.resolve({canceled:false,filePaths:['C:\\Original\\fixture.png']});await assert.rejects(promise,{code:'changed'});assert.equal(f.calls.filter(row=>row[0]==='select').length,0);assert.equal(f.api.panel(),null);}});
test('a closed or hidden image panel rejects a late native dialog result',async()=>{for(const hidden of [false,true]){const f=harness(),promise=f.api.pickQQImage(f.request);await tick();if(hidden){f.win.visible=false;f.api.observeImageBinding();}else await f.api.closeOwnedImage(f.request);f.picker.resolve({canceled:false,filePaths:['C:\\Original\\fixture.png']});await assert.rejects(promise,{code:'changed'});assert.equal(f.calls.filter(row=>row[0]==='select').length,0);assert.equal(f.service.resets,1);}});
test('duplicate pickers are rejected and old-panel close cannot clear the active draft',async()=>{const f=harness(),pending=f.api.pickQQImage(f.request);await tick();await assert.rejects(f.api.pickQQImage(f.request),{code:'operation_in_progress'});f.picker.resolve({canceled:false,filePaths:['C:\\Original\\fixture.png']});await pending;await f.api.closeOwnedImage({...f.request,panelId:'old-panel'});assert.equal(f.service.resets,0);assert.notEqual(f.api.panel(),null);});
test('late accepted sends remain attributed to their captured panel and expose no private fields',async()=>{const f=harness();await f.pick();const gate=deferred();f.service.sendImage=()=>gate.promise;const pending=f.api.sendQQImage({...f.request,ticketId});await tick();f.accounts.selectedId='different';f.api.observeImageBinding();gate.resolve({ticketId,outcome:'accepted',messageId:'456',kind:'image',privatePath:'MUST_NOT_LEAK'});const result=await pending;assert.equal(result.accountId,'primary');assert.equal(result.panelId,'panel-1');assert.equal(result.outcome,'accepted');assert.doesNotMatch(JSON.stringify(result),/MUST_NOT_LEAK/);assert.equal(f.api.panel(),null);});
test('unverifiable post-send results are unknown and never trigger another send',async()=>{const f=harness();await f.pick();f.service.sendImage=async()=>{f.calls.push(['send']);return {ticketId,outcome:'accepted',messageId:null};};const result=await f.api.sendQQImage({...f.request,ticketId});assert.equal(result.outcome,'unknown');assert.equal(result.code,'send_unknown');assert.equal(f.calls.filter(row=>row[0]==='send').length,1);});
test('preload exposes only the fixed image IPC methods',()=>{const preload=fs.readFileSync(path.join(__dirname,'../src/preload.cjs'),'utf8');for(const method of ['Pick','Send','Discard','Close'])assert(preload.includes(`qqImage${method}: value => ipcRenderer.invoke('arcade:qqImage${method}',value)`));assert(!preload.includes('send_group_msg'));});

test('Mac image entry verifies one exact group before opening the picker and locks it to the draft and receipt',async()=>{
  const f=harness('darwin');
  const result=await f.pick();
  assert.deepEqual(f.calls.map(row=>row[0]),['verify','picker','select']);
  assert.equal(f.calls[0][1],'500001');
  assert.match(f.calls[1][1].title,/500001/);
  assert.deepEqual({...result.draft.recipient},{accountId:'100001',role:'橘',groupId:'500001',roleId:'character-a',groupName:'重名群'});
  assert.equal(result.groupId,'500001');
  const other={...f.request,groupId:'500002'};
  await f.api.closeOwnedImage(other);
  await assert.rejects(f.api.sendQQImage({...other,ticketId}),{code:'stale_ticket'});
  assert.throws(()=>f.api.discardQQImage({...other,ticketId}),{code:'stale_ticket'});
  assert.equal((await f.api.sendQQImage({...f.request,ticketId})).groupId,'500001');
  assert.deepEqual(f.calls.filter(([kind])=>kind==='send').map(([,value])=>({...value})),[{ticketId,groupId:'500001'}]);
});
test('Mac group-only picker does not open for a private route, unverified target, or obsolete bound role',async()=>{
  const f=harness('darwin');
  await assert.rejects(f.api.pickQQImage({accountId:'primary',panelId:'panel-1'}),{code:'group_unavailable'});
  await assert.rejects(f.api.pickQQImage({...f.request,groupId:'500003'}),{code:'group_unavailable'});
  f.client.verifyGroupImageTarget=async()=>({accountId:'100001',groupId:'500002',revision:'joined-a'});
  await assert.rejects(f.api.pickQQImage(f.request),{code:'group_unavailable'});
  const scoped=harness('darwin'),pending=scoped.api.pickQQImage(scoped.request);
  await tick();
  scoped.service.scopeId='profile:replaced-role';
  scoped.picker.resolve({canceled:false,filePaths:['synthetic.png']});
  await assert.rejects(pending,{code:'changed'});
  assert.deepEqual(scoped.calls.map(row=>row[0]),['verify','picker']);
  assert.equal(f.calls.length,0);
});
