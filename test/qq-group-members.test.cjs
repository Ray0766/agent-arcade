'use strict';
// Real local WebSocket transport with synthetic accounts and directories only.
const test=require('node:test'),assert=require('node:assert/strict');
const {once,EventEmitter}=require('node:events');
const {WebSocketServer}=require('ws');
const {QQGroupMembersReader}=require('../src/bot/qq-group-members.cjs');
const ACCOUNT='12345001',OTHER='12345002',GROUP='76543210',OTHER_GROUP='76543211',TOKEN='synthetic-members-token';
const member=(patch={})=>({group_id:GROUP,user_id:'23456001',nickname:'Synthetic friend',card:'Synthetic card',role:'member',...patch});
async function fixture(t,{groups=[{group_id:GROUP}],members=[member()],intercept,timeoutMs=1500,maxPayload}={}){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const state={calls:[],connections:0,closed:0,account:ACCOUNT,online:true,groups};
  t.after(async()=>{for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
  server.on('connection',(socket,request)=>{
    state.connections++;assert.equal(request.headers.authorization,`Bearer ${TOKEN}`);socket.on('close',()=>state.closed++);
    socket.on('message',raw=>{
      const call=JSON.parse(raw);state.calls.push(call);
      const reply=(data,extra={})=>{if(socket.readyState===1)socket.send(JSON.stringify({status:'ok',retcode:0,echo:call.echo,data,...extra}));};
      if(intercept?.({socket,call,state,reply}))return;
      if(call.action==='get_login_info')reply({user_id:Number(state.account),nickname:'PRIVATE_IDENTITY'});
      else if(call.action==='get_status')reply({online:state.online,good:true});
      else if(call.action==='get_group_list')reply(state.groups);
      else if(call.action==='get_group_member_list')reply(members);
      else assert.fail('No send, management or arbitrary OneBot action is allowed.');
    });
  });
  return {reader:new QQGroupMembersReader({timeoutMs,...(maxPayload?{maxPayload}:{})}),
    options:{url:`ws://127.0.0.1:${server.address().port}/`,token:TOKEN,expectedAccountId:ACCOUNT,groupId:GROUP},state,server};
}
async function closed(state){for(let i=0;i<100&&state.closed!==state.connections;i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(state.closed,state.connections);}
async function until(predicate){for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,2));assert(predicate());}

test('member projection follows exact identity/status and pre/post group membership checks on one socket',async t=>{
  const f=await fixture(t,{members:[member({nickname:'名\u202e称',card:'群\n名片',role:'owner',age:22,sex:'female',area:'PRIVATE',title:'PRIVATE',phone:'PRIVATE',join_time:42})]});
  const before=Date.now(),result=await f.reader.read(f.options);
  assert.deepEqual(result,{kind:'members',accountId:ACCOUNT,groupId:GROUP,items:[{id:'23456001',nickname:'名称',card:'群名片',role:'owner'}],fetchedAt:result.fetchedAt,source:'bridge-cache'});
  assert(Date.parse(result.fetchedAt)>=before);assert.equal(f.state.connections,1);
  assert.deepEqual(f.state.calls.map(call=>call.action),['get_login_info','get_status','get_group_list','get_group_member_list','get_group_list','get_login_info','get_status']);
  assert.deepEqual(f.state.calls[2].params,{no_cache:true});assert.deepEqual(f.state.calls[3].params,{group_id:GROUP,no_cache:false});assert.deepEqual(f.state.calls[4].params,{no_cache:true});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|age|sex|phone|join_time|token/);await closed(f.state);
});

test('fresh only changes the member cache hint and never the bridge-cache source claim',async t=>{
  const f=await fixture(t);const result=await f.reader.read({...f.options,fresh:true});
  assert.deepEqual(f.state.calls[3].params,{group_id:GROUP,no_cache:true});assert.equal(result.source,'bridge-cache');await closed(f.state);
});

test('a group absent from the fresh bridge list is refused before requesting any members',async t=>{
  for(const groups of [[],[{group_id:OTHER_GROUP}]]){
    const f=await fixture(t,{groups});await assert.rejects(f.reader.read(f.options),{code:'group_not_joined'});
    assert.equal(f.state.calls.length,3);assert(!f.state.calls.some(call=>call.action==='get_group_member_list'));await closed(f.state);
  }
});

test('membership removed in the later cache observation discards the entire member result',async t=>{
  const f=await fixture(t,{intercept:({call,state})=>{if(call.action==='get_group_member_list')state.groups=[];}});
  await assert.rejects(f.reader.read(f.options),{code:'group_changed'});assert.equal(f.state.calls.length,5);await closed(f.state);
});

test('group-list validation rejects malformed, duplicate and oversized records without treating a found row as sufficient',async t=>{
  const cases=[null,{},[{group_id:GROUP},[]],[{group_id:GROUP},{group_id:Number(GROUP)}],[{group_id:GROUP},{}],[{group_id:GROUP},{group_id:'0012345'}]];
  for(const groups of cases){const f=await fixture(t,{groups});await assert.rejects(f.reader.read(f.options),{code:'invalid_response'});assert.equal(f.state.calls.length,3);}
  const f=await fixture(t,{groups:Array.from({length:10001},(_,i)=>({group_id:76543210+i}))});await assert.rejects(f.reader.read(f.options),{code:'response_too_large'});
  const g=await fixture(t,{intercept:({call,state})=>{if(call.action==='get_group_member_list')state.groups=[{group_id:GROUP},{group_id:GROUP}];}});await assert.rejects(g.reader.read(g.options),{code:'invalid_response'});assert.equal(g.state.calls.length,5);
});

test('member rows require the selected group_id, unique safe user IDs and a known exact role',async t=>{
  for(const members of [null,{},[[]],[member(),member({user_id:23456001})],[member({group_id:undefined})],[member({group_id:OTHER_GROUP})],[member({user_id:'0012345'})],[member({user_id:'9007199254740992'})],[member({user_id:1.5})],[member({role:undefined})],[member({role:'administrator'})],[member({role:'OWNER'})],[member({nickname:{secret:'PRIVATE'}})],[member({card:null})]]){
    const f=await fixture(t,{members});await assert.rejects(f.reader.read(f.options),error=>error.code==='invalid_response'&&!error.message.includes('PRIVATE'));assert.equal(f.state.calls.length,4);await closed(f.state);
  }
});

test('an empty roster is a bounded successful cache observation, and missing display text is empty',async t=>{
  const f=await fixture(t,{members:[]});assert.deepEqual((await f.reader.read(f.options)).items,[]);assert.equal(f.state.calls.length,7);
  const g=await fixture(t,{members:[member({nickname:undefined,card:undefined,role:'admin'})]});assert.deepEqual((await g.reader.read(g.options)).items,[{id:'23456001',nickname:'',card:'',role:'admin'}]);
});

test('10000 entries are permitted within the frame bound; 10001 rejects the whole roster',async t=>{
  const rows=Array.from({length:10000},(_,i)=>({group_id:GROUP,user_id:23456000+i,role:'member'}));
  const f=await fixture(t,{members:rows});const result=await f.reader.read(f.options);assert.equal(result.items.length,10000);assert.equal(result.items.at(-1).id,'23465999');
  const g=await fixture(t,{members:[...rows,member({user_id:23466000})]});await assert.rejects(g.reader.read(g.options),{code:'response_too_large'});assert.equal(g.state.calls.length,4);
});

test('display strings are bounded and cannot split surrogate pairs or retain control characters',async t=>{
  const f=await fixture(t,{members:[member({nickname:'x'.repeat(499)+'😀rest',card:'\u0000\u202e\ud800'+('😀'.repeat(251))+'tail'})]});
  const item=(await f.reader.read(f.options)).items[0];assert.equal(item.nickname,'x'.repeat(499));assert.equal(item.card,'😀'.repeat(250));
});

test('an account mismatch before reading groups and an account switch after reading members are refused',async t=>{
  const f=await fixture(t);f.state.account=OTHER;await assert.rejects(f.reader.read(f.options),{code:'account_mismatch'});assert.equal(f.state.calls.length,1);
  const g=await fixture(t,{intercept:({call,state})=>{if(call.action==='get_group_member_list')state.account=OTHER;}});await assert.rejects(g.reader.read(g.options),{code:'account_changed'});assert.equal(g.state.calls.length,6);await closed(g.state);
});

test('offline and malformed health are rejected before or after the roster read',async t=>{
  const f=await fixture(t);f.state.online=false;await assert.rejects(f.reader.read(f.options),{code:'account_offline'});assert.equal(f.state.calls.length,2);
  const g=await fixture(t,{intercept:({call,state})=>{if(call.action==='get_group_member_list')state.online=false;}});await assert.rejects(g.reader.read(g.options),{code:'account_offline'});assert.equal(g.state.calls.length,7);
  for(const status of [null,{}, {online:'true'}, {online:true,good:1}]){const h=await fixture(t,{intercept:({call,reply})=>{if(call.action==='get_status'){reply(status);return true;}}});await assert.rejects(h.reader.read(h.options),{code:'status_unverified'});}
});

test('pushed chat/group events and old echoes cannot answer the member request or escape the result',async t=>{
  const f=await fixture(t,{intercept:({call,socket,reply})=>{
    if(call.action!=='get_group_member_list')return;
    socket.send(JSON.stringify({post_type:'message',message_type:'group',message:'PRIVATE_MESSAGE',echo:call.echo,status:'ok',retcode:0,data:[member({user_id:'11111111'})]}));
    socket.send(JSON.stringify({echo:'old-echo',status:'ok',retcode:0,data:[member({user_id:'22222222'})]}));reply([member()]);return true;
  }});const result=await f.reader.read(f.options);assert.equal(result.items[0].id,'23456001');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_MESSAGE/);assert.equal(f.state.calls.length,7);
});

test('binary, non-UTF8, malformed and oversized member frames expose only fixed error codes',async t=>{
  for(const [payload,options,code]of [[Buffer.from('PRIVATE_BINARY'),{binary:true},'invalid_response'],[Buffer.from([0xc3,0x28]),{binary:false},'invalid_response'],['PRIVATE_BAD_JSON',{binary:false},'invalid_response'],['x'.repeat(2048),{binary:false},'response_too_large']]){
    const f=await fixture(t,{maxPayload:1024,intercept:({call,socket})=>{if(call.action==='get_group_member_list'){socket.send(payload,options);return true;}}});
    await assert.rejects(f.reader.read(f.options),error=>error.code===code&&!error.message.includes('PRIVATE'));await closed(f.state);
  }
});

test('unsolicited frame count and aggregate data are bounded even when no echo matches',async t=>{
  for(const aggregate of [false,true]){
    const f=await fixture(t,{maxPayload:1024,intercept:({call,socket})=>{
      if(call.action!=='get_group_member_list')return;
      const data=JSON.stringify({post_type:'message',message:aggregate?'x'.repeat(850):'x'});
      for(let i=0;i<(aggregate?6:257);i++)socket.send(data);return true;
    }});await assert.rejects(f.reader.read(f.options),{code:'response_too_large'});await closed(f.state);
  }
});

test('bridge failures and incorrect successful-response types stay private without retry',async t=>{
  for(const [extra,code]of [[{status:'failed',retcode:500,message:'PRIVATE_FAILURE',wording:TOKEN},'action_failed'],[{status:'ok',retcode:'0'},'invalid_response'],[{status:'pending',retcode:1},'invalid_response']]){
    const f=await fixture(t,{intercept:({call,reply})=>{if(call.action==='get_group_member_list'){reply(null,extra);return true;}}});
    await assert.rejects(f.reader.read(f.options),error=>error.code===code&&!error.message.includes('PRIVATE')&&!error.message.includes(TOKEN));assert.equal(f.state.connections,1);assert.equal(f.state.calls.filter(call=>call.action==='get_group_member_list').length,1);await closed(f.state);
  }
});

test('the total timeout covers the whole sequence, rather than restarting for each query',async t=>{
  const f=await fixture(t,{timeoutMs:90,intercept:({call,reply})=>{
    const data=call.action==='get_login_info'?{user_id:ACCOUNT}:call.action==='get_status'?{online:true,good:true}:call.action==='get_group_list'?[{group_id:GROUP}]:[member()];
    setTimeout(()=>reply(data),25);return true;
  }});const start=Date.now();await assert.rejects(f.reader.read(f.options),{code:'timeout'});assert(Date.now()-start<400);assert(f.state.calls.length<7);assert.equal(f.state.connections,1);await closed(f.state);
});

test('cancellation before connect, during members and during final checks never yields old data',async t=>{
  const pre=new AbortController();pre.abort();const f=await fixture(t);await assert.rejects(f.reader.read({...f.options,signal:pre.signal}),{code:'cancelled'});assert.equal(f.state.connections,0);
  for(const stage of ['get_group_member_list','final-status']){
    const abort=new AbortController();const g=await fixture(t,{intercept:({call,state})=>stage===call.action||(stage==='final-status'&&call.action==='get_status'&&state.calls.length===7)});
    const reading=g.reader.read({...g.options,signal:abort.signal});await until(()=>g.state.calls.length===(stage==='get_group_member_list'?4:7));abort.abort();await assert.rejects(reading,{code:'cancelled'});await closed(g.state);
  }
});

test('concurrent group reads are isolated and cancelling one leaves the other read intact',async t=>{
  const f=await fixture(t,{groups:[{group_id:GROUP},{group_id:OTHER_GROUP}],intercept:({call,reply})=>{
    if(call.action!=='get_group_member_list')return;
    if(call.params.group_id===GROUP)return true;
    reply([member({group_id:OTHER_GROUP})]);return true;
  }}),abort=new AbortController();const first=f.reader.read({...f.options,signal:abort.signal});const second=f.reader.read({...f.options,groupId:OTHER_GROUP});await until(()=>f.state.calls.some(call=>call.action==='get_group_member_list'&&call.params.group_id===GROUP));abort.abort();
  await assert.rejects(first,{code:'cancelled'});assert.equal((await second).groupId,OTHER_GROUP);assert.equal(f.state.connections,2);await closed(f.state);
});

test('invalid inputs never open a socket or turn a group selection into an arbitrary action',async t=>{
  const f=await fixture(t);
  for(const patch of [{url:'ws://example.com/'},{url:'ws://localhost:3001/'},{url:'ws://127.0.0.1:3001/?token=private'},{token:'bad\r\nheader'},{expectedAccountId:'abc'},{groupId:12345678},{groupId:'00123456'},{groupId:'1234.5'},{groupId:'9007199254740992'},{groupId:'get_group_msg'},{fresh:'true'}])await assert.rejects(f.reader.read({...f.options,...patch}),{code:'invalid_config'});
  assert.equal(f.state.connections,0);
  for(const args of [{timeoutMs:0},{timeoutMs:30001},{maxPayload:1024*1024+1},{WebSocket:{}}])assert.throws(()=>new QQGroupMembersReader(args),{code:'invalid_config'});
});

test('handshake abort and authentication failures close the owned socket without redirects or raw errors',async()=>{
  const abort=new AbortController();let socket,options;
  class Pending extends EventEmitter {constructor(_url,opts){super();socket=this;options=opts;this.readyState=0;}send(){assert.fail('No action before ready.');}terminate(){this.readyState=3;this.emit('close');}}
  const common={url:'ws://127.0.0.1:3001/',token:TOKEN,expectedAccountId:ACCOUNT,groupId:GROUP};
  const reading=new QQGroupMembersReader({WebSocket:Pending}).read({...common,signal:abort.signal});abort.abort();await assert.rejects(reading,{code:'cancelled'});
  assert.equal(socket.listenerCount('message'),0);assert.equal(options.followRedirects,false);assert.equal(options.perMessageDeflate,false);assert.equal(options.maxPayload,1024*1024);
  let created=0,destroyed=false;
  class Unauthorized extends EventEmitter {constructor(){super();created++;queueMicrotask(()=>this.emit('unexpected-response',{}, {statusCode:403,destroy:()=>{destroyed=true;}}));}send(){assert.fail('No action before authentication.');}terminate(){this.emit('close');}}
  await assert.rejects(new QQGroupMembersReader({WebSocket:Unauthorized}).read(common),{code:'unauthorized'});assert.equal(created,1);assert(destroyed);
  await assert.rejects(new QQGroupMembersReader({WebSocket:class {constructor(){throw Error('PRIVATE_TRANSPORT');}}}).read(common),error=>error.code==='connection_failed'&&!error.message.includes('PRIVATE'));
});
