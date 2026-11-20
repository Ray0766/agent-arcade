'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {QQOfficialClient,QQOfficialError,validateQQOfficialAppId,validateQQOfficialSecret,validateQQOfficialGroupIds,validateQQOfficialGateway}=require('../src/bot/qq-official.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
  const f={requests:[],sockets:[],frames:[],now:Date.parse('2026-11-19T00:00:00.000Z'),token:'SYNTHETIC_TOKEN',secret:'SYNTHETIC_SECRET',ack:true,...options};
  class FakeSocket extends EventEmitter{
    constructor(url,config){super();this.url=url;this.config=config;this.readyState=1;f.sockets.push(this);queueMicrotask(()=>{if(f.hello!==false)this.event({op:10,d:{heartbeat_interval:1000}});});}
    send(raw,callback){const frame=JSON.parse(raw);f.frames.push(frame);if(f.writeError){callback?.(Error('SECRET_SOCKET_DETAIL'));return;}callback?.();if(frame.op===2&&f.ready!==false)queueMicrotask(()=>this.event({op:0,s:1,t:'READY',d:{session_id:'synthetic-session',user:{id:'synthetic-bot-user',bot:true},...f.readyData}}));if(frame.op===1&&f.ack)queueMicrotask(()=>this.event({op:11}));}
    event(frame){this.emit('message',Buffer.from(JSON.stringify(frame)),false);}
    terminate(){this.readyState=3;queueMicrotask(()=>this.emit('close'));}
  }
  f.response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  const fetchImpl=async(url,init)=>{
    f.requests.push({url,method:init.method,body:init.body?JSON.parse(init.body):null,headers:init.headers,redirect:init.redirect});
    if(f.networkError)throw Error('PRIVATE_SERVER_BODY '+f.secret);
    if(url.endsWith('/app/getAppAccessToken'))return f.tokenResponse?f.tokenResponse():f.response({access_token:f.token,expires_in:'7200'});
    if(url.endsWith('/gateway'))return f.gatewayResponse?f.gatewayResponse():f.response({url:f.gateway||'wss://api.bot.qq.com/websocket/'});
    if(url.endsWith('/messages')){if(f.sendResponse)return f.sendResponse(init);return f.response({id:'official-receipt-'+f.requests.length,timestamp:new Date(f.now).toISOString()});}
    throw Error('Unexpected synthetic request');
  };
  f.client=new QQOfficialClient({appId:'12345678',secret:f.secret,groupIds:['GROUP_A','GROUP_B'],WebSocketImpl:FakeSocket,fetchImpl,timeoutMs:100,pollTimeoutMs:10,now:()=>f.now,...f.clientOptions});
  f.message=(patch={},type='GROUP_MESSAGE_CREATE')=>f.sockets.at(-1).event({op:0,s:2,t:type,d:{id:'ROBOT1.0_message',group_openid:'GROUP_A',author:{member_openid:'MEMBER_A',bot:false},content:'自然群聊，不需要固定 @ 规则',timestamp:new Date(f.now).toISOString(),message_type:0,...patch}});
  f.one=async(patch,type)=>{f.message(patch,type);const result=await f.client.getUpdates();assert.equal(result.messages.length,1);return result.messages[0];};
  f.sends=()=>f.requests.filter(request=>request.url.endsWith('/messages'));return f;
}

test('official credentials, opaque group IDs and gateway use bounded explicit formats',()=>{
  assert.equal(validateQQOfficialAppId('12345678'),'12345678');assert.equal(validateQQOfficialSecret('synthetic'),'synthetic');assert.deepEqual(validateQQOfficialGroupIds(['OPAQUE_A','00001234']),['OPAQUE_A','00001234']);
  for(const value of ['1234','../12345',12345678,'12 345'])assert.throws(()=>validateQQOfficialAppId(value),{code:'invalid_app_id'});
  for(const value of ['', ' has space', 'a\nb', 'x'.repeat(513)])assert.throws(()=>validateQQOfficialSecret(value),{code:'invalid_secret'});
  for(const value of [[''],['A','A'],['..'],['.'],['群名'],['with space'],Array(6).fill(0).map((_,i)=>'g'+i),['a'.repeat(257)]])assert.throws(()=>validateQQOfficialGroupIds(value),{code:'invalid_groups'});
  assert.equal(validateQQOfficialGateway('wss://api.bot.qq.com/websocket/'),'wss://api.bot.qq.com/websocket/');
  for(const value of ['ws://api.bot.qq.com/websocket/','wss://api.bot.qq.com.evil.test/websocket/','wss://user:secret@api.bot.qq.com/websocket/','wss://127.0.0.1/websocket/','wss://api.bot.qq.com/other','wss://api.bot.qq.com/websocket/?token=x','wss://api.bot.qq.com:444/websocket/'])assert.throws(()=>validateQQOfficialGateway(value),{code:'invalid_gateway'});
});

test('current access-token authentication and READY gate account identity; credentials stay private',async t=>{
  const f=fixture();t.after(()=>f.client.close());const identity=await f.client.connect();assert.deepEqual(identity,{accountId:'12345678',nickname:'QQ official bot'});assert.equal(f.client.ready,true);
  assert.equal(f.requests[0].url,'https://api.bot.qq.com/app/getAppAccessToken');assert.deepEqual(f.requests[0].body,{appId:'12345678',clientSecret:'SYNTHETIC_SECRET'});assert.equal(f.requests[1].url,'https://api.bot.qq.com/gateway');assert.equal(f.requests[1].headers.Authorization,'QQBot SYNTHETIC_TOKEN');assert(f.requests.every(r=>r.redirect==='error'));
  const identify=f.frames.find(x=>x.op===2);assert.equal(identify.d.token,'QQBot SYNTHETIC_TOKEN');assert.equal(identify.d.intents,1<<25);assert.deepEqual(identify.d.shard,[0,1]);assert.equal(f.sockets[0].config.followRedirects,false);assert.equal(f.sockets[0].config.maxPayload,256*1024);
  // Inspect only own enumerable data, without synthetic request spies outside the client.
  const own=Object.fromEntries(Object.entries(f.client).filter(([key])=>!['fetch','WebSocket','socket'].includes(key)));assert.doesNotMatch(require('node:util').inspect(own,{depth:2}),/SYNTHETIC_SECRET|SYNTHETIC_TOKEN/);assert.equal(f.client.capabilities.receiveAllPermission,'unverified');assert.equal(f.client.capabilities.proactive,false);
});

test('HTTP 200 business errors, unsafe gateways and invalid READY never become connected',async t=>{
  for(const mode of ['token','gateway','ready','network']){
    const f=fixture();t.after(()=>f.client.close());if(mode==='token')f.tokenResponse=()=>f.response({code:100016,message:'PRIVATE_SECRET_'+f.secret});if(mode==='gateway')f.gateway='wss://evil.test/websocket/';if(mode==='ready')f.readyData={user:{id:'other',bot:false}};if(mode==='network')f.networkError=true;
    await assert.rejects(f.client.connect(),error=>error instanceof QQOfficialError&&!error.message.includes(f.secret)&&!error.message.includes('PRIVATE')&&error.code===({token:'platform_rejected',gateway:'invalid_gateway',ready:'invalid_ready',network:'network_unconfirmed'})[mode]);assert.equal(f.client.ready,false);assert.equal(f.client.accountId,null);
  }
});

test('full-group and @ events share admission, dedupe and opaque member binding; other surfaces stay excluded',async t=>{
  const f=fixture();t.after(()=>f.client.close());await f.client.connect();const first=await f.one();assert.equal(first.route,'group');assert.equal(first.accountId,'12345678');assert.equal(first.groupId,'GROUP_A');assert.equal(first.from,'MEMBER_A');assert.match(first.id,/^qqofficial:[a-f0-9]{64}$/);assert.equal(first.text,'自然群聊，不需要固定 @ 规则');
  f.message({},'GROUP_AT_MESSAGE_CREATE');f.message({id:'other-group',group_openid:'GROUP_NOT_SELECTED'});f.message({id:'bot',author:{member_openid:'BOT',bot:true}});f.message({id:'missing-author',author:{id:'must-not-fallback-to-union-id'}});f.message({id:'private'},'C2C_MESSAGE_CREATE');assert.equal((await f.client.getUpdates()).messages.length,0);
  const at=await f.one({id:'at-message'},'GROUP_AT_MESSAGE_CREATE');assert.equal(at.text,first.text);assert.notEqual(at.contextToken,first.contextToken);
});

test('no historical replay on initial or replacement connection; old contexts cannot send',async t=>{
  const f=fixture();t.after(()=>f.client.close());await f.client.connect();f.message({id:'history',timestamp:new Date(f.now-10000).toISOString()});assert.equal((await f.client.getUpdates()).messages.length,0);const message=await f.one();
  f.sockets[0].event({op:7});assert.equal(f.client.ready,false);assert.equal(f.client.queue.length,0);await assert.rejects(f.client.sendGroupText({groupId:message.groupId,senderId:message.from},'old',message.contextToken,'old'),{code:'stale_context'});
  f.now+=10000;await f.client.connect();assert.equal(f.sockets.length,2);assert.equal(f.frames.filter(x=>x.op===6).length,0);f.message({timestamp:new Date(f.now-10000).toISOString()});assert.equal((await f.client.getUpdates()).messages.length,0);assert.equal(f.sends().length,0);
});

test('nontext and quoted/structured payloads cannot silently become executable plain text',async t=>{
  const f=fixture();t.after(()=>f.client.close());await f.client.connect();
  for(const [index,patch]of [{attachments:[{content_type:'image/jpeg',url:'https://PRIVATE.test/pic'}]},{attachments:{}},{msg_elements:[{content:'quoted authority'}]},{ark_data:{fields:{token:'PRIVATE'}}},{message_type:103},{content:'a\0b'}].entries()){
    const message=await f.one({id:'nontext-'+index,...patch});assert.equal(message.text,'');assert.equal(message.unsupported,'qq_official_nontext');assert.doesNotMatch(JSON.stringify(message),/PRIVATE|quoted authority/);
  }assert.equal(f.requests.length,2);
});

test('passive send binds app/group/member/context, returns a concrete receipt and repeats no write',async t=>{
  const f=fixture();t.after(()=>f.client.close());await f.client.connect();const message=await f.one(),binding={groupId:message.groupId,senderId:message.from};
  for(const other of [{groupId:'GROUP_B',senderId:message.from},{groupId:message.groupId,senderId:'OTHER'}, {...binding,accountId:'OTHER_APP'}])await assert.rejects(f.client.sendGroupText(other,'hello',message.contextToken,'bad'),{code:'stale_context'});
  const one=await f.client.sendGroupText(binding,'回复',message.contextToken,'one'),repeat=await f.client.sendGroupText(binding,'回复',message.contextToken,'one');assert.deepEqual(one,repeat);assert.equal(f.sends().length,1);assert.deepEqual(f.sends()[0].body,{msg_type:0,content:'回复',msg_id:'ROBOT1.0_message',msg_seq:1});assert.match(one.id,/official-receipt/);assert.equal(f.sends()[0].url,'https://api.bot.qq.com/v2/groups/GROUP_A/messages');
  await assert.rejects(f.client.sendGroupText(binding,'changed',message.contextToken,'one'),{code:'client_id_reused'});for(let i=2;i<=5;i++)await f.client.sendGroupText(binding,'reply '+i,message.contextToken,'attempt'+i);await assert.rejects(f.client.sendGroupText(binding,'sixth',message.contextToken,'sixth'),{code:'reply_limit'});assert.equal(f.sends().length,5);
});

test('expired reply context never falls back to proactive sending',async t=>{
  const f=fixture();t.after(()=>f.client.close());await f.client.connect();const m=await f.one();f.now+=300000;await assert.rejects(f.client.sendGroupText({groupId:m.groupId,senderId:m.from},'late',m.contextToken,'late'),{code:'reply_expired'});assert.equal(f.sends().length,0);assert.equal(typeof f.client.sendGroupProactive,'undefined');
});

test('distinct incoming msg_seq values share the same passive reply counter for a raw message',async t=>{
  const f=fixture();t.after(()=>f.client.close());await f.client.connect();const first=await f.one({msg_seq:1}),second=await f.one({msg_seq:2}),binding={groupId:first.groupId,senderId:first.from};
  await f.client.sendGroupText(binding,'first',first.contextToken,'seq-one');await f.client.sendGroupText(binding,'second',second.contextToken,'seq-two');assert.deepEqual(f.sends().map(request=>request.body.msg_seq),[1,2]);
});

test('ambiguous sends, platform rejection and missing receipts are not reported successful or automatically retried',async t=>{
  for(const mode of ['network','platform','missing','async','timeout']){
    const f=fixture();t.after(()=>f.client.close());await f.client.connect();const m=await f.one(),binding={groupId:m.groupId,senderId:m.from};f.sendResponse=()=>mode==='network'?Promise.reject(Error('PRIVATE_HTTP_BODY')):mode==='platform'?f.response({err_code:40034105,message:'PRIVATE_HTTP_BODY'}):mode==='missing'?f.response({timestamp:'2026-11-19'}):mode==='async'?f.response({id:'not-confirmed'},202):new Promise(()=>{});
    const expected={network:'network_unconfirmed',platform:'platform_rejected',missing:'invalid_send_receipt',async:'delivery_unconfirmed',timeout:'request_timeout'}[mode];await assert.rejects(f.client.sendGroupText(binding,'send',m.contextToken,'one'),error=>error.code===expected&&!error.message.includes('PRIVATE'));
    await assert.rejects(f.client.sendGroupText(binding,'send',m.contextToken,'one'),{code:expected});assert.equal(f.sends().length,1);
  }
});

test('a delayed receipt after disconnect is unconfirmed, with no leaked reply context',async t=>{
  const f=fixture();t.after(()=>f.client.close());await f.client.connect();const m=await f.one();let release;f.sendResponse=()=>new Promise(resolve=>release=()=>resolve(f.response({id:'late-receipt'})));const sending=f.client.sendGroupText({groupId:m.groupId,senderId:m.from},'pending',m.contextToken,'one');await tick();f.sockets[0].emit('close');release();await assert.rejects(sending);assert.equal(f.client.ready,false);assert.equal(f.client.contexts.size,0);assert.equal(f.sends().length,1);
});

test('handshake cancellation, read cancellation and close retire pending work',async t=>{
  const f=fixture({ready:false});t.after(()=>f.client.close());const abort=new AbortController(),connecting=f.client.connect(abort.signal);await tick();abort.abort();await assert.rejects(connecting,{code:'aborted'});assert.equal(f.client.ready,false);
  const g=fixture();t.after(()=>g.client.close());await g.client.connect();const readAbort=new AbortController(),reading=g.client.getUpdates('',readAbort.signal);await tick();readAbort.abort();await assert.rejects(reading,{code:'aborted'});const pending=g.client.getUpdates();await tick();g.client.close();await assert.rejects(pending,{code:'closed'});await assert.rejects(g.client.connect(),{code:'closed'});
});

test('oversize HTTP/frame input and event queue overflow fail closed',async t=>{
  const f=fixture();t.after(()=>f.client.close());f.tokenResponse=()=>new Response('x'.repeat(256*1024+1));await assert.rejects(f.client.connect(),{code:'response_too_large'});
  const g=fixture();t.after(()=>g.client.close());await g.client.connect();g.sockets[0].emit('message',Buffer.alloc(256*1024+1),false);assert.equal(g.client.lastError.code,'invalid_frame');assert.equal(g.client.ready,false);
  const h=fixture();t.after(()=>h.client.close());await h.client.connect();for(let i=0;i<=200;i++)h.message({id:'overflow-'+i});assert.equal(h.client.lastError.code,'queue_overflow');assert.equal(h.client.queue.length,0);assert.equal(h.client.ready,false);
});

test('heartbeat acknowledgements are required for a continuing connection',async t=>{
  const f=fixture({ack:false});t.after(()=>f.client.close());await f.client.connect();await new Promise(resolve=>setTimeout(resolve,2100));assert.equal(f.client.ready,false);assert.equal(f.client.lastError.code,'heartbeat_timeout');assert.equal(f.frames.filter(x=>x.op===1).length,1);
});
