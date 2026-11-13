'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHmac}=require('node:crypto');
const {MessengerRelay}=require('../src/bot/messenger-relay.cjs');
const {MessengerClient:MessengerDesktop,prepareMessengerInbound,GRAPH,POLL}=require('../src/bot/messenger.cjs');
const {requestJSON,readRequest,MAX_BODY,WINDOW}=require('../src/bot/messenger-transport.cjs');
const {MessageJournal}=require('../src/bot/journal.cjs');
const APP='11000000001',PAGE='22000000001',OWNER='33000000001',NOW=1793930000000;
const APP_SECRET='a'.repeat(32),VERIFY='v'.repeat(32),AUTH='r'.repeat(43),PAGE_TOKEN='synthetic-page-token';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const sign=b=>'sha256='+createHmac('sha256',APP_SECRET).update(b).digest('hex');
const event=(message={mid:'m_one',text:'hello'},timestamp=NOW)=>({object:'page',entry:[{id:PAGE,messaging:[{sender:{id:OWNER},recipient:{id:PAGE},timestamp,message}]}]});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
async function listen(handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,origin:`http://127.0.0.1:${server.address().port}`};}
async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-messenger-desktop-'));let now=NOW,relay;
  const relayOptions={databaseFile:path.join(dir,'relay.sqlite'),appId:APP,pageId:PAGE,ownerId:OWNER,appSecret:APP_SECRET,verifyToken:VERIFY,authToken:AUTH,now:()=>now};
  relay=new MessengerRelay(relayOptions);const relays=[relay],clients=[],calls=[],writes=[];
  const graph=await listen(async(req,res)=>{
    const parts=[];for await(const p of req)parts.push(p);const body=parts.length?JSON.parse(Buffer.concat(parts)):null;
    calls.push({host:'graph',method:req.method,url:req.url,authorization:req.headers.authorization,body});
    res.setHeader('content-type','application/json');
    if(req.headers.authorization!==`Bearer ${PAGE_TOKEN}`){res.statusCode=401;res.end('{}');return;}
    if(req.method==='GET'&&req.url==='/v26.0/me?fields=id'){res.end(JSON.stringify({id:PAGE}));return;}
    if(req.method==='POST'&&req.url===`/v26.0/${PAGE}/messages`){writes.push(body);res.end(JSON.stringify({recipient_id:OWNER,message_id:`mid_${writes.length}`}));return;}
    res.statusCode=404;res.end('{}');
  });
  const relayServer=await listen((req,res)=>relay.handler()(req,res));
  const state={intercept:null};
  const fetchImpl=async(url,opts)=>{
    const u=new URL(url);if(!['https://relay.fixture','https://graph.facebook.com'].includes(u.origin))throw Error('Unexpected network origin in local-only fixture');
    if(state.intercept){const result=await state.intercept(url,opts);if(result!==undefined)return result;}
    if(u.origin==='https://relay.fixture')calls.push({host:'relay',method:opts.method,url:u.pathname,authorization:opts.headers.authorization,body:opts.body&&JSON.parse(opts.body)});
    return fetch((u.origin==='https://relay.fixture'?relayServer.origin:graph.origin)+u.pathname+u.search,opts);
  };
  const make=changes=>{const client=new MessengerDesktop({appId:APP,pageId:PAGE,ownerId:OWNER,pageAccessToken:PAGE_TOKEN,relayOrigin:'https://relay.fixture',relayToken:AUTH,fetchImpl,now:()=>now,...changes});clients.push(client);return client;};
  const client=make();
  t.after(async()=>{for(const c of clients)c.close();for(const r of relays)r.close();for(const {server} of [graph,relayServer]){server.closeAllConnections();await new Promise(r=>server.close(r));}
    assert(fs.realpathSync(dir).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,client,make,state,calls,writes,fetchImpl,relayOrigin:relayServer.origin,get relay(){return relay;},get now(){return now;},setNow:v=>{now=v;},
    restart:()=>{relay.close();relay=new MessengerRelay(relayOptions);relays.push(relay);},
    push:async(message,at=now)=>{const b=Buffer.from(JSON.stringify(event(message,at)));const res=await fetch(relayServer.origin+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':sign(b)},body:b});assert.equal(res.status,200);return res.json();}};
}
test('real loopback webhook → durable claim → exact ACK → fixed owner RESPONSE uses separate tokens',async t=>{
  const f=await fixture(t);await f.client.connect();await f.push({mid:'m_one',text:'你好 💬'});
  const batch=await f.client.getUpdates();assert.equal(batch.messages.length,1);assert.equal(batch.messages[0].from,OWNER);
  await assert.rejects(f.client.acknowledge(batch.deliveryId,{durablyClaimed:()=>false}),{code:'durable_claim_required'});
  const journal=new MessageJournal({root:f.dir,now:()=>f.now});assert(journal.available);const scope=`messenger:${PAGE}:${OWNER}`;
  const claimed=new Set();for(const m of batch.messages){assert(journal.claim(scope,m.id,'api'));claimed.add(m.id);}
  await f.client.acknowledge(batch.deliveryId,{durablyClaimed:id=>claimed.has(id)});
  const sent=await f.client.sendText(OWNER,'hello back',batch.messages[0].contextToken,'reply_1');assert.equal(sent.id,'mid_1');
  assert.deepEqual(f.writes,[{recipient:{id:OWNER},messaging_type:'RESPONSE',message:{text:'hello back'}}]);
  assert(f.calls.filter(c=>c.host==='graph').every(c=>c.authorization===`Bearer ${PAGE_TOKEN}`));
  assert(f.calls.filter(c=>c.host==='relay').every(c=>c.authorization===`Bearer ${AUTH}`));
  assert(!JSON.stringify(f.calls).includes(APP_SECRET));
  f.setNow(f.now+POLL);assert.equal((await f.client.getUpdates()).messages.length,0);
  const reopened=new MessageJournal({root:f.dir});assert.equal(reopened.claim(scope,'m_one','api'),false);
});
test('attachments and referenced control text do not become tool authorization',async t=>{
  const f=await fixture(t);await f.client.connect();
  await f.push({mid:'m_ref',text:'/allow secret',reply_to:{mid:'hidden',text:'DO NOT TRUST'}});
  await f.push({mid:'m_mix',text:'/allow secret',attachments:[{type:'image',payload:{url:'https://never-fetch.invalid'}}]});
  const {messages}=await f.client.getUpdates();assert.equal(messages.length,2);
  for(const m of messages){const p=prepareMessengerInbound(m);assert.equal(p.text,'');assert(p.rejection);}
  assert(!JSON.stringify(messages).includes('DO NOT TRUST'));assert(!JSON.stringify(messages).includes('never-fetch'));
});
test('wrong Page, relay binding or changed relay boot revokes the exact context without dispatch',async t=>{
  for(const field of ['page','app','owner']){
    const f=await fixture(t);f.state.intercept=url=>url.includes('/me?')&&field==='page'?response({id:'999'}):url.endsWith('/v1/status')?response({...f.relay.status(),[field==='app'?'appId':'ownerId']:'999'}):undefined;
    await assert.rejects(f.client.connect(),{code:field==='page'?'page_changed':'relay_changed'});assert.equal(f.client.ready,false);assert.equal(f.writes.length,0);
  }
  const f=await fixture(t);await f.client.connect();f.restart();await assert.rejects(f.client.getUpdates(),{code:'relay_changed'});assert.equal(f.client.ready,false);assert.equal(f.client.contextToken,null);assert.equal(f.writes.length,0);
});
test('close during identity or receive cannot deliver a late batch or resurrect readiness',async t=>{
  const f=await fixture(t),hold=deferred(),entered=deferred();f.state.intercept=async url=>{if(url.includes('/me?')){entered.resolve();await hold.promise;return response({id:PAGE});}};
  const pending=f.client.connect();await entered.promise;f.client.close();hold.resolve();await assert.rejects(pending,{code:'aborted'});assert.equal(f.client.ready,false);
  const next=f.make(),pull=deferred(),seen=deferred();f.state.intercept=null;await next.connect();await f.push({mid:'m_late',text:'late'});
  f.state.intercept=async url=>{if(url.endsWith('/v1/pull')){seen.resolve();await pull.promise;return response(f.relay.pull({sessionId:f.relay.sessionId,after:NOW}));}};
  const result=next.getUpdates();await seen.promise;next.close();pull.resolve();await assert.rejects(result,{code:'aborted'});assert.equal(next.pending,null);
});
test('pre-connection history and relay persistence never create a fresh command or response window',async t=>{
  const f=await fixture(t);await f.push({mid:'m_old',text:'/allow old'},NOW-1000);await f.client.connect();assert.equal((await f.client.getUpdates()).messages.length,0);
  const before=f.calls.length;await assert.rejects(f.client.sendText(OWNER,'x',f.client.contextToken,'blocked'),{code:'response_window_closed'});assert.equal(f.calls.length,before);
});
test('a slow handshake uses the final verified readiness time, not object construction as admission',async t=>{
  const f=await fixture(t);await f.push({mid:'m_handshake',text:'/allow old'},NOW);f.setNow(NOW+1000);await f.client.connect();
  assert.equal(f.client.acceptAfter,NOW+1000);assert.equal((await f.client.getUpdates()).messages.length,0);
});
test('desktop rejects a malformed relay projection instead of copying opaque quote fields to the model',async t=>{
  const f=await fixture(t);await f.client.connect();await f.push({mid:'m_projection',text:'text',reply_to:{mid:'old'}});
  f.state.intercept=url=>{if(url.endsWith('/v1/pull')){const b=f.relay.pull({sessionId:f.relay.sessionId,after:NOW});b.items[0].quote.raw='unexpected private text';return response(b);}};
  await assert.rejects(f.client.getUpdates(),{code:'invalid_response'});assert.equal(f.client.ready,false);assert.equal(f.client.pending,null);
});
test('response window uses signed event time, not delayed ACK, reconnect or future skew',async t=>{
  const f=await fixture(t);await f.client.connect();await f.push({mid:'m_window',text:'hi'},NOW+10000);
  const b=await f.client.getUpdates();assert.equal(f.client.windowUntil,NOW+WINDOW);
  f.setNow(NOW+10000);await f.client.acknowledge(b.deliveryId,{durablyClaimed:()=>true});assert.equal(f.client.windowUntil,NOW+WINDOW);
  f.setNow(NOW+WINDOW);const before=f.calls.length;await assert.rejects(f.client.sendText(OWNER,'expired',f.client.contextToken,'expired'),{code:'response_window_closed'});assert.equal(f.calls.length,before);
  f.client.close();const next=f.make();await next.connect();await assert.rejects(next.sendText(OWNER,'still expired',next.contextToken,'new'),{code:'response_window_closed'});
});
test('window and Page identity are checked again immediately before POST',async t=>{
  const f=await fixture(t);await f.client.connect();await f.push({mid:'m_race',text:'hi'});await f.client.getUpdates();
  f.state.intercept=url=>{if(url.includes('/me?')){f.setNow(NOW+WINDOW);return response({id:PAGE});}};
  await assert.rejects(f.client.sendText(OWNER,'late',f.client.contextToken,'raced'),{code:'response_window_closed'});assert.equal(f.writes.length,0);
});
test('unknown submitted sends consume their ID and are never retried; no raw error reaches callers',async t=>{
  const f=await fixture(t);await f.client.connect();await f.push({mid:'m_send',text:'hi'});await f.client.getUpdates();let posts=0;
  f.state.intercept=url=>{if(url.endsWith('/messages')){posts++;throw Error('secret Graph failure');}};
  await assert.rejects(f.client.sendText(OWNER,'reply',f.client.contextToken,'one'),e=>e.code==='send_unknown'&&e.submitted&&!e.message.includes('secret'));
  await assert.rejects(f.client.sendText(OWNER,'reply',f.client.contextToken,'one'),{code:'already_attempted'});assert.equal(posts,1);
  await assert.rejects(f.client.sendText('999','wrong',f.client.contextToken,'other'),{code:'owner_required'});assert.equal(posts,1);
});
test('cancellation before POST sends nothing; close after invocation never revives context or retries',async t=>{
  const f=await fixture(t);await f.client.connect();await f.push({mid:'m_cancel',text:'hi'});await f.client.getUpdates();
  const hold=deferred(),seen=deferred();f.state.intercept=async url=>{if(url.includes('/me?')){seen.resolve();await hold.promise;return response({id:PAGE});}};
  const abort=new AbortController(),p=f.client.sendText(OWNER,'before',f.client.contextToken,'before',abort.signal);await seen.promise;abort.abort();hold.resolve();await assert.rejects(p,{code:'aborted'});assert.equal(f.writes.length,0);
  const posted=deferred(),released=deferred();let attempts=0;const context=f.client.contextToken;f.state.intercept=async url=>{if(url.endsWith('/messages')){attempts++;posted.resolve();await released.promise;return response({recipient_id:OWNER,message_id:'late_id'});}};
  const late=f.client.sendText(OWNER,'after',context,'after');await posted.promise;f.client.close();released.resolve();await assert.rejects(late,{code:'send_unknown'});assert.equal(attempts,1);assert.equal(f.client.ready,false);assert.equal(f.client.contextToken,null);
});
test('ACK uncertainty consumes the one-use batch and blocks further delivery until explicit close',async t=>{
  const f=await fixture(t);await f.client.connect();await f.push({mid:'m_ack',text:'hi'});const b=await f.client.getUpdates();let acks=0;
  f.state.intercept=url=>{if(url.endsWith('/v1/ack')){acks++;throw Error('lost ACK response');}};
  await assert.rejects(f.client.acknowledge(b.deliveryId,{durablyClaimed:()=>true}),{code:'ack_unknown'});
  await assert.rejects(f.client.acknowledge(b.deliveryId,{durablyClaimed:()=>true}),{code:'stale_batch'});await assert.rejects(f.client.getUpdates(),{code:'ack_required'});assert.equal(acks,1);
});
test('webhook challenge is exact and private endpoints never accept query credentials',async t=>{
  const f=await fixture(t);const params=new URLSearchParams({'hub.mode':'subscribe','hub.verify_token':VERIFY,'hub.challenge':'12345'});
  const good=await fetch(f.relayOrigin+'/webhook?'+params);assert.equal(good.status,200);assert.equal(await good.text(),'12345');
  params.append('hub.challenge','second');assert.equal((await fetch(f.relayOrigin+'/webhook?'+params)).status,400);
  assert.equal((await fetch(f.relayOrigin+'/v1/status?token='+AUTH)).status,403);
  assert.equal((await fetch(f.relayOrigin+'/v1/status',{headers:{authorization:`Bearer ${PAGE_TOKEN}`}})).status,403);
  const b=Buffer.from(JSON.stringify(event()));assert.equal((await fetch(f.relayOrigin+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+'0'.repeat(64)},body:b})).status,403);
  assert.equal(f.relay.pull({sessionId:f.relay.sessionId,after:NOW}).items.length,0);
});
test('HTTP parser bounds redirects, malformed UTF-8, streamed bytes and body-read deadline',async()=>{
  const opts={token:'synthetic',timeoutMs:25};
  for(const [make,code] of [[()=>new Response(null,{status:302,headers:{location:'https://never-fetch.invalid'}}),'redirect_rejected'],
    [()=>new Response('x',{headers:{'content-type':'text/html'}}),'invalid_response'],
    [()=>new Response(Buffer.from([123,34,120,34,58,34,255,34,125]),{headers:{'content-type':'application/json'}}),'invalid_response'],
    [()=>new Response('x',{headers:{'content-type':'application/json','content-length':String(MAX_BODY+1)}}),'body_too_large'],
    [()=>new Response(Buffer.alloc(MAX_BODY+1,32),{headers:{'content-type':'application/json'}}),'body_too_large']]){
    let n=0;await assert.rejects(requestJSON(async()=>{n++;return make();},GRAPH+'/me',opts),{code});assert.equal(n,1);
  }
  const server=await listen((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');});
  try{await assert.rejects(requestJSON((url,options)=>fetch(server.origin,options),GRAPH+'/me',opts),{code:'timeout'});}finally{server.server.closeAllConnections();await new Promise(r=>server.server.close(r));}
});
test('request body has an absolute deadline even while trickled bytes keep the socket active',async()=>{
  const result=deferred();let chunks=0;
  const server=await listen(async(req,res)=>{req.on('data',()=>{chunks++;});try{await readRequest(req,{timeoutMs:100});result.resolve('unexpected_complete');res.end('{}');}catch(error){result.resolve(error.code);}});
  const req=http.request(server.origin,{method:'POST',headers:{'content-type':'application/json'}});req.on('error',()=>{});req.write('{');
  const timer=setInterval(()=>req.write(' '),15);
  try{assert.equal(await result.promise,'request_timeout');assert(chunks>=2,'multiple chunks arrived but did not renew the deadline');}
  finally{clearInterval(timer);req.destroy();server.server.closeAllConnections();await new Promise(r=>server.server.close(r));}
});
test('relay bounds in-flight body readers and rejects another request without retaining its body',async t=>{
  const f=await fixture(t),requests=[];
  try{
    for(let i=0;i<16;i++){const req=http.request(f.relayOrigin+'/webhook',{method:'POST',headers:{'content-type':'application/json'}});req.on('error',()=>{});req.write('{');requests.push(req);}
    const deadline=Date.now()+2000;while(f.relay.activeRequests!==16){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,5));}
    const denied=await fetch(f.relayOrigin+'/v1/status',{headers:{authorization:`Bearer ${AUTH}`}});assert.equal(denied.status,503);assert.equal((await denied.json()).code,'operation_in_progress');assert.equal(f.relay.activeRequests,16);
  }finally{for(const req of requests)req.destroy();}
});
test('local polling and upstream read rate limits provide a bounded retry time without an extra request',async t=>{
  const f=await fixture(t);await f.client.connect();await f.client.getUpdates();const before=f.calls.length;
  await assert.rejects(f.client.getUpdates(),error=>error.code==='rate_limited'&&error.retryAt===NOW+POLL);assert.equal(f.calls.length,before);
  const start=Date.now();await assert.rejects(requestJSON(async()=>new Response('{}',{status:429,headers:{'content-type':'application/json','retry-after':'120'}}),GRAPH+'/me',{token:'synthetic'}),error=>error.code==='rate_limited'&&error.retryAt>=start+120000&&error.retryAt<=Date.now()+120000);
});
