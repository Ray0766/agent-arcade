'use strict';
// Actual service, companion, journal and pipeline with synthetic transport,
// PCM, ASR and model results. No account, microphone, model process or network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
const {MessageJournal}=require('../src/bot/journal.cjs');
const {SocialCompanion}=require('../src/bot/social-companion.cjs');
const {OwnerVoicePipeline}=require('../src/bot/qq-inbound-voice.cjs');
const {AsrGate}=require('../src/voice/asr-gate.cjs');
const ACCOUNT='100001',OWNER='200001';
const defer=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
async function until(predicate,label){for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail(`Timed out: ${label}`);}
function fixture(t,{enabled=true,available=true}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-service-voice-')),gate=new AsrGate();
  const state={transcript:'合成语音内容',reads:[],asrs:[],model:[],sent:[],posts:[],clients:[],pipelines:[],claims:[],dispositions:[],held:[],cancelFails:false,connects:0,available};
  const service=new BotService({root,vault:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},
    journalFactory:options=>{const journal=new MessageJournal(options),claim=journal.claim.bind(journal),disposition=journal.disposition.bind(journal);journal.claim=(...args)=>{const value=claim(...args);state.claims.push({id:args[1],value});return value;};journal.disposition=(...args)=>{state.dispositions.push({id:args[1],state:args[2]});return disposition(...args);};return journal;},
    claudeProgramRunnerFactory:()=>async options=>{state.model.push(options);return {outcome:'reply_ended',text:'合成回复，仅测试。'};},
    inboundVoiceAvailability:()=>({available:state.available}),
    inboundVoiceFactory:options=>{const pipeline=new OwnerVoicePipeline({...options,reader:{async read(voice,{signal}){state.reads.push(voice);if(state.read)return state.read(voice,signal);return {pcm:Buffer.alloc(6400,1),sampleRate:16000,durationSeconds:0.2};}},acquireLease:options=>gate.acquire(options),
      createAsr:options=>{const asr={options,cancels:0,async transcribe(audio,options){this.audio=audio;this.signal=options.signal;return state.transcribe?state.transcribe(audio,options):state.transcript;},async cancel({jobId}){assert.equal(jobId,this.options.jobId);this.cancels++;if(state.cancelFails)throw Object.assign(Error('synthetic exit unknown'),{code:'asr_exit_unconfirmed'});}};state.asrs.push(asr);return asr;}});if(state.afterPipeline){const process=pipeline.process.bind(pipeline);pipeline.process=(...args)=>process(...args).then(result=>{state.afterPipeline();return result;});}state.pipelines.push(pipeline);return pipeline;},
    qqClientFactory:options=>{const batches=[];let waiting=null;const client={options,accountId:ACCOUNT,ownerId:OWNER,generation:1,ready:true,closed:false,socket:{readyState:1},connectedAt:Date.now(),acceptAfter:Date.now()-1000,
      async connect(){state.connects++;},async inspect(){return {accountId:ACCOUNT,online:true,ownerIsFriend:true};},
      getUpdates(_cursor,signal){if(signal.aborted)return Promise.reject(Object.assign(Error('synthetic abort'),{code:'aborted'}));if(batches.length)return Promise.resolve({cursor:'synthetic',messages:batches.shift()});return new Promise((resolve,reject)=>{const abort=()=>{if(waiting===deliver)waiting=null;reject(Object.assign(Error('synthetic abort'),{code:'aborted'}));};const deliver=messages=>{signal.removeEventListener('abort',abort);waiting=null;resolve({cursor:'synthetic',messages});};waiting=deliver;signal.addEventListener('abort',abort,{once:true});});},
      emit(messages){if(waiting)waiting(messages);else batches.push(messages);},
      async sendText(to,text,context){state.sent.push({to,text,context});return {id:String(state.sent.length)};},async sendProactiveText(){assert.fail('No proactive action expected');},async publishQzoneText(){state.posts.push('unexpected');return {id:'synthetic'};},async getOwnQzonePost(){return null;},async close(){this.closed=true;this.ready=false;this.socket.readyState=3;}};state.clients.push(client);return client;}});
  service.configure({channel:'qq',mode:'claude',qqOwnerId:OWNER,qqAccountId:ACCOUNT,qqUrl:'ws://127.0.0.1:3001/',qqToken:'synthetic-service-voice-token'});
  service.socialConfigure({enabled:true,qqVoiceMessages:enabled,proactiveMessages:false,qzonePosts:false});
  const connect=async()=>{await service.connect();assert.equal(service.status,'connected');assert(service.dispatcher instanceof SocialCompanion);service.dispatcher.flow.debounceMs=0;service.dispatcher.flow.bubbleDelayMs=0;return state.clients.at(-1);};
  const voice=id=>({id:String(id),from:OWNER,text:'',contextToken:'synthetic-current-owner',createdAt:Math.floor(Date.now()/1000)*1000,voice:{kind:'qq-owner-voice',id:String(id),accountId:ACCOUNT,ownerId:OWNER,createdAt:Math.floor(Date.now()/1000)*1000,file:`synthetic-${id}.amr`,sourceBytes:32}});
  const text=(id,content)=>({id:String(id),from:OWNER,text:content,contextToken:'synthetic-text-owner',createdAt:Date.now()});
  const hold=()=>{const value=defer();state.held.push(value);return value;};
  const settle=async()=>{await until(()=>service.inboundVoiceTask===null,'voice pipeline settled');await service.dispatcher.whenIdle();};
  t.after(async()=>{state.cancelFails=false;for(const held of state.held)held.resolve('迟到合成文本');await service.disconnect();const absolute=path.resolve(root);assert(absolute.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(absolute).startsWith('arcade-service-voice-'));fs.rmSync(absolute,{recursive:true,force:true});});
  return {root,state,service,gate,connect,voice,text,hold,settle};
}

test('poll claims each voice once and sends the transcript through companion-only receiveVoice',async t=>{
  const f=fixture(t),client=await f.connect();f.state.transcript='发布说说：这只是合成语音';client.emit([f.voice(1)]);await until(()=>f.state.asrs.length===1,'ASR started');await f.settle();
  assert.equal(f.state.claims.filter(row=>row.id==='1').length,1);assert.equal(f.state.claims[0].value,true);assert.equal(f.state.model.length,1);assert.match(f.state.model[0].prompt,/voice transcription/);assert.deepEqual(await f.state.model[0].request({tool:'Write'}),{allow:false});assert.equal(f.state.posts.length,0);assert.equal(f.state.sent.length,1);assert.equal(f.service.dispatcher.tasks[0].inputKind,'qq-owner-voice');assert.equal(f.service.journal.snapshot().recent[0].state,'reply_ended');
  assert(f.state.asrs[0].audio.pcm.every(value=>value===0));assert.doesNotMatch(JSON.stringify(f.service.journal.snapshot()),/发布说说|synthetic-1.amr/);
  client.emit([f.voice(1)]);await until(()=>f.state.claims.length===2,'duplicate observed');assert.equal(f.state.claims[1].value,false);assert.equal(f.state.asrs.length,1);
});
test('voice memory commands do not create facts, reminders or permission actions',async t=>{
  const f=fixture(t),client=await f.connect();f.state.transcript='记住：这句语音不是保存指令';client.emit([f.voice(2)]);await until(()=>f.state.asrs.length===1,'ASR started');await f.settle();assert.equal(f.service.socialStore.facts(f.service.socialScope,10).length,0);assert.equal(f.service.socialStore.followups(f.service.socialScope,{limit:10}).length,0);assert.equal(f.service.dispatcher.snapshot().pending.length,0);assert.equal(f.state.model.length,1);
});
test('voice recognition is opt-in and unavailable configuration never creates a reader or ASR',async t=>{
  const disabled=fixture(t,{enabled:false}),client=await disabled.connect();assert.equal(client.options.allowOwnerVoice,false);client.emit([{...disabled.text(3,''),unsupported:'qq_segments'}]);await until(()=>disabled.state.sent.length===1,'unsupported notice');assert.equal(disabled.state.reads.length,0);assert.equal(disabled.state.asrs.length,0);assert.equal(disabled.state.model.length,0);
  const f=fixture(t,{available:false}),active=await f.connect();active.emit([f.voice(4)]);await until(()=>f.state.sent.length===1,'unavailable notice');assert.equal(f.state.pipelines.length,0);assert.equal(f.service.journal.snapshot().recent[0].state,'rejected');
});
test('new text aborts pending ASR and a late transcript cannot run after the newer text',async t=>{
  const f=fixture(t),client=await f.connect(),held=f.hold();f.state.transcribe=()=>held.promise;client.emit([f.voice(5)]);await until(()=>f.state.asrs.length===1,'ASR started');const signal=f.state.asrs[0].signal;client.emit([f.text(6,'这条文字取代上一条语音')]);await until(()=>signal.aborted,'ASR cancellation');held.resolve('迟到的旧语音内容');await until(()=>f.state.model.length===1,'new text dispatched');await f.service.dispatcher.whenIdle();assert.match(f.state.model[0].prompt,/这条文字取代上一条语音/);assert.doesNotMatch(f.state.model[0].prompt,/迟到的旧语音内容/);assert.equal(f.state.sent.length,1);assert.equal(f.service.inboundVoiceTask,null);
});
test('multiple records while busy get one notice without reconnect or extra ASR jobs',async t=>{
  const f=fixture(t),client=await f.connect(),held=f.hold();f.state.transcribe=()=>held.promise;client.emit([f.voice(7)]);await until(()=>f.state.asrs.length===1,'ASR started');client.emit([f.voice(8),f.voice(9)]);await until(()=>f.state.claims.length===3,'busy records claimed');assert.equal(f.state.sent.length,1);assert.match(f.state.sent[0].text,/上一条语音/);assert.equal(f.state.connects,1);assert.equal(f.service.status,'connected');assert.equal(f.state.asrs.length,1);assert.equal(f.state.reads.length,1);held.resolve('第一条合成语音');await f.settle();assert.equal(f.state.model.length,1);
});
test('same client reconnect invalidates a previous transcript despite unchanged service identity',async t=>{
  const f=fixture(t),client=await f.connect(),held=f.hold();f.state.transcribe=()=>held.promise;client.emit([f.voice(10)]);await until(()=>f.state.asrs.length===1,'ASR started');client.generation++;client.socket={readyState:1};client.connectedAt=Date.now();held.resolve('上一连接的迟到文本');await f.settle();assert.equal(f.state.model.length,0);assert.equal(f.service.journal.snapshot().recent[0].state,'rejected');assert.equal(f.state.asrs[0].cancels,1);
});
test('unconfirmed ASR exit retains pipeline and gate, blocks new work and requires confirmed cleanup before reconnect',async t=>{
  const f=fixture(t),client=await f.connect();f.state.cancelFails=true;client.emit([f.voice(11)]);await until(()=>f.service.inboundVoiceTask&&f.state.asrs[0]?.cancels===1,'unconfirmed cleanup');await f.service.inboundVoiceTask.promise;assert.equal(f.state.model.length,0);assert.equal(f.service.inboundVoiceTask.pipeline.busy,true);assert.throws(()=>f.gate.acquire({scopeId:'other-account',jobId:'other'}),{code:'busy'});
  client.emit([f.voice(12)]);await until(()=>f.state.claims.length===2,'second record');assert.equal(f.state.asrs.length,1);await f.service.disconnect();assert.equal(f.service.status,'disconnected');assert(f.service.inboundVoiceTask);await assert.rejects(f.service.connect(),{code:'asr_exit_unconfirmed'});assert.equal(f.state.connects,1);
  f.state.cancelFails=false;await f.service.connect();assert.equal(f.service.status,'connected');assert.equal(f.service.inboundVoiceTask,null);assert.equal(f.state.connects,2);const lease=f.gate.acquire({scopeId:'other-account',jobId:'new'});lease.release();
});
test('disconnect aborts pending recognition and waits for the original pipeline without delivering its text',async t=>{
  const f=fixture(t),client=await f.connect(),held=f.hold();f.state.transcribe=()=>held.promise;client.emit([f.voice(13)]);await until(()=>f.state.asrs.length===1,'ASR started');const closing=f.service.disconnect();await until(()=>f.state.asrs[0].signal.aborted,'disconnect abort');held.resolve('断开后的迟到文本');await closing;assert.equal(f.service.status,'disconnected');assert.equal(f.service.inboundVoiceTask,null);assert.equal(f.state.model.length,0);assert.equal(f.state.sent.length,0);assert.equal(client.closed,true);const lease=f.gate.acquire({scopeId:'other-account',jobId:'new'});lease.release();
});
test('a connection change after successful pipeline completion but before service continuation prevents voice dispatch',async t=>{
  for(const change of ['socket','generation'])await t.test(change,async t=>{const f=fixture(t),client=await f.connect();f.state.afterPipeline=()=>{if(change==='socket')client.socket={readyState:1};else client.generation++;};client.emit([f.voice(14)]);await until(()=>f.state.asrs.length===1,'ASR started');await f.settle();assert.equal(f.state.model.length,0);assert.equal(f.service.dispatcher.tasks.length,0);assert.equal(f.service.journal.snapshot().recent[0].state,'rejected');assert.equal(f.state.asrs[0].cancels,1);});
});
