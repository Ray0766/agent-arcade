'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ChildProcess,spawn}=require('node:child_process');
const {once}=require('node:events');
const {PosixPythonProcessProof,createPosixPythonProcessHost,parseRows}=require('../src/voice/posix-python-process-proof.cjs');
const uid=process.getuid?.()??501,exitCode={code:'asr_exit_unconfirmed'};
const rootPid=50002,memberPid=50003,startedAt=1800000000123,creation=1800000000000;
const posixTest=(name,fn)=>test(name,{skip:process.platform==='win32'},fn);
const row=(pid,parentPid,{groupId=rootPid,owner=uid,state='S',createdAt=creation,executable=process.execPath}={})=>({
 pid,parentPid,groupId,uid:owner,state,createdAt,executable,
});
function fake({deniedProbes=0,observeExit=true}={}){
 const child=new ChildProcess();child.pid=rootPid;child.spawnfile=process.execPath;
 const state={rows:[row(rootPid,process.pid,{state:'Ss'}),row(memberPid,rootPid)],signalled:[]};
 const processHost={snapshot:async()=>structuredClone(state.rows),inspect:async ids=>structuredClone(state.rows.filter(r=>ids.includes(r.pid))),
  kill:(pid,signal)=>{
   state.signalled.push({pid,signal});
   if(!state.rows.some(r=>r.groupId===-pid)){
    const denied=signal===0&&deniedProbes>0;if(denied)deniedProbes--;
    throw Object.assign(Error('absent'),{code:denied?'EPERM':'ESRCH'});
   }
   if(signal==='SIGTERM'){state.rows=state.rows.filter(r=>r.groupId!==-pid);if(observeExit)child.signalCode='SIGTERM';}
  }};
 const proof=new PosixPythonProcessProof({pythonPath:process.execPath,uid,now:()=>startedAt,processHost});
 return {child,state,proof,processHost,bind:()=>proof.bind({pid:rootPid,startedAt,child}),ready:()=>proof.proveReady({pid:rootPid,parentPid:process.pid})};
}

posixTest('macOS scalar and exact executable observations are bounded and reject malformed stamps',()=>{
 assert.deepEqual(parseRows(' 1 0 1 0 Ss\n 123 45 123 501 S+\n'),[
  {pid:1,parentPid:0,groupId:1,uid:0,state:'Ss'}, {pid:123,parentPid:45,groupId:123,uid:501,state:'S+'},
 ]);
 const value=parseRows(' 123 45 123 501 Ss Thu Nov 19 10:47:59 2026 /private/tmp/Test Binary\n',true)[0];
 assert.equal(value.createdAt,Date.UTC(2026,10,19,10,47,59));
 assert.equal(value.executable,'/private/tmp/Test Binary');
 for(const text of ['123 45 123 501 invalid','123 45 123 501 Ss Thu Nov 50 10:47:59 2026 /bin/test','123 45 123 501 Ss Thu Nov 19 10:47:59 2026 relative']){
  assert.throws(()=>parseRows(text,true),exitCode);
 }
});

posixTest('unknown states in unrelated Darwin ps rows do not block a verified group',async()=>{
 const f=fake();
 const unrelated=parseRows('51000 1 51000 501 ?\n51001 1 51001 501 ?E\n51002 1 51002 501 ?Es\n51003 1 51003 501 ?s\n');
 assert.deepEqual(unrelated.map(row=>row.state),['?','?E','?Es','?s']);
 f.state.rows.push(...unrelated);
 f.bind();
 assert.deepEqual(await f.ready(),{verified:true});
 assert.deepEqual(await f.proof.close(),{closed:true});
 assert.deepEqual(f.state.rows.slice(),unrelated);
 assert.deepEqual(f.state.signalled.filter(call=>call.signal!==0),[{pid:-rootPid,signal:'SIGTERM'}]);
});

posixTest('an unknown run state in the actual owned group cannot establish a safe signal',async()=>{
 for(const detail of [false,true]){
  const f=fake();f.bind();await f.ready();
  if(detail){
   const inspect=f.processHost.inspect;
   f.processHost.inspect=async pids=>(await inspect(pids)).map(row=>row.pid===memberPid?{...row,state:'?Es'}:row);
  }else f.state.rows[1].state='?E';
  await assert.rejects(f.proof.close(),exitCode);
  assert.deepEqual(f.state.signalled.filter(call=>call.signal!==0),[]);
 }
});

posixTest('only the original ChildProcess and its independently matching detached group are proven',async()=>{
 const f=fake();assert.throws(()=>f.proof.bind({pid:rootPid,startedAt,child:{pid:rootPid}}),exitCode);
 assert.deepEqual(f.bind(),{bound:true});
 await assert.rejects(f.proof.proveReady({pid:memberPid,parentPid:rootPid}),exitCode);
 assert.deepEqual(await f.ready(),{verified:true});
 assert.deepEqual(await f.proof.close(),{closed:true});
 assert.deepEqual(await f.proof.close(),{closed:true});
 assert.deepEqual(f.state.signalled.filter(call=>call.signal!==0),[{pid:-rootPid,signal:'SIGTERM'}]);
});

posixTest('cancellation before the ready handshake still checks and closes the child group',async()=>{
 const f=fake();f.bind();assert.deepEqual(await f.proof.close(),{closed:true});
 assert(f.state.signalled.every(call=>call.pid===-rootPid));
});

posixTest('mismatched UID, parent, executable, creation stamp or group ancestry never signal',async t=>{
 const mutations={
  owner:f=>{f.state.rows[0].uid=uid+1;}, parent:f=>{f.state.rows[0].parentPid=222;},
  executable:f=>{f.state.rows[0].executable='/bin/sh';}, creation:f=>{f.state.rows[0].createdAt=creation-1000;},
  membership:f=>{f.state.rows[1].groupId=memberPid;}, foreign:f=>{f.state.rows[1].parentPid=66;}, session:f=>{f.state.rows[0].state='S';},
 };
 for(const [name,modify] of Object.entries(mutations))await t.test(name,async()=>{
  const f=fake();modify(f);f.bind();await assert.rejects(f.ready(),exitCode);
  await assert.rejects(f.proof.close(),exitCode);assert.deepEqual(f.state.signalled.filter(call=>call.signal!==0),[]);
 });
});

posixTest('an independently recorded surviving descendant is owned, but an unrecorded orphan is not',async()=>{
 for(const known of [true,false]){
  const f=fake();f.bind();await f.ready();f.child.exitCode=0;
  f.state.rows=[row(known?memberPid:memberPid+1,1)];
  if(known)assert.deepEqual(await f.proof.close(),{closed:true});
  else {await assert.rejects(f.proof.close(),exitCode);assert.deepEqual(f.state.signalled.filter(call=>call.signal!==0),[]);}
 }
});

posixTest('Darwin waits for transient EPERM to resolve to independently confirmed absence',async()=>{
 const f=fake({deniedProbes:3});f.bind();await f.ready();
 assert.deepEqual(await f.proof.close(),{closed:true});
 assert(f.state.signalled.filter(call=>call.signal===0).length>=5);
 assert.deepEqual(f.state.signalled.filter(call=>call.signal!==0),[{pid:-rootPid,signal:'SIGTERM'}]);
});

posixTest('an empty native group view cannot establish exit while EPERM continues or the child has not exited',async()=>{
 await Promise.all([{deniedProbes:Infinity},{observeExit:false}].map(async options=>{
  const f=fake(options);f.bind();await f.ready();
  await assert.rejects(f.proof.close(),exitCode);
  assert.deepEqual(f.state.signalled.filter(call=>call.signal!==0),[{pid:-rootPid,signal:'SIGTERM'}]);
 }));
});

const mac=process.platform==='darwin';
test('on macOS the actual owned worker and TERM-resistant descendant leave their private group', {skip:!mac},async t=>{
 const worker=`const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>process.stdout.write(String(child.pid)));setInterval(()=>{},1000);`;
 const startedAt=Date.now(),child=spawn(process.execPath,['-e',worker],{detached:true,stdio:['ignore','pipe','pipe']});
 const killCalls=[],host=createPosixPythonProcessHost({kill:(pid,signal)=>{
  assert.equal(pid,-child.pid);killCalls.push(signal);return process.kill(pid,signal);
 }});
 t.after(()=>{if(child.exitCode==null&&child.signalCode==null){try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}});
 const proof=new PosixPythonProcessProof({pythonPath:process.execPath,processHost:host});
 proof.bind({pid:child.pid,startedAt,child});
 const [raw]=await once(child.stdout,'data'),member=Number(String(raw));assert(member>1);
 assert.deepEqual(await proof.proveReady({pid:child.pid,parentPid:process.pid}),{verified:true});
 assert.deepEqual(await proof.close(),{closed:true});
 assert(killCalls.includes('SIGTERM')&&killCalls.includes('SIGKILL'));
 assert(!(await host.snapshot()).some(row=>row.groupId===child.pid));
 assert.deepEqual(await host.inspect([child.pid,member]),[]);
});
