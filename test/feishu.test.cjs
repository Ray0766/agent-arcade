'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const {FeishuClient, validateFeishuAppId, validateFeishuOwner, prepareFeishuInbound} = require('../src/bot/feishu.cjs');
const {createFeishuSDKTransport} = require('../src/bot/feishu-sdk.cjs');
const APP = 'cli_0123456789abcdef', OWNER = 'ou_owner_12345678', BOT = 'ou_bot_12345678';
const NOW = 1793920000000, uuid = 'fixture-send-001';
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject}; };
function event(overrides = {}) {
  return {schema:'2.0',event_type:'im.message.receive_v1',app_id:APP,tenant_key:'tenant_fixture',event_id:'event001',
    sender:{sender_type:'user',sender_id:{open_id:OWNER},tenant_key:'tenant_fixture'},
    message:{message_id:'om_message_00001',chat_id:'oc_private_00001',chat_type:'p2p',message_type:'text',
      create_time:String(NOW),content:JSON.stringify({text:'hello'})},...overrides};
}
function fixture(options = {}) {
  const calls = [], f = {state:'connected',bot:BOT,time:NOW,closes:0};
  const client = new FeishuClient({appId:APP,appSecret:'synthetic-secret',ownerId:OWNER,now:()=>f.time,
    pollTimeoutMs:5,...options,transportFactory:args=>{
      f.callbacks=args;
      return f.transport={state:()=>f.state,botInfo:async()=>{calls.push('identity');return f.identityResult??{code:0,bot:{open_id:f.bot}};},
        start:async signal=>{calls.push('start');if(f.start)await f.start(signal);},
        sendText:async payload=>{calls.push('send');f.payload=payload;if(f.beforeWrite)await f.beforeWrite();payload.assertCurrent();
          if(f.sendError)throw f.sendError;return f.sendResult??{code:0,data:{message_id:'om_response_0001'}};},
        close:()=>{f.closes++;f.state='closed';}};
    }});
  f.emit=e=>f.callbacks.onEvent(e); f.change=state=>{f.state=state;f.callbacks.onState(state);};
  return {client,f,calls};
}

test('Feishu application and owner identifiers are explicit and application-scoped',()=>{
  assert.equal(validateFeishuAppId(APP),APP);assert.equal(validateFeishuOwner(OWNER),OWNER);
  for(const id of ['', 'nickname','123456','cli_bad','https://example.org'])assert.throws(()=>validateFeishuAppId(id));
  for(const id of ['', 'owner name','12345678','on_union_12345',OWNER+' '])assert.throws(()=>validateFeishuOwner(id));
  assert.throws(()=>fixture({appSecret:''}),{code:'invalid_app_secret'});
});
test('verified bot identity precedes receiving; normal text maps to existing Dispatcher contract',async()=>{
  const {client,f,calls}=fixture();f.emit=event=>f.callbacks.onEvent(event);
  await client.connect();assert.deepEqual(calls,['identity','start','identity']);
  f.emit(event());const b=await client.getUpdates();assert.equal(b.messages.length,1);
  assert.equal(client.accountId,BOT);assert.equal(b.messages[0].from,OWNER);assert.equal(b.messages[0].text,'hello');
  assert.equal(b.messages[0].contextToken,client.contextToken);assert.equal(b.cursor,'1');client.close();
});
for(const [name,change] of [
  ['group chat',e=>e.message.chat_type='group'],['another owner',e=>e.sender.sender_id.open_id='ou_other_123456'],
  ['bot sender',e=>e.sender.sender_type='bot'],['wrong application',e=>e.app_id='cli_aaaaaaaaaaaaaaaa'],
  ['missing tenant',e=>delete e.tenant_key],['wrong schema',e=>e.schema='1.0'],
  ['wrong event type',e=>e.event_type='im.message.recalled_v1'],['old message',e=>e.message.create_time=String(NOW-1)],
  ['future message',e=>e.message.create_time=String(NOW+60001)],['invalid message id',e=>e.message.message_id='nickname'],
  ['missing chat identity',e=>delete e.message.chat_id],['oversized text',e=>e.message.content=JSON.stringify({text:'a'.repeat(16001)})]
])test(`Feishu rejects ${name} without queuing or responding`,async()=>{
  const {client,f,calls}=fixture();await client.connect();const e=event();change(e);f.emit(e);
  assert.deepEqual((await client.getUpdates()).messages,[]);assert(!calls.includes('send'));client.close();
});
test('message IDs deduplicate different event IDs and supplied prior receipts',async()=>{
  const {client,f}=fixture({seenIds:['om_already_00001']});await client.connect();
  f.emit(event());f.emit(event({event_id:'another-event'}));const prior=event();prior.message.message_id='om_already_00001';f.emit(prior);
  assert.equal((await client.getUpdates()).messages.length,1);assert.equal(client.seenIds().length,2);client.close();
});
test('tenant changes cannot migrate an established owner connection',async()=>{
  const {client,f}=fixture();await client.connect();f.emit(event());await client.getUpdates();
  const e=event({tenant_key:'other_tenant'});e.message.message_id='om_message_00002';f.emit(e);
  assert.equal((await client.getUpdates('1')).messages.length,0);client.close();
});
test('nontext input cannot execute embedded text; quoted control commands remain unauthorized',async()=>{
  const {client,f}=fixture();await client.connect();let e=event();e.message.message_type='post';f.emit(e);
  const message=(await client.getUpdates()).messages[0];assert(prepareFeishuInbound(message).rejection);
  e=event();e.message.message_id='om_message_00002';e.message.content=JSON.stringify({text:'/stop'});e.message.parent_id='om_parent_000001';f.emit(e);
  const quote=(await client.getUpdates('1')).messages[0];assert.equal(quote.quote.text,'');assert(prepareFeishuInbound(quote).rejection);client.close();
});
test('no bot identity or wrong bot after reconnect fails closed',async()=>{
  const a=fixture();a.f.identityResult={code:0,bot:{}};await assert.rejects(a.client.connect(),{code:'invalid_response'});assert(!a.calls.includes('start'));a.client.close();
  const b=fixture();await b.client.connect();b.f.change('reconnecting');b.f.bot='ou_other_bot_1234';b.f.change('connected');
  await assert.rejects(b.client.connect(),{code:'account_changed'});assert.equal(b.client.ready,false);assert.equal(b.f.closes,1);b.client.close();
});
test('reconnect drops queued old inputs and old sending context, but retains dedup',async()=>{
  const {client,f,calls}=fixture();await client.connect();f.emit(event());const old=client.contextToken;
  f.time++;f.change('reconnecting');assert.equal(client.ready,false);assert.equal(client.queue.length,0);
  f.change('connected');await client.connect();assert.notEqual(client.contextToken,old);
  await assert.rejects(client.sendText(OWNER,'late',old,uuid),{code:'stale_context'});assert(!calls.includes('send'));
  const again=event();again.message.create_time=String(f.time);f.emit(again);assert.equal((await client.getUpdates()).messages.length,0);client.close();
});
test('bounded inbox overflow terminates reception instead of silently losing permission ordering',async()=>{
  const {client,f}=fixture();await client.connect();for(let i=0;i<201;i++){const e=event();e.message.message_id=`om_message_${String(i).padStart(8,'0')}`;f.emit(e);}
  await assert.rejects(client.getUpdates(),{code:'queue_overflow'});assert.equal(f.closes,1);assert.equal(client.queue.length,0);client.close();
});
test('close clears pending poll and rejects late callbacks without restarting',async()=>{
  const {client,f,calls}=fixture({pollTimeoutMs:10000});await client.connect();const wait=client.getUpdates();await new Promise(setImmediate);client.close();
  await assert.rejects(wait,{code:'disconnected'});f.state='connected';f.callbacks.onState('connected');f.emit(event());
  assert.equal(client.queue.length,0);await assert.rejects(client.connect(),{code:'closed'});assert.equal(calls.filter(x=>x==='start').length,1);
});
test('poll cancellation does not dispatch queued text',async()=>{
  const {client}=fixture({pollTimeoutMs:10000});await client.connect();const controller=new AbortController();const p=client.getUpdates('',controller.signal);
  await new Promise(setImmediate);controller.abort();await assert.rejects(p,{code:'aborted'});client.close();
});
test('close during handshake cannot resurrect a client',async()=>{
  const {client,f}=fixture();const wait=deferred();f.start=()=>wait.promise;const p=client.connect();await new Promise(setImmediate);
  client.close();f.state='connected';wait.resolve();await assert.rejects(p,{code:'closed'});assert.equal(client.ready,false);assert.equal(client.transport,null);
});
test('send is fixed owner text with a server idempotency UUID and exact receipt',async()=>{
  const {client,f}=fixture();await client.connect();await assert.rejects(client.sendText('ou_other_123456','x',client.contextToken,uuid),{code:'owner_required'});
  const receipt=await client.sendText(OWNER,'回复',client.contextToken,uuid);assert.deepEqual(receipt,{id:'om_response_0001',clientId:uuid});
  assert.equal(f.payload.ownerId,OWNER);assert.equal(f.payload.uuid,uuid);client.close();
});
test('late write guard prevents an old response after reconnect or abort',async()=>{
  const {client,f}=fixture();await client.connect();const wait=deferred();f.beforeWrite=()=>wait.promise;
  const p=client.sendText(OWNER,'old',client.contextToken,uuid);f.change('reconnecting');wait.resolve();
  await assert.rejects(p,{code:'stale_context'});client.close();
});
test('unknown send receipt is not retried; raw remote errors never escape',async()=>{
  const {client,f,calls}=fixture();await client.connect();f.sendResult={code:0,data:{}};
  await assert.rejects(client.sendText(OWNER,'x',client.contextToken,uuid),{code:'send_unknown'});assert.equal(calls.filter(x=>x==='send').length,1);
  f.sendError=Error('Authorization SECRET fake-body');await assert.rejects(client.sendText(OWNER,'x',client.contextToken,'next'),e=>e.code==='send_unknown'&&!e.message.includes('SECRET'));client.close();
});

function sdkFixture() {
  const official=require('@larksuiteoapi/node-sdk'),calls=[],f={httpGate:null};
  class WS {
    constructor(options){this.options=options;this.status='idle';f.ws=this;}
    start({eventDispatcher}){this.dispatcher=eventDispatcher;this.status='connecting';return Promise.resolve();}
    ready(){this.status='connected';this.options.onReady();}
    getConnectionStatus(){return {state:this.status};}
    close(options){this.closeOptions=options;this.status='idle';}
  }
  const sdk={...official,WSClient:WS,defaultHttpInstance:{request:async options=>{
    calls.push(options);if(f.httpGate)await f.httpGate(options);
    if(options.url.includes('/tenant_access_token/'))return {code:0,tenant_access_token:'synthetic-access-token',expire:3600};
    if(options.url.endsWith('/bot/v3/info'))return {code:0,bot:{open_id:BOT}};
    return {code:0,data:{message_id:'om_receipt_12345'}};
  }}};
  const events=[],states=[];const t=createFeishuSDKTransport({appId:APP,appSecret:'synthetic-secret',sdk,timeoutMs:100,
    onEvent:e=>events.push(e),onState:s=>states.push(s)});
  return {t,f,calls,events,states};
}
test('real official EventDispatcher normalizes v2 envelopes without exposing generic event callbacks',async()=>{
  const {t,f,events}=sdkFixture();const start=t.start();let resolved=false;start.then(()=>{resolved=true;});await new Promise(setImmediate);assert.equal(resolved,false);
  f.ws.ready();await start;const e=event();const {schema,sender,message,...header}=e;
  await f.ws.dispatcher.invoke({schema,header,event:{sender,message}},{needCheck:false});assert.equal(events[0].app_id,APP);assert.equal(events[0].message.message_id,message.message_id);
  await f.ws.dispatcher.invoke({schema,header:{...header,event_type:'card.action.trigger'},event:{sender,message}},{needCheck:false});assert.equal(events.length,1);t.close();
});
test('official SDK Client makes only fixed bounded authenticated APIs; close disables reconnection',async()=>{
  const {t,f,calls}=sdkFixture();assert.equal((await t.botInfo()).bot.open_id,BOT);const p=t.start();f.ws.ready();await p;
  const sent=await t.sendText({ownerId:OWNER,text:'hello',uuid,assertCurrent:()=>{}});assert.equal(sent.data.message_id,'om_receipt_12345');
  const post=calls.find(c=>c.url.endsWith('/im/v1/messages'));assert.deepEqual(post.params,{receive_id_type:'open_id'});
  assert.deepEqual(post.data,{receive_id:OWNER,msg_type:'text',content:'{"text":"hello"}',uuid});
  for(const c of calls){assert.equal(c.maxRedirects,0);assert.equal(c.timeout,100);assert.equal(c.maxContentLength,1048576);assert(c.signal);}
  t.close();assert.deepEqual(f.ws.closeOptions,{force:true});assert.equal(t.state(),'closed');await assert.rejects(t.botInfo(),{code:'closed'});
});
test('SDK HTTP final guard runs after token await; denied guard submits no message POST',async()=>{
  const {t,calls}=sdkFixture();await assert.rejects(t.sendText({ownerId:OWNER,text:'x',uuid,assertCurrent:()=>{throw Object.assign(Error('old'),{code:'stale_context'});}}),{code:'stale_context'});
  assert.equal(calls.filter(c=>c.url.endsWith('/im/v1/messages')).length,0);t.close();
});
test('SDK write cancellation after submission is unknown and never retried',async()=>{
  const {t,f,calls}=sdkFixture();f.httpGate=async options=>{if(options.url.endsWith('/im/v1/messages'))throw Error('raw-secret');};
  await assert.rejects(t.sendText({ownerId:OWNER,text:'x',uuid,assertCurrent:()=>{}}),e=>e.code==='send_unknown'&&e.submitted&&!e.message.includes('raw-secret'));
  assert.equal(calls.filter(c=>c.url.endsWith('/im/v1/messages')).length,1);t.close();
});
test('SDK close while handshake pending rejects readiness and drops subsequent events',async()=>{
  const {t,f,events,states}=sdkFixture();const p=t.start();t.close();await assert.rejects(p,{code:'closed'});
  f.ws.ready();const e=event();const {schema,sender,message,...header}=e;await f.ws.dispatcher.invoke({schema,header,event:{sender,message}},{needCheck:false});
  assert.equal(events.length,0);assert.equal(states.length,0);
});

test('official WSClient receives a real loopback protobuf frame, reconnects, and stays closed', {timeout:10000}, async()=>{
  const official=require('@larksuiteoapi/node-sdk'),{WebSocketServer}=require('ws');
  const protobuf=require('protobufjs');
  // Original fixture description of the published wire fields; no upstream
  // client implementation is copied. This server is exclusively loopback.
  const Frame=protobuf.parse('syntax="proto2"; message Header { required string key=1; required string value=2; } message Frame { required uint64 SeqID=1; required uint64 LogID=2; required int32 service=3; required int32 method=4; repeated Header headers=5; optional bytes payload=8; }').root.lookupType('Frame');
  const server=new WebSocketServer({host:'127.0.0.1',port:0}),sockets=[],acks=[];
  await new Promise(resolve=>server.once('listening',resolve));server.on('connection',socket=>{sockets.push(socket);socket.on('message',bytes=>{const f=Frame.decode(bytes);if(f.method===1)acks.push(JSON.parse(Buffer.from(f.payload).toString()));});});
  let endpointReads=0;const sdk={...official,defaultHttpInstance:{request:async request=>{
    if(request.url.endsWith('/callback/ws/endpoint')){endpointReads++;return {code:0,data:{URL:`ws://127.0.0.1:${server.address().port}/?device_id=fixture&service_id=1`,ClientConfig:{ReconnectCount:2,ReconnectInterval:0.01,ReconnectNonce:0,PingInterval:60}}};}
    if(request.url.includes('/tenant_access_token/'))return {code:0,tenant_access_token:'fixture-token',expire:3600};
    if(request.url.endsWith('/bot/v3/info'))return {code:0,bot:{open_id:BOT}};
    return {code:0,data:{message_id:'om_loopback_reply'}};
  }}};
  const client=new FeishuClient({appId:APP,appSecret:'fixture-secret',ownerId:OWNER,acceptAfter:NOW,now:()=>NOW,
    pollTimeoutMs:20,timeoutMs:1000,transportFactory:options=>createFeishuSDKTransport({...options,sdk})});
  const until=async condition=>{for(let i=0;i<400;i++){if(condition())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Loopback SDK condition did not settle');};
  try{
    await client.connect();const e=event(),{schema,sender,message,...header}=e;
    sockets[0].send(Frame.encode({SeqID:1,LogID:1,service:1,method:1,headers:[{key:'type',value:'event'},{key:'message_id',value:'frame001'},{key:'sum',value:'1'},{key:'seq',value:'0'}],payload:Buffer.from(JSON.stringify({schema,header,event:{sender,message}}))}).finish());
    await until(()=>client.queue.length===1&&acks.length===1);assert.equal(acks[0].code,200);
    const messageIn=(await client.getUpdates()).messages[0];assert.equal(messageIn.text,'hello');
    await client.sendText(OWNER,'loopback reply',messageIn.contextToken,uuid);
    sockets[0].terminate();await until(()=>sockets.length===2);await until(()=>client.transport.state()==='connected');
    assert.equal(client.ready,false);await client.connect();assert.notEqual(client.contextToken,messageIn.contextToken);
    client.close();await until(()=>server.clients.size===0);const before=endpointReads;
    await new Promise(resolve=>setTimeout(resolve,60));assert.equal(endpointReads,before);assert.equal(sockets.length,2);
  }finally{client.close();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));}
});

test('Feishu owner text uses real Dispatcher one-use approvals and persistent journal duplicate suppression',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
  const {MessageJournal}=require('../src/bot/journal.cjs'),{Dispatcher}=require('../src/bot/dispatcher.cjs');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-feishu-'));
  const {client,f}=fixture();let journal=new MessageJournal({root:directory}),runs=0,approved=false;
  const scope='feishu:'+crypto.createHash('sha256').update(JSON.stringify([APP,BOT,OWNER])).digest('hex');
  const until=async condition=>{for(let i=0;i<100;i++){if(condition())return;await new Promise(setImmediate);}assert.fail('Dispatcher condition did not settle');};
  const dispatcher=new Dispatcher({execute:async({request})=>{runs++;const answer=await request({kind:'permission',tool:'Write',input:{path:'synthetic.txt',content:'fixture'}});approved=answer.allow===true;return {outcome:'reply_ended',text:'Synthetic approved result'};},send:(text,context)=>client.sendText(OWNER,text,context)});
  const receive=async e=>{f.emit(e);const batch=await client.getUpdates(String(client.cursor));for(const m of batch.messages){if(journal.claim(scope,m.id,'api'))await dispatcher.receive(prepareFeishuInbound(m));}};
  try{
    assert(journal.available);await client.connect();await receive(event());await until(()=>dispatcher.snapshot().pending.length===1);
    const code=dispatcher.snapshot().pending[0].code;
    const wrong=event();wrong.message.message_id='om_wrong_approval';wrong.message.content=JSON.stringify({text:`/allow ${code}`});wrong.sender.sender_id.open_id='ou_foreign_12345';await receive(wrong);assert.equal(approved,false);
    const quoted=event();quoted.message.message_id='om_quoted_allow';quoted.message.content=JSON.stringify({text:`/allow ${code}`});quoted.message.parent_id='om_quote_123456';f.emit(quoted);const q=(await client.getUpdates(String(client.cursor))).messages[0];assert(prepareFeishuInbound(q).rejection);assert.equal(approved,false);
    const allowed=event();allowed.message.message_id='om_direct_allow';allowed.message.content=JSON.stringify({text:`/allow ${code}`});await receive(allowed);await dispatcher.whenIdle();await dispatcher.sendChain;assert.equal(approved,true);assert.equal(runs,1);
    // A fresh journal object models app restart; the same scoped message must
    // still not enter a second model/tool invocation after in-memory state ends.
    journal=new MessageJournal({root:directory});assert.equal(journal.claim(scope,event().message.message_id,'api'),false);
    assert.equal(journal.claim('qq:synthetic-other-scope',event().message.message_id,'api'),true);
  }finally{dispatcher.stop();client.close();fs.rmSync(directory,{recursive:true,force:true});}
});
