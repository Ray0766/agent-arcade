'use strict';
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {QQComponentSelection,REQUIRED}=require('../src/bot/qq-component-selection.cjs');
const {QQComponentLockRecovery,withRecoveryGate,gateEndpoint,createConfigurationMarker}=require('../src/bot/qq-component-lock-recovery.cjs');
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-component-recovery-')),componentsRoot=path.join(base,'components'),workDir=path.join(componentsRoot,'NapCatQQ'),qqExe=path.join(componentsRoot,'QQ','versions','fixed','QQ.exe'),lockRoot=path.join(base,'locks');
  fs.mkdirSync(path.join(workDir,'config'),{recursive:true});fs.mkdirSync(path.dirname(qqExe),{recursive:true});for(const name of REQUIRED)fs.writeFileSync(path.join(workDir,name),'synthetic');fs.writeFileSync(qqExe,'synthetic');
  const self={pid:process.pid,parentPid:1,createdAt:'2026-11-06T00:00:00.0000000Z',name:'synthetic app',executable:process.execPath},old={pid:900123,parentPid:1,createdAt:'2026-11-05T00:00:00.0000000Z',name:'synthetic old app',executable:path.join(base,'abandoned-app.exe')};
  const state={rows:[self],onInspect:null,onSnapshot:null},host={snapshot:async()=>{await state.onSnapshot?.();return structuredClone(state.rows);},inspect:async ids=>{await state.onInspect?.(ids);return structuredClone(state.rows.filter(row=>ids.includes(row.pid)));}};
  const selection=new QQComponentSelection({componentsRoot,lockRoot,qqExe,preparedRoot:path.join(base,'prepared'),prepared:{resolvePrepared:async()=>assert.fail('no prepared files used')},processHost:host}),recovery=new QQComponentLockRecovery({selection,processHost:host});
  const write=(schema='qq_component_lock_v2')=>{fs.mkdirSync(lockRoot,{recursive:true});const content={schema,installationId:selection.installationId,owner:{pid:old.pid,createdAt:old.createdAt,executable:old.executable},token:randomUUID(),at:new Date().toISOString()};if(schema==='qq_component_lock_v1'){delete content.owner;content.pid=old.pid;}fs.writeFileSync(selection.lockFile,JSON.stringify(content));return content;};
  t.after(()=>{const actual=fs.realpathSync(base);assert(actual.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(base,{recursive:true,force:true});});return {base,workDir,qqExe,lockRoot,self,old,state,host,selection,recovery,write};
}
test('new lock records exact observed current owner proof and remains held through operation',async t=>{const f=fixture(t);await f.selection.withStartLock(async()=>{const value=JSON.parse(fs.readFileSync(f.selection.lockFile));assert.equal(value.schema,'qq_component_lock_v2');assert.deepEqual(value.owner,{pid:f.self.pid,createdAt:f.self.createdAt,executable:f.self.executable});});assert(!fs.existsSync(f.selection.lockFile));});
test('missing or inconsistent own process identity refuses to create a recoverable lock',async t=>{const f=fixture(t);f.state.rows=[];await assert.rejects(f.selection.withStartLock(()=>assert.fail()),{code:'process_check_failed'});assert(!fs.existsSync(f.selection.lockFile));f.state.rows=[{...f.self,executable:path.join(f.base,'different.exe')}];await assert.rejects(f.selection.withStartLock(()=>assert.fail()),{code:'process_check_failed'});});
test('an explicit proven-dead lock recovery removes only that exact lock and never starts or changes selection',async t=>{const f=fixture(t);f.write();const before=fs.readFileSync(path.join(f.workDir,'napcat.mjs'));const preview=await f.recovery.preview();assert.equal(preview.recovery,'eligible');assert(!JSON.stringify(preview).includes('token'));assert(!JSON.stringify(preview).includes(f.base));const result=await f.recovery.recover({expectedDigest:preview.digest});assert.equal(result.recovered,true);assert.equal(result.automaticStart,false);assert(!fs.existsSync(f.selection.lockFile));assert(!fs.existsSync(f.recovery.guard));assert(!fs.existsSync(f.selection.stateFile));assert(fs.readFileSync(path.join(f.workDir,'napcat.mjs')).equals(before));});
test('PID-only legacy locks lack proof and remain byte-for-byte unchanged',async t=>{const f=fixture(t);f.write('qq_component_lock_v1');const before=fs.readFileSync(f.selection.lockFile);await assert.rejects(f.recovery.preview(),{code:'lock_proof_unavailable'});await assert.rejects(f.recovery.recover({expectedDigest:'a'.repeat(64)}),{code:'lock_proof_unavailable'});assert(fs.readFileSync(f.selection.lockFile).equals(before));});
test('live exact owner, recycled PID and inconsistent direct observations never authorize deletion',async t=>{
  for(const mode of ['alive','time-reused','exe-reused','snapshot-omits'])await t.test(mode,async t=>{const f=fixture(t);f.write();f.state.rows.push(mode==='time-reused'?{...f.old,createdAt:'2026-11-06T00:02:00Z'}:mode==='exe-reused'?{...f.old,executable:path.join(f.base,'replacement.exe')}:f.old);if(mode==='snapshot-omits')f.host.snapshot=async()=>[f.self];await assert.rejects(f.recovery.preview(),{code:mode==='alive'?'owner_alive':mode==='snapshot-omits'?'process_check_failed':'owner_identity_changed'});assert(fs.existsSync(f.selection.lockFile));});
});
test('Desktop, any component process, account lease and configuration transaction block recovery',async t=>{
  for(const mode of ['desktop','qq','lease','config'])await t.test(mode,async t=>{const f=fixture(t);f.write();if(mode==='desktop')f.state.rows.push({pid:700001,name:'NapCatQQ-Desktop.exe',executable:path.join(f.base,'desktop.exe')});if(mode==='qq')f.state.rows.push({pid:700002,name:'QQ.exe',executable:f.qqExe});if(mode==='lease')fs.writeFileSync(path.join(f.lockRoot,'a'.repeat(64)+'.json'),'stale');if(mode==='config')fs.writeFileSync(path.join(f.lockRoot,'configuration.edit'),'busy');await assert.rejects(f.recovery.preview(),{code:{desktop:'desktop_running',qq:'runtime_running',lease:'runtime_locked',config:'operation_in_progress'}[mode]});assert(fs.existsSync(f.selection.lockFile));});
});
test('changed preview bytes, expired console and cancelled intent preserve the lock',async t=>{
  for(const mode of ['digest','epoch','signal'])await t.test(mode,async t=>{const f=fixture(t);f.write();const preview=await f.recovery.preview(),abort=new AbortController();if(mode==='digest')f.write();if(mode==='signal')abort.abort();await assert.rejects(f.recovery.recover({expectedDigest:preview.digest,signal:abort.signal,assertCurrent:()=>{if(mode==='epoch')throw Object.assign(Error('private detail'),{code:'changed'});}}),{code:{digest:'component_lock_changed',epoch:'changed',signal:'cancelled'}[mode]});assert(fs.existsSync(f.selection.lockFile));assert(!fs.existsSync(f.recovery.guard));});
});
test('lock replacement during final owner observations is not removed',async t=>{const f=fixture(t);f.write();const preview=await f.recovery.preview();let changed=false;f.state.onInspect=ids=>{if(ids[0]===f.old.pid&&!changed){changed=true;f.write();}};await assert.rejects(f.recovery.recover({expectedDigest:preview.digest}),{code:'component_lock_changed'});assert(changed);assert(fs.existsSync(f.selection.lockFile));assert(!fs.existsSync(f.recovery.guard));});
test('an unknown recovery guard is preserved and prevents recovery and new starts',async t=>{const f=fixture(t);f.write();fs.writeFileSync(f.recovery.guard,'unknown');await assert.rejects(f.recovery.preview(),{code:'recovery_in_progress'});await assert.rejects(f.selection.withStartLock(()=>assert.fail()),{code:'recovery_in_progress'});assert.equal(fs.readFileSync(f.recovery.guard,'utf8'),'unknown');});
test('a committed unlink error remains explicitly marked as a changed lock',async t=>{const f=fixture(t);f.write();const preview=await f.recovery.preview(),unlink=fs.unlinkSync;fs.unlinkSync=function(file){const value=unlink.call(fs,file);if(file===f.selection.lockFile)throw Object.assign(Error('secret path'),{code:'EIO'});return value;};try{await assert.rejects(f.recovery.recover({expectedDigest:preview.digest}),error=>error.code==='recovery_readback_failed'&&error.committed===true&&!error.message.includes('secret'));}finally{fs.unlinkSync=unlink;}assert(!fs.existsSync(f.selection.lockFile));assert(!fs.existsSync(f.recovery.guard));});

function abandonedGuard(f,patch={}){
  fs.mkdirSync(f.lockRoot,{recursive:true});const owner={pid:900124,createdAt:'2026-11-05T02:00:00.0000000Z',executable:path.join(f.base,'abandoned-recovery.exe')};
  const value={schema:'qq_component_recovery_guard_v1',installationId:f.selection.installationId,owner,token:randomUUID(),at:'2026-11-05T02:00:01Z',...patch};fs.writeFileSync(f.recovery.guard,JSON.stringify(value));return value;
}
test('crash before primary unlink: explicit recovery clears only the proven-dead recovery guard',async t=>{
  const f=fixture(t);f.write();abandonedGuard(f);const primary=fs.readFileSync(f.selection.lockFile),guard=fs.readFileSync(f.recovery.guard),preview=await f.recovery.previewGuardRecovery();
  assert.equal(preview.recovery,'guard-eligible');assert.equal(preview.componentLockRemaining,true);assert(fs.readFileSync(f.recovery.guard).equals(guard));assert(!JSON.stringify(preview).includes('token'));
  const result=await f.recovery.recoverGuard({expectedDigest:preview.digest});assert.equal(result.recovery,'guard-cleared');assert(result.componentLockRemaining);assert(!fs.existsSync(f.recovery.guard));assert(fs.readFileSync(f.selection.lockFile).equals(primary));assert(!fs.existsSync(`${f.recovery.guard}.recover`));
  const next=await f.recovery.preview();await f.recovery.recover({expectedDigest:next.digest});assert(!fs.existsSync(f.selection.lockFile));assert(!fs.existsSync(f.selection.stateFile));
});
test('crash after primary unlink: the remaining proven recovery guard is clearable without a primary lock',async t=>{
  const f=fixture(t);abandonedGuard(f);const preview=await f.recovery.previewGuardRecovery();assert.equal(preview.componentLockRemaining,false);
  const result=await f.recovery.recoverGuard({expectedDigest:preview.digest});assert.equal(result.componentLockRemaining,false);assert(!fs.existsSync(f.recovery.guard));assert(!fs.existsSync(f.selection.lockFile));assert(!fs.existsSync(f.selection.stateFile));
});
test('live, PID-reused, incomplete and unknown recovery owners never authorize guard removal',async t=>{
  for(const mode of ['alive','reused','pid-only','unknown-schema','corrupt','unknown-primary'])await t.test(mode,async t=>{
    const f=fixture(t),guard=abandonedGuard(f);
    if(mode==='alive')f.state.rows.push({...guard.owner,name:'synthetic recovery',parentPid:1});
    if(mode==='reused')f.state.rows.push({...guard.owner,createdAt:'2026-11-06T09:00:00Z',name:'replacement',parentPid:1});
    if(mode==='pid-only'){delete guard.owner;guard.pid=900124;fs.writeFileSync(f.recovery.guard,JSON.stringify(guard));}
    if(mode==='unknown-schema')abandonedGuard(f,{schema:'unknown'});
    if(mode==='corrupt')fs.writeFileSync(f.recovery.guard,'not a lock proof');
    if(mode==='unknown-primary')f.write('qq_component_lock_v1');
    const before=fs.readFileSync(f.recovery.guard);await assert.rejects(f.recovery.previewGuardRecovery(),{code:mode==='alive'?'owner_alive':mode==='reused'?'owner_identity_changed':mode==='unknown-primary'?'lock_proof_unavailable':'recovery_guard_proof_unavailable'});assert(fs.readFileSync(f.recovery.guard).equals(before));
  });
});
test('guard recovery binds the exact inode and bytes and the presence of its original primary lock',async t=>{
  for(const change of ['guard-bytes','guard-inode','primary-added','primary-removed'])await t.test(change,async t=>{
    const f=fixture(t);if(change==='primary-removed')f.write();abandonedGuard(f);const preview=await f.recovery.previewGuardRecovery();
    if(change==='guard-bytes')abandonedGuard(f);
    if(change==='guard-inode'){const next=`${f.recovery.guard}.fixture`;fs.writeFileSync(next,fs.readFileSync(f.recovery.guard));fs.renameSync(next,f.recovery.guard);}
    if(change==='primary-added')f.write();if(change==='primary-removed')fs.unlinkSync(f.selection.lockFile);
    await assert.rejects(f.recovery.recoverGuard({expectedDigest:preview.digest}),{code:'component_lock_changed'});assert(fs.existsSync(f.recovery.guard));
  });
});
test('replacement during final guard owner checks, stale intent and cancellation preserve the target guard',async t=>{
  for(const mode of ['replacement','epoch','signal'])await t.test(mode,async t=>{
    const f=fixture(t);abandonedGuard(f);const preview=await f.recovery.previewGuardRecovery(),signal=new AbortController();let changed=false;
    if(mode==='replacement')f.state.onInspect=ids=>{if(ids[0]===900124&&!changed){changed=true;abandonedGuard(f);}};
    if(mode==='signal')signal.abort();await assert.rejects(f.recovery.recoverGuard({expectedDigest:preview.digest,signal:signal.signal,assertCurrent:()=>{if(mode==='epoch')throw Object.assign(Error('context changed'),{code:'changed'});}}),{code:mode==='replacement'?'component_lock_changed':mode==='epoch'?'changed':'cancelled'});
    assert(fs.existsSync(f.recovery.guard));assert(!fs.existsSync(`${f.recovery.guard}.recover`));
  });
});
test('the ephemeral gate serializes recovery attempts and never creates a third disk guard',async t=>{
  const f=fixture(t);abandonedGuard(f);let release,entered;const held=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});
  const holding=withRecoveryGate(f.selection.installationId,async()=>{entered();await held;});await ready;
  await assert.rejects(f.recovery.previewGuardRecovery(),{code:'recovery_in_progress'});assert.equal(fs.readdirSync(f.lockRoot).length,1);release();await holding;
  assert.equal((await f.recovery.previewGuardRecovery()).recovery,'guard-eligible');
});
test('a recovery worker exits abruptly: Windows pipe or Linux abstract gate disappears without a disk recovery chain',async t=>{
  if(!['win32','linux'].includes(process.platform)){t.skip('only nonpersistent OS IPC gates are supported');return;}
  const f=fixture(t),{spawn}=require('node:child_process'),{once}=require('node:events');
  const child=spawn(process.execPath,['-e',"const net=require('node:net');const s=net.createServer(c=>c.destroy());s.listen(process.argv[1],()=>process.send('ready'));process.on('message',()=>process.exit(73));",gateEndpoint(f.selection.installationId)],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null)child.kill();});const ready=await Promise.race([once(child,'message'),new Promise((_,reject)=>setTimeout(()=>reject(Error('synthetic child startup timeout')),4000).unref())]);assert.equal(ready[0],'ready');
  await assert.rejects(withRecoveryGate(f.selection.installationId,()=>assert.fail()),{code:'recovery_in_progress'});
  const exited=once(child,'exit');child.send('simulate-crash-without-finally');assert.equal((await exited)[0],73);
  assert.equal(await withRecoveryGate(f.selection.installationId,async()=>true),true);assert(!fs.existsSync(f.lockRoot));
});
test('guard deletion committed before a readback error is reported explicitly, without another guard file',async t=>{
  const f=fixture(t);f.write();abandonedGuard(f);const preview=await f.recovery.previewGuardRecovery(),primary=fs.readFileSync(f.selection.lockFile),unlink=fs.unlinkSync;
  fs.unlinkSync=function(file){const result=unlink.call(fs,file);if(file===f.recovery.guard)throw Object.assign(Error('private filesystem detail'),{code:'EIO'});return result;};
  try{await assert.rejects(f.recovery.recoverGuard({expectedDigest:preview.digest}),error=>error.code==='recovery_readback_failed'&&error.committed===true&&!error.message.includes('private'));}finally{fs.unlinkSync=unlink;}
  assert(!fs.existsSync(f.recovery.guard));assert(!fs.existsSync(`${f.recovery.guard}.recover`));assert(fs.readFileSync(f.selection.lockFile).equals(primary));
});
test('an absent recovery guard has an explicit unchanged result and a hard-linked guard is retained',async t=>{
  const f=fixture(t);await assert.rejects(f.recovery.previewGuardRecovery(),{code:'recovery_guard_missing'});
  abandonedGuard(f);const copy=path.join(f.base,'hardlinked-guard');fs.linkSync(f.recovery.guard,copy);const before=fs.readFileSync(copy);
  await assert.rejects(f.recovery.previewGuardRecovery(),{code:'unsafe_lock'});assert(fs.readFileSync(f.recovery.guard).equals(before));assert(fs.readFileSync(copy).equals(before));
});
test('a dangling recovery-guard link remains a blocking unknown path for both start and recovery',async t=>{
  const f=fixture(t);fs.mkdirSync(f.lockRoot,{recursive:true});const target=path.join(f.base,'missing-guard-target');
  try{fs.symlinkSync(target,f.recovery.guard,process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('test account cannot create a synthetic link');return;}throw error;}
  await assert.rejects(f.selection.withStartLock(()=>assert.fail()),{code:'recovery_in_progress'});
  await assert.rejects(f.recovery.previewGuardRecovery(),{code:'unsafe_lock'});assert(fs.lstatSync(f.recovery.guard).isSymbolicLink());assert(!fs.existsSync(f.selection.lockFile));
});
function abandonedConfiguration(f,{removePrimary=false,guard=false}={}){
  f.write();const primary=f.recovery._read(),value={schema:'qq_configuration_lock_v2',installationId:f.selection.installationId,owner:primary.value.owner,componentToken:primary.value.token,componentLockDigest:primary.digest,token:randomUUID(),at:'2026-11-05T02:00:00Z'};
  fs.writeFileSync(f.selection.configLock,JSON.stringify(value));if(removePrimary)fs.unlinkSync(f.selection.lockFile);if(guard)abandonedGuard(f);return value;
}
test('normal configuration marker is linked to the exact held v2 component lock and never removes a replacement',async t=>{
  const f=fixture(t);let marker;
  await f.selection.withStartLock(async()=>{
    const primary=f.recovery._read();marker=await createConfigurationMarker({selection:f.selection,processHost:f.host});marker.assertOwned();const value=JSON.parse(fs.readFileSync(f.selection.configLock));assert.equal(value.schema,'qq_configuration_lock_v2');assert.deepEqual(value.owner,primary.value.owner);assert.equal(value.componentToken,primary.value.token);assert.equal(value.componentLockDigest,primary.digest);
    await assert.rejects(f.recovery.previewConfigurationRecovery(),{code:'owner_alive'});
    fs.writeFileSync(f.selection.configLock,'unknown replacement');assert.deepEqual(marker.close(),{released:false,issue:'configuration_marker_retained'});
  });
  assert.equal(fs.readFileSync(f.selection.configLock,'utf8'),'unknown replacement');assert(!fs.existsSync(f.selection.lockFile));
});
test('configuration marker cleanup preserves all config bytes and requires separate recovery for every remaining lock',async t=>{
  const f=fixture(t);abandonedConfiguration(f,{guard:true});const primary=fs.readFileSync(f.selection.lockFile),guard=fs.readFileSync(f.recovery.guard),config=path.join(f.workDir,'config','synthetic.json');fs.writeFileSync(config,'unchanged configuration');
  await assert.rejects(f.recovery.preview(),{code:'recovery_in_progress'});await assert.rejects(f.recovery.previewGuardRecovery(),{code:'operation_in_progress'});
  const preview=await f.recovery.previewConfigurationRecovery();assert.equal(preview.configurationRestored,false);assert(preview.componentLockRemaining&&preview.recoveryGuardRemaining);
  const result=await f.recovery.recoverConfiguration({expectedDigest:preview.digest});assert.equal(result.recovery,'configuration-cleared');assert.equal(result.configurationRestored,false);assert.equal(result.automaticStart,false);assert(fs.readFileSync(f.selection.lockFile).equals(primary));assert(fs.readFileSync(f.recovery.guard).equals(guard));assert.equal(fs.readFileSync(config,'utf8'),'unchanged configuration');
  const guardPreview=await f.recovery.previewGuardRecovery();await f.recovery.recoverGuard({expectedDigest:guardPreview.digest});const lockPreview=await f.recovery.preview();await f.recovery.recover({expectedDigest:lockPreview.digest});assert(!fs.existsSync(f.selection.configLock));assert(!fs.existsSync(f.selection.lockFile));assert(!fs.existsSync(f.recovery.guard));
});
test('configuration recovery can bind verified primary absence but rejects a newly appearing primary',async t=>{
  const f=fixture(t);abandonedConfiguration(f,{removePrimary:true});let preview=await f.recovery.previewConfigurationRecovery();assert.equal(preview.componentLockRemaining,false);f.write();
  await assert.rejects(f.recovery.recoverConfiguration({expectedDigest:preview.digest}),{code:'configuration_link_changed'});assert(fs.existsSync(f.selection.configLock));fs.unlinkSync(f.selection.lockFile);
  preview=await f.recovery.previewConfigurationRecovery();assert.equal((await f.recovery.recoverConfiguration({expectedDigest:preview.digest})).componentLockRemaining,false);assert(!fs.existsSync(f.selection.configLock));
});
test('empty, unknown and incorrectly associated configuration markers remain blocked and unchanged',async t=>{
  for(const mode of ['empty','unknown','owner','token','primary-inode','guard'])await t.test(mode,async t=>{
    const f=fixture(t),value=abandonedConfiguration(f);
    if(mode==='empty')fs.writeFileSync(f.selection.configLock,'');if(mode==='unknown'){value.schema='unknown';fs.writeFileSync(f.selection.configLock,JSON.stringify(value));}
    if(mode==='owner'){value.owner={...value.owner,createdAt:'2026-11-04T00:00:00Z'};fs.writeFileSync(f.selection.configLock,JSON.stringify(value));}
    if(mode==='token'){value.componentToken=randomUUID();fs.writeFileSync(f.selection.configLock,JSON.stringify(value));}
    if(mode==='primary-inode'){const replacement=path.join(f.lockRoot,'synthetic-new-inode');fs.writeFileSync(replacement,fs.readFileSync(f.selection.lockFile));fs.renameSync(replacement,f.selection.lockFile);}
    if(mode==='guard')fs.writeFileSync(f.recovery.guard,'unknown guard');const bytes=fs.readFileSync(f.selection.configLock);
    await assert.rejects(f.recovery.previewConfigurationRecovery(),{code:['empty','unknown'].includes(mode)?'configuration_proof_unavailable':mode==='guard'?'recovery_guard_proof_unavailable':'configuration_link_changed'});assert(fs.readFileSync(f.selection.configLock).equals(bytes));assert(fs.existsSync(f.selection.lockFile));
  });
});
test('configuration marker replacement after preview is retained; no arbitrary config marker is skipped',async t=>{
  const f=fixture(t);abandonedConfiguration(f);const preview=await f.recovery.previewConfigurationRecovery();let changed=false;
  f.state.onInspect=ids=>{if(ids[0]===f.old.pid&&!changed){changed=true;fs.writeFileSync(f.selection.configLock,'replacement marker');}};
  await assert.rejects(f.recovery.recoverConfiguration({expectedDigest:preview.digest}),{code:'configuration_proof_unavailable'});assert.equal(fs.readFileSync(f.selection.configLock,'utf8'),'replacement marker');assert(fs.existsSync(f.selection.lockFile));
});
test('configuration-marker unlink before a reported error keeps committed true',async t=>{
  const f=fixture(t);abandonedConfiguration(f);const preview=await f.recovery.previewConfigurationRecovery(),unlink=fs.unlinkSync;
  fs.unlinkSync=function(file){const value=unlink.call(fs,file);if(file===f.selection.configLock)throw Error('synthetic unlink result lost');return value;};
  try{await assert.rejects(f.recovery.recoverConfiguration({expectedDigest:preview.digest}),error=>error.committed===true&&error.code==='recovery_readback_failed');}finally{fs.unlinkSync=unlink;}
  assert(!fs.existsSync(f.selection.configLock));assert(fs.existsSync(f.selection.lockFile));
});
test('closing the owned recovery fd cannot hide a confirmed primary unlink',async t=>{
  const f=fixture(t);f.write();const preview=await f.recovery.preview(),open=fs.openSync,close=fs.closeSync;let owned;
  fs.openSync=function(file,...args){const fd=open.call(fs,file,...args);if(file===f.recovery.guard&&args[0]==='wx')owned=fd;return fd;};
  fs.closeSync=function(fd){const result=close.call(fs,fd);if(fd===owned){owned=undefined;throw Error('synthetic close failure');}return result;};
  try{const result=await f.recovery.recover({expectedDigest:preview.digest});assert.equal(result.recovered,true);assert.equal(result.recoveryIssue,'recovery_handle_close_failed');}finally{fs.openSync=open;fs.closeSync=close;}
  assert(!fs.existsSync(f.selection.lockFile));
});
test('selector cleanup errors preserve an already committed operation and never mask its original committed failure',async t=>{
  for(const mode of ['returned','thrown'])await t.test(mode,async t=>{
    const f=fixture(t),open=fs.openSync,close=fs.closeSync;let owned;
    fs.openSync=function(file,...args){const fd=open.call(fs,file,...args);if(file===f.selection.lockFile&&args[0]==='wx')owned=fd;return fd;};fs.closeSync=function(fd){const result=close.call(fs,fd);if(fd===owned){owned=undefined;throw Error('synthetic close failure');}return result;};
    try{await assert.rejects(f.selection.withStartLock(async()=>{if(mode==='thrown')throw Object.assign(Error('original committed error'),{code:'selection_changed',committed:true});return {committed:true};}),error=>error.committed===true&&error.code===(mode==='thrown'?'selection_changed':'component_lock_handle_close_failed'));}finally{fs.openSync=open;fs.closeSync=close;}
  });
});
test('an IPC close failure after guard unlink retains the committed fact',async t=>{
  const f=fixture(t);abandonedGuard(f);const preview=await f.recovery.previewGuardRecovery(),net=require('node:net'),close=net.Server.prototype.close;
  net.Server.prototype.close=function(...args){const target=this.address()===gateEndpoint(f.selection.installationId),result=close.apply(this,args);if(target)throw Error('synthetic IPC close failure');return result;};
  try{await assert.rejects(f.recovery.recoverGuard({expectedDigest:preview.digest}),error=>error.committed===true&&error.code==='recovery_gate_close_failed');}finally{net.Server.prototype.close=close;}
  assert(!fs.existsSync(f.recovery.guard));
});
test('post-unlink guard stat failure returns confirmed recovery with an unknown remaining guard, never an unchanged error',async t=>{
  const f=fixture(t);f.write();const preview=await f.recovery.preview(),unlink=fs.unlinkSync,lstat=fs.lstatSync;let committed=false;
  fs.unlinkSync=function(file){const result=unlink.call(fs,file);if(file===f.selection.lockFile)committed=true;return result;};fs.lstatSync=function(file,...args){if(committed&&file===f.recovery.guard)throw Object.assign(Error('synthetic stat failure'),{code:'EACCES'});return lstat.call(fs,file,...args);};
  try{const result=await f.recovery.recover({expectedDigest:preview.digest});assert.equal(result.recovered,true);assert.equal(result.guardRemaining,null);assert.equal(result.recoveryIssue,'recovery_guard_state_unverified');}finally{fs.unlinkSync=unlink;fs.lstatSync=lstat;}
  assert(!fs.existsSync(f.selection.lockFile));assert(fs.existsSync(f.recovery.guard));
});
test('configuration close never throws when marker existence cannot be checked after a completed write',async t=>{
  const f=fixture(t),lstat=fs.lstatSync;
  await f.selection.withStartLock(async()=>{const marker=await createConfigurationMarker({selection:f.selection,processHost:f.host});fs.lstatSync=function(file,...args){if(file===f.selection.configLock)throw Object.assign(Error('synthetic stat failure'),{code:'EIO'});return lstat.call(fs,file,...args);};try{assert.deepEqual(marker.close(),{released:false,issue:'configuration_marker_retained'});}finally{fs.lstatSync=lstat;}});
  assert(fs.existsSync(f.selection.configLock));
});
test('selector finally stat failure cannot erase an already committed callback',async t=>{
  const f=fixture(t),lstat=fs.lstatSync;let committed=false;
  fs.lstatSync=function(file,...args){if(committed&&file===f.selection.lockFile)throw Object.assign(Error('synthetic stat failure'),{code:'EIO'});return lstat.call(fs,file,...args);};
  try{await assert.rejects(f.selection.withStartLock(async()=>{committed=true;return {committed:true};}),error=>error.committed===true&&error.code==='component_lock_state_unverified');}finally{fs.lstatSync=lstat;}
  assert(fs.existsSync(f.selection.lockFile));
});
test('lightweight recovery status classifies only metadata and does not infer dead owners or reveal lock contents',async t=>{
  const f=fixture(t);abandonedConfiguration(f,{guard:true});f.host.snapshot=()=>assert.fail('status must not query processes');f.host.inspect=()=>assert.fail();
  const status=await f.selection.lockRecovery().status();assert.equal(status.nextTarget,'configuration');assert.deepEqual(status.targets.map(row=>row.state),['recorded','recorded','recorded']);assert(status.targets.every(row=>row.verification==='not-checked'));assert.doesNotMatch(JSON.stringify(status),/token|owner|pid|\.exe|componentLockDigest/);
  fs.writeFileSync(f.selection.configLock,'');assert.equal((await f.recovery.status()).targets[0].code,'configuration_proof_unavailable');
});
