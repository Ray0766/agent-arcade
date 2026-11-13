'use strict';
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,hash}=require('./helpers/qq-shell-owner-fixture.cjs');
async function orphan(t,{journal=false,two=false}={}){
 const f=fixture(t);await f.runtime.start(f.account);if(two){const run=f.runtime.runs.get(f.account),p={pid:f.state.next++,parentPid:run.proof.pid,name:'QQ.exe',executable:f.qqExe,createdAt:'2026-11-07T00:01:02.0000000Z'};f.state.rows.push(p);run.lease.runtimeTree.push({pid:p.pid,parentPid:p.parentPid,executable:p.executable,createdAt:p.createdAt});f.runtime._writeLease(run.lease);}
 const lease=f.deadManager();f.state.rows=f.state.rows.filter(p=>p.pid!==lease.runtime.pid);const marker=journal?f.journal():f.marker(),r=f.fresh();return {...f,r,lease,markerPath:marker};
}
const preview=f=>f.r.previewOrphanCleanup(f.account);
const confirm=(f,p,options={})=>f.r.cleanupOrphans(f.account,{expectedDigest:p.expectedDigest,...options});
const errorCode=code=>e=>e.code===code;
function latch(){let release,enter;const held=new Promise(r=>{release=r;}),entered=new Promise(r=>{enter=r;});return {held,entered,release,enter};}
const facts=e=>{assert.equal(e.cleanupAttempted,true);assert.deepEqual(Object.keys(e.cleanup).sort(),['kind','accountId','selectedCount','confirmedAbsentCount','terminationAttempted','processes','lease','resources','automaticStart','pendingUpdateRecoveryRequired'].sort());return e.cleanup;};

test('pending orphan capability and once-only local cleanup preserve blocker, data and unrelated process',async t=>{
 const f=await orphan(t),bytes=fs.readFileSync(f.markerPath),st=fs.lstatSync(f.markerPath,{bigint:true}),other={pid:940001,parentPid:1,name:'QQ.exe',executable:path.join(f.base,'other','QQ.exe'),createdAt:'2026-11-07T00:00:00Z'};f.state.rows.push(other);
 const row=(await f.r.discover()).instances[0];assert.equal(row.canInspectOrphanCleanup,true);assert.equal(row.canStart,false);assert.equal(row.canRecover,false);assert.equal(row.canStop,false);assert.equal(row.reason,'pending_upstream_update');
 const p=await preview(f);assert.equal(p.action,'terminate');assert.equal(p.count,1);assert(Number.isFinite(Date.parse(p.expiresAt)));const done=await confirm(f,p);assert.equal(done.recovery,'orphans-cleared');assert.equal(done.terminatedCount,1);assert.equal(done.cleanup.processes,'confirmed-absent');assert.equal(done.cleanup.lease,'cleared');assert.equal(done.cleanup.resources,'closed');assert.equal(f.state.stops.length,1);assert(f.state.rows.some(v=>v.pid===other.pid));
 assert.deepEqual(fs.readFileSync(f.markerPath),bytes);assert.equal(fs.lstatSync(f.markerPath,{bigint:true}).ino,st.ino);assert.equal(fs.readFileSync(path.join(f.qqDataDir,'sentinel'),'utf8'),'UNCHANGED');assert(!fs.existsSync(f.r._lockPath(f.account)));await assert.rejects(confirm(f,p),errorCode('orphan_cleanup_changed'));await assert.rejects(f.r.start(f.account),errorCode('pending_upstream_update'));
});
test('expired nonce and exact discard never execute; old digest cannot consume newer preview',async t=>{
 const f=await orphan(t);let mono=100;f.r._pendingOrphans().now=()=>mono;const old=await preview(f);mono+=60000;await assert.rejects(confirm(f,old),errorCode('orphan_cleanup_changed'));const a=await preview(f),b=await preview(f);assert.notEqual(a.expectedDigest,b.expectedDigest);assert.deepEqual(f.r.discardOrphanPreview(f.account,{expectedDigest:a.expectedDigest}),{discarded:false});await assert.rejects(confirm(f,a),errorCode('orphan_cleanup_changed'));await confirm(f,b);assert.equal(f.state.stops.length,1);
});
test('discard invalidates consumed ticket while beforeStop awaits, with zero stop',async t=>{
 const f=await orphan(t),p=await preview(f),l=latch();const running=confirm(f,p,{beforeStop:async()=>{l.enter();await l.held;}});await l.entered;
 assert.deepEqual(f.r.discardOrphanPreview(f.account,{expectedDigest:p.expectedDigest}),{discarded:true});l.release();await assert.rejects(running,errorCode('orphan_cleanup_changed'));assert.equal(f.state.stops.length,0);assert(fs.existsSync(f.r._lockPath(f.account)));
});
test('late discard after native stop begins preserves proved cleanup success',async t=>{
 const f=await orphan(t),p=await preview(f),l=latch(),stop=f.host.stop;f.host.stop=async ids=>{l.enter();await l.held;return stop(ids);};const running=confirm(f,p);await l.entered;f.r.discardOrphanPreview(f.account,{expectedDigest:p.expectedDigest});l.release();const done=await running;assert.equal(done.cleanup.lease,'cleared');assert.equal(done.cleanup.terminationAttempted,true);assert.equal(f.state.stops.length,1);
});
test('caller scope changes during inspection cannot issue a preview ticket',async t=>{
 const f=await orphan(t),l=latch(),snap=f.host.snapshot;let current=true,once=true;f.host.snapshot=async()=>{if(once){once=false;l.enter();await l.held;}return snap();};const pending=f.r.previewOrphanCleanup(f.account,{assertCurrent(){if(!current)throw Object.assign(Error('scope'),{code:'changed'});}});await l.entered;current=false;l.release();await assert.rejects(pending,errorCode('changed'));assert.equal(f.r._pendingOrphans().tickets.size,0);assert.equal(f.state.stops.length,0);
});
test('scope close during beforeStop retires consumed authorization and waits without killing',async t=>{
 const f=await orphan(t),p=await preview(f),l=latch();const pending=confirm(f,p,{beforeStop:async()=>{l.enter();await l.held;}});await l.entered;const close=f.r.close();l.release();await assert.rejects(pending,errorCode('manager_closing'));assert.equal((await close).closed,true);assert.equal(f.state.stops.length,0);assert(fs.existsSync(f.r._lockPath(f.account)));
});
test('double confirm does not add another native call',async t=>{
 const f=await orphan(t),p=await preview(f),l=latch();const pending=confirm(f,p,{beforeStop:async()=>{l.enter();await l.held;}});await l.entered;await assert.rejects(confirm(f,p),errorCode('orphan_cleanup_changed'));l.release();await pending;assert.equal(f.state.stops.length,1);
});
test('busy Preview cannot retire consumed authorization or start another inspection',async t=>{
 const f=await orphan(t),p=await preview(f),l=latch();const pending=confirm(f,p,{beforeStop:async()=>{l.enter();await l.held;}});await l.entered;await assert.rejects(preview(f),errorCode('operation_in_progress'));l.release();assert.equal((await pending).recovery,'orphans-cleared');assert.equal(f.state.stops.length,1);
});
test('final pre-stop deadline and caller scope remain enforced after beforeStop',async t=>{
 for(const mode of ['deadline','scope'])await t.test(mode,async t=>{const f=await orphan(t);let now=0,valid=true;f.r._pendingOrphans().now=()=>now;const p=await preview(f);await assert.rejects(confirm(f,p,{assertCurrent(){if(!valid)throw Object.assign(Error('scope'),{code:'changed'});},beforeStop:async()=>{if(mode==='deadline')now=60000;else valid=false;}}),errorCode(mode==='deadline'?'orphan_cleanup_changed':'changed'));assert.equal(f.state.stops.length,0);});
});
test('lease bytes, original lock absence, and child parent changes invalidate the exact preview',async t=>{
 for(const mode of ['lease','lock','parent'])await t.test(mode,async t=>{const f=await orphan(t),p=await preview(f);await assert.rejects(confirm(f,p,{beforeStop:async()=>{if(mode==='lease')fs.appendFileSync(f.r._lockPath(f.account),' ');else if(mode==='lock')fs.writeFileSync(f.r.componentSelection().lockFile,'FOREIGN_INVALID_LOCK');else f.state.rows.find(v=>v.pid===f.lease.runtimeTree[1].pid).parentPid=1;}}));assert.equal(f.state.stops.length,0);assert(fs.existsSync(f.r._lockPath(f.account)));});
});
test('v1, managed Node and runtime-null leases do not receive pending cleanup authority',async t=>{
 for(const mode of ['legacy','node','empty'])await t.test(mode,async t=>{const f=await orphan(t),file=f.r._lockPath(f.account),v=JSON.parse(fs.readFileSync(file));if(mode==='legacy')v.version=1;if(mode==='node')v.engine='managed-node';if(mode==='empty'){v.runtime=null;v.runtimeTree=[];}fs.writeFileSync(file,JSON.stringify(v));await assert.rejects(preview(f),errorCode('ownership_lost'));assert.equal((await f.r.discover()).instances[0].canInspectOrphanCleanup,undefined);assert.equal(f.state.stops.length,0);});
});
test('reused manager PID, unknown descendant and foreign same-path QQ are not cleanup candidates',async t=>{
 for(const mode of ['manager','descendant','foreign'])await t.test(mode,async t=>{const f=await orphan(t);f.state.rows.push(mode==='manager'?{pid:f.lease.manager.pid,parentPid:1,name:'other.exe',executable:process.execPath,createdAt:'2026-11-07T03:00:00Z'}:{pid:940002,parentPid:mode==='descendant'?f.lease.runtimeTree[1].pid:1,name:'QQ.exe',executable:f.qqExe,createdAt:'2026-11-07T03:00:00Z'});await assert.rejects(preview(f),errorCode(mode==='manager'?'ownership_lost':'orphan_cleanup_unverified'));assert.equal(f.state.stops.length,0);});
});
test('partial native failure reports confirmed absence count and retains exact lease',async t=>{
 const f=await orphan(t,{two:true}),p=await preview(f),stop=f.host.stop;f.host.stop=async ids=>{await stop(ids.slice(0,1));throw Object.assign(Error('partial'),{code:'stop_failed'});};let failure;try{await confirm(f,p);}catch(e){failure=e;}const c=facts(failure);assert.equal(c.selectedCount,2);assert.equal(c.confirmedAbsentCount,1);assert.equal(c.processes,'remaining');assert.equal(c.lease,'retained');assert.equal(c.resources,'closed');assert.equal(c.terminationAttempted,true);assert.equal(f.state.stops.length,1);assert.equal((await preview(f)).count,1);
});
test('known absent processes with failed lease removal offer explicit zero-stop settlement',async t=>{
 const f=await orphan(t),p=await preview(f),file=f.r._lockPath(f.account),unlink=fs.unlinkSync;let once=true;fs.unlinkSync=function(target){if(target===file&&once){once=false;throw Object.assign(Error('fixture unlink'),{code:'EIO'});}return unlink.apply(this,arguments);};let failure;try{await confirm(f,p);}catch(e){failure=e;}finally{fs.unlinkSync=unlink;}const c=facts(failure);assert.equal(c.processes,'confirmed-absent');assert.equal(c.lease,'retained');assert.equal(c.resources,'closed');const row=(await f.r.discover()).instances[0];assert.equal(row.canInspectOrphanCleanup,true);assert.equal(row.canRecover,false);assert.equal(row.processRunning,false);const s=await preview(f);assert.equal(s.action,'settle');assert.equal(s.count,0);const done=await confirm(f,s);assert.equal(done.terminatedCount,0);assert.equal(done.cleanup.selectedCount,1);assert.equal(done.cleanup.terminationAttempted,false);assert.equal(done.cleanup.lease,'cleared');assert.equal(f.state.stops.length,1);
});
test('proved lease unlink plus failed held FD close stays known and retries without a second stop',async t=>{
 const f=await orphan(t),p=await preview(f),close=fs.closeSync,unlink=fs.unlinkSync,file=f.r._lockPath(f.account);let failed=false,unlinked=false;fs.unlinkSync=function(target){const x=unlink.apply(this,arguments);if(target===file)unlinked=true;return x;};fs.closeSync=function(fd){if(unlinked&&!failed){failed=true;throw Object.assign(Error('fixture close'),{code:'EIO'});}return close.apply(this,arguments);};let failure;try{await confirm(f,p);}catch(e){failure=e;}finally{fs.closeSync=close;fs.unlinkSync=unlink;}const c=facts(failure);assert.equal(c.lease,'cleared');assert.equal(c.resources,'unconfirmed');const s=await preview(f);assert.equal(s.action,'settle');const result=await confirm(f,s);assert.equal(result.cleanup.resources,'closed');assert.equal(result.terminatedCount,0);assert.equal(f.state.stops.length,1);
});
test('partial processes and guard cleanup failure can settle resources without repeating termination',async t=>{
 const f=await orphan(t,{two:true}),p=await preview(f),stop=f.host.stop,unlink=fs.unlinkSync;f.host.stop=async ids=>stop(ids.slice(0,1));let once=true;fs.unlinkSync=function(file){if(file===`${f.r._lockPath(f.account)}.recover`&&once){once=false;throw Object.assign(Error('fixture guard'),{code:'EIO'});}return unlink.apply(this,arguments);};let failure;try{await confirm(f,p);}catch(e){failure=e;}finally{fs.unlinkSync=unlink;}assert.equal(facts(failure).resources,'unconfirmed');const s=await preview(f);assert.equal(s.action,'settle');try{await confirm(f,s);assert.fail('partial result required');}catch(e){const c=facts(e);assert.equal(c.processes,'remaining');assert.equal(c.resources,'closed');assert.equal(c.lease,'retained');assert.equal(c.terminationAttempted,false);}assert.equal(f.state.stops.length,1);assert.equal((await preview(f)).action,'terminate');
});
test('two-link pending records keep exact bytes, identity and link count after cleanup',async t=>{
 const f=await orphan(t,{journal:true}),other=path.join(path.dirname(f.markerPath),'intent.json');fs.linkSync(f.markerPath,other);const before=fs.lstatSync(f.markerPath,{bigint:true}),sha=hash(fs.readFileSync(f.markerPath));const p=await preview(f);await confirm(f,p);const after=fs.lstatSync(f.markerPath,{bigint:true});assert.equal(after.ino,before.ino);assert.equal(after.nlink,2n);assert.equal(hash(fs.readFileSync(other)),sha);assert.equal(hash(fs.readFileSync(f.markerPath)),sha);
});
test('failed inspection cleanup before selection offers resource preview and retains manager close retry',async t=>{
 const f=await orphan(t),unlink=fs.unlinkSync;let block=true;fs.unlinkSync=function(file){if(block&&String(file).endsWith('.lock.recover'))throw Object.assign(Error('fixture guard'),{code:'EIO'});return unlink.apply(this,arguments);};
 try{await assert.rejects(preview(f),errorCode('cleanup_unconfirmed'));const owner=f.r._pendingOrphans().owners.get(f.account);assert(owner);assert.equal(owner.selected,undefined);const pending=await preview(f);assert.equal(pending.kind,'pending-shell-inspection-resources');assert.equal(pending.action,'settle-resources');assert.equal(Object.hasOwn(pending,'count'),false);assert.equal((await f.r.close()).closed,false);assert.equal(f.r._pendingOrphans().owners.get(f.account),owner);block=false;assert.equal((await f.r.close()).closed,true);assert.equal(f.r._pendingOrphans().owners.size,0);assert.equal(f.state.stops.length,0);}finally{fs.unlinkSync=unlink;await f.r._pendingOrphans().close();}
});
test('manager close still attempts orphan resource closure when its normal Shell owner rejects',async t=>{
 const f=await orphan(t),unlink=fs.unlinkSync;let block=true;fs.unlinkSync=function(file){if(block&&String(file).endsWith('.lock.recover'))throw Object.assign(Error('fixture guard'),{code:'EIO'});return unlink.apply(this,arguments);};try{await assert.rejects(preview(f),errorCode('cleanup_unconfirmed'));}finally{fs.unlinkSync=unlink;}
 let calls=0;const regular=f.r.shellOwnerProof;f.r.shellOwnerProof={async close(){if(++calls===1)throw Object.assign(Error('fixture old owner'),{code:'cleanup_unconfirmed'});return {closed:true};}};try{assert.equal((await f.r.close()).closed,false);assert.equal(f.r._pendingOrphans().owners.size,0);assert.equal((await f.r.close()).closed,true);assert.equal(calls,2);assert.equal(f.state.stops.length,0);}finally{f.r.shellOwnerProof=regular;}
});
