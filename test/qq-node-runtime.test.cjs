'use strict';
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
// The injected Windows process inventory needs a fully qualified synthetic system root on POSIX.
if (process.platform !== 'win32') process.env.SystemRoot = path.join(os.tmpdir(), 'arcade-test-windows');
const {QQRuntimeManager}=require('../src/bot/qq-runtime.cjs');
const {QQNodeSelection}=require('../src/bot/qq-node-selection.cjs');
const {withNodeCodeGate}=require('../src/bot/qq-node-code-gate.cjs');
const {NODE_FILES,RELEASE_ID}=require('../src/bot/qq-managed-node-setup.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex'),A='12345001',B='12345002';
const startDeferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
// All files and process observations here are synthetic. The resolver fixture
// is deliberately injected; no package executable, QQ account or native stop runs.
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-node-runtime-')),root=path.join(dir,'home'),store=path.join(dir,'store'),setupId=randomUUID(),installationRoot=path.join(store,'qq-node-installations',setupId),instancesRoot=path.join(installationRoot,'instances'),codeRoot=path.join(store,'qq-component-versions','napcat-node',RELEASE_ID,'code'),manifestPath=path.join(path.dirname(codeRoot),'prepared.json');
  for(const p of [root,instancesRoot,codeRoot])fs.mkdirSync(p,{recursive:true});for(const name of Object.keys(NODE_FILES)){const file=path.join(codeRoot,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'synthetic code marker, never executable');}fs.writeFileSync(manifestPath,'synthetic manifest');
  const selected={kind:'prepared',version:'4.18.42',versionId:RELEASE_ID,manifestSha256:hash('synthetic manifest')},descriptor={schema:'qq_managed_node_v1',engine:'managed-node',dataPolicy:'isolated-new',previous:null,setupId,installationRoot,instancesRoot,codeRoot,manifestPath,installationId:hash(installationRoot.toLowerCase()),descriptorSha256:hash('synthetic descriptor'),current:selected,prepared:selected,node:{version:'22.11.0',architecture:'x64',file:'node.exe',...NODE_FILES['node.exe']},qq:{version:'9.9.31-49738'},entry:{file:'index.js',...NODE_FILES['index.js']},native:{}};
  const self={pid:process.pid,parentPid:1,createdAt:'2026-11-06T01:00:00.0000000Z',name:'test.exe',executable:process.execPath};
  const state={rows:[self],starts:[],stops:[],next:810000,listeners:[],resolves:0};
  const host={allocatePort:async()=>54000+state.starts.length,snapshot:async()=>structuredClone(state.rows),inspect:async pids=>structuredClone(state.rows.filter(row=>pids.includes(row.pid))),listeners:async()=>structuredClone(state.listeners),start:async plan=>{state.starts.push(plan);const pid=state.next++;state.rows.push({pid,parentPid:process.pid,createdAt:'2026-11-06T02:00:00.0000000Z',name:'node.exe',executable:plan.file});state.rows.push({pid:state.next++,parentPid:pid,createdAt:'2026-11-06T02:00:01.0000000Z',name:'node.exe',executable:plan.file});return {pid};},stop:async(proofs,options)=>{state.stops.push({proofs,options});state.rows=state.rows.filter(row=>!proofs.some(proof=>proof.pid===row.pid));}};
  const prepared={component:'napcat-node',resolvePrepared:async id=>{state.resolves++;assert.equal(id,RELEASE_ID);return {versionId:id,version:'4.18.42',codeRoot,manifestPath,manifestSha256:selected.manifestSha256,files:Object.entries(NODE_FILES).map(([p,v])=>({path:p,...v}))};}};
  const options={root,profileRoot:path.join(dir,'profile'),lockRoot:path.join(dir,'locks'),componentStoreRoot:store,platform:'win32',processHost:host,managedNodeInstallation:()=>structuredClone(descriptor),componentSelectionFactory:opts=>new QQNodeSelection({...opts,prepared})};
  const manager=new QQRuntimeManager(options);
  const configure=async(id,which=manager)=>which.withConfigurationLock(id,{create:true},async install=>{await install.assertStopped();fs.writeFileSync(install.onebotConfigPath,JSON.stringify({network:{websocketServers:[]}}),{flag:'wx'});return {configured:true};});
  t.after(()=>{const real=fs.realpathSync(dir);assert(real.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(real,{recursive:true,force:true});});
  return {dir,root,store,descriptor,codeRoot,instancesRoot,state,host,options,manager,configure,prepared};
}

test('guarded Node start rejects pre-cancelled and asynchronous context checks before resolving components',async t=>{
  for(const [options,code]of [[{signal:AbortSignal.abort()},'start_cancelled'],[{assertCurrent:async()=>{}},'start_guard_invalid']])await t.test(code,async t=>{
    const f=fixture(t);await f.configure(A);const resolves=f.state.resolves;await assert.rejects(f.manager.start(A,options),{code});assert.equal(f.state.resolves,resolves);assert.equal(f.state.starts.length,0);
  });
});
test('guarded Node start rechecks a stale context after asynchronous component verification',async t=>{
  const f=fixture(t);await f.configure(A);const entered=startDeferred(),release=startDeferred(),original=f.prepared.resolvePrepared;let current=true;f.prepared.resolvePrepared=async id=>{entered.resolve();await release.promise;return original(id);};
  const operation=f.manager.start(A,{assertCurrent:()=>{if(!current)throw Error('scope changed');}});await entered.promise;current=false;release.resolve();await assert.rejects(operation,{code:'start_context_changed'});assert.equal(f.state.starts.length,0);assert.equal(fs.existsSync(f.manager._lockPath(A)),false);
});
test('guarded Node start cannot spawn after cancellation or scope change during port allocation',async t=>{
  for(const kind of ['cancel','scope'])await t.test(kind,async t=>{
    const f=fixture(t);await f.configure(A);const entered=startDeferred(),release=startDeferred(),cancel=new AbortController();let current=true;f.host.allocatePort=async()=>{entered.resolve();await release.promise;return 54000;};
    const operation=f.manager.start(A,{signal:cancel.signal,assertCurrent:()=>{if(!current)throw Error('scope changed');}});await entered.promise;if(kind==='cancel')cancel.abort();else current=false;release.resolve();
    await assert.rejects(operation,{code:kind==='cancel'?'start_cancelled':'start_context_changed'});assert.equal(f.state.starts.length,0);assert.equal(f.state.stops.length,0);assert.equal(fs.existsSync(f.manager._lockPath(A)),false);
  });
});
test('guarded Node start passes the composed check to the final host boundary',async t=>{
  const f=fixture(t);await f.configure(A);let current=true,atBoundary=false;f.host.start=async plan=>{atBoundary=true;current=false;plan.beforeSpawn();assert.fail('late Node spawn');};
  await assert.rejects(f.manager.start(A,{assertCurrent:()=>{if(!current)throw Error('changed');}}),{code:'start_context_changed'});assert(atBoundary);assert.equal(f.state.starts.length,0);assert.equal(fs.existsSync(f.manager._lockPath(A)),false);
});
test('guarded Node start retains its exact proven process tree after late cancellation',async t=>{
  const f=fixture(t);await f.configure(A);const cancel=new AbortController(),start=f.host.start;f.host.start=async plan=>{plan.beforeSpawn();const child=await start(plan);cancel.abort();return child;};
  const result=await f.manager.start(A,{signal:cancel.signal});assert.equal(result.management,'owned');assert(f.manager.runs.get(A).proof);assert.equal(f.state.starts.length,1);assert.equal(f.state.stops.length,0);await f.manager.stop(A);
});

test('two installations sharing code serialize across the real startup port await and lease adoption',async t=>{
 const f=fixture(t);await f.configure(A);
 const second=structuredClone(f.descriptor);second.setupId=randomUUID();second.installationRoot=path.join(f.store,'qq-node-installations',second.setupId);second.instancesRoot=path.join(second.installationRoot,'instances');second.installationId=hash(second.installationRoot.toLowerCase());second.descriptorSha256=hash('second synthetic descriptor');fs.mkdirSync(second.instancesRoot,{recursive:true});
 const selector=new QQNodeSelection({root:f.store,read:()=>structuredClone(second),lockRoot:path.join(f.dir,'second-locks'),processHost:f.host,prepared:f.prepared});
 let enter,release;const entered=new Promise(r=>{enter=r;}),held=new Promise(r=>{release=r;});f.host.allocatePort=async()=>{enter();await held;return 54000;};
 const starting=f.manager.start(A);await entered;
 try{assert.equal(f.state.starts.length,0);assert.equal(JSON.parse(fs.readFileSync(f.manager._lockPath(A))).runtime,null);await assert.rejects(selector.withStartLock(()=>assert.fail('other installation entered')),{code:'node_repair_busy'});await assert.rejects(withNodeCodeGate({root:f.store},()=>assert.fail('repair entered during startup')),{code:'node_repair_busy'});}
 finally{release();}
 assert.equal((await starting).management,'owned');await assert.rejects(selector._stopped(),{code:'runtime_running'});assert.equal(f.state.starts.length,1);await f.manager.stop(A);
});

test('a held code repair blocks Node startup/configuration/pending recovery and pending intent blocks reopening',async t=>{
 const f=fixture(t);await f.configure(A);
 await withNodeCodeGate({root:f.store},async()=>{
  await assert.rejects(f.manager.start(A),{code:'node_repair_busy'});
  await assert.rejects(f.manager.withConfigurationLock(A,{},()=>assert.fail('configuration entered')),{code:'node_repair_busy'});
  await assert.rejects(f.manager.componentSelection().withPendingUpdateRecovery(()=>assert.fail('update recovery entered')),{code:'node_repair_busy'});
 });
 assert.equal(f.state.starts.length,0);
 const pending=path.join(f.store,'qq-node-code-recovery',RELEASE_ID,'pending.json');fs.mkdirSync(path.dirname(pending),{recursive:true});fs.writeFileSync(pending,'SYNTHETIC TORN REPAIR INTENT');
 assert.throws(()=>f.manager.componentSelection().layout(),{code:'node_repair_recovery_required'});
 await assert.rejects(f.manager.start(A));assert.equal(f.state.starts.length,0);
 const state=await f.manager.discover();assert.equal(state.configured,false);assert.equal(state.issue,'node_repair_recovery_required');assert.equal(fs.readFileSync(pending,'utf8'),'SYNTHETIC TORN REPAIR INTENT');
});

test('a pending code repair observed after port allocation retains its actionable error and never spawns',async t=>{
 const f=fixture(t);await f.configure(A);
 const pending=path.join(f.store,'qq-node-code-recovery',RELEASE_ID,'pending.json');
 f.host.allocatePort=async()=>{fs.mkdirSync(path.dirname(pending),{recursive:true});fs.writeFileSync(pending,'SYNTHETIC LATE REPAIR INTENT');return 54000;};
 await assert.rejects(f.manager.start(A),{code:'node_repair_recovery_required'});assert.equal(f.state.starts.length,0);assert.equal(fs.existsSync(f.manager._lockPath(A)),false);
});

test('a replaced code parent after port allocation retains the gate error and never spawns',async t=>{
 const f=fixture(t);await f.configure(A);const parent=path.dirname(f.codeRoot),old=parent+'-retained-fixture';
 f.host.allocatePort=async()=>{fs.renameSync(parent,old);fs.cpSync(old,parent,{recursive:true});return 54000;};
 await assert.rejects(f.manager.start(A),{code:'node_repair_changed'});assert.equal(f.state.starts.length,0);assert.equal(fs.existsSync(f.manager._lockPath(A)),false);
});
test('Node deployment remains scoped to its own work directory and never stops another owned account',async t=>{
 const f=fixture(t);await f.configure(A);await f.configure(B);await f.manager.start(B);
 const result=await f.manager.withPluginDeploymentLock(A,async install=>{assert.equal(install.workDir,f.manager.instance(A).workDir);await install.assertStopped();return {checked:true};});
 assert.deepEqual(result,{checked:true});assert.equal(f.state.stops.length,0);assert(f.manager.runs.has(B));await f.manager.stop(B);
});
test('Node pending plugin recovery blocks only the corresponding work directory startup',async t=>{
 const f=fixture(t);await f.configure(A);await f.configure(B);const history=path.join(f.manager.instance(A).workDir,'.agent-arcade-plugin-history');fs.mkdirSync(history);fs.writeFileSync(path.join(history,'pending.json'),'SYNTHETIC INCOMPLETE JOURNAL');
 await assert.rejects(f.manager.start(A),{code:'deployment_recovery_required'});assert.equal(f.state.starts.length,0);
 const state=await f.manager.discover();assert.equal(state.instances.find(row=>row.accountId===A).canStart,false);assert.equal(state.instances.find(row=>row.accountId===A).reason,'deployment_recovery_required');assert.equal(state.instances.find(row=>row.accountId===B).canStart,true);
 await f.manager.start(B);assert.equal(f.state.starts.length,1);await f.manager.stop(B);assert.equal(fs.readFileSync(path.join(history,'pending.json'),'utf8'),'SYNTHETIC INCOMPLETE JOURNAL');
});
test('new Node installation is empty and configuration uses isolated per-account roots',async t=>{
  const f=fixture(t);assert.equal(f.manager.constructor.name,'QQNodeRuntimeManager');const first=await f.manager.discover();assert.equal(first.installationKind,'managed-node');assert.equal(first.components.nodeVersion,'22.11.0');assert.deepEqual(first.instances,[]);assert.equal(f.state.starts.length,0);
  await f.configure(A);await f.configure(B);const a=f.manager.instance(A),b=f.manager.instance(B);assert.notEqual(a.configDir,b.configDir);assert.notEqual(a.qqDataDir,b.qqDataDir);assert.equal(a.accountConfigPaths[B],b.onebotConfigPath);assert.equal(a.accountConfigPaths[A],a.onebotConfigPath);assert.equal(f.manager.componentSelection().status().previous,null);assert.equal(f.manager.componentSelection().status().scope,'qq-node-runtime');assert.throws(()=>f.manager.componentSelection().rollback(),{code:'rollback_unavailable'});
  assert.equal(fs.existsSync(path.join(f.root,'qq-runtime')),false);assert.equal(f.state.starts.length,0);
  assert.throws(()=>f.manager.componentSelection().preview({operation:'rollback'}),{code:'rollback_unavailable'});assert.deepEqual(f.manager.logs(A).events,[]);
});
test('Node launch uses verified fixed entry, sanitized environment and separate account lifecycle',async t=>{
  const f=fixture(t);await f.configure(A);await f.configure(B);process.env.NAPCAT_WORKER_ID='DO_NOT_INHERIT';process.env.NODE_OPTIONS='DO_NOT_INHERIT';t.after(()=>{delete process.env.NAPCAT_WORKER_ID;delete process.env.NODE_OPTIONS;});
  assert.equal((await f.manager.start(A)).management,'owned');assert.equal((await f.manager.start(B)).management,'owned');const [a,b]=f.state.starts;assert.deepEqual(a.args,[path.join(f.codeRoot,'index.js'),'-q',A]);assert.equal(a.file,path.join(f.codeRoot,'node.exe'));assert.equal(a.cwd,f.manager.instance(A).workDir);assert.equal(a.env.NAPCAT_QQ_DATA_DIR,f.manager.instance(A).qqDataDir);assert(!('NODE_OPTIONS'in a.env));assert(!('NAPCAT_WORKER_ID'in a.env));assert.notEqual(a.cwd,b.cwd);assert.notEqual(a.env.NAPCAT_QQ_DATA_DIR,b.env.NAPCAT_QQ_DATA_DIR);
  const secondProof=f.manager.runs.get(B).proof;assert.equal((await f.manager.stop(A)).management,'stopped');assert.equal(f.state.stops[0].proofs[0].pid,810000);assert(f.state.rows.some(row=>row.pid===secondProof.pid));await f.manager.stop(B);assert.equal(fs.readdirSync(f.options.lockRoot).filter(name=>name.endsWith('.json')).length,0);
});
test('a bundled Node process outside registered ownership blocks start without affecting system Node',async t=>{
  const f=fixture(t);await f.configure(A);f.state.rows.push({pid:790000,parentPid:1,createdAt:'2026-11-06T00:00:00Z',name:'node.exe',executable:process.execPath});await f.manager.start(A);await f.manager.stop(A);
  f.state.rows.push({pid:790001,parentPid:1,createdAt:'2026-11-06T00:00:00Z',name:'node.exe',executable:path.join(f.codeRoot,'node.exe')});await assert.rejects(f.manager.start(A),{code:'external_qq_unknown'});assert.equal(f.state.starts.length,1);assert.equal(f.state.stops.length,1);
});
test('stable worker replacement is persisted; worker identity reuse, unknown descendants and churn block stop',async t=>{
  for(const scenario of ['replacement','reuse','unknown-child','deeper-child','changing'])await t.test(scenario,async t=>{
    const f=fixture(t);await f.configure(A);await f.manager.start(A);const root=f.manager.runs.get(A).proof,worker=f.state.rows.find(row=>row.parentPid===root.pid);let snapshots=0;
    if(scenario==='replacement'){f.state.rows=f.state.rows.filter(row=>row.pid!==worker.pid);f.state.rows.push({...worker,pid:819999,createdAt:'2026-11-06T03:00:00Z'});assert.equal((await f.manager.discover()).instances[0].canStop,true);const saved=JSON.parse(fs.readFileSync(f.manager._lockPath(A)));assert(saved.runtimeTree.some(row=>row.pid===819999));assert(!saved.runtimeTree.some(row=>row.pid===worker.pid));await f.manager.stop(A);return;}
    if(scenario==='reuse')worker.createdAt='2026-11-06T03:00:00Z';
    if(scenario==='unknown-child'||scenario==='deeper-child')f.state.rows.push({pid:819999,parentPid:scenario==='deeper-child'?worker.pid:root.pid,createdAt:'2026-11-06T03:00:00Z',name:'helper.exe',executable:path.join(f.dir,'helper.exe')});
    if(scenario==='changing'){const snapshot=f.host.snapshot;f.host.snapshot=async()=>{const rows=await snapshot();if(++snapshots===2)rows.push({...worker,pid:819999,createdAt:'2026-11-06T03:00:00Z'});return rows;};}
    await assert.rejects(f.manager.stop(A));assert.equal(f.state.stops.length,0);assert(fs.existsSync(f.manager._lockPath(A)));
  });
});
test('post-stop unrecorded worker remains untouched and retains the lease',async t=>{
  const f=fixture(t);await f.configure(A);await f.manager.start(A);const root=f.manager.runs.get(A).proof,stop=f.host.stop;
  f.host.stop=async(...args)=>{await stop(...args);f.state.rows.push({pid:819999,parentPid:root.pid,createdAt:'2026-11-06T03:00:00Z',name:'node.exe',executable:root.executable});};
  await assert.rejects(f.manager.stop(A),{code:'orphaned_children'});assert.equal(f.state.stops.length,1);assert(f.state.rows.some(row=>row.pid===819999));assert(fs.existsSync(f.manager._lockPath(A)));
});
function abandon(f){const file=f.manager._lockPath(A),lease=JSON.parse(fs.readFileSync(file));lease.manager={pid:777777,createdAt:'2026-11-06T00:00:00Z',executable:process.execPath};lease.instance='previous-app';fs.writeFileSync(file,JSON.stringify(lease));f.manager.runs.clear();return {next:new QQRuntimeManager(f.options),lease,file};}
test('crash recovery adopts exact live supervisor and persists new workers before endpoints',async t=>{
  const f=fixture(t);await f.configure(A);await f.manager.start(A);const {next}=abandon(f);assert.equal((await next.discover()).instances[0].canRecover,true);assert.equal((await next.recover(A)).recovery,'adopted');assert.equal(f.state.starts.length,1);await next.stop(A);assert.equal(f.state.stops.length,1);
});
test('explicit crash residual cleanup stops only the persisted workers and no automatic replacement',async t=>{
  const f=fixture(t);await f.configure(A);await f.manager.start(A);const {next,lease,file}=abandon(f);f.state.rows=f.state.rows.filter(row=>row.pid!==lease.runtime.pid);await assert.rejects(next.recover(A),{code:'orphaned_children'});const preview=await next.previewOrphanCleanup(A);assert.equal(preview.count,1);const result=await next.cleanupOrphans(A,{expectedDigest:preview.expectedDigest});assert.equal(result.recovery,'orphans-cleared');assert.equal(f.state.stops[0].options.residual,true);assert.equal(f.state.starts.length,1);assert.equal(fs.existsSync(file),false);
});
test('Node endpoint proof requires an owned stable worker listener and never reads old Desktop logs',async t=>{
  const f=fixture(t);await f.configure(A);await f.manager.start(A);const root=f.manager.runs.get(A).proof,worker=f.state.rows.find(row=>row.parentPid===root.pid);f.state.starts[0].onOutput('[WebUi] WebUi User Panel Url: http://127.0.0.1:54000/webui?token=fixture-token');f.state.listeners=[{pid:worker.pid,port:54000,address:'127.0.0.1'}];const result=await f.manager.getConnection(A);assert.equal(result.ownershipVerified,true);assert.equal(result.source,'owned-runtime-output');assert.equal(f.manager.instance(A).logPath,null);
  f.state.listeners=[{pid:process.pid,port:54000,address:'127.0.0.1'}];await assert.rejects(f.manager.getConnection(A),{code:'webui_unavailable'});
});
test('descriptor or data-directory changes while awaiting the port prevent any Node spawn',async t=>{
  for(const scenario of ['descriptor','data-link'])await t.test(scenario,async t=>{
    const f=fixture(t);await f.configure(A);const data=f.manager.instance(A).qqDataDir,external=path.join(f.dir,'external');fs.mkdirSync(external);
    f.host.allocatePort=async()=>{if(scenario==='descriptor')f.descriptor.descriptorSha256=hash('changed');else{fs.rmdirSync(data);fs.symlinkSync(external,data,'junction');}return 54000;};
    await assert.rejects(f.manager.start(A));assert.equal(f.state.starts.length,0);assert.deepEqual(fs.readdirSync(external),[]);if(scenario==='data-link')fs.unlinkSync(data);
  });
});
test('a changed managed descriptor produces a safe discovery issue rather than a stale online state',async t=>{
  const f=fixture(t);await f.configure(A);f.descriptor.descriptorSha256=hash('externally changed descriptor');const value=await f.manager.discover();assert.equal(value.configured,false);assert.equal(value.issue,'managed_installation_changed');assert.equal(value.components.nodeVersion,null);assert(value.instances.every(row=>!row.canStart&&!row.canStop&&!row.canRecover));assert.equal(f.state.starts.length,0);
});
test('recovery rejects another installation, a missing supervisor proof and changed live root identity',async t=>{
  for(const scenario of ['other-installation','missing-root-proof','root-reused'])await t.test(scenario,async t=>{
    const f=fixture(t);await f.configure(A);await f.manager.start(A);const {next,lease,file}=abandon(f);
    if(scenario==='other-installation')lease.installationId=hash('another installation');if(scenario==='missing-root-proof')lease.runtimeTree=lease.runtimeTree.filter(row=>row.pid!==lease.runtime.pid);if(scenario==='root-reused')f.state.rows.find(row=>row.pid===lease.runtime.pid).createdAt='2026-11-06T04:00:00Z';fs.writeFileSync(file,JSON.stringify(lease));
    await assert.rejects(next.recover(A),{code:'ownership_lost'});assert.equal(f.state.stops.length,0);assert(fs.existsSync(file));
  });
});
test('unknown post-crash children prevent orphan preview; closing waits for an in-flight lifecycle',async t=>{
  const f=fixture(t);await f.configure(A);await f.manager.start(A);const {next,lease}=abandon(f);f.state.rows=f.state.rows.filter(row=>row.pid!==lease.runtime.pid);f.state.rows.push({pid:819999,parentPid:lease.runtime.pid,createdAt:'2026-11-06T04:00:00Z',executable:path.join(f.codeRoot,'node.exe'),name:'node.exe'});await assert.rejects(next.previewOrphanCleanup(A),{code:'orphan_cleanup_unverified'});assert.equal(f.state.stops.length,0);
  const other=fixture(t);await other.configure(B);let release,entered;const started=new Promise(resolve=>{entered=resolve;}),original=other.host.allocatePort;other.host.allocatePort=async()=>{entered();await new Promise(resolve=>{release=resolve;});return original();};const pending=other.manager.start(B);await started;const closing=other.manager.close();release();await pending;const result=await closing;assert.equal(result.closed,true);assert.equal(other.state.stops.length,1);
});
test('Node preparation and existing operation records fail closed before any spawn',async t=>{
  for(const scenario of ['manifest-changed','pending-upstream-update','unknown-lock','layout-during-resolve'])await t.test(scenario,async t=>{
    const f=fixture(t);await f.configure(A);const selector=f.manager.componentSelection();let expected;
    if(scenario==='manifest-changed'){f.prepared.resolvePrepared=async()=>{throw Object.assign(new Error('synthetic mismatch'),{code:'prepared_invalid'});};expected='prepared_invalid';}
    if(scenario==='pending-upstream-update'){fs.writeFileSync(path.join(f.manager.instance(A).configDir,'napcat-update.json'),'unknown upstream operation');expected='pending_upstream_update';}
    if(scenario==='unknown-lock'){fs.writeFileSync(selector.lockFile,'unknown lock record',{flag:'wx'});expected='component_locked';}
    if(scenario==='layout-during-resolve'){const original=f.prepared.resolvePrepared;f.prepared.resolvePrepared=async(...args)=>{const result=await original(...args);f.descriptor.descriptorSha256=hash('changed during full resolve');return result;};expected='managed_installation_changed';}
    await assert.rejects(f.manager.start(A),{code:expected});assert.equal(f.state.starts.length,0);assert.equal(f.state.stops.length,0);if(scenario==='unknown-lock')assert.equal(fs.readFileSync(selector.lockFile,'utf8'),'unknown lock record');
  });
});
test('ownership changed during the final process lookup prevents Node termination even when the tree is unchanged',async t=>{
  const f=fixture(t);await f.configure(A);await f.manager.start(A);const inspect=f.host.inspect,file=f.manager._lockPath(A);
  f.host.inspect=async pids=>{const result=await inspect(pids);const value=JSON.parse(fs.readFileSync(file));value.token=randomUUID();fs.writeFileSync(file,JSON.stringify(value));return result;};
  await assert.rejects(f.manager.stop(A),{code:'runtime_locked'});assert.equal(f.state.stops.length,0);assert(fs.existsSync(file));
});
test('Node installation lock recovery cannot treat an inaccessible Node executable as stopped',async t=>{
  const f=fixture(t),selector=f.manager.componentSelection();for(const executable of ['', 'relative-node.exe']){f.state.rows=[f.state.rows[0],{pid:799001,parentPid:1,name:'node.exe',executable,createdAt:'2026-11-06T01:00:00Z'}];await assert.rejects(selector._stopped(),{code:'process_check_failed'});}assert.equal(f.state.starts.length,0);assert.equal(f.state.stops.length,0);
});
function withConsole(f,change=()=>{}){
  const start=f.host.start;f.host.start=async plan=>{const result=await start(plan),root=f.state.rows.find(row=>row.pid===result.pid),worker=f.state.rows.find(row=>row.parentPid===root.pid);
    const console={pid:f.state.next++,parentPid:root.pid,createdAt:'2026-11-06T02:00:00.0070000Z',name:'conhost.exe',executable:path.join(process.env.SystemRoot||'C:\\Windows','System32','conhost.exe')};change(console,{root,worker});f.state.rows.push(console);return result;};
}
test('real-observed direct Windows console topology is persisted and stopped after its Node supervisor',async t=>{
  const f=fixture(t);await f.configure(A);withConsole(f);const result=await f.manager.start(A);assert.equal(result.canStop,true);const run=f.manager.runs.get(A),lease=JSON.parse(fs.readFileSync(run.lease.file));assert.equal(lease.runtimeTree.length,3);assert.equal(f.manager._validLease(lease,A),true);
  await f.manager.stop(A);assert.equal(f.state.stops.length,1);assert.equal(f.state.stops[0].proofs[0].pid,lease.runtime.pid);assert.equal(f.state.stops[0].proofs.length,3);assert.equal(fs.existsSync(run.lease.file),false);
});
test('an old launch-only Node lease can adopt the stable verified direct console and worker',async t=>{
  const f=fixture(t);await f.configure(A);withConsole(f);await f.manager.start(A);const {next,lease,file}=abandon(f);lease.runtimeTree=[];fs.writeFileSync(file,JSON.stringify(lease));
  assert.equal((await next.recover(A)).recovery,'adopted');const updated=JSON.parse(fs.readFileSync(file));assert.equal(updated.runtimeTree.length,3);await next.stop(A);assert.equal(f.state.stops.length,1);
});
test('a launch-only Node lease cannot claim a console after its supervisor is gone',async t=>{
  const f=fixture(t);await f.configure(A);withConsole(f);await f.manager.start(A);const {next,lease,file}=abandon(f);lease.runtimeTree=[];fs.writeFileSync(file,JSON.stringify(lease));f.state.rows=f.state.rows.filter(row=>row.pid!==lease.runtime.pid);
  await assert.rejects(next.recover(A),{code:'orphaned_children'});await assert.rejects(next.previewOrphanCleanup(A),{code:'ownership_lost'});assert.equal(f.state.stops.length,0);assert(fs.existsSync(file));
});
test('explicit Node residual cleanup includes only a previously persisted verified system console',async t=>{
  const f=fixture(t);await f.configure(A);withConsole(f);await f.manager.start(A);const {next,lease,file}=abandon(f);f.state.rows=f.state.rows.filter(row=>row.pid!==lease.runtime.pid);const preview=await next.previewOrphanCleanup(A);assert.equal(preview.count,2);const result=await next.cleanupOrphans(A,{expectedDigest:preview.expectedDigest});assert.equal(result.terminatedCount,2);assert.equal(fs.existsSync(file),false);
});
test('same-name, worker-parented, missing-identity and post-crash unrecorded consoles remain unowned',async t=>{
  for(const scenario of ['wrong-path','worker-parent','missing-created','unrecorded'])await t.test(scenario,async t=>{
    const f=fixture(t);await f.configure(A);
    if(scenario==='unrecorded'){await f.manager.start(A);const {next,lease,file}=abandon(f);f.state.rows=f.state.rows.filter(row=>row.pid!==lease.runtime.pid);f.state.rows.push({pid:819999,parentPid:lease.runtime.pid,createdAt:'2026-11-06T03:00:00Z',name:'conhost.exe',executable:path.join(process.env.SystemRoot||'C:\\Windows','System32','conhost.exe')});await assert.rejects(next.previewOrphanCleanup(A),{code:'orphan_cleanup_unverified'});assert(fs.existsSync(file));}
    else{withConsole(f,(console,{worker})=>{if(scenario==='wrong-path')console.executable=path.join(f.dir,'conhost.exe');if(scenario==='worker-parent'){console.parentPid=worker.pid;console.createdAt='2026-11-06T02:00:02.0000000Z';}if(scenario==='missing-created')console.createdAt='';});await assert.rejects(f.manager.start(A),{code:'ownership_lost'});}
    assert.equal(f.state.stops.length,0);
  });
});
test('a verified console cannot supply the Node WebUI endpoint and its reused PID blocks stop',async t=>{
  const f=fixture(t);await f.configure(A);withConsole(f);await f.manager.start(A);const console=f.state.rows.find(row=>row.name==='conhost.exe');f.state.starts[0].onOutput('[WebUi] WebUi User Panel Url: http://127.0.0.1:54000/webui?token=fixture-token');f.state.listeners=[{pid:console.pid,port:54000,address:'127.0.0.1'}];await assert.rejects(f.manager.getConnection(A),{code:'webui_unavailable'});
  console.createdAt='2026-11-06T03:00:00Z';await assert.rejects(f.manager.stop(A),{code:'ownership_lost'});assert.equal(f.state.stops.length,0);assert(fs.existsSync(f.manager._lockPath(A)));
});
test('new Node account creation seeds only the minimal loopback WebUI configuration',async t=>{
  const f=fixture(t);await f.configure(A);const file=f.manager.instance(A).webuiConfigPath;assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{host:'127.0.0.1'});assert.equal(f.state.starts.length,0);
});
test('existing nonlocal or malformed WebUI configuration blocks Node startup without rewriting it',async t=>{
  for(const text of ['{"host":"::","token":"synthetic-existing","enable2FA":true}', '{"host":"127.0.0.1","port":{}}', '{"host":"127.0.0.1"'])await t.test(text,async t=>{
    const f=fixture(t);await f.configure(A);const file=f.manager.instance(A).webuiConfigPath;fs.writeFileSync(file,text);await assert.rejects(f.manager.start(A),{code:'webui_config_not_local'});assert.equal(fs.readFileSync(file,'utf8'),text);assert.equal(f.state.starts.length,0);
  });
});
test('a WebUI configuration changed during port allocation prevents any Node process start',async t=>{
  const f=fixture(t);await f.configure(A);const file=f.manager.instance(A).webuiConfigPath;f.host.allocatePort=async()=>{fs.writeFileSync(file,'{"host":"::"}');return 54000;};await assert.rejects(f.manager.start(A),{code:'webui_config_not_local'});assert.equal(f.state.starts.length,0);
});
test('broad WebUI settings do not prevent exact live-process recovery or stopping',async t=>{
  const f=fixture(t);await f.configure(A);await f.manager.start(A);const file=f.manager.instance(A).webuiConfigPath,prior='{"host":"::","token":"untouched-existing"}';fs.writeFileSync(file,prior);const {next}=abandon(f);assert.equal((await next.recover(A)).recovery,'adopted');await next.stop(A);assert.equal(fs.readFileSync(file,'utf8'),prior);assert.equal(f.state.stops.length,1);
});
test('Node management rejects a wildcard listener in either observation with a specific code',async t=>{
  for(const secondOnly of [false,true])await t.test(String(secondOnly),async t=>{
    const f=fixture(t);await f.configure(A);await f.manager.start(A);const root=f.manager.runs.get(A).proof,worker=f.state.rows.find(row=>row.parentPid===root.pid);f.state.starts[0].onOutput('[WebUi] WebUi User Panel Url: http://127.0.0.1:54000/webui?token=fixture-token');let calls=0;f.host.listeners=async()=>[{pid:worker.pid,port:54000,address:secondOnly&&++calls===1?'127.0.0.1':'::'}];await assert.rejects(f.manager.getConnection(A),{code:'webui_config_not_local'});assert.equal(f.state.stops.length,0);
  });
});
test('replacing WebUI with identical bytes during asynchronous startup is still rejected',async t=>{
  const f=fixture(t);await f.configure(A);const file=f.manager.instance(A).webuiConfigPath;f.host.allocatePort=async()=>{const content=fs.readFileSync(file);fs.renameSync(file,`${file}.retained`);fs.writeFileSync(file,content,{flag:'wx'});return 54000;};await assert.rejects(f.manager.start(A),{code:'webui_config_not_local'});assert.equal(f.state.starts.length,0);assert(fs.existsSync(`${file}.retained`));
});

function batchedEndpoints(f){
  const {nodeObservationPids}=require('../src/bot/qq-runtime.cjs').runtimeSupport;const calls=[];
  for(const [i,id]of [A,B].entries()){const root=f.manager.runs.get(id).proof,worker=f.state.rows.find(row=>row.parentPid===root.pid);f.state.starts[i].onOutput(`[WebUi] WebUi User Panel Url: http://127.0.0.1:${54000+i}/webui?token=fixture-token-${i}`);f.state.listeners.push({pid:worker.pid,port:54000+i,address:'127.0.0.1'});}
  f.host.observeNode=async request=>{calls.push(structuredClone(request));const before=structuredClone(f.state.rows),after=structuredClone(f.state.rows),pids=nodeObservationPids(request,before,after);return {before,after,inspected:structuredClone(f.state.rows.filter(row=>pids.includes(row.pid))),listeners:structuredClone(f.state.listeners)};};return calls;
}
test('Node endpoint batches share two raw observations across accounts without using slower host calls',async t=>{
  const f=fixture(t);await f.configure(A);await f.configure(B);await f.manager.start(A);await f.manager.start(B);const calls=batchedEndpoints(f);
  for(const key of ['snapshot','inspect','listeners'])f.host[key]=async()=>{throw Error('Separate query must not run');};
  const result=await f.manager.getConnections([A,B]);assert.equal(calls.length,2);assert.equal(calls[0].roots.length,2);assert.equal(calls[1].roots.length,2);assert(result.get(A).connection.ownershipVerified);assert(result.get(B).connection.ownershipVerified);assert.notEqual(result.get(A).connection.endpointId,result.get(B).connection.endpointId);
});
test('Node batched observations isolate account-local identity and listener failures',async t=>{
  const f=fixture(t);await f.configure(A);await f.configure(B);await f.manager.start(A);await f.manager.start(B);batchedEndpoints(f);const collect=f.host.observeNode,root=f.manager.runs.get(A).proof,worker=f.state.rows.find(row=>row.parentPid===root.pid);
  for(const scenario of ['pid-reused','parent-changed','unknown-child','inspect-mismatch','port-changed','wildcard','account-listener-mix'])await t.test(scenario,async()=>{
    let phase=0;f.host.observeNode=async request=>{const r=await collect(request);phase++;
      if(phase===1){if(scenario==='pid-reused')r.after.find(p=>p.pid===worker.pid).createdAt='2026-11-06T04:00:00Z';if(scenario==='parent-changed')r.after.find(p=>p.pid===worker.pid).parentPid=1;
        if(scenario==='unknown-child'){const child={...worker,pid:899999,name:'unknown.exe',executable:path.join(f.dir,'unknown.exe')};r.before.push(child);r.after.push(child);r.inspected.push(child);}
        if(scenario==='inspect-mismatch')r.inspected.find(p=>p.pid===worker.pid).executable=process.execPath;
        if(scenario==='account-listener-mix')r.listeners.find(p=>p.pid===worker.pid).pid=f.state.rows.find(p=>p.parentPid===f.manager.runs.get(B).proof.pid).pid;
      }
      if(phase===2&&scenario==='port-changed')r.listeners.find(p=>p.pid===worker.pid).port=54999;
      if(phase===2&&scenario==='wildcard')r.listeners.push({pid:worker.pid,port:54000,address:'0.0.0.0'});return r;
    };const result=await f.manager.getConnections([A,B]);assert.equal(result.get(A).error.code,scenario==='wildcard'?'webui_config_not_local':'webui_unavailable');assert.equal(result.get(B).connection.ownershipVerified,true);assert.equal(f.state.stops.length,0);
  });
});
test('malformed or failed Node batch observations fail closed without fallback queries',async t=>{
  const f=fixture(t);await f.configure(A);await f.configure(B);await f.manager.start(A);await f.manager.start(B);batchedEndpoints(f);const collect=f.host.observeNode;let fallback=0;
  for(const key of ['snapshot','inspect','listeners'])f.host[key]=async()=>{fallback++;throw Error('No downgrade');};
  for(const scenario of ['throws','duplicate-pid','extra-inspected','bad-listener','oversized','missing-after'])await t.test(scenario,async()=>{
    f.host.observeNode=async request=>{if(scenario==='throws')throw Error('PRIVATE_RAW_ERROR');const r=await collect(request);
      if(scenario==='duplicate-pid')r.before.push({...r.before[0]});if(scenario==='extra-inspected')r.inspected.push({...r.before[0],pid:899999});if(scenario==='bad-listener')r.listeners[0].port=NaN;if(scenario==='oversized')r.listeners=Array.from({length:4097},()=>r.listeners[0]);if(scenario==='missing-after')delete r.after;return r;};
    const result=await f.manager.getConnections([A,B]);for(const id of [A,B])assert.equal(result.get(id).error.code,'webui_unavailable');assert.equal(fallback,0);assert.doesNotMatch(JSON.stringify([...result]),/PRIVATE_RAW_ERROR/);
  });
});
test('Node final endpoint check rejects changes during the second observation',async t=>{
  for(const scenario of ['run-replaced','lease-token','endpoint-token','descriptor'])await t.test(scenario,async t=>{
    const f=fixture(t);await f.configure(A);await f.configure(B);await f.manager.start(A);await f.manager.start(B);batchedEndpoints(f);const collect=f.host.observeNode;let phase=0;
    f.host.observeNode=async request=>{const result=await collect(request);if(++phase===2){if(scenario==='run-replaced')f.manager.runs.set(A,{...f.manager.runs.get(A)});if(scenario==='lease-token'){const file=f.manager._lockPath(A),old=JSON.parse(fs.readFileSync(file));old.token=randomUUID();fs.writeFileSync(file,JSON.stringify(old));}if(scenario==='endpoint-token')f.manager.endpoints.set(A,{...f.manager.endpoints.get(A),token:'replacement'});if(scenario==='descriptor')f.descriptor.descriptorSha256=hash('changed');}return result;};
    const result=await f.manager.getConnections([A,B]);assert.equal(result.get(A).error.code,'webui_unavailable');if(scenario==='descriptor')assert.equal(result.get(B).error.code,'webui_unavailable');else assert.equal(result.get(B).connection.ownershipVerified,true);assert.equal(f.state.stops.length,0);
  });
});

test('a newly observed second-phase Node worker cannot hide another or wildcard listener',async t=>{
  const f=fixture(t);await f.configure(A);await f.configure(B);await f.manager.start(A);await f.manager.start(B);batchedEndpoints(f);const collect=f.host.observeNode,root=f.manager.runs.get(A).proof;
  for(const address of ['0.0.0.0','127.0.0.1'])await t.test(address,async()=>{
    let phase=0;f.host.observeNode=async request=>{const r=await collect(request);if(++phase===2){const added={pid:899998,parentPid:root.pid,createdAt:'2026-11-06T04:00:00Z',name:'node.exe',executable:root.executable};r.before.push(added);r.after.push(added);r.inspected.push(added);r.listeners.push({pid:added.pid,port:54000,address});}return r;};
    const result=await f.manager.getConnections([A,B]);assert.equal(result.get(A).error.code,address==='0.0.0.0'?'webui_config_not_local':'webui_unavailable');assert.equal(result.get(B).connection.ownershipVerified,true);
  });
});

test('two account leases cannot claim the same Node supervisor in one endpoint batch',async t=>{
  const f=fixture(t);await f.configure(A);await f.configure(B);await f.manager.start(A);await f.manager.start(B);const calls=batchedEndpoints(f),a=f.manager.runs.get(A),b=f.manager.runs.get(B);
  b.proof={...a.proof};b.lease.runtime={...a.lease.runtime};b.lease.runtimeTree=structuredClone(a.lease.runtimeTree);const {file,...saved}=b.lease;fs.writeFileSync(file,JSON.stringify(saved));
  const result=await f.manager.getConnections([A,B]);for(const id of [A,B])assert.equal(result.get(id).error.code,'webui_unavailable');assert.equal(calls.length,0);assert.equal(f.state.stops.length,0);
});

test('Node preparation recovery retains the explicitly configured shared installation lock root',t=>{
 const f=fixture(t),selector=new QQNodeSelection({root:f.store,read:()=>structuredClone(f.descriptor),lockRoot:f.options.lockRoot,processHost:f.host}),recovery=selector.prepared.preparationRecovery;
 fs.mkdirSync(f.options.lockRoot,{recursive:true});fs.writeFileSync(path.join(f.options.lockRoot,'configuration.edit'),'synthetic active marker');assert.equal(recovery.lockRoot,f.options.lockRoot);assert.throws(()=>recovery._references(f.descriptor.current.versionId),{code:'component_locked'});assert.equal(f.state.starts.length,0);
});

test('QCE 6.4.2 cannot start under Node without its managed native-child contract',async t=>{const f=fixture(t);await f.configure(A);const plugin=path.join(f.manager.instance(A).workDir,'plugins','napcat-plugin-qce');fs.mkdirSync(plugin,{recursive:true});fs.writeFileSync(path.join(plugin,'package.json'),JSON.stringify({name:'napcat-plugin-qce',version:'6.4.2'}));await assert.rejects(f.manager.start(A),{code:'qce_version_unsupported'});assert.equal(f.state.starts.length,0);assert.equal(f.state.stops.length,0);});
