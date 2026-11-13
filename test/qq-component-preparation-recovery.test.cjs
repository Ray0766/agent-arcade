'use strict';
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {QQPreparationRecovery}=require('../src/bot/qq-component-preparation-recovery.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t,{component='napcat-shell'}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-preparation-recovery-')),lockRoot=path.join(root,'locks'),version='4.18.42',source={tag:'v4.18.42',assetId:123,size:10,sha256:sha('synthetic archive')},versionId=`${component}-${version}-${source.sha256.slice(0,16)}`,versionDir=path.join(root,'qq-component-versions',component,versionId);
 let state='own',inspectCalls=0,hook=()=>{},mono=0;const own={pid:process.pid,createdAt:'2026-01-01T00:00:00.000Z',executable:process.execPath};
 const host={async inspect(pids){assert.deepEqual(pids,[process.pid]);inspectCalls++;await hook(inspectCalls);if(state==='throws')throw Error('private probe detail');if(state==='bad')return [{pid:process.pid,createdAt:own.createdAt,executable:''}];if(state==='reused')return [{...own,createdAt:'2026-01-02T00:00:00.000Z'}];return state==='dead'?[]:[own];}};
 const recovery=new QQPreparationRecovery({root,lockRoot,component,packages:{verify:async()=>{throw Error('Recovery must not download/resolve an archive');}},processHost:host,monotonic:()=>mono});
 t.after(()=>{assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
 async function interrupt({publishing=false,contents='Synthetic partial bytes'}={}){
  await assert.rejects(recovery.runWriter({version,source,versionId},async writer=>{fs.mkdirSync(versionDir,{recursive:true});writer.allocated(versionDir,{files:[{path:'partial.txt',size:Buffer.byteLength(contents)}],directories:[]});fs.mkdirSync(path.join(versionDir,'code'));fs.writeFileSync(path.join(versionDir,'code','partial.txt'),contents);if(publishing)writer.publishing();throw Error('synthetic crash boundary');}),/synthetic crash boundary/);
  state='dead';const names=fs.readdirSync(recovery.records);return {id:names[0].slice(0,-5),record:path.join(recovery.records,names[0])};
 }
 return {root,lockRoot,recovery,versionDir,versionId,component,source,version,own,host,interrupt,set state(v){state=v;},set hook(v){hook=v;},set mono(v){mono=v;},get inspections(){return inspectCalls;}};
}
const preview=(f,row,options={})=>f.recovery.preview({preparationId:row.id,...options});
const recover=(f,p,options={})=>f.recovery.recover({ticketId:p.ticketId,expectedDigest:p.expectedDigest,...options});

test('new Shell and Node writers quarantine the exact partial tree without deleting bytes or changing selection',async t=>{
 for(const component of ['napcat-shell','napcat-node']){
  const f=fixture(t,{component}),row=await f.interrupt(),file=path.join(f.versionDir,'code','partial.txt'),bytes=fs.readFileSync(file),stat=fs.statSync(file,{bigint:true}),record=fs.readFileSync(row.record),p=await preview(f,row),result=await recover(f,p);
  assert.equal(result.recovered,true);assert.equal(result.committed,true);assert.equal(result.automaticRetry,false);assert.equal(result.automaticStart,false);assert.equal(result.selectionChanged,false);assert.equal(fs.existsSync(f.versionDir),false);
  const kept=path.join(f.recovery.quarantine,result.quarantineId,'code','partial.txt'),after=fs.statSync(kept,{bigint:true});assert.deepEqual(fs.readFileSync(kept),bytes);assert.equal(after.ino,stat.ino);assert.equal(after.dev,stat.dev);assert.deepEqual(fs.readFileSync(row.record),record);assert.equal(f.recovery.list().entries.length,0);await assert.rejects(recover(f,p),{code:'preview_required'});
 }
});
test('unknown legacy directory, completed manifest (even empty), and publication-started records are never eligible',async t=>{
 let f=fixture(t);fs.mkdirSync(f.versionDir,{recursive:true});fs.writeFileSync(path.join(f.versionDir,'legacy'),'keep');assert.deepEqual(f.recovery.list().entries,[]);await assert.rejects(preview(f,{id:randomUUID()}),{code:'preparation_record_missing'});assert.equal(fs.readFileSync(path.join(f.versionDir,'legacy'),'utf8'),'keep');
 for(const bytes of ['', '{bad', '{}']){f=fixture(t);const row=await f.interrupt();fs.writeFileSync(path.join(f.versionDir,'prepared.json'),bytes);await assert.rejects(preview(f,row),{code:'preparation_complete'});assert.equal(fs.existsSync(f.versionDir),true);}
 f=fixture(t);const row=await f.interrupt({publishing:true});await assert.rejects(preview(f,row),{code:'preparation_publishing'});assert.equal(f.recovery.list().issues[0],'preparation_publishing');
});
for(const [state,code]of [['own','owner_alive'],['reused','owner_identity_changed'],['throws','process_check_failed'],['bad','process_check_failed']])test(`writer ${state} cannot be treated as exited`,async t=>{const f=fixture(t),row=await f.interrupt();f.state=state;await assert.rejects(preview(f,row),{code});assert.equal(fs.existsSync(f.versionDir),true);});
test('owner reappearing on the second independent observation blocks recovery',async t=>{
 const f=fixture(t),row=await f.interrupt(),start=f.inspections;f.hook=n=>{if(n===start+2)f.state='reused';};await assert.rejects(preview(f,row),{code:'owner_identity_changed'});assert.equal(fs.existsSync(f.versionDir),true);
});
test('selected/current/previous and managed descriptor references refuse quarantine',async t=>{
 for(const kind of ['current','previous','managed-shell','managed-node']){
  const f=fixture(t),row=await f.interrupt();let file,value;
  const prepared={kind:'prepared',version:'4.18.42',versionId:f.versionId,manifestSha256:'a'.repeat(64)},original={kind:'original',version:'4.18.42'};
  if(kind==='current'||kind==='previous'){file=path.join(f.lockRoot,'component-selections',`${'b'.repeat(64)}.json`);value={schema:'qq_component_selection_v1',current:kind==='current'?prepared:original,previous:kind==='previous'?prepared:null};}
  else{file=path.join(f.root,kind==='managed-node'?'qq-node-installations':'qq-installations',randomUUID(),'installation.json');value={schema:kind==='managed-node'?'qq_managed_node_v1':'qq_managed_shell_v1',current:prepared,previous:null};}
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));await assert.rejects(preview(f,row),{code:'preparation_selected'});assert.equal(fs.existsSync(f.versionDir),true);
 }
});
test('unknown reference metadata or an active installation/configuration marker fails closed',async t=>{
 for(const kind of ['invalid-json','configuration.edit',`installation-${'a'.repeat(64)}.lock`, `installation-${'a'.repeat(64)}.lock.recover`]){
  const f=fixture(t),row=await f.interrupt();const file=kind==='invalid-json'?path.join(f.lockRoot,'component-selections',`${'c'.repeat(64)}.json`):path.join(f.lockRoot,kind);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'unknown');await assert.rejects(preview(f,row),{code:kind==='invalid-json'?'preparation_proof_unavailable':'component_locked'});
 }
});
test('junctions, hardlinks and extra-depth trees are retained but never quarantined',async t=>{
 for(const kind of ['junction','hardlink','depth']){const f=fixture(t),row=await f.interrupt();if(kind==='junction'){const elsewhere=path.join(f.root,'elsewhere');fs.mkdirSync(elsewhere);fs.symlinkSync(elsewhere,path.join(f.versionDir,'junction'),'junction');}else if(kind==='hardlink')fs.linkSync(path.join(f.versionDir,'code','partial.txt'),path.join(f.versionDir,'linked'));else{let dir=f.versionDir;for(let i=0;i<19;i++){dir=path.join(dir,`depth${i}`);fs.mkdirSync(dir);}}await assert.rejects(preview(f,row),{code:kind==='depth'?'preparation_limit':'preparation_unsafe'});assert.equal(fs.existsSync(f.versionDir),true);}
});
test('changed tree, root inode, writer bytes and late reference all invalidate one-use preview',async t=>{
 for(const kind of ['bytes','extra','missing','root','record','reference']){
  const f=fixture(t),row=await f.interrupt(),p=await preview(f,row);if(kind==='bytes')fs.writeFileSync(path.join(f.versionDir,'code','partial.txt'),'changed');if(kind==='extra')fs.mkdirSync(path.join(f.versionDir,'extra'));if(kind==='missing')fs.unlinkSync(path.join(f.versionDir,'code','partial.txt'));if(kind==='root'){fs.renameSync(f.versionDir,f.versionDir+'.kept');fs.mkdirSync(f.versionDir);}
  if(kind==='record'){const value=JSON.parse(fs.readFileSync(row.record));value.createdAt='changed';fs.writeFileSync(row.record,JSON.stringify(value));}
  if(kind==='reference'){fs.mkdirSync(f.lockRoot);fs.writeFileSync(path.join(f.lockRoot,'configuration.edit'),'new');}
  await assert.rejects(recover(f,p),{code:kind==='reference'?'component_locked':kind==='extra'?'preparation_unsafe':'preparation_changed'});await assert.rejects(recover(f,p),{code:'preview_required'});
 }
});
test('preview expires monotonically; cancelled or changed scope cannot rename and async guards are rejected',async t=>{
 const f=fixture(t),row=await f.interrupt();let p=await preview(f,row);f.mono=300000;await assert.rejects(recover(f,p),{code:'preview_expired'});p=await preview(f,row);const controller=new AbortController();controller.abort();await assert.rejects(recover(f,p,{signal:controller.signal}),{code:'cancelled'});
 p=await preview(f,row);await assert.rejects(recover(f,p,{assertCurrent:()=>{throw Object.assign(Error('scope changed'),{code:'changed'});}}),{code:'changed'});
 await assert.rejects(preview(f,row,{assertCurrent:async()=>true}),{code:'invalid_request'});assert.equal(fs.existsSync(f.versionDir),true);
});
test('same-version OS gate excludes another writer and preview, without touching its tree',async t=>{
 const f=fixture(t);let release,entered;const ready=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 const op=f.recovery.runWriter({version:f.version,source:f.source,versionId:f.versionId},async writer=>{fs.mkdirSync(f.versionDir,{recursive:true});writer.allocated(f.versionDir,{files:[{path:'partial.txt',size:100}],directories:[]});fs.mkdirSync(path.join(f.versionDir,'code'));entered();await hold;throw Error('synthetic held writer');});const observed=op.catch(e=>e);await ready;
 const id=fs.readdirSync(f.recovery.records)[0].slice(0,-5);try{await assert.rejects(f.recovery.runWriter({version:f.version,source:f.source,versionId:f.versionId},async()=>{}),{code:'shell_repair_busy'});await assert.rejects(preview(f,{id}),{code:'shell_repair_busy'});}finally{release();}assert.match((await observed).message,/held writer/);
});
test('late tree mutation during quarantine setup is caught before rename',async t=>{
 const f=fixture(t),row=await f.interrupt(),p=await preview(f,row),original=fs.mkdirSync;let changed=false;
 fs.mkdirSync=function(file,...args){const result=original.call(this,file,...args);if(file===f.recovery.quarantine&&!changed){changed=true;fs.writeFileSync(path.join(f.versionDir,'code','partial.txt'),'late change');}return result;};
 try{await assert.rejects(recover(f,p),{code:'preparation_changed'});}finally{fs.mkdirSync=original;}assert.equal(fs.existsSync(f.versionDir),true);
});
test('rename-then-error and post-commit read failure keep committed facts without deleting residuals',async t=>{
 for(const mode of ['rename-throw','read-fail']){const f=fixture(t),row=await f.interrupt(),p=await preview(f,row),rename=fs.renameSync,stat=fs.lstatSync,target=path.join(f.recovery.quarantine,row.id);let moved=false;
  fs.renameSync=function(from,to,...args){const result=rename.call(this,from,to,...args);if(from===f.versionDir){moved=true;if(mode==='rename-throw')throw Object.assign(Error('synthetic uncertain result'),{code:'EIO'});}return result;};
  fs.lstatSync=function(file,...args){if(mode==='read-fail'&&moved&&file===target)throw Object.assign(Error('synthetic read failure'),{code:'EACCES'});return stat.call(this,file,...args);};
  let result;try{result=await recover(f,p);}finally{fs.renameSync=rename;fs.lstatSync=stat;}assert.equal(result.committed,true);assert.equal(result.recovered,false);assert.equal(result.recoveryIssue,'preparation_readback_failed');assert.equal(fs.existsSync(target),true);assert.equal(fs.existsSync(row.record),true);assert.equal(fs.existsSync(f.versionDir),false);
 }
});
test('unconfirmed rename outcome is marked attempted/unknown and does not delete either path',async t=>{
 const f=fixture(t),row=await f.interrupt(),p=await preview(f,row),rename=fs.renameSync;fs.renameSync=function(from,...rest){if(from===f.versionDir)throw Object.assign(Error('synthetic unknown'),{code:'EIO'});return rename.call(this,from,...rest);};
 try{await assert.rejects(recover(f,p),error=>error.code==='preparation_commit_unconfirmed'&&error.committed===null&&error.changeAttempted===true);}finally{fs.renameSync=rename;}assert.equal(fs.existsSync(f.versionDir),true);assert.equal(fs.existsSync(row.record),true);
});
test('discarded preview cannot act and a completed quarantine does not need a second cleanup mutation',async t=>{
 const f=fixture(t),row=await f.interrupt(),p=await preview(f,row);f.recovery.discardPreview();await assert.rejects(recover(f,p),{code:'preview_required'});const next=await preview(f,row),r=await recover(f,next);assert.equal(r.recovered,true);await assert.rejects(preview(f,row),{code:'preparation_already_quarantined'});assert.equal(fs.existsSync(row.record),true);
});

test('publishing phase cannot adopt a replaced record after fsync or enter manifest publication',async t=>{
 const f=fixture(t),sync=fs.fsyncSync;let allocated=false,enteredPublication=false,changed=false;
 fs.fsyncSync=function(fd){const result=sync.call(this,fd);if(allocated&&!changed){const listing=fs.readdirSync(f.recovery.records);if(listing.length){const file=path.join(f.recovery.records,listing[0]),value=JSON.parse(fs.readFileSync(file));if(value.phase==='publishing'){changed=true;fs.renameSync(file,file+'.preserved');fs.writeFileSync(file,JSON.stringify({...value,phase:'extracting'}));}}}return result;};
 try{await assert.rejects(f.recovery.runWriter({version:f.version,source:f.source,versionId:f.versionId},async writer=>{fs.mkdirSync(f.versionDir,{recursive:true});writer.allocated(f.versionDir,{files:[{path:'partial.txt',size:100}],directories:[]});allocated=true;fs.mkdirSync(path.join(f.versionDir,'code'));writer.publishing();enteredPublication=true;fs.writeFileSync(path.join(f.versionDir,'prepared.json'),'must not happen');}),{code:'preparation_changed'});}finally{fs.fsyncSync=sync;}
 assert.equal(changed,true);assert.equal(enteredPublication,false);assert.equal(fs.existsSync(path.join(f.versionDir,'prepared.json')),false);assert.equal(fs.readdirSync(f.recovery.records).length,2);
});

test('unrelated extra paths and files exceeding the scanned ZIP size never gain recovery ownership',async t=>{
 for(const mode of ['file','directory','oversize']){const f=fixture(t),row=await f.interrupt();if(mode==='file')fs.writeFileSync(path.join(f.versionDir,'code','unrelated.txt'),'keep foreign bytes');if(mode==='directory')fs.mkdirSync(path.join(f.versionDir,'unrelated'));if(mode==='oversize')fs.appendFileSync(path.join(f.versionDir,'code','partial.txt'),'extra');await assert.rejects(preview(f,row),{code:'preparation_unsafe'});assert.equal(fs.existsSync(f.versionDir),true);assert.equal(fs.existsSync(f.recovery.quarantine),false);}
});
