'use strict';
// Local MCP/HTTP fixtures only. No Claude model, account, or WeChat is contacted.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');
const {z} = require('zod');
const {createChannel} = require('../src/bot/native-channel.cjs');
const {NativeBroker} = require('../src/bot/native-broker.cjs');
const TOKEN = 'a'.repeat(64), CLIENT = 'b'.repeat(32), URL = 'http://127.0.0.1:43123';
const json = value => new Response(JSON.stringify(value), {headers:{'Content-Type':'application/json'}});
const permission = (id='abcde', extra={}) => ({method:'notifications/claude/channel/permission_request',
  params:{request_id:id,tool_name:'Write',description:'Synthetic file action',input_preview:'{"file_path":"fixture.txt"}',...extra}});
const waitFor = async predicate => {
  const end = Date.now() + 3000;
  while (!predicate()) {if (Date.now()>end) throw Error('Fixture condition timed out'); await new Promise(resolve=>setTimeout(resolve,5));}
};
class FakeMCP {
  requests = new Map(); notifications = new Map(); sent = []; closed = 0;
  setRequestHandler(schema, handler) {this.requests.set(schema.shape.method.value, handler);}
  setNotificationHandler(schema, handler) {this.notifications.set(schema.shape.method.value, handler);}
  async notification(message) {this.sent.push(message);}
  async connect() {}
  async close() {this.closed++; this.onclose?.();}
}
async function fixture(t, overrides={}, channelOptions={}) {
  const mcp = new FakeMCP(), calls = [], errors = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    const route = new globalThis.URL(url).pathname;
    if (overrides[route]) return overrides[route](options);
    if (route === '/attached') return json({client_id:CLIENT});
    if (route === '/events') return new Promise((resolve,reject)=> {
      if (options.signal.aborted) reject(Error('Fixture aborted'));
      else options.signal.addEventListener('abort', ()=>reject(Error('Fixture aborted')), {once:true});
    });
    if (route === '/permission') return json({code:'fixture-code',relayed:true});
    if (route === '/reply') return json({accepted:true});
    return json({});
  };
  const channel = createChannel({url:URL,token:TOKEN,mcp,fetchImpl,onError:code=>errors.push(code),...channelOptions});
  t.after(()=>channel.close());
  await channel.start({});
  assert.equal(calls.length,0,'Transport connect alone is not MCP initialization');
  mcp.oninitialized();
  await waitFor(()=>calls.some(call=>call.url.includes('/events?')));
  return {channel,mcp,calls,errors};
}

test('fixture channel rejects non-loopback URLs and invalid capability tokens without echoing them', () => {
  for (const url of ['https://127.0.0.1:43123','http://localhost:43123','http://127.1:43123','http://127.0.0.1:43123/path',
    'http://owner@127.0.0.1:43123','http://127.0.0.1:43123/?token=secret','http://127.0.0.1:65536']) {
    assert.throws(()=>createChannel({url,token:TOKEN}),{code:'invalid_bridge_address'});
  }
  assert.throws(()=>createChannel({url:URL,token:'fixture-not-a-capability'}),{code:'invalid_bridge_capability'});
});

test('fixture initialization attaches once and authenticates every subsequent broker request', async t => {
  const {channel,mcp,calls} = await fixture(t);
  mcp.oninitialized();
  await channel.receive({events:[{seq:1,type:'message',id:'fixture-task',text:'Synthetic task'}]});
  const result = await mcp.requests.get('tools/call')({params:{name:'reply',arguments:{id:'fixture-task',text:'Synthetic reply'}}});
  assert.equal(result.isError,undefined);
  assert.match(result.content[0].text,/Recipient receipt is unknown/);
  assert.equal(calls.filter(call=>call.url.endsWith('/attached')).length,1);
  for (const {url,options} of calls) {
    assert.equal(options.headers.Authorization,`Bearer ${TOKEN}`);
    assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');
    assert.equal(options.headers['X-Arcade-Client'],url.endsWith('/attached')?undefined:CLIENT);
    assert(options.signal instanceof AbortSignal);
  }
});

test('fixture channel forwards a bounded message once and binds reply tools to its actual id', async t => {
  const {channel,mcp,calls} = await fixture(t);
  const event = {seq:1,type:'message',id:'fixture-task',text:'Synthetic task'};
  await channel.receive({events:[event]});
  await channel.receive({events:[event,{...event,seq:2}]});
  assert.deepEqual(mcp.sent,[{method:'notifications/claude/channel',params:{content:event.text,meta:{task_id:event.id}}}]);
  for (const args of [{id:'wrong-task',text:'Synthetic reply'},{id:event.id,text:'x'.repeat(12001)},
    {id:event.id,text:'Synthetic reply',recipient:'unbound-owner'}]) {
    const result=await mcp.requests.get('tools/call')({params:{name:'reply',arguments:args}});
    assert.equal(result.isError,true);
  }
  assert.equal(calls.filter(call=>call.url.endsWith('/reply')).length,0);
  await assert.rejects(channel.receive({events:[{seq:3,type:'message',text:'Missing id'}]}),{code:'invalid_bridge_message'});
  await assert.rejects(channel.receive({events:[{seq:3,type:'message',id:'fixture-task-2',text:'x'.repeat(6001)}]}),{code:'invalid_bridge_message'});
});

test('fixture first message write rejection does not commit its id or cursor before an explicit batch retry', async t => {
  const {channel,mcp,calls}=await fixture(t);
  const send=mcp.notification.bind(mcp);let attempts=0;
  mcp.notification=async message=>{if(++attempts===1)throw Error('Synthetic write rejection');await send(message);};
  const batch={events:[{seq:1,type:'message',id:'fixture-first',text:'First synthetic task'},
    {seq:2,type:'message',id:'fixture-second',text:'Second synthetic task'}]};
  await assert.rejects(channel.receive(batch),{code:'mcp_write_failed'});
  assert.equal(mcp.sent.length,0,'The later event must not be consumed after the first write fails');
  const earlyReply=await mcp.requests.get('tools/call')({params:{name:'reply',arguments:{id:'fixture-first',text:'Synthetic reply'}}});
  assert.equal(earlyReply.isError,true,'A failed message write must not bind the reply tool');
  assert.equal(calls.filter(call=>call.url.endsWith('/reply')).length,0);
  await channel.receive(batch);
  assert.deepEqual(mcp.sent.map(message=>message.params.meta.task_id),['fixture-first','fixture-second']);
  assert.equal(attempts,3);
  await channel.receive(batch);
  assert.equal(attempts,3,'A successfully committed batch is still deduplicated');
});

test('fixture permission relay preserves native previews and accepts only a bound one-time verdict', async t => {
  const {channel,mcp,calls} = await fixture(t);
  const input = permission();
  await mcp.notifications.get(input.method)(input);
  const posted = calls.find(call=>call.url.endsWith('/permission'));
  assert.deepEqual(JSON.parse(posted.options.body),{request_id:'abcde',tool_name:'Write',
    input:input.params.input_preview,description:input.params.description});
  await channel.receive({events:[
    {seq:1,type:'permission_reply',request_id:'zzzzz',behavior:'allow'},
    {seq:2,type:'permission_reply',request_id:'abcde',behavior:'always_allow'},
    {seq:3,type:'permission_reply',request_id:'abcde',behavior:'allow'},
    {seq:4,type:'permission_reply',request_id:'abcde',behavior:'allow'},
  ]});
  assert.deepEqual(mcp.sent,[{method:'notifications/claude/channel/permission',params:{request_id:'abcde',behavior:'allow'}}]);
  await mcp.notifications.get(input.method)(permission('fghij'));
  await channel.close();
  assert.deepEqual(mcp.sent.at(-1),{method:'notifications/claude/channel/permission',params:{request_id:'fghij',behavior:'deny'}});
});

test('fixture failed verdict write retains its pending request and does not consume later events', async t => {
  const {channel,mcp}=await fixture(t);
  await mcp.notifications.get('notifications/claude/channel/permission_request')(permission());
  const send=mcp.notification.bind(mcp);let attempts=0;
  mcp.notification=async message=>{if(++attempts===1)throw Error('Synthetic verdict rejection');await send(message);};
  const batch={events:[{seq:1,type:'permission_reply',request_id:'abcde',behavior:'deny'},
    {seq:2,type:'message',id:'fixture-after-verdict',text:'Synthetic later task'}]};
  await assert.rejects(channel.receive(batch),{code:'mcp_write_failed'});
  assert.equal(mcp.sent.length,0);
  await channel.receive(batch);
  assert.deepEqual(mcp.sent[0],{method:'notifications/claude/channel/permission',params:{request_id:'abcde',behavior:'deny'}});
  assert.equal(mcp.sent[1].params.meta.task_id,'fixture-after-verdict');
  await channel.receive(batch);
  assert.equal(attempts,3,'A successfully written one-time verdict cannot be repeated');
});

test('fixture real poll fails closed on an uncertain MCP write without automatically replaying the batch', async t => {
  const mcp=new FakeMCP(), errors=[], cursors=[];
  mcp.notification=async()=>{throw Error('Synthetic transport write failure');};
  const channel=createChannel({url:URL,token:TOKEN,mcp,onError:code=>errors.push(code),fetchImpl:async url=>{
    const parsed=new globalThis.URL(url);
    if(parsed.pathname==='/attached')return json({client_id:CLIENT});
    if(parsed.pathname==='/events'){
      cursors.push(parsed.searchParams.get('after'));
      return json({events:[{seq:1,type:'message',id:'fixture-first',text:'Synthetic first task'},
        {seq:2,type:'message',id:'fixture-second',text:'Synthetic second task'}]});
    }
    return json({});
  }});
  t.after(()=>channel.close());
  await channel.start({});mcp.oninitialized();await channel.done;
  assert.deepEqual(cursors,['0']);
  assert.deepEqual(errors,['mcp_write_failed']);
  assert.equal(mcp.closed,1);
  await assert.rejects(channel.receive({events:[{seq:1,type:'message',id:'fixture-first',text:'Synthetic first task'}]}),{code:'bridge_closed'});
});

test('fixture no-context permission remains local and oversized relay input is denied', async t => {
  const {channel,mcp} = await fixture(t,{'/permission':()=>json({code:null,relayed:false})});
  await mcp.notifications.get('notifications/claude/channel/permission_request')(permission());
  await channel.receive({events:[{seq:1,type:'permission_reply',request_id:'abcde',behavior:'allow'}]});
  assert.equal(mcp.sent.length,0);
  await mcp.notifications.get('notifications/claude/channel/permission_request')(permission('fghij',{input_preview:'中'.repeat(90000)}));
  assert.deepEqual(mcp.sent,[{method:'notifications/claude/channel/permission',params:{request_id:'fghij',behavior:'deny'}}]);
});

test('fixture reply rejection and timeout cannot report a successful submission', async t => {
  for(const mode of ['not-accepted','timeout'])await t.test(mode,async t=>{
    let requestSignal;
    const {channel,mcp}=await fixture(t,{'/reply':options=>{
      requestSignal=options.signal;
      if(mode==='not-accepted')return json({accepted:false});
      return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('Fixture timeout')),{once:true}));
    }},{timeoutMs:40});
    await channel.receive({events:[{seq:1,type:'message',id:'fixture-task',text:'Synthetic task'}]});
    const reply=await mcp.requests.get('tools/call')({params:{name:'reply',arguments:{id:'fixture-task',text:'Synthetic reply'}}});
    assert.equal(reply.isError,true);
    if(mode==='timeout')assert.equal(requestSignal.aborted,true);
  });
});

test('fixture resync-required closes the relay without reattachment or message replay', async t => {
  const {channel,mcp,calls,errors} = await fixture(t,{'/events':()=>new Response('{"error":"resync_required"}',{status:409})});
  await channel.done;
  assert.equal(calls.filter(call=>call.url.endsWith('/attached')).length,1);
  assert.equal(calls.filter(call=>call.url.includes('/events?')).length,1);
  assert.deepEqual(errors,['resync_required']);
  assert.equal(mcp.closed,1);
});

test('fixture real NativeBroker accepts attachment, a 128-event batch and explicit detach revocation', async t => {
  const broker=await new NativeBroker({send:async()=>{}}).start(), mcp=new FakeMCP();
  const channel=createChannel({url:broker.url,token:broker.token,mcp});
  t.after(async()=>{await channel.close();await broker.close();});
  await channel.start({});mcp.oninitialized();
  await waitFor(()=>broker.nativeSnapshot().attached);
  // Server attachment is recorded before its HTTP response reaches the client.
  // An active authenticated poll proves the client actually learned its ID.
  await waitFor(()=>!!broker.waiter);
  // The broker retains 128 events; an all-unknown batch cannot approve a tool.
  await channel.receive({events:Array.from({length:128},(_,index)=>({seq:index+1,type:'fixture-unknown'}))});
  assert.equal(mcp.sent.length,0);
  await channel.close();
  await channel.done;
  assert.equal(broker.closed,true);
  assert.equal(broker.nativeSnapshot().attached,false);
});

test('fixture response body bound is enforced even without Content-Length', async t => {
  const mcp=new FakeMCP(), errors=[];
  const channel=createChannel({url:URL,token:TOKEN,mcp,onError:code=>errors.push(code),
    fetchImpl:async()=>new Response(JSON.stringify({client_id:'x'.repeat(210000)}))});
  t.after(()=>channel.close());
  await channel.start({});mcp.oninitialized();await channel.done;
  assert.deepEqual(errors,['bridge_response_too_large']);
  assert.equal(mcp.closed,1);
});

test('fixture real stdio MCP handshake negotiates 2025-11-25 and relays local HTTP only', async t => {
  const pendingPolls=[], events=[{seq:1,type:'message',id:'fixture-stdio-task',text:'Synthetic stdio task'}], posts=[], routes=[];
  const send=(res,value)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const flush=()=>{for(const {res,after} of pendingPolls.splice(0))send(res,{events:events.filter(event=>event.seq>after)});};
  const server=http.createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,`Bearer ${TOKEN}`);
    const url=new globalThis.URL(req.url,'http://127.0.0.1');
    routes.push(url.pathname);
    if(url.pathname==='/attached'){send(res,{client_id:CLIENT});return;}
    assert.equal(req.headers['x-arcade-client'],CLIENT);
    if(url.pathname==='/events'){
      const after=Number(url.searchParams.get('after'));
      if(events.some(event=>event.seq>after))send(res,{events:events.filter(event=>event.seq>after)});
      else pendingPolls.push({res,after});
      return;
    }
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));posts.push({route:url.pathname,body});
    if(url.pathname==='/permission'){
      events.push({seq:2,type:'permission_reply',request_id:body.request_id,behavior:'deny'});flush();
      send(res,{code:'fixture-stdio-code',relayed:true});
    }else send(res,url.pathname==='/reply'?{accepted:true}:{});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={ARCADE_BRIDGE_URL:`http://127.0.0.1:${server.address().port}`,ARCADE_BRIDGE_TOKEN:TOKEN};
  for(const name of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'])if(process.env[name])env[name]=process.env[name];
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve(__dirname,'../src/bot/native-channel.cjs')],env,stderr:'pipe'});
  let negotiated='', stderr='';
  transport.setProtocolVersion=version=>{negotiated=version;};
  const client=new Client({name:'arcade-stdio-fixture',version:'0.0.0'},{capabilities:{}}), received=[];
  client.setNotificationHandler(z.object({method:z.literal('notifications/claude/channel'),params:z.object({content:z.string(),meta:z.record(z.string(),z.string())})}),event=>{received.push(event);});
  client.setNotificationHandler(z.object({method:z.literal('notifications/claude/channel/permission'),params:z.object({request_id:z.string(),behavior:z.enum(['allow','deny'])})}),event=>{received.push(event);});
  t.after(async()=>{
    await client.close();
    for(const {res}of pendingPolls.splice(0))send(res,{events:[],closed:true});
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  });
  transport.stderr?.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-4000);});
  await client.connect(transport);
  assert.equal(negotiated,'2025-11-25');
  assert.deepEqual(client.getServerCapabilities().experimental,{'claude/channel':{},'claude/channel/permission':{}});
  await waitFor(()=>received.some(event=>event.method==='notifications/claude/channel')).catch(error=>{
    error.message+=` (fixture routes: ${routes.join(',')}; received: ${received.length}; child diagnostic: ${stderr})`;throw error;
  });
  assert.equal(received[0].params.meta.task_id,'fixture-stdio-task');
  const tools=await client.listTools();assert.deepEqual(tools.tools.map(tool=>tool.name),['reply']);
  const result=await client.callTool({name:'reply',arguments:{id:'fixture-stdio-task',text:'Synthetic stdio reply'}});
  assert.equal(result.isError,undefined);
  await client.notification(permission());
  await waitFor(()=>received.some(event=>event.method==='notifications/claude/channel/permission'));
  assert.equal(received.at(-1).params.behavior,'deny');
  assert(posts.some(post=>post.route==='/reply'&&post.body.id==='fixture-stdio-task'));
  assert(posts.some(post=>post.route==='/permission'&&post.body.input===permission().params.input_preview));
  assert.equal(stderr.includes(TOKEN),false);
});
