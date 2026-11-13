'use strict';
// Real loopback WebSocket transport, synthetic accounts and API data only.
// These checks never connect to QQ/NapCat or exercise Tencent login.
const test=require('node:test'),assert=require('node:assert/strict');
const {once,EventEmitter}=require('node:events');
const {WebSocket,WebSocketServer}=require('ws');
const {QQDirectoryReader}=require('../src/bot/qq-directory.cjs');
const ACCOUNT='12345001',OTHER='12345002',TOKEN='synthetic-directory-token';
async function fixture(t,{kind='friends',rows=[],intercept,timeoutMs=1500,maxPayload}={}){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const state={calls:[],connections:0,closed:0,account:ACCOUNT,online:true};
  t.after(async()=>{for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
  server.on('connection',(socket,request)=>{
    state.connections++;assert.equal(request.headers.authorization,`Bearer ${TOKEN}`);socket.on('close',()=>state.closed++);
    socket.on('message',raw=>{
      const call=JSON.parse(raw);state.calls.push(call);
      const reply=(data,extra={})=>socket.send(JSON.stringify({status:'ok',retcode:0,echo:call.echo,data,...extra}));
      if(intercept?.({socket,call,state,reply}))return;
      if(call.action==='get_login_info')reply({user_id:Number(state.account),nickname:'not returned'});
      else if(call.action==='get_status')reply({online:state.online,good:true});
      else if(call.action==='get_friend_list'||call.action==='get_group_list')reply(rows);
      else assert.fail('Unexpected action; the directory reader must be read-only.');
    });
  });
  const reader=new QQDirectoryReader({timeoutMs,...(maxPayload?{maxPayload}:{})});
  const options={kind,url:`ws://127.0.0.1:${server.address().port}/`,token:TOKEN,expectedAccountId:ACCOUNT};
  return {reader,options,state,server};
}
async function closed(state){for(let i=0;i<50&&state.closed!==state.connections;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(state.closed,state.connections);}
test('friends are projected only after two exact identity and online checks, then the socket closes',async t=>{
  const f=await fixture(t,{rows:[{user_id:12345678,nickname:'好友\u202e昵称',remark:'备注',avatar:'private',phone:'PRIVATE_NOT_RETURNED',message:'PRIVATE_NOT_RETURNED'}]});
  const before=Date.now(),result=await f.reader.read(f.options);
  assert.deepEqual(result.items,[{id:'12345678',nickname:'好友昵称',remark:'备注'}]);assert.equal(result.kind,'friends');assert.equal(result.accountId,ACCOUNT);assert.equal(result.source,'bridge-cache');assert(Date.parse(result.fetchedAt)>=before);
  assert.deepEqual(f.state.calls.map(x=>x.action),['get_login_info','get_status','get_friend_list','get_login_info','get_status']);assert.deepEqual(f.state.calls[2].params,{no_cache:false});assert.doesNotMatch(JSON.stringify(result),/PRIVATE|token|avatar|phone/);await closed(f.state);
});
test('groups preserve only bounded names and optional counts; fresh is a cache hint, not a source guarantee',async t=>{
  const f=await fixture(t,{kind:'groups',rows:[{group_id:'76543210',group_name:'群名',member_count:42,max_member_count:200,owner_id:99999999},{group_id:76543211,group_name:'小组'}]});
  const result=await f.reader.read({...f.options,fresh:true});assert.deepEqual(result.items,[{id:'76543210',name:'群名',memberCount:42,maxMemberCount:200},{id:'76543211',name:'小组'}]);assert.equal(result.source,'bridge-cache');assert.deepEqual(f.state.calls[2].params,{no_cache:true});assert.equal(f.state.calls[2].action,'get_group_list');await closed(f.state);
});
test('empty lists are successful and missing display names are empty text',async t=>{
  const f=await fixture(t);assert.deepEqual((await f.reader.read(f.options)).items,[]);
  const g=await fixture(t,{rows:[{user_id:'12345678'}]});assert.deepEqual((await g.reader.read(g.options)).items,[{id:'12345678',nickname:'',remark:''}]);
});
test('invalid IDs, duplicate IDs, nonarrays and wrong field types are rejected without returning partial lists',async t=>{
  for(const rows of [null,{},[{user_id:'12345678'},{user_id:12345678}],[{user_id:'00123456'}],[{user_id:'9007199254740992'}],[{user_id:'12345678',nickname:{message:'PRIVATE'}}],[{user_id:'12345678',remark:null}],[[]]]){
    const f=await fixture(t,{rows});await assert.rejects(f.reader.read(f.options),{code:'invalid_response'});assert.equal(f.state.calls.length,3);await closed(f.state);
  }
  for(const value of [-1,1.5,null,'12',Number.MAX_SAFE_INTEGER+1]){const f=await fixture(t,{kind:'groups',rows:[{group_id:12345678,group_name:'fixture',member_count:value}]});await assert.rejects(f.reader.read(f.options),{code:'invalid_response'});}
});
test('more than 10000 entries is rejected and text projection never exceeds 500 UTF-16 units',async t=>{
  const f=await fixture(t,{rows:Array.from({length:10001},(_,i)=>({user_id:12345000+i}))});await assert.rejects(f.reader.read(f.options),{code:'response_too_large'});
  const g=await fixture(t,{rows:[{user_id:12345678,nickname:'a'.repeat(499)+'😀tail',remark:'x'.repeat(900)}]});const item=(await g.reader.read(g.options)).items[0];assert.equal(item.nickname,'a'.repeat(499));assert.equal(item.remark.length,500);
});
test('first wrong account is refused before directory reads; a switch after the list discards it',async t=>{
  const f=await fixture(t);f.state.account=OTHER;await assert.rejects(f.reader.read(f.options),{code:'account_mismatch'});assert.deepEqual(f.state.calls.map(x=>x.action),['get_login_info']);
  const g=await fixture(t,{intercept:({call,state,reply})=>{if(call.action==='get_friend_list'){state.account=OTHER;reply([{user_id:12345678}]);return true;}}});await assert.rejects(g.reader.read(g.options),{code:'account_changed'});assert.equal(g.state.calls.length,4);await closed(g.state);
});
test('offline or unverified status before or after list retrieval never returns a directory',async t=>{
  const f=await fixture(t);f.state.online=false;await assert.rejects(f.reader.read(f.options),{code:'account_offline'});assert.equal(f.state.calls.length,2);
  const g=await fixture(t,{intercept:({call,state})=>{if(call.action==='get_friend_list')state.online=false;}});await assert.rejects(g.reader.read(g.options),{code:'account_offline'});assert.equal(g.state.calls.length,5);
  for(const status of [{},null,{online:'true'},{online:true,good:1}]){const h=await fixture(t,{intercept:({call,reply})=>{if(call.action==='get_status'){reply(status);return true;}}});await assert.rejects(h.reader.read(h.options),{code:'status_unverified'});}
});
test('pushed chat events and mismatching echoes cannot answer a pending request',async t=>{
  const f=await fixture(t,{intercept:({socket,call,reply})=>{
    if(call.action==='get_friend_list'){
      socket.send(JSON.stringify({post_type:'message',message:'PRIVATE_CHAT_NOT_RETURNED',echo:call.echo,status:'ok',retcode:0,data:[{user_id:11111111}]}));
      socket.send(JSON.stringify({echo:'stale',status:'ok',retcode:0,data:[{user_id:22222222}]}));reply([{user_id:12345678,nickname:'correct'}]);return true;
    }
  }});const result=await f.reader.read(f.options);assert.equal(result.items[0].id,'12345678');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_CHAT/);assert.equal(f.state.calls.length,5);
});
test('binary, oversized and malformed frames fail with fixed codes, not raw payloads',async t=>{
  for(const [payload,options,code]of [[Buffer.from('PRIVATE_BINARY'),{binary:true},'invalid_response'],['x'.repeat(2048),{binary:false},'response_too_large'],['PRIVATE_BAD_JSON',{binary:false},'invalid_response']]){
    const f=await fixture(t,{maxPayload:1024,intercept:({socket,call})=>{if(call.action==='get_friend_list'){socket.send(payload,options);return true;}}});
    await assert.rejects(f.reader.read(f.options),error=>error.code===code&&!error.message.includes('PRIVATE'));await closed(f.state);
  }
});
test('bridge errors stay private and no action is retried after failure or timeout',async t=>{
  const f=await fixture(t,{intercept:({call,reply})=>{if(call.action==='get_friend_list'){reply(null,{status:'failed',retcode:500,message:'PRIVATE_BACKEND_SECRET',wording:TOKEN});return true;}}});
  await assert.rejects(f.reader.read(f.options),error=>error.code==='action_failed'&&!error.message.includes('PRIVATE')&&!error.message.includes(TOKEN));assert.equal(f.state.connections,1);assert.equal(f.state.calls.filter(x=>x.action==='get_friend_list').length,1);
  const g=await fixture(t,{timeoutMs:40,intercept:({call})=>call.action==='get_friend_list'});await assert.rejects(g.reader.read(g.options),{code:'timeout'});await closed(g.state);assert.equal(g.state.connections,1);assert.equal(g.state.calls.length,3);
});
test('aborting before connect or during a response closes only that read and permits a separate read',async t=>{
  let blocked=true;const f=await fixture(t,{intercept:({call})=>blocked&&call.action==='get_friend_list'}),controller=new AbortController();controller.abort();await assert.rejects(f.reader.read({...f.options,signal:controller.signal}),{code:'cancelled'});assert.equal(f.state.connections,0);
  const active=new AbortController(),reading=f.reader.read({...f.options,signal:active.signal});for(let i=0;i<50&&f.state.calls.length<3;i++)await new Promise(resolve=>setTimeout(resolve,2));active.abort();await assert.rejects(reading,{code:'cancelled'});await closed(f.state);blocked=false;
  const result=await f.reader.read(f.options);assert.deepEqual(result.items,[]);await closed(f.state);assert.equal(f.state.connections,2);
});
test('two concurrent reads use isolated sockets and aborting one does not cancel the other',async t=>{
  const f=await fixture(t,{intercept:({call,reply})=>{
    if(call.action==='get_friend_list')return true;
    if(call.action==='get_group_list'){setTimeout(()=>reply([{group_id:76543210,group_name:'separate read'}]),20);return true;}
  }}),controller=new AbortController();
  const friends=f.reader.read({...f.options,signal:controller.signal}),groups=f.reader.read({...f.options,kind:'groups'});
  for(let i=0;i<50&&!f.state.calls.some(call=>call.action==='get_friend_list');i++)await new Promise(resolve=>setTimeout(resolve,2));controller.abort();
  await assert.rejects(friends,{code:'cancelled'});assert.deepEqual((await groups).items,[{id:'76543210',name:'separate read'}]);assert.equal(f.state.connections,2);await closed(f.state);
});
test('transport failures and unsafe configuration never expose raw errors or contact non-loopback hosts',async t=>{
  const f=await fixture(t),reader=f.reader;
  for(const patch of [{url:undefined},{url:'ws://example.com:3001/'},{url:'ws://127.0.0.1:3001/?token=private'},{url:'ws://localhost:3001/'},{expectedAccountId:'abc'},{token:'bad\r\nheader'},{kind:'messages'},{fresh:'true'}])await assert.rejects(reader.read({...f.options,...patch}),{code:'invalid_config'});
  assert.equal(f.state.connections,0);
  const errorReader=new QQDirectoryReader({WebSocket:class {constructor(){throw Error('PRIVATE_TRANSPORT_ERROR');}}});await assert.rejects(errorReader.read(f.options),error=>error.code==='connection_failed'&&!error.message.includes('PRIVATE'));
  const g=await fixture(t,{intercept:({socket,call})=>{if(call.action==='get_friend_list'){socket.terminate();return true;}}});await assert.rejects(g.reader.read(g.options),{code:'connection_failed'});
});
test('the short socket disables redirects and compression, uses a bounded payload and cleans up on handshake abort',async()=>{
  const controller=new AbortController();let socket,settings;
  class Pending extends EventEmitter {constructor(url,options){super();socket=this;settings=options;this.readyState=0;}send(){assert.fail('Must not send before open.');}terminate(){this.readyState=3;this.emit('close');}}
  const reader=new QQDirectoryReader({WebSocket:Pending,timeoutMs:100,maxPayload:2048});const pending=reader.read({kind:'friends',url:'ws://127.0.0.1:3001/',token:TOKEN,expectedAccountId:ACCOUNT,signal:controller.signal});controller.abort();await assert.rejects(pending,{code:'cancelled'});
  assert.equal(socket.readyState,3);assert.equal(socket.listenerCount('message'),0);assert.equal(settings.maxPayload,2048);assert.equal(settings.followRedirects,false);assert.equal(settings.perMessageDeflate,false);assert.equal(settings.handshakeTimeout,100);
});
test('unauthorized handshake is a fixed error and never retries or follows redirects',async()=>{
  let creates=0,destroyed=false;
  class Unauthorized extends EventEmitter {constructor(){super();creates++;queueMicrotask(()=>this.emit('unexpected-response',{}, {statusCode:401,destroy:()=>{destroyed=true;}}));}send(){assert.fail('Must not send before authentication.');}terminate(){this.emit('close');}}
  const reader=new QQDirectoryReader({WebSocket:Unauthorized});await assert.rejects(reader.read({kind:'friends',url:'ws://127.0.0.1:3001/',token:TOKEN,expectedAccountId:ACCOUNT}),{code:'unauthorized'});assert.equal(creates,1);assert(destroyed);
});
