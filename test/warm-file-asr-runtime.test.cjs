'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runtimeSnapshot,createWarmFileAsrProvider}=require('../src/voice/warm-file-asr-runtime.cjs');
const {AsrGate}=require('../src/voice/asr-gate.cjs');
function fixture(t){
  const gate=new AsrGate();let revision='synthetic-revision',created=0;
  const provider=createWarmFileAsrProvider({root:'synthetic-only',gate,readRuntime:()=>({revision,options:{pythonPath:'synthetic-python',modelPath:'synthetic-model'}}),createAsr:()=>{created++;return {closed:false,busy:false,async close(){this.closed=true;return {closed:true};}};}});
  const value={scopeId:'scope',accountId:'12345001',ownerId:'12345002',generation:1,clientGeneration:1,client:{},socket:{},dispatcher:{},jobId:'first'};
  t.after(async()=>{await gate.retryCleanup();await gate.closeIdle();});
  return {provider,gate,value,get created(){return created;},revision(v){revision=v;}};
}
test('a provider reuses only a matching process-private binding and runtime revision',async t=>{
  const f=fixture(t),options=f.provider.pipelineOptions(),first=await options.acquireLease(f.value),host=options.createAsr();first.attachResource(host);first.park({reuseKey:first.reuseKey,resource:host,closeIdle:()=>host.close()});
  const second=await f.provider.pipelineOptions().acquireLease({...f.value,jobId:'second'});assert.equal(second.resource,host);assert.equal(second.reuseKey,first.reuseKey);assert.match(second.reuseKey,/^[a-f0-9]{64}$/);assert.equal(f.created,1);await host.close();second.release();
});
test('each binding change closes a prior idle resource before acquisition',async t=>{
  for(const change of [v=>v.scopeId+='new',v=>v.accountId='12345003',v=>v.ownerId='12345003',v=>v.generation++,v=>v.clientGeneration++,v=>v.client={},v=>v.socket={},v=>v.dispatcher={}])await t.test('changed identity',async t=>{
    const f=fixture(t),options=f.provider.pipelineOptions(),one=await options.acquireLease(f.value),host=options.createAsr();one.attachResource(host);one.park({reuseKey:one.reuseKey,resource:host,closeIdle:()=>host.close()});change(f.value);
    const two=await f.provider.pipelineOptions().acquireLease(f.value);assert.equal(host.closed,true);assert.notEqual(two.reuseKey,one.reuseKey);two.release();
  });
});
test('configuration replacement before or during prepare prevents stale acquisition and creation',async t=>{
  const f=fixture(t),options=f.provider.pipelineOptions();f.revision('changed');await assert.rejects(options.acquireLease(f.value),{code:'asr_unavailable'});assert.throws(()=>options.createAsr(),{code:'asr_unavailable'});assert.equal(f.gate.owner,null);
  const next=f.provider.pipelineOptions(),prepare=f.gate.prepare.bind(f.gate);f.gate.prepare=async x=>{await prepare(x);f.revision('changed-again');};await assert.rejects(next.acquireLease(f.value),{code:'asr_unavailable'});assert.equal(f.gate.owner,null);assert.equal(f.created,0);
});
test('an invalid binding cannot clear another active owner',async t=>{
  const f=fixture(t),mic=f.gate.acquire({scopeId:'microphone',jobId:'other'});await assert.rejects(f.provider.pipelineOptions().acquireLease({...f.value,socket:null}),{code:'asr_unavailable'});mic.assertCurrent();mic.release();
});
test('a configuration change after acquisition invalidates a resumed resource before use',async t=>{
  const f=fixture(t),options=f.provider.pipelineOptions(),first=await options.acquireLease(f.value),host=options.createAsr();first.attachResource(host);first.park({reuseKey:first.reuseKey,resource:host,closeIdle:()=>host.close()});
  const second=await f.provider.pipelineOptions().acquireLease({...f.value,jobId:'second'});f.revision('replaced-after-acquire');assert.throws(()=>second.assertCurrent(),{code:'asr_unavailable'});await host.close();second.release();assert.equal(f.gate.owner,null);
});
test('runtime snapshots read only bounded local configuration and change after replacement',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-warm-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const python=path.join(root,'python.exe'),model=path.join(root,'model');fs.writeFileSync(python,'synthetic runtime');fs.mkdirSync(model);fs.writeFileSync(path.join(root,'local-voice.json'),JSON.stringify({version:1,asrPython:python,asrModel:model}));
  const first=runtimeSnapshot(root);assert.deepEqual(first.options,{pythonPath:python,modelPath:model});assert.equal(runtimeSnapshot(root).revision,first.revision);fs.appendFileSync(python,' changed');assert.notEqual(runtimeSnapshot(root).revision,first.revision);
  fs.writeFileSync(path.join(root,'local-voice.json'),' '.repeat(8193));assert.throws(()=>runtimeSnapshot(root),{code:'asr_unavailable'});
});
