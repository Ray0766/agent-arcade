'use strict';
// Actual local WS frames with synthetic identifiers; no account/audio/model access.
const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events'),{WebSocketServer}=require('ws');
const {QQClient,prepareQQInbound}=require('../src/bot/qq.cjs');
const ACCOUNT='87654321',OWNER='12345678',FILE='synthetic-cache.amr';
async function fixture(t,options={}){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  let peer;const requests=[],now=1800000000000;
  server.on('connection',socket=>{peer=socket;socket.on('message',raw=>{const req=JSON.parse(raw);requests.push(req);assert(['get_login_info','get_status'].includes(req.action));socket.send(JSON.stringify({status:'ok',retcode:0,echo:req.echo,data:req.action==='get_login_info'?{user_id:ACCOUNT}:{online:true,good:true}}));});});
  const client=new QQClient({url:`ws://127.0.0.1:${server.address().port}/`,token:'synthetic-record-client-token',ownerId:OWNER,expectedAccountId:ACCOUNT,acceptAfter:now,now:()=>now,pollTimeoutMs:1,...options});
  t.after(async()=>{client.close();for(const s of server.clients)s.terminate();await new Promise(r=>server.close(r));});await client.connect();
  const frame=(patch={})=>({post_type:'message',message_type:'private',sub_type:'friend',self_id:ACCOUNT,user_id:OWNER,message_id:11,time:now/1000,message:[{type:'record',data:{file:FILE,file_size:1024,url:'https://invalid.example/PRIVATE',path:'C:\\PRIVATE',base64:'PRIVATE_BASE64'}}],...patch});
  const send=async value=>{peer.send(JSON.stringify(value));await client._request('get_status',{});return (await client.getUpdates()).messages;};
  return {client,requests,frame,send,now};
}
test('QQ record input remains unsupported unless the fixed client opt-in is true',async t=>{
  for(const options of [{},{allowOwnerVoice:false}]){const f=await fixture(t,options),rows=await f.send(f.frame());assert.equal(rows.length,1);assert.equal(rows[0].voice,undefined);assert.equal(rows[0].unsupported,'qq_segments');assert.match(prepareQQInbound(rows[0]).rejection,/语音/);}
});
test('opt-in captures only bounded source descriptors and does not read audio or invoke a model',async t=>{
  const f=await fixture(t,{allowOwnerVoice:true}),rows=await f.send(f.frame());assert.equal(rows.length,1);
  assert.deepEqual(rows[0].voice,{kind:'qq-owner-voice',accountId:ACCOUNT,ownerId:OWNER,id:'11',createdAt:f.now,file:FILE,sourceBytes:1024});
  assert.equal(rows[0].text,'');assert.equal(rows[0].unsupported,undefined);assert.equal(rows[0].from,OWNER);assert.equal(typeof rows[0].contextToken,'string');assert.equal(Object.isFrozen(rows[0].voice),true);
  assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|https:|base64|url|path/);assert(f.requests.every(r=>['get_login_info','get_status'].includes(r.action)));
});
test('voice opt-in does not widen owner, group, time or duplicate-message filters',async t=>{
  const f=await fixture(t,{allowOwnerVoice:true});for(const patch of [{user_id:'99999999'},{message_type:'group'},{sub_type:'group'},{group_id:12345},{time:f.now/1000-1},{time:f.now/1000+61}])assert.deepEqual(await f.send(f.frame(patch)),[]);
  assert.equal((await f.send(f.frame())).length,1);assert.deepEqual(await f.send(f.frame()),[]);assert.equal(f.client.seen.size,1);
  f.client._frame(JSON.stringify(f.frame({message_id:12,self_id:'99999999'})));assert.equal(f.client.ready,false);assert.equal(f.client.queue.length,0);assert.equal(f.client.lastError.code,'account_changed');
});
test('mixed/reply/forwarded and invalid record cache keys keep the existing unsupported rejection',async t=>{
  const f=await fixture(t,{allowOwnerVoice:true});let id=20;
  const record=f.frame().message[0],cases=[[],[record,{type:'text',data:{text:'/allow PRIVATE'}}],[{type:'reply',data:{id:'1'}},record],[{type:'forward',data:{id:'1'}}],
    ...['https://invalid.example/a','file:///C:/private','C:\\private','../private','base64://AAAA','//host/private','a..amr'].map(file=>[{type:'record',data:{file,file_size:1024}}]),
    [{type:'record',data:{file:FILE}}],[{type:'record',data:{file:FILE,file_size:1048577}}],[{type:'record',data:{file:FILE,file_size:1024,magic:1}}]];
  for(const message of cases){const rows=await f.send(f.frame({message_id:id++,message}));assert.equal(rows.length,1);assert.equal(rows[0].voice,undefined);assert.equal(rows[0].unsupported,'qq_segments');assert.equal(rows[0].text,'');assert.doesNotMatch(JSON.stringify(rows),/PRIVATE|https:|base64|private/);}
});
test('text and quoted text remain ordinary owner messages with the voice opt-in',async t=>{
  const f=await fixture(t,{allowOwnerVoice:true}),rows=await f.send(f.frame({message:[{type:'reply',data:{id:'1'}},{type:'text',data:{text:'Synthetic text'}}]}));
  assert.equal(rows[0].text,'Synthetic text');assert.equal(rows[0].quote.id,'1');assert.equal(rows[0].voice,undefined);
});
test('voice option cannot be enabled by truthy strings or objects',()=>{
  for(const allowOwnerVoice of ['true',1,{},null])assert.throws(()=>new QQClient({token:'synthetic-record-client-token',ownerId:OWNER,allowOwnerVoice}),{code:'invalid_input'});
});
