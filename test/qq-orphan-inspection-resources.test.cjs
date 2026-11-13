'use strict';
// Actual temporary files, Node endpoints and an inert Node child. QQ process
// inventories below are synthetic; this suite never runs QQ or native CIM.
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {fixture,hash}=require('./helpers/qq-shell-owner-fixture.cjs');
const {QQShellOwnerProof}=require('../src/bot/qq-shell-owner-proof.cjs');
const code=value=>error=>error.code===value;
const receiptKeys=['kind','accountId','resources','processControlAttempted','leaseMutationAttempted','pendingUpdateRecordsModified','automaticStart'].sort();
const previewKeys=['kind','action','accountId','expectedDigest','expiresAt','automaticStart'].sort();
function facts(value,account,resources){assert.deepEqual(Object.keys(value).sort(),receiptKeys);assert.equal(value.kind,'pending-shell-inspection-resources');assert.equal(value.accountId,account);assert.equal(value.resources,resources);for(const key of ['processControlAttempted','leaseMutationAttempted','pendingUpdateRecordsModified','automaticStart'])assert.equal(value[key],false);}
function latch(){let release,enter;const held=new Promise(r=>{release=r;}),entered=new Promise(r=>{enter=r;});return {held,entered,release,enter};}
function fileProof(file){const st=fs.lstatSync(file,{bigint:true});return {ino:String(st.ino),dev:String(st.dev),birth:String(st.birthtimeNs),bytes:hash(fs.readFileSync(file)),links:String(st.nlink)};}
async function retained(t,{beforeCapture=false}={}){
 const after=[],f=fixture({after:fn=>after.push(fn)});let r;
 t.after(async()=>{if(r){for(const owner of r._pendingOrphans().owners.values())await owner.proof.close();r._pendingOrphans().owners.clear();}for(const fn of after)await fn();});
 await f.runtime.start(f.account);const lease=f.deadManager();f.state.rows=f.state.rows.filter(row=>row.pid!==lease.runtime.pid);const marker=f.marker(),journal=f.journal();r=f.fresh();assert.equal(r._componentSelection,null);
 const originalUnlink=fs.unlinkSync,originalGuard=QQShellOwnerProof.prototype._newGuard;
 fs.unlinkSync=function(file){if(String(file).endsWith('.lock.recover'))throw Object.assign(Error('injected guard unlink failure'),{code:'EIO'});return originalUnlink.apply(this,arguments);};
 if(beforeCapture)QQShellOwnerProof.prototype._newGuard=function(file,value){const guard=originalGuard.call(this,file,value);if(String(file).endsWith('.lock.recover'))throw Object.assign(Error('injected before capture'),{code:'EIO'});return guard;};
 try{await assert.rejects(r.previewOrphanCleanup(f.account),code('cleanup_unconfirmed'));}finally{fs.unlinkSync=originalUnlink;QQShellOwnerProof.prototype._newGuard=originalGuard;}
 const cleanup=r._pendingOrphans(),owner=cleanup.owners.get(f.account);assert(owner);assert.equal(owner.selected,undefined);assert.equal(r.hasOrphanInspectionResources(f.account),true);if(beforeCapture)assert.equal(owner.lease,undefined);
 return {...f,r,cleanup,owner,lease,marker,journal};
}
const confirm=(f,p,options={})=>f.r.cleanupOrphans(f.account,{expectedDigest:p.expectedDigest,...options});

test('pre-capture owned resources close in the same manager without reading lease, stopping or disconnecting',async t=>{
 const f=await retained(t,{beforeCapture:true}),files=[f.r._lockPath(f.account),f.marker,f.journal],before=files.map(fileProof),guard=[...f.owner.proof.guards][0],fd=guard.fd;
 const row=(await f.r.discover()).instances.find(v=>v.accountId===f.account);assert.equal(row.canSettleOrphanInspection,true);assert.equal(row.processRunning,null);assert.equal(row.canInspectOrphanCleanup,undefined);for(const key of ['canStart','canStop','canRecover'])assert.equal(row[key],false);
 const saved={instance:f.r.instance,close:f.r.close,snapshot:f.host.snapshot,inspect:f.host.inspect,stop:f.host.stop};let attempted=0;
 const forbidden=()=>{attempted++;throw Error('resource settlement touched process/manager authority');};f.r.instance=forbidden;f.r.close=forbidden;f.host.snapshot=forbidden;f.host.inspect=forbidden;f.host.stop=forbidden;
 try{
  const p=await f.r.previewOrphanCleanup(f.account);assert.deepEqual(Object.keys(p).sort(),previewKeys);assert.equal(p.action,'settle-resources');assert.equal(p.kind,'pending-shell-inspection-resources');assert(Number.isFinite(Date.parse(p.expiresAt)));
  const result=await confirm(f,p,{beforeStop:forbidden});assert.deepEqual(Object.keys(result).sort(),['accountId','automaticStart','cleanup','recovery']);assert.equal(result.recovery,'inspection-resources-settled');facts(result.cleanup,f.account,'closed');assert.equal(attempted,0);
 }finally{f.r.instance=saved.instance;f.r.close=saved.close;Object.assign(f.host,{snapshot:saved.snapshot,inspect:saved.inspect,stop:saved.stop});}
 assert.equal(fs.existsSync(guard.file),false);assert.throws(()=>fs.fstatSync(fd),code('EBADF'));assert.deepEqual(files.map(fileProof),before);assert.equal(f.state.stops.length,0);assert.equal(f.cleanup.owners.has(f.account),false);assert.equal(f.r.hasOrphanInspectionResources(f.account),false);
});

test('resource discovery remains reachable with unreadable installation metadata and no process authority',async t=>{
 const f=await retained(t,{beforeCapture:true});const original=f.r._installation;f.r._installation=()=>({accounts:[],available:false,installationKind:'managed-shell',componentIssue:'invalid_installation'});
 try{const d=await f.r.discover(),row=d.instances.find(v=>v.accountId===f.account);assert.equal(d.configured,false);assert.equal(row.canSettleOrphanInspection,true);assert.equal(row.processRunning,null);assert.equal(row.canStart,false);const p=await f.r.previewOrphanCleanup(f.account);facts((await confirm(f,p)).cleanup,f.account,'closed');}finally{f.r._installation=original;}
});

test('resource preview expiry, exact discard and owner replacement cannot close a new owner',async t=>{
 const f=await retained(t);let time=0;f.cleanup.now=()=>time;const expired=await f.r.previewOrphanCleanup(f.account);time=60000;await assert.rejects(confirm(f,expired),code('orphan_cleanup_changed'));
 const a=await f.r.previewOrphanCleanup(f.account),b=await f.r.previewOrphanCleanup(f.account);assert.deepEqual(f.r.discardOrphanPreview(f.account,{expectedDigest:a.expectedDigest}),{discarded:false});await assert.rejects(confirm(f,a),code('orphan_cleanup_changed'));
 assert.deepEqual(f.r.discardOrphanPreview(f.account,{expectedDigest:b.expectedDigest}),{discarded:true});await assert.rejects(confirm(f,b),code('orphan_cleanup_changed'));
 const p=await f.r.previewOrphanCleanup(f.account),replacement={...f.owner,id:'new-owner',generation:f.owner.generation+1};f.cleanup.owners.set(f.account,replacement);await assert.rejects(confirm(f,p),code('orphan_cleanup_changed'));assert(f.owner.proof.guards.size>0);f.cleanup.owners.set(f.account,f.owner);
 facts((await confirm(f,await f.r.previewOrphanCleanup(f.account))).cleanup,f.account,'closed');
});

test('a resource added after preview invalidates it without including that new FD in the old action',async t=>{
 const f=await retained(t),p=await f.r.previewOrphanCleanup(f.account),extra=path.join(f.base,'extra-resource');fs.writeFileSync(extra,'OWNED_EXTRA');const fd=f.owner.proof._open(extra,'r');await assert.rejects(confirm(f,p),code('orphan_cleanup_changed'));assert.doesNotThrow(()=>fs.fstatSync(fd));assert(f.owner.proof.guards.size>0);
 facts((await confirm(f,await f.r.previewOrphanCleanup(f.account))).cleanup,f.account,'closed');assert.throws(()=>fs.fstatSync(fd),code('EBADF'));assert.equal(fs.readFileSync(extra,'utf8'),'OWNED_EXTRA');
});

test('queued resource confirmation is retired before effect; late scope loss preserves known closure',async t=>{
 const f=await retained(t),p=await f.r.previewOrphanCleanup(f.account),operation=f.r._begin(f.account,false,'reconcile'),running=confirm(f,p);f.r.discardOrphanPreview(f.account,{expectedDigest:p.expectedDigest});f.r._end(f.account,false,operation);await assert.rejects(running,code('orphan_cleanup_changed'));assert(f.owner.proof.guards.size>0);
 const next=await f.r.previewOrphanCleanup(f.account),l=latch(),close=f.owner.proof.closeCaptured;let current=true;f.owner.proof.closeCaptured=async function(saved){const result=await close.call(this,saved);l.enter();await l.held;return result;};
 const completed=confirm(f,next,{assertCurrent(){if(!current)throw Object.assign(Error('scope retired'),{code:'changed'});}});await l.entered;current=false;f.r.discardOrphanPreview(f.account,{expectedDigest:next.expectedDigest});l.release();facts((await completed).cleanup,f.account,'closed');assert.equal(f.state.stops.length,0);
});

test('known guard unlink followed by a close fault retries only its still-owned descriptor',async t=>{
 const f=await retained(t),g=[...f.owner.proof.guards][0],fd=g.fd,p=await f.r.previewOrphanCleanup(f.account),close=fs.closeSync,unlink=fs.unlinkSync;let blocked=true,unlinks=0;
 fs.closeSync=function(n){if(n===fd&&blocked)throw Object.assign(Error('injected descriptor close'),{code:'EIO'});return close.apply(this,arguments);};fs.unlinkSync=function(file){if(file===g.file)unlinks++;return unlink.apply(this,arguments);};
 try{await assert.rejects(confirm(f,p),error=>{assert.equal(error.cleanupAttempted,true);facts(error.cleanup,f.account,'unconfirmed');return error.code==='cleanup_unconfirmed';});assert.equal(fs.existsSync(g.file),false);assert.equal(unlinks,1);assert.equal(f.owner.proof.guards.has(g),true);blocked=false;facts((await confirm(f,await f.r.previewOrphanCleanup(f.account))).cleanup,f.account,'closed');assert.equal(unlinks,1);}finally{fs.closeSync=close;fs.unlinkSync=unlink;}
});

test('a replaced guard and unknown initial FD stay unconfirmed; foreign file and FD are not closed',async t=>{
 for(const mode of ['replaced-guard','unknown-fd','unknown-guard'])await t.test(mode,async t=>{
  const f=await retained(t),proof=f.owner.proof,g=[...proof.guards][0];let fd,foreign,displaced;
  if(mode==='replaced-guard'){displaced=`${g.file}.owned`;fs.renameSync(g.file,displaced);fs.writeFileSync(g.file,'FOREIGN_GUARD');foreign=fileProof(g.file);}
  if(mode==='unknown-fd'){const file=path.join(f.base,'unknown-fd');fs.writeFileSync(file,'UNKNOWN');fd=fs.openSync(file,'r');proof.resourceRevision++;proof.handles.set(fd,null);}
  if(mode==='unknown-guard'){g.created=null;fs.closeSync(g.fd);}
  try{const p=await f.r.previewOrphanCleanup(f.account);await assert.rejects(confirm(f,p),error=>{facts(error.cleanup,f.account,'unconfirmed');return error.code==='cleanup_unconfirmed';});assert.equal(f.cleanup.owners.get(f.account),f.owner);
   if(mode==='replaced-guard'){assert.deepEqual(fileProof(g.file),foreign);assert.doesNotThrow(()=>fs.fstatSync(g.fd));}
   if(mode==='unknown-fd')assert.doesNotThrow(()=>fs.fstatSync(fd));if(mode==='unknown-guard')assert.equal(proof.guards.has(g),true);
  }finally{
   // Test-only disposal is outside the product action; do not upgrade its proof.
   if(mode==='replaced-guard'){fs.unlinkSync(g.file);fs.renameSync(displaced,g.file);}
   if(mode==='unknown-fd'){fs.closeSync(fd);proof.handles.delete(fd);}
   if(mode==='unknown-guard'){proof.handles.delete(g.fd);fs.unlinkSync(g.file);proof.guards.delete(g);}
  }
 });
});

test('a real Node gate and unrelated inert child survive failure then settle without process control',async t=>{
 const f=await retained(t),server=net.createServer(socket=>socket.destroy());server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port,gate={server,working:false,closing:false,closed:false,lost:false};server.on('close',()=>{gate.closed=true;});f.owner.proof.resourceRevision++;f.owner.proof.gates.add(gate);
 const child=spawn(process.execPath,['-e','process.stdout.write("READY\\n");setInterval(()=>{},1000)'],{windowsHide:true,stdio:['ignore','pipe','ignore']});await once(child.stdout,'data');const childPid=child.pid;let childExited=false;child.once('exit',()=>{childExited=true;});
 const actualClose=server.close;let calls=0;server.close=function(callback){calls++;if(calls===1){queueMicrotask(()=>callback(Object.assign(Error('injected close callback'),{code:'EIO'})));return this;}return actualClose.call(this,callback);};
 try{
  const p=await f.r.previewOrphanCleanup(f.account);await assert.rejects(confirm(f,p),error=>{facts(error.cleanup,f.account,'unconfirmed');return error.code==='cleanup_unconfirmed';});assert.equal(server.listening,true);assert.equal(f.owner.proof.guards.size,0);assert.equal(f.owner.proof.gates.has(gate),true);assert.doesNotThrow(()=>process.kill(childPid,0));assert.equal(childExited,false);
  const again=await f.r.previewOrphanCleanup(f.account);facts((await confirm(f,again)).cleanup,f.account,'closed');assert.equal(gate.closed,true);assert.equal(calls,2);assert.equal(f.state.stops.length,0);assert.doesNotThrow(()=>process.kill(childPid,0));assert.equal(childExited,false);
  const fresh=net.createServer();fresh.listen(port,'127.0.0.1');await once(fresh,'listening');await new Promise(resolve=>fresh.close(resolve));
 }finally{server.close=actualClose;if(server.listening)await new Promise(resolve=>server.close(resolve));if(!childExited){const exit=once(child,'exit');child.kill();await exit;}}
});

test('real gate close event remains positive evidence when its callback reports a late error',async t=>{
 const f=await retained(t),server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const gate={server,working:false,closing:false,closed:false,lost:false};server.on('close',()=>{gate.closed=true;});f.owner.proof.resourceRevision++;f.owner.proof.gates.add(gate);const close=server.close;
 server.close=function(callback){return close.call(this,()=>callback(Object.assign(Error('injected post-close callback error'),{code:'EIO'})));};
 const result=await confirm(f,await f.r.previewOrphanCleanup(f.account));facts(result.cleanup,f.account,'closed');assert.equal(gate.closed,true);assert.equal(server.listening,false);
});

test('a gate reference replaced during an earlier close is not included in that confirmation',async t=>{
 const f=await retained(t),servers=[];for(let i=0;i<3;i++){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');servers.push(server);}
 const gates=servers.slice(0,2).map(server=>{const g={server,working:false,closing:false,closed:false,lost:false};server.on('close',()=>{g.closed=true;});f.owner.proof.resourceRevision++;f.owner.proof.gates.add(g);return g;});
 const firstClose=servers[0].close,l=latch();servers[0].close=function(callback){l.enter();l.held.then(()=>firstClose.call(this,callback));return this;};
 try{const p=await f.r.previewOrphanCleanup(f.account),running=confirm(f,p);await l.entered;gates[1].server=servers[2];l.release();await assert.rejects(running,error=>{facts(error.cleanup,f.account,'unconfirmed');return error.code==='cleanup_unconfirmed';});assert.equal(servers[1].listening,true);assert.equal(servers[2].listening,true);gates[1].server=servers[1];facts((await confirm(f,await f.r.previewOrphanCleanup(f.account))).cleanup,f.account,'closed');assert.equal(servers[2].listening,true);
 }finally{gates[1].server=servers[1];servers[0].close=firstClose;for(const server of servers)if(server.listening)await new Promise(resolve=>server.close(resolve));}
});
