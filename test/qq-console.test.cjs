'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {QQConsole}=require('../src/bot/qq-console.cjs');
const id='123456789';
function statusRun(f){const run={proof:{pid:10001,parentPid:10000,createdAt:'2026-11-08T00:00:00.0000000Z',executable:'synthetic-private-path'}};f.runtime.runs=new Map([[id,run]]);return run;}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-console-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const calls=[];let endpoint='first',management='external';
  const runtime={
    discover:async()=>({configured:true,components:{qqVersion:'test'},instances:[{accountId:id,management,processRunning:true,canStart:false,canStop:management==='owned'}]}),
    instance:value=>{assert.equal(value,id);return {};},
    getConnection:async()=>({port:6000,token:'fixture-secret-do-not-export',endpointId:endpoint,ownershipVerified:true}),
    getConnections:async ids=>new Map(await Promise.all(ids.map(async value=>[value,{connection:await runtime.getConnection(value)}]))),
    assertWritable:async()=>{if(management!=='owned')throw Object.assign(Error('External manager'),{code:'not_owned'});},
    start:async()=>{management='owned';calls.push('start');},stop:async()=>{management='stopped';calls.push('stop');},
    recover:async()=>{management='owned';calls.push('recover');return {recovery:'adopted'};},
    close:async()=>{if(management==='owned')await runtime.stop(id);return {closed:true,failures:[]};},
    logs:()=>({events:[{type:'session_expired',time:'00:41:54'}]}),
  };
  const client={status:async()=>({state:'online',online:true,identityVerified:true,accountId:id}),qr:async()=>({url:'https://ntlogin.qq.com/test',state:'login_required'}),quickLogin:async()=>{calls.push('quick');return {requested:true};},close:()=>calls.push('client-close')};
  const profiles={list:async()=>[{accountId:id,servers:[{serverName:'fixture',port:3001,enabled:true,loopbackOnly:true,hasToken:true}]}],configure:async()=>({created:true,backupCreated:false}),connection:()=>({accountId:id,serverName:'fixture',url:'ws://127.0.0.1:3001',token:'fixture-secret-do-not-export'})};
  const manager=new QQConsole({root,runtimeFactory:()=>runtime,clientFactory:()=>client,profileFactory:()=>profiles,qrEncoder:async()=> 'data:image/png;base64,fixture'});
  return {manager,runtime,client,profiles,calls,root,changeEndpoint:()=>{endpoint='replacement';},own:()=>{management='owned';}};
}
test('renderer snapshot has real state fields but no management tokens or QR URLs',async t=>{
  const {manager}=fixture(t);const state=await manager.refresh();assert.equal(state.instances[0].login.state,'online');assert.ok(!JSON.stringify(state).includes('secret'));assert.ok(!JSON.stringify(state).includes('Credential'));await manager.close();
});

test('a pending refresh preserves the last state; completed status failure is remembered without extra checks',async t=>{
 const f=fixture(t);statusRun(f);let batches=0,statuses=0;const original=f.runtime.getConnections;f.runtime.getConnections=async ids=>{batches++;return original(ids);};
 const first=await f.manager.refresh();let reject;f.client.status=()=>{statuses++;return new Promise((resolve,r)=>{reject=r;});};const pending=f.manager.refresh();while(!reject)await new Promise(r=>setImmediate(r));
 assert.equal(f.manager.snapshot(),first);assert.equal(f.manager.statusIssues.size,0);reject(Object.assign(Error('PRIVATE_RAW'),{code:'timeout'}));const failed=await pending;
 assert.equal(failed.instances[0].login.state,'unknown');assert.equal(failed.instances[0].lastStatusIssue.code,'timeout');assert.equal(failed.instances[0].lastStatusIssue.phase,'webui-status');assert(!JSON.stringify(failed).includes('PRIVATE_RAW'));
 const remembered=failed.instances[0].lastStatusIssue;f.client.status=async()=>{statuses++;return{state:'online',online:true,identityVerified:true,accountId:id};};const recovered=await f.manager.refresh();
 assert.equal(recovered.instances[0].login.state,'online');assert.deepEqual(recovered.instances[0].lastStatusIssue,remembered);assert.equal(batches,6);assert.equal(statuses,2);await f.manager.close();assert.equal(f.manager.statusIssues.size,0);
});

test('first and second endpoint errors preserve their refusal semantics and fixed diagnostic phase',async t=>{
 for(const phase of [1,2]){const f=fixture(t);statusRun(f);await f.manager.refresh();let calls=0;const original=f.runtime.getConnections;f.runtime.getConnections=async ids=>++calls===phase?new Map([[id,{error:{code:'webui_unavailable',stage:'tree-stability',message:'PRIVATE_RAW'}}]]):original(ids);
  const row=(await f.manager.refresh()).instances[0];assert.equal(row.login.state,'unknown');assert.equal(row.login.online,false);assert.equal(row.lastStatusIssue.phase,`endpoint-${phase===1?'before':'after'}:tree-stability`);assert.equal(row.lastStatusIssue.code,phase===1?'webui_unavailable':'endpoint_recheck_unavailable');assert(!row.runtimeRevision);assert.equal(calls,2);if(phase===2)assert(!f.manager.clients.has(id));assert(!JSON.stringify(row.lastStatusIssue).includes('PRIVATE_RAW'));await f.manager.close();}
});

test('offline remains offline and is not turned into an observation failure',async t=>{
 const f=fixture(t);statusRun(f);f.client.status=async()=>({state:'offline',online:false,identityVerified:true,accountId:id});const row=(await f.manager.refresh()).instances[0];assert.equal(row.login.state,'offline');assert.equal(row.login.online,false);assert(!row.lastStatusIssue);assert.equal(f.manager.statusIssues.size,0);await f.manager.close();
});

test('a stale completed refresh cannot publish its diagnostic or replace the current snapshot',async t=>{
 const f=fixture(t);statusRun(f);const first=await f.manager.refresh();let reject;f.client.status=()=>new Promise((resolve,r)=>{reject=r;});const pending=f.manager.refresh();while(!reject)await new Promise(r=>setImmediate(r));f.manager.refreshRevision++;reject(Object.assign(Error('synthetic'),{code:'timeout'}));await assert.rejects(pending,{code:'changed'});assert.equal(f.manager.snapshot(),first);assert.equal(f.manager.statusIssues.size,0);await f.manager.close();
});

test('replacement runs, changed proof, removed accounts and new manager epochs cannot inherit an old issue',async t=>{
 for(const change of ['run','proof','removed','epoch']){const f=fixture(t),run=statusRun(f);f.client.status=async()=>{throw Object.assign(Error('synthetic'),{code:'timeout'});};await f.manager.refresh();assert.equal(f.manager.statusIssues.size,1);
  f.client.status=async()=>({state:'online',online:true,identityVerified:true,accountId:id});if(change==='run')f.runtime.runs.set(id,{proof:{...run.proof}});if(change==='proof')run.proof.createdAt='2026-11-08T00:00:01.0000000Z';if(change==='removed')f.runtime.discover=async()=>({configured:true,instances:[]});if(change==='epoch')f.manager.epoch++;
  const state=await f.manager.refresh();assert(state.instances.every(r=>!r.lastStatusIssue));assert.equal(f.manager.statusIssues.size,0);await f.manager.close();}
});

test('a run replaced while status is pending does not receive that old failure',async t=>{
 const f=fixture(t),run=statusRun(f);let reject;f.client.status=()=>new Promise((resolve,r)=>{reject=r;});const pending=f.manager.refresh();while(!reject)await new Promise(r=>setImmediate(r));f.runtime.runs.set(id,{proof:{...run.proof,createdAt:'2026-11-08T00:00:02.0000000Z'}});reject(Object.assign(Error('synthetic'),{code:'timeout'}));const state=await pending;assert(!state.instances[0].lastStatusIssue);assert.equal(f.manager.statusIssues.size,0);await f.manager.close();
});

test('last status issue is isolated to its own runtime account and unknown stages do not leak',async t=>{
 const f=fixture(t),run=statusRun(f),other='123456780',discover=f.runtime.discover;f.runtime.runs.set(other,{proof:{...run.proof,pid:10002}});f.runtime.discover=async()=>{const value=await discover();value.instances.push({...value.instances[0],accountId:other});return value;};f.manager.clientFactory=({accountId})=>accountId===id?f.client:{status:async()=>({state:'online',online:true,identityVerified:true,accountId}),close(){}};
 const original=f.runtime.getConnections;f.runtime.getConnections=async ids=>{const result=await original(ids);result.set(id,{error:{code:'PRIVATE_CODE',stage:'PRIVATE_STAGE',message:'PRIVATE_MESSAGE'}});return result;};const rows=(await f.manager.refresh()).instances;
 assert.equal(rows[0].lastStatusIssue.code,'unknown');assert.equal(rows[0].lastStatusIssue.phase,'endpoint-before');assert(!rows[1].lastStatusIssue);assert.equal(f.manager.statusIssues.size,1);assert(!JSON.stringify(rows[0].lastStatusIssue).includes('PRIVATE'));await f.manager.close();
});
test('plugin deployment marker blocks competing runtime actions without clearing its owner',async t=>{
 const f=fixture(t);f.manager.busy.add('qq-plugin-deployment');
 for(const kind of ['start','stop','recover','quick','qr'])await assert.rejects(f.manager.perform(kind,{accountId:id}),{code:'operation_in_progress'});
 assert.deepEqual(f.calls,[]);assert(f.manager.busy.has('qq-plugin-deployment'));f.manager.busy.delete('qq-plugin-deployment');await f.manager.close();
});

test('the explicit Electron profile and encryption backend reach each runtime without appearing in snapshots',async t=>{
  const f=fixture(t),vault={isEncryptionAvailable:()=>true},profileRoot=path.join(f.root,'electron-profile');let options;
  const manager=new QQConsole({root:f.root,vault,profileRoot,runtimeFactory:value=>{options=value;return f.runtime;},clientFactory:()=>f.client,profileFactory:()=>f.profiles});
  assert.equal(options.vault,vault);assert.equal(options.profileRoot,profileRoot);assert.doesNotMatch(JSON.stringify(await manager.refresh()),/electron-profile|isEncryptionAvailable/);
});
test('recovered endpoint still requires client identity validation and persistence warnings are non-blocking',async t=>{
  const f=fixture(t);f.own();const endpoint={port:6000,token:'fixture-secret-do-not-export',endpointId:'encrypted-recovery',ownershipVerified:true,endpointRecoveryIssue:'endpoint_recovery_unavailable'};
  f.runtime.getConnection=async()=>endpoint;
  let row=(await f.manager.refresh()).instances[0];assert.equal(row.login.state,'online');assert.equal(row.endpointRecoveryIssue,'endpoint_recovery_unavailable');assert(row.canStop);
  f.client.status=async()=>{throw Object.assign(Error('Wrong runtime account'),{code:'account_changed'});};
  row=(await f.manager.refresh()).instances[0];assert.equal(row.login.online,false);assert.equal(row.login.issue,'account_changed');assert(!row.runtimeRevision);assert.doesNotMatch(JSON.stringify(row),/fixture-secret|encrypted-recovery/);
});
test('unknown or changed endpoint cannot report an online account or expose a stale QR',async t=>{
  const f=fixture(t);f.client.status=async()=>{f.changeEndpoint();return {state:'online',online:true};};
  assert.equal((await f.manager.refresh()).instances[0].login.issue,'changed');
  f.client.qr=async()=>{f.changeEndpoint();f.runtime.getConnection=async()=>({endpointId:'third',ownershipVerified:true});return {url:'https://ntlogin.qq.com/test'};};
  await assert.rejects(f.manager.perform('qr',{accountId:id}),{code:'changed'});await f.manager.close();
});
test('read QR for an external instance, but do not mutate its login or refresh',async t=>{
  const {manager,calls}=fixture(t);const result=await manager.perform('qr',{accountId:id});assert.equal(result.image,'data:image/png;base64,fixture');assert.ok(!JSON.stringify(result).includes('https:'));
  await assert.rejects(manager.perform('qr',{accountId:id,refresh:true}),{code:'not_owned'});
  await assert.rejects(manager.perform('quick',{accountId:id}),{code:'not_owned'});assert.ok(!calls.includes('quick'));await manager.close();assert.ok(!calls.includes('stop'));
});

test('public runtime revision is opaque, stable per endpoint and rotates after replacement',async t=>{
  const f=fixture(t),first=(await f.manager.refresh()).instances[0].runtimeRevision;
  assert.match(first,/^[a-f0-9-]{36}$/);assert.notEqual(first,'first');
  assert.equal((await f.manager.perform('qr',{accountId:id})).runtimeRevision,first);
  assert.equal((await f.manager.refresh()).instances[0].runtimeRevision,first);
  f.changeEndpoint();assert.notEqual((await f.manager.refresh()).instances[0].runtimeRevision,first);await f.manager.close();
});

test('missing endpoint recheck revokes identity without claiming a confirmed endpoint change',async t=>{
  const f=fixture(t),first=(await f.manager.refresh()).instances[0];
  const original=f.runtime.getConnections;let calls=0;
  f.runtime.getConnections=async ids=>++calls===2?new Map([[id,{error:{code:'webui_unavailable',message:'PRIVATE_RAW_FAILURE'}}]]):original(ids);
  const row=(await f.manager.refresh()).instances[0];
  assert.deepEqual(row.login,{state:'unknown',online:false,issue:'endpoint_recheck_unavailable'});
  assert(!row.runtimeRevision);assert(!f.manager.clients.has(id));assert(!JSON.stringify(row).includes('PRIVATE_RAW_FAILURE'));
  f.runtime.getConnections=original;const recovered=(await f.manager.refresh()).instances[0];
  assert.equal(recovered.login.online,true);assert.notEqual(recovered.runtimeRevision,first.runtimeRevision);await f.manager.close();
});

test('unverified endpoint recheck stays unknown while a verified mismatch is changed',async t=>{
  for(const fresh of [{endpointId:'first',ownershipVerified:false},{endpointId:'replacement',ownershipVerified:true}]){
    const f=fixture(t);let calls=0;const original=f.runtime.getConnections;
    f.runtime.getConnections=async ids=>++calls===2?new Map([[id,{connection:fresh}]]):original(ids);
    const row=(await f.manager.refresh()).instances[0];
    assert.equal(row.login.state,'unknown');assert.equal(row.login.online,false);assert(!row.runtimeRevision);
    assert.equal(row.login.issue,fresh.ownershipVerified?'changed':'endpoint_recheck_unavailable');await f.manager.close();
  }
});

test('a non-local Node management endpoint stays classified before or after the status read',async t=>{
  for(const phase of [1,2]){
    const f=fixture(t);f.own();const original=f.runtime.getConnections;let calls=0;
    f.runtime.getConnections=async ids=>++calls===phase?new Map([[id,{error:{code:'webui_config_not_local',message:'PRIVATE_RAW_CONFIGURATION'}}]]):original(ids);
    const row=(await f.manager.refresh()).instances[0];
    assert.deepEqual(row.login,{state:'unknown',online:false,issue:'webui_config_not_local'});
    assert.equal(row.canStop,true);assert(!row.runtimeRevision);assert(!f.manager.clients.has(id));
    assert.doesNotMatch(JSON.stringify(row),/PRIVATE_RAW_CONFIGURATION/);await f.manager.close();
  }
});

test('a QR whose runtime changes during image encoding is discarded',async t=>{
  const f=fixture(t);f.manager.qrEncoder=async()=>{f.changeEndpoint();return 'data:image/png;base64,stale';};
  await assert.rejects(f.manager.perform('qr',{accountId:id}),{code:'changed'});await f.manager.close();
});
test('QR has exactly one fresh endpoint before HTTP and one after local encoding',async t=>{
  const f=fixture(t),order=[],read=f.runtime.getConnection;
  f.runtime.getConnection=async(...args)=>{order.push('endpoint');return read(...args);};
  f.client.qr=async()=>{order.push('http');return {url:'https://ntlogin.qq.com/test',state:'login_required'};};
  f.manager.qrEncoder=async()=>{order.push('encode');return 'data:image/png;base64,fixture';};
  assert.equal((await f.manager.perform('qr',{accountId:id})).image,'data:image/png;base64,fixture');
  assert.deepEqual(order,['endpoint','http','encode','endpoint']);
});
test('QR cannot expose an image after scope changes during HTTP or the encoder',async t=>{
  for(const at of ['http','encoder'])await t.test(at,async t=>{
    const f=fixture(t);let encoded=false;
    f.client.qr=async()=>{if(at==='http')f.manager.epoch++;return {url:'https://ntlogin.qq.com/test',state:'login_required'};};
    f.manager.qrEncoder=async()=>{encoded=true;f.manager.epoch++;return 'data:image/png;base64,late';};
    await assert.rejects(f.manager.perform('qr',{accountId:id}),{code:'changed'});assert.equal(encoded,at==='encoder');
  });
});
test('normal shutdown stops only owned runtime, after clearing management credentials',async t=>{
  const {manager,calls,own}=fixture(t);own();await manager.refresh();await manager.close();assert.deepEqual(calls,['client-close','stop']);
});

test('explicit recovery replaces a stale client only after runtime ownership checks',async t=>{
  const {manager,calls,runtime}=fixture(t);await manager.refresh();
  runtime.recover=async()=>{throw Object.assign(Error('Previous manager is alive'),{code:'owner_alive'});};
  await assert.rejects(manager.perform('recover',{accountId:id}),{code:'owner_alive'});assert.ok(!calls.includes('client-close'));
  runtime.recover=async()=>({recovery:'cleared'});const result=await manager.perform('recover',{accountId:id});
  assert.equal(result.recovery,'cleared');assert.ok(calls.includes('client-close'));await manager.close();
});
test('directory change cannot race a newly started runtime operation',async t=>{
  const f=fixture(t);let release;const waiting=new Promise(resolve=>{release=resolve;});
  let count=0;const original=f.runtime.discover;f.runtime.discover=async()=>{if(++count===2)await waiting;const view=await original();return {...view,instances:[]};};
  const change=f.manager.setDirectory(f.root);await new Promise(resolve=>setImmediate(resolve));f.manager.busy.add(id);release();
  await assert.rejects(change,{code:'operation_in_progress'});assert.equal(fs.existsSync(f.manager.file),false);f.manager.busy.clear();await f.manager.close();
});
test('closing while authentication is pending prevents stale state delivery',async t=>{
  const f=fixture(t);let release;f.client.status=()=>new Promise(resolve=>{release=resolve;});const pending=f.manager.refresh();await new Promise(resolve=>setImmediate(resolve));await f.manager.close();release({state:'online',online:true});await assert.rejects(pending,{code:'changed'});assert.equal(f.manager.snapshot(),null);
});

test('refresh uses two endpoint batches and exposes only non-secret bridge summaries',async t=>{
  const f=fixture(t);let batches=0;const original=f.runtime.getConnections;
  f.runtime.getConnections=async ids=>{batches++;return original(ids);};
  const state=await f.manager.refresh();assert.equal(batches,2);assert.equal(state.instances[0].bridges[0].hasToken,true);
  assert.ok(!JSON.stringify(state).includes('fixture-secret'));await f.manager.close();
});

test('committed profile edits remain reported as saved when later discovery fails',async t=>{
  const f=fixture(t);let writes=0;f.profiles.configure=async()=>{writes++;return {created:false,backupCreated:true};};
  f.runtime.discover=async()=>{throw Object.assign(Error('Discovery failed'),{code:'process_check_failed'});};
  const result=await f.manager.configure(id,{});assert.deepEqual(result,{configured:true,created:false,backupCreated:true,refreshIssue:'process_check_failed'});assert.equal(writes,1);await f.manager.close();
});

test('linking imports only the selected local bridge into the existing encrypted-vault entry point',async t=>{
  const f=fixture(t);let saved,connected=0;
  const service={status:'disconnected',assertCredentialsAvailable(){},configure(value){saved=value;},connect(){connected++;}};
  const result=f.manager.link(id,{serverName:'fixture',ownerId:'987654321'},service);
  assert.deepEqual(result,{linked:true});assert.equal(saved.qqAccountId,id);assert.equal(saved.qqOwnerId,'987654321');assert.equal(saved.qqToken,'fixture-secret-do-not-export');assert.equal(saved.channel,'qq');assert.equal(connected,0);assert.ok(!JSON.stringify(result).includes('secret'));await f.manager.close();
});

test('linking rejects a running companion, locked vault or agent account as its owner before importing',async t=>{
  const f=fixture(t);let writes=0;const service={status:'connected',assertCredentialsAvailable(){},configure(){writes++;}};
  assert.throws(()=>f.manager.link(id,{ownerId:'987654321'},service),{code:'account_connected'});
  service.status='disconnected';assert.throws(()=>f.manager.link(id,{ownerId:id},service),{code:'owner_is_agent_account'});
  service.assertCredentialsAvailable=()=>{throw Error('locked');};assert.throws(()=>f.manager.link(id,{ownerId:'987654321'},service),{code:'credentials_locked'});assert.equal(writes,0);await f.manager.close();
});

test('stop holds the manager operation across companion disconnection and refuses reconfiguration',async t=>{
  const f=fixture(t);f.own();let release,prepared=false;
  const pending=f.manager.perform('stop',{accountId:id},async()=>{prepared=true;await new Promise(resolve=>{release=resolve;});});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(prepared,true);assert.ok(!f.calls.includes('stop'));
  await assert.rejects(f.manager.setDirectory(f.root),{code:'operation_in_progress'});
  await assert.rejects(f.manager.configure(id,{}),{code:'operation_in_progress'});
  await assert.rejects(f.manager.perform('recover',{accountId:id}),{code:'operation_in_progress'});
  release();await pending;assert.ok(f.calls.includes('stop'));await f.manager.close();
});

test('an external account cannot disconnect a companion through the stop preparation callback',async t=>{
  const f=fixture(t);let called=false;
  await assert.rejects(f.manager.perform('stop',{accountId:id},async()=>{called=true;}),{code:'not_owned'});
  assert.equal(called,false);assert.ok(!f.calls.includes('stop'));await f.manager.close();
});

test('backup restore is exclusive and committed results survive a failed status refresh',async t=>{
  const f=fixture(t);let release,restores=0;
  f.manager.backupFactory=()=>({restore:async()=>{restores++;await new Promise(resolve=>{release=resolve;});return {restored:true,sha256:'a'.repeat(64),companionCredentialsUpdated:false};}});
  const pending=f.manager.restoreBackup(id,{});await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(f.manager.configure(id,{}),{code:'operation_in_progress'});assert.throws(()=>f.manager.listBackups(id),{code:'operation_in_progress'});await assert.rejects(f.manager.setDirectory(f.root),{code:'operation_in_progress'});
  f.runtime.discover=async()=>{throw Object.assign(Error('No status'),{code:'process_check_failed'});};release();const result=await pending;assert.equal(result.restored,true);assert.equal(result.refreshIssue,'process_check_failed');assert.equal(restores,1);assert.equal(f.manager.busy.size,0);await f.manager.close();
});

test('backup operations reject closed context and the restore callback checks manager identity',async t=>{
  const f=fixture(t);let guard,release;
  f.manager.backupFactory=options=>{guard=options.assertCurrent;return {restore:async()=>{await new Promise(resolve=>{release=resolve;});guard();return {restored:true};}};};
  const pending=f.manager.restoreBackup(id,{});await new Promise(resolve=>setImmediate(resolve));await f.manager.close();release();await assert.rejects(pending,{code:'changed'});assert.equal(f.manager.busy.size,0);assert.throws(()=>f.manager.listBackups(id),{code:'changed'});assert.throws(()=>f.manager.previewBackup(id,{}),{code:'changed'});
});
