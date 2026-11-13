'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {QQComponentSelection,REQUIRED}=require('../src/bot/qq-component-selection.cjs');
const {QQComponentRepair}=require('../src/bot/qq-component-repair.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const A='napcat-shell-4.18.42-1111111111111111',B='napcat-shell-4.18.42-2222222222222222';
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-component-repair-')),componentsRoot=path.join(base,'components'),workDir=path.join(componentsRoot,'NapCatQQ'),qqExe=path.join(componentsRoot,'QQ','versions','synthetic','QQ.exe'),lockRoot=path.join(base,'shared','locks'),preparedRoot=path.join(base,'shared','versions');
  for(const d of [path.join(workDir,'config'),path.dirname(qqExe),preparedRoot])fs.mkdirSync(d,{recursive:true});
  for(const file of REQUIRED)fs.writeFileSync(path.join(workDir,file),`original ${file}`);fs.writeFileSync(qqExe,'SYNTHETIC QQ');const config=path.join(workDir,'config','onebot11_12345001.json');fs.writeFileSync(config,'SYNTHETIC PRIVATE CONFIG');
  const descriptors=new Map();for(const id of [A,B]){const root=path.join(preparedRoot,id),codeRoot=path.join(root,'code');fs.mkdirSync(path.join(codeRoot,'static'),{recursive:true});for(const file of REQUIRED)fs.writeFileSync(path.join(codeRoot,file),`${id} ${file}`);fs.writeFileSync(path.join(codeRoot,'static','index.html'),'synthetic webui');const files=[...REQUIRED,'static/index.html'].sort().map(file=>{const bytes=fs.readFileSync(path.join(codeRoot,file));return {path:file,size:bytes.length,sha256:hash(bytes)};});const manifest={schema:'qq_component_prepared_v1',component:'napcat-shell',versionId:id,version:'4.18.42',source:{tag:'v4.18.42',assetId:1,sha256:'1'.repeat(64),size:100},directories:['static'],files};const manifestPath=path.join(root,'prepared.json');fs.writeFileSync(manifestPath,JSON.stringify(manifest));descriptors.set(id,{versionId:id,version:'4.18.42',codeRoot,manifestPath,manifestSha256:hash(fs.readFileSync(manifestPath)),files});}
  const self={pid:process.pid,parentPid:1,createdAt:'2026-11-06T00:00:00.000Z',executable:process.execPath,name:'synthetic-app'},state={rows:[self],hook:null,calls:0,verifyHook:null};
  const processHost={snapshot:async()=>{state.calls++;await state.hook?.();return structuredClone(state.rows);},inspect:async ids=>state.rows.filter(row=>ids.includes(row.pid))};
  const prepared={resolvePrepared:async id=>{await state.verifyHook?.(id);return structuredClone(descriptors.get(id));}};
  const selection=new QQComponentSelection({componentsRoot,lockRoot,preparedRoot,prepared,processHost,qqExe});let elapsed=0,wall=1793920000000;
  const repair=new QQComponentRepair({selection,monotonic:()=>elapsed,now:()=>wall});
  const activate=async id=>selection.activate({versionId:id,expectedDigest:(await selection.preview({versionId:id})).digest});
  const damage=(id=A)=>fs.appendFileSync(path.join(descriptors.get(id).codeRoot,'napcat.mjs'),' CHANGED');
  t.after(()=>{const actual=fs.realpathSync(base),parent=fs.realpathSync(os.tmpdir());assert(actual.startsWith(parent+path.sep));fs.rmSync(base,{recursive:true,force:true});});
  return {base,workDir,qqExe,config,lockRoot,preparedRoot,descriptors,state,selection,repair,activate,damage,advance:n=>elapsed+=n,wall:n=>wall=n};
}
test('healthy current is refused; damaged prepared restores original four-file baseline without touching bytes',async t=>{
  const f=fixture(t);await f.activate(A);await assert.rejects(f.repair.preview(),{code:'repair_not_needed'});f.damage();const before=fs.readFileSync(f.selection.stateFile),bad=fs.readFileSync(path.join(f.descriptors.get(A).codeRoot,'napcat.mjs')),config=fs.readFileSync(f.config),qq=fs.readFileSync(f.qqExe);
  const preview=await f.repair.preview();assert.equal(preview.target.verification,'mandatory-files-only');assert.equal(preview.current.versionId,A);assert.equal(preview.clearsRollback,true);assert.doesNotMatch(JSON.stringify(preview),/PRIVATE|codeRoot|workDir|\\|\.exe/);
  const result=await f.repair.repair(preview);assert.equal(result.committed,true);assert.equal(result.repaired,true);assert.equal(result.selection.current.kind,'original');assert.equal(result.selection.previous,null);assert.equal(result.selection.canRollback,false);assert.equal(result.automaticStart,false);
  assert(fs.readFileSync(f.config).equals(config));assert(fs.readFileSync(f.qqExe).equals(qq));assert(fs.readFileSync(path.join(f.descriptors.get(A).codeRoot,'napcat.mjs')).equals(bad));assert(fs.readdirSync(f.selection.historyDir).some(name=>fs.readFileSync(path.join(f.selection.historyDir,name)).equals(before)));assert(!fs.existsSync(f.selection.lockFile));
  await assert.rejects(f.repair.repair(preview),{code:'preview_required'});
});
test('healthy prepared previous is fully verified and becomes current without keeping damaged rollback',async t=>{
  const f=fixture(t);await f.activate(A);await f.activate(B);f.damage(B);const preview=await f.repair.preview();assert.equal(preview.target.versionId,A);assert.equal(preview.target.verification,'full-manifest');const result=await f.repair.repair(preview);assert.equal(result.selection.current.versionId,A);assert.equal(result.selection.previous,null);assert.equal((await f.selection.resolve()).codeRoot,f.descriptors.get(A).codeRoot);
});
test('safe missing files, modified bytes and extra files/directories are detected, never erased',async t=>{
  for(const kind of ['missing','changed','extra','empty-directory'])await t.test(kind,async t=>{const f=fixture(t);await f.activate(A);const root=f.descriptors.get(A).codeRoot;if(kind==='missing')fs.unlinkSync(path.join(root,'static','index.html'));if(kind==='changed')f.damage();if(kind==='extra')fs.writeFileSync(path.join(root,'retained.db'),'SYNTHETIC LOCAL DATA');if(kind==='empty-directory')fs.mkdirSync(path.join(root,'extra'));const before=fs.readdirSync(root).sort();const p=await f.repair.preview();await f.repair.repair(p);assert.deepEqual(fs.readdirSync(root).sort(),before);});
});
test('no selection, no previous and current original cannot receive a repair ticket',async t=>{
  for(const kind of ['absent','previous','original'])await t.test(kind,async t=>{const f=fixture(t);if(kind!=='absent'){await f.activate(A);if(kind==='original')await f.selection.rollback({expectedDigest:f.selection.status().digest});else{const v=JSON.parse(fs.readFileSync(f.selection.stateFile));v.previous=null;fs.writeFileSync(f.selection.stateFile,JSON.stringify(v));}}await assert.rejects(f.repair.preview(),{code:'repair_unavailable'});});
});
test('manifest, QQ, selection, target, layout and links remain hard failures',async t=>{
  for(const kind of ['manifest','qq','selection','target','current-link','file-hardlink','code-link','extra-layout','oversize'])await t.test(kind,async t=>{const f=fixture(t);await f.activate(A);f.damage();const root=f.descriptors.get(A).codeRoot;
    if(kind==='manifest')fs.appendFileSync(f.descriptors.get(A).manifestPath,' ');if(kind==='qq')fs.writeFileSync(f.qqExe,'MUTATED');if(kind==='selection')fs.writeFileSync(f.selection.stateFile,'{invalid');if(kind==='target')fs.writeFileSync(path.join(f.workDir,'napcat.mjs'),'MUTATED');
    if(kind==='current-link')fs.symlinkSync(f.workDir,path.join(root,'linked'),'junction');if(kind==='file-hardlink')fs.linkSync(path.join(root,'napcat.mjs'),path.join(f.base,'second-link'));if(kind==='code-link'){fs.renameSync(root,root+'-retained');fs.symlinkSync(root+'-retained',root,'junction');}if(kind==='extra-layout')fs.writeFileSync(path.join(path.dirname(root),'unknown'),'retained');if(kind==='oversize'){const fd=fs.openSync(path.join(root,'too-large'),'w');fs.ftruncateSync(fd,128*1024*1024+1);fs.closeSync(fd);}
    const before=fs.readFileSync(f.selection.stateFile);await assert.rejects(f.repair.preview());assert(fs.readFileSync(f.selection.stateFile).equals(before));assert.equal(f.repair.ticket,null);
  });
});
test('unsafe or active installation state is not treated as damaged code',async t=>{
  for(const kind of ['desktop','qq','lease','config','primary-lock','recovery-lock','upstream'])await t.test(kind,async t=>{const f=fixture(t);await f.activate(A);f.damage();
    if(kind==='desktop')f.state.rows.push({pid:11,name:'NapCatQQ-Desktop.exe',executable:path.join(f.base,'Desktop.exe')});if(kind==='qq')f.state.rows.push({pid:12,name:'QQ.exe',executable:f.qqExe});
    const files={lease:path.join(f.lockRoot,'a'.repeat(64)+'.json'),config:f.selection.configLock,'primary-lock':f.selection.lockFile,'recovery-lock':f.selection.lockFile+'.recover',upstream:path.join(f.workDir,'config','napcat-update.json')};if(files[kind])fs.writeFileSync(files[kind],'UNKNOWN MUST REMAIN');await assert.rejects(f.repair.preview());if(files[kind])assert.equal(fs.readFileSync(files[kind],'utf8'),'UNKNOWN MUST REMAIN');
  });
});
test('preview is one-use and monotonic expiry survives backwards wall time',async t=>{
  const f=fixture(t);await f.activate(A);f.damage();let p=await f.repair.preview();f.wall(0);f.advance(300001);await assert.rejects(f.repair.repair(p),{code:'preview_expired'});await assert.rejects(f.repair.repair(p),{code:'preview_required'});p=await f.repair.preview();f.repair.discardPreview();await assert.rejects(f.repair.repair(p),{code:'preview_required'});
});
test('post-preview changed current/target/selection identity invalidates ticket even when bytes are restored',async t=>{
  for(const kind of ['bad-byte','bad-file-identity','target','selection','extra','missing'])await t.test(kind,async t=>{const f=fixture(t);await f.activate(A);f.damage();const p=await f.repair.preview(),file=path.join(f.descriptors.get(A).codeRoot,'napcat.mjs'),before=fs.readFileSync(f.selection.stateFile);
    if(kind==='bad-byte')fs.appendFileSync(file,' AGAIN');if(kind==='bad-file-identity'){const b=fs.readFileSync(file);fs.renameSync(file,file+'.old');fs.writeFileSync(file,b);}if(kind==='target')fs.appendFileSync(path.join(f.workDir,'napcat.mjs'),' changed');if(kind==='selection'){const b=fs.readFileSync(f.selection.stateFile);fs.renameSync(f.selection.stateFile,f.selection.stateFile+'.old');fs.writeFileSync(f.selection.stateFile,b);}if(kind==='extra')fs.writeFileSync(path.join(f.descriptors.get(A).codeRoot,'new.js'),'new');if(kind==='missing')fs.unlinkSync(path.join(f.descriptors.get(A).codeRoot,'qqnt.json'));
    await assert.rejects(f.repair.repair(p));assert(fs.readFileSync(f.selection.stateFile).equals(before));await assert.rejects(f.repair.repair(p),{code:'preview_required'});
  });
});
test('late state change after durable temporary write is rejected before rename',async t=>{
  for(const kind of ['code','qq','target','process','context','cancel','temp'])await t.test(kind,async t=>{const f=fixture(t);await f.activate(A);f.damage();const p=await f.repair.preview(),before=fs.readFileSync(f.selection.stateFile),write=fs.writeFileSync;let changed=false;const abort=new AbortController();
    fs.writeFileSync=function(fd,data,...args){const result=write.call(fs,fd,data,...args);if(typeof fd==='number'&&Buffer.isBuffer(data)&&data.toString().includes('"previous": null')&&!changed){changed=true;if(kind==='code')fs.appendFileSync(path.join(f.descriptors.get(A).codeRoot,'napcat.mjs'),' LATE');if(kind==='qq')write.call(fs,f.qqExe,'CHANGED');if(kind==='target')fs.appendFileSync(path.join(f.workDir,'napcat.mjs'),' LATE');if(kind==='process')f.state.rows.push({pid:18,name:'QQ.exe',executable:f.qqExe});if(kind==='cancel')abort.abort();if(kind==='temp')fs.writeSync(fd,Buffer.from('X'),0,1,0);}return result;};
    try{await assert.rejects(f.repair.repair({...p,signal:abort.signal,assertCurrent:()=>{if(kind==='context'&&changed)throw Object.assign(Error('PRIVATE CONTEXT'),{code:'changed'});}}));}finally{fs.writeFileSync=write;}
    assert(changed);assert(fs.readFileSync(f.selection.stateFile).equals(before));assert(!fs.existsSync(f.selection.lockFile));
  });
});
test('rename effects and failures after commit never report unchanged',async t=>{
  for(const kind of ['rename-after','readback','unknown'])await t.test(kind,async t=>{const f=fixture(t);await f.activate(A);f.damage();const p=await f.repair.preview(),rename=fs.renameSync;
    fs.renameSync=function(from,to){if(to!==f.selection.stateFile)return rename.call(fs,from,to);if(kind==='unknown'){fs.writeFileSync(to,'UNKNOWN CONCURRENT STATE');throw Object.assign(Error('PRIVATE PATH'),{code:'EIO'});}const result=rename.call(fs,from,to);if(kind==='rename-after')throw Object.assign(Error('PRIVATE PATH'),{code:'EIO'});fs.writeFileSync(path.join(f.workDir,'config','napcat-update.json'),'SYNTHETIC');return result;};
    let result;try{result=await f.repair.repair(p);}finally{fs.renameSync=rename;}
    assert.equal(result.committed,kind==='unknown'?null:true);assert.equal(result.automaticStart,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE PATH|UNKNOWN CONCURRENT/);if(kind==='unknown')assert.equal(result.changeAttempted,true);else assert.equal(JSON.parse(fs.readFileSync(f.selection.stateFile)).previous,null);
  });
});
test('lock cleanup failure preserves committed repair and exact foreign lock',async t=>{
  const f=fixture(t);await f.activate(A);f.damage();const p=await f.repair.preview(),rename=fs.renameSync;
  fs.renameSync=function(from,to){const value=rename.call(fs,from,to);if(to===f.selection.stateFile)fs.writeFileSync(f.selection.lockFile,'FOREIGN UNKNOWN LOCK');return value;};let result;try{result=await f.repair.repair(p);}finally{fs.renameSync=rename;}
  assert.equal(result.committed,true);assert.equal(result.lockRecoveryIssue,'component_lock_retained');assert.equal(fs.readFileSync(f.selection.lockFile,'utf8'),'FOREIGN UNKNOWN LOCK');
});
test('the durable history backup is rechecked after awaited guards before replacing selection',async t=>{
  const f=fixture(t);await f.activate(A);f.damage();const p=await f.repair.preview(),before=fs.readFileSync(f.selection.stateFile),names=new Set(fs.readdirSync(f.selection.historyDir));let replaced=false;
  f.state.hook=()=>{const added=fs.readdirSync(f.selection.historyDir).filter(name=>!names.has(name));if(added.length&&!replaced){replaced=true;fs.writeFileSync(path.join(f.selection.historyDir,added[0]),'CONCURRENT UNKNOWN HISTORY');}};
  await assert.rejects(f.repair.repair(p),{code:'repair_changed'});assert(replaced);assert(fs.readFileSync(f.selection.stateFile).equals(before));assert(fs.readdirSync(f.selection.historyDir).some(name=>fs.readFileSync(path.join(f.selection.historyDir,name),'utf8')==='CONCURRENT UNKNOWN HISTORY'));
});
function coordinator(t,f){
  const {QQComponents}=require('../src/bot/qq-components.cjs');const packages={root:f.base,inspect:async()=>assert.fail('No network'),stage:async()=>assert.fail('No download')};
  Object.assign(f.selection.prepared,{root:f.base,packages,component:'napcat-shell',prepare:async()=>assert.fail('No preparation'),listPrepared:async()=>({items:[],issues:[]})});
  const runtime={componentStoreRoot:f.base,componentSelection:()=>f.selection},console={runtime,epoch:0,busy:new Set(),closed:false,refreshRevision:0,refreshing:null,check(value,epoch){if(this.closed||this.runtime!==value||epoch!==this.epoch)throw Object.assign(Error('PRIVATE CONTEXT'),{code:'changed'});},refresh:async()=>{},abortDirectory(){}};
  const value=new QQComponents({console,repairFactory:options=>new QQComponentRepair(options)});t.after(()=>value.close());return {value,console};
}
test('real transaction integrates with production coordinator preview/repair/status without losing scope or leaking evidence',async t=>{
  const f=fixture(t);await f.activate(A);f.damage();const {value,console}=coordinator(t,f),preview=await value.execute({action:'repair-preview'});assert.equal(typeof preview.repairPreview.expiresAt,'number');assert.equal(preview.repairPreview.target.verification,'mandatory-files-only');
  const result=await value.execute({action:'repair',ticketId:preview.repairPreview.ticketId,expectedDigest:preview.repairPreview.expectedDigest});assert.equal(result.committed,true);assert.equal(result.repaired,true);assert.equal(result.selection.current.kind,'original');assert.equal(result.selection.previous,null);assert.equal(console.busy.size,0);
  const state=value.snapshot();assert.equal(state.lastRepair.repaired,true);assert.doesNotMatch(JSON.stringify(state),/ticketId|PRIVATE|codeRoot|workDir|[A-Z]:\\/);await assert.rejects(value.execute({action:'repair',ticketId:preview.repairPreview.ticketId,expectedDigest:preview.repairPreview.expectedDigest}),{code:'preview_required'});
});
test('production coordinator dismiss and identity change revoke real backend preview',async t=>{
  const f=fixture(t);await f.activate(A);f.damage();const {value,console}=coordinator(t,f);let preview=await value.execute({action:'repair-preview'});await value.execute({action:'repair-dismiss'});await assert.rejects(value.execute({action:'repair',ticketId:preview.repairPreview.ticketId,expectedDigest:preview.repairPreview.expectedDigest}),{code:'preview_required'});
  preview=await value.execute({action:'repair-preview'});console.epoch++;await assert.rejects(value.execute({action:'repair',ticketId:preview.repairPreview.ticketId,expectedDigest:preview.repairPreview.expectedDigest}),{code:'preview_required'});assert.equal(JSON.parse(fs.readFileSync(f.selection.stateFile)).current.versionId,A);
});
test('production coordinator preserves real uncertain replacement and committed refresh failure separately',async t=>{
  for(const mode of ['unknown','readback','refresh','lock'])await t.test(mode,async t=>{const f=fixture(t);await f.activate(A);f.damage();const {value,console}=coordinator(t,f),preview=(await value.execute({action:'repair-preview'})).repairPreview,rename=fs.renameSync;
    if(mode==='refresh')console.refresh=async()=>{throw Object.assign(Error('PRIVATE PATH'),{code:'component_io_failed'});};
    fs.renameSync=function(from,to){if(to!==f.selection.stateFile)return rename.call(fs,from,to);if(mode==='unknown'){fs.writeFileSync(to,'UNCONFIRMED');throw Object.assign(Error('PRIVATE PATH'),{code:'EIO'});}const result=rename.call(fs,from,to);if(mode==='readback')fs.writeFileSync(path.join(f.workDir,'config','napcat-update.json'),'SYNTHETIC');if(mode==='lock')fs.writeFileSync(f.selection.lockFile,'UNKNOWN');return result;};let result;
    try{result=await value.execute({action:'repair',ticketId:preview.ticketId,expectedDigest:preview.expectedDigest});}finally{fs.renameSync=rename;}
    assert.equal(result.committed,mode==='unknown'?null:true);assert.equal(result.repaired,['refresh','lock'].includes(mode));if(mode==='lock')assert.equal(result.lockRecoveryIssue,'component_lock_retained');if(mode==='unknown')assert.equal(result.changeAttempted,true);assert.equal(console.busy.size,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE PATH|UNCONFIRMED|ticketId/);
  });
});
test('close and async guards prevent commit; concurrent preview does not replace active transaction',async t=>{
  const f=fixture(t);await f.activate(A);f.damage();const p=await f.repair.preview();let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);f.state.hook=async()=>{entered();await gate;};const action=f.repair.repair(p);await ready;await assert.rejects(f.repair.preview(),{code:'repair_busy'});f.repair.close();release();await assert.rejects(action,{code:'manager_closing'});assert.equal(JSON.parse(fs.readFileSync(f.selection.stateFile)).current.versionId,A);
  const g=fixture(t);await g.activate(A);g.damage();await assert.rejects(g.repair.preview({assertCurrent:async()=>{throw Error('private');}}),{code:'invalid_request'});
});
