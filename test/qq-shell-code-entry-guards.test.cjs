'use strict';
// Temporary NTFS and actual OS-held gates; program/signature/process inputs are
// synthetic. No QQ executable, user installation or external account is used.
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');
const {withShellCodeGate,shellCodeRoot}=require('../src/bot/qq-shell-code-gate.cjs');
const {QQManagedShellSetup,readManagedShellInstallation,RELEASE_ID}=require('../src/bot/qq-managed-setup.cjs');
const {QQComponentSelection,REQUIRED}=require('../src/bot/qq-component-selection.cjs');
const {QQComponentPrepared}=require('../src/bot/qq-component-prepared.cjs');
const {QQPreparationRecovery}=require('../src/bot/qq-component-preparation-recovery.cjs');
const M=require('../src/bot/qq-managed-shell-repair-metadata.cjs');
const sha=v=>createHash('sha256').update(v).digest('hex');
function fixture(t){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-shell-entry-gate-')),root=path.join(temp,'store'),code=shellCodeRoot(root),preparedRoot=path.dirname(path.dirname(code)),lockRoot=path.join(temp,'locks'),qqExe=path.join(temp,'program','QQ.exe');
 fs.mkdirSync(path.join(code,'static'),{recursive:true});fs.mkdirSync(path.dirname(qqExe));const pe=Buffer.alloc(2048);pe.write('MZ');pe.writeUInt32LE(128,60);pe.writeUInt32LE(0x4550,128);pe.writeUInt16LE(0x8664,132);pe.writeUInt16LE(0x20b,152);fs.writeFileSync(qqExe,pe);
 for(const name of [...REQUIRED,'static/index.html'])fs.writeFileSync(path.join(code,name),'synthetic '+name);
 const files=[...REQUIRED,'static/index.html'].sort().map(name=>{const b=fs.readFileSync(path.join(code,name));return {path:name,size:b.length,sha256:sha(b)};}),manifestPath=path.join(path.dirname(code),'prepared.json');
 fs.writeFileSync(manifestPath,JSON.stringify({schema:'qq_component_prepared_v1',component:'napcat-shell',versionId:RELEASE_ID,version:'4.18.42',files})+'\n');
 const own={pid:process.pid,parentPid:1,createdAt:'2026-01-01T00:00:00.0000000Z',name:'synthetic app',executable:process.execPath};
 let onPrepared=()=>{},reads=0;const processHost={snapshot:async()=>[own],inspect:async ids=>ids.includes(own.pid)?[own]:[]};
 const prepared={resolvePrepared:async id=>{assert.equal(id,RELEASE_ID);reads++;await onPrepared();return {versionId:id,version:'4.18.42',codeRoot:code,manifestPath,manifestSha256:sha(fs.readFileSync(manifestPath)),files};}};
 const setup=new QQManagedShellSetup({root,prepared,processHost,programObserver:async()=>({version:'9.9.36.53644',productName:'QQ',companyName:'Tencent',signature:{status:'Valid',subject:'CN=Tencent Technology (Shenzhen) Company Limited',thumbprint:'a'.repeat(40)}})});
 const pending=()=>{const p=M.paths(root);fs.mkdirSync(p.recoveryRoot,{recursive:true});fs.writeFileSync(p.pending,'Unknown pending intent; preserve bytes.');return p.pending;};
 const initialize=async()=>setup.initialize({ticketId:(await setup.inspect({qqExe})).ticketId});
 const managed=async()=>{const result=await initialize(),read=()=>readManagedShellInstallation({root,setupId:result.setupId});return new QQComponentSelection({componentsRoot:read().installationRoot,lockRoot,preparedRoot,prepared,processHost,qqExe,managedInstallation:read});};
 const legacy=()=>{const componentsRoot=path.join(temp,'legacy'),workDir=path.join(componentsRoot,'NapCatQQ'),exe=path.join(componentsRoot,'QQ','QQ.exe');fs.mkdirSync(path.join(workDir,'config'),{recursive:true});fs.mkdirSync(path.dirname(exe));fs.copyFileSync(qqExe,exe);for(const n of REQUIRED)fs.writeFileSync(path.join(workDir,n),'legacy '+n);return new QQComponentSelection({componentsRoot,lockRoot,preparedRoot,prepared,processHost,qqExe:exe});};
 t.after(()=>{const actual=fs.realpathSync(temp),parent=fs.realpathSync(os.tmpdir());assert(actual.toLowerCase().startsWith(parent.toLowerCase()+path.sep));fs.rmSync(actual,{recursive:true,force:true});});
 return {root,code,preparedRoot,lockRoot,qqExe,setup,prepared,pending,initialize,managed,legacy,processHost,set onPrepared(fn){onPrepared=fn;},get reads(){return reads;}};
}

test('shared repair gate blocks managed setup before publication and releases for explicit retry',async t=>{
 const f=fixture(t);await withShellCodeGate({root:f.root},async()=>{await assert.rejects(f.initialize(),{code:'shell_repair_busy'});assert.equal(f.reads,0);assert(!fs.existsSync(path.join(f.root,'qq-installations')));});
 let checked=false;f.onPrepared=async()=>{await assert.rejects(withShellCodeGate({root:f.root},()=>assert.fail('repair entered setup')),{code:'shell_repair_busy'});checked=true;};
 assert.equal((await f.initialize()).committed,true);assert(checked);
});

test('pending intent refuses normal managed discovery/start but preserves owner metadata for stop/recovery',async t=>{
 const f=fixture(t),s=await f.managed(),marker=f.pending(),before=fs.readFileSync(marker);
 for(const action of [()=>s.resolve(),()=>s.withStartLock(()=>assert.fail('started'))])await assert.rejects(action(),{code:'shell_repair_recovery_required'});
 assert.throws(()=>s.layout(),{code:'shell_repair_recovery_required'});assert.throws(()=>s.status(),{code:'shell_repair_recovery_required'});
 assert.equal(s.shellOwnerContext().current.versionId,RELEASE_ID);assert.equal(s.pendingUpdateRecoveryContext().current.versionId,RELEASE_ID);assert.deepEqual(fs.readFileSync(marker),before);
 fs.unlinkSync(marker);await s.withStartLock((_plan,held)=>held());
});

test('start callback retains the code gate and cannot bless a late pending marker',async t=>{
 const f=fixture(t),s=await f.managed();let marker;
 await assert.rejects(s.withStartLock(async(_plan,held)=>{await assert.rejects(withShellCodeGate({root:f.root},()=>assert.fail('repair during start')),{code:'shell_repair_busy'});marker=f.pending();held();}),{code:'shell_repair_recovery_required'});
 assert(fs.existsSync(marker));assert(!fs.existsSync(s.lockFile));fs.unlinkSync(marker);await s.withStartLock(()=>true);
});

test('legacy original remains independent, while activation/start/rollback of the shared fixed code are guarded',async t=>{
 const f=fixture(t),s=f.legacy(),preview=await s.preview(),marker=f.pending();
 await withShellCodeGate({root:f.root},async()=>{await s.withStartLock(plan=>assert.equal(plan.kind,'original'));await assert.rejects(s.activate({versionId:RELEASE_ID,expectedDigest:preview.digest}),{code:'shell_repair_busy'});});
 await assert.rejects(s.activate({versionId:RELEASE_ID,expectedDigest:preview.digest}),{code:'shell_repair_recovery_required'});assert(!fs.existsSync(s.stateFile));fs.unlinkSync(marker);
 const active=await s.activate({versionId:RELEASE_ID,expectedDigest:preview.digest});
 await withShellCodeGate({root:f.root},async()=>{await assert.rejects(s.withStartLock(()=>assert.fail('started fixed code')),{code:'shell_repair_busy'});await assert.rejects(s.rollback({expectedDigest:active.digest}),{code:'shell_repair_busy'});});
 const bytes=fs.readFileSync(s.stateFile);f.pending();await assert.rejects(s.rollback({expectedDigest:active.digest}),{code:'shell_repair_recovery_required'});assert.deepEqual(fs.readFileSync(s.stateFile),bytes);fs.unlinkSync(marker);assert.equal((await s.rollback({expectedDigest:active.digest})).current.kind,'original');
});

test('prepare and nested preparation writer share the same gate and pending check before any extraction',async t=>{
 const f=fixture(t);let verifies=0;const packages={component:'napcat-shell',verify:async()=>{verifies++;throw Error('Should not reach archive');}},p=new QQComponentPrepared({root:f.root,packages,processHost:f.processHost});
 const source={tag:'v4.18.42',assetId:1,size:12,sha256:'02e5ff0f79916c1e'+'1'.repeat(48)},args={versionId:RELEASE_ID,version:'4.18.42',source};
 await withShellCodeGate({root:f.root},async gate=>{await assert.rejects(p.prepare(),{code:'shell_repair_busy'});await assert.rejects(p.preparationRecovery.runWriter(args,()=>assert.fail('writer entered')),{code:'shell_repair_busy'});assert.equal(await p.preparationRecovery.runWriter({...args,gate},()=>({synthetic:true})).then(v=>v.synthetic),true);});
 f.pending();await assert.rejects(p.prepare(),{code:'shell_repair_recovery_required'});await assert.rejects(p.preparationRecovery.runWriter(args,()=>assert.fail('writer entered pending')),{code:'shell_repair_recovery_required'});assert.equal(verifies,0);
});

test('interrupted preparation preview and confirmation do not bypass repair pending/gate',async t=>{
 const f=fixture(t),source={tag:'v4.18.42',assetId:1,size:4,sha256:sha('partial')},versionId='napcat-shell-4.18.42-'+source.sha256.slice(0,16),versionDir=path.join(f.preparedRoot,versionId);let alive=true;
 const own={pid:process.pid,createdAt:'2026-01-01T00:00:00.0000000Z',executable:process.execPath};
 const r=new QQPreparationRecovery({root:f.root,lockRoot:f.lockRoot,packages:{verify:async()=>assert.fail('no download')},processHost:{inspect:async()=>alive?[own]:[]}});
 await assert.rejects(r.runWriter({versionId,version:'4.18.42',source},writer=>{fs.mkdirSync(versionDir);writer.allocated(versionDir,{files:[{path:'partial.txt',size:4}],directories:[]});fs.mkdirSync(path.join(versionDir,'code'));fs.writeFileSync(path.join(versionDir,'code','partial.txt'),'keep');throw Error('synthetic interruption');}),/synthetic interruption/);alive=false;
 const preparationId=fs.readdirSync(r.records)[0].slice(0,-5),marker=f.pending();await assert.rejects(r.preview({preparationId}),{code:'shell_repair_recovery_required'});fs.unlinkSync(marker);
 const preview=await r.preview({preparationId});await withShellCodeGate({root:f.root},async()=>{await assert.rejects(r.recover({ticketId:preview.ticketId,expectedDigest:preview.expectedDigest}),{code:'shell_repair_busy'});});assert.equal(fs.readFileSync(path.join(versionDir,'code','partial.txt'),'utf8'),'keep');
 const fresh=await r.preview({preparationId}),result=await r.recover({ticketId:fresh.ticketId,expectedDigest:fresh.expectedDigest});assert.equal(result.recovered,true);assert.equal(fs.readFileSync(path.join(r.quarantine,result.quarantineId,'code','partial.txt'),'utf8'),'keep');
});
