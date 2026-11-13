'use strict';
// Synthetic protocol tests only: no real process, model, audio device or QQ.
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {createHash}=require('node:crypto');
const {GptSovitsSpeech}=require('../src/voice/gpt-sovits.cjs');
const {canonicalWav}=require('../src/bot/qq-voice-payload.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({ready=true,exitOnKill=true,exitTimeoutMs=40}={}){
  const children=[],calls=[];
  const spawnProcess=(executable,args,options)=>{
    const child=new EventEmitter();child.pid=100+children.length;child.rows=[];child.killed=false;
    child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.stdin=new Writable({write(chunk,encoding,done){child.rows.push(JSON.parse(chunk.toString()));done();}});
    child.send=row=>child.stdout.write(JSON.stringify(row)+'\n');
    child.kill=()=>{child.killed=true;if(exitOnKill)queueMicrotask(()=>child.emit('exit',0));};
    children.push(child);calls.push({executable,args,options});
    if(ready)queueMicrotask(()=>child.send({event:'ready',outputAvailable:false,outputDevice:'',outputChecked:false,renderAvailable:true}));
    return child;
  };
  const speech=new GptSovitsSpeech({pythonPath:path.resolve('fake-python.exe'),repoPath:path.resolve('fake-repo'),referencePath:path.resolve('fake.wav'),spawnProcess,exitTimeoutMs});
  async function rendering(text='原创合成测试。',options={}){const promise=speech.render(text,options);await tick();const child=children.at(-1),id=child.rows.findLast(row=>row.op==='render')?.id;return{promise,child,id};}
  return{speech,children,calls,rendering};
}
function protocol(id,{samples=9600,zero=false}={}){
  const pcm=Buffer.alloc(samples*2,zero?0:1),rows=[{event:'render-start',id,sampleRate:32000,channels:1,bits:16}];
  let seq=0;for(let offset=0;offset<pcm.length;offset+=8192){const part=pcm.subarray(offset,offset+8192);rows.push({event:'render-pcm',id,seq:++seq,samples:part.length/2,data:part.toString('base64')});}
  rows.push({event:'render-end',id,frames:seq,samples,sha256:createHash('sha256').update(pcm).digest('hex')});
  return{pcm,rows,wire:rows.map(row=>JSON.stringify(row)+'\n').join('')};
}
function send(active,options){const fixture=protocol(active.id,options);active.child.stdout.write(fixture.wire);return fixture;}

test('render requires no output device, returns canonical WAV only after normal final and logs no content',async()=>{
  const h=harness(),events=[];h.speech.on('playback-start',row=>events.push(row));h.speech.on('playback-end',row=>events.push(row));
  const text='私有但纯合成的输入',a=await h.rendering(text),fixture=protocol(a.id);
  assert.equal(h.calls[0].args.some(value=>value.includes(text)),false);assert.equal(a.child.rows[0].text,text);
  assert.equal(h.calls[0].options.shell,undefined);assert.equal(h.calls[0].options.env.HF_HUB_OFFLINE,'1');
  for(const row of fixture.rows.slice(0,-1))a.child.send(row);
  let settled=false;a.promise.then(()=>{settled=true;});await tick();assert.equal(settled,false);
  a.child.send(fixture.rows.at(-1));const result=await a.promise;
  assert.equal(result.durationSeconds,.3);assert.equal(result.frames,9600);assert.deepEqual(result.wav.subarray(44),fixture.pcm);
  assert.deepEqual(canonicalWav(result.wav).bytes,result.wav);assert.deepEqual(events,[]);assert.equal(h.speech.pending.size,0);
  const diagnostic=JSON.stringify(h.speech.diagnostics());assert.equal(diagnostic.includes(text),false);assert.equal(diagnostic.includes(fixture.rows[1].data),false);
  await h.speech.close();
});
test('capabilities does not send model or output requests and a loaded worker is reused',async()=>{
  const h=harness(),cap=await h.speech.capabilities();assert.equal(cap.renderAvailable,true);assert.equal(cap.outputChecked,false);assert.equal(cap.outputAvailable,false);assert.deepEqual(h.children[0].rows,[]);
  const warm=h.speech.warmup();await tick();const child=h.children[0];child.send({event:'warm',id:child.rows.at(-1).id});await warm;
  for(let n=0;n<2;n++){const a=await h.rendering();send(a);await a.promise;}
  assert.equal(h.children.length,1);await h.speech.close();
});
test('split frames and one large coalesced 30-second burst are both accepted',async()=>{
  const h=harness(),a=await h.rendering(),fixture=protocol(a.id);
  for(let offset=0;offset<fixture.wire.length;offset+=7)a.child.stdout.write(fixture.wire.slice(offset,offset+7));
  await a.promise;const b=await h.rendering();const max=send(b,{samples:960000});assert.ok(max.wire.length>32768);
  const result=await b.promise;assert.equal(result.durationSeconds,30);assert.equal(result.wav.length,1920044);await h.speech.close();
});
test('text and locale limits reject before starting the worker',async()=>{
  const h=harness();
  for(const text of ['', ' ', '字'.repeat(121), '😀'.repeat(121), 'x\0y', '\ud800'])await assert.rejects(h.speech.render(text),{code:'voice_limit'});
  await assert.rejects(h.speech.render('测试',{locale:'en-US'}),{code:'voice_locale'});
  await assert.rejects(h.speech.render('测试',{voice:'other'}),{code:'voice_locale'});assert.equal(h.children.length,0);
  const a=await h.rendering('😀'.repeat(120));send(a);await a.promise;await h.speech.close();
});
test('wrong, duplicate, reordered, oversized and noncanonical PCM frames fail closed',async()=>{
  const mutations=[
    rows=>rows[0].sampleRate=24000,
    rows=>rows[0].channels=2,
    rows=>rows[1].seq=2,
    rows=>rows[1].samples=4097,
    rows=>rows[1].data='@@==',
    rows=>rows[1].data='AQ',
    rows=>rows[1].samples=1,
    rows=>rows.splice(2,0,rows[1]),
    rows=>rows.shift(),
    rows=>rows.at(-1).samples++,
    rows=>rows.at(-1).frames++,
    rows=>rows.at(-1).sha256='0'.repeat(64),
  ];
  for(const mutate of mutations){const h=harness(),a=await h.rendering(),fixture=protocol(a.id);mutate(fixture.rows);const rejected=assert.rejects(a.promise,{code:'voice_unavailable'});for(const row of fixture.rows)a.child.send(row);await rejected;assert.equal(a.child.killed,true);assert.equal(h.speech.pending.size,0);await h.speech.close();}
});
test('over 30 seconds, too short and all-zero PCM never return a WAV',async()=>{
  for(const options of [{samples:960001},{samples:6399},{samples:9600,zero:true}]){const h=harness(),a=await h.rendering(),rejected=assert.rejects(a.promise,{code:'voice_unavailable'});send(a,options);await rejected;await h.speech.close();}
});
test('one oversized unfinished protocol line fails even when previous lines are valid',async()=>{
  const h=harness(),a=await h.rendering(),rejected=assert.rejects(a.promise,{code:'voice_unavailable'});
  a.child.stdout.write(JSON.stringify(protocol(a.id).rows[0])+'\n'+'x'.repeat(32769));await rejected;await h.speech.close();
});
test('tiny PCM fragments are bounded by a separate 512-frame limit',async()=>{
  const h=harness(),a=await h.rendering();a.child.send(protocol(a.id).rows[0]);const rejected=assert.rejects(a.promise,{code:'voice_unavailable'});
  for(let seq=1;seq<=513;seq++)a.child.send({event:'render-pcm',id:a.id,seq,samples:1,data:'AQE='});
  await rejected;assert.equal(h.speech.pending.size,0);await h.speech.close();
});
test('partial data then model error or exit clears retained frames; final before exit remains valid',async()=>{
  for(const method of ['error','exit']){const h=harness(),a=await h.rendering(),fixture=protocol(a.id);a.child.send(fixture.rows[0]);a.child.send(fixture.rows[1]);const held=h.speech.pending.get(a.id).pcm[0];const rejected=assert.rejects(a.promise,{code:'voice_unavailable'});if(method==='error')a.child.send({event:'error',id:a.id,code:'voice_unavailable'});else a.child.emit('exit',1);await rejected;assert.equal(held.every(value=>value===0),true);await h.speech.close();}
  const h=harness(),a=await h.rendering();send(a);a.child.emit('exit',0);assert.equal((await a.promise).frames,9600);await h.speech.close();
});
test('abort before ready or after a frame returns no audio and drops all late events',async()=>{
  const h=harness({ready:false}),controller=new AbortController(),promise=h.speech.render('测试',{signal:controller.signal});await tick();const rejected=assert.rejects(promise,{name:'AbortError'});controller.abort();await rejected;h.children[0].send({event:'ready',outputAvailable:false,outputDevice:'',renderAvailable:true});assert.deepEqual(h.children[0].rows,[]);await h.speech.close();
  const next=harness(),abort=new AbortController(),a=await next.rendering('测试',{signal:abort.signal});const fixture=protocol(a.id);a.child.send(fixture.rows[0]);a.child.send(fixture.rows[1]);const held=next.speech.pending.get(a.id).pcm[0];const stopped=assert.rejects(a.promise,{name:'AbortError'});abort.abort();await stopped;send(a);assert.equal(held.every(value=>value===0),true);assert.equal(next.speech.pending.size,0);await next.speech.close();
});
test('old abort and stdout cannot kill or populate a new generation',async()=>{
  const h=harness(),abort=new AbortController(),old=await h.rendering('旧文本',{signal:abort.signal});const stopped=assert.rejects(old.promise,{name:'AbortError'});
  const newPromise=h.speech.render('新文本');abort.abort();await stopped;await tick();const child=h.children.at(-1),id=child.rows.at(-1).id;
  old.child.stdout.write(protocol(id).wire);assert.equal(child.killed,false);child.stdout.write(protocol(id).wire);assert.equal((await newPromise).frames,9600);await h.speech.close();
});
test('speak and render replace each other without publishing playback for render',async()=>{
  const h=harness(),old=await h.rendering(),rejected=assert.rejects(old.promise,{name:'AbortError'});const speak=h.speech.speak('播放测试');await rejected;await tick();let child=h.children.at(-1),id=child.rows.at(-1).id;child.send({event:'playback-start',id});child.send({event:'playback-end',id,cancelled:false});await speak;
  const second=h.speech.speak('再播放');const secondRejected=assert.rejects(second,{name:'AbortError'});await tick();const a=await h.rendering();await secondRejected;send(a);await a.promise;await h.speech.close();
});
test('replacement waits for exact owned child exit, with bounded failure and no spawn storm',async()=>{
  const h=harness({exitOnKill:false}),old=await h.rendering(),stopped=assert.rejects(old.promise,{code:'voice_exit_timeout'});
  const next=h.speech.render('下一句');const blocked=assert.rejects(next,{code:'voice_exit_timeout'});await stopped;await blocked;assert.equal(h.children.length,1);
  await assert.rejects(h.speech.render('再一次'),{code:'voice_exit_timeout'});assert.equal(h.children.length,1);
  old.child.emit('exit',1);const a=await h.rendering();send(a);await a.promise;a.child.emit('exit',0);await h.speech.close();
});
test('replacement can proceed after exit without waiting for the timeout',async()=>{
  const h=harness({exitOnKill:false,exitTimeoutMs:1000}),old=await h.rendering(),stopped=assert.rejects(old.promise,{name:'AbortError'});const next=h.speech.render('下一句');await tick();assert.equal(h.children.length,1);old.child.emit('exit',0);await stopped;await tick();const child=h.children.at(-1);assert.equal(h.children.length,2);child.stdout.write(protocol(child.rows.at(-1).id).wire);await next;child.emit('exit',0);await h.speech.close();
});
test('synchronous abort cannot leave an idle worker behind',async()=>{
  const h=harness(),controller=new AbortController(),promise=h.speech.render('测试',{signal:controller.signal}),rejected=assert.rejects(promise,{name:'AbortError'});
  controller.abort();await rejected;await tick();assert.equal(h.speech.child,null);assert.equal(h.speech.retiring.size,0);assert.ok(h.children.every(child=>child.killed));await h.speech.close();
});
test('abort or close while waiting for a retired worker cannot spawn its replacement',async()=>{
  for(const operation of ['abort','close']){
    const h=harness({exitOnKill:false,exitTimeoutMs:1000}),old=await h.rendering(),oldRejected=assert.rejects(old.promise,{name:'AbortError'}),controller=new AbortController();
    const next=h.speech.render('下一句',{signal:controller.signal}),nextRejected=assert.rejects(next,error=>['voice_closed','voice_interrupted'].includes(error.code));await tick();
    let closing;if(operation==='abort')controller.abort();else closing=h.speech.close();
    old.child.emit('exit',0);await oldRejected;await nextRejected;await closing;await tick();assert.equal(h.children.length,1);assert.equal(h.speech.child,null);await h.speech.close();
  }
});
test('replacing an in-flight warmup rejects its request and its old signal cannot stop render',async()=>{
  const h=harness(),controller=new AbortController(),warm=h.speech.warmup({signal:controller.signal}),warmRejected=assert.rejects(warm,{name:'AbortError'});await tick();
  const a=await h.rendering();await warmRejected;controller.abort();assert.equal(a.child.killed,false);send(a);await a.promise;await h.speech.close();
});
test('cancel between complete protocol and async result handoff wipes the WAV instead of returning it',async()=>{
  const h=harness(),controller=new AbortController(),a=await h.rendering('测试',{signal:controller.signal}),op=h.speech.pending.get(a.id),resolve=op.resolve;let held;
  op.resolve=value=>{held=value.wav;resolve(value);};const rejected=assert.rejects(a.promise,{name:'AbortError'});send(a);controller.abort();await rejected;
  assert.ok(held);assert.equal(held.every(value=>value===0),true);assert.equal(h.speech.retiring.size,0);await h.speech.close();
});
test('only explicit speak can report checked output metadata, without implying playback',async()=>{
  const h=harness(),events=[];h.speech.on('playback-start',row=>events.push(row));const spoken=h.speech.speak('测试');await tick();const child=h.children[0],id=child.rows.at(-1).id;
  child.send({event:'output-ready',id,outputAvailable:true,outputDevice:'Synthetic output'});assert.equal(h.speech.diagnostics().outputDevice,'Synthetic output');assert.deepEqual(events,[]);
  child.send({event:'playback-start',id});child.send({event:'playback-end',id,cancelled:false});await spoken;
  const a=await h.rendering(),rejected=assert.rejects(a.promise,{code:'voice_unavailable'});a.child.send({event:'output-ready',id:a.id,outputAvailable:true,outputDevice:'wrong'});await rejected;await h.speech.close();
});
test('stopKind render during startup waits for exit and never dispatches a render request',async()=>{
  const h=harness({ready:false,exitOnKill:false,exitTimeoutMs:1000}),promise=h.speech.render('测试'),rejected=assert.rejects(promise,{name:'AbortError'});await tick();
  let settled=false;const stopped=h.speech.stopKind('render').then(()=>{settled=true;});await tick();assert.equal(settled,false);assert.equal(h.children[0].killed,true);
  h.children[0].send({event:'ready',outputAvailable:false,outputDevice:'',renderAvailable:true});assert.deepEqual(h.children[0].rows,[]);
  h.children[0].emit('exit',0);await stopped;await rejected;assert.equal(h.speech.child,null);await h.speech.close();
});
test('a real ENOENT spawn has no phantom retiring process and remains retryable',async()=>{
  const speech=new GptSovitsSpeech({pythonPath:path.resolve('fixture-missing-'+require('node:crypto').randomUUID()+'.exe'),repoPath:path.resolve('fake-repo'),referencePath:path.resolve('fake.wav'),exitTimeoutMs:20});
  for(let attempt=0;attempt<2;attempt++){
    await assert.rejects(speech.render('测试'),{code:'voice_unavailable'});
    assert.equal(speech.retiring.size,0);assert.equal(speech.child,null);
  }
  await speech.close();
});


test('QQ clean render requires an explicit clean terminal and otherwise keeps old render protocol unchanged',async()=>{
 for(const clean of [true,false]){const h=harness(),a=await h.rendering('合成测试',{clean:true}),rows=protocol(a.id).rows;assert.equal(a.child.rows.at(-1).clean,true);if(clean)rows.at(-1).cleaned=true;const result=clean?a.promise:assert.rejects(a.promise,{code:'voice_unavailable'});for(const row of rows)a.child.send(row);const value=await result;if(clean){assert.equal(value.cleaned,true);assert.equal(h.speech.pending.size,0);assert.equal(h.speech.diagnostics().audioRetained,false);assert.equal(a.child.killed,false);}else assert.equal(a.child.killed,true);await h.speech.close();}
});
