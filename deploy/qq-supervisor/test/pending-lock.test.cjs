'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {fixture:coreFixture}=require('../../../test/helpers/qq-pending-update-lock-fixture.cjs');
const {directories,material,requestFor,runtime,deferred}=require('./helpers.cjs');
const {createService}=require('../../../src/qq-supervisor/server.cjs'),{SupervisorStore}=require('../../../src/qq-supervisor/store.cjs');
const {SupervisorPendingLock}=require('../../../src/qq-supervisor/pending-lock.cjs'),L=require('../../../src/qq-supervisor/pending-lock-policy.cjs');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const input=p=>({requestId:randomUUID(),action:p.action,recordId:p.recordId,ticketId:p.ticketId,expectedDigest:p.expectedDigest});
const arbitrary=()=>input({action:'clear-installation',recordId:'a'.repeat(64),ticketId:randomUUID(),expectedDigest:'b'.repeat(64)});
async function fixture(t,{storeOptions,io}={}){
 const f=coreFixture(t,{io});f.config.recovery={pendingUpdateRecords:true,pendingUpdateLocks:true};f.lock();
 // Core fixture writes its descriptor after constructing the inert runtime.
 // Use its finalized production selection for this isolated adapter.
 f.r.adapter.manager.componentSelection=()=>f.selection;
 const service=await createService({config:f.config,tls:material,runtimeFactory:()=>f.r.adapter,storeOptions,pendingUpdateLockFactory:(config,o)=>new SupervisorPendingLock(config,{...o,helperFactory:()=>f.core})});
 f.cleanup.push(()=>service.close());await service.listen();const request=requestFor(service.server.address().port,f.config);
 const preview=async(kind='installation')=>{const read=await request('GET',L.BASE+'/records');assert.equal(read.ok,true,JSON.stringify(read));const record=read.inspection.records.find(r=>r.kind===kind);assert(record);return request('POST',L.BASE+'/previews',{inspectionId:read.inspection.inspectionId,recordId:record.recordId});};
 return {...f,service,request,preview,confirm:p=>request('POST',L.BASE+'/confirmations',input(p))};
}
test('production lock helper over HTTPS clears only the orphan lock; opaque plan and account files stay intact',async t=>{
 const f=await fixture(t),bytes=fs.readFileSync(f.marker),stat=fs.statSync(f.marker,{bigint:true}),before=hash(f.marker);
 assert.equal((await f.request('GET','/v1/status')).ok,false);
 const cap=await f.request('GET',L.BASE+'/capabilities');assert.equal(cap.lockProtocol,L.PROTOCOL);assert.equal(cap.capability.enabled,true);
 const p=await f.preview();assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.preview.owner,'confirmed-absent');
 const request=input(p.preview),reply=await f.request('POST',L.BASE+'/confirmations',request);assert.equal(reply.ok,true,JSON.stringify(reply));
 assert.equal(reply.operation.phase,'completed');assert.equal(reply.operation.result.lockCleared,true);assert.equal(reply.operation.result.cleanupVerified,true);
 assert.deepEqual(reply.operation.result.remainingLocks,{installation:false,recoveryGuard:false});assert.equal(reply.operation.result.pendingUpdateRecoveryRequired,true);
 assert.notEqual(reply.operation.result.receiptId,request.requestId);assert.equal(fs.existsSync(f.selection.lockFile),false);
 assert.equal(hash(f.marker),before);assert.equal(fs.statSync(f.marker,{bigint:true}).ino,stat.ino);assert(fs.readFileSync(f.marker).equals(bytes));
 assert.deepEqual((await f.request('POST',L.BASE+'/confirmations',request)).operation,reply.operation);
 assert.deepEqual((await f.request('GET',L.BASE+'/operations/'+request.requestId)).operation,reply.operation);
 assert.equal(f.r.state.starts,0);assert.equal(f.r.state.stops,0);assert.doesNotMatch(JSON.stringify(reply),/SYNTHETIC_PLAN|sourcePath|configDir|[A-Z]:\\/);
});
test('guard removal is a separate ticket, leaves installation lock, and does not reconcile the plan',async t=>{
 const f=await fixture(t);f.lock('recovery-guard');assert.equal((await f.preview()).code,'pending_lock_guard_required');
 const guard=await f.preview('recovery-guard');assert.equal(guard.ok,true,JSON.stringify(guard));const result=await f.confirm(guard.preview);
 assert.equal(result.operation.result.lockCleared,true);assert.deepEqual(result.operation.result.remainingLocks,{installation:true,recoveryGuard:false});assert.equal(result.operation.result.recoveryRequired,true);
 assert(fs.existsSync(f.selection.lockFile));const p=await f.preview();assert.equal(p.ok,true);assert.equal((await f.confirm(p.preview)).operation.result.recoveryRequired,false);assert(fs.existsSync(f.marker));
});
test('lock grant is independent and disabled routes never migrate; old process and plan responses retain old fields',async t=>{
 const f=directories(t),service=await createService({config:f.config,tls:material,runtimeFactory:runtime});f.cleanup.push(()=>service.close());await service.listen();const request=requestFor(service.server.address().port,f.config);
 assert.equal((await request('GET',L.BASE+'/capabilities')).capability.enabled,false);assert.equal((await request('GET',L.BASE+'/records')).code,'lock_recovery_disabled');assert.equal((await request('POST',L.BASE+'/confirmations',arbitrary())).code,'lock_recovery_disabled');
 assert.equal(service.store.db.prepare('PRAGMA user_version').get().user_version,1);
 assert.equal(Object.hasOwn(await request('GET','/v1/capabilities'),'lockProtocol'),false);assert.equal(Object.hasOwn(await request('GET','/v1/pending-update-recovery/capabilities'),'lockProtocol'),false);
});
test('explicit migration from v1 or v2 keeps bytes, IDs, old requests and unknown lock evidence',async t=>{
 for(const version of [1,2])await t.test(String(version),async t=>{
  const f=directories(t);if(version===2)f.config.recovery={pendingUpdateRecords:true};let store=await SupervisorStore.open(f.config);const old={requestId:randomUUID(),action:'start',observationId:randomUUID()};store.begin(old);store.finish(old.requestId,{phase:'not_submitted',code:'changed',result:null,recovery:null});const rows=store.db.prepare('SELECT * FROM operations').all(),ledger=store.ledgerId,marker=hash(store.marker);await store.close();
  f.config.recovery={pendingUpdateLocks:true};store=await SupervisorStore.open(f.config);assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,3);assert.equal(store.ledgerId,ledger);assert.equal(hash(store.marker),marker);assert.deepEqual(store.db.prepare('SELECT * FROM operations').all(),rows);
  const request=arbitrary();store.beginLock(request);assert.throws(()=>store.begin({...old,requestId:request.requestId}),{code:'request_conflict'});assert.throws(()=>store.beginRecovery({requestId:request.requestId,action:'disable',recordId:'c'.repeat(64),ticketId:randomUUID(),expectedDigest:'d'.repeat(64)}),{code:'request_conflict'});assert.throws(()=>store.beginLock({...request,requestId:old.requestId}),{code:'request_conflict'});await store.close();
  f.config.recovery={pendingUpdateLocks:false};store=await SupervisorStore.open(f.config);assert.equal(store.getLock(request.requestId).operation.phase,'unknown');assert.equal(store.beginLock(request).created,false);assert.equal(store.getLock(request.requestId).operation.code,'interrupted');await store.close();
 });
});
test('failed v3 migration and corrupt old ledger preserve the exact old database without the new table',async t=>{
 for(const mode of ['rollback','corrupt'])await t.test(mode,async t=>{
  const f=directories(t);f.config.recovery={pendingUpdateRecords:true};const first=await SupervisorStore.open(f.config);await first.close();const file=path.join(f.config.stateDir,'operations.sqlite');if(mode==='corrupt'){const db=new DatabaseSync(file);db.prepare('INSERT INTO recovery_operations VALUES (?,?,?)').run(randomUUID(),'not-a-digest','{}');db.close();}const before=hash(file);f.config.recovery.pendingUpdateLocks=true;await assert.rejects(SupervisorStore.open(f.config,{hook:p=>{if(mode==='rollback'&&p==='beforeMigrationCommit')throw Error('injected');}}));const db=new DatabaseSync(file);assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='lock_operations'").get().n,0);db.close();assert.equal(hash(file),before);
 });
});
test('final COMMIT failure retains the independently readable attempted row after a real unlink',async t=>{
 let failing=false;const f=await fixture(t,{storeOptions:{hook:phase=>{if(failing&&phase==='beforeCommit')throw Error('injected');}}}),p=(await f.preview()).preview,confirm=f.service.pendingUpdateLocks.confirm.bind(f.service.pendingUpdateLocks);
 f.service.pendingUpdateLocks.confirm=async(...args)=>{const value=await confirm(...args);failing=true;return value;};
 const reply=await f.confirm(p);assert.equal(reply.operation.phase,'attempted');assert.equal(reply.operation.finishedAt,null);assert(!fs.existsSync(f.selection.lockFile));failing=false;
});
test('shared slot rejects process and plan mutations while lock verification is running',async t=>{
 const f=await fixture(t),gate=deferred(),verify=f.selection.prepared.resolvePrepared.bind(f.selection.prepared);let entered=false;
 f.selection.prepared.resolvePrepared=async(...args)=>{entered=true;await gate.promise;return verify(...args);};const preview=f.preview();while(!entered)await new Promise(r=>setTimeout(r,1));
 try{assert.equal((await f.request('GET','/v1/status')).code,'busy');assert.equal((await f.request('GET','/v1/pending-update-recovery/records')).code,'busy');const old=await f.request('POST','/v1/operations',{requestId:randomUUID(),action:'start',observationId:randomUUID()});assert.equal(old.operation.phase,'not_submitted');assert.equal(old.operation.code,'busy');}finally{gate.resolve();}assert.equal((await preview).ok,true);assert.equal(f.r.state.starts,0);
});
test('core false receipts and unknown cleanup facts survive exact parsing, inconsistent positive claims refuse',()=>{
 const result={receiptId:randomUUID(),committed:false,lockCleared:false,cleanupVerified:true,recoveryRequired:false,remainingLocks:{installation:false,recoveryGuard:false},pendingUpdateRecoveryRequired:true,updateRecordsChanged:false,accountRecordsChanged:false,automaticStart:false,automaticStop:false,rollsBackCode:false};
 const row={type:'pending-update-lock-recovery',requestId:randomUUID(),action:'clear-installation',recordId:'a'.repeat(64),phase:'completed',startedAt:1,finishedAt:2,code:'pending_lock_missing',result};assert.deepEqual(L.operation(row),row);assert.throws(()=>L.operation({...row,code:null}));
 const unknown={...result,committed:null,lockCleared:null,recoveryRequired:true};assert.equal(L.operation({...row,phase:'unknown',result:unknown}).result.cleanupVerified,true);assert.throws(()=>L.result({...unknown,recoveryRequired:false}));assert.throws(()=>L.result({...result,remainingLocks:{installation:null,recoveryGuard:false}}));
});
test('construction cleanup retains the exact retry owner before releasing state ownership',async t=>{
 const f=directories(t),r=runtime();let failures=1;r.close=async()=>{if(failures-- >0)throw Error('injected');return {closed:true};};let error;try{await createService({config:f.config,tls:material,runtimeFactory:()=>r,pendingUpdateLockFactory:()=>{throw Error('construction');}});}catch(e){error=e;}
 assert.equal(error.code,'cleanup_unconfirmed');await assert.rejects(SupervisorStore.open(f.config),{code:'busy'});assert.equal((await error.cleanupOwner.close()).closed,true);const opened=await SupervisorStore.open(f.config);await opened.close();
});
test('migration failure retains an unclosed store gate for exact cleanup without replaying migration',async t=>{
 const f=directories(t),first=await SupervisorStore.open(f.config);await first.close();f.config.recovery={pendingUpdateLocks:true};
 const ownership=require('../../../src/qq-supervisor/ownership.cjs'),original=ownership.lock;let failClose=true,migrations=0,error;
 ownership.lock=async(...args)=>{const gate=await original(...args),close=gate.close.bind(gate);gate.close=async()=>{if(failClose){failClose=false;throw Error('injected close');}return close();};return gate;};
 try{try{await SupervisorStore.open(f.config,{hook:phase=>{if(phase==='beforeMigrationCommit'){migrations++;throw Error('injected migration');}}});}catch(e){error=e;}
  assert.equal(error.code,'cleanup_unconfirmed');await assert.rejects(SupervisorStore.open(f.config),{code:'busy'});assert.equal((await error.cleanupOwner.close()).closed,true);assert.equal(migrations,1);
 }finally{ownership.lock=original;if(error?.cleanupOwner)await error.cleanupOwner.close();}
 const db=new DatabaseSync(path.join(f.config.stateDir,'operations.sqlite'));assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);db.close();
 const reopened=await SupervisorStore.open({...f.config,recovery:{pendingUpdateLocks:false}});assert.equal(reopened.lockTable,false);await reopened.close();
});
