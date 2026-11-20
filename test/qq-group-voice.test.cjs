'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createHash}=require('node:crypto');
const {QQClient}=require('../src/bot/qq.cjs');
const {GroupRecordReader,groupVoiceSource}=require('../src/bot/qq-group-voice.cjs');

const ACCOUNT='87654321', OWNER='12345678', MEMBER='44443333', OTHER_MEMBER='33334444';
const GROUP='55556666', OTHER_GROUP='77778888', NOW=1800000000000;
const mention=qq=>({type:'at',data:{qq}});
const text=value=>({type:'text',data:{text:value}});
const wav=Buffer.alloc(44+8000,0);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
wav.writeInt16LE(157,44);
const inline=(bytes=wav)=>({type:'record',data:{file:'fixture.wav',file_size:String(bytes.length),base64:bytes.toString('base64')}});
const llbotRecord={type:'record',data:{file:'fixture.amr',file_size:'256',url:'https://unused.invalid/download',path:'/never-read/fixture.amr'}};

class Socket extends EventEmitter{
 constructor(answer){super();this.answer=answer;this.readyState=0;queueMicrotask(()=>{this.readyState=1;this.emit('open');});}
 send(raw,callback){
  const call=JSON.parse(raw);callback?.();
  const data=this.answer(call);
  if(data!==undefined)this.frame({echo:call.echo,status:'ok',retcode:0,data});
 }
 frame(value){this.emit('message',JSON.stringify(value),false);}
 terminate(){if(this.readyState!==3){this.readyState=3;this.emit('close');}}
 ping(){this.emit('pong');}
}

async function fixture(t,{groupVoiceIds=[GROUP],allowOwnerVoice=false,readerOptions}={}){
 const sockets=[],lookups=new Map(),calls=[];
 const state={account:ACCOUNT,intercept:null,converted:null};
 const client=new QQClient({url:'ws://127.0.0.1:3001/',token:'fixture-record-reader-token',ownerId:OWNER,expectedAccountId:ACCOUNT,
  groupIds:[GROUP,OTHER_GROUP],groupVoiceIds,allowOwnerVoice,now:()=>NOW,pollTimeoutMs:2,timeoutMs:200,
  socketFactory:()=>{
   const socket=new Socket(call=>{
    calls.push(call);
    if(state.intercept?.(call))return;
    if(call.action==='get_login_info')return {user_id:state.account};
    if(call.action==='get_status')return {online:true,good:true};
    if(call.action==='get_msg')return lookups.get(call.params.message_id);
    if(call.action==='get_record')return state.converted;
    throw Error(`Unexpected action ${call.action}`);
   });
   sockets.push(socket);return socket;
  }});
 t.after(()=>client.close());await client.connect();
 const reader=new GroupRecordReader(readerOptions);
 const emit=async(message,patch={})=>{
  const frame={post_type:'message',message_type:'group',sub_type:'normal',self_id:ACCOUNT,group_id:GROUP,
   user_id:MEMBER,sender:{user_id:MEMBER},message_id:41,time:NOW/1000,message,...patch};
  lookups.set(String(frame.message_id),frame);sockets.at(-1).frame(frame);
  return (await client.getUpdates()).messages[0];
 };
 return {client,state,calls,sockets,lookups,emit,read:(message,signal)=>reader.read(client,message,{signal,assertCurrent:()=>{}})};
}

test('one attached native WAV requires exact same-group get_msg and keeps mention and caption as data',async t=>{
 const f=await fixture(t);
 const input=await f.emit([mention(ACCOUNT),inline(),text('合成口述测试')]);
 assert.equal(input.mentioned,true);
 assert.deepEqual(input.addressing,{mentions:['self'],reference:'none'});
 assert.equal(input.text,'合成口述测试');
 assert.equal(input.voice.kind,'qq-group-voice');
 assert.equal(Object.isFrozen(input.voice),true);
 assert.doesNotMatch(JSON.stringify(input.voice),/fixture\.wav|base64|UklGR/);
 const audio=await f.read(input);
 assert.equal(audio.sampleRate,16000);assert.equal(audio.durationSeconds,.25);
 assert(audio.pcm.equals(wav.subarray(44)));audio.pcm.fill(0);
 assert.deepEqual(f.calls.filter(row=>row.action==='get_msg').map(row=>row.params),[{message_id:'41'}]);
 assert(!f.calls.some(row=>row.action==='get_record'));
 assert.equal(await f.emit([mention(ACCOUNT),inline(),text('合成口述测试')]),undefined);
});

test('pinned LLBot metadata cannot use converted file size, absent base64 or optional converted base64',async t=>{
 for(const enableLocalFile2Url of [false,true])await t.test(String(enableLocalFile2Url),async t=>{
  const f=await fixture(t);
  // Real LLBot 8.3.2 GetRecord chooses its first filename cache row, then
  // exports a converted file length and can optionally add the converted bytes.
  f.state.converted={file:'/never-read/decoded.wav',file_name:'decoded.wav',file_size:String(wav.length),
   ...(enableLocalFile2Url?{base64:wav.toString('base64')}:{})};
  const input=await f.emit([llbotRecord]);
  assert.equal(input.voice.sourceBytes,256);
  assert.equal(input.voice.sourceDigest,null);
  assert(wav.length>input.voice.sourceBytes);
  assert.doesNotMatch(JSON.stringify(input.voice),/fixture\.amr|https|never-read|decoded/);
  // Even a lookup with the hypothetical converted bytes cannot upgrade the
  // observed metadata-only event into proof of origin.
  if(enableLocalFile2Url)f.lookups.set('41',{...f.lookups.get('41'),message:[inline()]});
  const start=f.calls.length;
  await assert.rejects(f.read(input),{code:'source_unavailable'});
  assert.equal(f.calls.length,start,'no history, get_msg, get_record or other action for a known unavailable source');
 });
});

test('source substitution, deleted messages and cross-member or cross-group access fail before ASR',async t=>{
 const f=await fixture(t,{groupVoiceIds:[GROUP,OTHER_GROUP]});
 const input=await f.emit([inline()]);
 await assert.rejects(f.read({...input,from:OTHER_MEMBER}),{code:'wrong_scope'});
 await assert.rejects(f.read({...input,groupId:OTHER_GROUP}),{code:'wrong_scope'});
 await assert.rejects(f.read({...input,voice:{...input.voice}}),{code:'wrong_scope'});
 const original=f.lookups.get('41'),changed=Buffer.from(wav);changed.writeInt16LE(888,44);
 for(const patch of [{message_type:'private'},{group_id:OTHER_GROUP},{status:'deleted'},
   {sender:{user_id:OTHER_MEMBER}},{user_id:OTHER_MEMBER},{self_id:'87654322'},{time:NOW/1000-1},
   {message:[inline(changed)]},{message:[mention(OTHER_MEMBER),inline()]}]){
  f.lookups.set('41',{...original,...patch});
  await assert.rejects(f.read(input),{code:'message_changed'});
 }
 f.lookups.set('41',{...original,message:[{type:'record',data:{file:'fixture.wav',file_size:String(wav.length)}}]});
 await assert.rejects(f.read(input),{code:'source_unavailable'});
 f.lookups.set('41',original);
 assert((await f.read(input)).pcm.equals(wav.subarray(44)));
 assert(!f.calls.some(row=>row.action==='get_record'));
});

test('only one normal attached record in a separately opted-in group is recognized',async t=>{
 const f=await fixture(t,{allowOwnerVoice:true});
 assert.equal((await f.emit([inline()],{group_id:OTHER_GROUP,message_id:42})).voice,undefined);
 assert.equal((await f.emit([inline(),inline()],{message_id:43})).unsupported,'qq_group_voice');
 assert.equal((await f.emit([inline(),{type:'file',data:{file:'fixture'}}],{message_id:44})).unsupported,'qq_group_voice');
 assert.equal((await f.emit([inline(),{type:'reply',data:{id:99}}],{message_id:45})).unsupported,'qq_group_voice');
 assert.equal((await f.emit([{type:'record',data:{file:'fixture.wav',file_size:'256',base64:wav.toString('base64')}}],{message_id:46})).unsupported,'qq_group_voice');
 assert.equal(await f.emit([inline()],{anonymous:{flag:'fixture'},message_id:47}),undefined);
 const privateVoice=await f.emit([llbotRecord],{message_type:'private',sub_type:'friend',group_id:undefined,user_id:OWNER,
  sender:{user_id:OWNER},message_id:48});
 assert.equal(privateVoice.voice.kind,'qq-owner-voice');
 await assert.rejects(f.read(privateVoice),{code:'wrong_scope'});
});

test('camera-like RIFF and malformed PCM are rejected by the existing canonical WAV validator',async t=>{
 const f=await fixture(t),bad=Buffer.from(wav);bad.write('AVI ',8);
 const input=await f.emit([inline(bad)]);
 await assert.rejects(f.read(input),{code:'voice_format'});
});

test('Stop or disconnect while exact lookup is pending returns no audio; reconnection cannot recover the old capability',async t=>{
 for(const operation of ['stop','disconnect'])await t.test(operation,async t=>{
  const f=await fixture(t),input=await f.emit([inline()]);
  let entered;const lookupStarted=new Promise(resolve=>{entered=resolve;});
  f.state.intercept=call=>{if(call.action==='get_msg'){entered();return true;}return false;};
  const abort=new AbortController(),pending=f.read(input,abort.signal);
  await lookupStarted;
  if(operation==='stop')abort.abort();else f.sockets.at(-1).terminate();
  await assert.rejects(pending,{code:'aborted'});
  assert.equal(f.client.groupVoiceReads.size,0);
  if(operation==='disconnect'){
   await f.client.connect();
   await assert.rejects(f.read(input),{code:'wrong_scope'});
  }
  assert(!f.calls.some(row=>row.action==='get_record'));
 });
});

function uint32(value){
 const bytes=[];while(value>127){bytes.push((value&127)|128);value>>>=7;}bytes.push(value);
 return Buffer.from(bytes);
}
function fileId(bytes,{size=bytes.length,appid=1403,trailer=Buffer.alloc(0)}={}){
 return Buffer.concat([Buffer.from([0x12,20]),createHash('sha1').update(bytes).digest(),Buffer.from([0x18]),uint32(size),
  Buffer.from([0x20]),uint32(appid),trailer]).toString('base64url');
}
const pttUrl=(id,rkey='old_token')=>`https://multimedia.nt.qq.com.cn/download?appid=1403&fileid=${id}&rkey=${rkey}`;
const ptt=(bytes,url=pttUrl(fileId(bytes)))=>({type:'record',data:{file:'same-name.amr',file_size:String(bytes.length),url,path:'/unused/local.amr'}});
const pcmResult=marker=>{const pcm=Buffer.alloc(8000);pcm.writeInt16LE(marker);return {pcm,sampleRate:16000,durationSeconds:.25};};
const nativeRecord=(f,messageId,record,extra={})=>{
 const old=f.lookups.get(String(messageId));
 f.lookups.set(String(messageId),{...old,message:[record],status:'normal',real_id:old.message_seq,...extra});
};

test('the only accepted CDN links bind a bounded 1403 FileIdInfo to the voice origin and tolerate rkey rotation',()=>{
 const bytes=Buffer.alloc(256,17),id=fileId(bytes),good=pttUrl(id);
 const source=groupVoiceSource(good);
 assert.equal(source.sourceBytes,256);assert.equal(source.sha1,createHash('sha1').update(bytes).digest('hex'));
 assert.equal(groupVoiceSource(pttUrl(id,'renewed%2Bvalue')).resourceDigest,source.resourceDigest);
 assert.notEqual(groupVoiceSource(pttUrl(fileId(Buffer.alloc(256,18)))).resourceDigest,source.resourceDigest);
 for(const bad of [
  good.replace('https:','http:'),good.replace('.qq.com.cn','.qq.com.cn.invalid'),good.replace('/download?','/other?'),
  good.replace('.qq.com.cn/','.qq.com.cn:443/'),good.replace('appid=1403','appid=1402'),good.replace('appid=1403','appid=%31403'),
  good+'&rkey=double',good+'&spec=0',good+'&unexpected=yes',good+'#fragment',good.replace('old_token','%00'),
  pttUrl(fileId(bytes,{appid:1402})),pttUrl(fileId(bytes,{size:0})),pttUrl(id+'='),pttUrl('not_a_file_id'),
  pttUrl(fileId(bytes,{trailer:Buffer.from([0x18,0x80,0x02])})),pttUrl(fileId(bytes,{trailer:Buffer.from([0x28,0x80,0x00])})),
 ])assert.throws(()=>groupVoiceSource(bad),{code:'voice_source_unsupported'});
});

test('same-name same-size group records resolve exact sequence and retain distinct original bytes through decoding',async t=>{
 const rawA=Buffer.alloc(256,17),rawB=Buffer.alloc(256,18),downloads=[],decodes=[],released=[];
 const blobs=new Map([[fileId(rawA),rawA],[fileId(rawB),rawB]]);
 const f=await fixture(t,{readerOptions:{createDownloader:()=>({download:async(url,options)=>{
  options.assertCurrent();downloads.push(url);assert.equal(options.expectedSourceBytes,256);
  const data=Buffer.from(blobs.get(new URL(url).searchParams.get('fileid')));released.push(data);
  return {bytes:data,resourceDigest:groupVoiceSource(url).resourceDigest};
 },close(){}}),decodeSilk:async(raw,{signal})=>{assert.equal(signal.aborted,false);decodes.push(raw[0]);return pcmResult(raw[0]);}}});
 for(const [index,raw] of [rawA,rawB].entries()){
  const messageId=51+index,record=ptt(raw),seq=10000+index;
  const input=await f.emit([record],{message_id:messageId,message_seq:String(seq),sender:{user_id:MEMBER}});
  nativeRecord(f,messageId,ptt(raw,pttUrl(fileId(raw),'rotated_token')),{real_id:seq});
  assert.equal(input.voice.fileDigest, createHash('sha256').update(JSON.stringify('same-name.amr')).digest('hex'));
  assert.equal(input.voice.sourceBytes,256);assert(input.voice.resourceDigest);
  assert.doesNotMatch(JSON.stringify(input.voice),/rkey|old_token|local\.amr|same-name\.amr|https/);
  const audio=await f.read(input);assert.equal(audio.pcm.readInt16LE(),17+index);audio.pcm.fill(0);
 }
 assert.deepEqual(decodes,[17,18]);assert.equal(downloads.length,2);
 assert(downloads.every(url=>url.endsWith('rkey=rotated_token')));
 assert(released.every(raw=>raw.every(byte=>byte===0)));
 assert.deepEqual(f.calls.filter(row=>row.action==='get_msg').map(row=>row.params.message_id),['51','51','52','52']);
 assert(!f.calls.some(row=>row.action==='get_record'));
});

test('unsupported native links, missing sequence, unsafe get_msg changes and wrong same-size bytes never reach the codec',async t=>{
 const raw=Buffer.alloc(256,17),record=ptt(raw);let decodes=0,downloads=0,fetchBytes=raw,holdAfter=null,returned;
 const f=await fixture(t,{readerOptions:{createDownloader:()=>({download:async (_url,options)=>{
  downloads++;returned=Buffer.from(fetchBytes);holdAfter?.();return {bytes:returned,resourceDigest:options.expectedResourceDigest};
 },close(){}}),decodeSilk:async()=>{decodes++;return pcmResult(17);}}});
 for(const [index,plain] of [record,ptt(raw,pttUrl(fileId(raw,{size:255}))),ptt(raw,pttUrl(fileId(raw)).replace('appid=1403','appid=1402'))].entries()){
  const input=await f.emit([plain],{message_id:61+index,...(index>0?{message_seq:500+index}:{})});
  assert.equal(input.voice.resourceDigest,null);await assert.rejects(f.read(input),{code:'source_unavailable'});
 }
 const input=await f.emit([record],{message_id:65,message_seq:503});
 const original=f.lookups.get('65');
 for(const patch of [{status:undefined},{status:'deleted'},{real_id:504},{message_seq:504},{group_id:OTHER_GROUP},
  {sender:{user_id:OTHER_MEMBER}},{message:[ptt(Buffer.alloc(256,18))]}]){
  f.lookups.set('65',original);nativeRecord(f,65,record,patch);await assert.rejects(f.read(input),{code:'message_changed'});
 }
 f.lookups.set('65',original);nativeRecord(f,65,record);
 fetchBytes=Buffer.alloc(256,18);
 await assert.rejects(f.read(input),{code:'message_changed'});
 assert(returned.every(byte=>byte===0));
 fetchBytes=raw;holdAfter=()=>nativeRecord(f,65,record,{status:'deleted'});
 await assert.rejects(f.read(input),{code:'message_changed'});
 assert(returned.every(byte=>byte===0));
 assert.equal(downloads,2);assert.equal(decodes,0);
});

test('Stop before a late linked recording download completes discards and wipes the returned media',async t=>{
 const raw=Buffer.alloc(256,18),record=ptt(raw);
 let entered,finish,decodes=0,returned;
 const started=new Promise(resolve=>{entered=resolve;});
 const f=await fixture(t,{readerOptions:{createDownloader:()=>({download:async (_url,options)=>{
  entered();await new Promise(resolve=>{finish=resolve;});returned=Buffer.from(raw);
  return {bytes:returned,resourceDigest:options.expectedResourceDigest};
 },close(){}}),decodeSilk:async()=>{decodes++;return pcmResult(18);}}});
 const input=await f.emit([record],{message_id:71,message_seq:601});nativeRecord(f,71,record);
 const controller=new AbortController(),pending=f.read(input,controller.signal);await started;
 controller.abort();await assert.rejects(pending,{code:'cancelled'});
 finish();await new Promise(resolve=>setImmediate(resolve));
 assert(returned.every(byte=>byte===0));assert.equal(decodes,0);assert.equal(f.client.groupVoiceReads.size,0);
});
