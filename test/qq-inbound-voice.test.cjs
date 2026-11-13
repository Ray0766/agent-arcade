'use strict';
const {until}=require('./helpers/until.cjs');
// All account data, clips and API responses below are independent fixtures.
const test=require('node:test'),assert=require('node:assert/strict'),{once,EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {WebSocketServer}=require('ws');
const {captureOwnerVoice,decodeRecord,OwnerRecordReader,OwnerVoicePipeline:Pipeline}=require('../src/bot/qq-inbound-voice.cjs');
const {QwenFileAsr}=require('../src/voice/qwen-file-asr.cjs');
const path=require('node:path');
const JOB='12345678-1234-1234-1234-123456789abc';
// Never opened or started (spawnProcess is a fake); they only have to be absolute on the platform running the test.
const FIXTURE_PYTHON=path.resolve(path.sep,'fixture','python.exe'),FIXTURE_MODEL=path.resolve(path.sep,'fixture','model');
// Existing fixture injection remains private; production requires an explicit
// shared lease implementation and a per-job transcriber factory.
class OwnerVoicePipeline extends Pipeline{constructor({asr,...options}){super({createAsr:()=>asr,acquireLease:async()=>({assertCurrent(){},release(){}}),...options});}}
const ACCOUNT='12345001',OWNER='12345002',FILE='a'.repeat(32)+'.amr',TOKEN='synthetic-voice-reader-token';
function wav(seconds=.25,rate=16000){const b=Buffer.alloc(44+Math.round(seconds*rate)*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);for(let i=44;i<b.length;i+=2)b.writeInt16LE(i%1000,i);return b;}
function event(){return {post_type:'message',message_type:'private',sub_type:'friend',self_id:ACCOUNT,user_id:OWNER,message_id:123,time:Math.floor(Date.now()/1000),message:[{type:'record',data:{file:FILE,file_size:1024,url:'http://169.254.169.254/private',path:'C:\\private\\credential'}}]};}
function binding(){return {accountId:ACCOUNT,ownerId:OWNER,companion:true,scopeId:'synthetic-scope',generation:1,client:{generation:1,socket:{}},dispatcher:{},url:'ws://127.0.0.1:3001/',token:TOKEN};}
function voice(){return captureOwnerVoice(event(),binding());}
async function server(t,{intercept,timeoutMs=1000}={}){
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');const state={calls:[],sockets:0,closed:0,account:ACCOUNT};const frame=event(),v=captureOwnerVoice(frame,binding());
 t.after(async()=>{for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));});
 wss.on('connection',(ws,req)=>{state.sockets++;assert.equal(req.headers.authorization,`Bearer ${TOKEN}`);ws.on('close',()=>state.closed++);ws.on('message',raw=>{const call=JSON.parse(raw);state.calls.push(call);const reply=data=>ws.send(JSON.stringify({status:'ok',retcode:0,echo:call.echo,data}));if(intercept?.({call,reply,ws,state,frame}))return;
  if(call.action==='get_login_info')reply({user_id:state.account});else if(call.action==='get_status')reply({online:true,good:true});else if(call.action==='get_msg')reply({...frame,sender:{user_id:OWNER}});else if(call.action==='get_record')reply({file_size:'1024',base64:wav().toString('base64'),file:'C:\\PRIVATE',url:'http://127.0.0.1/PRIVATE'});else assert.fail('unexpected API');});});
 return {reader:new OwnerRecordReader({timeoutMs}),voice:v,options:{url:`ws://127.0.0.1:${wss.address().port}/`,token:TOKEN},state};
}
test('scope accepts one current owner friend voice and projects no URL/path',()=>{
 assert.deepEqual(Object.keys(voice()),['kind','accountId','ownerId','id','createdAt','file','sourceBytes']);
 for(const patch of [{message_type:'group'},{sub_type:'group'},{user_id:'12345003'},{self_id:'12345004'},{group_id:42}])assert.throws(()=>captureOwnerVoice({...event(),...patch},binding()),{code:'wrong_scope'});
 assert.throws(()=>captureOwnerVoice(event(),{...binding(),companion:false}),{code:'wrong_scope'});
 const old=event();assert.throws(()=>captureOwnerVoice(old,{...binding(),acceptAfter:old.time*1000+1}),{code:'invalid_response'});
});
test('rejects arbitrary file URL/path, oversized source, magic and mixed content before transport',()=>{
 for(const file of ['http://localhost/a','file:///C:/a','C:\\a','../a','a..amr','base64://AAA=','//host/file']){const e=event();e.message[0].data.file=file;assert.throws(()=>captureOwnerVoice(e,binding()),{code:'unsupported'});}
 for(const n of [0,null,undefined,'-1',1048577]){const e=event();e.message[0].data.file_size=n;assert.throws(()=>captureOwnerVoice(e,binding()));}
 const e=event();e.message.push({type:'text',data:{text:'/allow x'}});assert.throws(()=>captureOwnerVoice(e,binding()),{code:'unsupported'});
});
test('loopback fixed get_msg and get_record, exact identity checks, memory audio, no raw private fields',async t=>{
 const f=await server(t);const result=await f.reader.read(f.voice,f.options);assert.equal(result.pcm.length,8000);assert.equal(result.sampleRate,16000);assert.equal(result.durationSeconds,.25);
 assert.deepEqual(f.state.calls.map(x=>x.action),['get_login_info','get_status','get_msg','get_record','get_login_info','get_status']);
 assert.deepEqual(f.state.calls[3].params,{file:FILE,out_format:'wav'});assert.doesNotMatch(JSON.stringify(result),/PRIVATE|url|file|token/);result.pcm.fill(0);
});
test('get_msg ownership or record mismatch prevents any get_record',async t=>{
 for(const mutate of [f=>f.sender.user_id='12345003',f=>f.user_id='12345003',f=>f.message_id++,f=>f.message[0].data.file='other.amr',f=>f.message_type='group']){
  const f=await server(t,{intercept({call,reply,frame}){if(call.action!=='get_msg')return;const msg={...structuredClone(frame),sender:{user_id:OWNER}};mutate(msg);reply(msg);return true;}});
  await assert.rejects(f.reader.read(f.voice,f.options),{code:'message_changed'});assert(!f.state.calls.some(x=>x.action==='get_record'));
 }
});
test('account change after audio causes rejection and never delivers bytes',async t=>{
 const f=await server(t,{intercept({call,reply,state}){if(call.action==='get_record'){state.account='12345003';reply({file_size:1024,base64:wav().toString('base64')});return true;}}});
 await assert.rejects(f.reader.read(f.voice,f.options),{code:'account_changed'});
});
test('response base64/format/duration limits are independent of reported source length',()=>{
 for(const encoded of ['%%%%','YQ==\n','YQ===',wav(30.01).toString('base64'),'A'.repeat(4*1024*1024+4)])assert.throws(()=>decodeRecord({file_size:1024,base64:encoded},voice()));
 const stereo=wav();stereo.writeUInt16LE(2,22);assert.throws(()=>decodeRecord({file_size:1024,base64:stereo.toString('base64')},voice()),{code:'voice_format'});
});
test('cancel/deadline closes short-lived request, no retries or get_record replay',async t=>{
 const f=await server(t,{timeoutMs:30,intercept:({call})=>call.action==='get_record'});await assert.rejects(f.reader.read(f.voice,f.options),{code:'timeout'});assert.equal(f.state.calls.filter(x=>x.action==='get_record').length,1);
 const controller=new AbortController(),g=await server(t,{intercept({call}){if(call.action==='get_record'){controller.abort();return true;}}});await assert.rejects(g.reader.read(g.voice,{...g.options,signal:controller.signal}),{code:'cancelled'});
});
test('binary/oversized bridge frames fail closed',async t=>{
 for(const payload of [Buffer.from('{}'),'x'.repeat(4*1024*1024+4097)]){const f=await server(t,{intercept({ws}){ws.send(payload);return true;}});await assert.rejects(f.reader.read(f.voice,f.options),error=>['invalid_response','response_too_large','disconnected'].includes(error.code));}
});
test('durable claim occurs first; duplicates never invoke reader or ASR; transcript is not a command',async()=>{
 let b=binding(),reads=0,inferences=0;const claimed=new Set(),states=[],pcm=Buffer.alloc(8000,1);
 const pipeline=new OwnerVoicePipeline({getBinding:()=>b,reader:{async read(){reads++;return {pcm,sampleRate:16000,durationSeconds:.25};}},asr:{async transcribe(){inferences++;return '/allow ABC';},async cancel(){}},claim:async(scope,id)=>{assert.equal(scope,b.scopeId);if(claimed.has(id))return false;claimed.add(id);return true;},disposition:async(...args)=>states.push(args)});
 const e=event(),r=await pipeline.process(e);assert.equal(r.allowCommands,false);assert.equal(r.target,'companion-chat-only');assert.equal(r.text,'/allow ABC');assert(pcm.every(x=>x===0));assert.equal((await pipeline.process(e)).outcome,'duplicate');assert.equal(reads,1);assert.equal(inferences,1);assert.equal(states[0][2],'received');
});
test('journal failure is a fixed error and cannot bypass claim into media/model work',async()=>{
 for(const claim of [async()=>{throw Error('PRIVATE path and token');},async()=>null]){
  const b=binding(),p=new OwnerVoicePipeline({getBinding:()=>b,reader:{async read(){assert.fail('must not download');}},asr:{async transcribe(){assert.fail('must not infer');},async cancel(){}},claim,disposition:async()=>{}});
  await assert.rejects(p.process(event()),error=>error.code==='journal_unavailable'&&!error.message.includes('PRIVATE'));
 }
});
test('generation/role changes during ASR discard transcript and zero PCM',async()=>{
 let b=binding(),finish;const pcm=Buffer.alloc(8000,2),states=[];
 const p=new OwnerVoicePipeline({getBinding:()=>b,reader:{async read(){return {pcm,sampleRate:16000,durationSeconds:.25};}},asr:{transcribe:()=>new Promise(r=>finish=r),async cancel(){}},claim:async()=>true,disposition:async(...args)=>states.push(args)});
 const promise=p.process(event());await until(()=>finish);b={...b,generation:2,scopeId:'other'};finish('你好');await assert.rejects(promise,{code:'account_changed'});assert(pcm.every(x=>x===0));assert.equal(states.at(-1)[2],'rejected');
});
test('same-client reconnect or in-place owner config change invalidates original captured voice',async()=>{
 for(const mutate of [b=>{b.client.generation++;b.client.socket={};},b=>{b.ownerId='12345003';}]){
  const b=binding();let finish;const pcm=Buffer.alloc(8000,2),p=new OwnerVoicePipeline({getBinding:()=>b,reader:{async read(){return {pcm,sampleRate:16000,durationSeconds:.25};}},asr:{transcribe:()=>new Promise(r=>finish=r),async cancel(){}},claim:async()=>true,disposition:async()=>{}});
  const promise=p.process(event());await until(()=>finish);mutate(b);finish('late');await assert.rejects(promise,{code:'account_changed'});assert(pcm.every(x=>x===0));
 }
});
test('pipeline close waits for reader cancellation and final journal disposition',async()=>{
 const b=binding();let release,finalize,closed=false;const pcm=Buffer.alloc(8000,2),p=new OwnerVoicePipeline({getBinding:()=>b,reader:{read:()=>new Promise(r=>release=()=>r({pcm,sampleRate:16000,durationSeconds:.25}))},asr:{async transcribe(){assert.fail('cancelled before inference');},async cancel(){}},claim:async()=>true,disposition:()=>new Promise(r=>finalize=r)});
 const result=p.process(event());result.catch(()=>{});await until(()=>release);const closing=p.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);release();await until(()=>finalize);assert.equal(closed,false);finalize();await closing;await assert.rejects(result,{code:'cancelled'});assert(pcm.every(x=>x===0));
});
function fakeProcess({onInput,killExit=true}={}){const child=new EventEmitter();child.pid=123;child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();let input='';child.stdin.on('data',b=>input+=b);child.stdin.on('finish',()=>onInput?.(JSON.parse(input),child));child.kill=()=>{if(killExit)queueMicrotask(()=>child.emit('close',1));return true;};return child;}
function fakeAsr(spawnProcess,extra={}){const asr=new QwenFileAsr({pythonPath:FIXTURE_PYTHON,modelPath:FIXTURE_MODEL,spawnProcess,exitTimeoutMs:30,timeoutMs:200,...extra});const transcribe=asr.transcribe.bind(asr),cancel=asr.cancel.bind(asr);asr.transcribe=(audio,options={})=>transcribe(audio,{jobId:JOB,...options});asr.cancel=(options={})=>cancel({jobId:JOB,...options});return asr;}
test('ASR result is withheld until actual process close; no source/path/PCM stdout retained',async()=>{
 let child,id;const asr=fakeAsr((_exe,args,options)=>{assert.deepEqual(options.stdio,['pipe','pipe','pipe']);assert.equal(options.windowsHide,true);assert.equal(options.env.HF_HUB_OFFLINE,'1');assert.equal(args[0],'-u');child=fakeProcess({onInput(row,c){id=row.id;c.stdout.write(JSON.stringify({id,event:'transcript',text:'你好'})+'\n');}});return child;});
 let settled=false;const p=asr.transcribe({pcm:Buffer.alloc(8000),sampleRate:16000}).then(x=>{settled=true;return x;});await until(()=>id);await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.equal(asr.busy,true);child.emit('close',0);assert.equal(await p,'你好');assert.equal(asr.busy,false);
});
test('ASR abort closes owned process before reporting cancelled and late text does not escape',async()=>{
 const c=new AbortController();let child;const asr=fakeAsr(()=>child=fakeProcess({onInput(row,p){c.abort();p.stdout.write(JSON.stringify({id:row.id,event:'transcript',text:'late'})+'\n');}}));
 await assert.rejects(asr.transcribe({pcm:Buffer.alloc(8000),sampleRate:16000},{signal:c.signal}),{code:'cancelled'});assert.equal(asr.busy,false);
});
test('ASR exit uncertainty retains gate until explicit cancellation confirms close',async()=>{
 let child;const c=new AbortController(),asr=fakeAsr(()=>child=fakeProcess({killExit:false,onInput(){c.abort();}}));
 await assert.rejects(asr.transcribe({pcm:Buffer.alloc(8000),sampleRate:16000},{signal:c.signal}),{code:'asr_exit_unconfirmed'});assert.equal(asr.busy,true);await assert.rejects(asr.transcribe({pcm:Buffer.alloc(8000),sampleRate:16000}),{code:'busy'});
 const cancel=asr.cancel();child.emit('close',1);await cancel;assert.equal(asr.busy,false);
});
test('ASR bad IDs/duplicate replies and stdout flooding cannot produce transcript',async()=>{
 for(const output of [(id)=>JSON.stringify({id:'wrong',event:'transcript',text:'private'})+'\n',()=> 'x'.repeat(16385),(id)=>[1,2].map(()=>JSON.stringify({id,event:'transcript',text:'same'})+'\n').join('')]){
  const asr=fakeAsr(()=>fakeProcess({onInput(row,p){p.stdout.write(output(row.id));}}));await assert.rejects(asr.transcribe({pcm:Buffer.alloc(8000),sampleRate:16000}),{code:'invalid_response'});assert.equal(asr.busy,false);
 }
});
function pipelineOptions(overrides={}){
 const b=binding();return {getBinding:()=>b,reader:{async read(){return {pcm:Buffer.alloc(8000,1),sampleRate:16000,durationSeconds:.25};}},claim:async()=>true,disposition:async()=>{},createAsr:()=>({async transcribe(){return '合成夹具';},async cancel(){}}),acquireLease:async()=>({assertCurrent(){},release(){}}),...overrides};
}
test('one injected shared lease excludes a second account and is released only by its owning job',async()=>{
 let owner=null,finish,created=0,released=0;
 const acquireLease=async meta=>{if(owner)throw Object.assign(Error(),{code:'busy'});owner=meta;return {assertCurrent(){assert.equal(owner,meta);},release(){assert.equal(owner,meta);owner=null;released++;}};};
 const first=new Pipeline(pipelineOptions({acquireLease,createAsr:()=>{created++;return {transcribe:()=>new Promise(r=>finish=r),async cancel({jobId}){assert.equal(jobId,owner.jobId);}};}}));
 const second=new Pipeline(pipelineOptions({acquireLease,createAsr:()=>{created++;assert.fail('must not create a second process');}}));
 const pending=first.process(voice());await until(()=>finish);const activeOwner=owner;
 await assert.rejects(second.process(voice()),{code:'busy'});await second.close();assert.equal(owner,activeOwner);assert.equal(created,1);assert.equal(released,0);
 finish('主人语音夹具');assert.equal((await pending).outcome,'transcribed');assert.equal(owner,null);assert.equal(released,1);
});
test('uncertain worker exit retains lease and busy gate; explicit close retries that exact job',async()=>{
 let canExit=false,releases=0,cancels=0;
 const p=new Pipeline(pipelineOptions({createAsr:()=>({async transcribe(){throw Object.assign(Error(),{code:'asr_exit_unconfirmed'});},async cancel({jobId}){assert.match(jobId,/^[0-9a-f-]{36}$/);cancels++;if(!canExit)throw Error();}}),acquireLease:async()=>({assertCurrent(){},release(){releases++;}})}));
 await assert.rejects(p.process(event()),{code:'asr_exit_unconfirmed'});assert.equal(p.busy,true);assert.equal(releases,0);await assert.rejects(p.process(event()),{code:'busy'});
 canExit=true;await p.close();assert.equal(p.busy,false);assert.equal(releases,1);assert.equal(cancels,2);
});
test('close during asynchronous lease acquisition never creates ASR and releases late own lease',async()=>{
 let grant,releases=0,closed=false;
 const p=new Pipeline(pipelineOptions({acquireLease:()=>new Promise(r=>grant=r),createAsr:()=>assert.fail('closed before ASR creation')}));
 const result=p.process(event());result.catch(()=>{});await until(()=>grant);const close=p.close().then(()=>closed=true);await new Promise(r=>setImmediate(r));assert.equal(closed,false);
 grant({assertCurrent(){},release(){releases++;}});await close;await assert.rejects(result,{code:'cancelled'});assert.equal(releases,1);assert.equal(p.busy,false);
});
test('lease release failure is reported and retained for explicit cleanup, not silently unlocked',async()=>{
 let canRelease=false,releases=0;
 const p=new Pipeline(pipelineOptions({acquireLease:async()=>({assertCurrent(){},release(){releases++;if(!canRelease)throw Error('private error');}})}));
 await assert.rejects(p.process(event()),error=>error.code==='asr_cleanup_unconfirmed'&&!error.message.includes('private'));assert.equal(p.busy,true);
 canRelease=true;await p.close();assert.equal(p.busy,false);assert.equal(releases,2);
});
test('async lease guard is rejected before spawn and releases only its own lease',async()=>{
 let released=0;
 const p=new Pipeline(pipelineOptions({acquireLease:async()=>({async assertCurrent(){throw Error('private');},release(){released++;}}),createAsr:()=>assert.fail('asynchronous guard cannot prove current scope')}));
 await assert.rejects(p.process(event()),{code:'invalid_config'});assert.equal(released,1);assert.equal(p.busy,false);
});
test('wrong job cancellation never kills current ASR; missing job cannot start a worker',async()=>{
 let child,opId,kills=0;const newer='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 const asr=fakeAsr(()=>{child=fakeProcess({onInput(row){opId=row.id;}});const kill=child.kill;child.kill=()=>{kills++;return kill();};return child;});
 await assert.rejects(asr.transcribe({pcm:Buffer.alloc(8000),sampleRate:16000},{jobId:undefined}),{code:'invalid_config'});
 const result=asr.transcribe({pcm:Buffer.alloc(8000),sampleRate:16000},{jobId:newer});await until(()=>opId);await assert.rejects(asr.cancel({jobId:JOB}),{code:'wrong_scope'});assert.equal(kills,0);
 child.stdout.write(JSON.stringify({id:opId,event:'transcript',text:'current'})+'\n');child.emit('close',0);assert.equal(await result,'current');assert.equal(asr.busy,false);
});
test('spawn failure without PID does not leave a false process gate',async()=>{
 const asr=fakeAsr(()=>{const child=fakeProcess();delete child.pid;queueMicrotask(()=>child.emit('error',Object.assign(Error('PRIVATE'),{code:'ENOENT'})));return child;});
 await assert.rejects(asr.transcribe({pcm:Buffer.alloc(8000),sampleRate:16000}),error=>error.code==='asr_unavailable'&&!error.message.includes('PRIVATE'));assert.equal(asr.busy,false);
});
test('invalid signal is rejected before allocating a process, connection or operation gate',async()=>{
 const asr=fakeAsr(()=>assert.fail('no process')),p=new Pipeline(pipelineOptions());
 await assert.rejects(asr.transcribe({pcm:Buffer.alloc(8000),sampleRate:16000},{signal:{}}),{code:'invalid_config'});assert.equal(asr.busy,false);
 await assert.rejects(p.process(event(),{signal:{}}),{code:'invalid_config'});assert.equal(p.busy,false);
 const reader=new OwnerRecordReader({WebSocket:()=>assert.fail('no connection')});await assert.rejects(reader.read(voice(),{url:'ws://127.0.0.1:3001/',token:TOKEN,signal:{}}),{code:'invalid_config'});
});
test('failed exit retains exact-job recovery in the shared gate; stale recovery cannot cancel a new owner',async()=>{
 const {AsrGate}=require('../src/voice/asr-gate.cjs'),gate=new AsrGate();
 let canExit=false,recovery,cancels=0,job;
 const p=new Pipeline(pipelineOptions({
  acquireLease:meta=>{job=meta.jobId;const lease=gate.acquire(meta);return {...lease,retainRecovery:callback=>{recovery=callback;lease.retainRecovery(callback);}};},
  createAsr:()=>({async transcribe(){return 'synthetic';},async cancel({jobId}){assert.equal(jobId,job);cancels++;if(!canExit)throw Error('private');}})
 }));
 await assert.rejects(p.process(event()),{code:'asr_exit_unconfirmed'});
 assert.equal(typeof recovery,'function');assert.equal(p.busy,true);assert(gate.owner);
 await assert.rejects(gate.retryCleanup(),{code:'asr_exit_unconfirmed'});assert(gate.owner);
 canExit=true;await gate.retryCleanup();assert.equal(gate.owner,null);assert.equal(p.busy,false);assert.equal(cancels,3);
 const newer=gate.acquire({scopeId:'another-owner',jobId:'another-job'}),current=gate.owner;
 await recovery();assert.equal(gate.owner,current);assert.equal(cancels,3);newer.release();
});
test('successful cleanup never installs a recovery callback that could evict active recognition',async()=>{
 let retained=0,released=0;
 const p=new Pipeline(pipelineOptions({acquireLease:()=>({assertCurrent(){},release(){released++;},retainRecovery(){retained++;}})}));
 assert.equal((await p.process(event())).outcome,'transcribed');assert.equal(released,1);assert.equal(retained,0);assert.equal(p.busy,false);
});
