'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {QQComponentSelection,REQUIRED}=require('../src/bot/qq-component-selection.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const A='napcat-shell-4.18.42-1111111111111111',B='napcat-shell-4.18.42-2222222222222222';
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-component-selection-'));const componentsRoot=path.join(base,'components'),workDir=path.join(componentsRoot,'NapCatQQ'),qqExe=path.join(componentsRoot,'QQ','versions','9.9.36','QQ.exe'),lockRoot=path.join(base,'shared','qq-runtime-locks'),preparedRoot=path.join(base,'shared','qq-components','qq-component-versions','napcat-shell');
  for(const dir of [path.join(workDir,'config'),path.dirname(qqExe),preparedRoot])fs.mkdirSync(dir,{recursive:true});
  for(const file of REQUIRED)fs.writeFileSync(path.join(workDir,file),`original ${file}`);fs.writeFileSync(qqExe,'ORIGINAL_QQ_EXECUTABLE');fs.writeFileSync(path.join(workDir,'config','onebot11_12345001.json'),'PRIVATE_CONFIG_MUST_NOT_BE_COPIED');
  const self={pid:process.pid,parentPid:1,createdAt:'2026-11-06T00:00:00.0000000Z',name:'synthetic app',executable:process.execPath};
  const descriptors=new Map(),state={rows:[self],calls:0,onSnapshot:null};
  const prepare=(id,release='4.18.42')=>{const final=path.join(preparedRoot,id),codeRoot=path.join(final,'code');fs.mkdirSync(path.join(codeRoot,'static'),{recursive:true});for(const file of REQUIRED)fs.writeFileSync(path.join(codeRoot,file),`prepared ${id} ${file}`);fs.writeFileSync(path.join(codeRoot,'static','index.html'),'synthetic static');const files=[...REQUIRED,'static/index.html'].sort().map(file=>{const bytes=fs.readFileSync(path.join(codeRoot,file));return {path:file,size:bytes.length,sha256:hash(bytes)};});const manifest={schema:'qq_component_prepared_v1',component:'napcat-shell',versionId:id,version:release,source:{tag:`v${release}`,assetId:1,sha256:'1'.repeat(64),size:100},files,preparedAt:'2026-11-06T00:00:00Z'};const manifestPath=path.join(final,'prepared.json'),bytes=Buffer.from(JSON.stringify(manifest));fs.writeFileSync(manifestPath,bytes);const result={versionId:id,version:release,codeRoot,manifestPath,manifestSha256:hash(bytes),files};descriptors.set(id,result);return result;};
  prepare(A);prepare(B);const prepared={resolvePrepared:async id=>{if(!descriptors.has(id))throw Object.assign(Error('private path must not escape caller'),{code:'prepared_missing'});return structuredClone(descriptors.get(id));}};
  const processHost={snapshot:async()=>{state.calls++;await state.onSnapshot?.();return structuredClone(state.rows);},inspect:async ids=>structuredClone(state.rows.filter(row=>ids.includes(row.pid)))};const options={componentsRoot,lockRoot,preparedRoot,prepared,processHost,qqExe};const selection=new QQComponentSelection(options);
  t.after(()=>{const actual=fs.realpathSync(base),temp=fs.realpathSync(os.tmpdir());assert(actual.toLowerCase().startsWith(temp.toLowerCase()+path.sep));fs.rmSync(base,{recursive:true,force:true});});
  return {base,componentsRoot,workDir,qqExe,lockRoot,preparedRoot,descriptors,prepare,state,options,selection};
}
test('preview writes nothing and layout separates stable data from prepared code',async t=>{
  const f=fixture(t);assert.equal(f.selection.layout().codeRoot,f.workDir);assert(!fs.existsSync(f.lockRoot));const before=await f.selection.preview({versionId:A});assert.equal(before.current.verification,'mandatory-files-only');assert.equal(before.candidate.versionId,A);assert.equal(before.canRollback,false);assert(!fs.existsSync(f.lockRoot));const after=await f.selection.activate({versionId:A,expectedDigest:before.digest});assert.equal(after.current.versionId,A);const plan=await f.selection.resolve();assert.equal(plan.codeRoot,path.join(f.preparedRoot,A,'code'));assert.equal(plan.workDir,f.workDir);assert.equal(plan.qqExe,f.qqExe);assert.equal(plan.configDir,path.join(f.workDir,'config'));assert.doesNotMatch(JSON.stringify(after),/PRIVATE_CONFIG|codeRoot|configDir/);assert.equal(fs.readFileSync(path.join(f.workDir,'config','onebot11_12345001.json'),'utf8'),'PRIVATE_CONFIG_MUST_NOT_BE_COPIED');
});
test('exact previous selection bytes remain and rollback changes only selection',async t=>{
  const f=fixture(t),first=await f.selection.activate({versionId:A,expectedDigest:(await f.selection.preview()).digest}),firstBytes=fs.readFileSync(f.selection.stateFile);const second=await f.selection.activate({versionId:B,expectedDigest:first.digest});assert(fs.readdirSync(f.selection.historyDir).some(name=>fs.readFileSync(path.join(f.selection.historyDir,name)).equals(firstBytes)));const previous=await f.selection.rollback({expectedDigest:second.digest});assert.equal(previous.current.versionId,A);assert.equal(previous.previous.versionId,B);assert.equal(fs.readFileSync(f.qqExe,'utf8'),'ORIGINAL_QQ_EXECUTABLE');for(const file of REQUIRED)assert.equal(fs.readFileSync(path.join(f.workDir,file),'utf8'),`original ${file}`);
});
test('a new selector in the same shared store sees selection and can return to original layout',async t=>{
  const f=fixture(t),after=await f.selection.activate({versionId:A,expectedDigest:(await f.selection.preview()).digest});const other=new QQComponentSelection(f.options);assert.equal(other.layout().kind,'prepared');const rolled=await other.rollback({expectedDigest:after.digest});assert.equal(rolled.current.kind,'original');assert.equal((await other.resolve()).codeRoot,f.workDir);
});
test('stale digest including an original-file change is rejected before selection changes',async t=>{
  const f=fixture(t),before=await f.selection.preview();fs.writeFileSync(path.join(f.workDir,'napcat.mjs'),'changed original');await assert.rejects(f.selection.activate({versionId:A,expectedDigest:before.digest}),{code:'selection_changed'});assert(!fs.existsSync(f.selection.stateFile));const current=await f.selection.preview();await f.selection.activate({versionId:A,expectedDigest:current.digest});await assert.rejects(f.selection.rollback({expectedDigest:current.digest}),{code:'selection_changed'});
});
test('Desktop, all shared QQ processes, stale account leases and config edits block activation',async t=>{
  for(const kind of ['desktop','qq','other-account-launcher','unknown-qq','lease','recover','config'])await t.test(kind,async t=>{
    const f=fixture(t),preview=await f.selection.preview();const failures={desktop:'desktop_running',qq:'runtime_running','other-account-launcher':'runtime_running','unknown-qq':'process_check_failed',lease:'runtime_locked',recover:'runtime_locked',config:'operation_in_progress'};
    if(kind==='desktop')f.state.rows.push({pid:10,name:'NapCatQQ-Desktop.exe',executable:path.join(f.base,'Desktop.exe')});if(kind==='qq')f.state.rows.push({pid:11,name:'QQ.exe',executable:f.qqExe});if(kind==='other-account-launcher')f.state.rows.push({pid:12,name:'NapCatWinBootMain.exe',executable:path.join(f.preparedRoot,B,'code','NapCatWinBootMain.exe')});if(kind==='unknown-qq')f.state.rows.push({pid:13,name:'QQ.exe',executable:''});
    if(['lease','recover','config'].includes(kind)){fs.mkdirSync(f.lockRoot,{recursive:true});fs.writeFileSync(path.join(f.lockRoot,kind==='config'?'configuration.edit':'a'.repeat(64)+'.json'+(kind==='recover'?'.recover':'')),'opaque stale state');}
    await assert.rejects(f.selection.activate({versionId:A,expectedDigest:preview.digest}),{code:failures[kind]});assert(!fs.existsSync(f.selection.stateFile));
  });
});
test('pending upstream update blocks preview, activation and startup without reading its contents',async t=>{
  const f=fixture(t),before=await f.selection.preview();fs.writeFileSync(path.join(f.workDir,'config','napcat-update.json'),'SECRET_DO_NOT_PARSE');for(const run of [()=>f.selection.preview(),()=>f.selection.activate({versionId:A,expectedDigest:before.digest}),()=>f.selection.withStartLock(()=>assert.fail('must not start'))])await assert.rejects(run(),{code:'pending_upstream_update'});assert.equal(fs.readFileSync(path.join(f.workDir,'config','napcat-update.json'),'utf8'),'SECRET_DO_NOT_PARSE');
});
test('prepared required file, static file, extra unlisted file and manifest mutation fail closed',async t=>{
  for(const kind of ['required','static','extra','manifest'])await t.test(kind,async t=>{const f=fixture(t),before=await f.selection.preview(),item=f.descriptors.get(A);if(kind==='required')fs.writeFileSync(path.join(item.codeRoot,'napcat.mjs'),'tampered');if(kind==='static')fs.unlinkSync(path.join(item.codeRoot,'static','index.html'));if(kind==='extra')fs.writeFileSync(path.join(item.codeRoot,'unlisted.js'),'tampered');if(kind==='manifest')fs.appendFileSync(item.manifestPath,' ');await assert.rejects(f.selection.activate({versionId:A,expectedDigest:before.digest}),error=>['component_changed','component_missing'].includes(error.code));assert(!fs.existsSync(f.selection.stateFile));});
});
test('links in prepared assets and hard-linked executable are refused',async t=>{
  for(const kind of ['junction','hardlink'])await t.test(kind,async t=>{const f=fixture(t),item=f.descriptors.get(A),before=await f.selection.preview();if(kind==='junction'){const external=path.join(f.base,'external');fs.mkdirSync(external);fs.symlinkSync(external,path.join(item.codeRoot,'linked'),'junction');}else{fs.linkSync(path.join(item.codeRoot,'napcat.mjs'),path.join(f.base,'other-link'));}await assert.rejects(f.selection.activate({versionId:A,expectedDigest:before.digest}),{code:'unsafe_path'});assert(!fs.existsSync(f.selection.stateFile));});
});
test('only supported same-version opaque IDs are accepted and arbitrary paths cannot be selected',async t=>{
  const f=fixture(t),before=await f.selection.preview();for(const id of ['../outside',f.workDir,'napcat-shell-bad'])await assert.rejects(f.selection.activate({versionId:id,expectedDigest:before.digest}),{code:'invalid_version'});const newer='napcat-shell-4.18.43-3333333333333333';f.prepare(newer,'4.18.43');await assert.rejects(f.selection.activate({versionId:newer,expectedDigest:before.digest}),{code:'version_change_not_supported'});assert(!fs.existsSync(f.selection.stateFile));
});
test('changes during the final process check cannot be silently committed',async t=>{
  for(const change of ['file','process','selection'])await t.test(change,async t=>{const f=fixture(t),before=await f.selection.preview();f.state.onSnapshot=()=>{if(f.state.calls!==3)return;if(change==='file')fs.appendFileSync(path.join(f.descriptors.get(A).codeRoot,'napcat.mjs'),'modified');if(change==='process')f.state.rows.push({pid:88,name:'QQ.exe',executable:f.qqExe});if(change==='selection')fs.writeFileSync(f.selection.stateFile,'CONCURRENT_UNKNOWN_SELECTION');};await assert.rejects(f.selection.activate({versionId:A,expectedDigest:before.digest}),error=>['component_changed','runtime_running','selection_invalid'].includes(error.code));if(change==='selection')assert.equal(fs.readFileSync(f.selection.stateFile,'utf8'),'CONCURRENT_UNKNOWN_SELECTION');else assert(!fs.existsSync(f.selection.stateFile));assert(!fs.existsSync(f.selection.lockFile));});
});
test('startup lock spans proof registration, serializes same-manager starts, and blocks switching',async t=>{
  const f=fixture(t);let release,entered,seen=[];const ready=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
  const first=f.selection.withStartLock(async plan=>{seen.push('first');assert.equal(plan.workDir,f.workDir);assert(fs.existsSync(f.selection.lockFile));entered();await wait;f.state.rows.push({pid:123,name:'QQ.exe',executable:f.qqExe});seen.push('proof');});await ready;
  const second=f.selection.withStartLock(async()=>{seen.push('second');assert(fs.existsSync(f.selection.lockFile));});await assert.rejects(f.selection.activate({versionId:A,expectedDigest:(await f.selection.preview()).digest}),{code:'component_locked'});release();await Promise.all([first,second]);assert.deepEqual(seen,['first','proof','second']);assert(!fs.existsSync(f.selection.lockFile));
});
test('unknown crash lock and lock replacement are preserved without automatic recovery',async t=>{
  const f=fixture(t);fs.mkdirSync(f.lockRoot,{recursive:true});fs.writeFileSync(f.selection.lockFile,'UNKNOWN_CRASH_STATE');await assert.rejects(f.selection.withStartLock(()=>assert.fail()),{code:'component_locked'});assert.equal(fs.readFileSync(f.selection.lockFile,'utf8'),'UNKNOWN_CRASH_STATE');fs.unlinkSync(f.selection.lockFile);await assert.rejects(f.selection.withStartLock(async(_plan,owned)=>{fs.writeFileSync(f.selection.lockFile,'CONCURRENT_LOCK');owned();}),{code:'component_lock_changed'});assert.equal(fs.readFileSync(f.selection.lockFile,'utf8'),'CONCURRENT_LOCK');
});
test('startup revalidates the active manifest and fixed QQ executable before running callback',async t=>{
  const f=fixture(t);await f.selection.activate({versionId:A,expectedDigest:(await f.selection.preview()).digest});fs.appendFileSync(path.join(f.descriptors.get(A).codeRoot,'static','index.html'),'changed');await assert.rejects(f.selection.withStartLock(()=>assert.fail('must not launch')),{code:'component_changed'});const g=fixture(t);await g.selection.activate({versionId:A,expectedDigest:(await g.selection.preview()).digest});fs.writeFileSync(g.qqExe,'DIFFERENT_QQ');await assert.rejects(g.selection.withStartLock(()=>assert.fail('must not launch')),error=>['component_changed','qq_component_changed'].includes(error.code));
});
test('an expired console epoch or cancellation after the final stopped check prevents commit',async t=>{
  for(const kind of ['epoch','signal'])await t.test(kind,async t=>{const f=fixture(t),preview=await f.selection.preview(),abort=new AbortController();let current=true;
    f.state.onSnapshot=()=>{if(f.state.calls===3){current=false;if(kind==='signal')abort.abort();}};
    await assert.rejects(f.selection.activate({versionId:A,expectedDigest:preview.digest,signal:abort.signal,assertCurrent:()=>{if(kind==='epoch'&&!current)throw Object.assign(Error('private old path'),{code:'changed'});}}),{code:kind==='epoch'?'changed':'cancelled'});assert(!fs.existsSync(f.selection.stateFile));assert(!fs.existsSync(f.selection.lockFile));
  });
});
test('rollback preview verifies its exact previous target and lightweight status does not promise code verification',async t=>{
  const f=fixture(t);assert.equal(f.selection.status().digest,null);assert.equal(f.selection.status().current.verification,'not-checked');await assert.rejects(f.selection.preview({operation:'rollback'}),{code:'rollback_unavailable'});
  await f.selection.activate({versionId:A,expectedDigest:(await f.selection.preview()).digest});const preview=await f.selection.preview({operation:'rollback'});assert.equal(preview.operation,'rollback');assert.equal(preview.candidate.kind,'original');assert.equal(f.selection.status().previous.verification,'not-checked');fs.appendFileSync(path.join(f.workDir,'napcat.mjs'),'changed');await assert.rejects(f.selection.preview({operation:'rollback'}),{code:'component_changed'});
});
test('a changed current selected code cannot be silently preserved as the next rollback target',async t=>{
  const f=fixture(t),chosen=await f.selection.activate({versionId:A,expectedDigest:(await f.selection.preview()).digest}),before=fs.readFileSync(f.selection.stateFile);fs.appendFileSync(path.join(f.descriptors.get(A).codeRoot,'napcat.mjs'),'changed current');
  await assert.rejects(f.selection.preview({versionId:B}),{code:'component_changed'});await assert.rejects(f.selection.activate({versionId:B,expectedDigest:chosen.digest}),{code:'component_changed'});assert(fs.readFileSync(f.selection.stateFile).equals(before));
});
test('a committed selection remains reported as committed if rename/read-back reports a later error',async t=>{
  for(const kind of ['rename-after-write','readback'])await t.test(kind,async t=>{
    const f=fixture(t),preview=await f.selection.preview(),rename=fs.renameSync;let installed=false;
    fs.renameSync=function(from,to){const result=rename.call(fs,from,to);if(to===f.selection.stateFile){installed=true;if(kind==='rename-after-write')throw Object.assign(Error('private path'),{code:'EIO'});fs.writeFileSync(path.join(f.workDir,'config','napcat-update.json'),'not parsed');}return result;};
    try{await assert.rejects(f.selection.activate({versionId:A,expectedDigest:preview.digest}),error=>error.committed===true&&!error.message.includes('private path'));}finally{fs.renameSync=rename;}
    assert(installed);assert.equal(JSON.parse(fs.readFileSync(f.selection.stateFile,'utf8')).current.versionId,A);
  });
});

