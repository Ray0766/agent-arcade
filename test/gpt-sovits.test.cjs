'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const path=require('node:path');
const {GptSovitsSpeech}=require('../src/voice/gpt-sovits.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({ready=true}={}){
  const children=[],calls=[];
  const spawnProcess=(executable,args,options)=>{
    calls.push({executable,args,options});const child=new EventEmitter();child.pid=children.length+100;
    child.stdout=new PassThrough();child.stderr=new PassThrough();child.rows=[];child.killed=false;
    child.stdin=new Writable({write(chunk,encoding,done){child.rows.push(JSON.parse(chunk.toString()));done();}});
    child.send=row=>child.stdout.write(JSON.stringify(row)+'\n');
    child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit('exit',0));};children.push(child);
    if(ready)queueMicrotask(()=>child.send({event:'ready',outputAvailable:true,outputDevice:'Fixture output'}));return child;
  };
  const speech=new GptSovitsSpeech({pythonPath:path.resolve('fixture-python.exe'),repoPath:path.resolve('fixture-repo'),referencePath:path.resolve('fixture.wav'),spawnProcess,now:()=>42});
  const speaking=async(text='仅合成测试文本',options={})=>{const promise=speech.speak(text,options);await tick();const child=children.at(-1),id=child.rows.findLast(row=>row.op==='speak').id;return {promise,child,id};};
  return {speech,children,calls,speaking};
}
test('provider independently rejects UNC and NUL runtime paths',()=>{
  const valid={pythonPath:path.resolve('python.exe'),repoPath:path.resolve('repo'),referencePath:path.resolve('reference.wav')};
  for(const key of Object.keys(valid))for(const bad of ['//server/share','\\\\server\\share',valid[key]+'\0extra'])assert.throws(()=>new GptSovitsSpeech({...valid,[key]:bad}),{code:'voice_assets'});
});
test('capabilities neither load a model nor play and text is not shell input',async()=>{
  const h=harness(),cap=await h.speech.capabilities();assert.equal(cap.backend,'gpt-sovits-v2proplus-local');assert.equal(cap.outputAvailable,true);
  assert.deepEqual(h.children[0].rows,[]);assert.equal(h.calls[0].options.windowsHide,true);assert.equal(h.calls[0].options.shell,undefined);
  assert.equal(h.calls[0].options.env.HF_HUB_OFFLINE,'1');assert.equal(h.calls[0].options.env.HF_HUB_DISABLE_IMPLICIT_TOKEN,'1');
  const text='引号" $(echo forbidden)\n文字';const active=await h.speaking(text);
  assert.equal(active.child.rows.at(-1).text,text);assert.equal(h.calls[0].args.some(item=>item.includes(text)),false);
  active.child.send({event:'playback-start',id:active.id});active.child.send({event:'playback-end',id:active.id,cancelled:false});await active.promise;await h.speech.close();
});
test('prewarm is explicit, idle interruption retains it, and close terminates it',async()=>{
  const h=harness(),promise=h.speech.warmup();await tick();const child=h.children[0];assert.equal(child.rows[0].op,'warmup');
  child.send({event:'warm',id:child.rows[0].id});await promise;await h.speech.interrupt();assert.equal(child.killed,false);
  assert.equal(h.speech.diagnostics().events.some(row=>row.event==='playback-start'),false);await h.speech.close();assert.equal(child.killed,true);
});
test('cancelled prewarm startup cannot later create a model request',async()=>{
  const h=harness({ready:false}),controller=new AbortController(),promise=h.speech.warmup({signal:controller.signal});
  const rejected=assert.rejects(promise,{name:'AbortError'});controller.abort();await rejected;
  h.children[0].send({event:'ready',outputAvailable:true,outputDevice:'late'});await tick();assert.deepEqual(h.children[0].rows,[]);assert.equal(h.children[0].killed,true);
});
test('cancel active playback kills only its worker and stale events are rejected',async()=>{
  const first=harness(),other=harness(),events=[];first.speech.on('playback-end',row=>events.push(row));
  const active=await first.speaking();await other.speech.capabilities();active.child.send({event:'playback-start',id:active.id});
  const rejected=assert.rejects(active.promise,{name:'AbortError'});await first.speech.stopKind('speak');await rejected;
  assert.equal(active.child.killed,true);assert.equal(other.children[0].killed,false);assert.equal(events.length,1);assert.equal(events[0].cancelled,true);
  const next=await first.speaking();active.child.send({event:'playback-end',id:next.id,cancelled:false});assert.equal(events.length,1);
  next.child.send({event:'playback-start',id:next.id});next.child.send({event:'playback-end',id:next.id,cancelled:false});await next.promise;
  assert.equal(events.length,2);await Promise.all([first.speech.close(),other.speech.close()]);
});
test('stop between readiness and request dispatch does not speak',async()=>{
  const h=harness();await h.speech.capabilities();const pending=h.speech.speak('old');const rejected=assert.rejects(pending,{name:'AbortError'});
  queueMicrotask(()=>h.speech.stopKind('speak'));await rejected;assert.deepEqual(h.children[0].rows,[]);await h.speech.close();
});
test('abort during synthesis has no invented playback event or retained text',async()=>{
  const h=harness(),controller=new AbortController(),seen=[];h.speech.on('playback-start',row=>seen.push(row));
  const active=await h.speaking('private actual text',{signal:controller.signal});const rejected=assert.rejects(active.promise,{name:'AbortError'});
  controller.abort();await rejected;active.child.send({event:'playback-start',id:active.id});assert.deepEqual(seen,[]);
  assert.equal(JSON.stringify(h.speech.diagnostics()).includes('private actual text'),false);await h.speech.close();
});
test('an old signal cannot kill the replacement worker during its startup',async()=>{
  const h=harness(),controller=new AbortController(),old=await h.speaking('old',{signal:controller.signal});
  const rejected=assert.rejects(old.promise,{name:'AbortError'});const next=h.speech.speak('new');
  controller.abort();await rejected;await tick();const child=h.children.at(-1),id=child.rows.at(-1).id;
  assert.equal(child.killed,false);child.send({event:'playback-start',id});child.send({event:'playback-end',id,cancelled:false});await next;await h.speech.close();
});
test('oversized protocol, invalid completion and invalid input fail closed',async()=>{
  const h=harness();await assert.rejects(h.speech.speak('x'.repeat(2001)),{code:'voice_limit'});assert.equal(h.children.length,0);
  await assert.rejects(h.speech.speak('hello',{locale:'en-US'}),{code:'voice_locale'});
  const active=await h.speaking(),rejected=assert.rejects(active.promise,{code:'voice_unavailable'});
  active.child.send({event:'playback-end',id:active.id,cancelled:false});await rejected;assert.equal(active.child.killed,true);
  const next=await h.speaking(),rejectLarge=assert.rejects(next.promise,{code:'voice_unavailable'});next.child.stdout.write('x'.repeat(32769));await rejectLarge;assert.equal(next.child.killed,true);
  await h.speech.close();await assert.rejects(h.speech.capabilities(),{code:'voice_closed'});
});
test('stderr counters retain no content and cannot evict synthesis timing evidence',async()=>{
  const h=harness(),active=await h.speaking('private upstream text');
  active.child.send({event:'synthesis-start',id:active.id,segment:1,segments:1,characters:21,text:'untrusted content'});
  for(let index=0;index<230;index++)active.child.stderr.write('private upstream text');
  active.child.send({event:'pcm-ready',id:active.id,segment:1,sampleRate:32000,samples:32000,pcm:'untrusted audio'});
  assert.equal(h.speech.diagnostics().events.some(row=>row.event==='playback-start'),false,'ready PCM is not evidence of device playback');
  active.child.send({event:'playback-start',id:active.id});active.child.send({event:'playback-end',id:active.id,cancelled:false});await active.promise;
  const diagnostic=h.speech.diagnostics();assert.deepEqual(diagnostic.hostDiagnostics,{chunks:230,firstAt:42,lastAt:42});
  assert.deepEqual(diagnostic.events.filter(row=>row.id===active.id).map(row=>row.event),['synthesis-request','synthesis-start','pcm-ready','playback-start','playback-end']);
  assert.equal(JSON.stringify(diagnostic).includes('private upstream text'),false);assert.equal(JSON.stringify(diagnostic).includes('untrusted'),false);
  for(let index=0;index<230;index++)h.speech.record('fixture');assert.equal(h.speech.diagnostics().events.length,200);await h.speech.close();
});
test('phase timestamps follow each segment and stale operation phases are ignored',async()=>{
  const h=harness(),active=await h.speaking();
  active.child.send({event:'pcm-ready',id:'old-operation',segment:99,sampleRate:0,samples:-1});
  for(let segment=1;segment<=2;segment++){
    active.child.send({event:'synthesis-start',id:active.id,segment,segments:2,characters:10});
    active.child.send({event:'pcm-ready',id:active.id,segment,sampleRate:32000,samples:600});
    if(segment===1)active.child.send({event:'playback-start',id:active.id});
  }
  active.child.send({event:'playback-end',id:active.id,cancelled:false});await active.promise;
  assert.deepEqual(h.speech.diagnostics().events.filter(row=>row.event==='pcm-ready').map(row=>row.segment),[1,2]);await h.speech.close();
});
test('invalid, duplicate, and out-of-order phase events fail closed before false completion',async()=>{
  const cases=[
    [{event:'synthesis-start',segment:2,segments:2,characters:10}],
    [{event:'synthesis-start',segment:1,segments:41,characters:10}],
    [{event:'synthesis-start',segment:1,segments:1,characters:121}],
    [{event:'pcm-ready',segment:1,sampleRate:32000,samples:100}],
    [{event:'synthesis-start',segment:1,segments:1,characters:10},{event:'playback-start'}],
    [{event:'synthesis-start',segment:1,segments:1,characters:10},{event:'pcm-ready',segment:1,sampleRate:44100,samples:100}],
    [{event:'synthesis-start',segment:1,segments:1,characters:10},{event:'pcm-ready',segment:1,sampleRate:32000,samples:1280001}],
    [{event:'synthesis-start',segment:1,segments:1,characters:10},{event:'pcm-ready',segment:1,sampleRate:32000,samples:100},{event:'pcm-ready',segment:1,sampleRate:32000,samples:100}],
    [{event:'synthesis-start',segment:1,segments:2,characters:10},{event:'pcm-ready',segment:1,sampleRate:32000,samples:100},{event:'playback-start'},{event:'playback-end',cancelled:false}],
  ];
  for(const rows of cases){
    const h=harness(),active=await h.speaking(),rejected=assert.rejects(active.promise,{code:'voice_unavailable'});
    for(const row of rows)active.child.send({...row,id:active.id});await rejected;
    assert.equal(active.child.killed,true);assert.equal(h.speech.diagnostics().events.some(row=>row.event==='playback-end'),false);await h.speech.close();
  }
});
