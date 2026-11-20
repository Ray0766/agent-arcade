'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {QQClient}=require('../src/bot/qq.cjs');
const {GroupImageReader,GROUP_IMAGE_AGE_MS}=require('../src/bot/qq-group-image.cjs');

const ACCOUNT='87654321', OWNER='12345678', MEMBER='44443333', OTHER_MEMBER='33334444';
const GROUP='55556666', OTHER_GROUP='77778888';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1FcAAAAASUVORK5CYII=','base64');
const URL='https://multimedia.nt.qq.com.cn/download?appid=1406&fileid=fixture_group_A&rkey=short_fixture';
const text=value=>({type:'text',data:{text:value}});
const mention=qq=>({type:'at',data:{qq}});
const quote=id=>({type:'reply',data:{id,user_id:ACCOUNT}});
const image=url=>({type:'image',data:{file:'fixture.png',file_size:String(PNG.length),url:url??URL}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));

class Socket extends EventEmitter{
 constructor(answer){super();this.answer=answer;this.readyState=0;queueMicrotask(()=>{this.readyState=1;this.emit('open');});}
 send(raw,callback){
  const call=JSON.parse(raw);callback?.();
  const data=this.answer(call);
  if(data!==undefined)this.frame({echo:call.echo,status:'ok',retcode:0,data});
 }
 frame(value){this.emit('message',JSON.stringify(value),false);}
 terminate(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
 ping(){this.emit('pong');}
}

async function fixture(t,{groupImageIds=[GROUP],allowOwnerImage=false}={}){
 const sockets=[],lookups=new Map(),calls=[],downloads=[];
 const state={now:1800000000000,account:ACCOUNT,read:options=>({bytes:Buffer.from(PNG),resourceDigest:options.expectedResourceDigest})};
 const client=new QQClient({url:'ws://127.0.0.1:3001/',token:'fixture-group-reader-token',ownerId:OWNER,expectedAccountId:ACCOUNT,
   groupIds:[GROUP,OTHER_GROUP],groupImageIds,allowOwnerImage,now:()=>state.now,pollTimeoutMs:2,timeoutMs:200,
   socketFactory:()=>{
    const socket=new Socket(call=>{
     calls.push(call);
     if(call.action==='get_login_info')return {user_id:state.account};
     if(call.action==='get_status')return {online:true,good:true};
     if(call.action==='get_msg')return lookups.get(call.params.message_id);
     throw Error(`Unexpected action ${call.action}`);
    });
    sockets.push(socket);return socket;
   }});
 t.after(()=>client.close());await client.connect();
 const reader=new GroupImageReader({createDownloader:()=>({
  download:(url,options)=>{downloads.push(url);options.assertCurrent();return state.read(options);},close:()=>{},
 })});
 const emit=async (message,patch={})=>{
  const frame={post_type:'message',message_type:'group',sub_type:'normal',self_id:ACCOUNT,group_id:GROUP,
    user_id:MEMBER,sender:{user_id:MEMBER},message_id:41,time:state.now/1000,message,...patch};
  if(!lookups.has(String(frame.message_id)))lookups.set(String(frame.message_id),frame);
  sockets.at(-1).frame(frame);
  const {messages}=await client.getUpdates();return messages[0];
 };
 return {client,sockets,state,calls,downloads,lookups,emit,read:(message,signal)=>reader.read(client,message,{signal,assertCurrent:()=>{}})};
}

test('enabled group inline image uses its observed member and exact get_msg, even when QQ refreshes the URL key',async t=>{
 const f=await fixture(t);
 const incoming=await f.emit([mention(ACCOUNT),image(),text('你能看看吗？')]);
 assert.equal(incoming.mentioned,true);
 assert.equal(incoming.text,'你能看看吗？');
 assert.equal(incoming.image.kind,'qq-group-image');
 assert(Object.isFrozen(incoming.image));
 assert.doesNotMatch(JSON.stringify(incoming.image),/fixture\.png|rkey|short_fixture|https/);
 const changed=URL.replace('short_fixture','new_fixture');
 f.lookups.set('41',{...f.lookups.get('41'),message:[mention(ACCOUNT),image(changed),text('你能看看吗？')]});
 const bytes=await f.read(incoming);assert(bytes.equals(PNG));bytes.fill(0);
 assert.deepEqual(f.downloads,[changed]);
 assert.deepEqual(f.calls.filter(call=>call.action==='get_msg').map(call=>call.params.message_id),['41','41']);
 assert.equal(await f.emit([mention(ACCOUNT),image(),text('你能看看吗？')]),undefined);
 });

test('quote binds an observed same-group image, never an unobserved, expired, forgotten or reconnected source',async t=>{
 const f=await fixture(t,{groupImageIds:[GROUP,OTHER_GROUP]});
 await f.emit([image(),text('这是图的原说明')]);
 const crossGroup={group_id:OTHER_GROUP,user_id:OTHER_MEMBER,sender:{user_id:OTHER_MEMBER}};
 const quoting={user_id:OTHER_MEMBER,sender:{user_id:OTHER_MEMBER},message_id:43};
 const quoted=await f.emit([quote(41),text('刚才这张图是什么？')],quoting);
 assert.equal(quoted.image.kind,'qq-group-quote-image');
 assert.equal(quoted.image.senderId,OTHER_MEMBER);
 assert.equal(quoted.image.source.senderId,MEMBER);
 assert.equal(quoted.text,'刚才这张图是什么？');
 assert.equal(quoted.addressing.reference,'other');
 assert.deepEqual(await f.read(quoted),PNG);
 assert.deepEqual(f.calls.filter(call=>call.action==='get_msg').map(call=>call.params.message_id),['43','41','43','41']);
 const other=await f.emit([quote(41),text('跨群碰巧相同编号')],{...crossGroup,message_id:44});
 assert.equal(other.image,undefined);
 assert.equal((await f.emit([quote(777),text('未观察过')],{message_id:45})).image,undefined);
 f.client.clearGroupImageReferences(GROUP);
 assert.equal((await f.emit([quote(41),text('忘记后再问')],{message_id:46})).image,undefined);
 await assert.rejects(f.read(quoted),{code:'wrong_scope'});
 await f.emit([image()],{message_id:47});
 f.state.now+=GROUP_IMAGE_AGE_MS+1000;
 assert.equal((await f.emit([quote(47),text('过期后再问')],{message_id:48})).image,undefined);
 await f.emit([image()],{message_id:49});
 f.sockets.at(-1).terminate();await f.client.connect();
 assert.equal((await f.emit([quote(49),text('重连后再问')],{message_id:50})).image,undefined);
 });

test('invalid group framing and a changed group, member or source reject before downloading',async t=>{
 const f=await fixture(t);
 assert.equal(await f.emit([image()],{message_id:37,anonymous:{flag:'fixture'}}),undefined);
 assert.equal(await f.emit([image()],{message_id:38,sub_type:'notice'}),undefined);
 assert.equal(await f.emit([image()],{message_id:39,sender:{user_id:OTHER_MEMBER}}),undefined);
 assert.equal((await f.emit([image('https://example.invalid/a.png')],{message_id:40})).unsupported,'qq_group_image');
 const incoming=await f.emit([mention(ACCOUNT),image(),text('当前说明')]);
 await assert.rejects(f.read({...incoming,groupId:OTHER_GROUP}),{code:'wrong_scope'});
 await assert.rejects(f.read({...incoming,from:OTHER_MEMBER}),{code:'wrong_scope'});
 for(const changed of [{group_id:OTHER_GROUP},{sender:{user_id:OTHER_MEMBER}},{message_type:'private'},
  {message:[mention(OTHER_MEMBER),image(),text('当前说明')]},{message:[mention(ACCOUNT),image(URL.replace('fixture_group_A','other_group_A')),text('当前说明')]}]){
  const before=f.lookups.get('41');f.lookups.set('41',{...before,...changed});
  await assert.rejects(f.read(incoming),{code:'message_changed'});
  f.lookups.set('41',before);
 }
 assert.deepEqual(f.downloads,[]);
 });

test('stop, forget or disconnect aborts a held download and wipes late bytes',async t=>{
 for(const operation of ['stop','forget','disconnect'])await t.test(operation,async t=>{
  const f=await fixture(t),incoming=await f.emit([image()]);
  let entered,finish;const started=new Promise(resolve=>{entered=resolve;});
  const returned=Buffer.from(PNG);
  f.state.read=options=>new Promise(resolve=>{finish=()=>resolve({bytes:returned,resourceDigest:options.expectedResourceDigest});entered();});
  const abort=new AbortController();
  const receipt=f.read(incoming,abort.signal);await started;
  if(operation==='stop')abort.abort();
  else if(operation==='forget')f.client.clearGroupImageReferences(GROUP);
  else f.sockets.at(-1).terminate();
  await assert.rejects(receipt,{code:'cancelled'});
  finish();await settle();assert(returned.every(byte=>byte===0));
  assert.equal(f.client.groupImageReads.size,0);
 });
 });

test('group image enablement leaves owner-private image reception under its separate switch',async t=>{
 const f=await fixture(t,{allowOwnerImage:true});
 assert.equal((await f.emit([mention(ACCOUNT),image(),text('不接收群图片')],{group_id:OTHER_GROUP})).image,undefined);
 const privateImage=await f.emit([image(),text('还是只收这个主人')],{message_type:'private',sub_type:'friend',group_id:undefined,
   user_id:OWNER,sender:{user_id:OWNER},message_id:42});
 assert.equal(privateImage.image.kind,'qq-owner-image');
 assert.equal(privateImage.text,'还是只收这个主人');
 await assert.rejects(f.read(privateImage),{code:'wrong_scope'});
 });

test('a post-download account or source change withholds and wipes the acquired bytes',async t=>{
 for(const change of ['account','source'])await t.test(change,async t=>{
  const f=await fixture(t),incoming=await f.emit([image()]);
  const returned=Buffer.from(PNG);
  f.state.read=options=>{
   if(change==='account')f.state.account='87654322';
   else f.lookups.set('41',{...f.lookups.get('41'),group_id:OTHER_GROUP});
   return {bytes:returned,resourceDigest:options.expectedResourceDigest};
  };
  await assert.rejects(f.read(incoming),{code:change==='account'?'account_mismatch':'message_changed'});
  assert(returned.every(byte=>byte===0));
  assert.equal(f.downloads.length,1);
 });
});
