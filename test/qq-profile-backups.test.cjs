'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {QQRuntimeManager}=require('../src/bot/qq-runtime.cjs');
const {QQProfileConfig,MAX_CONFIG_BYTES}=require('../src/bot/qq-profile-config.cjs');
const {QQProfileBackups,validateBackupRequest,MAX_BACKUPS,MAX_SCAN}=require('../src/bot/qq-profile-backups.cjs');
const A='12345001',B='12345002',SECRET='PRIVATE_OLD_TOKEN_123456789',NEW_SECRET='PRIVATE_NEW_TOKEN_123456789';
const hash=value=>createHash('sha256').update(value).digest('hex');
function config(token=SECRET){return {network:{websocketServers:[{name:'private-name',enable:true,host:'127.0.0.1',port:3001,token,privateOption:'PRIVATE_UNKNOWN_FIELD'}],httpServers:[],other:'PRIVATE_NETWORK'},privateTop:'PRIVATE_TOP'};}
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-backups-')),root=path.join(dir,'app'),desktopDataRoot=path.join(dir,'desktop'),configDir=path.join(desktopDataRoot,'components','NapCatQQ','config'),runtimeDir=path.dirname(configDir),qqDir=path.join(desktopDataRoot,'components','QQ');
  fs.mkdirSync(configDir,{recursive:true});fs.mkdirSync(qqDir,{recursive:true});fs.writeFileSync(path.join(qqDir,'QQ.exe'),'fixture');
  for(const name of ['NapCatWinBootMain.exe','NapCatWinBootHook.dll','napcat.mjs','qqnt.json'])fs.writeFileSync(path.join(runtimeDir,name),'fixture');
  const files={};for(const id of [A,B]){files[id]=path.join(configDir,`onebot11_${id}.json`);fs.writeFileSync(files[id],JSON.stringify(config(),null,1));}
  const state={rows:[{pid:process.pid,parentPid:1,name:'node.exe',executable:process.execPath,createdAt:'2026-11-06T01:00:00Z'}],beforeSnapshot:null,starts:0};
  const processHost={snapshot:async()=>{await state.beforeSnapshot?.();return state.rows;},inspect:async pids=>state.rows.filter(p=>pids.includes(p.pid)),start:async()=>{state.starts++;throw Error('must not start');}};
  const runtime=new QQRuntimeManager({root,desktopDataRoot,lockRoot:path.join(dir,'locks'),platform:'win32',processHost});
  const profiles=new QQProfileConfig({runtime,checkPort:async p=>p||51000}),backups=new QQProfileBackups({profiles});
  const writeBackup=(id,bytes,at=Date.now())=>{fs.mkdirSync(profiles.backupRoot,{recursive:true});const name=`${hash(id)}-${at}-${randomUUID()}.json`;fs.writeFileSync(path.join(profiles.backupRoot,name),bytes);return name;};
  t.after(()=>{assert(fs.realpathSync(dir).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,root,files,state,runtimeDir,runtime,profiles,backups,writeBackup};
}
function selection(f,id=A){const row=f.backups.list(id).backups.find(x=>x.valid);return f.backups.preview(id,{backupId:row.id,sha256:row.sha256});}

test('existing editor backups list and preview without exposing credentials, arbitrary fields, names or paths',async t=>{
  const f=fixture(t),original=fs.readFileSync(f.files[A]);await f.profiles.configure(A,{port:3101});
  const list=f.backups.list(A);assert.equal(list.backups.length,1);assert.equal(list.backups[0].sha256,hash(original));assert.equal(list.backups[0].size,original.length);
  const preview=selection(f);assert.equal(preview.onlineIdentityVerified,false);assert.equal(preview.changes.credentialsMayChange,false);assert.deepEqual(preview.changes.groups[0].rows[0].changedFields,['port','messagePostFormat','reportSelfMessage','enableForcePushEvent','debug','heartInterval']);
  assert.doesNotMatch(JSON.stringify({list,preview}),/PRIVATE_|private-name|privateTop|privateOption|privateNetwork|onebot11_|[A-Z]:\\/);assert.equal(f.state.starts,0);
});

test('restore preserves original bytes, BOM, whitespace, unknown fields and the chosen token; current bytes get a separate backup',async t=>{
  const f=fixture(t),original=Buffer.from('\uFEFF'+JSON.stringify(config(),null,'\t')+'\r\n'),current=Buffer.from(JSON.stringify(config(NEW_SECRET))+'\n');
  f.writeBackup(A,original);fs.writeFileSync(f.files[A],current);const preview=selection(f),b=fs.readFileSync(f.files[B]);
  assert.equal(preview.changes.credentialsMayChange,true);const result=await f.backups.restore(A,preview);
  assert.equal(result.restored,true);assert.equal(result.sha256,hash(original));assert.equal(result.credentialsMayChange,true);assert.equal(result.companionCredentialsUpdated,false);assert.equal(result.onlineIdentityVerified,false);
  assert(fs.readFileSync(f.files[A]).equals(original));assert(fs.readFileSync(f.files[B]).equals(b));assert(fs.readFileSync(path.join(f.profiles.backupRoot,result.preservedBackupId)).equals(current));
  assert(fs.readFileSync(path.join(f.profiles.backupRoot,preview.backupId)).equals(original));assert.equal(f.backups.list(A).backups.length,2);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);assert.equal(f.state.starts,0);
});

test('a damaged current JSON file can be repaired but is preserved as exact private bytes first',async t=>{
  const f=fixture(t);f.writeBackup(A,JSON.stringify(config()));const broken=Buffer.from('PRIVATE_BROKEN {');fs.writeFileSync(f.files[A],broken);
  const preview=selection(f);assert.equal(preview.changes.currentValid,false);const result=await f.backups.restore(A,preview);assert(fs.readFileSync(path.join(f.profiles.backupRoot,result.preservedBackupId)).equals(broken));assert.deepEqual(JSON.parse(fs.readFileSync(f.files[A])),config());
});

test('selection and both SHA values are mandatory; cross-account and path-shaped selections cannot restore',async t=>{
  const f=fixture(t);f.writeBackup(A,JSON.stringify(config()));const preview=selection(f),before=fs.readFileSync(f.files[B]);
  await assert.rejects(f.backups.restore(A),{code:'backup_selection_required'});await assert.rejects(f.backups.restore(A,{backupId:preview.backupId}),{code:'backup_selection_required'});
  await assert.rejects(f.backups.restore(B,preview),{code:'backup_invalid'});assert.equal(f.backups.list(B).backups.length,0);assert(fs.readFileSync(f.files[B]).equals(before));
  for(const backupId of ['../'+preview.backupId,'..\\'+preview.backupId,path.join(f.profiles.backupRoot,preview.backupId),preview.backupId+':secret'])assert.throws(()=>f.backups.preview(A,{...preview,backupId}),{code:'backup_invalid'});
  assert.throws(()=>f.backups.list('../12345'),{code:'invalid_account'});
});

test('modified source or current bytes require a new preview and never overwrite newer configuration',async t=>{
  const f=fixture(t);f.writeBackup(A,JSON.stringify(config()));const preview=selection(f),file=path.join(f.profiles.backupRoot,preview.backupId);
  fs.writeFileSync(file,JSON.stringify(config(NEW_SECRET)));await assert.rejects(f.backups.restore(A,preview),{code:'backup_changed'});
  const next=selection(f);fs.appendFileSync(f.files[A],' ');const changed=fs.readFileSync(f.files[A]);await assert.rejects(f.backups.restore(A,next),{code:'config_changed'});assert(fs.readFileSync(f.files[A]).equals(changed));assert.equal(f.backups.list(A).backups.length,1);
});

test('Desktop, external account runtime and existing owned runtime block restore using the production configuration lock',async t=>{
  const f=fixture(t);f.writeBackup(A,JSON.stringify(config()));const preview=selection(f),before=fs.readFileSync(f.files[A]);
  f.state.rows.push({pid:900001,parentPid:1,name:'NapCatQQ-Desktop.exe',executable:path.join(f.dir,'NapCatQQ-Desktop.exe'),createdAt:'2026-11-06T01:00:01Z'});await assert.rejects(f.backups.restore(A,preview),{code:'desktop_running'});
  f.state.rows.pop();f.state.rows.push({pid:900002,parentPid:1,name:'NapCatWinBootMain.exe',executable:path.join(f.runtimeDir,'NapCatWinBootMain.exe'),accountId:A,createdAt:'2026-11-06T01:00:02Z'});await assert.rejects(f.backups.restore(A,preview),{code:'external_process'});
  f.state.rows.pop();f.runtime.runs.set(A,{});await assert.rejects(f.backups.restore(A,preview),{code:'runtime_running'});f.runtime.runs.delete(A);assert(fs.readFileSync(f.files[A]).equals(before));assert.equal(f.backups.list(A).backups.length,1);
});

test('a manager appearing after the current-byte backup aborts replacement without removing either backup',async t=>{
  const f=fixture(t);f.writeBackup(A,JSON.stringify(config(NEW_SECRET)));const preview=selection(f),before=fs.readFileSync(f.files[A]);let appeared=false;
  f.state.beforeSnapshot=()=>{if(!appeared&&f.backups.list(A).backups.length===2){appeared=true;f.state.rows.push({pid:900001,parentPid:1,name:'NapCatQQ-Desktop.exe',executable:path.join(f.dir,'NapCatQQ-Desktop.exe'),createdAt:'2026-11-06T01:00:01Z'});}};
  await assert.rejects(f.backups.restore(A,preview),{code:'desktop_running'});assert(fs.readFileSync(f.files[A]).equals(before));assert.equal(f.backups.list(A).backups.length,2);
});

test('a second editor cannot enter while restoration holds the same installation configuration lock',async t=>{
  const f=fixture(t);f.writeBackup(A,JSON.stringify(config()));const preview=selection(f);let concurrent;
  const preserve=f.backups._preserve.bind(f.backups);f.backups._preserve=(id,bytes)=>{concurrent=f.profiles.configure(B,{port:3202});return preserve(id,bytes);};
  await f.backups.restore(A,preview);await assert.rejects(concurrent,{code:'operation_in_progress'});assert.equal(JSON.parse(fs.readFileSync(f.files[B])).network.websocketServers[0].port,3001);
});

test('malformed, invalid UTF-8, excessive depth and oversized backups are ineligible and do not leak contents',async t=>{
  const f=fixture(t);const values=['PRIVATE_BROKEN {',Buffer.from([0x7b,0x22,0xff,0x22,0x3a,0x31,0x7d]),JSON.stringify({network:{websocketServers:Array(65).fill({})}}),' '.repeat(MAX_CONFIG_BYTES+1),'{"unknown":'+ '['.repeat(70)+'0'+']'.repeat(70)+'}'];
  for(const value of values){const id=f.writeBackup(A,value);const row=f.backups.list(A).backups.find(r=>r.id===id);assert.equal(row.valid,false);assert.throws(()=>f.backups.preview(A,{backupId:id,sha256:hash(value)}),{code:'backup_invalid'});}
  assert.doesNotMatch(JSON.stringify(f.backups.list(A)),/PRIVATE/);
});

test('linked backup files and linked backup directories are rejected',async t=>{
  const f=fixture(t),id=f.writeBackup(A,JSON.stringify(config())),file=path.join(f.profiles.backupRoot,id),alias=path.join(f.dir,'hard-link.json');fs.linkSync(file,alias);
  assert.equal(f.backups.list(A).backups[0].valid,false);assert.throws(()=>f.backups.preview(A,{backupId:id,sha256:hash(JSON.stringify(config()))}),{code:'backup_invalid'});fs.unlinkSync(alias);
  const linked=path.join(f.dir,'linked-backups');fs.symlinkSync(f.profiles.backupRoot,linked,process.platform==='win32'?'junction':'dir');const unsafe=new QQProfileBackups({profiles:{runtime:f.runtime,backupRoot:linked}});assert.throws(()=>unsafe.list(A),{code:'backup_directory_unsafe'});
});

test('list has bounded read/scan counts and never prunes source backups',t=>{
  const f=fixture(t);for(let n=0;n<MAX_BACKUPS+3;n++)f.writeBackup(A,'{}',1762300000000+n);let list=f.backups.list(A,{limit:MAX_BACKUPS+99});assert.equal(list.backups.length,MAX_BACKUPS);assert(list.hasMore);assert.equal(list.backups[0].createdAt,1762300000102);
  for(let n=0;n<MAX_SCAN;n++)fs.writeFileSync(path.join(f.profiles.backupRoot,`unrelated-${n}.txt`),'');list=f.backups.list(A);assert(list.scanLimited);assert(list.hasMore);assert.equal(fs.readdirSync(f.profiles.backupRoot).length,MAX_BACKUPS+3+MAX_SCAN);
});

test('current linked files and unsafe preservation destination abort without replacing bytes',async t=>{
  const f=fixture(t);f.writeBackup(A,JSON.stringify(config(NEW_SECRET)));const preview=selection(f),current=fs.readFileSync(f.files[A]),alias=path.join(f.dir,'current-hard-link.json');fs.linkSync(f.files[A],alias);
  await assert.rejects(f.backups.restore(A,preview),{code:'config_invalid'});fs.unlinkSync(alias);
  const preserve=f.backups._preserve.bind(f.backups);f.backups._preserve=()=>{throw Object.assign(new Error('fixture failure'),{code:'backup_failed'});};await assert.rejects(f.backups.restore(A,preview),{code:'backup_failed'});assert(fs.readFileSync(f.files[A]).equals(current));f.backups._preserve=preserve;
});

test('strict IPC input accepts only a bounded account-bound selection and no caller filesystem path',t=>{
  const f=fixture(t);f.writeBackup(A,'{}');const p=selection(f),base={accountId:A,backupId:p.backupId,sha256:p.sha256,currentSha256:p.currentSha256};
  assert.deepEqual(validateBackupRequest('restore',base),base);
  for(const value of [null,[],{...base,path:'private'},{...base,currentSha256:'0'.repeat(63)},{...base,sha256:'X'.repeat(64)},{...base,accountId:'00001'}])assert.throws(()=>validateBackupRequest('restore',value));
  for(const limit of [0,101,1.1,'30'])assert.throws(()=>validateBackupRequest('list',{accountId:A,limit}),{code:'invalid_config'});
  assert.throws(()=>validateBackupRequest('preview',base),{code:'invalid_config'});
});

test('closing or changing manager context before commit aborts restore; stale selected backup is rechecked after preservation',async t=>{
  const f=fixture(t);f.writeBackup(A,JSON.stringify(config(NEW_SECRET)));const p=selection(f),before=fs.readFileSync(f.files[A]);let checks=0;
  f.backups.assertCurrent=()=>{if(++checks===3)throw Object.assign(Error('Closed'),{code:'changed'});};await assert.rejects(f.backups.restore(A,p),{code:'changed'});assert(fs.readFileSync(f.files[A]).equals(before));
  f.backups.assertCurrent=()=>{};let calls=0;f.state.beforeSnapshot=()=>{if(++calls===4)fs.appendFileSync(path.join(f.profiles.backupRoot,p.backupId),' ');};await assert.rejects(f.backups.restore(A,p),{code:'backup_changed'});assert(fs.readFileSync(f.files[A]).equals(before));
});

test('an external edit during temporary-file sync survives and restoration refuses the stale current SHA',async t=>{
  const f=fixture(t);f.writeBackup(A,JSON.stringify(config(NEW_SECRET)));const p=selection(f),before=fs.readFileSync(f.files[A]),external=Buffer.from(JSON.stringify({...config(),externalChange:true}));
  const original=fs.fsyncSync;let edited=false;
  fs.fsyncSync=fd=>{original(fd);if(!edited&&fs.readdirSync(path.dirname(f.files[A])).some(name=>name.endsWith('.restore-tmp'))){edited=true;fs.writeFileSync(f.files[A],external);}};
  try{await assert.rejects(f.backups.restore(A,p),{code:'config_changed'});}finally{fs.fsyncSync=original;}
  assert(edited);assert(fs.readFileSync(f.files[A]).equals(external));assert(fs.readFileSync(path.join(f.profiles.backupRoot,p.backupId)).equals(Buffer.from(JSON.stringify(config(NEW_SECRET)))));
  assert(f.backups.list(A).backups.some(row=>row.sha256===hash(before)));assert(!fs.readdirSync(path.dirname(f.files[A])).some(name=>name.endsWith('.restore-tmp')));
});

test('unrecognized client, plugin and server fields conservatively flag possible credential changes without exporting values',t=>{
  const f=fixture(t);
  for(const mutate of [value=>{value.network.websocketClients=[{token:'PRIVATE_REVERSE_TOKEN'}];},value=>{value.plugin={password:'PRIVATE_PLUGIN_PASSWORD'};},value=>{value.network.websocketServers[0].auth={password:'PRIVATE_SERVER_PASSWORD'};}]){
    const value=config();mutate(value);const id=f.writeBackup(A,JSON.stringify(value));const p=f.backups.preview(A,{backupId:id,sha256:hash(JSON.stringify(value))});assert.equal(p.changes.credentialsMayChange,true);assert.doesNotMatch(JSON.stringify(p),/PRIVATE_|password|websocketClients|plugin/);
  }
});
