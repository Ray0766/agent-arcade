'use strict';
// Streamed conversation-only replies of the API runners. Synthetic event streams and an injected
// Claude client only: no network, key or model is used.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDeepSeekRunner}=require('../src/bot/deepseek-runner.cjs');
const {createGPTRunner}=require('../src/bot/gpt-runner.cjs');
const {createGeminiRunner}=require('../src/bot/gemini-runner.cjs');
const {createDoubaoRunner}=require('../src/bot/doubao-runner.cjs');
const {createClaudeDirectRunner,MODEL}=require('../src/bot/claude-direct-runner.cjs');
const generation=require('../src/bot/generation.cjs');
const KEY='synthetic-streaming-fixture-key';
const encoder=new TextEncoder();
const data=value=>`data: ${typeof value==='string'?value:JSON.stringify(value)}\n\n`;
// The whole stream cut into fixed-size byte pieces: lines and multi-byte characters are split.
function pieces(text,size){const bytes=encoder.encode(text),out=[];for(let i=0;i<bytes.length;i+=size)out.push(bytes.slice(i,i+size));return out;}
function stream(chunks,{status=200,open=false}={}){
  let controller;const body=new ReadableStream({start(c){controller=c;for(const chunk of chunks)c.enqueue(typeof chunk==='string'?encoder.encode(chunk):chunk);if(!open)c.close();}});
  const response=new Response(body,{status,headers:{'content-type':'text/event-stream'}});response.push=chunk=>controller.enqueue(encoder.encode(chunk));return response;
}
function fixture(t,create,responses,options={}){
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-stream-')),seen=[];
  const fetchImpl=async(url,init)=>{seen.push({url,init,body:JSON.parse(init.body),raw:init.body});const next=responses.shift();assert(next,'unexpected model request');return typeof next==='function'?next(url,init):next;};
  const execute=create({workspace,key:KEY,fetchImpl,conversationOnly:true,...options});
  t.after(async()=>{await execute.close();assert(workspace.startsWith(os.tmpdir()));fs.rmSync(workspace,{recursive:true,force:true});});
  const run=(extra={})=>{const deltas=[];return execute({prompt:'Synthetic request',signal:new AbortController().signal,request:async()=>({allow:false}),onDelta:chunk=>deltas.push(chunk),...extra}).then(result=>({result,deltas}));};
  return {seen,execute,run};
}
const chat=(texts,{finish='stop',done=true}={})=>[data({choices:[{index:0,delta:{role:'assistant',content:''}}]}),...texts.map(content=>data({choices:[{index:0,delta:{content}}]})),
  ...(finish?[data({choices:[{index:0,delta:{},finish_reason:finish}],usage:{total_tokens:3}})]:[]),...(done?[data('[DONE]')]:[])].join('');
const TEXT=['你好，','世界 🌊。','\nSecond line: "quoted" \\ done'];

test('readSSE: lines, CRLF, comments, multi-line data and split UTF-8; an unterminated event is discarded',async()=>{
  const read=async(chunks,options={})=>{const events=[];await generation.readSSE(stream(chunks),new AbortController().signal,{maxBytes:4096,label:'Fixture',onData:payload=>{events.push(payload);return payload==='stop';},...options});return events;};
  const text=': keep-alive\r\nevent: note\r\ndata: 一\r\ndata:二\r\n\r\nid: 7\ndata: {"a":"é🌊"}\n\nretry: 5\n\ndata: stop\n\ndata: after\n\n';
  for(const size of [1,2,3,5,64])assert.deepEqual(await read(pieces(text,size)),['一\n二','{"a":"é🌊"}','stop'],'size '+size);
  assert.deepEqual(await read(['data: whole\n\ndata: partial']),['whole']);
  await assert.rejects(read([new Uint8Array([100,97,116,97,58,32,0xff,0xfe,10,10])]),/Fixture returned malformed data/);
  await assert.rejects(read(['data: '+'x'.repeat(5000)+'\n\n']),error=>error.outcome==='limit'&&/size limit/.test(error.message));
  await assert.rejects(generation.readSSE({body:null},new AbortController().signal,{maxBytes:10,label:'Fixture',onData(){}}),/unreadable/);
  // deltaEmitter: best-effort, never throws, ignores empty and non-text chunks.
  assert.equal(generation.deltaEmitter(undefined),null);const got=[];
  const emit=generation.deltaEmitter(chunk=>{got.push(chunk);if(chunk==='boom')throw Error('view failed');return Promise.reject(Error('late'));});
  for(const value of ['a','',5,null,'boom','b'])emit(value);assert.deepEqual(got,['a','boom','b']);await new Promise(resolve=>setImmediate(resolve));
});

test('DeepSeek: streamed text arrives as deltas and resolves with the same final result; the request differs only in stream:true',async t=>{
  const plain=Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:TEXT.join('')}}]});
  for(const size of [1,4,7,4096]){
    const f=fixture(t,createDeepSeekRunner,[stream(pieces(chat(TEXT),size)),plain.clone()]);
    const {result,deltas}=await f.run({sampling:{temperature:0.7,maxTokens:256}});
    assert.equal(result.outcome,'reply_ended');assert.equal(result.text,TEXT.join(''));assert.deepEqual(deltas,TEXT);assert(!Object.hasOwn(result,'notice'));
    const same=await f.execute({prompt:'Synthetic request',signal:new AbortController().signal,request:async()=>({allow:false}),sampling:{temperature:0.7,maxTokens:256}});
    assert.deepEqual({...same,sessionId:''},{...result,sessionId:''});
    assert.equal(f.seen[0].body.stream,true);assert.equal(f.seen[1].body.stream,false);assert.deepEqual({...f.seen[0].body,stream:false},f.seen[1].body);
    assert.equal(f.seen[0].raw.replace('"stream":true','"stream":false'),f.seen[1].raw);
    assert.equal(f.seen[0].init.redirect,'error');assert.deepEqual(f.seen[0].init.headers,f.seen[1].init.headers);assert.equal(f.seen[0].url,f.seen[1].url);
  }
});

test('DeepSeek: a throwing view never reaches the request; task mode is never streamed',async t=>{
  const f=fixture(t,createDeepSeekRunner,[stream([chat(TEXT)])]);
  const result=await f.execute({prompt:'x',signal:new AbortController().signal,request:async()=>({allow:false}),onDelta:()=>{throw Error('view failed');}});
  assert.equal(result.outcome,'reply_ended');assert.equal(result.text,TEXT.join(''));
  const task=fixture(t,createDeepSeekRunner,[Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'task reply'}}]})],{conversationOnly:false});
  const {result:done,deltas}=await task.run();assert.equal(done.text,'task reply');assert.deepEqual(deltas,[]);assert.equal(task.seen[0].body.stream,false);assert.equal(task.seen[0].body.tool_choice,'auto');
});

test('DeepSeek: a stream without a valid end is an error, never a partial reply',async t=>{
  const expectations=[
    [chat(TEXT,{done:false}),'error',/DeepSeek returned malformed data/],
    [chat(TEXT,{finish:null}),'error',/DeepSeek returned malformed data/],
    [chat(TEXT,{finish:null,done:false}),'error',/DeepSeek returned malformed data/],
    [chat(TEXT).replace('data: [DONE]\n\n','data: [DONE]'),'error',/malformed data/],
    [chat(TEXT,{finish:'length'}),'limit',/response token limit/],
    [chat(TEXT,{finish:'content_filter'}),'error',/ended without a complete response/],
    [data({choices:[{delta:{content:'LEAKED'}}]})+'data: {not json\n\n'+data('[DONE]'),'error',/malformed data/],
    [data({choices:[{delta:{content:'LEAKED'}}]})+data([1,2])+data('[DONE]'),'error',/malformed data/],
    [data({choices:[{delta:{content:'a'}},{delta:{content:'b'}}]})+data('[DONE]'),'error',/unsupported response/],
    [data({choices:[{delta:{content:5}}]})+data('[DONE]'),'error',/unsupported response/],
    [data({choices:[{delta:{tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'Write',arguments:'{}'}}]}}]})+data({choices:[{delta:{},finish_reason:'tool_calls'}]})+data('[DONE]'),'error',/tool call was refused/],
    [data({error:{message:'overloaded'}}),'error',/could not complete this request/],
    [data({choices:[{delta:{content:'大'.repeat(400000)}}]})+data({choices:[{delta:{},finish_reason:'stop'}]})+data('[DONE]'),'limit',/exceeded the local size limit/],
  ];
  for(const [body,outcome,message] of expectations){
    const f=fixture(t,createDeepSeekRunner,[stream(pieces(body,1000))]);const {result}=await f.run();
    assert.equal(result.outcome,outcome,body.slice(0,60));assert.match(result.text,message);assert.equal(result.notice,result.text);assert(!result.text.includes('LEAKED'));
  }
  const denied=fixture(t,createDeepSeekRunner,[stream([chat(TEXT)],{status:401})]);const {result,deltas}=await denied.run();
  assert.equal(result.outcome,'error');assert.match(result.text,/rejected the API key/);assert.deepEqual(deltas,[]);
  // A following turn works: the failed stream left no session behind.
  const again=fixture(t,createDeepSeekRunner,[stream([chat(['a'],{done:false})]),stream([chat(['fine'])])]);
  assert.equal((await again.run()).result.outcome,'error');assert.equal((await again.run()).result.text,'fine');
});

test('DeepSeek: abort in the middle of a stream is a cancellation',async t=>{
  const open=stream([data({choices:[{delta:{content:'first '}}]})],{open:true});
  const f=fixture(t,createDeepSeekRunner,[open]),controller=new AbortController(),deltas=[];
  const pending=f.execute({prompt:'x',signal:controller.signal,request:async()=>({allow:false}),onDelta:chunk=>{deltas.push(chunk);controller.abort();}});
  const result=await pending;assert.equal(result.outcome,'cancelled');assert.deepEqual(deltas,['first ']);assert(!result.text.includes('first'));
  // The time limit applies to a stream that never ends.
  const slow=fixture(t,createDeepSeekRunner,[stream([data({choices:[{delta:{content:'slow'}}]})],{open:true})],{timeoutMs:60});
  const timed=await slow.run();assert.equal(timed.result.outcome,'limit');assert.match(timed.result.text,/time limit/);
});

test('Doubao: OpenAI-style stream with CRLF framing; missing [DONE] is malformed',async t=>{
  const body=chat(TEXT).replaceAll('\n\n','\r\n\r\n');
  const f=fixture(t,createDoubaoRunner,[stream([': ping\r\n\r\n',...pieces(body,6)]),Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'plain'}}]})]);
  const {result,deltas}=await f.run();assert.deepEqual([result.outcome,result.text],['reply_ended',TEXT.join('')]);assert.deepEqual(deltas,TEXT);
  const plain=await f.execute({prompt:'Synthetic request',signal:new AbortController().signal,request:async()=>({allow:false})});assert.equal(plain.text,'plain');
  assert.equal(f.seen[0].body.stream,true);assert.equal(f.seen[0].raw.replace('"stream":true','"stream":false'),f.seen[1].raw);assert.equal(f.seen[0].url,f.seen[1].url);
  for(const [text,outcome,message] of [[chat(TEXT,{done:false}),'error',/Doubao returned malformed data/],[chat(TEXT,{finish:'length'}),'limit',/token limit/],[chat([]),'error',/no reply text/],
    [data({choices:[{delta:{content:'x',refusal:'no'}}]})+data({choices:[{delta:{},finish_reason:'stop'}]})+data('[DONE]'),'error',/declined this request/]]){
    const bad=fixture(t,createDoubaoRunner,[stream(pieces(text,9))]);const got=await bad.run();assert.equal(got.result.outcome,outcome);assert.match(got.result.text,message);
  }
  const open=stream([data({choices:[{delta:{content:'first '}}]})],{open:true}),aborting=fixture(t,createDoubaoRunner,[open]),controller=new AbortController();
  assert.equal((await aborting.execute({prompt:'x',signal:controller.signal,request:async()=>({allow:false}),onDelta:()=>controller.abort()})).outcome,'cancelled');
});

test('Gemini: streamGenerateContent chunks are joined and validated like one response',async t=>{
  const part=(text,extra={})=>data({candidates:[{content:{role:'model',parts:[{text}]},index:0,...extra}],usageMetadata:{totalTokenCount:1}});
  const many=Array.from({length:40},(_,index)=>`片段${index}。`);
  const body=many.map(text=>part(text)).join('')+data({candidates:[{content:{role:'model',parts:[{text:'',thoughtSignature:'synthetic-signature'}]},finishReason:'STOP'}]});
  const f=fixture(t,createGeminiRunner,[stream(pieces(body,5)),Response.json({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'plain'}]}}]})]);
  const {result,deltas}=await f.run({sampling:{topP:0.9}});assert.deepEqual([result.outcome,result.text],['reply_ended',many.join('')]);assert.deepEqual(deltas,many);
  await f.execute({prompt:'Synthetic request',signal:new AbortController().signal,request:async()=>({allow:false}),sampling:{topP:0.9}});
  assert(f.seen[0].url.endsWith(':streamGenerateContent?alt=sse'));assert(f.seen[1].url.endsWith(':generateContent'));assert.equal(f.seen[0].url.replace(':streamGenerateContent?alt=sse',':generateContent'),f.seen[1].url);
  assert.equal(f.seen[0].raw,f.seen[1].raw);assert.deepEqual(f.seen[0].init.headers,f.seen[1].init.headers);assert(!f.seen[0].url.includes(KEY));
  const cases=[
    [part('no finish'),'error',/ended without a complete response/],
    [part('cut',{finishReason:'MAX_TOKENS'}),'limit',/token limit/],
    [data({promptFeedback:{blockReason:'SAFETY'}}),'error',/blocked this request/],
    [data({usageMetadata:{}}),'error',/ended without a complete response/],
    [part('a')+'data: {broken\n\n','error',/malformed data/],
    [data({candidates:[{content:{role:'user',parts:[{text:'x'}]},finishReason:'STOP'}]}),'error',/malformed content/],
    [data({candidates:[{content:{role:'model',parts:[{text:'thinking',thought:true}]}}]})+part('answer',{finishReason:'STOP'}),'reply_ended',/^answer$/],
    [data({candidates:[{content:{role:'model',parts:[{functionCall:{name:'Write',args:{}}}]},finishReason:'STOP'}]}),'error',/tool call was refused/],
  ];
  for(const [text,outcome,message] of cases){const bad=fixture(t,createGeminiRunner,[stream(pieces(text,11))]);const got=await bad.run();assert.equal(got.result.outcome,outcome,text.slice(0,50));assert.match(got.result.text,message);if(outcome==='reply_ended')assert.deepEqual(got.deltas,['answer']);}
  const open=stream([part('first')],{open:true}),aborting=fixture(t,createGeminiRunner,[open]),controller=new AbortController();
  assert.equal((await aborting.execute({prompt:'x',signal:controller.signal,request:async()=>({allow:false}),onDelta:()=>controller.abort()})).outcome,'cancelled');
});

test('GPT: Responses events stream text; the terminal response object is validated as before',async t=>{
  const message=(text,extra={})=>({type:'message',id:'msg_1',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}],...extra});
  const event=(type,value)=>`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`;
  const full=TEXT.join(''),completed=(response,type='response.completed')=>event(type,{response});
  const body=event('response.created',{response:{status:'in_progress'}})+event('response.output_item.added',{item:{type:'message',id:'msg_1',role:'assistant',content:[]}})
    +TEXT.map(delta=>event('response.output_text.delta',{item_id:'msg_1',delta})).join('')+event('response.output_text.done',{item_id:'msg_1',text:full})
    +completed({id:'resp_1',status:'completed',output:[{type:'reasoning',id:'rs_1',summary:[],encrypted_content:'SYNTHETIC'},message(full)]});
  for(const size of [1,6,4096]){
    const f=fixture(t,createGPTRunner,[stream(pieces(body,size)),Response.json({id:'resp_2',status:'completed',output:[message(full)]})]);
    const {result,deltas}=await f.run({sampling:{maxTokens:512}});assert.deepEqual([result.outcome,result.text],['reply_ended',full]);assert.deepEqual(deltas,TEXT);
    await f.execute({prompt:'Synthetic request',signal:new AbortController().signal,request:async()=>({allow:false}),sampling:{maxTokens:512}});
    assert.equal(f.seen[0].body.stream,true);assert.equal(f.seen[0].raw.replace('"stream":true','"stream":false'),f.seen[1].raw);assert.equal(f.seen[0].url,f.seen[1].url);assert.equal(f.seen[0].init.redirect,'error');
  }
  const delta=event('response.output_text.delta',{item_id:'msg_1',delta:'LEAKED'});
  const cases=[
    [delta,'error',/OpenAI returned malformed data/],
    [delta+completed({status:'incomplete',output:[]},'response.incomplete'),'limit',/output or context limit/],
    [delta+completed({status:'failed',error:{code:'server_error'}},'response.failed'),'error',/ended without a complete response/],
    [delta+completed({status:'completed',output:[]}),'error',/unsupported response/],
    [delta+completed(null),'error',/malformed data/],
    [delta+event('error',{message:'boom'}),'error',/could not complete this request/],
    [delta+'data: {oops\n\n','error',/malformed data/],
    [delta+completed({status:'completed',output:[{type:'function_call',id:'fc_1',call_id:'call_1',name:'Write',arguments:'{}',status:'completed'}]}),'error',/tool call was refused/],
  ];
  for(const [text,outcome,pattern] of cases){const bad=fixture(t,createGPTRunner,[stream(pieces(text,13))]);const got=await bad.run();assert.equal(got.result.outcome,outcome,text.slice(-80));assert.match(got.result.text,pattern);assert(!got.result.text.includes('LEAKED'));}
  // Commentary is never shown as reply text.
  const commentary=event('response.output_item.added',{item:{type:'message',id:'msg_c',role:'assistant',phase:'commentary'}})+event('response.output_text.delta',{item_id:'msg_c',delta:'thinking aloud'})
    +event('response.output_text.delta',{item_id:'msg_1',delta:'answer'})+completed({status:'completed',output:[{...message('thinking aloud'),id:'msg_c',phase:'commentary'},message('answer',{phase:'final_answer'})]});
  const c=fixture(t,createGPTRunner,[stream([commentary])]);const shown=await c.run();assert.equal(shown.result.text,'answer');assert.deepEqual(shown.deltas,['answer']);
  const open=stream([delta],{open:true}),aborting=fixture(t,createGPTRunner,[open]),controller=new AbortController();
  assert.equal((await aborting.execute({prompt:'x',signal:controller.signal,request:async()=>({allow:false}),onDelta:()=>controller.abort()})).outcome,'cancelled');
  const big=event('response.output_text.delta',{item_id:'msg_1',delta:'x'.repeat(1100000)});
  const large=await fixture(t,createGPTRunner,[stream(pieces(big,65536))]).run();assert.equal(large.result.outcome,'limit');assert.match(large.result.text,/size limit/);
});

test('Claude direct: beta.messages.stream with the same parameters; refusal, limits and abort as before',async()=>{
  function client(final,{texts=[]}={}){
    const calls={create:[],stream:[]};
    const messages={
      create:async(body,request)=>{calls.create.push({body,request});return final(body,request);},
      stream:(body,request)=>{calls.stream.push({body,request});const handlers=[];
        return {on(name,handler){if(name==='text')handlers.push(handler);return this;},finalMessage:async()=>{let snapshot='';for(const text of texts){snapshot+=text;for(const handler of handlers)handler(text,snapshot);await null;}return final(body,request);}};},
    };
    return {calls,factory:options=>({options,beta:{messages}})};
  }
  const reply=()=>({stop_reason:'end_turn',content:[{type:'thinking',thinking:''},{type:'text',text:'你好'},{type:'text',text:'呀'}]});
  const fake=client(reply,{texts:['你','好','呀']}),execute=createClaudeDirectRunner({key:KEY,clientFactory:fake.factory}),deltas=[];
  assert.deepEqual(await execute({prompt:'在吗',sampling:{maxTokens:300},onDelta:chunk=>deltas.push(chunk)}),{sessionId:'',outcome:'reply_ended',text:'你好呀'});
  assert.deepEqual(deltas,['你','好','呀']);assert.equal(fake.calls.create.length,0);assert.equal(fake.calls.stream.length,1);
  assert.deepEqual(await execute({prompt:'在吗',sampling:{maxTokens:300}}),{sessionId:'',outcome:'reply_ended',text:'你好呀'});
  assert.equal(fake.calls.create.length,1);assert.equal(fake.calls.stream.length,1);
  // Identical request either way: model, limits, fallback opt-in, no tools, no stream flag of our own.
  assert.deepEqual(fake.calls.stream[0].body,fake.calls.create[0].body);
  assert.deepEqual(fake.calls.stream[0].body,{model:MODEL,max_tokens:300,system:fake.calls.create[0].body.system,betas:['server-side-fallback-2026-07-01'],fallbacks:'default',messages:[{role:'user',content:'在吗'}]});
  assert(fake.calls.stream[0].request.signal instanceof AbortSignal);
  const run=(final,options,extra={})=>createClaudeDirectRunner({key:KEY,clientFactory:client(final,options).factory})({prompt:'x',onDelta:()=>{throw Error('view failed');},...extra});
  assert.deepEqual(await run(reply,{texts:['a']}),{sessionId:'',outcome:'reply_ended',text:'你好呀'});
  assert.deepEqual(await run(()=>({stop_reason:'refusal',content:[{type:'text',text:'partial'}]}),{texts:['partial']}),{sessionId:'',outcome:'error',text:'Claude declined to answer this message.'});
  assert.equal((await run(()=>({stop_reason:'max_tokens',content:[{type:'text',text:'cut'}]}))).outcome,'limit');
  assert.deepEqual(await run(()=>({stop_reason:'end_turn',content:[]}),{texts:['shown only']}),{sessionId:'',outcome:'error',text:'Claude returned no reply text.'});
  assert.equal((await run(()=>{throw Error('stream broke');},{texts:['partial']})).outcome,'error');
  const controller=new AbortController();
  const waiting=createClaudeDirectRunner({key:KEY,clientFactory:client((body,request)=>new Promise((resolve,reject)=>{if(request.signal.aborted)reject(Error('aborted'));else request.signal.addEventListener('abort',()=>reject(Error('aborted')));}),{texts:['first']}).factory});
  const pending=waiting({prompt:'x',signal:controller.signal,onDelta:()=>controller.abort()});assert.deepEqual(await pending,{sessionId:'',outcome:'cancelled',text:'Task cancelled.'});
});
