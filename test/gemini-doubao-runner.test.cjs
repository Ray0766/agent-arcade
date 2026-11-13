'use strict';
// Synthetic HTTP bodies and temporary local files; no provider credentials or calls.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const gemini=require('../src/bot/gemini-runner.cjs'),doubao=require('../src/bot/doubao-runner.cjs');
const KEY='synthetic-provider-fixture-key';
const providers=[
  {name:'Gemini',create:gemini.createGeminiRunner,info:gemini,reply:text=>({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text}]}}]}),call:(id,name,args)=>({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{functionCall:{id,name,args},thoughtSignature:'synthetic-signed-part'}]}}]})},
  {name:'Doubao',create:doubao.createDoubaoRunner,info:doubao,reply:text=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}]}),call:(id,name,args)=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]})}
];
function fixture(t,provider,responses,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-provider-')),requests=[];
  const run=provider.create({workspace:root,key:KEY,fetchImpl:async(url,init)=>{requests.push({url,init,body:JSON.parse(init.body)});const response=responses.shift();if(typeof response==='function')return response(init);return response instanceof Response?response:Response.json(response);},...options});
  t.after(async()=>{await run.close();assert(root.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});return {root,run,requests};
}
for(const p of providers){
  test(`${p.name}: fixed model/header, bounded app-owned resume and no key in reply/history`,async t=>{
    const f=fixture(t,p,[p.reply('first reply'),p.reply('second reply')]);const one=await f.run({prompt:'hello',request:async()=>{throw Error('no approval');}});
    assert.equal(one.outcome,'reply_ended');const two=await f.run({prompt:'again',resume:one.sessionId,request:async()=>({allow:false})});assert.equal(two.sessionId,one.sessionId);
    const r=f.requests[1];assert(r.url.startsWith(p.info.ENDPOINT));assert.equal(r.init.redirect,'error');assert(!r.url.includes(KEY));assert(!JSON.stringify(r.body).includes(KEY));assert(!JSON.stringify(two).includes(KEY));
    assert.equal(p.name==='Gemini'?r.init.headers['x-goog-api-key']:r.init.headers.Authorization,p.name==='Gemini'?KEY:`Bearer ${KEY}`);
    assert.equal(p.name==='Gemini'?r.body.contents[1].parts[0].text:r.body.messages[2].content,'first reply');
    assert.equal((await f.run({prompt:'wrong resume',resume:'other-session',request:async()=>({allow:true})})).outcome,'error');assert.equal(f.requests.length,2);
  });
  test(`${p.name}: conversation mode has no tools and refuses rogue calls without approvals`,async t=>{
    const f=fixture(t,p,[p.reply('hi'),p.call('rogue','Write',{path:'never.txt',content:'no'})],{conversationOnly:true});let approvals=0;const request=async()=>{approvals++;return {allow:true};};
    const first=await f.run({prompt:'chat',request});assert.equal(first.text,'hi');const body=f.requests[0].body;assert.deepEqual(body.tools,[]);assert.equal(p.name==='Gemini'?body.toolConfig.functionCallingConfig.mode:body.tool_choice,p.name==='Gemini'?'NONE':'none');
    assert.equal((await f.run({prompt:'resume',resume:first.sessionId,request})).outcome,'error');
    assert.equal((await f.run({prompt:'rogue',request})).outcome,'error');assert.equal(approvals,0);assert.deepEqual(fs.readdirSync(f.root),[]);
  });
  test(`${p.name}: exact approved write, denial and repeated tool ID cannot replay`,async t=>{
    const f=fixture(t,p,[p.call('write_1','Write',{path:'one.txt',content:'exact bytes'}),p.reply('written'),p.call('deny_1','Write',{path:'denied.txt',content:'never'}),p.reply('declined'),p.call('write_1','Write',{path:'replayed.txt',content:'never'})]);let approvals=0;
    const first=await f.run({prompt:'write',request:async approval=>{approvals++;assert.equal(approval.kind,'permission');assert.equal(fs.existsSync(path.join(f.root,'one.txt')),false);assert.deepEqual(approval.input,{path:'one.txt',content:'exact bytes'});return {allow:true};}});
    assert.equal(first.outcome,'reply_ended');assert.equal(fs.readFileSync(path.join(f.root,'one.txt'),'utf8'),'exact bytes');
    const continuation=f.requests[1].body;
    if(p.name==='Gemini'){assert.equal(continuation.contents[1].parts[0].thoughtSignature,'synthetic-signed-part');assert.equal(continuation.contents[2].parts[0].functionResponse.id,'write_1');}
    else assert.equal(continuation.messages[3].tool_call_id,'write_1');
    assert.equal((await f.run({prompt:'deny',resume:first.sessionId,request:async()=>{approvals++;return {allow:false};}})).outcome,'reply_ended');assert(!fs.existsSync(path.join(f.root,'denied.txt')));
    assert.equal((await f.run({prompt:'replay',resume:first.sessionId,request:async()=>{approvals++;return {allow:true};}})).outcome,'error');assert.equal(approvals,2);assert(!fs.existsSync(path.join(f.root,'replayed.txt')));
  });
  test(`${p.name}: outside paths and unknown tools are never approved`,async t=>{
    const f=fixture(t,p,[p.call('outside','Write',{path:'../outside.txt',content:'no'}),p.call('shell','Bash',{command:'no'}),p.reply('rejected')]);let calls=0;
    const result=await f.run({prompt:'malicious tool request',request:async()=>{calls++;return {allow:true};}});assert.equal(result.outcome,'reply_ended');assert.equal(calls,0);assert.deepEqual(fs.readdirSync(f.root),[]);
  });
  test(`${p.name}: cancellation while awaiting permission prevents write and close prevents reuse`,async t=>{
    const f=fixture(t,p,[p.call('cancel','Write',{path:'cancelled.txt',content:'no'})]);let approval;const controller=new AbortController();
    const pending=f.run({prompt:'write',signal:controller.signal,request:request=>{approval=request;return new Promise(()=>{});}});
    while(!approval)await new Promise(resolve=>setImmediate(resolve));controller.abort();assert.equal((await pending).outcome,'cancelled');assert(approval.signal.aborted);assert.deepEqual(fs.readdirSync(f.root),[]);await f.run.close();assert.equal((await f.run({prompt:'again',request:async()=>({allow:true})})).outcome,'error');
  });
  test(`${p.name}: stalled fetch and response reads cancel locally without retry or raw errors`,async t=>{
    const controller=new AbortController(),f=fixture(t,p,[()=>new Promise(()=>{})]);const pending=f.run({prompt:'wait',signal:controller.signal,request:async()=>({allow:true})});controller.abort();assert.equal((await pending).outcome,'cancelled');assert.equal(f.requests.length,1);
    const g=fixture(t,p,[new Response(new ReadableStream({start(){}}))]);const second=new AbortController(),reading=g.run({prompt:'read',signal:second.signal,request:async()=>({allow:true})});await new Promise(resolve=>setImmediate(resolve));second.abort();assert.equal((await reading).outcome,'cancelled');
  });
  for(const status of [400,401,403,404,429,500])test(`${p.name}: HTTP ${status} is sanitized and never automatically retried`,async t=>{
    const f=fixture(t,p,[new Response(JSON.stringify({error:KEY+' private upstream details'}),{status})]);const result=await f.run({prompt:'chat',request:async()=>({allow:true})});assert.equal(result.outcome,'error');assert(!JSON.stringify(result).includes(KEY));assert(!result.text.includes('private upstream'));assert.equal(f.requests.length,1);
  });
  test(`${p.name}: oversized/malformed bodies and unsupported models fail closed`,async t=>{
    const f=fixture(t,p,[new Response('x'.repeat(1024*1024+1))]);assert.equal((await f.run({prompt:'chat',request:async()=>({allow:true})})).outcome,'limit');
    assert.throws(()=>p.create({workspace:f.root,key:KEY,model:'custom-unsupported-model'}),/available/);assert.throws(()=>p.create({workspace:f.root,key:KEY+'\n'}),/API key/);
    const g=fixture(t,p,[new Response('{invalid')]);assert.equal((await g.run({prompt:'chat',request:async()=>({allow:true})})).outcome,'error');
  });
  test(`${p.name}: incomplete provider output never executes even a syntactically valid call`,async t=>{
    const body=p.call('incomplete','Write',{path:'never.txt',content:'no'});if(p.name==='Gemini')body.candidates[0].finishReason='MAX_TOKENS';else body.choices[0].finish_reason='length';
    const f=fixture(t,p,[body]);let approvals=0;assert.equal((await f.run({prompt:'write',request:async()=>{approvals++;return {allow:true};}})).outcome,'limit');assert.equal(approvals,0);assert.deepEqual(fs.readdirSync(f.root),[]);
  });
}
test('Gemini: thought text is hidden, signed order retained, blocked/unsupported parts rejected',async t=>{
  const p=providers[0],response=p.reply('answer');response.candidates[0].content.parts.unshift({text:'synthetic internal thought',thought:true,thoughtSignature:'signed-thought'});
  const f=fixture(t,p,[response,p.reply('next')]);const r=await f.run({prompt:'hi',request:async()=>({allow:true})});assert.equal(r.text,'answer');await f.run({prompt:'again',resume:r.sessionId,request:async()=>({allow:true})});assert.deepEqual(f.requests[1].body.contents[1].parts,response.candidates[0].content.parts);
  for(const bad of [{promptFeedback:{blockReason:'SAFETY'}},{candidates:[{finishReason:'STOP',content:{role:'model',parts:[{executableCode:{code:'never'}}]}}]}]){const g=fixture(t,p,[bad]);assert.equal((await g.run({prompt:'hi',request:async()=>{throw Error('never');}})).outcome,'error');}
});
test('Gemini REST schema keeps signed function parts in order and correlates every result',async t=>{
  const p=providers[0],parts=[{text:'synthetic thought summary',thought:true,thoughtSignature:'signature-a'},{text:'Checking the approved project.',thoughtSignature:'signature-b'},
    {functionCall:{id:'first_read',name:'Read',args:{path:'first.txt'}},thoughtSignature:'signature-c'},
    {functionCall:{id:'second_read',name:'Read',args:{path:'second.txt'}},thoughtSignature:'signature-d'}];
  const f=fixture(t,p,[{candidates:[{finishReason:'STOP',content:{role:'model',parts}}]},p.reply('Read both approved files.')]);fs.writeFileSync(path.join(f.root,'first.txt'),'first');fs.writeFileSync(path.join(f.root,'second.txt'),'second');
  let approvals=0;const result=await f.run({prompt:'Read these two files',request:async()=>{approvals++;return {allow:true};}});assert.equal(result.outcome,'reply_ended');assert.equal(approvals,2);
  const first=f.requests[0].body;assert.equal(first.store,false);assert.deepEqual(first.generationConfig,{maxOutputTokens:8192,thinkingConfig:{thinkingLevel:'low',includeThoughts:false}});assert.deepEqual(first.toolConfig,{functionCallingConfig:{mode:'AUTO'}});
  assert.deepEqual(Object.keys(first).sort(),['contents','generationConfig','store','systemInstruction','toolConfig','tools']);
  for(const declaration of first.tools[0].functionDeclarations){assert.equal(declaration.parametersJsonSchema.type,'object');assert.equal(declaration.parametersJsonSchema.additionalProperties,false);assert(!Object.hasOwn(declaration,'parameters'));}
  const next=f.requests[1].body.contents;assert.deepEqual(next[1],{role:'model',parts});assert.deepEqual(next[2].parts.map(p=>[p.functionResponse.id,p.functionResponse.name,p.functionResponse.response.content]),[['first_read','Read','first'],['second_read','Read','second']]);
  assert(!JSON.stringify(result).includes('synthetic thought summary'));assert(!JSON.stringify(result).includes('signature-'));
});
test('Ark Chat schema uses its fixed model, disabled thinking, API key and only reviewed file tools',async t=>{
  const p=providers[1],f=fixture(t,p,[p.reply('hello')]);await f.run({prompt:'hello',request:async()=>({allow:false})});const body=f.requests[0].body;
  assert.equal(body.model,'doubao-seed-2-0-lite-260428');assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.stream,false);assert.equal(body.max_tokens,4096);assert.equal(body.tool_choice,'auto');
  assert.deepEqual(body.tools.map(tool=>tool.function.name),['Read','Write','Edit','List','AskUserQuestion']);assert(body.tools.every(tool=>tool.type==='function'));assert(!Object.hasOwn(body,'temperature'));assert(!Object.hasOwn(body,'previous_response_id'));
});
