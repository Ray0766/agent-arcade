'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {NativeProcess,quoteWindowsArgument}=require('../src/bot/native-process.cjs');
const SESSION='11111111-1111-4111-8111-111111111111';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-native-owned-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const state={probe:'running',stop:'gone',calls:[]};
  const run=async(exe,args,options)=>{
    assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.deepEqual(args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand']);
    const script=Buffer.from(args[4],'base64').toString('utf16le'),operation=script.match(/# ARCADE_PROCESS_(\w+)/)[1].toLowerCase();
    const payload=JSON.parse(Buffer.from(script.match(/FromBase64String\('([^']+)'\)/)[1],'base64').toString('utf8'));
    const marker=script.match(/WriteLine\('(ARCADE_PROCESS_[a-f0-9]+:)'/)[1];state.calls.push({operation,payload,script});
    if(state.failure)throw Error('private error output');
    let result={state:state[operation]};
    if(operation==='start'){
      const saved=JSON.parse(fs.readFileSync(manager.file,'utf8'));assert.equal(saved.status,'starting');assert.equal(saved.sessionId,SESSION);assert.equal(saved.pid,undefined);
      result={pid:12345,startedAt:'2026-11-04T00:00:00.0000000Z',exe:process.execPath};
    }
    return {stdout:`unrelated launcher output\n${marker}${JSON.stringify(result)}\n`};
  };
  const manager=new NativeProcess({root,workspace:root,cli:process.execPath,run,platform:'win32'});
  const launch={cli:process.execPath,workspace:root,args:['--session-id',SESSION],sessionId:SESSION,resume:false,env:{CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF:'1'}};
  return {root,state,run,manager,launch};
}
test('owned process stops only a captured identity; restart metadata grants no process authority',async t=>{
  const {root,state,run,manager,launch}=fixture(t);
  const started=await manager.start(launch);assert.equal(started.status,'running');assert.equal(started.owned,true);assert.equal(started.canResume,false);
  await assert.rejects(manager.start(launch),/confirmed stopped/);
  const restored=new NativeProcess({root,workspace:root,cli:process.execPath,run,platform:'win32'});
  assert.equal(restored.getResumeSessionId(),SESSION);assert.equal(restored.snapshot().owned,false);
  await assert.rejects(restored.stop(),/does not own/);await assert.rejects(restored.start({...launch,resume:true,args:['--resume',SESSION]}),/confirmed stopped/);
  const stopped=await manager.stop();assert.equal(stopped.status,'stopped');assert.equal(stopped.canResume,true);assert.equal(stopped.externalJobsVerifiedStopped,false);
  const stop=state.calls.find(c=>c.operation==='stop');assert.equal(stop.payload.pid,12345);assert.equal(stop.payload.exe,process.execPath);assert.equal(stop.payload.startedAt,started.startedAt);
  assert(stop.script.indexOf('if(-not $matches)')<stop.script.indexOf('taskkill.exe'));assert.match(stop.script,/\/PID \$data.pid \/T \/F/);assert.doesNotMatch(stop.script,/\/IM|Stop-Process -Name/);
});
test('PID reuse or unreadable process identity fails closed',async t=>{
  const {state,manager,launch}=fixture(t);await manager.start(launch);state.stop='identity_changed';
  await assert.rejects(manager.stop(),/identity or exit/);assert.equal(manager.snapshot().owned,false);assert.equal(manager.snapshot().reason,'process_identity_changed');
  await assert.rejects(manager.stop(),/does not own/);
});
test('stop does not claim success when the process remains alive',async t=>{
  const {state,manager,launch}=fixture(t);await manager.start(launch);state.stop='still_running';
  await assert.rejects(manager.stop(),/identity or exit/);assert.equal(manager.snapshot().status,'unknown');assert.equal(manager.snapshot().canResume,false);
});
test('precise same-project resume waits for process exit and sends no task prompt',async t=>{
  const {manager,state,launch}=fixture(t);await manager.start(launch);state.probe='gone';await manager.refresh();
  assert.equal(manager.snapshot().status,'exited');assert.equal(manager.snapshot().owned,false);
  await assert.rejects(manager.start({...launch,resume:true,sessionId:'22222222-2222-4222-8222-222222222222',args:['--resume','22222222-2222-4222-8222-222222222222']}),/recorded session UUID/);
  await manager.start({...launch,resume:true,args:['--resume',SESSION]});
  assert.equal(state.calls.at(-1).payload.arguments,`"--resume" "${SESSION}"`);
});
test('uncertain start remains recorded and does not launch a duplicate',async t=>{
  const {manager,state,launch}=fixture(t);state.failure=true;
  await assert.rejects(manager.start(launch),/not confirmed/);assert.equal(manager.snapshot().status,'unknown');assert.equal(manager.snapshot().owned,false);
  await assert.rejects(manager.start(launch),/confirmed stopped/);assert.equal(state.calls.length,1);
});
test('corrupt metadata and cross-project launches cannot authorize a process action',async t=>{
  const {root,manager,launch,run,state}=fixture(t);
  await assert.rejects(manager.start({...launch,workspace:path.dirname(root)}),/Invalid native launch/);
  fs.mkdirSync(path.dirname(manager.file),{recursive:true});fs.writeFileSync(manager.file,'not json');
  const restored=new NativeProcess({root,workspace:root,cli:process.execPath,run,platform:'win32'});
  assert.equal(restored.snapshot().reason,'invalid_process_record');
  await assert.rejects(restored.start(launch),/confirmed stopped/);await assert.rejects(restored.stop(),/does not own/);
  assert.equal(state.calls.length,0);
});
test('concurrent native starts and stops cannot launch twice or race ownership capture',async t=>{
  const {manager,launch,run,state}=fixture(t);let entered,release;
  const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  manager.run=async(...args)=>{entered();await gate;return run(...args);};
  const first=manager.start(launch);await started;
  await assert.rejects(manager.start(launch),/already running/);await assert.rejects(manager.stop(),/already running/);
  release();await first;assert.equal(state.calls.filter(call=>call.operation==='start').length,1);
});
test('native argv quoting preserves text rather than PowerShell interpolation',()=>{
  assert.equal(quoteWindowsArgument('C:\\A B\\'),'"C:\\A B\\\\"');
  assert.equal(quoteWindowsArgument('say "hi"'),'"say \\"hi\\""');
  assert.equal(quoteWindowsArgument('$(secret); `evil`'),'"$(secret); `evil`"');
});

test('real Windows launch and stop target only a self-created harmless Node process tree',{
  skip:process.platform!=='win32'||process.env.ARCADE_NATIVE_PROCESS_LIVE!=='1',timeout:30000,
},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"arcade native live ' 中文-"));
  const script=path.join(root,'harmless.cjs'),receipt=path.join(root,'started.json');
  fs.writeFileSync(script,`const fs=require('node:fs'),{spawn}=require('node:child_process');\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});\nfs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({pid:process.pid,child:child.pid,args:process.argv.slice(2),handoff:process.env.CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF,stdinTTY:process.stdin.isTTY,stdoutTTY:process.stdout.isTTY}));\nconsole.log('Agent Arcade harmless process fixture. No model or account is used.');setInterval(()=>{},1000);\n`);
  const manager=new NativeProcess({root,workspace:root,cli:process.execPath});
  t.after(async()=>{if(manager.snapshot().owned)await manager.stop();fs.rmSync(root,{recursive:true,force:true});});
  const literal='spaces 中文 "quote" \\ $(not-a-command) `literal`';
  const started=await manager.start({cli:process.execPath,workspace:root,args:[script,'--session-id',SESSION,literal],sessionId:SESSION,resume:false});
  for(let i=0;i<100&&!fs.existsSync(receipt);i++)await new Promise(r=>setTimeout(r,50));
  const observed=JSON.parse(fs.readFileSync(receipt,'utf8'));assert.equal(observed.pid,started.pid);assert.deepEqual(observed.args,['--session-id',SESSION,literal]);assert.equal(observed.handoff,'1');
  assert.equal(observed.stdinTTY,true);assert.equal(observed.stdoutTTY,true);
  assert.equal((await manager.refresh()).status,'running');assert.equal((await manager.stop()).status,'stopped');
  for(const pid of [observed.pid,observed.child])assert.throws(()=>process.kill(pid,0),/ESRCH/);
  assert.equal(process.kill(process.pid,0),true); // The test runner and unrelated processes remain alive.
});
