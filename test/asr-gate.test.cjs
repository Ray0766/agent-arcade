'use strict';
// Ownership logic only: no model, process, audio device or account.
const test=require('node:test'),assert=require('node:assert/strict');
const {AsrGate}=require('../src/voice/asr-gate.cjs');
const defer=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
const args=(jobId='synthetic-job-A')=>({scopeId:'synthetic-account-A',jobId});
test('different accounts and concurrent jobs never share the neural ASR owner',()=>{
  const gate=new AsrGate(),lease=gate.acquire(args());assert(Object.isFrozen(lease));
  for(const value of [args(),args('other-job'),{scopeId:'synthetic-account-B',jobId:'other'}])assert.throws(()=>gate.acquire(value),{code:'busy'});
  lease.assertCurrent();lease.release();const next=gate.acquire({scopeId:'synthetic-account-B',jobId:'other'});next.assertCurrent();next.release();
});
test('abort does not release live ownership, and an already aborted request acquires nothing',()=>{
  const gate=new AsrGate(),signal=new AbortController();signal.abort();assert.throws(()=>gate.acquire({...args(),signal:signal.signal}),{code:'cancelled'});
  const current=new AbortController(),lease=gate.acquire({...args(),signal:current.signal});current.abort();assert.throws(()=>gate.acquire(args('other')),{code:'busy'});lease.assertCurrent();lease.release();
});
test('invalid ownership data and cleanup callbacks never replace the current owner',()=>{
  const gate=new AsrGate();for(const value of [undefined,{},[],{scopeId:'',jobId:'x'},{scopeId:'x',jobId:''},{scopeId:'x'.repeat(513),jobId:'x'},{scopeId:'x',jobId:'x'.repeat(81)}])assert.throws(()=>gate.acquire(value),{code:'invalid_config'});
  const lease=gate.acquire(args());assert.throws(()=>lease.retainRecovery(null),{code:'invalid_config'});lease.assertCurrent();lease.release();
});
test('retry cleanup never evicts an active conversation that has not reported failed close',async()=>{
  const gate=new AsrGate(),lease=gate.acquire(args());await gate.retryCleanup();lease.assertCurrent();assert.throws(()=>gate.acquire(args('new')),{code:'busy'});lease.release();
});
test('failed cleanup retains the lease; one successful retry releases it without replaying parallel cleanups',async()=>{
  const gate=new AsrGate(),lease=gate.acquire(args()),blocked=defer();let calls=0;
  lease.retainRecovery(async()=>{calls++;await blocked.promise;throw Object.assign(Error('synthetic exit unconfirmed'),{code:'voice_exit_timeout'});});
  const first=gate.retryCleanup(),second=gate.retryCleanup();await Promise.resolve();assert.equal(calls,1);assert.throws(()=>gate.acquire(args('new')),{code:'busy'});blocked.resolve();
  await Promise.all([assert.rejects(first,{code:'voice_exit_timeout'}),assert.rejects(second,{code:'voice_exit_timeout'})]);lease.assertCurrent();
  lease.retainRecovery(async()=>{calls++;lease.release();});await gate.retryCleanup();assert.equal(calls,2);const next=gate.acquire(args('new'));next.release();
});
test('an old released lease cannot change, recover or release a newer account owner',async()=>{
  const gate=new AsrGate(),old=gate.acquire(args());old.release();const next=gate.acquire({scopeId:'synthetic-account-B',jobId:'job-B'});old.release();next.assertCurrent();assert.throws(()=>old.assertCurrent(),{code:'wrong_scope'});assert.throws(()=>old.retainRecovery(()=>{throw Error('must not run');}),{code:'wrong_scope'});await gate.retryCleanup();next.assertCurrent();next.release();
});
test('a scheduled old cleanup becomes a no-op when its owner releases before the microtask runs',async()=>{
  const gate=new AsrGate(),old=gate.acquire(args());let called=0;old.retainRecovery(()=>{called++;old.release();});const retry=gate.retryCleanup();old.release();const next=gate.acquire({scopeId:'synthetic-account-B',jobId:'new'});await retry;assert.equal(called,0);next.assertCurrent();next.release();
});
