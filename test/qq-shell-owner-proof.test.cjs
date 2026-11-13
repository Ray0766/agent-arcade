'use strict';
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {QQShellOwnerProof,validateLease,MAX_LEASE}=require('../src/bot/qq-shell-owner-proof.cjs');
const {fixture}=require('./helpers/qq-shell-owner-fixture.cjs');
const {gateEndpoint}=require('../src/bot/qq-component-lock-recovery.cjs');
test('strict v2 parser distinguishes engines, exact fields and primitive inode proof',async t=>{
 const f=fixture(t);await f.runtime.start(f.account);const v=JSON.parse(fs.readFileSync(f.runtime._lockPath(f.account)));assert.equal(validateLease(v,f.account),v);assert(fs.statSync(f.runtime._lockPath(f.account)).size<MAX_LEASE);
 for(const change of [x=>x.extra=true,x=>x.engine='managed-node',x=>x.binding.directories.workDir.identity.ino=123,x=>x.runtime.parentPid=42,x=>x.runtimeTree.push({...x.runtime}),x=>x.manager.extra=true]){const x=structuredClone(v);change(x);assert.throws(()=>validateLease(x,f.account),{code:'ownership_lost'});}
});
test('read keep validation failure releases its exact descriptor; unknown close remains owned for retry',async t=>{
 const f=fixture(t),p=new QQShellOwnerProof(),file=path.join(f.base,'read.bin');fs.writeFileSync(file,'original');const original=fs.readSync;let changed=false;fs.readSync=function(fd,...args){const n=original.call(fs,fd,...args);if(!changed){changed=true;fs.appendFileSync(file,'changed');}return n;};try{assert.throws(()=>p.read(file,100,{keep:true}),{code:'ownership_lost'});}finally{fs.readSync=original;}assert.equal(p.handles.size,0);assert.deepEqual(await p.close(),{closed:true});
});
test('exclusive guard first fsync failure is owned and cleanup removes only its inode',async t=>{
 const f=fixture(t);await f.runtime.start(f.account);f.marker();const p=f.runtime._shellProof(),sync=fs.fsyncSync;let failed=false;fs.fsyncSync=function(fd){if(!failed){failed=true;throw Object.assign(Error('synthetic EIO'),{code:'EIO'});}return sync.call(fs,fd);};try{await assert.rejects(f.runtime.inspectOwnerControl(f.account));}finally{fs.fsyncSync=sync;}assert(failed);assert.equal(p.guards.size,0);assert.equal(p.handles.size,0);assert.equal(p.gates.size,0);assert(!fs.existsSync(f.runtime.componentSelection().lockFile+'.recover'));assert.equal(f.state.stops.length,0);
});
test('guard unlink applied-then-thrown uses original held inode and parents to confirm cleanup',async t=>{
 const f=fixture(t);await f.runtime.start(f.account);f.marker();const p=f.runtime._shellProof(),unlink=fs.unlinkSync;let hit=false;fs.unlinkSync=function(file){const r=unlink.call(fs,file);if(String(file).endsWith('.lock.recover')&&!hit){hit=true;throw Object.assign(Error('synthetic after unlink'),{code:'EIO'});}return r;};try{assert.equal((await f.runtime.inspectOwnerControl(f.account)).row.canStop,true);}finally{fs.unlinkSync=unlink;}assert(hit);assert.equal(p.guards.size,0);assert.equal(p.handles.size,0);assert.equal(p.gates.size,0);
});
test('unconfirmed guard cleanup blocks reuse and can retry exact close without repeating process action',async t=>{
 const f=fixture(t);await f.runtime.start(f.account);f.marker();const p=f.runtime._shellProof(),unlink=fs.unlinkSync;let fail=true;fs.unlinkSync=function(file){if(fail&&String(file).endsWith('.lock.recover'))throw Object.assign(Error('synthetic EIO'),{code:'EIO'});return unlink.call(fs,file);};try{await assert.rejects(f.runtime.stop(f.account),e=>e.code==='cleanup_unconfirmed'&&e.result?.management==='stopped');assert.equal(f.state.stops.length,1);assert.equal(p.guards.size,1);await assert.rejects(p.withGuard({},()=>{}),{code:'cleanup_unconfirmed'});const first=await f.runtime.close();assert.equal(first.closed,false);fail=false;const second=await f.runtime.close();assert.equal(second.closed,true);assert.equal(f.state.stops.length,1);}finally{fs.unlinkSync=unlink;await p.close();}
});
test('false server.listening does not prove a failed close completed; exact close event permits retry',async t=>{
 const p=new QQShellOwnerProof();let calls=0;const owner={working:false,closing:false,closed:false,server:{listening:false,close(cb){calls++;cb(Object.assign(Error('synthetic no close event'),{code:'ERR_SERVER_NOT_RUNNING'}));}}};p.gates.add(owner);await assert.rejects(p.close(),{code:'cleanup_unconfirmed'});assert.equal(p.gates.size,1);owner.closed=true;assert.deepEqual(await p.close(),{closed:true});assert.equal(calls,1);
});
test('initial fstat unknown descriptor is never re-proved or closed by a new observation',async t=>{
 const f=fixture(t),p=new QQShellOwnerProof(),file=path.join(f.base,'unknown.guard'),stat=fs.fstatSync;let first=true;fs.fstatSync=function(...args){if(first){first=false;throw Object.assign(Error('synthetic EIO'),{code:'EIO'});}return stat.apply(fs,args);};try{assert.throws(()=>p._newGuard(file,{synthetic:true}));}finally{fs.fstatSync=stat;}assert.equal(p.guards.size,1);assert.equal(p.handles.size,1);await assert.rejects(p.close(),{code:'cleanup_unconfirmed'});const fd=[...p.handles.keys()][0];fs.closeSync(fd);await p.close();assert.equal(p.handles.size,0);assert.equal(p.guards.size,0);assert(fs.existsSync(file));
});
test('the shared installation OS gate excludes owner actions without deleting original records',async t=>{
 const f=fixture(t);await f.runtime.start(f.account);const marker=f.marker(),before=fs.readFileSync(marker),server=net.createServer(s=>s.destroy());await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(gateEndpoint(f.descriptor.installationId),resolve);});try{await assert.rejects(f.runtime.stop(f.account),{code:'operation_in_progress'});assert.equal(f.state.stops.length,0);assert.deepEqual(fs.readFileSync(marker),before);}finally{await new Promise(r=>server.close(r));}
});
test('v2 lease over the old 32 KiB limit remains readable for ordinary owner-only writes',async t=>{
 const f=fixture(t);await f.runtime.start(f.account);const run=f.runtime.runs.get(f.account),v=JSON.parse(fs.readFileSync(run.lease.file)),raw=Buffer.from(JSON.stringify(v));const bytes=Buffer.concat([raw,Buffer.alloc(50000-raw.length,32)]);assert(bytes.length>32768&&bytes.length<=MAX_LEASE);fs.writeFileSync(run.lease.file,bytes);const p=f.runtime._shellProof(),fresh=p.readLease(run.lease.file,f.account);run.lease=fresh;assert.equal((await f.runtime.assertWritable(f.account)).accountId,f.account);assert.equal((await f.runtime.stop(f.account)).management,'stopped');
});
test('real NTFS repeated start and stop retain the original lease descriptor across tunneled creation times',{skip:process.platform!=='win32'},async t=>{
 const f=fixture(t),p=f.runtime._shellProof(),file=f.runtime._lockPath(f.account),rename=fs.renameSync,observations=[];
 fs.renameSync=function(from,to){if(to!==file)return rename.call(fs,from,to);const before=fs.lstatSync(from,{bigint:true}),fd=[...p.handles.keys()].find(n=>{const s=fs.fstatSync(n,{bigint:true});return s.dev===before.dev&&s.ino===before.ino;});assert.notEqual(fd,undefined,'exclusive temporary descriptor stays open');const r=rename.call(fs,from,to),after=fs.lstatSync(to,{bigint:true}),held=fs.fstatSync(fd,{bigint:true});assert.equal(after.dev,before.dev);assert.equal(after.ino,before.ino);assert.equal(after.birthtimeNs,held.birthtimeNs);observations.push({before:before.birthtimeNs,after:after.birthtimeNs});return r;};
 try{for(let i=0;i<2;i++){assert.equal((await f.runtime.start(f.account)).management,'owned');assert.equal((await f.runtime.stop(f.account)).management,'stopped');assert.equal(p.handles.size,0);assert(!fs.existsSync(file));if(i===0)await new Promise(r=>setTimeout(r,40));}}finally{fs.renameSync=rename;}
 assert(observations.some(x=>x.before!==x.after),'actual NTFS birth-time tunneling was observed');assert.equal(f.state.starts,2);assert.equal(f.state.stops.length,2);
});
test('lease rename applied then thrown preserves only a fully read-back publication',async t=>{
 const f=fixture(t);await f.runtime.start(f.account);const p=f.runtime._shellProof(),lease=f.runtime.runs.get(f.account).lease,old=structuredClone(lease.ownerFile),rename=fs.renameSync;let calls=0;
 fs.renameSync=function(from,to){const r=rename.call(fs,from,to);if(to===lease.file){calls++;throw Object.assign(Error('synthetic after applied rename'),{code:'EIO'});}return r;};
 try{assert.doesNotThrow(()=>p.writeLease(lease));}finally{fs.renameSync=rename;}
 assert.equal(calls,1);assert.notEqual(lease.ownerFile.identity.ino,old.identity.ino);p.assertLease(lease);assert.equal(p.handles.size,0);assert.equal((await f.runtime.stop(f.account)).management,'stopped');
});
test('same-byte foreign replacement after lease rename is rejected without closing or deleting that file',async t=>{
 const f=fixture(t);await f.runtime.start(f.account);const p=f.runtime._shellProof(),lease=f.runtime.runs.get(f.account).lease,old=structuredClone(lease.ownerFile),rename=fs.renameSync,foreign=path.join(f.base,'foreign-lease.json');let replaced=false,blocked,ownedIno;
 fs.renameSync=function(from,to){if(to!==lease.file)return rename.call(fs,from,to);const bytes=fs.readFileSync(from);ownedIno=fs.lstatSync(from,{bigint:true}).ino;const r=rename.call(fs,from,to);fs.writeFileSync(foreign,bytes);try{rename.call(fs,foreign,to);replaced=true;}catch(e){blocked=e.code;throw e;}return r;};
 let error;try{p.writeLease(lease);}catch(e){error=e;}finally{fs.renameSync=rename;}
 if(replaced){assert.equal(error?.code,'runtime_locked');assert.deepEqual(lease.ownerFile,old);assert.notEqual(fs.lstatSync(lease.file,{bigint:true}).ino,ownedIno);await assert.rejects(f.runtime.stop(f.account));assert.equal(f.state.stops.length,0);}else{assert(['EPERM','EACCES','EBUSY'].includes(blocked));assert.equal(error,undefined);p.assertLease(lease);await f.runtime.stop(f.account);}
 assert.equal(p.handles.size,0);assert(fs.existsSync(lease.file)||!replaced);
});
test('known published lease retains its exact renamed descriptor when close fails and retries only close',async t=>{
 const f=fixture(t);await f.runtime.start(f.account);const p=f.runtime._shellProof(),lease=f.runtime.runs.get(f.account).lease,rename=fs.renameSync,close=fs.closeSync;let retained,failOnce=true,renames=0;
 fs.renameSync=function(from,to){if(to===lease.file){const inode=fs.lstatSync(from,{bigint:true}).ino;retained=[...p.handles.keys()].find(fd=>fs.fstatSync(fd,{bigint:true}).ino===inode);assert.notEqual(retained,undefined);renames++;}return rename.call(fs,from,to);};
 fs.closeSync=function(fd){if(fd===retained&&failOnce){failOnce=false;throw Object.assign(Error('synthetic close failure'),{code:'EIO'});}return close.call(fs,fd);};
 try{assert.throws(()=>p.writeLease(lease),{code:'cleanup_unconfirmed'});p.assertLease(lease);assert.equal(p.handles.size,1);assert.equal(p.handles.get(retained).birthNs,String(fs.fstatSync(retained,{bigint:true}).birthtimeNs));assert.deepEqual(await p.close(),{closed:true});assert.equal(renames,1);}finally{fs.renameSync=rename;fs.closeSync=close;}
 assert.equal(p.handles.size,0);await f.runtime.stop(f.account);
});
