'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createXTransport,MAX_RESPONSE_BYTES,XError}=require('../src/bot/x-transport.cjs');
const {XDirectMessageClient}=require('../src/bot/x-dm.cjs');
const SELF='910000000000000001',OWNER='920000000000000001',NOW=1793920000000;
async function server(t,handle){
  const s=http.createServer(handle);await new Promise(r=>s.listen(0,'127.0.0.1',r));
  t.after(async()=>{s.closeAllConnections();await new Promise(r=>s.close(r));});return `http://127.0.0.1:${s.address().port}`;
}
function mapper(origin,calls){return (url,opts)=>{
  const parsed=new URL(url);assert.equal(parsed.origin,'https://api.x.com');calls.push({url,method:opts.method,redirect:opts.redirect});
  return fetch(origin+parsed.pathname+parsed.search,opts);
};}
function json(res,value,status=200,headers={}){res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(value));}
test('real native fetch reaches only fixed local fixture routes with owner text and exact receipt',{timeout:5000},async t=>{
  const requests=[],calls=[];const origin=await server(t,async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;requests.push({path:req.url,method:req.method,auth:req.headers.authorization,body});
    if(req.url==='/2/users/me')return json(res,{data:{id:SELF}});
    if(req.method==='POST')return json(res,{data:{dm_event_id:'930000000000000003',dm_conversation_id:`${SELF}-${OWNER}`}});
    return json(res,{data:[{id:'930000000000000001',sender_id:OWNER,dm_conversation_id:`${SELF}-${OWNER}`,event_type:'MessageCreate',created_at:new Date(NOW).toISOString(),text:'hello'}],meta:{result_count:1}});
  });
  const client=new XDirectMessageClient({accessToken:'synthetic-only',expectedAccountId:SELF,ownerId:OWNER,now:()=>NOW,
    transportFactory:opts=>createXTransport({...opts,fetchImpl:mapper(origin,calls),timeoutMs:1000})});
  t.after(()=>client.close());const incoming=(await client.getUpdates()).messages[0];assert.equal(incoming.text,'hello');
  const receipt=await client.sendText(OWNER,'local reply',incoming.contextToken,'local001');assert.equal(receipt.id,'930000000000000003');
  assert(requests.every(x=>x.auth==='Bearer synthetic-only'));assert(calls.every(x=>x.redirect==='manual'));
  const post=requests.find(x=>x.method==='POST');assert.equal(post.path,`/2/dm_conversations/with/${OWNER}/messages`);assert.deepEqual(JSON.parse(post.body),{text:'local reply'});
  assert(!post.body.includes('local001'));assert.equal(requests.filter(x=>x.method==='POST').length,1);
});
test('redirect never reaches a second server and carries no token across it',async t=>{
  let foreign=0;const second=await server(t,(req,res)=>{foreign++;json(res,{});});
  const first=await server(t,(req,res)=>{res.writeHead(302,{location:second+'/stolen'});res.end();});
  const transport=createXTransport({accessToken:'synthetic-only',ownerId:OWNER,fetchImpl:mapper(first,[])});t.after(()=>transport.close());
  await assert.rejects(transport.me(),{code:'redirect_rejected'});assert.equal(foreign,0);
});
test('status errors are fixed and do not echo raw text or credentials',async t=>{
  let status=401;const origin=await server(t,(req,res)=>json(res,{secret:'DO_NOT_RETURN'},status,{'retry-after':'90'}));
  const tr=createXTransport({accessToken:'synthetic-only',ownerId:OWNER,fetchImpl:mapper(origin,[]),now:()=>NOW});t.after(()=>tr.close());
  for(const [value,code] of [[401,'requires_reauthorization'],[402,'credits_required'],[403,'permission_denied'],[429,'rate_limited'],[500,'connection_failed']]){
    status=value;await assert.rejects(tr.me(),e=>e.code===code&&!e.message.includes('DO_NOT_RETURN'));
  }
});
test('response bounds cover content-length, chunked body, malformed UTF8 and MIME',async t=>{
  let kind='length';const origin=await server(t,(req,res)=>{
    if(kind==='length'){res.writeHead(200,{'content-type':'application/json','content-length':MAX_RESPONSE_BYTES+1});return res.end();}
    if(kind==='chunked'){res.writeHead(200,{'content-type':'application/json'});return res.end(' '.repeat(MAX_RESPONSE_BYTES+1));}
    if(kind==='utf8'){res.writeHead(200,{'content-type':'application/json'});return res.end(Buffer.from([123,34,120,34,58,34,255,34,125]));}
    res.writeHead(200,{'content-type':'text/html'});res.end('{}');
  });
  const tr=createXTransport({accessToken:'synthetic-only',ownerId:OWNER,fetchImpl:mapper(origin,[]),timeoutMs:1000});t.after(()=>tr.close());
  for(const [value,code] of [['length','response_too_large'],['chunked','response_too_large'],['utf8','invalid_response'],['mime','invalid_response']]){
    kind=value;await assert.rejects(tr.me(),{code});
  }
});
test('timeout remains active through body read; explicit close aborts pending response',async t=>{
  const origin=await server(t,(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');});
  const tr=createXTransport({accessToken:'synthetic-only',ownerId:OWNER,fetchImpl:mapper(origin,[]),timeoutMs:40});
  await assert.rejects(tr.me(),{code:'timeout'});tr.close();
  const next=createXTransport({accessToken:'synthetic-only',ownerId:OWNER,fetchImpl:mapper(origin,[]),timeoutMs:1000});
  const pending=next.me();setTimeout(()=>next.close(),20);await assert.rejects(pending,{code:'closed'});
});
test('POST timeout and invalid receipt body are one attempt with unknown outcome',async t=>{
  let posts=0,kind='wait';const origin=await server(t,(req,res)=>{posts++;if(kind==='wait'){res.writeHead(200,{'content-type':'application/json'});res.write('{');}else json(res,[]);});
  const tr=createXTransport({accessToken:'synthetic-only',ownerId:OWNER,fetchImpl:mapper(origin,[]),timeoutMs:40});t.after(()=>tr.close());
  for(const value of ['wait','invalid']){kind=value;await assert.rejects(tr.sendText({text:'hello',assertCurrent:()=>{}}),e=>e.code==='send_unknown'&&e.submitted===true);}
  assert.equal(posts,2);
});
test('fixed transport rejects bad owner/token/text and stale guard before any fetch',async()=>{
  let calls=0;const fetchImpl=()=>{calls++;throw Error('must not execute');};
  assert.throws(()=>createXTransport({accessToken:'bad\r\nheader',ownerId:OWNER,fetchImpl}),{code:'invalid_token'});
  assert.throws(()=>createXTransport({accessToken:'synthetic-only',ownerId:'../users/me',fetchImpl}),{code:'invalid_owner'});
  const tr=createXTransport({accessToken:'synthetic-only',ownerId:OWNER,fetchImpl});
  await assert.rejects(tr.sendText({text:'x'.repeat(6001)}),{code:'invalid_text'});
  await assert.rejects(tr.sendText({text:'\uD800'}),{code:'invalid_text'});
  await assert.rejects(tr.sendText({text:'x',assertCurrent:()=>{throw new XError('stale_context');}}),{code:'stale_context'});
  await assert.rejects(async()=>tr.events({paginationToken:'../../host'}),{code:'invalid_pagination'});assert.equal(calls,0);tr.close();
});
