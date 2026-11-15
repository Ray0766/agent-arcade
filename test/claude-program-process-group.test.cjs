'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {createClaudeProgramRunner,terminateChild}=require('../src/bot/claude-program-runner.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,ms=5000){const end=Date.now()+ms;do{if(fn())return;await pause(20);}while(Date.now()<end);throw Error('Fixture did not become ready.');}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};

test('owned group termination escalates and never targets a positive or invalid group ID',async()=>{
  const signals=[];
  assert.equal(await terminateChild({}, {groupId:871234,timeoutMs:1,killImpl:(pid,signal)=>{signals.push([pid,signal]);if(signals.some(([,s])=>s==='SIGKILL'))throw Object.assign(Error(),{code:'ESRCH'});}}),true);
  assert.ok(signals.some(([pid,signal])=>pid===-871234&&signal==='SIGKILL'));
  for(const groupId of [0,1,-2,process.pid])assert.equal(await terminateChild({}, {groupId,killImpl:()=>assert.fail('invalid group must not be signalled')}),false);
  await assert.rejects(terminateChild({}, {groupId:871234,killImpl:()=>{throw Object.assign(Error(),{code:'EPERM'});}}),{code:'EPERM'});
});

for(const mode of ['reply','abort','close'])test(`real POSIX ${mode} cleans an owned CLI group, including TERM-resistant descendants`,{skip:process.platform==='win32',timeout:15000},async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-group-')),marker=path.join(folder,'ready.json'),release=path.join(folder,'release');
  const grandchild=`process.on('SIGTERM',()=>{});console.log(process.pid);setInterval(()=>{},1000);`;
  const descendant=`const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const c=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','pipe','ignore']});c.stdout.once('data',data=>console.log(JSON.stringify([process.pid,Number(data)])));setInterval(()=>{},1000);`;
  const script=`const {spawn}=require('node:child_process'),fs=require('node:fs'),readline=require('node:readline');
    process.on('SIGTERM',()=>{});process.stdin.on('end',()=>process.exit(0));
    const send=x=>console.log(JSON.stringify(x));
    readline.createInterface({input:process.stdin}).on('line',line=>{const f=JSON.parse(line);
      if(f.request?.subtype==='initialize')send({type:'control_response',response:{subtype:'success',request_id:f.request_id,response:{claude_code_version:'2.1.317',hook_on_failure_supported:true,hooks_applied:true}}});
      if(f.type==='user'){const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','pipe','ignore']});c.stdout.once('data',data=>{fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,...JSON.parse(String(data))]));if(${JSON.stringify(mode)}==='reply'){const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);send({type:'result',subtype:'success',is_error:false,session_id:f.session_id,user_message_uuid:f.uuid,result:'fixture only'});}},10);}});}
    });`;
  let owned;const other=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const controller=new AbortController();
  // Exercise the production 2 s exit-confirmation budget. A 500 ms override
  // intermittently expires during macOS orphan reaping even with CI's pool of
  // two files. Keep the real group/descendant/unrelated-process assertions.
  const runner=createClaudeProgramRunner({workspace:folder,executable:process.execPath,spawnImpl:(_cli,_args,options)=>{owned=spawn(process.execPath,['-e',script],options);return owned;},interruptTimeoutMs:30,exitTimeoutMs:2000,requestTimeoutMs:1000,taskTimeoutMs:8000});
  try{
    const pending=runner({prompt:'synthetic local process fixture',signal:controller.signal});
    await until(()=>fs.existsSync(marker));const ids=JSON.parse(fs.readFileSync(marker,'utf8'));
    // Independent OS evidence: every fixture PID is in the isolated group.
    if(process.env.ARCADE_PROCESS_PROOF==='1')for(const pid of ids)assert.equal(Number(execFileSync('/bin/ps',['-o','pgid=','-p',String(pid)],{encoding:'utf8'}).trim()),owned.pid);
    if(mode==='reply')fs.writeFileSync(release,'go');if(mode==='abort')controller.abort();if(mode==='close')await runner.close();
    const result=await pending;
    assert.equal(result.outcome,mode==='reply'?'reply_ended':'cancelled',JSON.stringify(result));
    await until(()=>ids.every(pid=>!alive(pid)));
    assert.equal(alive(other.pid),true,'an unrelated process must remain alive');
  }finally{
    await runner.close();if(owned?.pid)try{process.kill(-owned.pid,'SIGKILL');}catch{}
    other.kill('SIGKILL');await new Promise(resolve=>{if(other.exitCode!==null||other.signalCode)resolve();else other.once('exit',resolve);});
    fs.rmSync(folder,{recursive:true,force:true});
  }
});
