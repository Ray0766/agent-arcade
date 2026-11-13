'use strict';
// Real service/journal/companion/pipeline/gate, synthetic QQ, PCM and model.
// No microphone, native worker, QQ account or network operation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
const {MessageJournal}=require('../src/bot/journal.cjs');
const {OwnerVoicePipeline}=require('../src/bot/qq-inbound-voice.cjs');
const {AsrGate}=require('../src/voice/asr-gate.cjs');
const ACCOUNT='100001',OWNER='200001';
const fail=code=>Object.assign(Error(`Synthetic ${code}`),{code});
const defer=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
async function until(predicate,label){for(let i=0;i<300;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail(`Timed out: ${label}`);}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-warm-service-')),gate=new AsrGate(),ids=new WeakMap();let sequence=0;
  const identity=value=>{if(!ids.has(value))ids.set(value,++sequence);return ids.get(value);};
  const state={transcript:'合成语音，不是真人输入。',asrs:[],reads:[],model:[],sent:[],clients:[],pipelines:[],claims:[],held:[],closeFails:false};
  const service=new BotService({root,vault:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},
    journalFactory:opts=>{const journal=new MessageJournal(opts),claim=journal.claim.bind(journal);journal.claim=(...args)=>{const result=claim(...args);state.claims.push({id:args[1],result});return result;};return journal;},
    claudeProgramRunnerFactory:()=>async options=>{state.model.push(options);return {outcome:'reply_ended',text:'仅供合成测试。'};},inboundVoiceAvailability:()=>({available:true}),
    inboundVoiceFactory:options=>{
      const pipeline=new OwnerVoicePipeline({...options,keepWarm:true,
        reader:{async read(voice,{signal}){state.reads.push(voice.id);if(state.read)return state.read(voice,signal);return {pcm:Buffer.alloc(6400,1),sampleRate:16000,durationSeconds:0.2};}},
        acquireLease:async opts=>{const reuseKey=JSON.stringify([opts.scopeId,opts.accountId,opts.ownerId,opts.generation,opts.clientGeneration,identity(opts.client),identity(opts.socket),identity(opts.dispatcher)]);await gate.prepare({reuseKey,signal:opts.signal});return {...gate.acquire({...opts,reuseKey}),reuseKey};},
        createAsr:()=>{const host={closed:false,busy:false,jobId:null,closes:0,cancels:0,transcribes:0,
          async transcribe(audio,opts){assert.equal(this.closed,false);assert.equal(this.busy,false);this.busy=true;this.jobId=opts.jobId;this.audio=audio;this.signal=opts.signal;this.transcribes++;return state.transcribe?state.transcribe(audio,opts):state.transcript;},
          async finish({jobId}){assert.equal(jobId,this.jobId);assert.equal(this.busy,true);this.busy=false;return {parked:true};},
          async cancel({jobId}){assert.equal(jobId,this.jobId);this.cancels++;return this.close();},
          async close(){this.closes++;if(state.closeFails)throw fail('asr_exit_unconfirmed');if(state.closeDelay)await state.closeDelay.promise;this.closed=true;this.busy=false;return {closed:true};}};state.asrs.push(host);return host;}});
      const process=pipeline.process.bind(pipeline);pipeline.process=(...args)=>process(...args).then(result=>{state.afterPipeline?.();return state.resultOverride||result;});state.pipelines.push(pipeline);return pipeline;},
    qqClientFactory:options=>{const batches=[];let waiting=null;const client={options,accountId:ACCOUNT,ownerId:OWNER,generation:1,ready:true,closed:false,socket:{readyState:1},connectedAt:Date.now(),acceptAfter:Date.now()-1000,
      async connect(){},async inspect(){return {accountId:ACCOUNT,online:true,ownerIsFriend:true};},getUpdates(_cursor,signal){if(signal.aborted)return Promise.reject(fail('aborted'));if(batches.length){const row=batches.shift();return row instanceof Error?Promise.reject(row):Promise.resolve({cursor:'synthetic',messages:row});}
        return new Promise((resolve,reject)=>{const abort=()=>{if(waiting===deliver)waiting=null;reject(fail('aborted'));};const deliver=row=>{signal.removeEventListener('abort',abort);waiting=null;row instanceof Error?reject(row):resolve({cursor:'synthetic',messages:row});};waiting=deliver;signal.addEventListener('abort',abort,{once:true});});},
      emit(row){if(waiting)waiting(row);else batches.push(row);},async sendText(to,text){state.sent.push({to,text});return {id:String(state.sent.length)};},
      async sendProactiveText(){assert.fail('No proactive send in this test');},async publishQzoneText(){assert.fail('No public post in this test');},async getOwnQzonePost(){return null;},async close(){this.closed=true;this.ready=false;this.socket.readyState=3;}};state.clients.push(client);return client;}});
  service.configure({channel:'qq',mode:'claude',qqOwnerId:OWNER,qqAccountId:ACCOUNT,qqUrl:'ws://127.0.0.1:3001/',qqToken:'synthetic-warm-service-token'});
  service.socialConfigure({enabled:true,qqVoiceMessages:true,proactiveMessages:false,qzonePosts:false});
  const connect=async()=>{await service.connect();assert.equal(service.status,'connected');service.dispatcher.flow.debounceMs=0;service.dispatcher.flow.bubbleDelayMs=0;return state.clients.at(-1);};
  const voice=id=>({id:String(id),from:OWNER,text:'',contextToken:'synthetic-owner',createdAt:Math.floor(Date.now()/1000)*1000,voice:{kind:'qq-owner-voice',id:String(id),accountId:ACCOUNT,ownerId:OWNER,createdAt:Math.floor(Date.now()/1000)*1000,file:`synthetic-${id}.amr`,sourceBytes:32}});
  const text=(id,content)=>({id:String(id),from:OWNER,text:content,contextToken:'synthetic-owner',createdAt:Date.now()});
  const hold=()=>{const value=defer();state.held.push(value);return value;};
  const complete=async(client,id)=>{const before=state.claims.length;client.emit([voice(id)]);await until(()=>state.claims.length>before,'claimed');await until(()=>!service.inboundVoiceTask,'pipeline settled');await service.dispatcher.whenIdle();};
  t.after(async()=>{state.closeFails=false;state.closeDelay=null;for(const held of state.held)held.resolve('迟到的合成语音');await service.disconnect();await gate.retryCleanup();await gate.close();assert(root.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('arcade-warm-service-'));fs.rmSync(root,{recursive:true,force:true});});
  return {state,service,gate,connect,voice,text,hold,complete};
}
test('separate voice pipelines reuse one clean host and retain only an exact lease cleanup handle',async t=>{
  const f=fixture(t),client=await f.connect();await f.complete(client,1);const first=f.service.inboundVoiceIdle;
  assert.deepEqual(Object.keys(first),['close']);assert.equal(f.service.inboundVoiceTask,null);assert.equal(f.state.pipelines[0].idleCleanup,null);assert.equal(f.state.pipelines[0].operation,null);assert.equal(f.state.asrs[0].closed,false);
  await f.complete(client,2);assert.equal(f.state.pipelines.length,2);assert.equal(f.state.asrs.length,1);assert.equal(f.state.asrs[0].transcribes,2);assert.equal(f.state.asrs[0].closes,0);assert.notEqual(f.service.inboundVoiceIdle,first);await first.close();assert.equal(f.state.asrs[0].closed,false);assert.equal(f.state.model.length,2);assert(f.state.asrs[0].audio.pcm.every(n=>n===0));
});
test('new typed text is dispatched while idle close is pending and further voice stays busy',async t=>{
  const f=fixture(t),client=await f.connect();await f.complete(client,3);f.state.closeDelay=f.hold();client.emit([f.text(4,'这条合成文字取代语音等待')]);await until(()=>f.state.model.length===2,'text dispatched before close resolves');await f.service.dispatcher.whenIdle();assert.equal(f.state.asrs[0].closed,false);assert(f.service.inboundVoiceClosing);assert(f.service.inboundVoiceIdle);client.emit([f.voice(22)]);await until(()=>f.state.claims.length===3,'new voice rejected');assert.equal(f.state.reads.length,1);assert.equal(f.state.asrs.length,1);f.state.closeDelay.resolve();await until(()=>!f.service.inboundVoiceClosing,'idle close settled');assert.equal(f.state.asrs[0].closed,true);assert.equal(f.service.inboundVoiceIdle,null);
});
test('disconnect closes idle host and reconnect never reuses the old process',async t=>{
  const f=fixture(t),client=await f.connect();await f.complete(client,5);await f.service.disconnect();assert.equal(f.state.asrs[0].closed,true);assert.equal(f.service.inboundVoiceIdle,null);const next=await f.connect();await f.complete(next,6);assert.equal(f.state.asrs.length,2);assert.equal(f.state.model.length,2);
});
test('same-client socket generation change clears idle before processing the new batch',async t=>{
  const f=fixture(t),client=await f.connect();await f.complete(client,7);client.generation++;client.socket={readyState:1};client.emit([]);await until(()=>f.state.asrs[0].closed,'reconnect cleanup');assert.equal(f.service.inboundVoiceIdle,null);await f.complete(client,8);assert.equal(f.state.asrs.length,2);
});
test('a recoverable poll failure closes idle before waiting for reconnect',async t=>{
  const f=fixture(t),client=await f.connect();await f.complete(client,9);client.emit(fail('disconnected'));await until(()=>f.service.status==='connecting'&&f.state.asrs[0].closed,'retry cleanup');assert.equal(f.service.inboundVoiceIdle,null);
});
test('binding loss between parked result and service handoff closes instead of delivering stale text',async t=>{
  const f=fixture(t),client=await f.connect();f.state.afterPipeline=()=>{client.generation++;};await f.complete(client,10);assert.equal(f.state.model.length,0);assert.equal(f.state.asrs[0].closed,true);assert.equal(f.service.inboundVoiceIdle,null);assert.equal(f.service.journal.snapshot().recent[0].state,'rejected');
});
test('a failed or malformed handoff releases a parked resource, not only an active job',async t=>{
  for(const mode of ['reject','throw','malformed'])await t.test(mode,async t=>{const f=fixture(t),client=await f.connect();if(mode==='malformed')f.state.resultOverride={outcome:'transcribed',id:'11',allowCommands:true,target:'companion-chat-only'};else f.service.dispatcher.receiveVoice=async()=>{if(mode==='throw')throw fail('synthetic_handoff');return {accepted:false};};await f.complete(client,11);assert.equal(f.state.model.length,0);assert.equal(f.state.asrs[0].closed,true);assert.equal(f.service.inboundVoiceIdle,null);});
});
test('an unconfirmed idle close remains reachable, prevents reconnect and supports a later exact retry',async t=>{
  const f=fixture(t),client=await f.connect();await f.complete(client,12);const handle=f.service.inboundVoiceIdle;f.state.closeFails=true;await f.service.disconnect();assert.equal(f.service.inboundVoiceIdle,handle);assert.equal(f.state.asrs[0].closed,false);await assert.rejects(f.service.connect(),{code:'asr_exit_unconfirmed'});assert.equal(f.state.clients.length,1);assert.equal(f.service.inboundVoiceIdle,handle);f.state.closeFails=false;await f.connect();assert.equal(f.service.inboundVoiceIdle,null);assert.equal(f.state.asrs[0].closed,true);
});
test('unknown idle close does not block typed text but cannot be overwritten by a new voice host',async t=>{
  const f=fixture(t),client=await f.connect();await f.complete(client,13);const handle=f.service.inboundVoiceIdle;f.state.closeFails=true;client.emit([f.text(14,'清理失败时仍可使用合成文字')]);await until(()=>f.state.model.length===2,'text still dispatched');await f.service.dispatcher.whenIdle();assert.equal(f.service.inboundVoiceIdle,handle);await f.complete(client,15);assert.equal(f.state.asrs.length,1);assert.equal(f.service.inboundVoiceIdle,handle);assert.equal(f.state.model.length,2);
});
test('disconnect while receiveVoice awaits closes parked ownership and cannot retain it afterwards',async t=>{
  const f=fixture(t),client=await f.connect(),held=f.hold();let entered=false;f.service.dispatcher.receiveVoice=async()=>{entered=true;await held.promise;return {accepted:false};};client.emit([f.voice(16)]);await until(()=>entered,'handoff entered');const closing=f.service.disconnect();await until(()=>f.state.asrs[0].closed,'parked cleanup');held.resolve();await closing;assert.equal(f.service.inboundVoiceIdle,null);assert.equal(f.service.inboundVoiceTask,null);assert.equal(f.state.model.length,0);
});
test('concurrent cleanup shares one operation and admission stays closed until it settles',async t=>{
  const f=fixture(t),client=await f.connect();await f.complete(client,17);f.state.closeDelay=f.hold();const a=f.service.closeInboundVoice(),b=f.service.closeInboundVoice();assert.equal(a,b);await until(()=>f.state.asrs[0].closes===1,'close entered');client.emit([f.voice(18),f.voice(21)]);await until(()=>f.state.claims.length===3,'new voices rejected while closing');assert.equal(f.state.sent.length,2,'one successful reply and one busy notice');assert.equal(f.state.asrs.length,1);assert.equal(f.state.reads.length,1);f.state.closeDelay.resolve();await a;assert.equal(f.service.inboundVoiceClosing,null);assert.equal(f.service.inboundVoiceIdle,null);
});
test('a failed handoff with unknown exit retains only the minimal idle handle for retry',async t=>{
  const f=fixture(t),client=await f.connect();f.state.closeFails=true;f.service.dispatcher.receiveVoice=async()=>{throw fail('synthetic_handoff');};await f.complete(client,19);
  assert.equal(f.state.model.length,0);assert.equal(f.service.inboundVoiceTask,null);assert.deepEqual(Object.keys(f.service.inboundVoiceIdle),['close']);assert.equal(f.state.pipelines[0].idleCleanup,null);assert.equal(f.state.asrs[0].closed,false);assert.throws(()=>f.gate.acquire({scopeId:'desktop',jobId:'new'}),{code:'busy'});
  f.state.closeFails=false;await f.service.closeInboundVoice();assert.equal(f.service.inboundVoiceIdle,null);assert.equal(f.state.asrs[0].closed,true);
});
test('failed active warm cleanup keeps the original pipeline and can be retried after disconnect',async t=>{
  const f=fixture(t),client=await f.connect();f.state.closeFails=true;f.state.transcribe=async()=>{throw fail('asr_failed');};client.emit([f.voice(20)]);
  await until(()=>f.state.asrs[0]?.cancels===1&&f.service.inboundVoiceTask,'active close failed');await f.service.inboundVoiceTask.promise;assert.equal(f.service.inboundVoiceTask.pipeline.busy,true);assert.equal(f.service.inboundVoiceIdle,null);assert.equal(f.state.model.length,0);
  await f.service.disconnect();assert(f.service.inboundVoiceTask);await assert.rejects(f.service.connect(),{code:'asr_exit_unconfirmed'});assert.equal(f.state.clients.length,1);f.state.closeFails=false;await f.gate.retryCleanup();await f.connect();assert.equal(f.service.inboundVoiceTask,null);assert.equal(f.state.asrs[0].closed,true);
});
test('a failed background idle close cannot write an error into a replacement connection',async t=>{
  const f=fixture(t),client=await f.connect();await f.complete(client,23);f.state.closeDelay=f.hold();client.emit([f.text(24,'合成文字无需等待清理')]);await until(()=>f.state.model.length===2,'text dispatched');await f.service.dispatcher.whenIdle();const closing=f.service.inboundVoiceClosing,handle=f.service.inboundVoiceIdle;client.generation++;client.socket={readyState:1};f.service.inputProblem='replacement connection sentinel';f.state.closeDelay.reject(fail('asr_exit_unconfirmed'));await assert.rejects(closing,{code:'asr_exit_unconfirmed'});assert.equal(f.service.inputProblem,'replacement connection sentinel');assert.equal(f.service.inboundVoiceIdle,handle);assert.equal(f.state.asrs[0].closed,false);f.state.closeDelay=null;
});
