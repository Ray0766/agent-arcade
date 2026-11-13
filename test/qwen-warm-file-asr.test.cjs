'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream'),{randomUUID}=require('node:crypto');
const {QwenWarmFileAsr}=require('../src/voice/qwen-warm-file-asr.cjs');
const next=()=>new Promise(resolve=>setImmediate(resolve));
const wait=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const audio=()=>({pcm:Buffer.alloc(16000*.4),sampleRate:16000});
function fixture(t,{auto=true,ready=true,timeoutMs=1000}={}){
  const state={spawn:0,close:0,writes:[],readyProofs:[],children:[],closeFailure:false,proveGate:null,ready};
  const proof={bind(value){state.bound=value;},async proveReady(value){state.readyProofs.push(value);if(state.proveGate)await state.proveGate.promise;return {verified:true};},async close(){state.close++;if(state.closeFailure)throw Error('PRIVATE details');return {closed:true};}};
  const spawnProcess=(file,args,options)=>{
    state.spawn++;state.spawnOptions=options;state.spawnFile=file;state.spawnArgs=args;
    const child=new EventEmitter();child.pid=321;child.stdout=new PassThrough();child.stderr=new PassThrough();child.nonce=args[4];
    child.emitRow=value=>child.stdout.write(JSON.stringify({version:1,nonce:child.nonce,...value})+'\n');
    child.stdin=new Writable({write(chunk,_encoding,cb){const row=JSON.parse(chunk.toString());state.writes.push(row);if(auto)queueMicrotask(()=>{child.emitRow({event:'transcript',id:row.id,text:`reply-${state.writes.length}`});child.emitRow({event:'job-clean',id:row.id});});cb();}});
    state.children.push(child);if(state.ready)queueMicrotask(()=>child.emitRow({event:'ready',pid:322,parentPid:321,modelLoaded:false}));return child;
  };
  const host=new QwenWarmFileAsr({pythonPath:path.resolve('work','synthetic-python.exe'),modelPath:path.resolve('work','synthetic-model'),spawnProcess,proofFactory:()=>proof,timeoutMs});
  t.after(async()=>{state.closeFailure=false;state.proveGate?.resolve();await host.close();});
  return {host,state,proof,child:()=>state.children[0],id:()=>randomUUID()};
}
test('no spawn at construction; cold and warm independent jobs share one proved worker only after finish',async t=>{
  const f=fixture(t),one=f.id(),two=f.id();assert.equal(f.state.spawn,0);assert.equal(await f.host.transcribe(audio(),{jobId:one}),'reply-1');assert.equal(f.host.busy,true);
  await assert.rejects(f.host.transcribe(audio(),{jobId:two}),{code:'busy'});assert.deepEqual(await f.host.finish({jobId:one,keepWarm:true}),{parked:true});assert.equal(f.host.busy,false);assert.equal(f.host.closed,false);
  assert.equal(await f.host.transcribe(audio(),{jobId:two}),'reply-2');await f.host.finish({jobId:two,keepWarm:true});assert.equal(f.state.spawn,1);assert.equal(f.state.readyProofs.length,1);assert.equal(f.state.close,0);assert.deepEqual(f.state.writes.map(x=>x.id),[one,two]);
  assert(f.state.writes.every(x=>Object.keys(x).sort().join()===['version','nonce','event','id','pcm','sampleRate','locale'].sort().join()));
  assert.equal(f.state.spawnOptions.windowsHide,true);assert.equal(f.state.spawnOptions.shell,false);assert.equal(f.state.spawnOptions.env.HF_HUB_OFFLINE,'1');assert(!f.state.spawnArgs.some(v=>v===f.state.writes[0].pcm));
  assert.deepEqual(await f.host.close(),{closed:true});assert.equal(f.host.closed,true);assert.equal(f.state.close,1);
});
test('transcript alone cannot return text or park the host before the cleanup boundary',async t=>{
  const f=fixture(t,{auto:false}),id=f.id();let done=false;const run=f.host.transcribe(audio(),{jobId:id}).then(v=>{done=true;return v;});await next();f.child().emitRow({event:'transcript',id,text:'own text'});await next();assert.equal(done,false);await assert.rejects(f.host.finish({jobId:id,keepWarm:true}),{code:'busy'});f.child().emitRow({event:'job-clean',id});assert.equal(await run,'own text');
});
test('ready identity proof settles before any PCM is sent',async t=>{
  const f=fixture(t),gate=wait();f.state.proveGate=gate;const id=f.id(),run=f.host.transcribe(audio(),{jobId:id});await next();assert.equal(f.state.writes.length,0);assert.deepEqual(f.state.readyProofs,[{pid:322,parentPid:321}]);gate.resolve();assert.equal(await run,'reply-1');
});
test('stale cancellation and reused UUID cannot stop or contaminate a later job',async t=>{
  const f=fixture(t,{auto:false}),one=f.id(),two=f.id();const first=f.host.transcribe(audio(),{jobId:one});await next();f.child().emitRow({event:'transcript',id:one,text:'first'});f.child().emitRow({event:'job-clean',id:one});await first;await f.host.finish({jobId:one,keepWarm:true});
  await assert.rejects(f.host.transcribe(audio(),{jobId:one}),{code:'invalid_config'});const second=f.host.transcribe(audio(),{jobId:two});await next();await assert.rejects(f.host.cancel({jobId:one}),{code:'wrong_scope'});assert.equal(f.state.close,0);f.child().emitRow({event:'transcript',id:two,text:'second'});f.child().emitRow({event:'job-clean',id:two});assert.equal(await second,'second');
});
test('cancel before ready closes the exact bound host and never sends PCM',async t=>{
  const f=fixture(t,{ready:false}),id=f.id();const run=f.host.transcribe(audio(),{jobId:id});await next();const cancel=f.host.cancel({jobId:id});await assert.rejects(run,{code:'cancelled'});await cancel;assert.equal(f.state.writes.length,0);assert.equal(f.state.close,1);assert.equal(f.host.closed,true);
});
test('cancel while process proof is pending waits for proof before closing',async t=>{
  const f=fixture(t),gate=wait();f.state.proveGate=gate;const id=f.id(),run=f.host.transcribe(audio(),{jobId:id});await next();let closed=false;const cancel=f.host.cancel({jobId:id}).then(()=>closed=true);await next();assert.equal(closed,false);assert.equal(f.state.close,0);gate.resolve();await assert.rejects(run,{code:'cancelled'});await cancel;assert.equal(f.state.writes.length,0);assert.equal(f.state.close,1);
});
test('abort after transcript and abort in the same clean-delivery turn both suppress the text',async t=>{
  for(const clean of [false,true])await t.test(String(clean),async t=>{const f=fixture(t,{auto:false}),controller=new AbortController(),id=f.id();const run=f.host.transcribe(audio(),{jobId:id,signal:controller.signal});await next();f.child().emitRow({event:'transcript',id,text:'must not escape'});if(clean)f.child().emitRow({event:'job-clean',id});controller.abort();await assert.rejects(run,{code:'cancelled'});assert.equal(f.host.closed,true);});
});
test('exit uncertainty keeps the same busy host until exact close retry succeeds',async t=>{
  const f=fixture(t,{auto:false}),id=f.id();f.state.closeFailure=true;const run=f.host.transcribe(audio(),{jobId:id});await next();await assert.rejects(f.host.cancel({jobId:id}),{code:'asr_exit_unconfirmed'});await assert.rejects(run,{code:'asr_exit_unconfirmed'});assert.equal(f.host.closed,false);assert.equal(f.host.busy,true);await assert.rejects(f.host.transcribe(audio(),{jobId:f.id()}),{code:'asr_exit_unconfirmed'});assert.equal(f.state.spawn,1);f.state.closeFailure=false;await f.host.close();assert.equal(f.host.closed,true);assert.equal(f.host.busy,false);
});
test('child close event alone is not a descendant-exit proof',async t=>{
  const f=fixture(t,{auto:false}),id=f.id();f.state.closeFailure=true;const run=f.host.transcribe(audio(),{jobId:id});await next();f.child().emit('close',0);await assert.rejects(run,{code:'asr_exit_unconfirmed'});assert.equal(f.host.closed,false);assert.equal(f.host.busy,true);
});
test('malformed, foreign, duplicate or out-of-order frames close rather than leak into another job',async t=>{
  for(const kind of ['nonce','id','duplicate','early-clean','unknown','oversize','model-loaded'])await t.test(kind,async t=>{
    const f=fixture(t,{auto:false,ready:kind!=='model-loaded'}),id=f.id(),run=f.host.transcribe(audio(),{jobId:id});await next();const child=f.child();
    if(kind==='nonce')child.emitRow({event:'transcript',id,text:'foreign',nonce:f.id()});if(kind==='id')child.emitRow({event:'transcript',id:f.id(),text:'foreign'});
    if(kind==='duplicate'){child.emitRow({event:'transcript',id,text:'first'});child.emitRow({event:'transcript',id,text:'second'});}if(kind==='early-clean')child.emitRow({event:'job-clean',id});
    if(kind==='unknown')child.emitRow({event:'progress',id});if(kind==='oversize')child.stdout.write('x'.repeat(17000));if(kind==='model-loaded')child.emitRow({event:'ready',pid:322,parentPid:321,modelLoaded:true});
    await assert.rejects(run,{code:'invalid_response'});assert.equal(f.host.closed,true);assert.equal(f.state.spawn,1);
  });
});
test('unsolicited output after parking invalidates and closes the idle resource',async t=>{
  const f=fixture(t),id=f.id();await f.host.transcribe(audio(),{jobId:id});await f.host.finish({jobId:id,keepWarm:true});f.child().emitRow({event:'job-clean',id});await next();assert.equal(f.host.closed,true);assert.equal(f.state.close,1);
});
test('an incomplete trailing frame cannot be parked with a successful transcript',async t=>{
  const f=fixture(t,{auto:false}),id=f.id(),run=f.host.transcribe(audio(),{jobId:id});await next();f.child().emitRow({event:'transcript',id,text:'must not escape'});f.child().stdout.write(JSON.stringify({version:1,nonce:f.child().nonce,event:'job-clean',id})+'\n{"partial":');await assert.rejects(run,{code:'invalid_response'});assert.equal(f.host.closed,true);
});
test('an old parked signal cannot abort a later job, but lifetime bounds close the owned host',async t=>{
  const f=fixture(t),controller=new AbortController(),id=f.id();await f.host.transcribe(audio(),{jobId:id,signal:controller.signal});await f.host.finish({jobId:id,keepWarm:true});controller.abort();assert.equal(f.host.closed,false);assert.equal(f.state.close,0);
  for(let i=1;i<128;i++){const id=f.id();await f.host.transcribe(audio(),{jobId:id});await f.host.finish({jobId:id,keepWarm:true});}
  await assert.rejects(f.host.transcribe(audio(),{jobId:f.id()}),{code:'asr_unavailable'});assert.equal(f.state.spawn,1);assert.equal(f.state.writes.length,128);assert.equal(f.state.close,1);assert.equal(f.host.closed,true);
});
test('a timed out job never leaves a warm worker for the next request',async t=>{
  const f=fixture(t,{auto:false,timeoutMs:20}),run=f.host.transcribe(audio(),{jobId:f.id()});await assert.rejects(run,{code:'timeout'});assert.equal(f.state.close,1);assert.equal(f.host.closed,true);
});
test('a worker error is fixed-code only and always requires exit proof',async t=>{
  const f=fixture(t,{auto:false}),id=f.id(),run=f.host.transcribe(audio(),{jobId:id});await next();f.child().emitRow({event:'error',id,code:'asr_unavailable'});await assert.rejects(run,{code:'asr_unavailable'});assert.equal(f.state.close,1);
});
test('invalid input and an already aborted signal never spawn a worker',async t=>{
  const f=fixture(t),controller=new AbortController();controller.abort();await assert.rejects(f.host.transcribe(audio(),{jobId:f.id(),signal:controller.signal}),{code:'cancelled'});await assert.rejects(f.host.transcribe({pcm:Buffer.alloc(1),sampleRate:16000},{jobId:f.id()}),{code:'voice_format'});await assert.rejects(f.host.transcribe(audio(),{jobId:'bad'}),{code:'invalid_config'});assert.equal(f.state.spawn,0);
});
