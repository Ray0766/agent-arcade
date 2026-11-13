'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDeepSeekRunner,DEFAULT_MODEL,MODELS}=require('../src/bot/deepseek-runner.cjs');
const key='fixture-deepseek-not-a-real-key';
const final=(text='Fixture reply',reasoning)=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:text,...(reasoning?{reasoning_content:reasoning}:{})}}]});
const call=(name,input,id='call_fixture')=>({id,type:'function',function:{name,arguments:typeof input==='string'?input:JSON.stringify(input)}});
const calls=(tools,reasoning)=>({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:tools,...(reasoning?{reasoning_content:reasoning}:{})}}]});
function fixture(t,responses,options={}) {
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-deepseek-')),seen=[];
  const fetchImpl=async(url,init)=>{seen.push({url,...init,body:JSON.parse(init.body)});const next=responses.shift();if(typeof next==='function')return next(url,init);if(next instanceof Response)return next;assert.ok(next,'unexpected model request');return Response.json(next);};
  const execute=createDeepSeekRunner({workspace,key,fetchImpl,...options});
  t.after(async()=>{await execute.close();assert(workspace.startsWith(os.tmpdir()));fs.rmSync(workspace,{recursive:true,force:true});});
  const run=extra=>execute({prompt:'Synthetic test',signal:new AbortController().signal,request:async()=>({allow:false}),...extra});
  return {workspace,execute,seen,run};
}

test('DeepSeek ordinary chat uses the official endpoint and current model without an approval',async t=>{
  const {run,seen}=fixture(t,[final('你好')]);let requested=0;
  const result=await run({request:async()=>{requested++;return {allow:false};}});
  assert.equal(result.outcome,'reply_ended');assert.equal(result.text,'你好');assert.equal(requested,0);
  assert.equal(DEFAULT_MODEL,'deepseek-flash');assert.deepEqual(MODELS,['deepseek-flash','deepseek-v4-pro']);
  assert.equal(seen[0].url,'https://api.deepseek.com/chat/completions');assert.equal(seen[0].redirect,'error');
  assert.equal(seen[0].headers.Authorization,`Bearer ${key}`);assert.deepEqual(seen[0].body.thinking,{type:'disabled'});
  assert.equal(seen[0].body.max_tokens,4096);assert.match(seen[0].body.messages[0].content,/Whale Girl/);
  assert.doesNotMatch(JSON.stringify(seen[0].body),new RegExp(key));
});

test('approved Write creates exact bytes; Read/Edit/List perform separately reviewed operations',async t=>{
  const responses=[calls([call('Write',{path:'report.txt',content:'ARCADE_DEEPSEEK_OK'})]),
    calls([call('Read',{path:'report.txt'},'read'),call('Edit',{path:'report.txt',old_text:'_OK',new_text:'_EDITED'},'edit'),call('List',{path:'.'},'list')]),final('Written and edited.')];
  const {run,workspace,seen}=fixture(t,responses),requests=[];
  const result=await run({request:async request=>{requests.push(request);return {allow:true};}});
  assert.equal(result.outcome,'reply_ended');assert.equal(fs.readFileSync(path.join(workspace,'report.txt'),'utf8'),'ARCADE_DEEPSEEK_EDITED');
  assert.deepEqual(requests.map(value=>value.tool),['Write','Read','Edit','List']);
  assert.ok(requests.every(value=>value.kind==='permission'&&!value.signal.aborted));
  const toolResults=seen[2].body.messages.filter(value=>value.role==='tool').map(value=>JSON.parse(value.content));
  assert.equal(toolResults[0].bytes,18);assert.equal(toolResults[1].content,'ARCADE_DEEPSEEK_OK');
  assert.equal(toolResults[2].edited,true);assert.equal(toolResults[3].entries[0].name,'report.txt');
});

test('denial produces a tool refusal and no file side effect',async t=>{
  const {run,workspace,seen}=fixture(t,[calls([call('Write',{path:'denied.txt',content:'NO'})]),final('Not written.')]);
  const result=await run();assert.equal(result.text,'Not written.');assert.equal(fs.existsSync(path.join(workspace,'denied.txt')),false);
  assert.match(seen[1].body.messages.at(-1).content,/declined/);
});

test('a late approval after cancellation cannot create a file',async t=>{
  const controller=new AbortController();const {run,workspace,seen}=fixture(t,[calls([call('Write',{path:'late.txt',content:'NO'})])]);
  const result=await run({signal:controller.signal,request:async()=>{controller.abort();return {allow:true};}});
  assert.equal(result.outcome,'cancelled');assert.equal(fs.existsSync(path.join(workspace,'late.txt')),false);assert.equal(seen.length,1);
});

test('unknown tools and malformed/extra arguments fail closed before approval',async t=>{
  const invalid=[call('Bash',{command:'echo no'}),call('Write','{broken','broken'),call('Write',{path:'x.txt',content:'NO',extra:true},'extra')];
  const {run,workspace,seen}=fixture(t,[calls(invalid),final('Unable to act.')]);let approved=0;
  const result=await run({request:async()=>{approved++;return {allow:true};}});
  assert.equal(result.outcome,'reply_ended');assert.equal(approved,0);assert.deepEqual(fs.readdirSync(workspace),[]);
  assert.equal(seen[1].body.messages.filter(message=>message.role==='tool'&&JSON.parse(message.content).error).length,3);
});

test('path traversal, absolute paths and Windows device/stream paths cannot request approval',async t=>{
  const bad=['../outside.txt','C:\\outside.txt','/outside.txt','report.txt:secret','NUL.txt'];
  const {run,workspace}=fixture(t,[calls(bad.map((value,index)=>call('Write',{path:value,content:'NO'},`path_${index}`))),final()]);let approved=0;
  await run({request:async()=>{approved++;return {allow:true};}});assert.equal(approved,0);assert.deepEqual(fs.readdirSync(workspace),[]);
});

test('new symlink/junction introduced while approval is pending is rejected',async t=>{
  const {run,workspace,seen}=fixture(t,[calls([call('Write',{path:'target/no.txt',content:'NO'})]),final()]);
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-deepseek-outside-'));fs.mkdirSync(path.join(workspace,'target'));
  t.after(()=>{assert(outside.startsWith(os.tmpdir()));fs.rmSync(outside,{recursive:true,force:true});});
  let linking=true;
  await run({request:async()=>{fs.rmdirSync(path.join(workspace,'target'));try{fs.symlinkSync(outside,path.join(workspace,'target'),'junction');}catch(error){if(error.code==='EPERM'){linking=false;fs.mkdirSync(path.join(workspace,'target'));return {allow:false};}throw error;}return {allow:true};}});
  assert.equal(fs.existsSync(path.join(outside,'no.txt')),false);
  if(linking)assert.match(seen[1].body.messages.at(-1).content,/links|junctions/);
});

test('Write never overwrites; Edit requires one exact match; reads reject binary and oversized files',async t=>{
  const {run,workspace,seen}=fixture(t,[calls([
    call('Write',{path:'keep.txt',content:'replace'}),call('Edit',{path:'keep.txt',old_text:'same',new_text:'changed'},'edit'),
    call('Read',{path:'binary.bin'},'binary'),call('Read',{path:'big.txt'},'large')]),final()]);
  fs.writeFileSync(path.join(workspace,'keep.txt'),'same same');fs.writeFileSync(path.join(workspace,'binary.bin'),Buffer.from([0,1,2]));fs.writeFileSync(path.join(workspace,'big.txt'),'x'.repeat(32769));
  await run({request:async()=>({allow:true})});assert.equal(fs.readFileSync(path.join(workspace,'keep.txt'),'utf8'),'same same');
  assert.ok(seen[1].body.messages.filter(message=>message.role==='tool').every(message=>JSON.parse(message.content).error));
});

test('question answer uses the existing question contract and has no file authority',async t=>{
  const {run,seen}=fixture(t,[calls([call('AskUserQuestion',{question:'Which name?'})]),final('Understood.')]);
  await run({request:async value=>{assert.equal(value.kind,'question');assert.deepEqual(value.questions,[{question:'Which name?'}]);return {allow:true,answer:'Report'};}});
  assert.deepEqual(JSON.parse(seen[1].body.messages.at(-1).content),{answer:'Report'});
});

test('exact in-memory resume preserves reasoning across tool and ordinary turns without exposing it',async t=>{
  const secretReasoning='synthetic private reasoning';
  const {run,seen}=fixture(t,[calls([call('List',{path:'.'})],secretReasoning),final('Done.','synthetic later reasoning'),final('Continued.')],{thinking:true});
  const first=await run();assert.equal(first.text,'Done.');assert.doesNotMatch(JSON.stringify(first),/reasoning/);
  const second=await run({resume:first.sessionId,prompt:'Continue chatting'});assert.equal(second.sessionId,first.sessionId);
  const oldAssistant=seen[2].body.messages.filter(message=>message.role==='assistant');
  assert.equal(oldAssistant[0].reasoning_content,secretReasoning);assert.equal(oldAssistant[1].reasoning_content,'synthetic later reasoning');
  assert.equal((await run({resume:'unknown_session'})).outcome,'error');assert.equal(seen.length,3);
});

test('new conversation clears old context; persona can be disabled',async t=>{
  const {run,seen}=fixture(t,[final(),final()],{persona:{enabled:false,selection:'default'}});
  const first=await run({prompt:'OLD_SYNTHETIC_CONTENT'}),second=await run({prompt:'Fresh'});
  assert.notEqual(first.sessionId,second.sessionId);assert.equal(seen[1].body.messages.length,2);
  assert.doesNotMatch(JSON.stringify(seen[1].body.messages),/OLD_SYNTHETIC_CONTENT|Whale Girl/);
});

test('HTTP/malformed errors never expose provider bodies or API keys; no automatic retry',async t=>{
  for(const response of [new Response(`PRIVATE_ERROR ${key}`,{status:401}),new Response(`PRIVATE_ERROR ${key}`,{status:402}),new Response(`PRIVATE_ERROR ${key}`,{status:429}),new Response(`PRIVATE_ERROR ${key}`,{status:200}),Response.json({choices:[]})]) {
    const {run,seen}=fixture(t,[response]);const result=await run();assert.equal(result.outcome,'error');
    assert.equal(result.notice,result.text,'only the sanitized diagnostic can be sent by Dispatcher');
    assert.doesNotMatch(result.notice,/PRIVATE_ERROR|fixture-deepseek/);assert.equal(seen.length,1);
    if(response.status===401)assert.match(result.notice,/API key/);
    if(response.status===402)assert.match(result.notice,/credit/);
    if(response.status===429)assert.match(result.notice,/rate limit/);
  }
});

test('oversized response and incomplete tool output are stopped before action',async t=>{
  for(const response of [new Response('x',{headers:{'content-length':String(1024*1024+1)}}),Response.json({choices:[{finish_reason:'length',message:{role:'assistant',content:null,tool_calls:[call('Write',{path:'x.txt',content:'NO'})]}}]})]) {
    const {run,workspace}=fixture(t,[response]);let requested=0;
    const result=await run({request:async()=>{requested++;return {allow:true};}});
    assert.equal(result.outcome,'limit');assert.equal(requested,0);assert.deepEqual(fs.readdirSync(workspace),[]);
  }
});

test('close aborts an in-flight request and prevents new calls',async t=>{
  let entered;const entry=new Promise(resolve=>{entered=resolve;});
  const {run,execute}=fixture(t,[async(_url,init)=>{entered();return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}]);
  const pending=run();await entry;await execute.close();assert.equal((await pending).outcome,'cancelled');assert.equal((await run()).outcome,'error');
});

test('a cancelled tool batch leaves a resumable history without replaying unexecuted calls',async t=>{
  const controller=new AbortController(),{run,seen,workspace}=fixture(t,[calls([call('Write',{path:'first.txt',content:'NO'}),call('Write',{path:'second.txt',content:'NO'},'second')]),final('Fresh reply.')]);
  const first=await run({signal:controller.signal,request:async()=>{controller.abort();return {allow:true};}});
  const second=await run({resume:first.sessionId,prompt:'Do not retry, just chat.'});assert.equal(second.outcome,'reply_ended');
  assert.deepEqual(fs.readdirSync(workspace),[]);assert.equal(seen[1].body.messages.filter(value=>value.role==='tool').length,2);
  assert.ok(seen[1].body.messages.filter(value=>value.role==='tool').every(value=>/interrupted/.test(value.content)));
});

test('task deadline produces limit and aborts the network request',async t=>{
  const {run}=fixture(t,[async(_url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}))],{timeoutMs:10});
  assert.equal((await run()).outcome,'limit');
});

test('close settles even if a host approval callback never responds; a late answer cannot act',async t=>{
  let entered,answer;const entry=new Promise(resolve=>{entered=resolve;});
  const {run,execute,workspace}=fixture(t,[calls([call('Write',{path:'late.txt',content:'NO'})])]);
  const pending=run({request:()=>{entered();return new Promise(resolve=>{answer=resolve;});}});
  await entry;await execute.close();assert.equal((await pending).outcome,'cancelled');
  answer({allow:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(fs.existsSync(path.join(workspace,'late.txt')),false);
});

test('bounded conversation refuses further requests without dropping reasoning or replaying tools',async t=>{
  const {run,seen}=fixture(t,[final('Done.','r'.repeat(256*1024))]);
  const first=await run();assert.equal(first.outcome,'reply_ended');
  for(let index=0;index<3;index++) assert.equal((await run({resume:first.sessionId,prompt:'continue'})).outcome,'limit');
  assert.equal(seen.length,1);
});
