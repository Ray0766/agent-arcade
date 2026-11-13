'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {VoiceConversation}=require('../src/voice/conversation.cjs');
const delay=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
class FakeSpeech extends EventEmitter {
  constructor(){super();this.spoken=[];this.stops=0;this.closes=0;}
  diagnostics(){return {events:[]};}
  async capabilities(){return {recognizers:[{locale:'zh-CN'}],voices:[]};}
  listen(options){this.options=options;options.onListening?.({});this.input=deferred();options.signal?.addEventListener('abort',()=>this.input.reject(Object.assign(Error('abort'),{name:'AbortError'})),{once:true});return this.input.promise;}
  async speak(text,{signal}={}){this.spoken.push(text);this.emit('playback-start');this.output=deferred();signal?.addEventListener('abort',()=>this.output.reject(Object.assign(Error('abort'),{name:'AbortError'})),{once:true});return this.output.promise;}
  async stopKind(){this.stops++;}
  async interrupt(){this.stops++;}
  async close(){this.closes++;}
  async finishListening(){this.finishes=(this.finishes||0)+1;this.input.resolve({event:'listen-ended'});}
}
test('close still reaches provider cleanup after interrupt failure and reports closed only after confirmation',async()=>{
  const speech=new FakeSpeech(),steps=[],exited=deferred();
  speech.interrupt=async()=>{steps.push('interrupt');throw Object.assign(Error('not yet exited'),{code:'voice_exit_unconfirmed'});};
  speech.close=async()=>{steps.push('close');await exited.promise;steps.push('exit-confirmed');};
  const voice=new VoiceConversation({speech,scope:'fixture-owner',respond:async()=>''});
  const closing=voice.close();await delay();assert.deepEqual(steps,['interrupt','close']);assert.notEqual(voice.snapshot().status,'closed');assert.equal(voice.diagnostics().events.some(row=>row.event==='session-closed'),false);
  exited.resolve();await closing;assert.deepEqual(steps,['interrupt','close','exit-confirmed']);assert.equal(voice.snapshot().status,'closed');assert.equal(voice.diagnostics().events.filter(row=>row.event==='session-closed').length,1);
});
test('provider close failure remains observable and can retry without a premature closed event',async()=>{
  const speech=new FakeSpeech(),steps=[];let canClose=false;
  speech.interrupt=async()=>{steps.push('interrupt');throw Object.assign(Error(),{code:'voice_exit_unconfirmed'});};
  speech.close=async()=>{steps.push('close');if(!canClose)throw Object.assign(Error('private provider details'),{code:'voice_exit_unconfirmed'});};
  const voice=new VoiceConversation({speech,scope:'fixture-owner',respond:async()=>''});
  await assert.rejects(voice.close(),{code:'voice_exit_unconfirmed'});assert.deepEqual(steps,['interrupt','close']);assert.equal(voice.snapshot().status,'error');assert.doesNotMatch(voice.snapshot().error,/private/);assert.equal(voice.diagnostics().events.some(row=>row.event==='session-closed'),false);assert.equal(speech.listenerCount('speech-start'),0);
  canClose=true;await voice.close();assert.deepEqual(steps,['interrupt','close','interrupt','close']);assert.equal(voice.snapshot().status,'closed');assert.equal(voice.diagnostics().events.filter(row=>row.event==='session-closed').length,1);
});
test('concurrent close calls share provider termination instead of issuing another cleanup',async()=>{
  const speech=new FakeSpeech(),gate=deferred();let interrupted=0,closed=0;
  speech.interrupt=async()=>{interrupted++;};speech.close=async()=>{closed++;await gate.promise;};
  const voice=new VoiceConversation({speech,scope:'fixture-owner',respond:async()=>''}),first=voice.close(),second=voice.close();await delay();assert.equal(interrupted,1);assert.equal(closed,1);assert.notEqual(voice.snapshot().status,'closed');gate.resolve();await Promise.all([first,second]);assert.equal(voice.snapshot().status,'closed');
});
test('click-to-speak uses recognition text, model response and playback without transport sends',async()=>{
  const speech=new FakeSpeech(),received=[];
  const voice=new VoiceConversation({speech,scope:'account/owner/role',respond:async text=>{received.push(text);return {outcome:'reply_ended',text:'晚上好。'};}});
  await voice.startListening();speech.options.onTranscript({text:'你好'});await delay();
  assert.deepEqual(received,[],'recognition does not send before the user finishes');assert.equal(voice.snapshot().transcript,'你好');
  voice.finishListening();await delay();
  assert.deepEqual(received,[],'finishing only produces a reviewable draft');assert.equal(voice.snapshot().status,'reviewing');
  voice.confirmTranscript({draftId:voice.snapshot().draftId,text:'你好'});await delay();
  assert.deepEqual(received,['你好']);assert.deepEqual(speech.spoken,['晚上好。']);assert.equal(voice.snapshot().status,'speaking');
  speech.output.resolve({event:'playback-end'});await delay();assert.equal(voice.snapshot().status,'idle');
  await voice.close();assert.equal(speech.closes,1);
});

test('manual finish joins recognized phrases once; silence is not sent to the model',async()=>{
  const speech=new FakeSpeech(),received=[],voice=new VoiceConversation({speech,scope:'role',respond:async text=>{received.push(text);return '';}});
  await voice.startListening();assert.equal(speech.options.timeoutMs,600000);
  speech.options.onTranscript({text:'第一句'});speech.options.onTranscript({text:'第二句'});
  voice.finishListening();voice.finishListening();await delay();
  assert.equal(speech.finishes,1);assert.deepEqual(received,[]);
  voice.confirmTranscript({draftId:voice.snapshot().draftId,text:'第一句 第二句'});await delay();assert.deepEqual(received,['第一句 第二句']);
  await voice.startListening();voice.finishListening();await delay();
  assert.equal(voice.snapshot().status,'unrecognized');assert.equal(voice.snapshot().reason,'no-words');assert.equal(received.length,1);await voice.close();
});

test('review sends only corrected text once and does not retain the draft in diagnostics',async()=>{
  const speech=new FakeSpeech(),received=[],voice=new VoiceConversation({speech,scope:'role',respond:async text=>{received.push(text);return '';}});
  await voice.startListening();speech.options.onTranscript({text:'你好只怪兽好'});voice.finishListening();await delay();
  const draftId=voice.snapshot().draftId;
  assert.throws(()=>voice.confirmTranscript({draftId,text:''}),/characters/);
  assert.throws(()=>voice.confirmTranscript({draftId:'stale',text:'old'}),/changed/);
  voice.confirmTranscript({draftId,text:'你好橘，晚上好'});
  assert.throws(()=>voice.confirmTranscript({draftId,text:'second send'}),/changed/);await delay();
  assert.deepEqual(received,['你好橘，晚上好']);assert.equal(JSON.stringify(voice.diagnostics()).includes('怪兽'),false);
  assert.ok(voice.diagnostics().events.some(event=>event.event==='transcript-confirmed'&&event.edited));await voice.close();
});

test('a restart, incoming-message interruption, or close invalidates unsent transcript drafts',async()=>{
  const speech=new FakeSpeech(),received=[],voice=new VoiceConversation({speech,scope:'role',respond:async text=>{received.push(text);return '';}});
  const draft=async()=>{await voice.startListening();speech.options.onTranscript({text:'草稿'});voice.finishListening();await delay();return voice.snapshot().draftId;};
  const old=await draft(),current=await draft();assert.notEqual(old,current);
  assert.throws(()=>voice.confirmTranscript({draftId:old,text:'stale'}),/changed/);
  await voice.interrupt('qq-message');assert.throws(()=>voice.confirmTranscript({draftId:current,text:'stale'}),/changed/);
  const last=await draft();await voice.close();assert.throws(()=>voice.confirmTranscript({draftId:last,text:'stale'}),/changed/);assert.deepEqual(received,[]);
});

test('closing while finishing discards the pending transcript and never sends it',async()=>{
  const speech=new FakeSpeech(),received=[],voice=new VoiceConversation({speech,scope:'role',respond:async text=>{received.push(text);return '';}});
  const finishing=deferred();speech.finishListening=()=>finishing.promise;
  await voice.startListening();speech.options.onTranscript({text:'不要发送'});voice.finishListening();
  assert.equal(voice.snapshot().status,'recognizing');await voice.close();finishing.resolve();await delay();
  assert.deepEqual(received,[]);assert.equal(voice.snapshot().status,'closed');
});
test('manual interruption aborts generation and suppresses its late result',async()=>{
  const speech=new FakeSpeech(),response=deferred();let signal;
  const voice=new VoiceConversation({speech,scope:'role',respond:(_,{signal:s})=>{signal=s;return response.promise;}});
  const pending=voice.accept('先想一下');await delay();await voice.interrupt();response.resolve('过时回复');await pending;
  assert.equal(signal.aborted,true);assert.deepEqual(speech.spoken,[]);assert.equal(voice.snapshot().status,'idle');assert.equal(voice.diagnostics().events.some(row=>row.event==='response-ready'),false);await voice.close();
});
test('voice requests immediate local pacing and records response readiness before actual playback',async()=>{
  const speech=new FakeSpeech(),response=deferred();let request,clock=10;
  const voice=new VoiceConversation({speech,scope:'role',now:()=>clock,respond:(_text,options)=>{request=options;return response.promise;}});
  const pending=voice.accept('private question');await delay();
  assert.equal(request.voice,true);assert.ok(request.signal instanceof AbortSignal);assert.ok(request.turnId);
  assert.equal(voice.diagnostics().events.some(row=>row.event==='response-ready'),false);
  clock=60;response.resolve({outcome:'reply_ended',text:'private response'});await delay();
  const events=voice.diagnostics().events;const ready=events.find(row=>row.event==='response-ready');
  assert.equal(ready.at,60);assert.equal(ready.turnId,request.turnId);assert.equal(voice.snapshot().status,'speaking');
  assert.equal(events.some(row=>row.event==='turn-played'),false);assert.equal(JSON.stringify(events).includes('private'),false);
  clock=90;speech.output.resolve();await pending;
  assert.equal(voice.diagnostics().events.find(row=>row.event==='turn-played').at,90);await voice.close();
});
test('hands-free speech onset cancels playback and accepts a fresh utterance',async()=>{
  const speech=new FakeSpeech();let calls=0;
  const voice=new VoiceConversation({speech,scope:'role',respond:async()=>++calls===1?'旧回复':'新回复'});
  await assert.rejects(voice.startListening({mode:'hands-free'}),/headphones/);
  await voice.startListening({mode:'hands-free',headphonesConfirmed:true});
  speech.options.onTranscript({text:'第一句'});await delay();assert.equal(voice.snapshot().status,'speaking');
  speech.emit('speech-start');await delay();assert.equal(voice.snapshot().status,'listening');
  speech.options.onTranscript({text:'换个话题'});await delay();assert.deepEqual(speech.spoken,['旧回复','新回复']);
  assert.ok(voice.diagnostics().events.some(item=>item.event==='speech-interruption'));
  await voice.close();assert.equal(speech.listenerCount('speech-start'),0);
});
test('hands-free input failure cancels active playback and permits an explicit retry',async()=>{
  const speech=new FakeSpeech(),voice=new VoiceConversation({speech,scope:'role',respond:async()=> 'reply'});
  await voice.startListening({mode:'hands-free',headphonesConfirmed:true});
  const pending=voice.accept('first');await delay();const signal=voice.reply.controller.signal,before=speech.stops;
  speech.input.reject(Object.assign(Error('device failed'),{code:'voice_audio_overflow'}));await delay();
  assert.equal(signal.aborted,true);assert.equal(speech.stops,before+1);assert.equal(voice.reply,null);assert.equal(voice.snapshot().status,'error');
  await pending;
  assert.equal(voice.diagnostics().events.some(row=>row.event==='turn-played'),false);
  await voice.startListening({mode:'hands-free',headphonesConfirmed:true});
  assert.equal(voice.snapshot().status,'listening');assert.equal(voice.snapshot().error,'');
  const retried=voice.accept('retry');await delay();speech.output.resolve();await retried;
  assert.equal(voice.snapshot().status,'listening');await voice.close();
});
test('input failure aborts generation and a late model result cannot start playback',async()=>{
  const speech=new FakeSpeech(),response=deferred();let signal;
  const voice=new VoiceConversation({speech,scope:'role',respond:(_text,options)=>{signal=options.signal;return response.promise;}});
  await voice.startListening({mode:'hands-free',headphonesConfirmed:true});const pending=voice.accept('first');await delay();
  speech.input.reject(Object.assign(Error('device failed'),{code:'voice_audio_overflow'}));await delay();
  assert.equal(signal.aborted,true);response.resolve('obsolete reply');await pending;
  assert.deepEqual(speech.spoken,[]);assert.equal(voice.snapshot().status,'error');await voice.close();
});
test('delayed error cleanup cannot overwrite a newer listening session',async()=>{
  const speech=new FakeSpeech(),blocked=deferred(),voice=new VoiceConversation({speech,scope:'role',respond:async()=>''});
  await voice.startListening({mode:'hands-free',headphonesConfirmed:true});
  speech.stopKind=()=>blocked.promise;
  speech.input.reject(Object.assign(Error('old device failure'),{code:'voice_audio_overflow'}));await delay();
  await voice.startListening({mode:'hands-free',headphonesConfirmed:true});const current=voice.session;
  blocked.resolve();await delay();assert.equal(voice.session,current);assert.equal(voice.snapshot().status,'listening');assert.equal(voice.snapshot().error,'');await voice.close();
});
test('rapid new inputs cannot make an earlier stop acknowledgment revive stale generation',async()=>{
  const speech=new FakeSpeech(),received=[];const blocked=deferred();let calls=0;
  speech.stopKind=()=>++calls===1?blocked.promise:Promise.resolve();
  const voice=new VoiceConversation({speech,scope:'role',respond:async text=>{received.push(text);return '';}});
  const old=voice.accept('old'),fresh=voice.accept('new');await fresh;blocked.resolve();await old;
  assert.deepEqual(received,['new']);await voice.close();
});
test('spoken stop does not become an AI turn and diagnostics do not retain text',async()=>{
  const speech=new FakeSpeech();let calls=0;
  const voice=new VoiceConversation({speech,scope:'role',respond:async()=>{calls++;return '';}});
  await voice.accept('停止');assert.equal(calls,0);assert.equal(JSON.stringify(voice.diagnostics()).includes('停止'),false);await voice.close();
});

test('a listen time limit is distinct from a device failure and retains meter diagnostics',async()=>{
  const speech=new FakeSpeech(),voice=new VoiceConversation({speech,scope:'role',respond:async()=>''});
  await voice.startListening();speech.emit('audio-level',{current:0,max:0,count:0});
  speech.input.reject(Object.assign(Error('limit'),{code:'voice_listen_timeout'}));await delay();
  assert.equal(voice.snapshot().status,'idle');assert.equal(voice.snapshot().reason,'listening-timeout');assert.equal(voice.snapshot().error,'');
  assert.equal(voice.snapshot().audioLevel.count,0);assert.ok(voice.diagnostics().events.some(item=>item.event==='listening-timeout'));
  await voice.close();assert.equal(speech.listenerCount('audio-level'),0);
});
