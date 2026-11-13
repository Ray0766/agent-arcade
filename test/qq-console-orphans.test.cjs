'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {QQConsole,validateOrphanRequest,orphanErrorCode,orphanCleanupReceipt}=require('../src/bot/qq-console.cjs');
const {QQRuntimeManager}=require('../src/bot/qq-runtime.cjs');
const {DesktopConversations}=require('../src/bot/desktop-conversations.cjs');
const A='12345001',B='12345002',DIGEST='a'.repeat(64);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const vm=require('node:vm'),mainSource=fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8');
const error=code=>Object.assign(Error('RAW_PRIVATE_DETAIL'),{code});
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-orphan-console-')),calls=[];
  const install={componentsRoot:path.join(root,'components'),runtimeDir:path.join(root,'runtime'),configDir:path.join(root,'config'),qqExe:path.join(root,'QQ.exe'),launcher:path.join(root,'boot.exe')};
  const runtime={instance:accountId=>({accountId,...install}),discover:async()=>({configured:true,instances:[A,B].map(accountId=>({accountId,management:'stopped',processRunning:false}))}),start:async()=>{calls.push('start');},previewOrphanCleanup:async accountId=>({accountId,count:5,expectedDigest:DIGEST,automaticStart:false,privatePath:'DO_NOT_EXPOSE',pids:[111,112]}),cleanupOrphans:async(accountId,options)=>{calls.push('proof');options.assertCurrent();await options.beforeStop();options.assertCurrent();calls.push('stop');return {accountId,recovery:'orphans-cleared',terminatedCount:5,automaticStart:false,privatePath:'DO_NOT_EXPOSE'};},close:async()=>{calls.push('close');return {closed:true};}};
  const manager=new QQConsole({root,runtimeFactory:()=>runtime,profileFactory:()=>({list:async()=>[]})});
  t.after(async()=>{await manager.close();fs.rmSync(root,{recursive:true,force:true});});
  return {manager,runtime,install,calls,root};
}
const partial=patch=>({kind:'pending-shell-orphan-cleanup',accountId:A,selectedCount:3,confirmedAbsentCount:3,terminationAttempted:true,processes:'confirmed-absent',lease:'retained',resources:'unconfirmed',automaticStart:false,pendingUpdateRecoveryRequired:true,...patch});
test('partial outcome projection rejects extra secrets, account substitution and inconsistent known counts',()=>{
  assert.deepEqual(orphanCleanupReceipt(partial(),A),partial());
  for(const patch of [{path:'PRIVATE'},{accountId:B},{selectedCount:65},{confirmedAbsentCount:2},{terminationAttempted:'true'},{processes:'unverified'},{processes:'remaining'},{lease:'cleared',processes:'remaining',confirmedAbsentCount:1},{resources:'maybe'},{automaticStart:true},{pendingUpdateRecoveryRequired:false}])assert.equal(orphanCleanupReceipt(partial(patch),A),null);
  assert(orphanCleanupReceipt(partial({processes:'remaining',confirmedAbsentCount:1}),A));assert(orphanCleanupReceipt(partial({processes:'unverified',confirmedAbsentCount:null}),A));
});
test('pending settlement preview has zero new terminations and bounded explicit metadata',async t=>{
  const f=fixture(t);f.runtime.previewOrphanCleanup=async accountId=>({accountId,kind:'verified-orphan-cleanup',action:'settle',count:0,expiresAt:'2099-01-01T00:00:00.000Z',expectedDigest:DIGEST,automaticStart:false,privateProof:'PRIVATE'});
  const value=await f.manager.previewOrphanCleanup(A);assert.equal(value.action,'settle');assert.equal(value.count,0);assert.equal(value.expiresAt,'2099-01-01T00:00:00.000Z');assert(!JSON.stringify(value).includes('PRIVATE'));
  const original=f.runtime.previewOrphanCleanup;for(const patch of [{action:'terminate'},{count:1},{expiresAt:'invalid'},{kind:'wrong'}]){f.runtime.previewOrphanCleanup=async id=>({...await original(id),...patch});await assert.rejects(f.manager.previewOrphanCleanup(A),{code:'invalid_response'});}
});
test('discard retires only the exact preview without disconnecting or stopping',async t=>{
  const f=fixture(t),retired=[];f.runtime.discardOrphanPreview=(id,value)=>{retired.push([id,value.expectedDigest]);return {discarded:true};};await f.manager.previewOrphanCleanup(A);
  assert.deepEqual(f.manager.discardOrphanPreview(A,{expectedDigest:'b'.repeat(64)}),{discarded:false});assert.equal(retired.length,0);
  assert.deepEqual(f.manager.discardOrphanPreview(A,{expectedDigest:DIGEST}),{discarded:true});assert.deepEqual(retired,[[A,DIGEST]]);assert.deepEqual(f.calls,[]);assert.deepEqual(f.manager.discardOrphanPreview(A,{expectedDigest:DIGEST}),{discarded:false});await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),{code:'preview_required'});
  assert.throws(()=>f.manager.discardOrphanPreview(A,{accountId:B,expectedDigest:DIGEST}),{code:'invalid_config'});
});
test('discard during beforeStop invalidates the consumed ticket before a process effect',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);let release;const running=f.manager.cleanupOrphans(A,{expectedDigest:DIGEST},()=>new Promise(resolve=>{release=resolve;})),rejected=assert.rejects(running,{code:'changed'});await tick();assert.deepEqual(f.manager.discardOrphanPreview(A,{expectedDigest:DIGEST}),{discarded:true});release();await rejected;assert.deepEqual(f.calls,['proof']);assert.equal(f.manager.orphanPreviews.size,0);
});
test('late preview after console close is discarded and never returned as new authority',async t=>{
  const f=fixture(t),discarded=[];let release;f.runtime.previewOrphanCleanup=()=>new Promise(resolve=>{release=resolve;});f.runtime.discardOrphanPreview=(id,value)=>discarded.push([id,value.expectedDigest]);
  const pending=f.manager.previewOrphanCleanup(A),rejected=assert.rejects(pending,{code:'changed'});await f.manager.close();release({accountId:A,count:1,expectedDigest:DIGEST,automaticStart:false});await rejected;assert.deepEqual(discarded,[[A,DIGEST]]);assert.equal(f.manager.orphanPreviews.size,0);
});
test('late scope changes retain typed known process effects without claiming lease or resource cleanup',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async()=>{f.manager.epoch++;throw Object.assign(error('cleanup_unconfirmed'),{cleanupAttempted:true,cleanup:partial(),pids:[1]});};
  await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),value=>value.code==='cleanup_unconfirmed'&&value.cleanupAttempted===true&&JSON.stringify(value.cleanup)===JSON.stringify(partial())&&!value.pids&&!value.message.includes('PRIVATE'));
  await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async()=>{throw Object.assign(error('cleanup_unconfirmed'),{cleanupAttempted:true,cleanup:partial({accountId:B})});};await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),value=>value.cleanupAttempted&&!value.cleanup);
});
test('incomplete typed facts cannot be labelled as complete cleanup',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async()=>({accountId:A,recovery:'orphans-cleared',terminatedCount:3,automaticStart:false,cleanup:partial()});await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),value=>value.code==='invalid_response'&&value.cleanupAttempted);
});
test('an in-flight inspection stays serialized instead of silently issuing a replacement ticket',async t=>{
  const f=fixture(t);let release,reads=0;f.runtime.previewOrphanCleanup=()=>{reads++;return new Promise(resolve=>{release=resolve;});};const first=f.manager.previewOrphanCleanup(A);await assert.rejects(f.manager.previewOrphanCleanup(A),{code:'operation_in_progress'});assert.equal(reads,1);release({accountId:A,count:1,expectedDigest:DIGEST,automaticStart:false});assert.equal((await first).expectedDigest,DIGEST);assert.equal(f.manager.orphanPreviews.get(A).valid,true);
});
test('actual main account lifecycle handlers retire authority before their asynchronous work',async t=>{
  const start=mainSource.indexOf("    register('accountSelect'"),end=mainSource.indexOf('    const connectCompanion=',start);assert(start>=0&&end>start);
  for(const method of ['accountSelect','accountCreate','accountImport','accountRemove'])await t.test(method,async t=>{
    const f=fixture(t),handlers=new Map(),noop=async()=>{},panel={session:null,closeCurrent:noop,close:noop};let release;await f.manager.previewOrphanCleanup(A);const pending=f.manager.cleanupOrphans(A,{expectedDigest:DIGEST},()=>new Promise(resolve=>{release=resolve;})),rejected=assert.rejects(pending,{code:'changed'});await tick();
    // AccountManager.get returns the registered service object until explicit replacement.
    let localStops=0,removals=0;const registeredService={localStop:async()=>{localStops++;assert.equal(f.manager.orphanPreviews.size,0);}};
    const context={register:(name,fn)=>handlers.set(name,fn),qqConsole:f.manager,accounts:{get:()=>registeredService,select:()=>registeredService,add:()=>({}),snapshot:()=>({}),remove:()=>{removals++;},current:()=>registeredService},bot:null,clearQQDiagnosticCache:()=>{},closeVoice:noop,closeImages:noop,closeQQVoices:noop,ownerRemarkPanel:panel,ownerHistorySession:panel,friendRequestsPanel:panel,firstSetupPanel:panel,selfProfilePanel:panel,avatarPanel:panel,groupProfileSession:panel,groupAdminSession:panel,contactAdminSession:panel,closePluginPanels:noop,dismissPendingUpdate:noop,publish:()=>{},fullSnapshot:()=>({}),voiceAccount:null,voiceMediaPanel:null,voiceReceipts:new Map(),dialog:{showOpenDialog:async()=>({canceled:true})},win:{},config:{language:'zh'}};
    vm.runInNewContext(mainSource.slice(start,end),context);const changed=handlers.get(method)('synthetic-profile');assert.equal(f.manager.orphanPreviews.size,0);release();await Promise.all([changed,rejected]);assert(!f.calls.includes('stop'));if(method==='accountRemove'){assert.equal(localStops,1);assert.equal(removals,1);}
  });
});
test('trusted scope change revokes before the actual register wrapper awaits foreground shutdown',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);let releaseStop,releaseLaunch,chatRetirements=0;const cleanup=f.manager.cleanupOrphans(A,{expectedDigest:DIGEST},()=>new Promise(resolve=>{releaseStop=resolve;})),rejected=assert.rejects(cleanup,{code:'changed'});await tick();
  const start=mainSource.indexOf('const qqLaunchConflicts='),end=mainSource.indexOf('// Credential edits',start),handlers=new Map(),frame={url:'https://synthetic.invalid'},webContents={mainFrame:frame},context={ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},win:{webContents},indexURL:frame.url,desktopConversations:new DesktopConversations({getSelection:()=>null,retire:()=>{chatRetirements++;}}),qqConsole:f.manager,qqCompanionLaunch:{snapshot:()=>({}),closeCurrent:()=>new Promise(resolve=>{releaseLaunch=resolve;})}};assert(start>=0&&end>start);vm.runInNewContext(mainSource.slice(start,end)+'register("accountSelect",()=>({selected:true}));',context);
  const invoke=handlers.get('arcade:accountSelect');await assert.rejects(invoke({sender:{},senderFrame:frame},'next'),/Untrusted sender/);assert.equal(chatRetirements,0);assert.equal(context.desktopConversations.epoch,0);assert.equal(f.manager.orphanPreviews.size,1);
  const selection=invoke({sender:webContents,senderFrame:frame},'next');try{assert.equal(chatRetirements,1);assert.equal(context.desktopConversations.epoch,1);assert.equal(f.manager.orphanPreviews.size,0);assert.equal(typeof releaseLaunch,'function');releaseStop();await rejected;assert(!f.calls.includes('stop'));releaseLaunch();assert.equal((await selection).selected,true);}finally{releaseStop?.();releaseLaunch?.();await Promise.allSettled([selection,cleanup,rejected]);}
});
test('actual main hide, minimize and close hooks revoke even a consumed cleanup ticket',async t=>{
  const line=mainSource.split('\n').find(value=>value.includes("['hide','minimize','close']")&&value.includes('retireOrphanPreviews'));assert(line);
  for(const event of ['hide','minimize','close'])await t.test(event,async t=>{
    const f=fixture(t),handlers=new Map();await f.manager.previewOrphanCleanup(A);let release;const pending=f.manager.cleanupOrphans(A,{expectedDigest:DIGEST},()=>new Promise(resolve=>{release=resolve;})),rejected=assert.rejects(pending,{code:'changed'});await tick();vm.runInNewContext(line,{win:{on:(name,fn)=>handlers.set(name,fn)},qqConsole:f.manager});handlers.get(event)();assert.equal(f.manager.orphanPreviews.size,0);release();await rejected;assert(!f.calls.includes('stop'));
  });
});
test('orphan actions accept only an exact account and digest, never renderer process identities',()=>{
  for(const [kind,value] of [['preview',null],['preview',{accountId:A,pids:[1]}],['preview',{accountId:A,path:'private'}],['cleanup',{accountId:A,expectedDigest:DIGEST,url:'private'}],['cleanup',{accountId:A,expectedDigest:'A'.repeat(64)}],['cleanup',{accountId:12345001,expectedDigest:DIGEST}],['unknown',{accountId:A}]])assert.throws(()=>validateOrphanRequest(kind,value),{code:'invalid_config'});
  assert.deepEqual(validateOrphanRequest('cleanup',{accountId:A,expectedDigest:DIGEST}),{accountId:A,expectedDigest:DIGEST});assert.equal(orphanErrorCode(error('secret_but_valid_identifier')),'operation_failed');
});
test('preview projects bounded metadata and never calls a stop or preparation callback',async t=>{
  const f=fixture(t),preview=await f.manager.previewOrphanCleanup(A);assert.deepEqual(preview,{accountId:A,count:5,expectedDigest:DIGEST,automaticStart:false});assert.deepEqual(f.calls,[]);assert.equal(f.manager.busy.size,0);assert.equal(f.manager.snapshot(),null);
});
test('preview rejects wrong accounts, excessive counts and a changed installation or scope',async t=>{
  const f=fixture(t),original=f.runtime.previewOrphanCleanup;
  for(const patch of [{accountId:B},{count:65},{count:0},{automaticStart:true},{expectedDigest:'bad'}]){f.runtime.previewOrphanCleanup=async id=>({...await original(id),...patch});await assert.rejects(f.manager.previewOrphanCleanup(A),{code:'invalid_response'});assert.equal(f.manager.orphanPreviews.size,0);}
  f.runtime.previewOrphanCleanup=async id=>{f.install.configDir+='-changed';return original(id);};await assert.rejects(f.manager.previewOrphanCleanup(A),{code:'changed'});
  f.runtime.previewOrphanCleanup=async id=>{f.manager.epoch++;return original(id);};await assert.rejects(f.manager.previewOrphanCleanup(A),{code:'changed'});assert.equal(f.manager.busy.size,0);
});
test('cleanup requires a same-scope preview, consumes it once and projects the confirmed receipt',async t=>{
  const f=fixture(t);await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),{code:'preview_required'});await f.manager.previewOrphanCleanup(A);
  await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:'b'.repeat(64)}),{code:'preview_required'});
  let prepared=0;const result=await f.manager.cleanupOrphans(A,{expectedDigest:DIGEST},async()=>{prepared++;f.calls.push('disconnect');});assert.equal(prepared,1);assert.deepEqual(f.calls,['proof','disconnect','stop']);assert.equal(result.recovery,'orphans-cleared');assert.equal(result.terminatedCount,5);assert.equal(result.automaticStart,false);assert(result.state);assert.doesNotMatch(JSON.stringify(result),/DO_NOT_EXPOSE|privatePath|pids/);await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),{code:'preview_required'});
});
test('cached cleanup cannot cross account, runtime, epoch or installation changes',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);await assert.rejects(f.manager.cleanupOrphans(B,{expectedDigest:DIGEST}),{code:'preview_required'});
  f.install.configDir+='-changed';await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),{code:'changed'});
  await f.manager.previewOrphanCleanup(A);f.manager.epoch++;await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),{code:'changed'});
  await f.manager.previewOrphanCleanup(A);f.manager.runtime={...f.runtime};await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),{code:'changed'});assert.deepEqual(f.calls,[]);
});
test('proof rejection does not disconnect, exposes no raw error and requires a fresh preview',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);let prepared=0;f.runtime.cleanupOrphans=async()=>{throw error('orphan_cleanup_changed');};await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST},async()=>{prepared++;}),value=>value.code==='orphan_cleanup_changed'&&!value.message.includes('PRIVATE')&&!value.cleanupAttempted);assert.equal(prepared,0);await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),{code:'preview_required'});
});
test('cleanup holds a global guard against other account start, component operations and config changes',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);let release;const cleanup=f.manager.cleanupOrphans(A,{expectedDigest:DIGEST},()=>new Promise(resolve=>{release=resolve;}));await tick();
  await assert.rejects(f.manager.perform('start',{accountId:B}),{code:'operation_in_progress'});await assert.rejects(f.manager.previewOrphanCleanup(B),{code:'operation_in_progress'});await assert.rejects(f.manager.configure(B,{}),{code:'operation_in_progress'});await assert.rejects(f.manager.setDirectory(f.root),{code:'operation_in_progress'});assert.equal(f.manager.busy.has('qq-orphan-cleanup'),true);assert(!f.calls.includes('start'));release();await cleanup;
  f.manager.busy.add('qq-components');await assert.rejects(f.manager.previewOrphanCleanup(A),{code:'operation_in_progress'});f.manager.busy.clear();await f.manager.previewOrphanCleanup(A);f.manager.busy.add('qq-components');await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),{code:'operation_in_progress'});f.manager.busy.clear();
});
test('changing scope while disconnecting prevents the subsequent stop',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST},async()=>{f.manager.epoch++;}),{code:'changed'});assert(!f.calls.includes('stop'));assert.equal(f.manager.busy.size,0);
});
test('close invalidates and waits for an in-flight cleanup instead of racing a stop',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);let release;const cleanup=f.manager.cleanupOrphans(A,{expectedDigest:DIGEST},()=>new Promise(resolve=>{release=resolve;}));const rejected=assert.rejects(cleanup,{code:'changed'});await tick();let closed=false;const closing=f.manager.close().then(()=>{closed=true;});await tick();assert.equal(closed,false);assert(!f.calls.includes('close'));release();await Promise.all([closing,rejected]);assert(!f.calls.includes('stop'));assert.equal(closed,true);
});
test('a confirmed cleanup remains successful when refreshing or the scope later fails',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);f.runtime.discover=async()=>{throw error('process_check_failed');};assert.deepEqual(await f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),{recovery:'orphans-cleared',terminatedCount:5,automaticStart:false,refreshIssue:'process_check_failed'});
  await f.manager.previewOrphanCleanup(A);const original=f.runtime.cleanupOrphans;f.runtime.cleanupOrphans=async(...args)=>{const result=await original(...args);f.manager.epoch++;return result;};assert.deepEqual(await f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),{recovery:'orphans-cleared',terminatedCount:5,automaticStart:false,refreshIssue:'changed'});
});
test('partial stop failures preserve attempted status, but no raw data or fabricated count',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async()=>{throw Object.assign(error('orphan_cleanup_incomplete'),{cleanupAttempted:true,terminatedCount:3,pids:[1]});};await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),value=>value.code==='orphan_cleanup_incomplete'&&value.cleanupAttempted===true&&!Object.hasOwn(value,'terminatedCount')&&!Object.hasOwn(value,'pids')&&!value.message.includes('PRIVATE'));
  await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async()=>{throw Object.assign(error('secret_but_valid_identifier'),{cleanupAttempted:'true'});};await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),value=>value.code==='operation_failed'&&!value.cleanupAttempted);
});
test('a wrong-account success receipt cannot be reported as confirmed cleanup',async t=>{
  const f=fixture(t);await f.manager.previewOrphanCleanup(A);f.runtime.cleanupOrphans=async()=>({accountId:B,recovery:'orphans-cleared',terminatedCount:5,automaticStart:false});await assert.rejects(f.manager.cleanupOrphans(A,{expectedDigest:DIGEST}),value=>value.code==='invalid_response'&&value.cleanupAttempted===true);
});
test('production console and runtime clear only a proven synthetic orphan tree after the disconnect hook',async t=>{
  const f=fixture(t),desktopDataRoot=path.join(f.root,'desktop'),component=path.join(desktopDataRoot,'components','NapCatQQ'),config=path.join(component,'config'),qq=path.join(desktopDataRoot,'components','QQ'),lockRoot=path.join(f.root,'locks');
  fs.mkdirSync(config,{recursive:true});fs.mkdirSync(qq,{recursive:true});for(const name of ['NapCatWinBootMain.exe','NapCatWinBootHook.dll','napcat.mjs','qqnt.json'])fs.writeFileSync(path.join(component,name),'SYNTHETIC');fs.writeFileSync(path.join(qq,'QQ.exe'),'SYNTHETIC');const configFile=path.join(config,`onebot11_${A}.json`);fs.writeFileSync(configFile,'{"test":"preserved"}');
  let rows=[{pid:process.pid,parentPid:1,name:'node.exe',executable:process.execPath,createdAt:'2026-11-05T12:00:00Z'}],starts=0,stops=0;
  const host={allocatePort:async()=>53000,listeners:async()=>[],inspect:async pids=>rows.filter(row=>pids.includes(row.pid)).map(row=>({...row})),snapshot:async()=>rows.map(row=>({...row})),start:async plan=>{starts++;rows.push({pid:800001,parentPid:process.pid,name:'NapCatWinBootMain.exe',executable:plan.file,accountId:A,createdAt:'2026-11-05T13:00:00Z'},{pid:800002,parentPid:800001,name:'QQ.exe',executable:plan.args[0],createdAt:'2026-11-05T13:00:01Z'});return {pid:800001};},stop:async proofs=>{stops++;assert.deepEqual(proofs.map(row=>row.pid),[800002]);rows=rows.filter(row=>!proofs.some(proof=>proof.pid===row.pid));}};
  const options={desktopDataRoot,lockRoot,platform:'win32',processHost:host},old=new QQRuntimeManager({...options,root:path.join(f.root,'old')});await old.start(A);const leaseFile=path.join(lockRoot,fs.readdirSync(lockRoot).find(name=>name.endsWith('.json'))),lease=JSON.parse(fs.readFileSync(leaseFile,'utf8'));lease.manager.pid=900001;fs.writeFileSync(leaseFile,JSON.stringify(lease));rows=rows.filter(row=>row.pid!==800001);
  f.manager.runtime=new QQRuntimeManager({...options,root:path.join(f.root,'next')});const preview=await f.manager.previewOrphanCleanup(A);assert.equal(preview.count,1);assert.equal(stops,0);let disconnected=false;const result=await f.manager.cleanupOrphans(A,{expectedDigest:preview.expectedDigest},async()=>{assert.equal(stops,0);disconnected=true;});
  assert(disconnected);assert.equal(result.recovery,'orphans-cleared');assert.equal(result.terminatedCount,1);assert.equal(result.state.instances[0].canStart,true);assert.equal(stops,1);assert.equal(starts,1);assert(!fs.existsSync(leaseFile));assert.equal(fs.readFileSync(configFile,'utf8'),'{"test":"preserved"}');
});
