'use strict';
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict'),fs=require('node:fs');
const {QQPendingUpdateLockRecovery}=require('../src/bot/qq-pending-update-lock-recovery.cjs');
const {fixture}=require('./helpers/qq-pending-update-lock-fixture.cjs');
const old={pid:919999,createdAt:'2026-11-07T00:00:00.1234560Z',executable:'C:\\synthetic\\owner.exe'};
const later={...old,createdAt:'2026-11-07T00:00:00.1234570Z',executable:'C:\\synthetic\\replacement.exe'};
function sample(snapshot,direct){const calls=[],core=Object.create(QQPendingUpdateLockRecovery.prototype);core.host={snapshot:async()=>{calls.push('snapshot');if(snapshot instanceof Error)throw snapshot;return structuredClone(snapshot);},inspect:async pids=>{calls.push('inspect');assert.deepEqual(pids,[old.pid]);if(direct instanceof Error)throw direct;return structuredClone(direct);}};return {core,calls};}
for(const [label,full,direct]of [['absent/absent',[],[]],['absent/later',[],[later]],['later/absent',[later],[]],['same later twice',[later],[later]]])test(`two observations exclude original owner: ${label}`,async()=>{const {core,calls}=sample(full,direct);await core._dead({owner:old});assert.deepEqual(calls,['snapshot','inspect']);});
for(const [label,full,direct,code]of [
 ['original/original',[old],[old],'pending_lock_owner_alive'],['original/absent',[old],[],'pending_lock_owner_alive'],['absent/original',[],[old],'pending_lock_owner_alive'],
 ['original/later',[old],[later],'pending_lock_owner_alive'],['later/original',[later],[old],'pending_lock_owner_alive'],
 ['same instant different path',[],[{...later,createdAt:old.createdAt}],'pending_lock_owner_changed'],
 ['earlier identity',[],[{...later,createdAt:'2026-11-07T00:00:00.1234559Z'}],'pending_lock_owner_changed'],
 ['conflicting later identities',[later],[{...later,createdAt:'2026-11-07T00:00:00.1234580Z'}],'pending_lock_owner_unverified'],
 ['same later time conflicting path',[later],[{...later,executable:'C:\\synthetic\\third.exe'}],'pending_lock_owner_unverified'],
 ['duplicate full',[later,later],[],'pending_lock_owner_unverified'],['duplicate direct',[],[later,later],'pending_lock_owner_unverified'],
 ['wrong direct PID',[],[{...later,pid:1234}],'pending_lock_owner_unverified'],
 ['unobservable full',null,[],'pending_lock_owner_unverified'],['unobservable direct',[],null,'pending_lock_owner_unverified'],
 ['oversized full',Array(4097).fill({pid:1}),[],'pending_lock_owner_unverified'],
 ['host snapshot error',Error('synthetic'),[],'pending_lock_owner_unverified'],['host direct error',[],Error('synthetic'),'pending_lock_owner_unverified'],
 ['missing executable',[],[{...later,executable:''}],'pending_lock_owner_unverified'],['root-relative executable',[],[{...later,executable:'\\synthetic\\new.exe'}],'pending_lock_owner_unverified'],
 ['UNC executable',[],[{...later,executable:'\\\\server\\share\\new.exe'}],'pending_lock_owner_unverified'],['incomplete time',[],[{...later,createdAt:'2026-11-08'}],'pending_lock_owner_unverified']
])test(`unsafe owner evidence refuses: ${label}`,async()=>{const {core}=sample(full,direct);await assert.rejects(core._dead({owner:old}),{code});});
for(const [label,prior,next,success]of [
 ['100 ns later','2026-11-07T00:00:00.1234560Z','2026-11-07T00:00:00.1234561Z',true],
 ['100 ns earlier','2026-11-07T00:00:00.1234561Z','2026-11-07T00:00:00.1234560Z',false],
 ['microsecond later','2026-11-07T00:00:00.1234500Z','2026-11-07T00:00:00.1234510Z',true],
 ['equivalent offset','2026-11-07T00:00:00.1234560Z','2026-11-07T11:00:00.1234560+11:00',false],
 ['offset 100 ns later','2026-11-07T00:00:00.1234560Z','2026-11-07T11:00:00.1234561+11:00',true],
 ['negative offset same instant','2026-11-07T00:00:00.1234560Z','2026-11-06T20:30:00.1234560-03:30',false],
 ['fraction zero extension','2026-11-07T00:00:00.1Z','2026-11-07T00:00:00.1000000Z',false],
 ['no fraction same instant','2026-11-07T00:00:00Z','2026-11-07T00:00:00.0000000Z',false],
 ['leap day later','2024-02-28T23:59:59.9999999Z','2024-02-29T00:00:00Z',true],
 ['century leap day later','2000-02-28T23:59:59.9999999Z','2000-02-29T00:00:00Z',true],
 ['pre-epoch fractional boundary','1969-12-31T23:59:59.9999998Z','1969-12-31T23:59:59.9999999Z',true],
 ['year 0099 retained','0099-01-01T00:00:00Z','0099-01-01T00:00:00.0000001Z',true]
])test(`exact serialized timestamp: ${label}`,async()=>{const expected={...old,createdAt:prior},replacement={...later,createdAt:next},{core}=sample([],[replacement]);if(success)await core._dead({owner:expected});else await assert.rejects(core._dead({owner:expected}),{code:'pending_lock_owner_changed'});});
for(const invalid of ['2026-02-29T00:00:00Z','1900-02-29T00:00:00Z','2026-04-31T00:00:00Z','2026-01-00T00:00:00Z','0000-01-01T00:00:00Z','2026-13-01T00:00:00Z','2026-11-08T24:00:00Z','2026-11-08T23:60:00Z','2026-11-08T23:59:60Z','2026-11-08T00:00:00.12345678Z','2026-11-08T00:00:00+14:01','2026-11-08T00:00:00+23:00','2026-11-08T00:00:00+00:60','2026-11-08T00:00:00','2026-11-08T00:00:00.***Z'])test(`incomplete or invalid calendar cannot prove replacement: ${invalid}`,async()=>{const {core}=sample([],[{...later,createdAt:invalid}]);await assert.rejects(core._dead({owner:old}),{code:'pending_lock_owner_unverified'});const empty=sample([],[]);await assert.rejects(empty.core._dead({owner:{...old,createdAt:invalid}}),{code:'pending_lock_owner_unverified'});assert.deepEqual(empty.calls,[]);});
test('strict current-manager observation still rejects absent/present even with complete later metadata',async()=>{const {core}=sample([],[later]);await assert.rejects(core._observe(old.pid),{code:'pending_lock_owner_unverified'});});
test('strict current-manager observation still rejects two different valid identities',async()=>{const {core}=sample([old],[later]);await assert.rejects(core._observe(old.pid),{code:'pending_lock_owner_unverified'});});
test('later replacement across all phases clears exact old lock without stopping/adopting replacement',async t=>{const f=fixture(t);f.lock();const replacement={...f.dead,parentPid:1,name:'replacement.exe',createdAt:'2026-11-07T00:00:00.0000010Z',executable:'C:\\synthetic\\replacement.exe'};f.r.state.rows.push(replacement);const marker=fs.readFileSync(f.marker),p=await f.preview(),done=await f.confirm(p);assert.equal(done.committed,true);assert.equal(done.lockCleared,true);assert.equal(done.cleanupVerified,true);assert.equal(fs.existsSync(f.selection.lockFile),false);assert.deepEqual(fs.readFileSync(f.marker),marker);assert(f.r.state.rows.some(x=>x.pid===replacement.pid&&x.createdAt===replacement.createdAt));assert.equal(f.r.state.starts,0);assert.equal(f.r.state.stops,0);});
test('absent inventory and later direct owner is accepted while stopped-process checks remain independent',async t=>{const f=fixture(t);f.lock();const original=f.host.inspect.bind(f.host),replacement={...f.dead,parentPid:1,name:'replacement.exe',createdAt:'2026-11-07T00:00:00.0000010Z',executable:'C:\\synthetic\\replacement.exe'};f.host.inspect=async pids=>pids.includes(f.dead.pid)?[replacement]:original(pids);const done=await f.confirm(await f.preview());assert.equal(done.committed,true);assert.equal(f.r.state.stops,0);assert.equal(f.r.state.starts,0);});
test('original owner appearing only at confirmation prevents deletion',async t=>{const f=fixture(t);f.lock();const p=await f.preview();f.r.state.rows.push({...f.dead,parentPid:1,name:'owner.exe'});const done=await f.confirm(p);assert.equal(done.committed,false);assert.equal(done.code,'pending_lock_owner_alive');assert(fs.existsSync(f.selection.lockFile));assert.equal(f.r.state.stops,0);});
test('later PID does not bypass a live managed QQ process',async t=>{const f=fixture(t);f.lock();f.r.state.rows.push({...f.dead,createdAt:'2026-11-07T00:00:00.0000010Z',name:'QQ.exe',executable:f.r.paths.qqExe,parentPid:1});await assert.rejects(f.preview(),{code:'runtime_running'});assert(fs.existsSync(f.selection.lockFile));assert.equal(f.r.state.stops,0);});
