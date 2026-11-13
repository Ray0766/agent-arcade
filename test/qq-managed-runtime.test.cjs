'use strict';
// Synthetic files and process tables only. No QQ, account data or model access.
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createHash,randomUUID}=require('node:crypto');
const {QQComponentSelection,REQUIRED}=require('../src/bot/qq-component-selection.cjs');
const {QQRuntimeManager}=require('../src/bot/qq-runtime.cjs');
const {QQManagedLayout}=require('../src/bot/qq-managed-layout.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
const A='napcat-shell-4.18.42-02e5ff0f79916c1e',B='napcat-shell-4.18.42-2222222222222222',ACCOUNT='12345001';
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-managed-draft-')),root=path.join(base,'private'),setupId=randomUUID(),installationRoot=path.join(root,'qq-installations',setupId),workDir=path.join(installationRoot,'work'),configDir=path.join(workDir,'config'),qqDataDir=path.join(installationRoot,'qq-data'),qqExe=path.join(base,'independent-existing-program','QQ.exe'),lockRoot=path.join(base,'locks'),preparedRoot=path.join(root,'qq-component-versions','napcat-shell');
  for(const dir of [configDir,qqDataDir,path.dirname(qqExe),preparedRoot])fs.mkdirSync(dir,{recursive:true});
  const program=Buffer.alloc(512,0);program.write('SYNTHETIC_NOT_EXECUTABLE');fs.writeFileSync(qqExe,program);
  fs.writeFileSync(path.join(configDir,`onebot11_${ACCOUNT}.json`),'ORIGINAL_CONFIG');
  const descriptors=new Map();for(const id of [A,B]){const folder=path.join(preparedRoot,id),codeRoot=path.join(folder,'code');fs.mkdirSync(path.join(codeRoot,'static'),{recursive:true});for(const file of [...REQUIRED,'static/index.html'])fs.writeFileSync(path.join(codeRoot,file),`SYNTHETIC ${id} ${file}`);const files=[...REQUIRED,'static/index.html'].sort().map(file=>{const bytes=fs.readFileSync(path.join(codeRoot,file));return{path:file,size:bytes.length,sha256:hash(bytes)};});const manifest={schema:'qq_component_prepared_v1',component:'napcat-shell',version:'4.18.42',versionId:id,files},manifestPath=path.join(folder,'prepared.json'),bytes=Buffer.from(JSON.stringify(manifest));fs.writeFileSync(manifestPath,bytes);descriptors.set(id,{version:'4.18.42',versionId:id,codeRoot,manifestPath,manifestSha256:hash(bytes),files});}
  const prepared={resolvePrepared:async id=>structuredClone(descriptors.get(id))};
  const state={descriptor:{schema:'qq_managed_shell_v1',engine:'managed-shell',dataPolicy:'isolated-new',setupId,installationId:hash(installationRoot.toLowerCase()),installationRoot,workDir,configDir,qqDataDir,descriptorSha256:'1'.repeat(64),qq:{file:qqExe,size:512,sha256:hash(program),version:'9.9.36-53644'},current:{kind:'prepared',version:'4.18.42',versionId:A,manifestSha256:descriptors.get(A).manifestSha256},previous:null},rows:[{pid:process.pid,parentPid:1,name:'test.exe',executable:process.execPath,createdAt:'2026-11-06T00:00:00.0000000Z'}],starts:[],stops:[],next:900000};
  const descriptorPath=path.join(installationRoot,'installation.json');fs.writeFileSync(descriptorPath,JSON.stringify(state.descriptor));state.descriptor.descriptorSha256=hash(fs.readFileSync(descriptorPath));
  const read=()=>structuredClone(state.descriptor),host={snapshot:async()=>structuredClone(state.rows),inspect:async ids=>structuredClone(state.rows.filter(row=>ids.includes(row.pid))),allocatePort:async()=>53009,start:async plan=>{state.starts.push(plan);const pid=state.next++;state.rows.push({pid,parentPid:process.pid,name:'NapCatWinBootMain.exe',executable:plan.file,createdAt:'2026-11-06T01:00:00.0000000Z',accountId:plan.args.at(-1)},{pid:state.next++,parentPid:pid,name:'QQ.exe',executable:plan.args[0],createdAt:'2026-11-06T01:00:00.1000000Z'});return{pid};},stop:async proofs=>{state.stops.push(proofs);state.rows=state.rows.filter(row=>!proofs.some(proof=>proof.pid===row.pid));}};
  const options={componentsRoot:installationRoot,lockRoot,preparedRoot,prepared,processHost:host,qqExe,managedInstallation:read};
  const selection=new QQComponentSelection(options),runtimeOptions={root:path.join(base,'business'),lockRoot,componentStoreRoot:root,platform:'win32',processHost:host,managedInstallation:read,componentSelectionFactory:opts=>new QQComponentSelection({...opts,prepared})};
  const runtime=new QQRuntimeManager(runtimeOptions);
  t.after(()=>{const resolved=fs.realpathSync(base),temp=fs.realpathSync(os.tmpdir());assert(resolved.toLowerCase().startsWith(temp.toLowerCase()+path.sep));fs.rmSync(base,{recursive:true,force:true});});
  return{base,root,setupId,installationRoot,workDir,configDir,qqDataDir,qqExe,lockRoot,preparedRoot,state,read,host,prepared,descriptors,options,selection,runtimeOptions,runtime};
}
test('initial selection is prepared with no original baseline; discovery does not write or start',async t=>{
  const f=fixture(t),status=f.selection.status();assert.equal(status.current.kind,'prepared');assert.equal(status.current.versionId,A);assert.equal(status.previous,null);assert.equal(status.canRollback,false);assert.equal(status.current.verification,'not-checked');assert(!fs.existsSync(f.selection.stateFile));assert(!fs.existsSync(path.join(f.workDir,'napcat.mjs')));
  const layout=await f.selection.resolve();assert.equal(layout.codeRoot,f.descriptors.get(A).codeRoot);assert.equal(layout.qqDataDir,f.qqDataDir);const discovered=await f.runtime.discover();assert.equal(discovered.configured,true);assert.equal(discovered.desktopDataRoot,null);assert.equal(discovered.installationKind,'managed-shell');assert.equal(discovered.components.selectionKind,'prepared');assert.equal(discovered.components.qqVersionSource,'verified-setup-metadata');assert.deepEqual(discovered.instances.map(row=>row.accountId),[ACCOUNT]);assert.equal(f.state.starts.length,0);assert(!fs.existsSync(f.lockRoot));assert(!fs.existsSync(f.runtimeOptions.root));await assert.rejects(f.selection.preview({operation:'rollback'}),{code:'rollback_unavailable'});
});
test('managed start emits isolated data override and stable cwd only after explicit start',async t=>{
  const f=fixture(t);await f.runtime.start(ACCOUNT);assert.equal(f.state.starts.length,1);const plan=f.state.starts[0];assert.equal(plan.cwd,f.workDir);assert.equal(plan.env.NAPCAT_WORKDIR,f.workDir);assert.equal(plan.env.NAPCAT_QQ_DATA_DIR,f.qqDataDir);assert.equal(plan.args[0],f.qqExe);assert.equal(plan.file,path.join(f.descriptors.get(A).codeRoot,'NapCatWinBootMain.exe'));assert.equal(fs.readFileSync(path.join(f.configDir,`onebot11_${ACCOUNT}.json`),'utf8'),'ORIGINAL_CONFIG');assert.equal(fs.readdirSync(f.qqDataDir).length,0);await f.runtime.stop(ACCOUNT);assert.equal(f.state.stops.length,1);
});
test('external QQ using the exact referenced executable still blocks start and selection changes',async t=>{
  const f=fixture(t);f.state.rows.push({pid:999001,parentPid:1,name:'QQ.exe',executable:f.qqExe,createdAt:'2026-11-06T00:30:00Z'});await assert.rejects(f.runtime.start(ACCOUNT),{code:'external_qq_unknown'});const before=await f.selection.preview({versionId:B});await assert.rejects(f.selection.activate({versionId:B,expectedDigest:before.digest}),{code:'runtime_running'});assert.equal(f.state.starts.length,0);assert.equal(f.state.stops.length,0);
});
test('a changed QQ executable is not silently repinned on first startup or a fresh manager',async t=>{
  const f=fixture(t);fs.writeFileSync(f.qqExe,Buffer.alloc(512,42));for(const instance of [f.selection,new QQComponentSelection(f.options)])await assert.rejects(instance.withStartLock(()=>assert.fail()),{code:'qq_component_changed'});assert.equal(f.state.starts.length,0);
});
test('same-version switch can return to the initial prepared version but never original',async t=>{
  const f=fixture(t),before=await f.selection.preview({versionId:B}),next=await f.selection.activate({versionId:B,expectedDigest:before.digest});assert.equal(next.previous.kind,'prepared');assert.equal(next.previous.versionId,A);const after=await f.selection.rollback({expectedDigest:next.digest});assert.equal(after.current.versionId,A);assert.equal(after.previous.versionId,B);const stored=JSON.parse(fs.readFileSync(f.selection.stateFile,'utf8'));stored.current={kind:'original',version:'4.18.42',files:REQUIRED.map(name=>({path:name,size:1,sha256:'1'.repeat(64)}))};fs.writeFileSync(f.selection.stateFile,JSON.stringify(stored));assert.throws(()=>f.selection.status(),{code:'selection_invalid'});
});
test('managed descriptor changes invalidate cached runtime and selector instead of falling back',async t=>{
  const f=fixture(t);f.state.descriptor.descriptorSha256='2'.repeat(64);assert.throws(()=>f.selection.layout(),{code:'managed_installation_changed'});const view=await f.runtime.discover();assert.equal(view.configured,false);assert.equal(view.issue,'managed_installation_changed');assert.deepEqual(view.instances,[]);assert.equal(f.state.starts.length,0);
});
test('managed paths cannot escape, use linked data directories, or be accidentally enabled for legacy',async t=>{
  for(const kind of ['data-path','root','junction'])await t.test(kind,async t=>{const f=fixture(t);if(kind==='data-path')f.state.descriptor.qqDataDir=f.workDir;if(kind==='root')f.state.descriptor.installationId='f'.repeat(64);if(kind==='junction'){const outside=path.join(f.base,'elsewhere');fs.mkdirSync(outside);fs.rmdirSync(f.qqDataDir);fs.symlinkSync(outside,f.qqDataDir,'junction');}assert.throws(()=>new QQManagedLayout({read:f.read}),error=>['invalid_installation','unsafe_path'].includes(error.code));});
  const f=fixture(t);assert.throws(()=>new QQComponentSelection({...f.options,managedInstallation:undefined}),{code:'invalid_installation'});
});
test('pending upstream update and altered prepared code retain the existing fail-closed boundary',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.configDir,'napcat-update.json'),'DO_NOT_PARSE');await assert.rejects(f.selection.withStartLock(()=>assert.fail()),{code:'pending_upstream_update'});fs.unlinkSync(path.join(f.configDir,'napcat-update.json'));fs.appendFileSync(path.join(f.descriptors.get(A).codeRoot,'static/index.html'),'changed');await assert.rejects(f.selection.withStartLock(()=>assert.fail()),{code:'component_changed'});assert.equal(f.state.starts.length,0);
});
test('initializer descriptor feeds runtime and the existing account-config writer without fake original files',async t=>{
  const f=fixture(t),{QQManagedShellSetup,readManagedShellInstallation}=require('../src/bot/qq-managed-setup.cjs'),{QQProfileConfig}=require('../src/bot/qq-profile-config.cjs');
  const pe=Buffer.alloc(2048);pe.write('MZ');pe.writeUInt32LE(128,60);pe.writeUInt32LE(0x4550,128);pe.writeUInt16LE(0x8664,132);pe.writeUInt16LE(0x20b,152);fs.writeFileSync(f.qqExe,pe);
  const setup=new QQManagedShellSetup({root:f.root,prepared:f.prepared,processHost:f.host,programObserver:async()=>({version:'9.9.36.53644',productName:'QQ',companyName:'Tencent',signature:{status:'Valid',subject:'CN=Tencent Technology',thumbprint:'a'.repeat(40)}})});
  const ticket=await setup.inspect({qqExe:f.qqExe}),receipt=await setup.initialize({ticketId:ticket.ticketId,versionId:A});assert.equal(receipt.committed,true);
  const read=()=>readManagedShellInstallation({root:f.root,setupId:receipt.setupId}),runtime=new QQRuntimeManager({...f.runtimeOptions,root:path.join(f.base,'fresh-business'),managedInstallation:read});
  let view=await runtime.discover();assert.equal(view.configured,true);assert.deepEqual(view.instances,[]);assert.equal(runtime.componentSelection().status().previous,null);assert.equal(f.state.starts.length,0);
  const profiles=new QQProfileConfig({runtime,backupRoot:path.join(f.base,'fresh-backups'),checkPort:async port=>port||53221});
  const configured=await profiles.configure(ACCOUNT,{create:true});assert.equal(configured.created,true);view=await runtime.discover();assert.equal(view.instances.length,1);assert.equal(view.instances[0].canStart,true);assert.equal(f.state.starts.length,0);const managed=read();assert.equal(fs.readdirSync(managed.qqDataDir).length,0);assert(!fs.existsSync(path.join(managed.workDir,'napcat.mjs')));assert(!fs.existsSync(runtime.componentSelection().stateFile));assert(fs.readFileSync(f.qqExe).equals(pe));
});
test('last asynchronous port check cannot hide replaced managed data paths or a changed descriptor',async t=>{
  for(const kind of ['junction','descriptor'])await t.test(kind,async t=>{
    const f=fixture(t),outside=path.join(f.base,'must-remain-empty');fs.mkdirSync(outside);
    f.host.allocatePort=async()=>{if(kind==='junction'){fs.rmdirSync(f.qqDataDir);fs.symlinkSync(outside,f.qqDataDir,'junction');}else f.state.descriptor.descriptorSha256='3'.repeat(64);return 53119;};
    await assert.rejects(f.runtime.start(ACCOUNT),{code:'start_failed'});assert.equal(f.state.starts.length,0);assert.equal(f.state.stops.length,0);assert.deepEqual(fs.readdirSync(outside),[]);assert.equal(fs.readdirSync(f.lockRoot).length,0);
  });
});
test('managed unowned process cannot reuse an old Desktop log endpoint or imported diagnostics',async t=>{
  const f=fixture(t),desktopDataRoot=path.join(f.base,'old-desktop'),folder=path.join(desktopDataRoot,'logs','bots','bots');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,`${ACCOUNT}.log`),'[WebUi] WebUi User Panel Url: http://127.0.0.1:53112/webui?token=FIXTURE_OLD_TOKEN\n11-06 12:00:00 NapCat.Core Version: 4.18.42\n');
  const runtime=new QQRuntimeManager({...f.runtimeOptions,desktopDataRoot}),install=runtime.instance(ACCOUNT);f.state.rows.push({pid:998001,parentPid:1,name:'NapCatWinBootMain.exe',executable:install.launcher,createdAt:'2026-11-06T01:00:00Z',accountId:ACCOUNT},{pid:998002,parentPid:998001,name:'QQ.exe',executable:f.qqExe,createdAt:'2026-11-06T01:00:01Z'});f.host.listeners=async()=>[{pid:998002,port:53112,address:'127.0.0.1'}];
  assert.equal(install.logPath,null);await assert.rejects(runtime.getConnection(ACCOUNT),{code:'webui_unavailable'});assert.doesNotMatch(JSON.stringify(runtime.logs(ACCOUNT)),/runtime_started|FIXTURE_OLD_TOKEN/);assert.equal(f.state.starts.length,0);
});
test('managed endpoint recovery has its own installation namespace and reports selected version as metadata',async t=>{
  const f=fixture(t),{QQRuntimeEndpointStore}=require('../src/bot/qq-runtime-endpoint.cjs'),profileRoot=path.join(f.base,'profile');
  // Synthetic codec only: this integration exercises namespace/routing; the
  // endpoint-store tests independently exercise authenticated ciphertext.
  const vault={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text).reverse(),decryptString:bytes=>Buffer.from(bytes).reverse().toString('utf8')};
  const legacy=new QQRuntimeEndpointStore({root:f.runtimeOptions.root,profileRoot,componentsRoot:path.join(f.base,'legacy-components'),vault}),old={runtime:{pid:777001,createdAt:'2026-11-06T00:00:00Z',executable:path.join(f.base,'legacy-launcher.exe')},listener:{pid:777002,createdAt:'2026-11-06T00:00:01Z',executable:f.qqExe},endpoint:{baseUrl:'http://127.0.0.1:54001',port:54001,token:'FIXTURE_OLD_PRIVATE'}};
  legacy.save(ACCOUNT,old);const oldCipher=fs.readFileSync(legacy.file(ACCOUNT)),runtime=new QQRuntimeManager({...f.runtimeOptions,profileRoot,vault});
  const view=await runtime.discover();assert.equal(view.components.napcatVersion,'4.18.42');assert.equal(view.components.napcatVersionSource,'prepared-selection-metadata');
  await runtime.start(ACCOUNT);const plan=f.state.starts.at(-1);plan.onOutput('[NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:54002/webui?token=FIXTURE_NEW_PRIVATE');const listener=f.state.rows.find(row=>row.name==='QQ.exe');f.host.listeners=async()=>[{pid:listener.pid,port:54002,address:'127.0.0.1'}];
  const live=await runtime.getConnection(ACCOUNT);assert.equal(live.endpointRecoveryIssue,null);assert.equal(live.port,54002);assert.deepEqual(fs.readFileSync(legacy.file(ACCOUNT)),oldCipher);
  const stored=runtime._endpointStore();assert.equal(stored.read(ACCOUNT).value.context.installationId,f.state.descriptor.installationId);assert.notEqual(stored.file(ACCOUNT),legacy.file(ACCOUNT));runtime.endpoints.clear();const recovered=await runtime.getConnection(ACCOUNT);assert.equal(recovered.source,'encrypted-runtime-record');assert.equal(recovered.port,54002);assert.equal(recovered.endpointRecoveryIssue,null);await runtime.stop(ACCOUNT);
});
