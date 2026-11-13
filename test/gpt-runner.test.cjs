'use strict';
// Synthetic HTTP responses and local files only; no paid OpenAI request.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createGPTRunner,DEFAULT_MODEL,MODELS}=require('../src/bot/gpt-runner.cjs');
const key='fixture-openai-not-a-real-key';
let sequence=0;
const message=(text='Fixture reply',extra={})=>({type:'message',id:`msg_${++sequence}`,role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}],...extra});
const response=output=>({id:`resp_${++sequence}`,object:'response',status:'completed',output});
const final=text=>response([message(text)]);
const call=(name,input,id=`call_${++sequence}`)=>({type:'function_call',id:`fc_${++sequence}`,call_id:id,name,arguments:typeof input==='string'?input:JSON.stringify(input),status:'completed'});
const reasoning=()=>({type:'reasoning',id:`rs_${++sequence}`,summary:[],encrypted_content:'ENCRYPTED_SYNTHETIC_REASONING'});
function fixture(t,responses,options={}){
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-gpt-')),seen=[];
  const fetchImpl=async(url,init)=>{seen.push({url,...init,body:JSON.parse(init.body)});const next=responses.shift();if(typeof next==='function')return next(url,init);if(next instanceof Response)return next;assert(next,'unexpected model request');return Response.json(next);};
  const execute=createGPTRunner({workspace,key,fetchImpl,...options});
  t.after(async()=>{await execute.close();assert(workspace.startsWith(os.tmpdir()));fs.rmSync(workspace,{recursive:true,force:true});});
  const run=extra=>execute({prompt:'Synthetic request',signal:new AbortController().signal,request:async()=>({allow:false}),...extra});
  return {workspace,seen,execute,run};
}

test('GPT direct chat uses Responses, the selected key, bounded strict tools and no approval',async t=>{
  const {run,seen}=fixture(t,[final('你好')]);let requests=0;
  const result=await run({request:async()=>{requests++;return {allow:false};}});
  assert.equal(result.outcome,'reply_ended');assert.equal(result.text,'你好');assert.equal(requests,0);
  assert.equal(DEFAULT_MODEL,'gpt-6.1-sol');assert.deepEqual(MODELS,['gpt-6.1-sol','gpt-6-astra']);
  const sent=seen[0];assert.equal(sent.url,'https://api.openai.com/v1/responses');assert.equal(sent.redirect,'error');
  assert.equal(sent.headers.Authorization,`Bearer ${key}`);assert.equal(sent.body.store,false);assert.equal(sent.body.parallel_tool_calls,false);
  assert.deepEqual(sent.body.include,['reasoning.encrypted_content']);
  assert.equal(sent.body.max_output_tokens,8192);assert.deepEqual(sent.body.reasoning,{effort:'low'});assert.equal(sent.body.model,DEFAULT_MODEL);
  assert(sent.body.tools.every(tool=>tool.type==='function'&&tool.strict===true&&tool.parameters.additionalProperties===false));
  assert.doesNotMatch(JSON.stringify(sent.body),new RegExp(key));assert.equal(sent.body.previous_response_id,undefined);
});

test('GPT approved file tools create exact bytes and return reviewed Read/Edit/List results',async t=>{
  const {run,workspace,seen}=fixture(t,[response([call('Write',{path:'report.txt',content:'ARCADE_GPT_OK'})]),
    response([call('Read',{path:'report.txt'}),call('Edit',{path:'report.txt',old_text:'_OK',new_text:'_EDITED'}),call('List',{path:'.'})]),final('Written and checked.')]);
  const approvals=[];
  assert.equal((await run({request:async item=>{approvals.push(item);return {allow:true};}})).outcome,'reply_ended');
  assert.equal(fs.readFileSync(path.join(workspace,'report.txt'),'utf8'),'ARCADE_GPT_EDITED');
  assert.deepEqual(approvals.map(item=>item.tool),['Write','Read','Edit','List']);
  assert(approvals.every(item=>item.kind==='permission'));
  const outputs=seen[2].body.input.filter(item=>item.type==='function_call_output').map(item=>JSON.parse(item.output));
  assert.equal(outputs[0].bytes,13);assert.equal(outputs[1].content,'ARCADE_GPT_OK');assert.equal(outputs[2].edited,true);assert.equal(outputs[3].entries[0].name,'report.txt');
});

test('GPT denial never writes; a clarification answer does not grant a file action',async t=>{
  const {run,workspace,seen}=fixture(t,[response([call('AskUserQuestion',{question:'Which file name?'})]),
    response([call('Write',{path:'denied.txt',content:'NO'})]),final('Not written.')]);
  const approvals=[];await run({request:async item=>{approvals.push(item);return item.kind==='question'?{allow:true,answer:'report'}:{allow:false};}});
  assert.deepEqual(approvals.map(item=>item.kind),['question','permission']);assert.deepEqual(approvals[0].questions,[{question:'Which file name?'}]);
  assert.deepEqual(fs.readdirSync(workspace),[]);assert.match(seen[2].body.input.at(-1).output,/declined/);
});

test('GPT rejects unsupported tools, extra arguments, invalid JSON and unsafe paths before approval',async t=>{
  const invalid=[call('Bash',{command:'echo no'}),call('Write','{broken'),call('Write',{path:'x.txt',content:'NO',extra:true}),
    ...['../escape.txt','C:\\escape.txt','/escape.txt','NUL.txt','x:stream'].map(name=>call('Write',{path:name,content:'NO'}))];
  const {run,workspace,seen}=fixture(t,[response(invalid),final()]);let approved=0;
  await run({request:async()=>{approved++;return {allow:true};}});
  assert.equal(approved,0);assert.deepEqual(fs.readdirSync(workspace),[]);assert.equal(seen[1].body.input.filter(item=>item.type==='function_call_output').length,8);
});

test('GPT rechecks junctions after approval; approved Write cannot overwrite an existing file',async t=>{
  const {run,workspace,seen}=fixture(t,[response([call('Write',{path:'target/new.txt',content:'NO'}),call('Write',{path:'existing.txt',content:'NO'})]),final()]);
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-gpt-outside-'));fs.mkdirSync(path.join(workspace,'target'));fs.writeFileSync(path.join(workspace,'existing.txt'),'KEEP');
  t.after(()=>{assert(outside.startsWith(os.tmpdir()));fs.rmSync(outside,{recursive:true,force:true});});
  await run({request:async item=>{
    if(item.input.path==='target/new.txt'){
      fs.rmdirSync(path.join(workspace,'target'));
      try{fs.symlinkSync(outside,path.join(workspace,'target'),'junction');}catch(error){if(error.code==='EPERM')return {allow:false};throw error;}
    }
    return {allow:true};
  }});
  assert(!fs.existsSync(path.join(outside,'new.txt')));assert.equal(fs.readFileSync(path.join(workspace,'existing.txt'),'utf8'),'KEEP');
  assert(seen[1].body.input.filter(item=>item.type==='function_call_output').every(item=>JSON.parse(item.output).error));
});

test('GPT preserves encrypted reasoning and assistant phase across exact in-memory resume without exposure',async t=>{
  const privateItem=reasoning(),preamble=message('PRIVATE_PREAMBLE',{phase:'commentary'});
  const {run,seen}=fixture(t,[response([privateItem,preamble,call('List',{path:'.'})]),final('Done.'),final('Continued.')]);
  const updates=[];const first=await run({onUpdate:item=>updates.push(item)});
  assert.equal(first.text,'Done.');assert.doesNotMatch(JSON.stringify([first,updates]),/ENCRYPTED|PRIVATE_PREAMBLE/);
  assert.deepEqual(seen[1].body.input.find(item=>item.type==='reasoning'),privateItem);
  assert.equal(seen[1].body.input.find(item=>item.type==='message').phase,'commentary');
  const second=await run({resume:first.sessionId,prompt:'Continue'});assert.equal(second.sessionId,first.sessionId);
  assert(seen[2].body.input.some(item=>item.type==='reasoning'));
  assert.equal((await run({resume:'unknown-session'})).outcome,'error');assert.equal(seen.length,3);
});

test('GPT new conversation discards old context and persona can be disabled',async t=>{
  const {run,seen}=fixture(t,[final(),final()],{persona:{enabled:false},model:'gpt-6-astra'});
  const first=await run({prompt:'OLD_SYNTHETIC_CONTEXT'}),second=await run({prompt:'Fresh'});
  assert.notEqual(first.sessionId,second.sessionId);assert.equal(seen[1].body.input.length,1);
  assert.doesNotMatch(JSON.stringify(seen[1].body),/OLD_SYNTHETIC_CONTEXT|Conversation presentation/);
  assert.equal(seen[0].body.model,'gpt-6-astra');
});

test('GPT refusal text is a reply; commentary alone cannot become a finished answer',async t=>{
  const refusal=message();refusal.content=[{type:'refusal',refusal:'I cannot help with that request.'}];
  const one=fixture(t,[response([refusal])]);assert.equal((await one.run()).text,'I cannot help with that request.');
  const two=fixture(t,[response([message('Working on it',{phase:'commentary'})])]);const result=await two.run();assert.equal(result.outcome,'error');assert.doesNotMatch(result.text,/Working on it/);
  const three=fixture(t,[response([refusal,call('Write',{path:'no.txt',content:'NO'})])]);let approved=0;
  assert.equal((await three.run({request:async()=>{approved++;return {allow:true};}})).outcome,'error');assert.equal(approved,0);
});

test('GPT HTTP errors, network failures and malformed responses expose no raw error or credentials and never retry',async t=>{
  for(const next of [new Response(`PRIVATE_ERROR ${key}`,{status:401}),new Response('PRIVATE_ERROR',{status:429}),
    new Response('PRIVATE_ERROR',{status:200}),Response.json({status:'failed',error:{message:`PRIVATE_ERROR ${key}`}}),
    ()=>{throw Error(`PRIVATE_ERROR ${key}`);}]){
    const {run,seen}=fixture(t,[next]);const result=await run();assert.equal(result.outcome,'error');
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ERROR|fixture-openai/);assert.equal(seen.length,1);
  }
});

test('GPT incomplete or invalid output blocks all side effects, even if an earlier item is a valid call',async t=>{
  const good=call('Write',{path:'no.txt',content:'NO'});
  for(const next of [{...response([good]),status:'incomplete',incomplete_details:{reason:'max_output_tokens'}},
    response([good,{type:'computer_call',id:'other'}]),response([good,{...good,id:'second'}]),
    response([good,{...reasoning(),encrypted_content:undefined}]),response([{...good,status:'in_progress'}])]){
    const {run,workspace}=fixture(t,[next]);let approved=0;
    const result=await run({request:async()=>{approved++;return {allow:true};}});
    assert(['error','limit'].includes(result.outcome));assert.equal(approved,0);assert.deepEqual(fs.readdirSync(workspace),[]);
  }
});

test('GPT bounded response/history is rejected before tool execution and without dropping earlier context',async t=>{
  const huge=reasoning();huge.encrypted_content='r'.repeat(256*1024);
  for(const next of [new Response('x',{headers:{'content-length':String(1024*1024+1)}}),response([huge,call('Write',{path:'no.txt',content:'NO'})])]){
    const {run,workspace}=fixture(t,[next]);let approved=0;
    assert.equal((await run({request:async()=>{approved++;return {allow:true};}})).outcome,'limit');
    assert.equal(approved,0);assert.deepEqual(fs.readdirSync(workspace),[]);
  }
});

test('GPT repeated call ID cannot repeat an already-approved operation',async t=>{
  const {run,seen,workspace}=fixture(t,[response([call('Write',{path:'one.txt',content:'ONE'},'same')]),response([call('Write',{path:'two.txt',content:'TWO'},'same')])]);
  let approvals=0;const result=await run({request:async()=>{approvals++;return {allow:true};}});
  assert.equal(result.outcome,'error');assert.equal(approvals,1);assert.equal(seen.length,2);
  assert.equal(fs.readFileSync(path.join(workspace,'one.txt'),'utf8'),'ONE');assert(!fs.existsSync(path.join(workspace,'two.txt')));
});

test('GPT cancelled approvals leave a complete history and a late approval cannot create files',async t=>{
  const controller=new AbortController(),{run,seen,workspace}=fixture(t,[response([call('Write',{path:'one.txt',content:'NO'}),call('Write',{path:'two.txt',content:'NO'})]),final('Fresh reply.')]);
  const first=await run({signal:controller.signal,request:async()=>{controller.abort();return {allow:true};}});
  assert.equal(first.outcome,'cancelled');assert.match(first.notice,/not confirmed/);assert.deepEqual(fs.readdirSync(workspace),[]);
  assert.equal((await run({resume:first.sessionId,prompt:'Just chat'})).text,'Fresh reply.');
  const outputs=seen[1].body.input.filter(item=>item.type==='function_call_output');assert.equal(outputs.length,2);assert(outputs.every(item=>/interrupted/.test(item.output)));
});

test('GPT close settles even when approval never answers, and then rejects further turns',async t=>{
  let entered,answer;const entry=new Promise(resolve=>{entered=resolve;});
  const {run,execute,workspace,seen}=fixture(t,[response([call('Write',{path:'late.txt',content:'NO'})])]);
  const pending=run({request:()=>{entered();return new Promise(resolve=>{answer=resolve;});}});
  await entry;await execute.close();assert.equal((await pending).outcome,'cancelled');
  answer({allow:true});await new Promise(resolve=>setImmediate(resolve));assert(!fs.existsSync(path.join(workspace,'late.txt')));
  assert.equal((await run()).outcome,'error');assert.equal(seen.length,1);
});

test('GPT deadline aborts the request; no model cancellation confirmation is invented',async t=>{
  let aborted=false;const {run}=fixture(t,[async(_url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(Error('timeout'));},{once:true}))],{timeoutMs:10});
  const result=await run();assert.equal(result.outcome,'limit');assert.equal(aborted,true);
});

test('GPT finite request and tool limits stop repeat requests instead of continuing indefinitely',async t=>{
  const responses=Array.from({length:16},()=>response([call('List',{path:'.'})]));
  const {run,seen}=fixture(t,responses);let approvals=0;
  assert.equal((await run({request:async()=>{approvals++;return {allow:false};}})).outcome,'limit');
  assert.equal(seen.length,16);assert.equal(approvals,16);
  const repeated=Array.from({length:4},()=>response(Array.from({length:8},()=>call('List',{path:'.'}))));
  const two=fixture(t,repeated);let count=0;
  assert.equal((await two.run({request:async()=>{count++;return {allow:false};}})).outcome,'limit');assert.equal(count,24);
});
