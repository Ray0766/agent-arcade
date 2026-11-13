'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const path=require('node:path');
const {QwenAsr,QwenSpeech}=require('../src/voice/qwen-asr.cjs');
const {VoiceConversation}=require('../src/voice/conversation.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({ready=true,autoExit=true,exitTimeoutMs=5000}={}){
  const children=[],calls=[];
  const spawnProcess=(executable,args,options)=>{
    calls.push({executable,args,options});
    const child=new EventEmitter();child.pid=children.length+1;child.stdout=new PassThrough();child.stderr=new PassThrough();child.rows=[];child.killed=false;child.exitCode=null;child.signalCode=null;
    child.stdin=new Writable({write(chunk,encoding,done){child.rows.push(JSON.parse(chunk.toString()));done();}});
    child.send=row=>child.stdout.write(JSON.stringify(row)+'\n');
    child.finishExit=(code=0,signal=null)=>{child.exitCode=code;child.signalCode=signal;child.emit('exit',code,signal);};
    child.kill=()=>{child.killed=true;if(autoExit)queueMicrotask(()=>child.finishExit());};children.push(child);
    if(ready)queueMicrotask(()=>child.send({event:'ready'}));return child;
  };
  const asr=new QwenAsr({pythonPath:path.resolve('fixture-python.exe'),modelPath:path.resolve('fixture-model'),spawnProcess,now:()=>42,exitTimeoutMs});
  const listening=async(options={})=>{const promise=asr.listen(options);await tick();const child=children.at(-1),id=child.rows.findLast(row=>row.op==='listen').id;child.send({id,event:'listening'});return {promise,child,id};};
  return {asr,children,calls,listening};
}
const onset=id=>({id,event:'speech-start',detector:'webrtcvad',mode:2,voicedFrames:3,windowFrames:5});
async function finish(h,active,text='合成测试文字'){
  const pending=h.asr.finishListening();await tick();const command=active.child.rows.findLast(row=>row.op==='finish-listening');
  active.child.send({id:command.id,event:'finishing',listenId:active.id,microphoneClosed:true});
  active.child.send({id:active.id,event:'microphone-closed'});
  active.child.send({id:active.id,event:'transcript',text});active.child.send({id:active.id,event:'transcript',text});active.child.send({id:active.id,event:'listen-ended'});
  await pending;await active.promise;
}

test('capability discovery starts no recording and reports explicit supported modes',async()=>{
  const h=harness(),pending=h.asr.capabilities();await tick();const child=h.children[0];
  assert.deepEqual(child.rows.map(row=>row.op),['capabilities']);
  child.send({id:child.rows[0].id,event:'capabilities',handsFree:true,manualReview:true,recognizers:[{locale:'zh-CN'}],voices:[]});
  const capabilities=await pending;assert.equal(capabilities.handsFree,true);assert.equal(capabilities.manualReview,true);
  assert.equal(h.calls[0].options.windowsHide,true);assert.equal(h.calls[0].options.shell,undefined);assert.equal(h.calls[0].options.env.HF_HUB_OFFLINE,'1');
  await h.asr.close();assert.equal(child.killed,true);
});

test('only explicit finish and closed input can yield a final transcript',async()=>{
  const h=harness(),seen=[],active=await h.listening({onTranscript:row=>seen.push(row.text)});
  assert.equal(seen.length,0);await finish(h,active);assert.deepEqual(seen,['合成测试文字']);
  assert.equal(active.child.killed,false,'keep the idle model resident');
  await h.asr.interrupt();assert.equal(active.child.killed,false,'an idle interruption must not discard the resident model');
  assert.equal(JSON.stringify(h.asr.diagnostics()).includes('合成测试文字'),false);await h.asr.close();
});

test('a transcript before Finish is rejected and never forwarded',async()=>{
  const h=harness(),seen=[],active=await h.listening({onTranscript:row=>seen.push(row.text)});
  const rejection=assert.rejects(active.promise,{code:'voice_unavailable'});
  active.child.send({id:active.id,event:'transcript',text:'must not reach conversation'});await rejection;
  assert.deepEqual(seen,[]);assert.equal(active.child.killed,true);await h.asr.close();
});

test('cancel kills capture and old-process events cannot enter a later recording',async()=>{
  const h=harness(),signal=new AbortController(),seen=[];
  const old=await h.listening({signal:signal.signal,onTranscript:row=>seen.push(row.text)});
  const rejection=assert.rejects(old.promise,{name:'AbortError'});signal.abort();await rejection;assert.equal(old.child.killed,true);
  const next=await h.listening({onTranscript:row=>seen.push(row.text)});
  old.child.send({id:next.id,event:'transcript',text:'stale'});old.child.send(onset(next.id));
  await finish(h,next,'current');assert.deepEqual(seen,['current']);await h.asr.close();
});

test('cancel during worker startup prevents a later microphone command',async()=>{
  const h=harness({ready:false}),controller=new AbortController();
  const pending=h.asr.listen({signal:controller.signal});const rejected=assert.rejects(pending,{name:'AbortError'});
  controller.abort();await rejected;h.children[0].send({event:'ready'});await tick();
  assert.equal(h.children[0].killed,true);assert.deepEqual(h.children[0].rows,[]);await h.asr.close();
});

test('an old listen signal cannot terminate a replacement worker during startup',async()=>{
  const h=harness(),controller=new AbortController(),old=await h.listening({signal:controller.signal});
  const oldRejected=assert.rejects(old.promise,{name:'AbortError'});
  const current=h.asr.listen();current.catch(()=>{});
  controller.abort();await oldRejected;await tick();
  try{
    const child=h.children.at(-1);assert.equal(child.killed,false);
    const id=child.rows.find(row=>row.op==='listen').id;child.send({id,event:'listening'});
    await finish(h,{child,id,promise:current},'replacement remains current');
  }finally{await h.asr.close();}
});

test('stop or close between worker readiness and request dispatch cannot open input',async()=>{
  for(const action of ['stop','close']){
    const h=harness();await h.asr.start();const pending=h.asr.listen();pending.catch(()=>{});
    queueMicrotask(()=>action==='close'?h.asr.close():h.asr.stopKind('listen'));await tick();
    try{assert.deepEqual(h.children[0].rows,[]);await assert.rejects(pending,{name:'AbortError'});}
    finally{await h.asr.close();}
  }
});

test('input-device failure terminates that worker and a new recording can recover',async()=>{
  const h=harness(),seen=[],failed=await h.listening({onTranscript:row=>seen.push(row.text)});
  const rejected=assert.rejects(failed.promise,{code:'voice_audio_overflow'});
  failed.child.send({id:failed.id,event:'error',code:'voice_audio_overflow'});await rejected;assert.equal(failed.child.killed,true);
  const current=await h.listening({onTranscript:row=>seen.push(row.text)});
  failed.child.send({id:current.id,event:'transcript',text:'obsolete failure result'});
  await finish(h,current,'recovered');assert.deepEqual(seen,['recovered']);await h.asr.close();
});

test('speech onset requires detector evidence; numeric diagnostics are bounded and private',async()=>{
  const h=harness(),events=[];h.asr.on('speech-start',row=>events.push(row));const active=await h.listening();
  active.child.send({...onset(active.id),detector:'rms'});active.child.send({...onset(active.id),voicedFrames:1});
  active.child.send(onset('old'));assert.equal(events.length,0);active.child.send(onset(active.id));assert.equal(events.length,1);
  for(let count=0;count<200;count++)active.child.send({id:active.id,event:'audio-level',current:0,max:10,count,pcm:'private'});
  active.child.send({id:active.id,event:'audio-level',current:120,max:120,count:201});
  assert.equal(h.asr.diagnostics().audioLevels.length,120);assert.equal(JSON.stringify(h.asr.diagnostics()).includes('private'),false);
  const rejected=assert.rejects(active.promise,{name:'AbortError'});await h.asr.close();await rejected;
});

test('combined provider preserves review before model invocation and owns playback lifecycle',async()=>{
  const h=harness(),playback=new EventEmitter(),spoken=[],responses=[];
  Object.assign(playback,{capabilities:async()=>({backend:'injected-playback',voices:[]}),speak:async text=>{spoken.push(text);},stopKind:async()=>{},interrupt:async()=>{},close:async()=>{playback.closed=true;},diagnostics:()=>({backend:'injected-playback'})});
  const speech=new QwenSpeech({asr:h.asr,playback});
  const conversation=new VoiceConversation({speech,scope:'fixture-account-owner-character',respond:async text=>{responses.push(text);return 'Reply';}});
  await conversation.startListening();await tick();const child=h.children[0],id=child.rows.find(row=>row.op==='listen').id;
  child.send({id,event:'listening'});assert.equal(conversation.snapshot().status,'listening');
  conversation.finishListening();await tick();const command=child.rows.find(row=>row.op==='finish-listening');
  child.send({id:command.id,event:'finishing',listenId:id,microphoneClosed:true});child.send({id,event:'microphone-closed'});
  child.send({id,event:'transcript',text:'recognized'});child.send({id,event:'listen-ended'});await tick();
  assert.equal(conversation.snapshot().status,'reviewing');assert.deepEqual(responses,[]);
  conversation.confirmTranscript({draftId:conversation.snapshot().draftId,text:'corrected'});await tick();
  assert.deepEqual(responses,['corrected']);assert.deepEqual(spoken,['Reply']);
  await conversation.close();assert.equal(playback.closed,true);assert.equal(child.killed,true);assert.equal(h.asr.listenerCount('speech-start'),0);
});

test('continuous alone remains manual; explicit hands-free accepts only newest completed utterance',async()=>{
  const h=harness(),seen=[],onsets=[];h.asr.on('speech-start',row=>onsets.push(row));
  const manual=await h.listening({continuous:true});assert.equal(manual.child.rows.find(row=>row.op==='listen').mode,'push-to-talk');
  const cancelled=assert.rejects(manual.promise,{name:'AbortError'});await h.asr.stopKind('listen');await cancelled;
  const active=await h.listening({mode:'hands-free',onTranscript:row=>seen.push(row.text)});
  const hfOnset=utteranceId=>({...onset(active.id),voicedFrames:6,windowFrames:8,utteranceId});
  active.child.send(onset(active.id));assert.equal(onsets.length,0,'manual quorum cannot authorize a hands-free turn');
  active.child.send(hfOnset(1));active.child.send(hfOnset(2));
  active.child.send({id:active.id,event:'transcript',utteranceId:1,text:'old'});
  active.child.send({id:active.id,event:'transcript',utteranceId:2,text:'new'});
  active.child.send({id:active.id,event:'transcript',utteranceId:2,text:'duplicate'});
  assert.deepEqual(seen,['new']);assert.equal(onsets.length,2);assert.equal(active.child.killed,false);
  await assert.rejects(h.asr.finishListening());
  const rejected=assert.rejects(active.promise,{name:'AbortError'});await h.asr.close();await rejected;
});

test('playback warmup failure stops ASR and cannot forward buffered recognition',async()=>{
  const h=harness(),playback=new EventEmitter(),seen=[];let rejectWarmup;
  const gate=new Promise((resolve,reject)=>{rejectWarmup=reject;});
  Object.assign(playback,{warmup:()=>gate,interrupt:async()=>{},close:async()=>{},stopKind:async()=>{}});
  const speech=new QwenSpeech({asr:h.asr,playback});
  const pending=speech.listen({mode:'hands-free',onTranscript:row=>seen.push(row.text)});await tick();
  const child=h.children[0],id=child.rows.find(row=>row.op==='listen').id;
  child.send({id,event:'listening'});child.send({...onset(id),voicedFrames:6,windowFrames:8,utteranceId:1});
  child.send({id,event:'transcript',utteranceId:1,text:'not delivered while playback loads'});assert.deepEqual(seen,[]);
  const rejected=assert.rejects(pending,/warmup failed/);rejectWarmup(Error('warmup failed'));await rejected;
  assert.equal(child.killed,true);assert.deepEqual(seen,[]);await speech.close();
});

test('warmup buffers only the current utterance and aborts with the listening signal',async()=>{
  const h=harness(),playback=new EventEmitter(),seen=[];let ready,warmupSignal;
  Object.assign(playback,{warmup:({signal})=>{warmupSignal=signal;return new Promise(resolve=>{ready=resolve;});},interrupt:async()=>{},close:async()=>{},stopKind:async()=>{}});
  const speech=new QwenSpeech({asr:h.asr,playback}),controller=new AbortController();
  const pending=speech.listen({mode:'hands-free',signal:controller.signal,onTranscript:row=>seen.push(row.text)});await tick();
  const child=h.children[0],id=child.rows.find(row=>row.op==='listen').id;
  child.send({id,event:'listening'});child.send({...onset(id),voicedFrames:6,windowFrames:8,utteranceId:1});
  child.send({id,event:'transcript',utteranceId:1,text:'old while warming'});
  child.send({...onset(id),voicedFrames:6,windowFrames:8,utteranceId:2});ready();await tick();assert.deepEqual(seen,[]);
  child.send({id,event:'transcript',utteranceId:2,text:'current'});assert.deepEqual(seen,['current']);
  const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;
  assert.equal(warmupSignal.aborted,true);assert.equal(child.killed,true);await speech.close();
});

test('configured interpreter and model paths reject Windows network path variants',()=>{
  for(const value of ['\\\\server\\model','//server/model','\\/server/model','/\\server/model']){
    assert.throws(()=>new QwenAsr({pythonPath:path.resolve('python.exe'),modelPath:value}));
  }
});

test('current hands-free onset interrupts controller playback before the next transcript',async()=>{
  const h=harness(),playback=new EventEmitter(),responses=[];let stops=0;
  Object.assign(playback,{warmup:async()=>{},speak:(text,{signal})=>new Promise((resolve,reject)=>{
    playback.emit('playback-start',{});signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{name:'AbortError'})),{once:true});
  }),stopKind:async()=>{stops++;},interrupt:async()=>{},close:async()=>{},diagnostics:()=>({})});
  const speech=new QwenSpeech({asr:h.asr,playback});
  const conversation=new VoiceConversation({speech,scope:'fixture-owner',respond:async text=>{responses.push(text);return 'synthetic playback';}});
  await conversation.startListening({mode:'hands-free',headphonesConfirmed:true});await tick();
  const child=h.children[0],command=child.rows.find(row=>row.op==='listen'),id=command.id;
  assert.equal(command.mode,'hands-free');child.send({id,event:'listening'});
  const begin=utteranceId=>child.send({...onset(id),voicedFrames:6,windowFrames:8,utteranceId});
  begin(1);child.send({id,event:'transcript',utteranceId:1,text:'first'});await tick();
  assert.equal(conversation.snapshot().status,'speaking');const before=stops;
  begin(2);assert.equal(stops,before+1);assert.equal(conversation.snapshot().status,'listening');
  assert.deepEqual(responses,['first'],'onset does not invent recognized content');
  child.send({id,event:'transcript',utteranceId:1,text:'stale'});child.send({id,event:'transcript',utteranceId:2,text:'second'});await tick();
  assert.deepEqual(responses,['first','second']);assert.equal(conversation.snapshot().status,'speaking');
  await conversation.close();assert.equal(child.killed,true);
});

test('older composite warmup failure cannot stop a replacement recording',async()=>{
  const h=harness(),playback=new EventEmitter();let failOld,call=0;
  Object.assign(playback,{warmup:()=>++call===1?new Promise((resolve,reject)=>{failOld=reject;}):Promise.resolve(),interrupt:async()=>{},close:async()=>{},stopKind:async()=>{}});
  const speech=new QwenSpeech({asr:h.asr,playback});
  const old=speech.listen({mode:'hands-free'});const rejectedOld=assert.rejects(old,{name:'AbortError'});await tick();
  const current=speech.listen({mode:'hands-free'});await tick();await rejectedOld;
  const child=h.children.at(-1);assert.equal(child.killed,false);failOld(Error('late warmup failure'));await tick();
  assert.equal(child.killed,false);
  const rejectedCurrent=assert.rejects(current,{name:'AbortError'});await speech.close();await rejectedCurrent;
});

test('composed capabilities intersect ASR languages with enabled playback voices without warmup',async()=>{
  const asr=new EventEmitter(),playback=new EventEmitter();let warmed=0;
  Object.assign(asr,{capabilities:async()=>({handsFree:true,recognizers:[{locale:'zh-CN'},{locale:'en-US'}]})});
  Object.assign(playback,{capabilities:async()=>({backend:'fixture',voices:[{name:'Serena',locale:'zh-CN',enabled:true},{name:'Unavailable',locale:'en-US',enabled:false}]}),warmup:async()=>{warmed++;}});
  const speech=new QwenSpeech({asr,playback}),available=await speech.capabilities();
  assert.deepEqual(available.recognizers,[{locale:'zh-CN'}]);assert.equal(available.handsFree,true);assert.equal(warmed,0);
});

test('replacement waits for actual old exit, not kill acceptance, before a new worker is spawned',async()=>{
  const h=harness({autoExit:false,exitTimeoutMs:200}),old=await h.listening();
  const oldRejected=assert.rejects(old.promise,{name:'AbortError'});const replacement=h.asr.listen();replacement.catch(()=>{});await oldRejected;await tick();
  assert.equal(old.child.killed,true);assert.equal(h.children.length,1);assert.equal(h.asr.diagnostics().retiring,1);assert.equal(h.asr.diagnostics().running,true);
  old.child.finishExit();await tick();assert.equal(h.children.length,2);const child=h.children[1],id=child.rows.find(row=>row.op==='listen').id;child.send({id,event:'listening'});
  await finish(h,{child,id,promise:replacement},'new worker');const closing=h.asr.close();child.finishExit();await closing;assert.equal(h.asr.diagnostics().running,false);
});

test('close timeout preserves retiring reference and can confirm exit on a later close',async()=>{
  const h=harness({autoExit:false,exitTimeoutMs:20}),active=await h.listening();const rejected=assert.rejects(active.promise,{name:'AbortError'});
  await assert.rejects(h.asr.close(),{code:'voice_exit_unconfirmed'});await rejected;
  assert.equal(h.asr.retiring.size,1);assert.equal(h.asr.child,null);assert.equal(active.child.killed,true);assert.equal(active.child.exitCode,null);assert.equal(h.asr.diagnostics().running,true);
  const retried=h.asr.close();active.child.finishExit();await retried;assert.equal(h.asr.retiring.size,0);assert.equal(h.asr.diagnostics().running,false);
});

test('start fails without spawning when a retiring process misses its deadline',async()=>{
  const h=harness({autoExit:false,exitTimeoutMs:20}),active=await h.listening();const rejected=assert.rejects(active.promise,{name:'AbortError'});h.asr.destroy();await rejected;
  await assert.rejects(h.asr.start(),{code:'voice_exit_unconfirmed'});assert.equal(h.children.length,1);assert.equal(h.asr.retiring.size,1);
  active.child.finishExit();await h.asr.close();
});

test('cancel or close while waiting for retirement cannot start a replacement after the old exit',async()=>{
  for(const action of ['abort','close']){
    const h=harness({autoExit:false,exitTimeoutMs:200}),active=await h.listening(),controller=new AbortController();
    const oldRejected=assert.rejects(active.promise,{name:'AbortError'});const pending=h.asr.listen({signal:controller.signal}),newRejected=assert.rejects(pending,{name:'AbortError'});await oldRejected;await tick();
    const closing=action==='close'?h.asr.close():null;if(action==='abort')controller.abort();active.child.finishExit();await newRejected;await closing;assert.equal(h.children.length,1);await h.asr.close();
  }
});

test('known exit and signal codes count as exit, whereas killed alone does not',async()=>{
  for(const code of ['exit','signal']){
    const h=harness({autoExit:false,exitTimeoutMs:20});await h.asr.start();const child=h.children[0];
    if(code==='exit')child.exitCode=0;else child.signalCode='SIGTERM';
    await h.asr.close();assert.equal(child.killed,false);assert.equal(h.asr.retiring.size,0);
  }
});

test('failed spawn without PID does not reserve a nonexistent worker',async()=>{
  const h=harness({ready:false,autoExit:false,exitTimeoutMs:20});const started=h.asr.start(),rejected=assert.rejects(started,{code:'voice_unavailable'});const child=h.children[0];delete child.pid;child.emit('error',Object.assign(Error('synthetic'),{code:'ENOENT'}));await rejected;await h.asr.close();assert.equal(h.asr.retiring.size,0);assert.equal(child.killed,false);
});
