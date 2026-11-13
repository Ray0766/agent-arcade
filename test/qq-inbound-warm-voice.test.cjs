'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {OwnerVoicePipeline}=require('../src/bot/qq-inbound-voice.cjs');
const {AsrGate}=require('../src/voice/asr-gate.cjs');
const tick=()=>new Promise(r=>setImmediate(r)),defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture(t){
  const gate=new AsrGate(),hosts=[],pcm=[],states=[];let b={accountId:'12345001',ownerId:'12345002',companion:true,scopeId:'synthetic-scope',generation:1,client:{generation:1,socket:{}},dispatcher:{},url:'ws://127.0.0.1:3001/',token:'synthetic-unused-token'};
  const event=id=>({post_type:'message',message_type:'private',sub_type:'friend',self_id:b.accountId,user_id:b.ownerId,message_id:id,time:Math.floor(Date.now()/1000),message:[{type:'record',data:{file:'a'.repeat(32)+'.amr',file_size:1024}}]});
  const create=()=>{const host={closed:false,busy:false,jobs:[],closes:0,failClose:false,async transcribe(audio,{jobId,signal}){assert(!this.closed&&!this.busy);assert(audio.pcm.some(v=>v!==0));this.busy=true;this.job=jobId;this.jobs.push(jobId);await this.transcribeHook?.(signal);return '合成文字';},async finish({jobId}){assert.equal(jobId,this.job);await this.finishHook?.();this.busy=false;return {parked:true};},async close(){this.closes++;if(this.failClose)throw Error('synthetic uncertain exit');this.closed=true;this.busy=false;return {closed:true};},async cancel({jobId}){assert.equal(jobId,this.job);return this.close();}};hosts.push(host);return host;};
  let keyId=0;const identities=new WeakMap(),identity=value=>{if(!identities.has(value))identities.set(value,++keyId);return identities.get(value);};
  const make=overrides=>new OwnerVoicePipeline({keepWarm:true,getBinding:()=>b,reader:{async read(){const buffer=Buffer.alloc(8000,1);pcm.push(buffer);return {pcm:buffer,sampleRate:16000,durationSeconds:.25};}},claim:async()=>true,disposition:async(...args)=>states.push(args),createAsr:create,acquireLease:async meta=>{const reuseKey=[meta.scopeId,meta.accountId,meta.ownerId,meta.generation,meta.clientGeneration,identity(meta.socket),identity(meta.client),identity(meta.dispatcher)].join(':');await gate.prepare({reuseKey,signal:meta.signal});return {...gate.acquire({...meta,reuseKey}),reuseKey};},...overrides});
  t.after(async()=>{for(const host of hosts)host.failClose=false;await gate.retryCleanup();await gate.closeIdle();});
  return {gate,hosts,pcm,states,event,make,create,get binding(){return b;},set binding(value){b=value;}};
}
test('same binding reuses one finished host across separate pipelines without releasing its live gate',async t=>{
  const f=fixture(t),one=f.make();assert.equal((await one.process(f.event(1))).text,'合成文字');assert.equal(one.busy,false);assert.equal(f.gate.owner.state,'idle');assert.equal(f.hosts[0].closed,false);const oldCleanup=one.idleCleanup;
  const two=f.make();assert.equal((await two.process(f.event(2))).text,'合成文字');assert.equal(f.hosts.length,1);assert.equal(f.hosts[0].jobs.length,2);assert.notEqual(...f.hosts[0].jobs);assert(f.pcm.every(buffer=>buffer.every(v=>v===0)));
  await oldCleanup.close();await one.close();assert.equal(f.hosts[0].closes,0);assert.equal(f.gate.owner.state,'idle');await two.close();assert.equal(f.hosts[0].closed,true);assert.equal(f.gate.owner,null);
});
test('role, client socket and dispatcher changes close the old idle host before another factory',async t=>{
  for(const mutation of [f=>f.binding.scopeId='another-role',f=>f.binding.client.socket={},f=>f.binding.dispatcher={}])await t.test('changed binding',async t=>{const f=fixture(t),one=f.make();await one.process(f.event(1));mutation(f);const two=f.make({createAsr:()=>{assert.equal(f.hosts[0].closed,true);return f.create();}});await two.process(f.event(2));assert.equal(f.hosts.length,2);await one.close();assert.equal(f.hosts[1].closed,false);await two.close();});
});
test('an active inference stays exclusive and another pipeline cannot evict it',async t=>{
  const f=fixture(t),hold=defer(),one=f.make({createAsr:()=>{const host=f.create();host.transcribeHook=()=>hold.promise;return host;}}),pending=one.process(f.event(1));while(!f.hosts.length||!f.hosts[0].busy)await tick();await assert.rejects(f.make().process(f.event(2)),{code:'busy'});assert.equal(f.hosts[0].closes,0);hold.resolve();await pending;await one.close();
});
test('cancel during successful-finish handoff exits the host and never parks a stale transcript',async t=>{
  const f=fixture(t),hold=defer(),abort=new AbortController();let finishing=false;const one=f.make({createAsr:()=>{const host=f.create();host.finishHook=async()=>{finishing=true;await hold.promise;};return host;}}),pending=one.process(f.event(1),{signal:abort.signal});while(!finishing)await tick();abort.abort();hold.resolve();await assert.rejects(pending,{code:'cancelled'});assert.equal(f.gate.owner,null);assert.equal(f.hosts[0].closed,true);assert.equal(one.idleCleanup,null);assert(f.pcm[0].every(v=>v===0));
});
test('binding loss after parking closes only that exact idle lease and withholds the transcript',async t=>{
  const f=fixture(t),acquire=f.gate.acquire.bind(f.gate);f.gate.acquire=options=>{const lease=acquire(options);return {...lease,park:value=>{const result=lease.park(value);f.binding.generation++;return result;}};};
  const one=f.make();await assert.rejects(one.process(f.event(1)),{code:'account_changed'});assert.equal(f.gate.owner,null);assert.equal(f.hosts[0].closed,true);assert.equal(one.idleCleanup,null);
});
test('desktop preparation exits an idle host and old pipeline close cannot release the new microphone lease',async t=>{
  const f=fixture(t),one=f.make();await one.process(f.event(1));await f.gate.prepare();assert.equal(f.hosts[0].closed,true);const mic=f.gate.acquire({scopeId:'microphone',jobId:'manual-1'});await one.close();mic.assertCurrent();mic.release();
});
test('finish failure retires the worker rather than caching unconfirmed buffers',async t=>{
  const f=fixture(t),one=f.make({createAsr:()=>{const host=f.create();host.finish=async()=>({parked:false});return host;}});await assert.rejects(one.process(f.event(1)),{code:'asr_failed'});assert.equal(f.gate.owner,null);assert.equal(f.hosts[0].closed,true);
});
test('uncertain idle exit retains the exact owner and recoverable cleanup instead of replacing it',async t=>{
  const f=fixture(t),one=f.make();await one.process(f.event(1));f.hosts[0].failClose=true;await assert.rejects(one.close(),{code:'asr_exit_unconfirmed'});assert.equal(f.gate.owner.state,'failed');assert(one.idleCleanup);await assert.rejects(f.make().process(f.event(2)),{code:'asr_exit_unconfirmed'});assert.equal(f.hosts.length,1);f.hosts[0].failClose=false;await f.gate.retryCleanup();assert.equal(f.gate.owner,null);await one.close();assert.equal(one.idleCleanup,null);
});
test('uncertain active cancellation preserves the pipeline and gate until exact cleanup succeeds',async t=>{
  const f=fixture(t),one=f.make({createAsr:()=>{const host=f.create();host.failClose=true;host.finish=async()=>{throw Object.assign(Error(),{code:'asr_failed'});};return host;}});await assert.rejects(one.process(f.event(1)),{code:'asr_exit_unconfirmed'});assert.equal(one.busy,true);assert.equal(f.gate.owner.state,'active');await assert.rejects(f.gate.prepare(),{code:'busy'});f.hosts[0].failClose=false;await f.gate.retryCleanup();assert.equal(f.gate.owner,null);assert.equal(one.busy,false);
});
test('one-shot mode still cancels and releases before reporting a completed transcript',async t=>{
  const f=fixture(t),one=f.make({keepWarm:false,createAsr:f.create});await one.process(f.event(1));assert.equal(f.hosts[0].closed,true);assert.equal(f.gate.owner,null);assert.equal(one.idleCleanup,null);
});

test('scope change in the acquire continuation closes a resumed host without a new job cancel',async t=>{
  const f=fixture(t),one=f.make();await one.process(f.event(1));
  const acquire=f.gate.acquire.bind(f.gate);f.gate.acquire=options=>{const lease=acquire(options);f.binding.generation++;return lease;};
  const two=f.make();await assert.rejects(two.process(f.event(2)),{code:'account_changed'});
  assert.equal(f.hosts[0].jobs.length,1);assert.equal(f.hosts[0].closed,true);assert.equal(f.gate.owner,null);assert.equal(two.busy,false);
});

test('scope change after factory closes an unused host instead of cancelling an unstarted job',async t=>{
  const f=fixture(t),one=f.make({createAsr:()=>{const host=f.create();f.binding.generation++;return host;}});
  await assert.rejects(one.process(f.event(1)),{code:'account_changed'});assert.equal(f.hosts[0].jobs.length,0);assert.equal(f.hosts[0].closed,true);assert.equal(f.gate.owner,null);
});
