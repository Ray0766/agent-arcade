'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {QQConsole,validateOrphanRequest,orphanErrorCode,orphanCleanupReceipt}=require('../src/bot/qq-console.cjs');
const A='12345001',B='12345002',DIGEST='a'.repeat(64),KIND='pending-shell-inspection-resources';
const main=fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),clone=value=>JSON.parse(JSON.stringify(value));
const preview=()=>({kind:KIND,action:'settle-resources',accountId:A,expectedDigest:DIGEST,expiresAt:new Date(Date.now()+60000).toISOString(),automaticStart:false});
const detail=resources=>({kind:KIND,accountId:A,resources,processControlAttempted:false,leaseMutationAttempted:false,pendingUpdateRecordsModified:false,automaticStart:false});
const success=()=>({recovery:'inspection-resources-settled',accountId:A,automaticStart:false,cleanup:detail('closed')});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-inspection-console-')),calls=[];
  const runtime={hasOrphanInspectionResources:id=>id===A,instance:()=>{calls.push('instance');throw Error('Installation metadata unavailable');},previewOrphanCleanup:async(_id,options)=>{options.assertCurrent();return preview();},discardOrphanPreview:()=>({discarded:true}),cleanupOrphans:async(_id,options)=>{options.assertCurrent();calls.push('settle');return success();},discover:async()=>{calls.push('discover');throw Error('No implicit process or bridge refresh');},close:async()=>({closed:true})};
  const manager=new QQConsole({root,runtimeFactory:()=>runtime}),entry={client:{close:()=>calls.push('client-close')}};manager.clients.set(A,entry);
  manager.directoryRequests.set(B,{controller:{abort:()=>calls.push('directory-abort')}});
  const handlers=new Map(),frame={url:'http://synthetic.invalid'},webContents={mainFrame:frame},rows=[{id:'target',accountId:A,channel:'qq',status:'connected'},{id:'other',accountId:B,channel:'qq',status:'connected'}],services=new Map(rows.map(row=>[row.id,{status:row.status}]));
  const context={ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},win:{webContents},indexURL:frame.url,desktopChat:{retire:()=>calls.push('desktop-chat-retire')},qqConsole:manager,qqCompanionLaunch:{snapshot:()=>({}),closeCurrent:async()=>calls.push('launch-close')},validateOrphanRequest,orphanErrorCode,orphanCleanupReceipt,qqStopping:new Set(),accounts:{services,snapshot:()=>({accounts:rows}),disconnect:async()=>calls.push('disconnect')},voiceAccount:'target',closeVoice:async()=>calls.push('voice-close')};
  const start=main.indexOf('const qqLaunchConflicts='),end=main.indexOf('// Credential edits',start),a=main.indexOf('    const qqOrphanResult='),b=main.indexOf('    const providerLogin=',a);assert(start>=0&&end>start&&a>=0&&b>a);
  vm.createContext(context);vm.runInContext(main.slice(start,end)+main.slice(a,b),context);
  const invoke=(name,value)=>handlers.get('arcade:'+name)({sender:webContents,senderFrame:frame},value);
  t.after(async()=>{await manager.close();const absolute=fs.realpathSync(root),temp=fs.realpathSync(os.tmpdir());assert(absolute.toLowerCase().startsWith(temp.toLowerCase()+path.sep));fs.rmSync(absolute,{recursive:true,force:true});});
  return {manager,runtime,calls,entry,services,invoke,context};
}

test('actual trusted IPC wrapper settles only the inspection, without metadata access or account side effects',async t=>{
  const f=fixture(t),p=await f.invoke('qqRuntimeOrphanPreview',{accountId:A});assert.equal(p.preview.kind,KIND);assert(!Object.hasOwn(p.preview,'count'));assert.deepEqual(f.calls,[]);
  const result=await f.invoke('qqRuntimeOrphanCleanup',{accountId:A,expectedDigest:DIGEST});assert.deepEqual(clone(result),{ok:true,...success()});assert.deepEqual(f.calls,['settle']);assert.equal(f.manager.clients.get(A),f.entry);assert(f.manager.directoryRequests.has(B));assert.equal(f.manager.refreshRevision,1);assert.equal(f.manager.busy.size,0);assert.equal(f.context.qqStopping.size,0);assert([...f.services.values()].every(service=>service.status==='connected'));
  assert.equal((await f.invoke('qqRuntimeOrphanCleanup',{accountId:A,expectedDigest:DIGEST})).code,'preview_required');assert.deepEqual(f.calls,['settle']);
});

test('strict resource variants reject process counts, substituted accounts and extra private data',async t=>{
  const f=fixture(t);assert.deepEqual(orphanCleanupReceipt(detail('unconfirmed'),A),detail('unconfirmed'));
  for(const patch of [{count:0},{accountId:B},{processControlAttempted:true},{lease:'retained'},{path:'PRIVATE'}])assert.equal(orphanCleanupReceipt({...detail('closed'),...patch},A),null);
  for(const patch of [{count:0},{action:'settle'},{privateHandle:42}]){f.runtime.previewOrphanCleanup=async()=>({...preview(),...patch});await assert.rejects(f.manager.previewOrphanCleanup(A),{code:'invalid_response'});assert.equal(f.manager.orphanPreviews.size,0);}
  f.runtime.previewOrphanCleanup=async()=>preview();await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async()=>({...success(),terminatedCount:0});await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),e=>e.code==='invalid_response'&&e.cleanupAttempted===true&&!e.cleanup);assert.deepEqual(f.calls,[]);
});

test('resource path rejects a beforeStop request and keeps typed partial facts through main projection',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async(_id,options)=>{await options.beforeStop();throw Error('unreachable');};const rejected=await f.invoke('qqRuntimeOrphanCleanup',{accountId:A,expectedDigest:DIGEST});assert.equal(rejected.code,'changed');assert.deepEqual(f.calls,[]);
  await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async()=>{throw Object.assign(Error('PRIVATE'),{code:'cleanup_unconfirmed',cleanupAttempted:true,cleanup:detail('unconfirmed')});};assert.deepEqual(clone(await f.invoke('qqRuntimeOrphanCleanup',{accountId:A,expectedDigest:DIGEST})),{ok:false,code:'cleanup_unconfirmed',cleanupAttempted:true,cleanup:detail('unconfirmed')});
  await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async()=>{throw Object.assign(Error('PRIVATE'),{code:'cleanup_unconfirmed',cleanupAttempted:true,cleanup:{...detail('unconfirmed'),count:0}});};assert.deepEqual(clone(await f.invoke('qqRuntimeOrphanCleanup',{accountId:A,expectedDigest:DIGEST})),{ok:false,code:'cleanup_unconfirmed',cleanupAttempted:true});assert.deepEqual(f.calls,[]);
});

test('discard while queued prevents cleanup; scope changes after a known close preserve the result',async t=>{
  const f=fixture(t),held=deferred(),entered=deferred();await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async(_id,options)=>{entered.resolve();await held.promise;options.assertCurrent();f.calls.push('settle');return success();};
  const pending=f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),rejected=assert.rejects(pending,{code:'changed'});await entered.promise;assert.deepEqual(f.manager.discardOrphanPreview(A,{expectedDigest:DIGEST}),{discarded:true});held.resolve();await rejected;assert.deepEqual(f.calls,[]);
  await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async(_id,options)=>{options.assertCurrent();f.calls.push('settle');f.manager.epoch++;return success();};assert.deepEqual(await f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),success());assert.deepEqual(f.calls,['settle']);
});

test('ordinary process cleanup still retires the foreground launch and uses its existing scoped callback',async t=>{
  const f=fixture(t);f.runtime.hasOrphanInspectionResources=()=>false;f.runtime.instance=accountId=>({accountId});f.runtime.previewOrphanCleanup=async()=>({accountId:A,count:1,expectedDigest:DIGEST,automaticStart:false});await f.manager.previewOrphanCleanup(A);
  f.runtime.cleanupOrphans=async(_id,options)=>{options.assertCurrent();await options.beforeStop();throw Object.assign(Error('expected bounded refusal'),{code:'account_connected'});};await f.invoke('qqRuntimeOrphanCleanup',{accountId:A,expectedDigest:DIGEST});assert.equal(f.calls[0],'launch-close');assert(f.calls.includes('voice-close'));assert(f.calls.includes('disconnect'));assert(!f.calls.includes('settle'));
});

test('unreadable profiles retain the exact inspection entry without asserting that QQ is stopped',async t=>{
  const f=fixture(t);f.manager.profileFactory=()=>({list:async()=>{throw Error('private metadata');}});f.runtime.discover=async()=>({configured:false,instances:[{accountId:A,processRunning:null,canSettleOrphanInspection:true,canStart:false,canStop:false,canRecover:false},{accountId:B,processRunning:true,canStart:false,canStop:true,canRecover:false}]});
  f.runtime.getConnections=()=>{throw Error('No bridge query without profiles');};const state=await f.manager.refresh();assert.equal(state.instances[0].canSettleOrphanInspection,true);assert.deepEqual(state.instances[0].login,{state:'unknown',online:null});assert.deepEqual(state.instances[0].bridges,[]);assert.equal(state.instances[0].configurationIssue,'configuration_unavailable');assert.equal(state.instances[1].canStop,false);assert.equal(state.instances[1].login.state,'unknown');assert.deepEqual(f.calls,[]);
  const p=await f.manager.previewOrphanCleanup(A);assert.equal(p.kind,KIND);assert.deepEqual(await f.manager.cleanupOrphans(A,{expectedDigest:p.expectedDigest}),success());assert.deepEqual(f.calls,['settle']);
});

test('invalid or changed process tickets cannot cancel the foreground launch from the register wrapper',async t=>{
  const f=fixture(t);f.runtime.hasOrphanInspectionResources=()=>false;let changed=false;f.runtime.instance=accountId=>({accountId,componentsRoot:changed?'different':'original'});f.runtime.previewOrphanCleanup=async()=>({accountId:A,count:1,expectedDigest:DIGEST,automaticStart:false});await f.manager.previewOrphanCleanup(A);
  assert.equal(f.manager.orphanCleanupChangesRuntime({accountId:A,expectedDigest:DIGEST}),true);changed=true;const result=await f.invoke('qqRuntimeOrphanCleanup',{accountId:A,expectedDigest:DIGEST});assert.equal(result.code,'changed');assert.deepEqual(f.calls,[]);
  assert.equal((await f.invoke('qqRuntimeOrphanCleanup',{accountId:A,expectedDigest:DIGEST,command:'PRIVATE'})).code,'invalid_config');assert.deepEqual(f.calls,[]);
});

test('known resource closure retires an older in-flight read without starting a replacement read',async t=>{
  const f=fixture(t),held=deferred(),entered=deferred();let reads=0,lists=0,retained=true;
  f.runtime.discover=async()=>{reads++;return {configured:false,instances:[{accountId:A,processRunning:null,canSettleOrphanInspection:retained,canStart:false,canStop:false,canRecover:false}]};};
  f.manager.profileFactory=()=>({list:async()=>{if(++lists===1){entered.resolve();await held.promise;}return [];}});
  const old=f.manager.refresh(),rejected=assert.rejects(old,{code:'changed'});await entered.promise;await f.manager.previewOrphanCleanup(A);await f.manager.cleanupOrphans(A,{expectedDigest:DIGEST});retained=false;
  assert.equal(reads,1);assert.equal(f.manager.refreshing,null);const fresh=await f.manager.refresh();assert.equal(reads,2);assert.equal(fresh.instances[0].canSettleOrphanInspection,false);held.resolve();await rejected;assert.equal(f.manager.snapshot(),fresh);assert.deepEqual(f.calls,['settle']);
});
