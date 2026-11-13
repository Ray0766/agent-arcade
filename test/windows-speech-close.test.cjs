'use strict';
// Controlled ChildProcess event fixtures: no microphone, system voice or model.
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {WindowsSpeech}=require('../src/voice/windows-speech.cjs');
let nextPid=70000;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function child({ready=true,pid=++nextPid}={}){
  const c=new EventEmitter();c.pid=pid;c.stdout=new PassThrough();c.stderr=new PassThrough();c.requests=[];c.killCalls=0;c.killResult=true;c.throwKill=false;c.exitCode=null;c.signalCode=null;
  c.row=row=>c.stdout.write(JSON.stringify(row)+'\n');
  c.stdin={write:line=>{const row=JSON.parse(line);c.requests.push(row);queueMicrotask(()=>{if(['interrupt','close','capabilities'].includes(row.op))c.row({id:row.id,event:{interrupt:'interrupted',close:'closed',capabilities:'capabilities'}[row.op]});});return true;}};
  c.kill=()=>{c.killCalls++;if(c.throwKill)throw Error('synthetic kill failure');c.killed=c.killResult;return c.killResult;};
  c.exit=(code=0,signal=null)=>{c.exitCode=code;c.signalCode=signal;c.emit('exit',code,signal);};
  if(ready)queueMicrotask(()=>c.row({event:'ready'}));return c;
}
function fixture(options={}){
  const children=[],speech=new WindowsSpeech({platform:'win32',gracefulExitMs:5,exitTimeoutMs:15,...options,spawnProcess:()=>{const c=child(options.childOptions);children.push(c);return c;}});
  return {speech,children,start:async()=>{await speech.start();return children.at(-1);}};
}
test('graceful close acknowledgement alone is not exit; exact child exit completes it',async()=>{
  const f=fixture({gracefulExitMs:100}),c=await f.start();let settled=false;const closing=f.speech.close().then(()=>{settled=true;});await tick();
  assert(c.requests.some(r=>r.op==='close'));assert.equal(settled,false);assert.equal(f.speech.child,c);assert.equal(c.killCalls,0);assert.equal(f.speech.closed,false);
  c.exit();await closing;assert.equal(f.speech.closed,true);assert.equal(f.speech.child,null);assert.equal(c.killCalls,0);assert.equal(f.speech.diagnostics().events.filter(e=>e.event==='host-exit').length,1);
});
test('kill request waits for actual exit, with one shared concurrent close',async()=>{
  const f=fixture(),c=await f.start();let killed;const observed=new Promise(r=>{killed=r;});c.kill=()=>{c.killCalls++;killed();return true;};
  const first=f.speech.close(),second=f.speech.close();assert.equal(first,second);await observed;let settled=false;first.then(()=>{settled=true;});await tick();
  assert.equal(settled,false);assert.equal(f.speech.child,c);assert.equal(f.speech.diagnostics().exitUnconfirmed,true);assert.equal(c.requests.filter(r=>r.op==='close').length,1);
  c.exit(null,'SIGTERM');await first;assert.equal(f.speech.closed,true);assert.equal(c.killCalls,1);
});
for(const failure of ['false','throw'])test(`unconfirmed kill ${failure} keeps its owned helper and permits close retry`,async()=>{
  const f=fixture(),c=await f.start();c.killResult=false;c.throwKill=failure==='throw';
  await assert.rejects(f.speech.close(),{code:'voice_exit_unconfirmed'});assert.equal(f.speech.child,c);assert.equal(f.speech.host.child,c);assert.equal(f.speech.closed,false);assert.equal(f.speech.diagnostics().running,true);assert.equal(f.speech.host.waiters.size,0);
  assert(!f.speech.diagnostics().events.some(e=>e.event==='host-exit'));await assert.rejects(f.speech.start(),{code:'voice_exit_unconfirmed'});assert.equal(f.children.length,1);
  c.kill=()=>{c.killCalls++;queueMicrotask(()=>c.exit(null,'SIGTERM'));return true;};await f.speech.close();assert.equal(f.speech.closed,true);assert.equal(f.speech.child,null);assert.equal(f.children.length,1);
});
test('close during startup retains the child until its exit and never starts another helper',async()=>{
  const f=fixture({childOptions:{ready:false}}),starting=f.speech.start();const rejected=assert.rejects(starting,{code:'voice_unavailable'}),c=f.children[0];
  c.kill=()=>{c.killCalls++;queueMicrotask(()=>c.exit(null,'SIGTERM'));return true;};await f.speech.close();await rejected;assert.equal(f.speech.closed,true);assert.equal(f.children.length,1);
  c.row({event:'ready'});assert.equal(f.speech.ready,false);await assert.rejects(f.speech.capabilities());
});
test('a spawn error without an OS child is terminal, not an indefinitely retained process',async()=>{
  const f=fixture({childOptions:{ready:false,pid:null}});
  const starting=f.speech.start(),c=f.children[0];const rejected=assert.rejects(starting,{code:'voice_unavailable'});c.emit('error',Error('synthetic spawn failure'));await rejected;await f.speech.close();
  assert.equal(f.speech.child,null);assert.equal(c.killCalls,0);assert(f.speech.diagnostics().events.some(e=>e.event==='host-spawn-failed'));
});
test('an error from an existing child is not exit and cannot detach it',async()=>{
  const f=fixture(),c=await f.start();c.emit('error',Error('synthetic live error'));assert.equal(f.speech.child,c);assert.equal(f.speech.host.exited,false);assert.equal(c.killCalls,1);
  const closing=f.speech.close();await tick();c.exit();await closing;assert.equal(f.speech.child,null);
});
test('late events from an exited helper cannot invalidate its successor',async()=>{
  const f=fixture(),old=await f.start();f.speech.destroy();assert.equal(f.speech.child,old);old.exit();const current=await f.start();
  old.row({event:'ready'});old.row({event:'playback-start',id:'old'});old.emit('error',Error('late old error'));old.emit('exit',0,null);
  assert.equal(f.speech.child,current);assert.equal(f.speech.ready,true);assert.equal(current.killCalls,0);assert.equal(f.children.length,2);
  const closing=f.speech.close();await tick();current.exit();await closing;
});
test('a late failed interruption cannot terminate a successor helper',async()=>{
  const f=fixture(),old=await f.start();let rejectRequest;const original=f.speech.request;f.speech.request=()=>new Promise((_,reject)=>{rejectRequest=reject;});
  const interrupting=f.speech.interrupt();old.exit();const current=await f.start();rejectRequest(Error('late interrupted request'));await interrupting;
  assert.equal(current.killCalls,0);assert.equal(f.speech.child,current);f.speech.request=original;const closing=f.speech.close();await tick();current.exit();await closing;
});
test('new capabilities/listen work cannot slip in once close begins',async()=>{
  const f=fixture({gracefulExitMs:100}),c=await f.start();const closing=f.speech.close();await assert.rejects(f.speech.capabilities(),{code:'voice_closed'});await tick();
  assert(!c.requests.some(r=>r.op==='capabilities'));c.exit();await closing;
});
test('interrupting a retained retiring helper does not report success until its exit',async()=>{
  const f=fixture(),c=await f.start();f.speech.destroy();await assert.rejects(f.speech.interrupt(),{code:'voice_exit_unconfirmed'});
  assert.equal(f.speech.child,c);assert.equal(f.speech.closed,false);const interrupting=f.speech.interrupt();c.exit();await interrupting;await f.speech.close();
});
