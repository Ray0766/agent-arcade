'use strict';
// Single-token option scorer of the group dispatcher. Every request goes to an injected fetch:
// no network and no model.
const test=require('node:test'),assert=require('node:assert/strict');
const {createScorer,endpointURL,MAX_RESPONSE}=require('../src/bot/dispatcher-scorer.cjs');
const reply=(body,{status=200,headers={}}={})=>({ok:status>=200&&status<300,status,headers:{get:name=>headers[name.toLowerCase()]??null},text:async()=>typeof body==='string'?body:JSON.stringify(body)});
const logprobs=top=>({choices:[{message:{role:'assistant',content:top[0]?.token||''},logprobs:{content:[{token:top[0]?.token||'',top_logprobs:top}]}}]});
const scorer=(respond,options={})=>{const calls=[];const fetchImpl=async(url,init)=>{calls.push({url,init});return respond(url,init);};return {calls,...createScorer({endpoint:'https://api.example.test/v1',key:'test-key-0123456789',model:'tiny-model',fetchImpl,...options})};};
const code=async promise=>{try{await promise;return null;}catch(error){return error.code;}};

test('one request with max_tokens 1 and logprobs; probabilities are normalised over the option letters',async()=>{
  const s=scorer(()=>reply(logprobs([{token:' B',logprob:Math.log(0.6)},{token:'A',logprob:Math.log(0.2)},{token:'B',logprob:Math.log(0.01)},{token:'the',logprob:Math.log(0.15)},{token:'C',logprob:Math.log(0.05)}])));
  const result=await s.score({prompt:'Who?',options:['A','B','C','D']});
  assert.equal(result.choice,'B');
  // The first occurrence of an option token wins; an option that is not among the candidates gets 0.
  assert.deepEqual(Object.keys(result.probs),['A','B','C','D']);
  assert(Math.abs(result.probs.B-0.6/0.85)<1e-9&&Math.abs(result.probs.A-0.2/0.85)<1e-9&&Math.abs(result.probs.C-0.05/0.85)<1e-9);assert.equal(result.probs.D,0);
  assert(Math.abs(result.optionMass-0.85)<1e-9);
  assert.equal(s.calls.length,1);
  const {url,init}=s.calls[0],body=JSON.parse(init.body);
  assert.equal(url,'https://api.example.test/v1/chat/completions');
  assert.deepEqual([init.method,init.redirect,init.headers.Authorization,init.headers['Content-Type']],['POST','error','Bearer test-key-0123456789','application/json']);
  assert(init.signal instanceof AbortSignal);
  assert.deepEqual(body,{model:'tiny-model',max_tokens:1,temperature:0,logprobs:true,top_logprobs:20,messages:[{role:'user',content:'Who?'}]});
});

test('an endpoint without logprobs falls back to the first character of the reply; anything else is no_option',async()=>{
  const plain=scorer(()=>reply({choices:[{message:{role:'assistant',content:'B'}}]}));
  assert.deepEqual(await plain.score({prompt:'Who?',options:['A','B']}),{probs:null,choice:'B',optionMass:null});
  const padded=scorer(()=>reply({choices:[{message:{role:'assistant',content:'  A.'}}],logprobs:null}));
  assert.deepEqual(await padded.score({prompt:'Who?',options:['A','B']}),{probs:null,choice:'A',optionMass:null});
  // Logprobs that hold none of the options: the reply text still decides.
  const other=scorer(()=>reply({choices:[{message:{content:'A'},logprobs:{content:[{token:'x',top_logprobs:[{token:'x',logprob:-0.1},{token:'A',logprob:5}]}]}}]}));
  assert.deepEqual(await other.score({prompt:'Who?',options:['A','B']}),{probs:null,choice:'A',optionMass:null});
  for(const body of [{choices:[{message:{content:'Maybe Bob'}}]},{choices:[{message:{content:''}}]},{choices:[{message:{content:'b'}}]}])assert.equal(await code(scorer(()=>reply(body)).score({prompt:'Who?',options:['A','B']})),'no_option');
  for(const body of ['not json',{choices:[]},{nothing:true},'[]'])assert.equal(await code(scorer(()=>reply(body)).score({prompt:'Who?',options:['A','B']})),'invalid_response');
  // No key: no Authorization header (a local model).
  const local=scorer(()=>reply({choices:[{message:{content:'A'}}]}),{endpoint:'http://127.0.0.1:1234/v1/',key:''});
  await local.score({prompt:'Who?',options:['A','B']});
  assert.equal(local.calls[0].url,'http://127.0.0.1:1234/v1/chat/completions');assert.equal('Authorization' in local.calls[0].init.headers,false);
});

test('HTTP errors, oversized bodies, timeouts and cancellation are coded failures without a retry',async()=>{
  for(const [status,expected] of [[401,'unauthorized'],[403,'unauthorized'],[429,'rate_limited'],[500,'http_error'],[302,'http_error']]){
    const s=scorer(()=>reply({error:'x'},{status}));assert.equal(await code(s.score({prompt:'Who?',options:['A','B']})),expected);assert.equal(s.calls.length,1);
  }
  const declared=scorer(()=>reply('{}',{headers:{'content-length':String(MAX_RESPONSE+1)}}));
  assert.equal(await code(declared.score({prompt:'Who?',options:['A','B']})),'too_large');
  const big=scorer(()=>reply('x'.repeat(MAX_RESPONSE+1)));
  assert.equal(await code(big.score({prompt:'Who?',options:['A','B']})),'too_large');
  // A streamed body is cut at the bound as well.
  const streamed=scorer(()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(40000));}})));
  assert.equal(await code(streamed.score({prompt:'Who?',options:['A','B']})),'too_large');
  const real=scorer(()=>new Response(JSON.stringify({choices:[{message:{content:'A'}}]})));
  assert.equal((await real.score({prompt:'Who?',options:['A','B']})).choice,'A');
  const thrown=scorer(()=>{throw new TypeError('fetch failed');});
  assert.equal(await code(thrown.score({prompt:'Who?',options:['A','B']})),'network');
  const never=scorer(()=>new Promise(()=>{}),{timeoutMs:20});
  assert.equal(await code(never.score({prompt:'Who?',options:['A','B']})),'timeout');assert.equal(never.calls[0].init.signal.aborted,true);assert.equal(never.calls.length,1);
  const controller=new AbortController(),waiting=scorer(()=>new Promise(()=>{}));
  const pending=code(waiting.score({prompt:'Who?',options:['A','B'],signal:controller.signal}));controller.abort();
  assert.equal(await pending,'cancelled');
  const aborted=AbortSignal.abort();
  assert.equal(await code(scorer(()=>reply({})).score({prompt:'Who?',options:['A','B'],signal:aborted})),'cancelled');
});

test('requests and endpoints are validated before anything is sent',async()=>{
  const s=scorer(()=>reply({choices:[{message:{content:'A'}}]}));
  for(const input of [{},{prompt:'',options:['A','B']},{prompt:'x'.repeat(8001),options:['A','B']},{prompt:'x',options:['A']},{prompt:'x',options:['A','A']},{prompt:'x',options:['A','b']},{prompt:'x',options:['A','BC']},{prompt:'x',options:'AB'},{prompt:'x',options:'ABCDEFGHIJKLM'.split('')}])
    assert.equal(await code(s.score(input)),'invalid_request',JSON.stringify(input).slice(0,60));
  assert.equal(s.calls.length,0);
  for(const endpoint of ['http://api.example.test/v1','ftp://127.0.0.1/v1','https://user:pass@api.example.test/v1','https://api.example.test/v1?key=1','https://api.example.test/v1#x','not a url','',null,'https://api.example.test/ v1'])
    assert.throws(()=>endpointURL(endpoint),{code:'invalid_endpoint'},String(endpoint));
  assert.equal(endpointURL('https://api.example.test').href,'https://api.example.test/chat/completions');
  assert.equal(endpointURL('https://api.example.test/api/v3/chat/completions').href,'https://api.example.test/api/v3/chat/completions');
  for(const endpoint of ['http://127.0.0.1:8080/v1','http://localhost:11434/v1','http://[::1]:1234/v1'])assert.equal(endpointURL(endpoint).protocol,'http:');
  assert.throws(()=>createScorer({endpoint:'https://api.example.test/v1',key:'has space',model:'m'}),{code:'invalid_key'});
  assert.throws(()=>createScorer({endpoint:'https://api.example.test/v1',model:''}),{code:'invalid_model'});
  assert.throws(()=>createScorer({endpoint:'https://api.example.test/v1',model:'m',timeoutMs:0}),{code:'invalid_request'});
});

test('probe reports whether the endpoint answers and whether it returns logprobs, and never throws',async()=>{
  assert.deepEqual(await scorer(()=>reply(logprobs([{token:'A',logprob:-0.01},{token:'B',logprob:-5}]))).probe(),{ok:true,logprobs:true});
  assert.deepEqual(await scorer(()=>reply({choices:[{message:{content:'A'}}]})).probe(),{ok:true,logprobs:false});
  assert.deepEqual(await scorer(()=>reply({choices:[{message:{content:'Sure! A'}}]})).probe(),{ok:false,logprobs:false,problem:'no_option'});
  assert.deepEqual(await scorer(()=>reply({},{status:401})).probe(),{ok:false,logprobs:false,problem:'unauthorized'});
  assert.deepEqual(await scorer(()=>{throw Error('down');}).probe(),{ok:false,logprobs:false,problem:'network'});
  const s=scorer(()=>reply({choices:[{message:{content:'A'}}]}));await s.probe();
  assert.deepEqual(JSON.parse(s.calls[0].init.body).max_tokens,1);assert.equal(s.calls.length,1);
});
