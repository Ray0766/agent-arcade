'use strict';
// Pure observation classification: no compiler, process/CIM query or fixture.
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyRecordedAbsence,stopRecordedCleanup}=require('./helpers/qq-shell-owner-live-fixture.cjs');
const first={pid:1234,createdAt:'2026-11-07T00:00:00.1234560Z',executable:'C:\\private-fixture\\QQ.exe'},second={pid:5678,createdAt:'2026-11-07T00:00:01.1234560Z',executable:'C:\\private-fixture\\manager.exe'};
test('native fixture confirms missing exact identities and keeps a real survivor visible',()=>{const empty=classifyRecordedAbsence([first,second],[]);assert.equal(empty.absent.length,2);assert.equal(empty.remaining.length,0);const live=classifyRecordedAbsence([first,second],[{...first,executable:first.executable.toUpperCase()}]);assert.deepEqual(live.absent,[second]);assert.equal(live.remaining.length,1);assert.equal(live.replacements.length,0);});
test('a later creation time proves a recycled PID even when the path is unchanged',()=>{for(const patch of [{createdAt:'2026-11-07T00:00:00.1234570Z'},{createdAt:'2026-11-07T00:00:03.1234560Z',executable:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'}]){const replacement={...first,...patch},result=classifyRecordedAbsence([first,second],[replacement]);assert.equal(result.remaining.length,0);assert.deepEqual(result.absent,[first,second]);assert.deepEqual(result.replacements,[replacement]);}});
test('equivalent timestamps still identify the live process and conflicting paths do not prove reuse',()=>{const synonymous={...first,createdAt:'2026-11-07T00:00:00.123456+00:00'},result=classifyRecordedAbsence([first],[synonymous]);assert.equal(result.remaining.length,1);assert.equal(result.absent.length,0);assert.equal(result.replacements.length,0);assert.throws(()=>classifyRecordedAbsence([first],[{...synonymous,executable:'C:\\other.exe'}]));assert.throws(()=>classifyRecordedAbsence([first],[{...first,createdAt:'2026-11-06T00:00:00.1234560Z'}]));});
test('unknown, malformed, duplicate or unrelated process metadata never proves absence',()=>{for(const patch of [{createdAt:''},{createdAt:null},{createdAt:'invalid'},{executable:''},{executable:'QQ.exe'},{pid:0}])assert.throws(()=>classifyRecordedAbsence([first],[{...first,...patch}]));assert.throws(()=>classifyRecordedAbsence([first],[{...second}]));assert.throws(()=>classifyRecordedAbsence([first],[{...first},{...first}]));assert.throws(()=>classifyRecordedAbsence([first,first],[]));});
test('calendar rollovers, 24-hour aliases and incomplete Windows paths fail before reuse classification',()=>{for(const createdAt of ['2026-11-31T00:00:00.1234560Z','2026-02-29T00:00:00.1234560Z','2026-12-01T24:00:00Z','2026-12-01T00:60:00Z','2026-12-01T00:00:60Z'])assert.throws(()=>classifyRecordedAbsence([first],[{...first,createdAt}]));for(const executable of ['\\foo.exe','C:foo.exe','\\\\host\\','\\\\host\\share'])assert.throws(()=>classifyRecordedAbsence([first],[{...first,createdAt:'2026-12-01T00:00:00.1234560Z',executable}]));const complete=classifyRecordedAbsence([first],[{...first,createdAt:'2028-02-29T00:00:00.1234560Z',executable:'\\\\host\\share\\fixture.exe'}]);assert.equal(complete.replacements.length,1);});

// Exact shape of the saved failure, with fixture-only paths. No native queries.
test('pre-stop cleanup excludes a proven later replacement without terminating it',async()=>{
 const old={pid:57188,parentPid:58440,createdAt:'2026-11-07T18:03:01.5959080Z',executable:'C:\\private-fixture\\QQ.exe'},replacement={pid:57188,parentPid:58148,createdAt:'2026-11-07T18:03:15.2323470Z',executable:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'};
 assert.throws(()=>assert(old.pid===replacement.pid&&old.createdAt===replacement.createdAt&&old.executable.toLowerCase()===replacement.executable.toLowerCase(),'cleanup identity changed'),/cleanup identity changed/);
 let stopped=0,recorded;const observed=await stopRecordedCleanup([old],[replacement],async()=>{stopped++;},value=>{recorded=value;});assert.equal(stopped,0);assert.equal(observed,recorded);assert.deepEqual(observed.replacements,[replacement]);assert.deepEqual(observed.absent,[old]);assert.deepEqual(observed.remaining,[]);
});
test('pre-stop cleanup stops only exact survivors and preserves parent-first ordering',async()=>{
 const parent={...first,parentPid:10},child={...second,parentPid:first.pid},old={pid:9012,parentPid:10,createdAt:first.createdAt,executable:first.executable},replacement={...old,createdAt:'2026-11-07T00:00:02.1234560Z'},calls=[];
 const observed=await stopRecordedCleanup([parent,child,old],[child,replacement,parent],async rows=>{calls.push(rows);});assert.equal(calls.length,1);assert.deepEqual(calls[0],[parent,child]);assert.deepEqual(observed.replacements,[replacement]);assert.deepEqual(observed.absent,[old]);
});
test('pre-stop cleanup does not turn malformed or conflicting identity into absence',async()=>{
 const cases=[[{...first,createdAt:''}],[{...first,createdAt:'2026-11-06T00:00:00.1234560Z'}],[{...first,executable:'C:\\different.exe'}],[{...first,createdAt:'2026-11-07T00:00:01.1234560Z',executable:''}],[{...first},{...first}],[{...second}]];
 for(const rows of cases){let calls=0;await assert.rejects(stopRecordedCleanup([first],rows,async()=>{calls++;}));assert.equal(calls,0);}
});
test('pre-stop cleanup retains the existing strict identity check for survivors',async()=>{
 let calls=0;await assert.rejects(stopRecordedCleanup([first],[{...first,createdAt:'2026-11-07T00:00:00.123456+00:00'}],async()=>{calls++;}),/cleanup identity changed/);assert.equal(calls,0);
});
test('pre-stop cleanup preserves a real stop failure and does not retry',async()=>{
 const failure=Object.assign(Error('synthetic stop failure'),{code:'stop_failed'});let calls=0,recorded;await assert.rejects(stopRecordedCleanup([first],[first],async()=>{calls++;throw failure;},value=>{recorded=value;}),e=>e===failure);assert.equal(calls,1);assert.deepEqual(recorded.remaining,[first]);
});
