'use strict';
// Synthetic trusted-resolver results + real temporary filesystem publication.
// No QQ/Node binary is run, no account data is imported, no network is used.
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {QQManagedNodeSetup,readManagedNodeInstallation,RELEASE_ID,NODE_FILES}=require('../src/bot/qq-managed-node-setup.cjs');
const {QQManagedNodeLayout}=require('../src/bot/qq-managed-node-layout.cjs');
const {withNodeCodeGate}=require('../src/bot/qq-node-code-gate.cjs');
const sha=value=>createHash('sha256').update(value).digest('hex');
const SOURCE={tag:'v4.18.42',assetId:691263447,sha256:'77397ac38d66f46383e48f08f35d5f9d37ec575c22069f62d6c600e73b4521ed',size:124162399};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-node-setup-')),root=path.join(temp,'components'),existing=path.join(temp,'existing-data');fs.mkdirSync(root);fs.mkdirSync(existing);fs.writeFileSync(path.join(existing,'preserve'),'SYNTHETIC_PRIVATE_DATA');
  const versionRoot=path.join(root,'qq-component-versions','napcat-node',RELEASE_ID),codeRoot=path.join(versionRoot,'code'),manifestPath=path.join(versionRoot,'prepared.json');fs.mkdirSync(codeRoot,{recursive:true});
  const files=Object.entries(NODE_FILES).map(([p,value])=>({path:p,...value})).sort((a,b)=>a.path<b.path?-1:1);
  const manifest={schema:'qq_node_component_prepared_v1',component:'napcat-node',versionId:RELEASE_ID,version:'4.18.42',source:SOURCE,files};fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  const state={calls:0,snapshots:0,onPrepared:null,onSnapshot:null,rows:[],override:null},io=Object.create(fs);
  const prepared={component:'napcat-node',resolvePrepared:async id=>{assert.equal(id,RELEASE_ID);state.calls++;await state.onPrepared?.();return {...{versionId:id,version:'4.18.42',codeRoot,manifestPath,manifestSha256:sha(fs.readFileSync(manifestPath)),source:SOURCE,files},...state.override};}};
  const processHost={snapshot:async()=>{state.snapshots++;await state.onSnapshot?.();return structuredClone(state.rows);}};
  const options={root,prepared,processHost,io,now:()=>Date.parse('2026-11-06T00:00:00Z')},setup=new QQManagedNodeSetup(options);
  t.after(()=>{const real=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());assert(real.toLowerCase().startsWith(parent.toLowerCase()+path.sep));fs.rmSync(real,{recursive:true,force:true});});
  return {temp,root,existing,versionRoot,codeRoot,manifestPath,manifest,files,state,io,prepared,processHost,options,setup,base:path.join(root,'qq-node-installations')};
}
function installations(f){return fs.existsSync(f.base)?fs.readdirSync(f.base):[];}
function noDescriptor(f){for(const id of installations(f))assert(!fs.existsSync(path.join(f.base,id,'installation.json')));}
async function initialized(t){const f=fixture(t),result=await f.setup.initialize(),read=readManagedNodeInstallation({root:f.root,setupId:result.setupId});return {...f,result,read,descriptor:read.descriptor};}
async function crashFixture(t){
  const f=fixture(t);f.io.unlinkSync=file=>{if(file.endsWith('.part'))throw Error('SYNTHETIC_CRASH');return fs.unlinkSync(file);};let setupId;
  await assert.rejects(f.setup.initialize(),e=>{setupId=e.setupId;return e.code==='setup_cleanup_incomplete'&&e.committed===true;});delete f.io.unlinkSync;
  const install=path.join(f.base,setupId),descriptor=path.join(install,'installation.json'),raw=fs.readFileSync(descriptor),value=JSON.parse(raw),part=path.join(install,value.publication.temporaryFile);
  assert.equal(fs.statSync(descriptor).nlink,2);return {...f,setupId,install,descriptor,raw,part};
}

test('shared Node repair ownership excludes setup publication and its descriptor cleanup',async t=>{
 const f=fixture(t);
 await withNodeCodeGate({root:f.root},async()=>{await assert.rejects(f.setup.initialize(),{code:'node_repair_busy'});});
 assert.equal(f.state.calls,0);assert.deepEqual(installations(f),[]);
 const c=await crashFixture(t),preview=await c.setup.inspectRecovery({setupId:c.setupId});
 await withNodeCodeGate({root:c.root},async()=>{await assert.rejects(c.setup.confirmRecovery(preview),{code:'node_repair_busy'});});
 assert.equal(fs.statSync(c.descriptor).nlink,2);assert.equal(fs.existsSync(c.part),true);
 assert.equal((await c.setup.confirmRecovery(preview)).recovered,true);
 const pending=path.join(f.root,'qq-node-code-recovery',RELEASE_ID,'pending.json');fs.mkdirSync(path.dirname(pending),{recursive:true});fs.writeFileSync(pending,'SYNTHETIC PENDING REPAIR');
 await assert.rejects(f.setup.initialize(),{code:'node_repair_recovery_required'});assert.equal(f.state.calls,0);assert.deepEqual(installations(f),[]);
});
test('Node initialization references fixed prepared metadata with empty account space and no original baseline',async t=>{
  const f=await initialized(t);assert.equal(f.result.committed,true);assert.equal(f.result.automaticStart,false);assert.equal(f.result.previous,null);assert.equal(f.read.engine,'managed-node');assert.equal(f.read.schema,'qq_managed_node_v1');assert.equal(f.read.verification,'metadata-only');assert.equal(f.read.prepared.versionId,RELEASE_ID);assert.deepEqual(fs.readdirSync(f.read.installationRoot).sort(),['installation.json','instances']);assert.deepEqual(fs.readdirSync(f.read.instancesRoot),[]);assert.equal(f.read.installationId,sha(f.read.installationRoot.toLowerCase()));assert.equal(f.read.node.version,'22.11.0');assert.equal(f.read.qq.version,'9.9.31-49738');assert.equal(f.read.entry.sha256,NODE_FILES['index.js'].sha256);assert.equal(f.state.calls,2);assert.equal(f.state.snapshots,2);assert.equal(fs.readFileSync(path.join(f.existing,'preserve'),'utf8'),'SYNTHETIC_PRIVATE_DATA');assert(!fs.existsSync(path.join(f.root,'qq-installations')));
});
test('fixed Node catalogue rejects Shell engine, arbitrary version IDs, UNC and async scope guards',async t=>{
  const f=fixture(t);assert.throws(()=>new QQManagedNodeSetup({...f.options,prepared:{...f.prepared,component:'napcat-shell'}}),{code:'invalid_request'});
  for(const versionId of ['latest','napcat-shell-4.18.42-02e5ff0f79916c1e','../outside',{},null])await assert.rejects(f.setup.initialize({versionId}),{code:'invalid_request'});
  await assert.rejects(f.setup.initialize({assertCurrent:async()=>{}}),{code:'invalid_request'});await assert.rejects(f.setup.initialize({assertCurrent:async()=>{throw Error('async scope cannot be used');}}),{code:'invalid_request'});await assert.rejects(f.setup.initialize({signal:{aborted:false}}),{code:'invalid_request'});
  assert.throws(()=>new QQManagedNodeSetup({...f.options,root:'//server/share'}),{code:'unsafe_path'});assert.equal(f.state.calls,0);assert.deepEqual(installations(f),[]);
});
test('prepared identity, source and every fixed native marker are checked before publication',async t=>{
  for(const kind of ['path','schema','source','file','files-mismatch','version'])await t.test(kind,async t=>{const f=fixture(t);
    if(kind==='path')f.state.override={codeRoot:f.existing};
    if(kind==='version')f.state.override={versionId:'napcat-shell-4.18.42-02e5ff0f79916c1e'};
    if(kind==='source')f.state.override={source:{...SOURCE,assetId:691263446}};
    if(kind==='schema'){f.manifest.schema='qq_component_prepared_v1';fs.writeFileSync(f.manifestPath,JSON.stringify(f.manifest));}
    if(kind==='file'){f.files[0].sha256='f'.repeat(64);fs.writeFileSync(f.manifestPath,JSON.stringify(f.manifest));}
    if(kind==='files-mismatch')f.state.override={files:f.files.slice(1)};
    await assert.rejects(f.setup.initialize(),{code:'prepared_invalid'});noDescriptor(f);
  });
});
test('prepare digest and scope are rechecked after durable write and cleanup preserves existing data',async t=>{
  for(const kind of ['manifest','cancel','scope'])await t.test(kind,async t=>{const f=fixture(t),abort=new AbortController();let stale=false;f.io.fsyncSync=fd=>{fs.fsyncSync(fd);if(kind==='cancel')abort.abort();if(kind==='scope')stale=true;};if(kind==='manifest')f.state.onPrepared=()=>{if(f.state.calls===2)fs.appendFileSync(f.manifestPath,' ');};
    await assert.rejects(f.setup.initialize({signal:abort.signal,assertCurrent:()=>{if(stale)throw Object.assign(Error('PRIVATE'),{code:'changed'});}}),{code:kind==='manifest'?'prepared_changed':kind==='cancel'?'cancelled':'changed'});assert.deepEqual(installations(f),[]);assert.equal(fs.readFileSync(path.join(f.existing,'preserve'),'utf8'),'SYNTHETIC_PRIVATE_DATA');
  });
});
test('only this prepared Node executable or unreadable Node identity blocks creation, including a late start',async t=>{
  for(const kind of ['early','late','unknown','lookup-failed','other-node'])await t.test(kind,async t=>{const f=fixture(t),row={pid:123,name:'node.exe',executable:kind==='unknown'?'':kind==='other-node'?path.join(f.existing,'node.exe'):path.join(f.codeRoot,'node.exe')};
    if(kind==='lookup-failed')f.state.onSnapshot=()=>{throw Error('PRIVATE_PROCESS_DETAILS');};else if(kind==='late')f.state.onSnapshot=()=>{if(f.state.snapshots===2)f.state.rows.push(row);};else f.state.rows.push(row);
    if(kind==='other-node')assert.equal((await f.setup.initialize()).committed,true);else{await assert.rejects(f.setup.initialize(),{code:kind==='lookup-failed'?'process_check_failed':'program_running'});noDescriptor(f);}
  });
});
test('unknown account files and replaced new directories are retained without a descriptor',async t=>{
  for(const kind of ['file','junction'])await t.test(kind,async t=>{const f=fixture(t);let target;f.io.fsyncSync=fd=>{fs.fsyncSync(fd);target=path.join(f.base,installations(f)[0],'instances');if(kind==='file')fs.writeFileSync(path.join(target,'unknown'),'KEEP');else{fs.rmdirSync(target);fs.symlinkSync(f.existing,target,'junction');}};await assert.rejects(f.setup.initialize(),e=>['setup_conflict','unsafe_path'].includes(e.code));noDescriptor(f);if(kind==='file')assert.equal(fs.readFileSync(path.join(target,'unknown'),'utf8'),'KEEP');else assert(fs.lstatSync(target).isSymbolicLink());assert.equal(fs.readFileSync(path.join(f.existing,'preserve'),'utf8'),'SYNTHETIC_PRIVATE_DATA');});
});
test('publication never overwrites an inserted descriptor and recognizes link-success-then-error',async t=>{
  for(const kind of ['foreign','committed'])await t.test(kind,async t=>{const f=fixture(t);let target;f.io.linkSync=(from,to)=>{target=to;if(kind==='foreign')fs.writeFileSync(to,'FOREIGN');fs.linkSync(from,to);if(kind==='committed')throw Error('after publication');};if(kind==='foreign'){await assert.rejects(f.setup.initialize(),{code:'setup_failed'});assert.equal(fs.readFileSync(target,'utf8'),'FOREIGN');}else assert.equal((await f.setup.initialize()).committed,true);});
});
test('after publication cleanup/readback failures preserve committed and abort cannot undo it',async t=>{
  for(const kind of ['cleanup','readback','abort'])await t.test(kind,async t=>{const f=fixture(t),abort=new AbortController();
    if(kind==='cleanup')f.io.unlinkSync=()=>{throw Error('PRIVATE');};
    if(kind==='readback')f.io.linkSync=(from,to)=>{fs.linkSync(from,to);f.io.openSync=(file,...args)=>{if(file.endsWith('installation.json'))throw Error('PRIVATE');return fs.openSync(file,...args);};};
    if(kind==='abort')f.io.linkSync=(from,to)=>{fs.linkSync(from,to);abort.abort();};
    if(kind==='abort')assert.equal((await f.setup.initialize({signal:abort.signal})).committed,true);else await assert.rejects(f.setup.initialize(),e=>e.committed===true&&!!e.setupId&&!e.message.includes('PRIVATE'));
    assert.equal(installations(f).length,1);assert(fs.existsSync(path.join(f.base,installations(f)[0],'installation.json')));
  });
});
test('same manager rejects concurrent creation while independent fresh setups remain independent',async t=>{
  const f=fixture(t),started=deferred(),wait=deferred();f.state.onPrepared=async()=>{started.resolve();await wait.promise;};const first=f.setup.initialize();await started.promise;await assert.rejects(f.setup.initialize(),{code:'setup_busy'});wait.resolve();const one=await first;f.state.onPrepared=null;const two=await f.setup.initialize();assert.notEqual(one.setupId,two.setupId);assert.equal(installations(f).length,2);
});
test('reader rejects injected paths, wrong schema, entry identity, manifest changes, links and oversized descriptors',async t=>{
  const f=await initialized(t),raw=fs.readFileSync(f.descriptor);
  for(const change of [v=>v.schema='qq_managed_shell_v1',v=>v.engine='managed-shell',v=>v.current.kind='original',v=>v.qq.version='9.9.22-40990',v=>v.node.sha256='f'.repeat(64),v=>v.codeRoot=f.existing,v=>v.previous={}]){const v=JSON.parse(raw);change(v);fs.writeFileSync(f.descriptor,JSON.stringify(v));assert.throws(()=>readManagedNodeInstallation({root:f.root,setupId:f.result.setupId}),{code:'setup_readback_failed'});}fs.writeFileSync(f.descriptor,raw);
  fs.appendFileSync(f.manifestPath,' ');assert.throws(()=>readManagedNodeInstallation({root:f.root,setupId:f.result.setupId}),{code:'prepared_changed'});fs.writeFileSync(f.manifestPath,JSON.stringify(f.manifest));
  fs.linkSync(f.descriptor,path.join(f.read.installationRoot,'extra'));assert.throws(()=>readManagedNodeInstallation({root:f.root,setupId:f.result.setupId}),{code:'unsafe_path'});fs.unlinkSync(path.join(f.read.installationRoot,'extra'));
  fs.writeFileSync(f.descriptor,Buffer.alloc(12289));assert.throws(()=>readManagedNodeInstallation({root:f.root,setupId:f.result.setupId}),{code:'unsafe_path'});
});
test('read and setup reject base junctions without following private old data',async t=>{
  const f=fixture(t);fs.symlinkSync(f.existing,f.base,'junction');await assert.rejects(f.setup.initialize(),{code:'unsafe_path'});assert.deepEqual(fs.readdirSync(f.existing),['preserve']);
});
test('layout derives separate hashed account paths without creating or reading config files',async t=>{
  const f=await initialized(t),layout=new QQManagedNodeLayout({read:()=>readManagedNodeInstallation({root:f.root,setupId:f.result.setupId})});const a=layout.instance('123456789'),b=layout.instance('987654321');assert.notEqual(a.instanceRoot,b.instanceRoot);assert.equal(a.accountDigest,sha('123456789'));assert.equal(a.configDir,path.join(a.instanceRoot,'work','config'));assert.equal(a.qqDataDir,path.join(a.instanceRoot,'qq-data'));assert.deepEqual(fs.readdirSync(f.read.instancesRoot),[]);assert(Object.isFrozen(layout.read().node));assert(Object.isFrozen(a));
  for(const id of ['../outside','00000',12345,'1','1234567890123'])assert.throws(()=>layout.instance(id),{code:'invalid_account'});
  fs.symlinkSync(f.existing,a.instanceRoot,'junction');assert.throws(()=>layout.instance('123456789'),{code:'unsafe_path'});assert.deepEqual(fs.readdirSync(f.existing),['preserve']);
});
test('layout detects descriptor rebind, refuses async reader and isolates Shell records',async t=>{
  const f=await initialized(t),layout=new QQManagedNodeLayout({read:()=>readManagedNodeInstallation({root:f.root,setupId:f.result.setupId})});fs.appendFileSync(f.descriptor,' ');assert.throws(()=>layout.read(),{code:'managed_installation_changed'});assert.throws(()=>new QQManagedNodeLayout({read:async()=>f.read}),{code:'invalid_installation'});assert.throws(()=>new QQManagedNodeLayout({read:()=>({...f.read,engine:'managed-shell'})}),{code:'invalid_installation'});
});
test('explicit recovery removes only the recorded NTFS temp hardlink and retains account data',async t=>{
  const f=await crashFixture(t),keep=path.join(f.install,'instances','synthetic-data');fs.writeFileSync(keep,'KEEP');assert.throws(()=>readManagedNodeInstallation({root:f.root,setupId:f.setupId}),{code:'unsafe_path'});const preview=await f.setup.inspectRecovery({setupId:f.setupId});assert.equal(preview.temporaryLinksToRemove,1);assert.doesNotMatch(JSON.stringify(preview),/\.part|components|node\.exe/);const result=await f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest});assert.equal(result.recovered,true);assert.equal(result.committed,true);assert.equal(result.automaticStart,false);assert.equal(fs.existsSync(f.part),false);assert(fs.readFileSync(f.descriptor).equals(f.raw));assert.equal(fs.statSync(f.descriptor).nlink,1);assert.equal(fs.readFileSync(keep,'utf8'),'KEEP');assert.equal(readManagedNodeInstallation({root:f.root,setupId:f.setupId}).engine,'managed-node');await assert.rejects(f.setup.inspectRecovery({setupId:f.setupId}),{code:'recovery_unavailable'});
});
test('recovery rejects unknown publication links, replaced bytes and stale directory proofs',async t=>{
  for(const kind of ['third-link','copied-part','extra-file','renamed-part','mutated','directory-change'])await t.test(kind,async t=>{const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId});
    if(kind==='third-link')fs.linkSync(f.descriptor,path.join(f.install,'third'));
    if(kind==='copied-part'){fs.unlinkSync(f.part);fs.writeFileSync(f.part,f.raw);}
    if(kind==='extra-file')fs.writeFileSync(path.join(f.install,'unknown.part'),'KEEP');
    if(kind==='renamed-part')fs.renameSync(f.part,path.join(f.install,'unknown.part'));
    if(kind==='mutated')fs.appendFileSync(f.descriptor,' ');
    if(kind==='directory-change'){const extra=path.join(f.install,'short-lived');fs.writeFileSync(extra,'x');fs.unlinkSync(extra);}
    await assert.rejects(f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest}),e=>['unsafe_path','recovery_unavailable','recovery_changed'].includes(e.code));assert(fs.existsSync(f.descriptor));
  });
});
test('recovery rejects cancellation, stale scope and concurrent initialization before unlink',async t=>{
  for(const kind of ['cancel','scope','busy'])await t.test(kind,async t=>{const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId}),abort=new AbortController();if(kind==='cancel')abort.abort();if(kind==='busy')f.setup.busy=true;await assert.rejects(f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest,signal:abort.signal,assertCurrent:()=>{if(kind==='scope')throw Object.assign(Error('PRIVATE'),{code:'changed'});}}),{code:kind==='cancel'?'cancelled':kind==='busy'?'setup_busy':'changed'});assert(fs.existsSync(f.part));assert.equal(fs.statSync(f.descriptor).nlink,2);});
});
test('recovery rechecks full proof after scope callback and rejects wrong digest types',async t=>{
  const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId});await assert.rejects(f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:[preview.expectedDigest]}),{code:'invalid_request'});let checks=0;await assert.rejects(f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest,assertCurrent:()=>{if(++checks===2)fs.appendFileSync(f.descriptor,' ');}}),{code:'recovery_changed'});assert(fs.existsSync(f.part));
});
test('recovery preserves committed outcomes after unlink errors, cancelled signal or unreadable cleanup checks',async t=>{
  for(const kind of ['throw-after-unlink','lstat-failed','read-failed','abort'])await t.test(kind,async t=>{const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId}),abort=new AbortController();f.io.unlinkSync=file=>{fs.unlinkSync(file);if(kind==='throw-after-unlink')throw Error('PRIVATE');if(kind==='abort')abort.abort();if(kind==='lstat-failed')f.io.lstatSync=()=>{throw Object.assign(Error('PRIVATE'),{code:'EACCES'});};if(kind==='read-failed')f.io.openSync=()=>{throw Object.assign(Error('PRIVATE'),{code:'EIO'});};};const result=await f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest,signal:abort.signal});assert.equal(result.committed,true);assert.equal(result.recovered,true);assert.equal(fs.existsSync(f.part),false);if(['lstat-failed','read-failed'].includes(kind))assert.equal(result.recoveryIssue,'recovery_unconfirmed');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);});
});
test('recovery distinguishes unchanged failed unlink from an unconfirmed effect and consumes no unrelated file',async t=>{
  for(const kind of ['unchanged','unknown'])await t.test(kind,async t=>{const f=await crashFixture(t),preview=await f.setup.inspectRecovery({setupId:f.setupId});f.io.unlinkSync=file=>{if(kind==='unknown')fs.renameSync(file,path.join(f.install,'unexpected'));throw Error('PRIVATE');};await assert.rejects(f.setup.confirmRecovery({setupId:f.setupId,expectedDigest:preview.expectedDigest}),e=>e.code===(kind==='unchanged'?'recovery_failed':'recovery_unconfirmed')&&(kind!=='unknown'||e.recoveryAttempted===true));assert(fs.existsSync(f.descriptor));assert.equal(f.setup.busy,false);});
});
