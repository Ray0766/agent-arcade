'use strict';
// Production-shaped host plus actual proof helper; all process metadata and
// child streams below are synthetic. No native process is spawned or stopped.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream'),{randomUUID}=require('node:crypto');
const {QwenWarmFileAsr}=require('../src/voice/qwen-warm-file-asr.cjs');
const {PythonProcessProof}=require('../src/voice/python-process-proof.cjs');
const {AsrGate}=require('../src/voice/asr-gate.cjs');
const audio=()=>({pcm:Buffer.alloc(6400),sampleRate:16000});
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-warm-proof-')),python=path.join(root,'venv','Scripts','python.exe'),base=path.join(root,'base','python.exe'),systemRoot=path.join(root,'windows'),conhost=path.join(systemRoot,'System32','conhost.exe');
  for(const file of [python,base,conhost]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'SYNTHETIC - NEVER EXECUTE');}
  fs.writeFileSync(path.join(root,'venv','pyvenv.cfg'),`home = ${path.dirname(base)}\nexecutable = ${base}\n`);
  const state={rows:[],stops:[],spawns:0};
  const processHost={snapshot:async()=>structuredClone(state.rows),inspect:async ids=>structuredClone(state.rows.filter(row=>ids.includes(row.pid))),stop:async proofs=>{state.stops.push(structuredClone(proofs));state.rows=state.rows.filter(row=>!proofs.some(proof=>proof.pid===row.pid));return {stopped:true};}};
  const host=new QwenWarmFileAsr({pythonPath:python,modelPath:root,proofFactory:options=>new PythonProcessProof({...options,processHost,systemRoot}),spawnProcess:(_file,args)=>{
    state.spawns++;const createdAt=new Date().toISOString();state.rows=[{pid:341,parentPid:process.pid,createdAt,executable:python},{pid:342,parentPid:341,createdAt,executable:base},{pid:343,parentPid:341,createdAt,executable:conhost},{pid:999,parentPid:1,createdAt,executable:path.join(root,'unrelated.exe')}];
    const child=new EventEmitter();child.pid=341;child.stdout=new PassThrough();child.stderr=new PassThrough();const emit=value=>child.stdout.write(JSON.stringify({version:1,nonce:args[4],...value})+'\n');
    child.stdin=new Writable({write(chunk,_e,done){const row=JSON.parse(chunk.toString());queueMicrotask(()=>{emit({event:'transcript',id:row.id,text:'isolated reply'});emit({event:'job-clean',id:row.id});});done();}});
    queueMicrotask(()=>emit({event:'ready',pid:342,parentPid:341,modelLoaded:false}));return child;
  }});
  t.after(async()=>{state.rows=state.rows.filter(row=>row.pid!==444);await host.close();const actual=fs.realpathSync(root),temp=fs.realpathSync(os.tmpdir());assert(actual.toLowerCase().startsWith(temp.toLowerCase()+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return {host,state,root};
}
test('the actual proof helper supports two jobs then exact independent exit confirmation',async t=>{
  const f=fixture(t);for(let i=0;i<2;i++){const jobId=randomUUID();assert.equal(await f.host.transcribe(audio(),{jobId}),'isolated reply');await f.host.finish({jobId,keepWarm:true});}
  assert.equal(f.state.spawns,1);assert.equal(f.state.stops.length,0);await f.host.close();assert.equal(f.host.closed,true);assert.deepEqual(f.state.stops[0].map(row=>row.pid),[341,342,343]);assert.deepEqual(f.state.rows.map(row=>row.pid),[999]);
});
test('a new unknown descendant retains the warm host until a separate exact retry is safe',async t=>{
  const f=fixture(t),jobId=randomUUID();await f.host.transcribe(audio(),{jobId});await f.host.finish({jobId,keepWarm:true});f.state.rows.push({pid:444,parentPid:342,createdAt:new Date().toISOString(),executable:path.join(f.root,'unknown.exe')});
  await assert.rejects(f.host.close(),{code:'asr_exit_unconfirmed'});assert.equal(f.host.closed,false);assert.equal(f.host.busy,true);assert.equal(f.state.stops.length,0);f.state.rows=f.state.rows.filter(row=>row.pid!==444);await f.host.close();assert.equal(f.host.closed,true);assert.equal(f.state.stops.length,1);
});
test('the real draft gate transfers one clean resource without a stale lease closing a later job',async t=>{
  const f=fixture(t),timers=[];const gate=new AsrGate({schedule:fn=>{timers.push(fn);return timers.length;},unschedule:()=>{}});t.after(()=>gate.close());
  const reuseKey='synthetic-exact-live-binding',scopeId='synthetic-owner-character';let firstLease;
  for(let i=0;i<2;i++){
    const jobId=randomUUID();await gate.prepare({reuseKey});const lease=gate.acquire({scopeId,jobId,reuseKey});
    if(i===0){assert.equal(lease.resource,null);lease.attachResource(f.host);firstLease=lease;}else{assert.equal(lease.resource,f.host);assert.deepEqual(await firstLease.closeIdle(),{closed:false,stale:true});timers[0]();assert.equal(f.state.stops.length,0);}
    await f.host.transcribe(audio(),{jobId});await f.host.finish({jobId,keepWarm:true});lease.park({reuseKey,resource:f.host,closeIdle:()=>f.host.close()});
  }
  assert.equal(f.state.spawns,1);await gate.prepare();assert.equal(f.host.closed,true);assert.equal(gate.owner,null);assert.equal(f.state.stops.length,1);
});
