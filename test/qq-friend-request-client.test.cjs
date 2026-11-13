'use strict';
// Real loopback OneBot transport; all identities/events are synthetic. No QQ account is contacted.
const test = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {WebSocketServer} = require('ws');
const {QQClient} = require('../src/bot/qq.cjs');
const ACCOUNT = '87654321', OWNER = '12345678', APPLICANT = '23456789';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

async function fixture(t, options = {}) {
  const server = new WebSocketServer({host:'127.0.0.1', port:0}); await once(server, 'listening');
  const requests = [], events = [], state = {now:1800000000500, account:ACCOUNT, status:{online:true,good:true}, socket:null};
  server.on('connection', socket => {
    state.socket = socket;
    socket.on('message', raw => {
      const req = JSON.parse(raw); requests.push(req);
      const reply = (data, patch = {}) => { if (socket.readyState === 1) socket.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,data,...patch})); };
      if (req.action === 'get_login_info') state.loginGate ? state.loginGate(reply, req) : reply({user_id:state.account});
      else if (req.action === 'get_status') state.statusGate ? state.statusGate(reply, req) : reply(state.status);
      else if (req.action === 'set_friend_add_request') state.writeGate ? state.writeGate(reply, req, socket) : reply(null);
      else assert.fail(`Unexpected synthetic action: ${req.action}`);
    });
  });
  const client = new QQClient({url:`ws://127.0.0.1:${server.address().port}/`,token:'synthetic-friend-token',ownerId:OWNER,
    expectedAccountId:ACCOUNT,acceptAfter:state.now-60000,now:()=>state.now,timeoutMs:100,pollTimeoutMs:1,
    onFriendRequest:(event, source)=>events.push({event,source}),...options});
  t.after(async()=>{ client.close(); for (const s of server.clients) s.terminate(); await new Promise(r=>server.close(r)); });
  return {client,state,events,requests,writes:()=>requests.filter(r=>r.action==='set_friend_add_request'),
    event:(extra={})=>({post_type:'request',request_type:'friend',self_id:ACCOUNT,user_id:APPLICANT,time:Math.floor(state.now/1000),comment:'Synthetic request',flag:'opaque-fixture',...extra})};
}

test('friend requests are a verified-connection callback, never owner business messages', async t => {
  const f=await fixture(t); await f.client.connect();
  f.state.socket.send(JSON.stringify(f.event()));
  // A read-only request supplies a deterministic socket ordering barrier.
  await f.client._request('get_status', {});
  assert.equal(f.events.length,1);
  assert.equal(f.events[0].source.client,f.client); assert.equal(f.events[0].source.generation,f.client.generation);
  assert.deepEqual(f.events[0].event,f.event());
  assert.deepEqual((await f.client.getUpdates()).messages,[]); assert.equal(f.client.seen.size,0); assert.equal(f.writes().length,0);
  f.client._frame(JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:ACCOUNT,user_id:APPLICANT,time:Math.floor(f.state.now/1000),message_id:1,message:'not the owner'}));
  assert.equal(f.client.queue.length,0);
});

test('connection timestamp is published only after online verification and is renewed on reconnect', async t => {
  const f=await fixture(t), gate=deferred(); f.state.statusGate=reply=>gate.resolve(reply);
  const first=f.client.connect(); const reply=await gate.promise;
  f.client._frame(JSON.stringify(f.event())); assert.equal(f.events.length,0); assert.equal(f.client.connectedAt,null);
  f.state.now+=500; reply(f.state.status); await first;
  assert.equal(f.client.connectedAt,f.state.now); assert.notEqual(f.client.connectedAt,f.client.acceptAfter);
  const old=f.client.connectedAt; f.client._drop(Object.assign(new Error(),{code:'disconnected'})); assert.equal(f.client.connectedAt,null);
  f.state.now+=5000; f.state.statusGate=undefined; await f.client.connect(); assert.equal(f.client.connectedAt,old+5000);
  f.client.close(); assert.equal(f.client.connectedAt,null);
});

test('missing self, group requests, group-bearing friend events and response-shaped events are not callback inputs', async t => {
  const f=await fixture(t); await f.client.connect();
  for(const patch of [{self_id:undefined},{request_type:'group'},{group_id:12345},{post_type:'notice'},{echo:1}]) f.client._frame(JSON.stringify(f.event(patch)));
  assert.equal(f.events.length,0); assert.equal(f.client.queue.length,0);
  f.client._frame(JSON.stringify(f.event({self_id:'99999999'}))); assert.equal(f.events.length,0); assert.equal(f.client.ready,false); assert.equal(f.client.lastError.code,'account_changed');
});

test('optional callback failure cannot disconnect the client or become an unhandled rejection', async t => {
  const f=await fixture(t,{onFriendRequest:()=>{throw new Error('private callback failure');}}); await f.client.connect();
  assert.doesNotThrow(()=>f.client._frame(JSON.stringify(f.event()))); assert.equal(f.client.ready,true);
  f.client.onFriendRequest=async()=>{throw new Error('private async failure');}; f.client._frame(JSON.stringify(f.event()));
  await new Promise(r=>setImmediate(r)); assert.equal(f.client.ready,true); assert.equal(f.client.queue.length,0);
  const plain=await fixture(t,{onFriendRequest:undefined}); await plain.client.connect(); assert.doesNotThrow(()=>plain.client._frame(JSON.stringify(plain.event())));
});

test('fixed decisions send only the exact opaque flag and literal Boolean after login/status verification', async t => {
  const f=await fixture(t); await f.client.connect();
  for(const approve of [true,false]){
    const before=f.requests.length;
    assert.deepEqual(await f.client.decideFriendRequest({flag:'opaque-fixture',approve},{}),{outcome:'accepted'});
    assert.deepEqual(f.requests.slice(before).map(r=>r.action),['get_login_info','get_status','set_friend_add_request']);
    assert.deepEqual(f.writes().at(-1).params,{flag:'opaque-fixture',approve});
  }
  assert.equal(f.client.ownerId,OWNER); assert.equal(f.client.contextToken,'');
});

test('malformed decisions, extra targets/actions and asynchronous guards submit nothing', async t => {
  const f=await fixture(t); await f.client.connect();
  for(const value of [null,[],{}, {flag:'x',approve:'false'}, {flag:'',approve:true}, {flag:'x'.repeat(513),approve:true},
    {flag:'a\n',approve:true}, {flag:'\ud800',approve:true}, ...['friendId','remark','action'].map(key=>({flag:'x',approve:true,[key]:'unexpected'}))]) {
    assert.deepEqual(await f.client.decideFriendRequest(value),{outcome:'not_submitted',code:'invalid_request'});
  }
  assert.deepEqual(await f.client.decideFriendRequest({flag:'x',approve:true},{assertCurrent:async()=>{}}),{outcome:'not_submitted',code:'invalid_request'});
  assert.equal(f.requests.length,2); assert.equal(f.writes().length,0);
});

test('wrong self, offline and unverifiable status preflight fail before the decision write', async t => {
  for(const [change,code] of [[f=>f.state.account='99999999','account_changed'],[f=>f.state.status={online:false},'account_offline'],
    [f=>f.state.status={},'status_unverified'],[f=>f.state.status={online:true,good:false},'status_unverified']]){
    const f=await fixture(t); await f.client.connect(); change(f);
    assert.deepEqual(await f.client.decideFriendRequest({flag:'x',approve:true}),{outcome:'not_submitted',code}); assert.equal(f.writes().length,0);
  }
});

test('same-object generation or owner changes across status await cannot submit', async t => {
  for(const mutate of [f=>f.client.generation++,f=>f.client.ownerId='99999999']){
    const f=await fixture(t); await f.client.connect(); const gate=deferred(); f.state.statusGate=reply=>gate.resolve(reply);
    const decision=f.client.decideFriendRequest({flag:'x',approve:true}); const reply=await gate.promise; mutate(f); reply(f.state.status);
    const result=await decision; assert.equal(result.outcome,'not_submitted'); assert.equal(f.writes().length,0);
  }
});

test('last synchronous guard can invalidate the panel after status without submitting', async t => {
  const f=await fixture(t); await f.client.connect(); let statusComplete=false;
  const request=f.client._request.bind(f.client); f.client._request=async(...args)=>{const value=await request(...args);if(args[0]==='get_status')statusComplete=true;return value;};
  const result=await f.client.decideFriendRequest({flag:'x',approve:true},{assertCurrent:()=>{if(statusComplete)throw Object.assign(new Error('private'),{code:'changed'});}});
  assert.deepEqual(result,{outcome:'not_submitted',code:'changed'}); assert.equal(f.writes().length,0);
});

test('abort before invocation is not submitted; abort after invocation stays unknown without replay', async t => {
  const f=await fixture(t); await f.client.connect(); const early=new AbortController();early.abort();
  assert.deepEqual(await f.client.decideFriendRequest({flag:'x',approve:false},{signal:early.signal}),{outcome:'not_submitted',code:'cancelled'});
  const sent=deferred();f.state.writeGate=()=>sent.resolve();const late=new AbortController();
  const operation=f.client.decideFriendRequest({flag:'x',approve:false},{signal:late.signal});await sent.promise;late.abort();
  assert.deepEqual(await operation,{outcome:'unknown',code:'unknown'});assert.equal(f.writes().length,1);
});

test('null and omitted successful responses are accepted; arbitrary data remain unknown', async t => {
  const f=await fixture(t); await f.client.connect();
  for(const data of [null,undefined,{},[],false,0,'']){
    f.state.writeGate=reply=>reply(data);const result=await f.client.decideFriendRequest({flag:'x',approve:true});
    assert.deepEqual(result,data===null||data===undefined?{outcome:'accepted'}:{outcome:'unknown',code:'unknown'});
  }
  assert.equal(f.writes().length,7);
});

test('bad echo/status/retcode and disconnect after write stay unknown and never send again', async t => {
  for(const patch of [{echo:'unrelated'},{status:'failed'},{retcode:'0'},{retcode:1},{status:undefined},'disconnect']){
    const f=await fixture(t);await f.client.connect();f.state.writeGate=(reply,_req,socket)=>patch==='disconnect'?socket.terminate():reply(undefined,patch);
    assert.deepEqual(await f.client.decideFriendRequest({flag:'x',approve:true}),{outcome:'unknown',code:'unknown'});assert.equal(f.writes().length,1);
  }
});

test('matching accepted write survives a later panel change without claiming readback or membership', async t => {
  const f=await fixture(t);await f.client.connect();let current=true;
  f.state.writeGate=reply=>{current=false;reply(null);};
  const result=await f.client.decideFriendRequest({flag:'x',approve:true},{assertCurrent:()=>{if(!current)throw Object.assign(new Error(),{code:'changed'});}});
  assert.deepEqual(result,{outcome:'accepted'});assert.equal(f.writes().length,1);
});
