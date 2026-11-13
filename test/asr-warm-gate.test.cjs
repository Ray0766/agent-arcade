'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {AsrGate,IDLE_MS}=require('../src/voice/asr-gate.cjs');
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const args=(jobId='job-1',reuseKey='opaque-key-A',scopeId='scope-A')=>({scopeId,jobId,reuseKey});
function clock(){let time=0;const jobs=[];return {now:()=>time,schedule:(cb,ms)=>{const task={cb,due:time+ms,cancelled:false};jobs.push(task);return task;},unschedule:id=>{id.cancelled=true;},jobs,advance(ms,{fire=true}={}){time+=ms;for(const task of jobs)if(fire&&!task.cancelled&&task.due<=time){task.cancelled=true;task.cb();}}};}
function resource(){return {closed:false,busy:false,calls:0,async close(){this.calls++;this.closed=true;return {closed:true};}};}
function setup(){const timers=clock(),gate=new AsrGate(timers);return {gate,timers};}
function park(gate,host=resource(),options=args()){
  const lease=gate.acquire(options);lease.attachResource(host);lease.park({reuseKey:options.reuseKey,resource:host,closeIdle:()=>host.close()});return {lease,host};
}
test('legacy synchronous acquisition/release retains no resource and still rejects active competition',async()=>{
  const {gate}=setup(),lease=gate.acquire({scopeId:'desktop',jobId:'recording'});assert.equal(lease.resource,null);assert(Object.isFrozen(lease));await gate.retryCleanup();await assert.rejects(gate.prepare(args()),{code:'busy'});assert.throws(()=>gate.acquire(args()),{code:'busy'});lease.release();await gate.prepare();gate.acquire(args()).release();
});
test('same key resumes the exact single host; old lease, timer and closeIdle cannot end its later job',async()=>{
  const {gate,timers}=setup(),{lease:old,host}=park(gate),staleTimer=timers.jobs[0];old.release();assert(gate.owner);assert.throws(()=>old.assertCurrent(),{code:'wrong_scope'});
  await gate.prepare({reuseKey:'opaque-key-A'});const next=gate.acquire(args('job-2'));assert.equal(next.resource,host);assert.equal(host.calls,0);staleTimer.cb();assert.deepEqual(await old.closeIdle(),{closed:false,stale:true});next.assertCurrent();
  next.park({reuseKey:'opaque-key-A',resource:host,closeIdle:()=>host.close()});await old.closeIdle();staleTimer.cb();assert.equal(host.calls,0);assert.equal(gate.owner.state,'idle');await next.closeIdle();assert.equal(host.calls,1);assert.equal(gate.owner,null);
});
test('park only accepts completed clean resources and the exact captured key/resource',()=>{
  for(const kind of ['busy','closed','foreign-resource','wrong-key','unkeyed','recovery','aborted']){
    const {gate}=setup(),abort=new AbortController(),host=resource(),options=kind==='unkeyed'?{scopeId:'s',jobId:'j'}:args(),lease=gate.acquire({...options,signal:abort.signal});lease.attachResource(host);
    if(kind==='busy')host.busy=true;if(kind==='closed')host.closed=true;if(kind==='recovery')lease.retainRecovery(()=>{});if(kind==='aborted')abort.abort();
    assert.throws(()=>lease.park({reuseKey:kind==='wrong-key'?'wrong':options.reuseKey,resource:kind==='foreign-resource'?resource():host,closeIdle:()=>host.close()}));assert.equal(gate.owner.state,'active');
  }
});
test('a live attached or resumed host cannot be released as if it exited',async()=>{
  const {gate}=setup(),host=resource(),lease=gate.acquire(args());lease.attachResource(host);assert.throws(()=>lease.release(),{code:'asr_exit_unconfirmed'});lease.assertCurrent();host.closed=true;lease.release();
  const warm=park(gate);await gate.prepare({reuseKey:'opaque-key-A'});const next=gate.acquire(args('next'));assert.throws(()=>next.release(),{code:'asr_exit_unconfirmed'});await warm.lease.closeIdle();next.assertCurrent();await warm.host.close();next.release();assert.equal(gate.owner,null);
});
test('foreign scope and desktop close the idle host before either can claim',async()=>{
  for(const kind of ['foreign','desktop']){
    const {gate}=setup(),{host}=park(gate),closed=deferred();host.close=async()=>{host.calls++;await closed.promise;host.closed=true;return {closed:true};};
    const preparing=gate.prepare(kind==='foreign'?{reuseKey:'opaque-B'}:{});await flush();assert.equal(host.calls,1);assert.equal(gate.owner.state,'closing');assert.throws(()=>gate.acquire(kind==='foreign'?args('B','opaque-B','scope-B'):{scopeId:'desktop',jobId:'rec'}),{code:'busy'});
    closed.resolve();await preparing;const lease=gate.acquire(kind==='foreign'?args('B','opaque-B','scope-B'):{scopeId:'desktop',jobId:'rec'});assert.equal(lease.resource,null);lease.release();
  }
});
test('prepare creates no reservation: two same-key callers compete at synchronous acquire',async()=>{
  const {gate}=setup(),{host}=park(gate);await Promise.all([gate.prepare({reuseKey:'opaque-key-A'}),gate.prepare({reuseKey:'opaque-key-A'})]);const first=gate.acquire(args('next'));assert.equal(first.resource,host);assert.throws(()=>gate.acquire(args('third')),{code:'busy'});await host.close();first.release();
});
test('concurrent foreign prepare calls share a single close then still compete for acquisition',async()=>{
  const {gate}=setup(),{host}=park(gate),closed=deferred();host.close=async()=>{host.calls++;await closed.promise;host.closed=true;return {closed:true};};
  const a=gate.prepare({reuseKey:'B'}),b=gate.prepare({reuseKey:'C'});await flush();assert.equal(host.calls,1);closed.resolve();await Promise.all([a,b]);const lease=gate.acquire(args('B','B','scope-B'));assert.throws(()=>gate.acquire(args('C','C','scope-C')),{code:'busy'});lease.release();
});
test('fixed 30 second expiry closes once, including simultaneous explicit scope teardown',async()=>{
  const {gate,timers}=setup(),{lease,host}=park(gate);assert.equal(timers.jobs[0].due,IDLE_MS);timers.advance(IDLE_MS);await lease.closeIdle();await flush();assert.equal(host.calls,1);assert.equal(gate.owner,null);
});
test('claim wins before timer, whereas expiry first awaits confirmed exit before a new cold job',async()=>{
  const a=setup(),first=park(a.gate);a.timers.advance(IDLE_MS-1);await a.gate.prepare({reuseKey:'opaque-key-A'});const claimed=a.gate.acquire(args('new'));a.timers.advance(1);await flush();assert.equal(first.host.calls,0);await first.host.close();claimed.release();
  const b=setup(),second=park(b.gate),wait=deferred();second.host.close=async()=>{second.host.calls++;await wait.promise;second.host.closed=true;return {closed:true};};b.timers.advance(IDLE_MS);const preparing=b.gate.prepare({reuseKey:'opaque-key-A'});await flush();assert.equal(second.host.calls,1);assert.throws(()=>b.gate.acquire(args('new')),{code:'busy'});wait.resolve();await preparing;const next=b.gate.acquire(args('new'));assert.equal(next.resource,null);next.release();
});
test('late event-loop timer cannot extend the wall of eligibility past monotonic deadline',async()=>{
  const {gate,timers}=setup(),{host}=park(gate);timers.advance(IDLE_MS,{fire:false});assert.throws(()=>gate.acquire(args('new')),{code:'busy'});await gate.prepare({reuseKey:'opaque-key-A'});assert.equal(host.calls,1);assert.equal(gate.owner,null);
});
test('abort while closing never pretends the old process exited and never claims a replacement',async()=>{
  const {gate}=setup(),{host}=park(gate),wait=deferred(),abort=new AbortController();host.close=async()=>{host.calls++;await wait.promise;host.closed=true;return {closed:true};};
  const prepared=gate.prepare({reuseKey:'B',signal:abort.signal});await flush();abort.abort();assert.equal(gate.owner.state,'closing');assert.throws(()=>gate.acquire(args('B','B','scope-B')),{code:'busy'});wait.resolve();await assert.rejects(prepared,{code:'cancelled'});assert.equal(gate.owner,null);
});
test('failed idle exit retains exact owner and retryCleanup, not active work, can retry it',async()=>{
  const {gate,timers}=setup(),{lease,host}=park(gate);let fail=true;host.close=async()=>{host.calls++;if(fail)throw Error('PRIVATE RAW ERROR');host.closed=true;return {closed:true};};
  timers.advance(IDLE_MS);await flush();const owner=gate.owner;assert.equal(owner.state,'failed');assert.throws(()=>gate.acquire(args('new')),{code:'busy'});await assert.rejects(gate.retryCleanup(),error=>error.code==='asr_exit_unconfirmed'&&!error.message.includes('PRIVATE'));assert.equal(gate.owner,owner);
  fail=false;await Promise.all([gate.retryCleanup(),lease.closeIdle()]);assert.equal(gate.owner,null);const active=gate.acquire(args());await gate.retryCleanup();active.assertCurrent();active.release();
});
test('resolved close without confirmed resource exit is unknown, not released',async()=>{
  for(const kind of ['promise-only','flag-only']){
    const {gate}=setup(),{host}=park(gate);host.close=async()=>{host.calls++;if(kind==='flag-only')host.closed=true;return kind==='promise-only'?{closed:true}:undefined;};
    await assert.rejects(gate.prepare(),{code:'asr_exit_unconfirmed'});assert(gate.owner);assert.equal(gate.owner.state,'failed');
  }
});
test('an idle host that ended or changed state unexpectedly is closed and never reused',async()=>{
  for(const kind of ['closed','busy']){const {gate}=setup(),{host}=park(gate);host[kind]=true;await gate.prepare({reuseKey:'opaque-key-A'});assert.equal(host.calls,1);const next=gate.acquire(args('new'));assert.equal(next.resource,null);next.release();}
});
test('lease exact close cannot terminate a foreign idle or later same-key idle host',async()=>{
  const {gate}=setup(),a=park(gate);await gate.closeIdle({reuseKey:'not-A'});assert.equal(a.host.calls,0);await gate.prepare({reuseKey:'B'});const b=park(gate,resource(),args('B','B','scope-B'));await a.lease.closeIdle();assert.equal(b.host.calls,0);await gate.closeIdle({reuseKey:'B'});assert.equal(b.host.calls,1);
});
test('invalid reuse keys and resource replacements do not serialize or disturb current ownership',async()=>{
  const {gate}=setup(),values=[null,{},[],0,'','x'.repeat(1025)];for(const reuseKey of values){await assert.rejects(gate.prepare({reuseKey}),{code:'invalid_config'});assert.throws(()=>gate.acquire({...args(),reuseKey}),{code:'invalid_config'});}
  const lease=gate.acquire(args()),host=resource();lease.attachResource(host);assert.throws(()=>lease.attachResource(resource()),{code:'wrong_scope'});assert.throws(()=>lease.attachResource({close(){}}),{code:'invalid_config'});await host.close();lease.release();
});
test('close blocks new requests, closes idle only, and supports retry after uncertain exit',async()=>{
  const {gate}=setup(),{host}=park(gate);let okay=false;host.close=async()=>{host.calls++;if(!okay)throw Error();host.closed=true;return {closed:true};};await assert.rejects(gate.close(),{code:'asr_exit_unconfirmed'});assert.throws(()=>gate.acquire(args()),{code:'manager_closing'});await assert.rejects(gate.prepare(),{code:'manager_closing'});okay=true;await gate.retryCleanup();assert.equal(gate.owner,null);assert.deepEqual(await gate.close(),{closed:true});
});
test('closing the gate never evicts an active owner; its existing lease may still safely clean up',async()=>{
  const {gate}=setup(),host=resource(),lease=gate.acquire(args());lease.attachResource(host);await assert.rejects(gate.close(),{code:'busy'});assert.equal(host.calls,0);host.closed=true;lease.release();assert.equal(gate.owner,null);
});
test('a queued recovery cannot affect a replacement owner released before its microtask',async()=>{
  const {gate}=setup(),lease=gate.acquire({scopeId:'desktop',jobId:'old'});let called=0;lease.retainRecovery(()=>{called++;lease.release();});const retry=gate.retryCleanup();lease.release();const next=gate.acquire({scopeId:'desktop',jobId:'new'});await retry;assert.equal(called,0);next.assertCurrent();next.release();
});
