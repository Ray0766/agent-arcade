'use strict';
const {until}=require('./helpers/until.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {QQRuntimeManager,classifyLogLine,MAX_LOG_BYTES}=require('../src/bot/qq-runtime.cjs');

// Synthetic installed files/process tables. These tests never launch or stop QQ.
const A='12345001',B='12345002';
const startDeferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(t,extra={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-runtime-'));
  const root=path.join(dir,'arcade'),desktopDataRoot=path.join(dir,'desktop'),componentsRoot=path.join(desktopDataRoot,'components'),runtime=path.join(componentsRoot,'NapCatQQ'),config=path.join(runtime,'config'),qq=path.join(componentsRoot,'QQ','versions','9.9.36-53644');
  for(const p of [root,config,qq])fs.mkdirSync(p,{recursive:true});
  for(const name of ['NapCatWinBootMain.exe','NapCatWinBootHook.dll','napcat.mjs','qqnt.json'])fs.writeFileSync(path.join(runtime,name),'fixture');
  fs.writeFileSync(path.join(runtime,'loadNapCat.js'),'original loader must remain unchanged');
  fs.writeFileSync(path.join(runtime,'package.json'),JSON.stringify({version:'0.0.1'}));
  fs.writeFileSync(path.join(qq,'QQ.exe'),'fixture');fs.writeFileSync(path.join(componentsRoot,'QQ','current.txt'),'9.9.36-53644');
  for(const id of [A,B])fs.writeFileSync(path.join(config,`onebot11_${id}.json`),'SECRET_NEVER_EXPORT');
  fs.writeFileSync(path.join(config,'webui.json'),'WEBUI_SECRET_NEVER_EXPORT');
  const self={pid:process.pid,parentPid:1,createdAt:'2026-11-05T12:00:00.0000000Z',name:'test.exe',executable:process.execPath};
  const state={rows:[self],starts:[],stops:[],next:800000,onSnapshot:null};
  const host={allocatePort:async()=>53000+state.starts.length,listeners:async()=>state.listeners||[],inspect:async pids=>state.rows.filter(p=>pids.includes(p.pid)).map(x=>({...x})),snapshot:async()=>{if(state.onSnapshot)await state.onSnapshot();return state.rows.map(x=>({...x}));},
    start:async plan=>{state.starts.push(plan);const pid=state.next++;state.rows.push({pid,parentPid:process.pid,name:'NapCatWinBootMain.exe',executable:plan.file,createdAt:'2026-11-05T13:00:00.1234567Z',accountId:plan.args.at(-1)});state.rows.push({pid:state.next++,parentPid:pid,name:'QQ.exe',executable:plan.args[0],createdAt:'2026-11-05T13:00:01.0000000Z'});return {pid};},
    stop:async proofs=>{state.stops.push(proofs);state.rows=state.rows.filter(p=>!proofs.some(v=>v.pid===p.pid));},
  };
  const options={root,desktopDataRoot,lockRoot:path.join(dir,'shared-locks'),platform:'win32',processHost:host,profileRoot:path.join(dir,'electron-profile'),...extra};
  const manager=new QQRuntimeManager(options);
  t.after(()=>{const resolved=fs.realpathSync(dir);assert(resolved.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  const addDesktop=()=>state.rows.push({pid:999001,parentPid:1,name:'NapCatQQ-Desktop.exe',executable:path.join(dir,'NapCatQQ-Desktop.exe'),createdAt:'2026-11-05T12:00:00Z'});
  return {dir,root,desktopDataRoot,componentsRoot,runtime,config,qq,state,host,options,manager,addDesktop};
}

test('guarded Shell start rejects pre-cancelled and asynchronous context checks without process inspection',async t=>{
  for(const [options,code]of [[{signal:AbortSignal.abort()},'start_cancelled'],[{assertCurrent:async()=>{}},'start_guard_invalid'],[{assertCurrent:()=>({then(){}})},'start_guard_invalid']])await t.test(code,async t=>{
    const f=fixture(t);let inspected=0;f.state.onSnapshot=()=>{inspected++;};await assert.rejects(f.manager.start(A,options),{code});assert.equal(inspected,0);assert.equal(f.state.starts.length,0);
  });
});
test('guarded Shell start rechecks after held process inspection before taking a component lock',async t=>{
  const f=fixture(t),entered=startDeferred(),release=startDeferred(),cancel=new AbortController();f.state.onSnapshot=async()=>{entered.resolve();await release.promise;};
  const operation=f.manager.start(A,{signal:cancel.signal});await entered.promise;cancel.abort();release.resolve();await assert.rejects(operation,{code:'start_cancelled'});assert.equal(f.state.starts.length,0);assert.equal(fs.existsSync(f.manager._lockPath(A)),false);
});
test('guarded Shell start cannot spawn after cancellation or scope change during port allocation',async t=>{
  for(const kind of ['cancel','scope'])await t.test(kind,async t=>{
    const f=fixture(t),entered=startDeferred(),release=startDeferred(),cancel=new AbortController();let current=true;f.host.allocatePort=async()=>{entered.resolve();await release.promise;return 53000;};
    const operation=f.manager.start(A,{signal:cancel.signal,assertCurrent:()=>{if(!current)throw Error('PRIVATE SCOPE DETAIL');}});await entered.promise;if(kind==='cancel')cancel.abort();else current=false;release.resolve();
    await assert.rejects(operation,error=>{assert.equal(error.code,kind==='cancel'?'start_cancelled':'start_context_changed');assert.doesNotMatch(error.message,/PRIVATE/);return true;});assert.equal(f.state.starts.length,0);assert.equal(f.state.stops.length,0);assert.equal(fs.existsSync(f.manager._lockPath(A)),false);
  });
});
test('guarded Shell start composes ownership and caller checks at the host spawn boundary',async t=>{
  const f=fixture(t);let current=true,atBoundary=false;f.host.start=async plan=>{atBoundary=true;current=false;plan.beforeSpawn();assert.fail('late spawn');};
  await assert.rejects(f.manager.start(A,{assertCurrent:()=>{if(!current)throw Error('changed');}}),{code:'start_context_changed'});assert(atBoundary);assert.equal(fs.existsSync(f.manager._lockPath(A)),false);assert.equal(f.state.starts.length,0);
});
test('guarded Shell start rejects an asynchronous component ownership guard',async t=>{
  const f=fixture(t),selection=f.manager.componentSelection(),withStartLock=selection.withStartLock.bind(selection);
  selection.withStartLock=operation=>withStartLock((plan,owned)=>operation(plan,()=>{owned();return Promise.resolve();}));
  await assert.rejects(f.manager.start(A,{assertCurrent:()=>{}}),{code:'start_guard_invalid'});assert.equal(f.state.starts.length,0);assert.equal(fs.existsSync(f.manager._lockPath(A)),false);
});
test('guarded Shell start retains a proven started runtime after late cancellation without stopping it',async t=>{
  const f=fixture(t),cancel=new AbortController(),start=f.host.start;f.host.start=async plan=>{plan.beforeSpawn();const child=await start(plan);cancel.abort();return child;};
  const result=await f.manager.start(A,{signal:cancel.signal});assert.equal(result.management,'owned');assert.equal(f.state.starts.length,1);assert.equal(f.state.stops.length,0);assert(f.manager.runs.get(A).proof);await f.manager.stop(A);
});
test('the real Windows host evaluates its synchronous guard before attempting spawn',async()=>{
  const {createWindowsProcessHost}=require('../src/bot/qq-runtime.cjs'),host=createWindowsProcessHost(),sentinel=Object.assign(new Error('fixed test guard'),{code:'test_guard'});
  await assert.rejects(host.start({file:'NOT_AN_EXECUTABLE',args:[],beforeSpawn:()=>{throw sentinel;}}),error=>error===sentinel);
  await assert.rejects(host.start({file:'NOT_AN_EXECUTABLE',args:[],beforeSpawn:async()=>{}}),{code:'start_guard_invalid'});
});

test('discovery reads fixed installed metadata without returning credentials or using package version as release',async t=>{
  const f=fixture(t);const log=path.join(f.desktopDataRoot,'logs','bots','bots');fs.mkdirSync(log,{recursive:true});fs.writeFileSync(path.join(log,`${A}.log`),'11-05 20:00:00 [INFO] NapCat.Core Version: 4.18.42\n');
  const result=await f.manager.discover();assert.equal(result.configured,true);assert.equal(result.components.napcatVersion,'4.18.42');assert.equal(result.components.qqVersion,'9.9.36-53644');assert.deepEqual(result.instances.map(x=>x.accountId),[A,B]);assert(result.instances.every(x=>x.canStart));assert.doesNotMatch(JSON.stringify(result),/SECRET|token|0\.0\.1/);assert.equal(f.state.starts.length,0);assert.deepEqual(fs.readdirSync(f.root),[]);
  assert.throws(()=>f.manager.instance('../12345'),{code:'invalid_account'});assert.throws(()=>f.manager.instance('99999999'),{code:'invalid_account'});
});

test('plugin deployment holds the existing configuration lease and preserves unrelated configuration',async t=>{
 const f=fixture(t),before=fs.readFileSync(path.join(f.config,`onebot11_${A}.json`));
 const result=await f.manager.withPluginDeploymentLock(A,async install=>{
  assert(fs.existsSync(path.join(f.options.lockRoot,'configuration.edit')));
  await install.assertStopped();return {checked:true};
 });
 assert.deepEqual(result,{checked:true});assert.deepEqual(fs.readFileSync(path.join(f.config,`onebot11_${A}.json`)),before);
 assert.equal(f.state.starts.length,0);assert.equal(f.state.stops.length,0);assert.equal(fs.readdirSync(f.options.lockRoot).length,0);
});
test('plugin deployment refuses another running account sharing its plugin work directory',async t=>{
 const f=fixture(t);await f.manager.start(B);let entered=false;
 await assert.rejects(f.manager.withPluginDeploymentLock(A,async()=>{entered=true;}),error=>['runtime_running','runtime_locked'].includes(error.code));
 assert.equal(entered,false);assert.equal(f.state.stops.length,0);assert(f.manager.runs.has(B));await f.manager.stop(B);
});
test('plugin deployment rechecks late external processes without stopping them',async t=>{
 const f=fixture(t);
 await assert.rejects(f.manager.withPluginDeploymentLock(A,async install=>{
  f.state.rows.push({pid:700002,parentPid:1,name:'QQ.exe',executable:path.join(f.qq,'QQ.exe'),createdAt:'2026-11-05T10:00:00Z'});
  await install.assertStopped();assert.fail('late process must prevent file mutation');
 }),{code:'external_qq_unknown'});
 assert.equal(f.state.stops.length,0);assert.equal(f.state.starts.length,0);
});
test('plugin deployment refuses a stale shared-account lease even when process observation misses it',async t=>{
 const f=fixture(t);fs.mkdirSync(f.options.lockRoot,{recursive:true});
 fs.writeFileSync(f.manager._lockPath(B),'SYNTHETIC_STALE_LEASE');
 await assert.rejects(f.manager.withPluginDeploymentLock(A,async()=>assert.fail()),{code:'runtime_locked'});
 assert.equal(fs.readFileSync(f.manager._lockPath(B),'utf8'),'SYNTHETIC_STALE_LEASE');assert.equal(f.state.starts.length,0);
});
test('interrupted plugin deployment blocks managed startup and is visible in discovery',async t=>{
 const f=fixture(t),history=path.join(f.runtime,'.agent-arcade-plugin-history');fs.mkdirSync(history);fs.writeFileSync(path.join(history,'pending.json'),'SYNTHETIC INCOMPLETE JOURNAL');
 await assert.rejects(f.manager.start(A),{code:'deployment_recovery_required'});assert.equal(f.state.starts.length,0);
 const state=await f.manager.discover();assert(state.instances.every(row=>!row.canStart&&row.reason==='deployment_recovery_required'));
 assert.equal(fs.readFileSync(path.join(history,'pending.json'),'utf8'),'SYNTHETIC INCOMPLETE JOURNAL');
});

test('Desktop running blocks management before spawning or writing a lock',async t=>{
  const f=fixture(t);f.addDesktop();await assert.rejects(f.manager.start(A),{code:'desktop_running'});assert.equal(f.state.starts.length,0);assert(!fs.existsSync(f.options.lockRoot));const state=await f.manager.discover();assert(state.desktopRunning);assert.equal(state.instances[0].canStart,false);
});

test('a running external account and unidentified same-component QQ are never taken over',async t=>{
  const f=fixture(t);f.state.rows.push({pid:700001,parentPid:1,name:'NapCatWinBootMain.exe',executable:path.join(f.runtime,'NapCatWinBootMain.exe'),createdAt:'2026-11-05T10:00:00Z',accountId:A});
  await assert.rejects(f.manager.start(A),{code:'external_process'});await assert.rejects(f.manager.stop(A),{code:'not_owned'});assert.equal(f.state.stops.length,0);
  f.state.rows=f.state.rows.slice(0,1);f.state.rows.push({pid:700002,parentPid:1,name:'QQ.exe',executable:path.join(f.qq,'QQ.exe'),createdAt:'2026-11-05T10:00:00Z'});
  await assert.rejects(f.manager.start(A),{code:'external_qq_unknown'});assert.equal(f.state.starts.length,0);
});

test('owned start and stop isolate one account and leave installed configs and loader unchanged',async t=>{
  const f=fixture(t);let changes=0;f.manager.onChange=()=>changes++;
  const a=await f.manager.start(A),b=await f.manager.start(B);assert.equal(a.management,'owned');assert(a.canStop);assert(b.canStop);assert.equal(f.state.starts.length,2);
  const plan=f.state.starts[0];assert.deepEqual(plan.args,[path.join(f.qq,'QQ.exe'),path.join(f.runtime,'NapCatWinBootHook.dll'),A]);assert(!('ELECTRON_RUN_AS_NODE' in plan.env));assert(!('NODE_OPTIONS' in plan.env));assert.notEqual(plan.env.NAPCAT_LOAD_PATH,path.join(f.runtime,'loadNapCat.js'));
  assert.equal(plan.env.NAPCAT_WEBUI_PREFERRED_PORT,'53000');assert.equal(f.state.starts[1].env.NAPCAT_WEBUI_PREFERRED_PORT,'53001');
  assert.equal(fs.readFileSync(path.join(f.runtime,'loadNapCat.js'),'utf8'),'original loader must remain unchanged');assert.equal(fs.readFileSync(path.join(f.config,`onebot11_${A}.json`),'utf8'),'SECRET_NEVER_EXPORT');
  assert.equal((await f.manager.assertWritable(A)).accountId,A);const stopped=await f.manager.stop(A);assert(stopped.canStart);assert.equal(f.state.stops.length,1);assert.equal(f.state.stops[0].length,2);
  const status=await f.manager.discover();assert.equal(status.instances.find(x=>x.accountId===B).management,'owned');await f.manager.stop(B);assert.equal(fs.readdirSync(f.options.lockRoot).length,0);assert(changes>4);
});

test('shared per-account lease blocks a second profile even if its stale process view misses the first runtime',async t=>{
  const f=fixture(t);await f.manager.start(A);const otherHost={...f.host,snapshot:async()=>[f.state.rows[0]]};const other=new QQRuntimeManager({...f.options,root:path.join(f.dir,'second-profile'),processHost:otherHost});
  await assert.rejects(other.start(A),{code:'runtime_locked'});assert.equal(f.state.starts.length,1);await f.manager.stop(A);
});

function addConsoleOnStart(f,change=()=>{}){
  const start=f.host.start;
  f.host.start=async plan=>{
    const result=await start(plan),consoleHost={pid:f.state.next++,parentPid:result.pid,name:'conhost.exe',executable:path.resolve(process.env.SystemRoot||'C:\\Windows','System32','conhost.exe'),createdAt:'2026-11-05T13:00:02.0000000Z'};
    change(consoleHost,result);f.state.rows.push(consoleHost);return result;
  };
}

test('the exact Windows console host directly parented by the launcher is owned and stopped with its account',async t=>{
  const f=fixture(t);addConsoleOnStart(f);
  const started=await f.manager.start(A);assert.equal(started.management,'owned');assert(started.canStop);
  const consoleHost=f.state.rows.find(p=>p.name==='conhost.exe');
  const unrelated={...consoleHost,pid:f.state.next++,parentPid:1};f.state.rows.push(unrelated);
  assert((await f.manager.discover()).instances.find(p=>p.accountId===A).canStop);
  await f.manager.stop(A);assert.equal(f.state.stops[0].length,3);assert(f.state.stops[0].some(p=>p.pid===consoleHost.pid&&p.createdAt===consoleHost.createdAt&&p.executable===consoleHost.executable));assert(f.state.rows.some(p=>p.pid===unrelated.pid));
});

test('console ownership rejects non-system paths, a QQ parent, and arbitrary launcher descendants',async t=>{
  const cases=[
    ['other directory',(f,p)=>{p.executable=path.join(f.dir,'conhost.exe');}],
    ['QQ parent',(f,p)=>{p.parentPid=f.state.rows.find(row=>row.name==='QQ.exe').pid;}],
    ['other executable',(f,p)=>{p.name='cmd.exe';p.executable=path.resolve(process.env.SystemRoot||'C:\\Windows','System32','cmd.exe');}],
    ['missing creation time',(_f,p)=>{p.createdAt='';}],
  ];
  for(const [name,change]of cases)await t.test(name,async t=>{
    const f=fixture(t);addConsoleOnStart(f,p=>change(f,p));
    await assert.rejects(f.manager.start(A),{code:'ownership_lost'});assert.equal(f.state.stops.length,0);
    const status=(await f.manager.discover()).instances.find(p=>p.accountId===A);assert.equal(status.canStop,false);assert.equal(status.reason,'ownership_lost');
  });
});

test('a recorded console host with a reused PID or changed parent prevents stopping',async t=>{
  const f=fixture(t);addConsoleOnStart(f);await f.manager.start(A);
  const consoleHost=f.state.rows.find(p=>p.name==='conhost.exe'),createdAt=consoleHost.createdAt;
  consoleHost.createdAt='2026-11-05T15:00:00.0000000Z';await assert.rejects(f.manager.stop(A),{code:'ownership_lost'});assert.equal(f.state.stops.length,0);
  consoleHost.createdAt=createdAt;consoleHost.parentPid=1;await assert.rejects(f.manager.stop(A),{code:'orphaned_children'});assert.equal(f.state.stops.length,0);
});

test('explicit recovery accepts a proven launcher console even when an older lease did not record its tree',async t=>{
  const f=fixture(t);addConsoleOnStart(f);await f.manager.start(A);const {next,file,lease}=abandoned(f);
  delete lease.runtimeTree;fs.writeFileSync(file,JSON.stringify(lease));
  const recovered=await next.recover(A);assert.equal(recovered.recovery,'adopted');assert(recovered.canStop);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).runtimeTree.length,3);
  await next.stop(A);assert.equal(f.state.stops[0].length,3);assert.equal(f.state.rows.length,1);
});

test('PID reuse and mismatching executable are rejected before stop',async t=>{
  const f=fixture(t);await f.manager.start(A);const target=f.state.rows.find(x=>x.accountId===A);target.createdAt='2026-11-05T14:00:00.1234567Z';await assert.rejects(f.manager.stop(A),{code:'ownership_lost'});assert.equal(f.state.stops.length,0);assert.equal((await f.manager.discover()).instances[0].canStop,false);
});

test('Desktop reopening blocks writes and stopping of even an owned runtime',async t=>{
  const f=fixture(t);await f.manager.start(A);f.addDesktop();await assert.rejects(f.manager.assertWritable(A),{code:'desktop_running'});await assert.rejects(f.manager.stop(A),{code:'desktop_running'});assert.equal(f.state.stops.length,0);
});

test('partial stop keeps ownership lock and reports failure',async t=>{
  const f=fixture(t);f.host.stop=async proofs=>{f.state.stops.push(proofs);};await f.manager.start(A);await assert.rejects(f.manager.stop(A),{code:'stop_failed'});assert.equal(fs.readdirSync(f.options.lockRoot).length,1);
});

test('a failed launch releases its unused lease, while unverified launched identity retains it',async t=>{
  const f=fixture(t);f.host.start=async()=>{throw Error('private detail SECRET');};await assert.rejects(f.manager.start(A),{code:'start_failed'});assert.equal(fs.readdirSync(f.options.lockRoot).length,0);
  f.host.start=async()=>({pid:888888});await assert.rejects(f.manager.start(A),{code:'start_unverified'});assert.equal(fs.readdirSync(f.options.lockRoot).length,1);assert.equal((await f.manager.discover()).instances[0].management,'unknown');await assert.rejects(f.manager.stop(A),{code:'ownership_lost'});
});

test('process enumeration errors fail closed without leaking original error',async t=>{
  const f=fixture(t);f.host.snapshot=async()=>{throw Error('token: SECRET');};const result=await f.manager.discover();assert.equal(result.issue,'process_check_failed');assert(result.instances.every(p=>!p.canStart&&!p.canStop));await assert.rejects(f.manager.start(A),e=>e.code==='process_check_failed'&&!e.message.includes('SECRET'));assert.equal(f.state.starts.length,0);
});

test('unsupported platform and incomplete installation are actionable discovery states',async t=>{
  const f=fixture(t);const linux=new QQRuntimeManager({...f.options,platform:'linux'});assert.equal((await linux.discover()).issue,'unsupported_platform');await assert.rejects(linux.start(A),{code:'unsupported_platform'});fs.unlinkSync(path.join(f.runtime,'NapCatWinBootHook.dll'));assert.equal((await f.manager.discover()).components.available,false);await assert.rejects(f.manager.start(A),{code:'missing_components'});
});

test('logs contain bounded structured diagnostics only, excluding message text and credentials',t=>{
  const f=fixture(t),log=path.join(f.desktopDataRoot,'logs','bots','bots');fs.mkdirSync(log,{recursive:true});
  fs.writeFileSync(path.join(log,`${A}.log`),'x'.repeat(MAX_LOG_BYTES+200)+'\n11-06 00:41:54 [WARN] [EventWrapper] KickedOffLine 账号当前登录已失效，请重新登录 token=PRIVATE\n11-06 00:41:58 [INFO] [Core] [Worker] restarting worker PRIVATE\n11-06 00:42:05 [收] private text QRcode expired SECRET\n');
  const result=f.manager.logs(A,{limit:2});assert.deepEqual(result.events.map(e=>e.type),['session_expired','worker_restart']);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET|账号当前|token/);assert.equal(result.rawMessagesIncluded,false);assert.equal(classifyLogLine('just a private message'),null);assert.equal(classifyLogLine('x'.repeat(9000)),null);
});

test('second lifecycle operation is rejected while the first ownership check is in flight',async t=>{
  const f=fixture(t);let release;let first=true;f.state.onSnapshot=()=>{if(first){first=false;return new Promise(r=>{release=r;});}};
  const starting=f.manager.start(A);await assert.rejects(f.manager.start(A),{code:'operation_in_progress'});release();await starting;await f.manager.stop(A);
});

test('each WebUI endpoint requires both per-account output and live owning process, never global config port',async t=>{
  const f=fixture(t);await f.manager.start(A);await f.manager.start(B);
  const planA=f.state.starts[0],planB=f.state.starts[1];planA.onOutput('[NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:6100/webui?token=PRIVATE_A');planB.onOutput('[NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:6101/webui?token=PRIVATE_B');
  const qa=f.state.rows.find(p=>p.name==='QQ.exe'&&p.parentPid===f.state.rows.find(p=>p.accountId===A).pid),qb=f.state.rows.find(p=>p.name==='QQ.exe'&&p.parentPid===f.state.rows.find(p=>p.accountId===B).pid);
  f.state.listeners=[{pid:qa.pid,address:'::',port:6100},{pid:qb.pid,address:'127.0.0.1',port:6101}];
  const a=await f.manager.getConnection(A),b=await f.manager.getConnection(B);assert.equal(a.port,6100);assert.equal(b.port,6101);assert.equal(a.token,'PRIVATE_A');assert.equal(a.loopbackOnly,false);assert.equal(b.loopbackOnly,true);assert.notEqual(a.endpointId,b.endpointId);
  assert.doesNotMatch(JSON.stringify(await f.manager.discover()),/PRIVATE/);assert.doesNotMatch(JSON.stringify(f.manager.logs(A)),/PRIVATE/);
  f.state.listeners[0].pid=qb.pid;await assert.rejects(f.manager.getConnection(A),{code:'webui_unavailable'});
});

test('external endpoint is recovered only from its own bounded log with live process ownership',async t=>{
  const f=fixture(t);f.addDesktop();const launcher={pid:700001,parentPid:1,name:'NapCatWinBootMain.exe',executable:path.join(f.runtime,'NapCatWinBootMain.exe'),createdAt:'2026-11-05T10:00:00Z',accountId:A};f.state.rows.push(launcher,{pid:700002,parentPid:launcher.pid,name:'QQ.exe',executable:path.join(f.qq,'QQ.exe'),createdAt:'2026-11-05T10:00:01Z'});f.state.listeners=[{pid:700002,address:'::',port:6105}];
  const log=path.join(f.desktopDataRoot,'logs','bots','bots');fs.mkdirSync(log,{recursive:true});fs.writeFileSync(path.join(log,`${A}.log`),'[NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:6105/webui?token=PRIVATE_OLD\n');
  const connection=await f.manager.getConnection(A);assert.equal(connection.port,6105);assert.equal(connection.source,'account-runtime-log');assert.equal(connection.ownershipVerified,true);
  f.state.listeners[0].port=6106;await assert.rejects(f.manager.getConnection(A),{code:'webui_unavailable'});
  fs.writeFileSync(path.join(log,`${A}.log`),'[NapCat] [WebUi] WebUi User Panel Url: http://evil.example:6106/webui?token=PRIVATE\n');await assert.rejects(f.manager.getConnection(A),{code:'webui_unavailable'});
});

test('endpoint diagnostics identify a transient descendant difference without accepting it',async t=>{
 const f=fixture(t);await f.manager.start(A);f.state.starts.at(-1).onOutput('[NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:6107/webui?token=FIXTURE_PRIVATE');const parent=f.state.rows.find(p=>p.accountId===A),listener=f.state.rows.find(p=>p.parentPid===parent.pid&&p.name==='QQ.exe');f.state.listeners=[{pid:listener.pid,address:'127.0.0.1',port:6107}];
 let calls=0;const original=f.host.snapshot;f.host.snapshot=async()=>{const rows=await original();if(++calls===2)rows.push({...listener,pid:800999,parentPid:listener.pid,createdAt:'2026-11-05T13:00:02.0000000Z'});return rows;};
 const first=(await f.manager.getConnections([A])).get(A);assert.equal(first.error.code,'webui_unavailable');assert.equal(first.error.stage,'tree-stability');assert(!first.connection);assert.equal(calls,2);
 f.host.snapshot=original;assert.equal((await f.manager.getConnections([A])).get(A).connection.ownershipVerified,true);assert.equal(f.state.starts.length,1);assert.equal(f.state.stops.length,0);
});

test('endpoint observation failures and listener mismatches retain existing errors with fixed stages',async t=>{
 const f=fixture(t);await f.manager.start(A);f.state.starts.at(-1).onOutput('[NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:6107/webui?token=FIXTURE_PRIVATE');const launcher=f.state.rows.find(p=>p.accountId===A),listener=f.state.rows.find(p=>p.parentPid===launcher.pid&&p.name==='QQ.exe');f.state.listeners=[{pid:listener.pid,address:'127.0.0.1',port:6107}];
 const original=f.host.snapshot;f.host.snapshot=async()=>{throw Error('PRIVATE_PATH_TOKEN');};let result=(await f.manager.getConnections([A])).get(A);assert.equal(result.error.code,'webui_unavailable');assert.equal(result.error.stage,'observation-first');assert(!JSON.stringify(result).includes('PRIVATE_PATH_TOKEN'));
 f.host.snapshot=original;f.state.listeners=[];result=(await f.manager.getConnections([A])).get(A);assert.equal(result.error.code,'webui_unavailable');assert.equal(result.error.stage,'listener');assert(!result.connection);assert.equal(f.state.stops.length,0);
});

function endpointVault(){const crypto=require('node:crypto'),key=crypto.randomBytes(32);return {isEncryptionAvailable:()=>true,encryptString(text){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]);},decryptString(data){const decipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));decipher.setAuthTag(data.subarray(12,28));return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');}};}
async function publishFixtureEndpoint(f,id=A,port=6107){
  await f.manager.start(id);f.state.starts.at(-1).onOutput(`[NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:${port}/webui?token=FIXTURE_RECOVERY_PRIVATE`);
  const launcher=f.state.rows.find(p=>p.accountId===id),listener=f.state.rows.find(p=>p.parentPid===launcher.pid&&p.name==='QQ.exe');f.state.listeners=[...(f.state.listeners||[]),{pid:listener.pid,address:'127.0.0.1',port}];return {launcher,listener};
}
test('adopted owned runtime restores an encrypted endpoint without Desktop logs and rechecks its listener',async t=>{
  const f=fixture(t,{vault:endpointVault()}),{listener}=await publishFixtureEndpoint(f);
  await f.manager.getConnection(A);const {next}=abandoned(f,{sameHome:true});await next.recover(A);
  const connection=await next.getConnection(A);assert.equal(connection.source,'encrypted-runtime-record');assert.equal(connection.port,6107);assert.equal(connection.token,'FIXTURE_RECOVERY_PRIVATE');assert.equal(connection.endpointRecoveryIssue,null);
  assert.doesNotMatch(JSON.stringify(await next.discover()),/FIXTURE_RECOVERY_PRIVATE|encrypted-runtime-record/);
  listener.createdAt='2026-11-05T13:00:03Z';await assert.rejects(next.getConnection(A),{code:'webui_unavailable'});
});
test('endpoint is not persisted when listener changes between observations or for external instances',async t=>{
  const f=fixture(t,{vault:endpointVault()});await publishFixtureEndpoint(f);let calls=0;f.host.listeners=async()=>{calls++;return calls%2?[...f.state.listeners]:[{...f.state.listeners[0],pid:999111}];};
  await assert.rejects(f.manager.getConnection(A),{code:'webui_unavailable'});assert(!fs.existsSync(path.join(f.root,'qq-runtime-endpoints')));
  f.host.listeners=async()=>f.state.listeners;f.manager.runs.clear();const log=path.join(f.desktopDataRoot,'logs','bots','bots');fs.mkdirSync(log,{recursive:true});fs.writeFileSync(path.join(log,`${A}.log`),'[NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:6107/webui?token=FIXTURE_LOG_PRIVATE');
  assert.equal((await f.manager.getConnection(A)).source,'owned-runtime-output');assert(!fs.existsSync(path.join(f.root,'qq-runtime-endpoints')));
});
test('saving unavailable encrypted recovery never breaks a verified current connection',async t=>{
  const f=fixture(t,{vault:{isEncryptionAvailable:()=>false}});await publishFixtureEndpoint(f);
  const connection=await f.manager.getConnection(A);assert.equal(connection.port,6107);assert.equal(connection.endpointRecoveryIssue,'endpoint_recovery_unavailable');assert((await f.manager.discover()).instances.find(x=>x.accountId===A).canStop);
  const {next}=abandoned(f);await next.recover(A);await assert.rejects(next.getConnection(A),{code:'webui_unavailable'});assert.equal((await next.discover()).instances.find(x=>x.accountId===A).endpointRecoveryIssue,'endpoint_recovery_unavailable');
  await next.stop(A);assert((await next.discover()).instances.find(x=>x.accountId===A).canStart);
});
test('profile changes cannot restore old ciphertext and old launcher callbacks cannot replace a new endpoint',async t=>{
  const f=fixture(t,{vault:endpointVault()});await publishFixtureEndpoint(f);await f.manager.getConnection(A);
  const {next}=abandoned(f,{sameHome:true});next.profileRoot=path.join(f.dir,'other-profile');await next.recover(A);await assert.rejects(next.getConnection(A),{code:'webui_unavailable'});await next.stop(A);
  f.manager=next;f.state.listeners=[];await publishFixtureEndpoint(f,A,6108);const current=await next.getConnection(A);assert.equal(current.port,6108);assert.equal(current.endpointRecoveryIssue,'endpoint_recovery_unavailable');
  const first=f.state.starts.at(-1);await next.stop(A);f.state.listeners=[];await publishFixtureEndpoint(f,A,6109);
  first.onOutput('[NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:6108/webui?token=STALE');first.onExit();assert.equal((await next.getConnection(A)).port,6109);
});

function abandoned(f,{managerPid=900000,sameHome=false}={}){
  const file=path.join(f.options.lockRoot,fs.readdirSync(f.options.lockRoot).find(n=>n.endsWith('.json'))),lease=JSON.parse(fs.readFileSync(file,'utf8'));
  lease.manager.pid=managerPid;fs.writeFileSync(file,JSON.stringify(lease));
  return {file,lease,next:new QQRuntimeManager({...f.options,root:sameHome?f.root:path.join(f.dir,'next-profile')})};
}

test('a fully exited owned tree releases its lease during discovery and can restart',async t=>{
  const f=fixture(t);await f.manager.start(A);f.state.rows=f.state.rows.filter(p=>p.pid===process.pid);
  const current=(await f.manager.discover()).instances[0];assert.equal(current.management,'stopped');assert(current.canStart);assert.equal(fs.readdirSync(f.options.lockRoot).length,0);
  await f.manager.start(A);assert.equal(f.state.starts.length,2);await f.manager.stop(A);
});

test('start reconciles its own fully exited tree without needing a prior status read',async t=>{
  const f=fixture(t);await f.manager.start(A);f.state.rows=f.state.rows.filter(p=>p.pid===process.pid);
  assert.equal((await f.manager.start(A)).management,'owned');assert.equal(f.state.starts.length,2);await f.manager.stop(A);
});

test('an exited launcher with surviving QQ child is never cleared or killed',async t=>{
  const f=fixture(t);await f.manager.start(A);f.state.rows=f.state.rows.filter(p=>p.accountId!==A);
  assert.equal((await f.manager.discover()).instances[0].reason,'orphaned_children');await assert.rejects(f.manager.start(A),{code:'orphaned_children'});await assert.rejects(f.manager.stop(A),{code:'orphaned_children'});
  const {next}=abandoned(f);await assert.rejects(next.recover(A),{code:'orphaned_children'});assert.equal(f.state.stops.length,0);assert.equal(fs.readdirSync(f.options.lockRoot).length,1);
});

test('late unrecorded QQ descendants prevent clearing an abandoned lease',async t=>{
  const f=fixture(t);await f.manager.start(A);const root=f.state.rows.find(p=>p.accountId===A),{next}=abandoned(f);
  f.state.rows=f.state.rows.filter(p=>p.pid===process.pid);f.state.rows.push({pid:900010,parentPid:root.pid,name:'QQ.exe',executable:path.join(f.qq,'QQ.exe'),createdAt:'2026-11-05T14:00:00Z'});
  await assert.rejects(next.recover(A),{code:'orphaned_children'});assert.equal(f.state.stops.length,0);
});

test('close waits for an in-flight start and stops only its owned accounts',async t=>{
  const f=fixture(t);await f.manager.start(A);let release;const original=f.host.start;f.host.start=async plan=>{await new Promise(r=>{release=r;});return original(plan);};
  const starting=f.manager.start(B);await until(()=>release);const closing=f.manager.close();
  await assert.rejects(f.manager.start(A),{code:'manager_closing'});assert.equal(f.state.stops.length,0);release();await starting;
  const result=await closing;assert(result.closed);assert.deepEqual(result.stopped,[A,B]);assert.deepEqual(result.failures,[]);assert.equal(f.state.stops.length,2);assert.equal(f.state.rows.length,1);assert.deepEqual(await f.manager.close(),result);
});

async function heldReconcile(f){
  let release,entered;const waiting=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;}),inspect=f.host.inspect;let first=true;
  f.host.inspect=async pids=>{if(first){first=false;entered();await waiting;}return inspect(pids);};
  const checking=f.manager.discover();await started;return {release,checking};
}

test('an explicit stop waits for an existing reconciliation without queuing duplicate lifecycle actions',async t=>{
  const f=fixture(t);await f.manager.start(A);const held=await heldReconcile(f);t.after(held.release);
  const stopping=f.manager.stop(A).then(value=>({value}),error=>({error}));
  await assert.rejects(f.manager.stop(A),{code:'operation_in_progress'});
  await assert.rejects(f.manager.start(A),{code:'operation_in_progress'});
  await assert.rejects(f.manager.recover(A),{code:'operation_in_progress'});
  assert.equal(f.state.stops.length,0);held.release();await held.checking;
  const result=await stopping;assert.ifError(result.error);assert(result.value.canStart);
  assert.equal(f.state.stops.length,1);assert.equal(f.state.rows.length,1);
});

test('a stop waiting for reconciliation rechecks changed process ownership before any termination',async t=>{
  const f=fixture(t);await f.manager.start(A);const held=await heldReconcile(f);t.after(held.release);
  const stopping=f.manager.stop(A).then(()=>null,error=>error);
  f.state.rows.find(p=>p.accountId===A).createdAt='2026-11-06T01:00:00.0000000Z';
  held.release();await held.checking;assert.equal((await stopping)?.code,'ownership_lost');
  assert.equal(f.state.stops.length,0);assert(f.manager.runs.has(A));assert.equal(fs.readdirSync(f.options.lockRoot).length,1);
});

test('close waits through a reconciliation followed by an explicit stop without stopping twice',async t=>{
  const f=fixture(t);await f.manager.start(A);const held=await heldReconcile(f);t.after(held.release);
  // close initially sees the reconciliation; the explicit stop becomes its successor.
  const closing=f.manager.close(),stopping=f.manager.stop(A).then(value=>({value}),error=>({error}));
  assert.equal(f.state.stops.length,0);held.release();await held.checking;
  const stopped=await stopping;assert.ifError(stopped.error);
  const result=await closing;assert(result.closed);assert.deepEqual(result.failures,[]);
  assert.equal(f.state.stops.length,1);assert.equal(f.state.rows.length,1);assert.equal(f.manager.operations.size,0);
});

test('close reports incomplete stop and retains ownership instead of hiding a surviving runtime',async t=>{
  const f=fixture(t);await f.manager.start(A);f.host.stop=async()=>{};
  const result=await f.manager.close();assert.equal(result.closed,false);assert.deepEqual(result.failures,[{accountId:A,code:'stop_failed'}]);assert.equal(fs.readdirSync(f.options.lockRoot).length,1);
});
test('normal stop rechecks one stale complete snapshot after direct lookup confirms recorded processes exited',async t=>{
  const f=fixture(t);await f.manager.start(A);const stale=structuredClone(f.state.rows),stop=f.host.stop;let afterStop=false,snapshots=0;
  f.host.stop=async proofs=>{await stop(proofs);afterStop=true;};f.host.snapshot=async()=>afterStop&&++snapshots===1?structuredClone(stale):structuredClone(f.state.rows);
  const result=await f.manager.stop(A);assert.equal(result.management,'stopped');assert.equal(f.state.stops.length,1);assert(snapshots>=2);assert.equal(fs.readdirSync(f.options.lockRoot).length,0);assert.equal(f.manager.logs(A).events.at(-1).type,'launcher_stopped');
});
test('stop confirmation retry is bounded and never forgets unknown descendants or a reused process identity',async t=>{
  for(const scenario of ['persistent-stale','unknown-descendant','pid-reused','inspect-failed'])await t.test(scenario,async t=>{
    const f=fixture(t);await f.manager.start(A);const stale=structuredClone(f.state.rows),stop=f.host.stop,inspect=f.host.inspect,child=stale.find(row=>row.name==='QQ.exe');let afterStop=false,postSnapshots=0,postInspects=0;
    f.host.stop=async proofs=>{await stop(proofs);afterStop=true;if(scenario==='pid-reused')f.state.rows.push({...child,createdAt:'2026-11-06T05:00:00Z'});};
    f.host.inspect=async pids=>{if(afterStop&&++postInspects===2&&scenario==='inspect-failed')throw Error('synthetic unreadable process');return inspect(pids);};
    f.host.snapshot=async()=>{if(!afterStop)return structuredClone(f.state.rows);postSnapshots++;if(scenario==='unknown-descendant')return [...structuredClone(stale),{pid:999123,parentPid:child.pid,name:'late.exe',executable:path.join(f.dir,'late.exe'),createdAt:'2026-11-06T00:00:00Z'}];return ['persistent-stale','inspect-failed'].includes(scenario)?structuredClone(stale):structuredClone(f.state.rows);};
    await assert.rejects(f.manager.stop(A),{code:scenario==='pid-reused'?'ownership_lost':scenario==='inspect-failed'?'process_check_failed':'orphaned_children'});assert.equal(f.state.stops.length,1);assert.equal(postSnapshots,scenario==='persistent-stale'?2:1);assert(f.manager.runs.has(A));assert.equal(fs.readdirSync(f.options.lockRoot).length,1);
  });
});
test('missing-parent confirmation excludes older unrelated processes whose parent PID was reused',async t=>{
  for(const scenario of ['launcher-parent','qq-parent','stale-confirmation'])await t.test(scenario,async t=>{
    const f=fixture(t);await f.manager.start(A);const owned=structuredClone(f.state.rows.filter(row=>row.pid!==process.pid)),parent=owned.find(row=>row.name===(scenario==='qq-parent'?'QQ.exe':'NapCatWinBootMain.exe'));
    const unrelated={pid:999120,parentPid:parent.pid,name:'unrelated.exe',executable:path.join(f.dir,'unrelated.exe'),createdAt:'2026-11-05T11:00:00.0000000Z'},unrelatedChild={...unrelated,pid:999121,parentPid:unrelated.pid,createdAt:'2026-11-05T14:00:00.0000000Z'};
    f.state.rows.push(unrelated,unrelatedChild);const stop=f.host.stop,snapshot=f.host.snapshot;let stopped=false,confirmSnapshots=0;
    f.host.stop=async proofs=>{await stop(proofs);stopped=true;};
    f.host.snapshot=async()=>{const rows=await snapshot();if(stopped&&scenario==='stale-confirmation'&&++confirmSnapshots===1)return [...rows,...owned];return rows;};
    assert.equal((await f.manager.stop(A)).management,'stopped');assert.equal(f.state.stops.length,1);assert.equal(f.state.stops[0].length,2);assert(f.state.rows.some(row=>row.pid===unrelated.pid));assert(f.state.rows.some(row=>row.pid===unrelatedChild.pid));assert.equal(fs.readdirSync(f.options.lockRoot).length,0);
  });
});
test('missing-parent confirmation retains unknown late descendants, missing metadata and reused owned PIDs',async t=>{
  for(const scenario of ['late-child','same-time-child','missing-time','missing-executable','reused-owned-pid'])await t.test(scenario,async t=>{
    const f=fixture(t);await f.manager.start(A);const parent=structuredClone(f.state.rows.find(row=>row.name==='QQ.exe')),stop=f.host.stop;
    f.host.stop=async proofs=>{await stop(proofs);const row={pid:999123,parentPid:parent.pid,name:'unknown.exe',executable:path.join(f.dir,'unknown.exe'),createdAt:'2026-11-05T14:00:00.0000000Z'};
      if(scenario==='same-time-child')row.createdAt=parent.createdAt;if(scenario==='missing-time')row.createdAt='';if(scenario==='missing-executable'){row.executable='';row.createdAt='2026-11-05T11:00:00.0000000Z';}if(scenario==='reused-owned-pid'){row.pid=parent.pid;row.parentPid=1;}
      f.state.rows.push(row);
    };
    await assert.rejects(f.manager.stop(A),{code:scenario==='reused-owned-pid'?'ownership_lost':'orphaned_children'});assert.equal(f.state.stops.length,1);assert(f.manager.runs.has(A));assert.equal(fs.readdirSync(f.options.lockRoot).length,1);
  });
});
test('optional stop trace identifies the failing stage without secrets or extra termination',async t=>{
  const records=[],f=fixture(t,{onStopTrace:row=>records.push(row),traceHostStop:true});await f.manager.start(A);const stop=f.host.stop;f.host.stop=async(proofs,options)=>{options?.onTrace({step:'terminate',pid:proofs[0].pid,hostAt:'2026-11-06T01:00:00Z',token:'NEVER_EXPORT'});await stop(proofs);f.state.rows.push({pid:999123,parentPid:proofs.at(-1).pid,name:'late.exe',executable:path.join(f.dir,'NEVER_EXPORT.exe'),createdAt:'2026-11-06T00:00:00Z'});};
  await assert.rejects(f.manager.stop(A),{code:'orphaned_children'});assert.equal(records.at(-1).kind,'failure');assert.equal(records.at(-1).phase,'confirm_stopped');assert.equal(records.at(-1).code,'orphaned_children');assert(records.some(row=>row.kind==='host_step'&&row.pid));assert(records.some(row=>row.origin==='stop-confirm'&&row.processes.some(p=>p.pid===999123)));assert.doesNotMatch(JSON.stringify(records),/NEVER_EXPORT|executable"|accountId|commandLine/);assert.equal(f.state.stops.length,1);assert.equal(f.manager.stopTraceContexts.size,0);
});
test('manager-only stop diagnostics retain the ordinary host call and capture failure evidence',async t=>{
  for(const lateChild of [false,true])await t.test(lateChild?'late unknown child':'clean stop',async t=>{
    const records=[],f=fixture(t,{onStopTrace:row=>records.push(row)});assert.equal(f.manager.traceHostStop,false);await f.manager.start(A);const stop=f.host.stop;let options='not-called';
    f.host.stop=async(proofs,value)=>{options=value;await stop(proofs);if(lateChild)f.state.rows.push({pid:999123,parentPid:proofs.at(-1).pid,name:'late.exe',executable:path.join(f.dir,'late.exe'),createdAt:'2026-11-06T00:00:00Z'});};
    if(lateChild)await assert.rejects(f.manager.stop(A),{code:'orphaned_children'});else assert.equal((await f.manager.stop(A)).management,'stopped');
    assert.equal(options,undefined);assert.equal(f.state.stops.length,1);assert(!records.some(row=>row.kind==='host_step'));assert(records.some(row=>row.kind==='host_result'));assert.equal(records.at(-1).kind,lateChild?'failure':'success');assert.equal(records.at(-1).phase,lateChild?'confirm_stopped':'done');
    if(lateChild)assert(records.some(row=>row.origin==='stop-confirm'&&row.processes.some(p=>p.pid===999123)));
  });
});
test('absent or throwing stop trace does not alter successful or failed lifecycle behavior',async t=>{
  const f=fixture(t,{onStopTrace:()=>{throw Error('TRACE_ONLY');}});f.manager.stopTraceContexts.set('synthetic-projection-error',{get proofs(){throw Error('TRACE_PROJECTION_ONLY');}});assert.deepEqual(await f.manager._processes(),(await f.host.snapshot()).map(row=>({...row,accountId:null})));f.manager.stopTraceContexts.clear();await f.manager.start(A);assert.equal((await f.manager.stop(A)).management,'stopped');assert.equal(f.state.stops.length,1);assert.equal(f.manager.stopTraceContexts.size,0);
  await f.manager.start(A);f.host.stop=async()=>{};await assert.rejects(f.manager.stop(A),{code:'stop_failed'});assert.equal(f.manager.stopTraceContexts.size,0);assert(f.manager.runs.has(A));
  const plain=fixture(t);assert.equal(plain.manager.onStopTrace,null);await plain.manager.start(A);let options;const original=plain.host.stop;plain.host.stop=async(proofs,value)=>{options=value;await original(proofs);};await plain.manager.stop(A);assert.equal(options,undefined);assert.equal(plain.manager.stopTraceContexts.size,0);
});

test('recovery directly checks an old owner omitted by the ordinary snapshot',async t=>{
  const f=fixture(t);await f.manager.start(A);const {next,lease}=abandoned(f);
  f.state.rows.push({pid:lease.manager.pid,parentPid:1,name:'old-arcade.exe',...lease.manager});
  f.host.snapshot=async()=>f.state.rows.filter(p=>p.pid!==lease.manager.pid);
  await assert.rejects(next.recover(A),{code:'owner_alive'});assert.equal(f.state.stops.length,0);assert.equal(fs.readdirSync(f.options.lockRoot).length,1);
});

test('recovering a live tree requires a dead old owner and replaces its ownership identity',async t=>{
  const f=fixture(t);await f.manager.start(A);const {file,lease,next}=abandoned(f);
  const before=(await next.discover()).instances[0];assert(before.recoveryRequired);assert(before.canRecover);assert(!before.canStart);
  const result=await next.recover(A);assert.equal(result.recovery,'adopted');assert.equal(result.management,'owned');assert(result.canStop);
  const after=JSON.parse(fs.readFileSync(file,'utf8'));assert.notEqual(after.instance,lease.instance);assert.notEqual(after.token,lease.token);assert.deepEqual(after.runtime,lease.runtime);assert.equal(after.runtimeTree.length,2);assert.equal(f.state.starts.length,1);
  await next.stop(A);assert.equal(f.state.stops.length,1);await assert.rejects(f.manager.stop(A),{code:'runtime_locked'});
});

test('recovery clears a proven fully dead tree without starting or stopping anything',async t=>{
  const f=fixture(t);await f.manager.start(A);const {next}=abandoned(f);f.state.rows=f.state.rows.filter(p=>p.pid===process.pid);
  const result=await next.recover(A);assert.equal(result.recovery,'cleared');assert(result.canStart);assert.equal(f.state.starts.length,1);assert.equal(f.state.stops.length,0);assert.equal(fs.readdirSync(f.options.lockRoot).length,0);
});

test('runtime PID reuse aborts recovery; manager PID reuse never stops the replacement process',async t=>{
  const f=fixture(t);await f.manager.start(A);const {next,lease}=abandoned(f),root=f.state.rows.find(p=>p.accountId===A),original=root.createdAt;
  root.createdAt='2026-11-05T15:00:00Z';await assert.rejects(next.recover(A),{code:'ownership_lost'});assert.equal(f.state.stops.length,0);root.createdAt=original;
  const replacement={pid:lease.manager.pid,parentPid:1,name:'another.exe',executable:path.join(f.dir,'another.exe'),createdAt:'2026-11-05T16:00:00Z'};f.state.rows.push(replacement);
  assert.equal((await next.recover(A)).recovery,'adopted');await next.stop(A);assert(f.state.rows.some(p=>p.pid===replacement.pid));assert(f.state.stops[0].every(p=>p.pid!==replacement.pid));
});

test('a recorded child with a reused PID or changed parent is not silently dropped from ownership',async t=>{
  const f=fixture(t);await f.manager.start(A);const child=f.state.rows.find(p=>p.name==='QQ.exe'),{next}=abandoned(f),original=child.createdAt;
  child.createdAt='2026-11-05T15:00:00Z';await assert.rejects(next.recover(A),{code:'ownership_lost'});child.createdAt=original;child.parentPid=1;
  await assert.rejects(next.recover(A),{code:'orphaned_children'});assert.equal(f.state.stops.length,0);
});

test('unknown direct PID metadata and missing inspect implementation fail recovery closed',async t=>{
  const f=fixture(t);await f.manager.start(A);const {next,lease}=abandoned(f);
  f.state.rows.push({pid:lease.manager.pid,parentPid:1,name:'old.exe',executable:'',createdAt:''});await assert.rejects(next.recover(A),{code:'process_check_failed'});f.state.rows.pop();
  f.host.inspect=undefined;await assert.rejects(next.recover(A),{code:'process_check_failed'});assert.equal(f.state.stops.length,0);
});

test('explicit dead-launcher recovery clears an old child PID reused by a verified foreign leaf without stopping it',async t=>{
  const f=fixture(t);await f.manager.start(A);const child=f.state.rows.find(p=>p.name==='QQ.exe'),{next,file}=abandoned(f);
  const replacement={pid:child.pid,parentPid:1,name:'foreign.exe',executable:path.join(f.dir,'foreign.exe'),createdAt:'2026-11-06T00:00:00.0000000Z'};
  f.state.rows=f.state.rows.filter(row=>row.pid===process.pid);f.state.rows.push(replacement);
  const result=await next.recover(A);
  assert.equal(result.recovery,'cleared');assert.equal(fs.existsSync(file),false);
  assert.equal(f.state.stops.length,0);assert.equal(f.state.starts.length,1);
  assert(f.state.rows.some(row=>row===replacement));
});

test('foreign child PID reuse cannot hide descendants, stale snapshots or missing identity',async t=>{
  for(const failure of ['descendant','stale-snapshot','missing-identity','same-executable','older']){
    const f=fixture(t);await f.manager.start(A);const child=f.state.rows.find(p=>p.name==='QQ.exe'),{next,file}=abandoned(f),before=fs.readFileSync(file);
    const replacement={pid:child.pid,parentPid:1,name:'foreign.exe',executable:path.join(f.dir,'foreign.exe'),createdAt:'2026-11-06T00:00:00.0000000Z'};
    f.state.rows=f.state.rows.filter(row=>row.pid===process.pid);f.state.rows.push(replacement);
    if(failure==='descendant')f.state.rows.push({...replacement,pid:999101,parentPid:replacement.pid});
    if(failure==='missing-identity')replacement.executable='';
    if(failure==='same-executable')replacement.executable=child.executable;
    if(failure==='older')replacement.createdAt='2026-11-04T00:00:00Z';
    if(failure==='stale-snapshot'){const inspect=f.host.inspect;f.host.inspect=async ids=>(await inspect(ids)).map(row=>row.pid===replacement.pid?{...row,createdAt:'2026-11-06T01:00:00Z'}:row);}
    await assert.rejects(next.recover(A),{code:'ownership_lost'});
    assert.equal(f.state.stops.length,0);assert(fs.readFileSync(file).equals(before));
  }
});

test('a reused foreign worker may have only its exact later system console during manual metadata recovery',async t=>{
  for(const variation of ['valid','old-console','unknown-path','grandchild','two-children','reparented']){
    const f=fixture(t);await f.manager.start(A);const child=f.state.rows.find(p=>p.name==='QQ.exe'),{next,file}=abandoned(f);
    const replacement={pid:child.pid,parentPid:1,name:'foreign.exe',executable:path.join(f.dir,'foreign.exe'),createdAt:'2026-11-06T00:00:00.0000000Z'};
    const console={pid:999101,parentPid:replacement.pid,name:'conhost.exe',executable:path.join(process.env.SystemRoot||'C:\\Windows','System32','conhost.exe'),createdAt:'2026-11-06T00:00:00.0100000Z'};
    f.state.rows=f.state.rows.filter(row=>row.pid===process.pid);f.state.rows.push(replacement,console);
    if(variation==='old-console')console.createdAt=replacement.createdAt;
    if(variation==='unknown-path')console.executable=path.join(f.dir,'conhost.exe');
    if(variation==='grandchild')f.state.rows.push({...console,pid:999102,parentPid:console.pid});
    if(variation==='two-children')f.state.rows.push({...console,pid:999102});
    if(variation==='reparented'){const inspect=f.host.inspect;f.host.inspect=async ids=>(await inspect(ids)).map(row=>row.pid===console.pid?{...row,parentPid:1}:row);}
    if(variation==='valid'){assert.equal((await next.recover(A)).recovery,'cleared');assert.equal(fs.existsSync(file),false);}
    else {await assert.rejects(next.recover(A),{code:'ownership_lost'});assert(fs.existsSync(file));}
    assert.equal(f.state.stops.length,0);assert(f.state.rows.includes(replacement));assert(f.state.rows.includes(console));
  }
});

test('Desktop and a concurrent recovery guard block takeover without changing the lease',async t=>{
  const f=fixture(t);await f.manager.start(A);const {next,file}=abandoned(f);const original=fs.readFileSync(file,'utf8');f.addDesktop();
  await assert.rejects(next.recover(A),{code:'desktop_running'});f.state.rows=f.state.rows.filter(p=>p.name!=='NapCatQQ-Desktop.exe');fs.writeFileSync(`${file}.recover`,'');
  await assert.rejects(next.recover(A),{code:'operation_in_progress'});assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(f.state.stops.length,0);
});

async function orphanFixture(t){
  const f=fixture(t);addConsoleOnStart(f);await f.manager.start(A);
  const root=f.state.rows.find(p=>p.accountId===A),child=f.state.rows.find(p=>p.parentPid===root.pid&&p.name==='QQ.exe');
  const grandchild={pid:f.state.next++,parentPid:child.pid,name:'QQ.exe',executable:child.executable,createdAt:'2026-11-05T13:00:03.0000000Z'};f.state.rows.push(grandchild);await f.manager.discover();
  const abandonedState=abandoned(f);f.state.rows=f.state.rows.filter(p=>p.pid!==root.pid);return {...f,...abandonedState,root,child,grandchild};
}
test('orphan preview is read-only and explicit cleanup terminates only exact recorded descendants without starting',async t=>{
  const f=await orphanFixture(t),original=fs.readFileSync(f.file),preview=await f.next.previewOrphanCleanup(A);
  assert.equal(preview.count,3);assert.equal(preview.automaticStart,false);assert.match(preview.expectedDigest,/^[a-f0-9]{64}$/);assert(!JSON.stringify(preview).includes(f.child.executable));assert.equal(f.state.stops.length,0);assert(fs.readFileSync(f.file).equals(original));
  let hook=0,current=0;const result=await f.next.cleanupOrphans(A,{expectedDigest:preview.expectedDigest,assertCurrent:()=>current++,beforeStop:async()=>{hook++;assert.equal(f.state.stops.length,0);assert(fs.readFileSync(f.file).equals(original));}});
  assert.deepEqual(result,{recovery:'orphans-cleared',accountId:A,terminatedCount:3,automaticStart:false});assert.equal(hook,1);assert(current>=3);assert.equal(f.state.starts.length,1);assert.equal(f.state.stops.length,1);
  assert(f.state.stops[0].every(p=>f.lease.runtimeTree.some(q=>q.pid===p.pid&&q.createdAt===p.createdAt&&q.executable===p.executable)));assert.equal(f.state.stops[0].at(-1).pid,f.grandchild.pid);assert(!fs.existsSync(f.file));assert.equal(f.state.rows.length,1);
  assert.equal((await f.next.discover()).instances.find(p=>p.accountId===A).canStart,true);
});
test('orphan cleanup refuses live owners, live launchers, reused PIDs, incomplete parent chains and unknown children',async t=>{
  const cases=[
    ['owner_alive',f=>f.state.rows.push({pid:f.lease.manager.pid,parentPid:1,name:'test.exe',...f.lease.manager})],
    ['orphan_cleanup_unavailable',f=>f.state.rows.push(f.root)],
    ['ownership_lost',f=>f.child.createdAt='2026-11-05T15:00:00.0000000Z'],
    ['orphan_cleanup_unverified',f=>f.child.parentPid=1],
    ['orphan_cleanup_unverified',f=>f.state.rows=f.state.rows.filter(p=>p.pid!==f.child.pid)],
    ['orphan_cleanup_unverified',f=>f.state.rows.push({...f.grandchild,pid:f.state.next++})],
    ['desktop_running',f=>f.addDesktop()],
    ['operation_in_progress',f=>fs.writeFileSync(`${f.file}.recover`,'unknown recovery lock')],
    ['operation_in_progress',f=>fs.writeFileSync(path.join(f.options.lockRoot,'configuration.edit'),'unknown config lock')],
  ];
  for(const [code,change]of cases)await t.test(code,async t=>{const f=await orphanFixture(t),original=fs.readFileSync(f.file);change(f);await assert.rejects(f.next.previewOrphanCleanup(A),{code});assert.equal(f.state.stops.length,0);assert(fs.readFileSync(f.file).equals(original));});
});
test('orphan cleanup stale preview never disconnects services, and changes during the hook are checked again before termination',async t=>{
  const f=await orphanFixture(t),preview=await f.next.previewOrphanCleanup(A);let hook=0;
  fs.appendFileSync(f.file,' ');await assert.rejects(f.next.cleanupOrphans(A,{expectedDigest:preview.expectedDigest,beforeStop:async()=>hook++}),{code:'orphan_cleanup_changed'});assert.equal(hook,0);assert.equal(f.state.stops.length,0);
  const fresh=await f.next.previewOrphanCleanup(A);await assert.rejects(f.next.cleanupOrphans(A,{expectedDigest:fresh.expectedDigest,beforeStop:async()=>{hook++;fs.appendFileSync(f.file,' ');}}),{code:'orphan_cleanup_changed'});assert.equal(hook,1);assert.equal(f.state.stops.length,0);assert(fs.existsSync(f.file));
});
test('orphan cleanup cannot ignore a live old owner visible in only one process observation',async t=>{
  for(const source of ['snapshot','direct'])await t.test(source,async t=>{
    const f=await orphanFixture(t),owner={pid:f.lease.manager.pid,parentPid:1,name:'test.exe',...f.lease.manager};f.state.rows.push(owner);
    if(source==='snapshot'){const inspect=f.host.inspect;f.host.inspect=async pids=>(await inspect(pids)).filter(p=>p.pid!==owner.pid);}
    else{const snapshot=f.host.snapshot;f.host.snapshot=async()=>(await snapshot()).filter(p=>p.pid!==owner.pid);}
    await assert.rejects(f.next.previewOrphanCleanup(A),{code:'owner_alive'});assert.equal(f.state.stops.length,0);assert(fs.existsSync(f.file));
  });
});
test('orphan cleanup current-context guard is called immediately before host stop',async t=>{
  const f=await orphanFixture(t),preview=await f.next.previewOrphanCleanup(A);let afterHook=false;
  await assert.rejects(f.next.cleanupOrphans(A,{expectedDigest:preview.expectedDigest,beforeStop:async()=>{afterHook=true;},assertCurrent:()=>{if(afterHook)throw Error('synthetic context changed');}}),{code:'process_check_failed'});
  assert.equal(f.state.stops.length,0);assert(fs.existsSync(f.file));
});
test('partial orphan cleanup retains the lease and reports attempted; a new preview can clean remaining proven processes',async t=>{
  const f=await orphanFixture(t),preview=await f.next.previewOrphanCleanup(A),original=fs.readFileSync(f.file),stop=f.host.stop;
  f.host.stop=async proofs=>{f.state.stops.push(proofs);f.state.rows=f.state.rows.filter(p=>p.pid!==f.grandchild.pid);};
  await assert.rejects(f.next.cleanupOrphans(A,{expectedDigest:preview.expectedDigest}),{code:'orphan_cleanup_incomplete',cleanupAttempted:true});assert(fs.readFileSync(f.file).equals(original));assert.equal(f.state.starts.length,1);
  const again=await f.next.previewOrphanCleanup(A);assert.equal(again.count,2);assert.notEqual(again.expectedDigest,preview.expectedDigest);f.host.stop=stop;
  assert.equal((await f.next.cleanupOrphans(A,{expectedDigest:again.expectedDigest})).terminatedCount,2);assert.equal(f.state.stops.length,2);assert(!f.state.stops[1].some(p=>p.pid===f.grandchild.pid));assert(!fs.existsSync(f.file));
});
test('late unrecorded descendants after attempted cleanup retain the lease and never trigger an automatic retry',async t=>{
  const f=await orphanFixture(t),preview=await f.next.previewOrphanCleanup(A),stop=f.host.stop;
  f.host.stop=async proofs=>{await stop(proofs);f.state.rows.push({...f.grandchild,pid:f.state.next++});};
  await assert.rejects(f.next.cleanupOrphans(A,{expectedDigest:preview.expectedDigest}),{code:'orphan_cleanup_incomplete',cleanupAttempted:true});assert(fs.existsSync(f.file));assert.equal(f.state.stops.length,1);assert.equal(f.state.starts.length,1);
  await assert.rejects(f.next.previewOrphanCleanup(A),{code:'orphan_cleanup_unverified'});assert.equal(f.state.stops.length,1);
});
test('close waits for an explicit orphan cleanup and duplicate lifecycle calls stay blocked',async t=>{
  const f=await orphanFixture(t),preview=await f.next.previewOrphanCleanup(A);let release,entered;const waiting=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});t.after(()=>release());
  const cleaning=f.next.cleanupOrphans(A,{expectedDigest:preview.expectedDigest,beforeStop:async()=>{entered();await waiting;}});await ready;
  await assert.rejects(f.next.cleanupOrphans(A,{expectedDigest:preview.expectedDigest}),{code:'operation_in_progress'});await assert.rejects(f.next.recover(A),{code:'operation_in_progress'});await assert.rejects(f.next.start(A),{code:'operation_in_progress'});
  const closing=f.next.close();assert.equal(f.state.stops.length,0);release();assert.equal((await cleaning).recovery,'orphans-cleared');assert((await closing).closed);assert.equal(f.state.stops.length,1);assert.equal(f.next.operations.size,0);
});
test('cleanup keeps another mapped QQ account and any replaced recovery guard untouched',async t=>{
  const f=await orphanFixture(t),otherRoot={...f.root,pid:f.state.next++,accountId:B},otherChild={...f.child,pid:f.state.next++,parentPid:otherRoot.pid};f.state.rows.push(otherRoot,otherChild);const other=[otherRoot.pid,otherChild.pid];
  const preview=await f.next.previewOrphanCleanup(A);await assert.rejects(f.next.cleanupOrphans(A,{expectedDigest:preview.expectedDigest,beforeStop:async()=>{fs.writeFileSync(`${f.file}.recover`,'foreign replacement');}}),{code:'runtime_locked'});
  assert.equal(fs.readFileSync(`${f.file}.recover`,'utf8'),'foreign replacement');assert.equal(f.state.stops.length,0);assert(other.every(pid=>f.state.rows.some(p=>p.pid===pid)));assert(fs.existsSync(f.file));
});

test('stale complete snapshot cannot prove a live runtime dead when direct PID lookup finds it',async t=>{
  const f=fixture(t);await f.manager.start(A);f.host.snapshot=async()=>f.state.rows.filter(p=>p.pid===process.pid);
  assert.equal((await f.manager.discover()).instances[0].reason,'process_check_failed');assert.equal(fs.readdirSync(f.options.lockRoot).length,1);assert.equal(f.state.stops.length,0);
});

test('configuration callback receives only a fixed discovered path and serializes against another profile start',async t=>{
  const f=fixture(t),other=new QQRuntimeManager({...f.options,root:path.join(f.dir,'other')});let called=false;
  await f.manager.withConfigurationLock(A,{},async install=>{called=true;assert.equal(install.onebotConfigPath,path.join(f.config,`onebot11_${A}.json`));await install.assertStopped();await assert.rejects(other.start(B),{code:'operation_in_progress'});});assert(called);assert.equal(fs.readdirSync(f.options.lockRoot).length,0);
  await f.manager.start(A);await assert.rejects(f.manager.withConfigurationLock(A,{},async()=>assert.fail()),{code:'runtime_running'});await f.manager.stop(A);
  f.addDesktop();await assert.rejects(f.manager.withConfigurationLock(B,{},async()=>assert.fail()),{code:'desktop_running'});
});

test('normal configuration edits write a full owner marker linked to the held installation lock',async t=>{
  const f=fixture(t),selector=f.manager.componentSelection();
  const receipt=await f.manager.withConfigurationLock(A,{},async install=>{
    const component=JSON.parse(fs.readFileSync(selector.lockFile)),marker=JSON.parse(fs.readFileSync(selector.configLock));
    assert.equal(component.schema,'qq_component_lock_v2');assert.equal(marker.schema,'qq_configuration_lock_v2');
    assert.deepEqual(marker.owner,component.owner);assert.equal(marker.owner.pid,process.pid);assert.equal(marker.owner.createdAt,f.state.rows[0].createdAt);
    assert.equal(marker.componentToken,component.token);assert.match(marker.componentLockDigest,/^[a-f0-9]{64}$/);
    await install.assertStopped();fs.writeFileSync(install.onebotConfigPath,'synthetic committed configuration');return {saved:true};
  });
  assert.deepEqual(receipt,{saved:true});assert.equal(fs.readFileSync(path.join(f.config,`onebot11_${A}.json`),'utf8'),'synthetic committed configuration');
  assert(!fs.existsSync(selector.configLock));assert(!fs.existsSync(selector.lockFile));
});

test('a configuration marker replaced while awaiting a stopped check prevents the callback from committing',async t=>{
  const f=fixture(t),selector=f.manager.componentSelection(),before=fs.readFileSync(path.join(f.config,`onebot11_${A}.json`));let injected=false;
  await assert.rejects(f.manager.withConfigurationLock(A,{},async install=>{
    f.state.onSnapshot=()=>{if(!injected){injected=true;fs.writeFileSync(selector.configLock,'foreign marker');}};
    await install.assertStopped();assert.fail('changed marker must block write');
  }),error=>error.code==='component_lock_changed'&&error.configurationRecoveryIssue==='configuration_marker_retained');
  assert(injected);assert.equal(fs.readFileSync(selector.configLock,'utf8'),'foreign marker');assert(fs.readFileSync(path.join(f.config,`onebot11_${A}.json`)).equals(before));assert(!f.manager.pending.has(A));
});

test('a post-commit configuration marker replacement preserves the successful receipt and the foreign marker',async t=>{
  const f=fixture(t),selector=f.manager.componentSelection();
  const receipt=await f.manager.withConfigurationLock(A,{},async install=>{
    await install.assertStopped();fs.writeFileSync(install.onebotConfigPath,'synthetic saved');
    fs.writeFileSync(selector.configLock,'foreign marker');return {saved:true,accountId:A};
  });
  assert.deepEqual(receipt,{saved:true,accountId:A,configurationRecoveryIssue:'configuration_marker_retained'});
  assert.equal(fs.readFileSync(selector.configLock,'utf8'),'foreign marker');assert.equal(fs.readFileSync(path.join(f.config,`onebot11_${A}.json`),'utf8'),'synthetic saved');assert(!f.manager.pending.has(A));
});

test('configuration cleanup cannot replace the original committed failure or its exact owned-marker boundary',async t=>{
  const f=fixture(t),selector=f.manager.componentSelection(),original=Object.assign(Error('synthetic readback failure'),{code:'config_readback_failed',committed:true});
  await assert.rejects(f.manager.withConfigurationLock(A,{},async install=>{
    await install.assertStopped();fs.writeFileSync(install.onebotConfigPath,'synthetic saved before failed readback');fs.writeFileSync(selector.configLock,'foreign marker');throw original;
  }),error=>error.code===original.code&&error.committed===true&&error.configurationRecoveryIssue==='configuration_marker_retained');
  assert.equal(fs.readFileSync(selector.configLock,'utf8'),'foreign marker');assert(!f.manager.pending.has(A));
});

test('creating a config accepts only explicit numeric IDs under the verified installed directory',async t=>{
  const f=fixture(t);await assert.rejects(f.manager.withConfigurationLock('../123456', {create:true},async()=>assert.fail()),{code:'invalid_account'});
  await assert.rejects(f.manager.withConfigurationLock('12345003',{},async()=>assert.fail()),{code:'invalid_account'});
  await f.manager.withConfigurationLock('12345003',{create:true},async install=>assert.equal(install.onebotConfigPath,path.join(f.config,'onebot11_12345003.json')));assert(!fs.existsSync(path.join(f.config,'onebot11_12345003.json')));
});

test('batch WebUI verification uses shared snapshots and isolates a changed listener process to its account',async t=>{
  const f=fixture(t);await f.manager.start(A);await f.manager.start(B);
  for(const [index,id]of [A,B].entries())f.state.starts[index].onOutput(`[NapCat] [WebUi] WebUi User Panel Url: http://127.0.0.1:${6100+index}/webui?token=PRIVATE_${id}`);
  const roots=[A,B].map(id=>f.state.rows.find(p=>p.accountId===id)),children=roots.map(root=>f.state.rows.find(p=>p.parentPid===root.pid));
  f.state.listeners=children.map((p,index)=>({pid:p.pid,port:6100+index,address:'127.0.0.1'}));let snapshots=0,listeners=0;
  f.host.snapshot=async()=>{snapshots++;const rows=f.state.rows.map(p=>({...p}));if(snapshots===2)rows.find(p=>p.pid===children[1].pid).createdAt='2026-11-05T19:00:00Z';return rows;};f.host.listeners=async()=>{listeners++;return f.state.listeners;};
  const result=await f.manager.getConnections([A,B]);assert.equal(snapshots,2);assert.equal(listeners,2);assert.equal(result.get(A).connection.port,6100);assert.equal(result.get(B).error.code,'webui_unavailable');assert.doesNotMatch(JSON.stringify(result.get(B)),/PRIVATE/);
  assert.equal((await f.manager.getConnections([])).size,0);assert.equal(snapshots,2);await assert.rejects(f.manager.getConnections(['../12345']),{code:'invalid_account'});
});

function componentFixture(t){
  const f=fixture(t),{QQComponentSelection}=require('../src/bot/qq-component-selection.cjs'),{createHash}=require('node:crypto');
  const versionId='napcat-shell-4.18.42-1111111111111111',root=path.join(f.manager.componentStoreRoot,'qq-component-versions','napcat-shell'),codeRoot=path.join(root,versionId,'code');fs.mkdirSync(path.join(codeRoot,'static'),{recursive:true});
  const names=['NapCatWinBootMain.exe','NapCatWinBootHook.dll','napcat.mjs','qqnt.json','static/index.html'];for(const name of names)fs.writeFileSync(path.join(codeRoot,name),`SYNTHETIC ${name}`);
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),files=names.sort().map(name=>{const bytes=fs.readFileSync(path.join(codeRoot,name));return {path:name,size:bytes.length,sha256:sha(bytes)};});
  const manifestPath=path.join(root,versionId,'prepared.json'),bytes=Buffer.from(JSON.stringify({schema:'qq_component_prepared_v1',component:'napcat-shell',versionId,version:'4.18.42',files}));fs.writeFileSync(manifestPath,bytes);
  const prepared={resolvePrepared:async id=>{assert.equal(id,versionId);return {versionId,version:'4.18.42',codeRoot,manifestPath,manifestSha256:sha(bytes),files};}};
  f.manager.componentSelectionFactory=options=>new QQComponentSelection({...options,installedVersion:'4.18.42',prepared});return {...f,versionId,codeRoot,manifestPath};
}
test('component activation starts selected code with original QQ/config, and stopping enables exact original rollback',async t=>{
  const f=componentFixture(t),selection=f.manager.componentSelection(),preview=await selection.preview({versionId:f.versionId});const selected=await selection.activate({versionId:f.versionId,expectedDigest:preview.digest});
  const start=f.host.start;f.host.start=async plan=>{assert(fs.existsSync(selection.lockFile));return start(plan);};await f.manager.start(A);
  const plan=f.state.starts[0];assert.equal(plan.file,path.join(f.codeRoot,'NapCatWinBootMain.exe'));assert.equal(plan.args[0],path.join(f.qq,'QQ.exe'));assert.equal(plan.env.NAPCAT_WORKDIR,f.runtime);assert(!('NAPCAT_QQ_DATA_DIR' in plan.env));assert.equal(f.manager.instance(A).onebotConfigPath,path.join(f.config,`onebot11_${A}.json`));
  await assert.rejects(selection.rollback({expectedDigest:selected.digest}),{code:'runtime_locked'});await f.manager.stop(A);const rollback=await selection.preview({operation:'rollback'});await selection.rollback({expectedDigest:rollback.digest});await f.manager.start(A);assert.equal(f.state.starts[1].file,path.join(f.runtime,'NapCatWinBootMain.exe'));await f.manager.stop(A);assert.equal(fs.readFileSync(path.join(f.config,`onebot11_${A}.json`),'utf8'),'SECRET_NEVER_EXPORT');
});
test('different account starts queue through one component lock while preserving both proof trees',async t=>{
  const f=componentFixture(t);await Promise.all([f.manager.start(A),f.manager.start(B)]);assert.equal(f.state.starts.length,2);assert.equal(f.manager.runs.size,2);assert(!fs.existsSync(f.manager.componentSelection().lockFile));await f.manager.stop(A);assert(f.manager.runs.has(B));await f.manager.stop(B);
});
test('relative native data writes use stable work directory without invalidating prepared code for the next account',async t=>{
  const f=componentFixture(t),selection=f.manager.componentSelection();await selection.activate({versionId:f.versionId,expectedDigest:(await selection.preview({versionId:f.versionId})).digest});
  const start=f.host.start,files=['guild1.db','guild1.db-shm','guild1.db-wal'];
  // Synthetic native-library side effect: these relative paths ignore NAPCAT_WORKDIR.
  // Preserve an existing stable database instead of copying it into selected code.
  fs.writeFileSync(path.join(f.runtime,files[0]),'existing stable data\n');
  f.host.start=async plan=>{
    for(const name of files)fs.appendFileSync(path.join(plan.cwd,name),`synthetic account ${plan.args.at(-1)}\n`);
    return start(plan);
  };
  await f.manager.start(A);await f.manager.start(B);
  assert.equal(f.state.starts.length,2);
  for(const plan of f.state.starts){
    assert.equal(plan.cwd,f.runtime);assert.equal(plan.env.NAPCAT_WORKDIR,f.runtime);
    for(const value of [plan.file,...plan.args.slice(0,2),plan.env.NAPCAT_LOAD_PATH,plan.env.NAPCAT_MAIN_PATH,plan.env.NAPCAT_PATCH_PACKAGE])assert(path.isAbsolute(value));
    assert.equal(plan.env.NAPCAT_MAIN_PATH,path.join(f.codeRoot,'napcat.mjs'));
  }
  for(const name of files){assert(fs.existsSync(path.join(f.runtime,name)));assert(!fs.existsSync(path.join(f.codeRoot,name)));}
  assert(fs.readFileSync(path.join(f.runtime,files[0]),'utf8').startsWith('existing stable data\n'));
  assert.equal((await selection.resolve()).codeRoot,f.codeRoot);
  await f.manager.stop(A);await f.manager.stop(B);
});
test('a corrupt selected manifest remains diagnosable and cannot silently launch original code',async t=>{
  const f=componentFixture(t),selection=f.manager.componentSelection();await selection.activate({versionId:f.versionId,expectedDigest:(await selection.preview()).digest});fs.appendFileSync(f.manifestPath,' ');const status=await f.manager.discover();assert.equal(status.components.available,false);assert.equal(status.issue,'component_changed');await assert.rejects(f.manager.start(A),{code:'component_changed'});assert.equal(f.state.starts.length,0);
});
test('an unobserved original version can still start but cannot claim same-version migration',async t=>{
  const f=componentFixture(t);f.manager.componentSelection().installedVersion=null;await f.manager.start(A);await f.manager.stop(A);await assert.rejects(f.manager.componentSelection().preview({versionId:f.versionId}),{code:'installed_version_unverified'});
});

test('preparation recovery checks the runtime explicit shared lock root, not a guessed sibling',t=>{
 const f=fixture(t),recovery=f.manager.componentSelection().prepared.preparationRecovery;fs.mkdirSync(f.options.lockRoot,{recursive:true});fs.writeFileSync(path.join(f.options.lockRoot,'configuration.edit'),'synthetic active marker');
 assert.equal(recovery.lockRoot,f.options.lockRoot);assert.throws(()=>recovery._references('napcat-shell-4.18.42-1111111111111111'),{code:'component_locked'});assert.equal(f.state.starts.length,0);
});

test('QCE 6.4.2 cannot start under legacy Shell without its managed native-child contract',async t=>{const f=fixture(t),plugin=path.join(f.runtime,'plugins','napcat-plugin-qce');fs.mkdirSync(plugin,{recursive:true});fs.writeFileSync(path.join(plugin,'package.json'),JSON.stringify({name:'napcat-plugin-qce',version:'6.4.2'}));await assert.rejects(f.manager.start(A),{code:'qce_version_unsupported'});assert.equal(f.state.starts.length,0);assert.equal(f.state.stops.length,0);});
