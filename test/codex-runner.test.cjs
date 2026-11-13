'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PassThrough, Writable} = require('node:stream');
const {createCodexRunner, environment} = require('../src/bot/codex-runner.cjs');

function fixture(script = () => {}, options = {}) {
  const calls = [], responses = [], launches = [], children = [];
  const spawnImpl = (command,args,launch) => {
    launches.push({command,args,...launch});
    const child = new EventEmitter(); children.push(child);
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
    child.kill = () => {child.killed=true;child.emit('exit',0);return true;};
    child.emitMessage = message => child.stdout.write(JSON.stringify(message)+'\n');
    child.answer = (message,result) => child.emitMessage({id:message.id,result});
    child.event = (method,params) => child.emitMessage({method,params});
    child.complete = (status='completed',items=[]) => child.event('turn/completed',{threadId:options.threadId||'thread-1',turn:{id:'turn-1',status,items}});
    child.stdin = new Writable({write(chunk,encoding,done){
      const message=JSON.parse(chunk.toString());
      if(message.method){calls.push(message);
        if(message.method==='initialize') child.answer(message,{});
        else if(message.method==='account/read') child.answer(message,{account:{type:'chatgpt'}});
        else if(message.method==='thread/start'||message.method==='thread/resume') child.answer(message,{thread:{id:options.threadId||message.params.threadId||'thread-1'}});
        else if(message.method==='turn/start') {
          child.event('turn/started',{threadId:options.threadId||'thread-1',turn:{id:'turn-1'}});
          child.answer(message,{turn:{id:'turn-1',status:'inProgress'}});
        }
      }else responses.push(message);
      setImmediate(()=>script(message,child));done();
    },final(done){child.emit('exit',0);done();}});
    return child;
  };
  const runner=createCodexRunner({workspace:process.cwd(),spawnImpl,requestTimeoutMs:100,taskTimeoutMs:1000,interruptTimeoutMs:100,...options});
  return {runner,calls,responses,launches,children};
}

test('local Codex uses structured stdio, local login and scoped policies; completion is reply_ended',async()=>{
  const f=fixture((message,child)=>{
    if(message.method==='turn/start'){
      child.event('item/completed',{threadId:'thread-1',turnId:'old-turn',item:{id:'stale',type:'agentMessage',text:'wrong'}});
      child.event('item/completed',{threadId:'thread-1',turnId:'turn-1',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'你好，已收到。'}});
      child.complete();
    }
  });
  let approvals=0;
  const result=await f.runner({prompt:'你好',request:()=>{approvals++;}});
  assert.deepEqual(result,{sessionId:'thread-1',text:'你好，已收到。',outcome:'reply_ended'});
  assert.equal(approvals,0);
  const thread=f.calls.find(x=>x.method==='thread/start'),turn=f.calls.find(x=>x.method==='turn/start');
  assert.equal(thread.params.approvalPolicy,'on-request');assert.equal(thread.params.approvalsReviewer,'user');
  assert.equal(turn.params.sandboxPolicy.type,'workspaceWrite');assert.equal(turn.params.sandboxPolicy.networkAccess,false);
  assert.deepEqual(turn.params.sandboxPolicy.writableRoots,[process.cwd()]);
  assert.equal(f.launches[0].shell,false);assert.equal(f.launches[0].windowsHide,true);
  assert.ok(f.launches[0].args.includes('stdio://'));assert.equal(f.children[0].listenerCount('exit'),0);
  assert.match(thread.params.developerInstructions,/Dragon Girl/);
});

test('native environment does not accept ambient API keys',()=>{
  const result=environment({PATH:'local',OPENAI_API_KEY:'secret',CODEX_API_KEY:'secret2',USERPROFILE:'profile'});
  assert.deepEqual(result,{PATH:'local',USERPROFILE:'profile'});
});

test('resume binds to the exact recorded conversation and never continue/latest',async()=>{
  const f=fixture((message,child)=>{if(message.method==='turn/start')child.complete('completed',[{type:'agentMessage',text:'restored'}]);},{threadId:'saved-thread'});
  const result=await f.runner({prompt:'continue',resume:'saved-thread'});
  assert.equal(result.outcome,'reply_ended');assert.equal(result.text,'restored');
  assert.equal(f.calls.find(x=>x.method==='thread/resume').params.threadId,'saved-thread');
  assert.equal(f.calls.some(x=>x.method==='thread/start'),false);
  const mismatch=fixture(()=>{},{threadId:'other-thread'});
  const rejected=await mismatch.runner({prompt:'continue',resume:'saved-thread'});
  assert.equal(rejected.outcome,'error');assert.equal(mismatch.calls.some(x=>x.method==='turn/start'),false);
});

test('one-shot command approval carries exact command/context and never grants session policy',async()=>{
  let seen;
  const f=fixture((message,child)=>{
    if(message.method==='turn/start') child.emitMessage({id:'approval',method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',turnId:'turn-1',itemId:'cmd1',command:'echo hello',cwd:process.cwd(),reason:'test'}});
    if(message.id==='approval')child.complete();
  });
  const result=await f.runner({prompt:'test',request:async value=>{seen=value;return {allow:true};}});
  assert.equal(result.outcome,'reply_ended');assert.equal(seen.tool,'CodexCommand');assert.equal(seen.input.command,'echo hello');
  assert.deepEqual(f.responses[0],{id:'approval',result:{decision:'accept'}});
});

test('file approvals require the actual pending diff and reject grantRoot scope expansion',async()=>{
  const asked=[];
  const f=fixture((message,child)=>{
    if(message.method==='turn/start'){
      child.event('item/started',{threadId:'thread-1',turnId:'turn-1',item:{id:'file1',type:'fileChange',changes:[{path:'note.txt',kind:{type:'add'},diff:'+hello'}]}});
      child.emitMessage({id:81,method:'item/fileChange/requestApproval',params:{threadId:'thread-1',turnId:'turn-1',itemId:'file1'}});
      child.emitMessage({id:82,method:'item/fileChange/requestApproval',params:{threadId:'thread-1',turnId:'turn-1',itemId:'missing'}});
      child.emitMessage({id:83,method:'item/fileChange/requestApproval',params:{threadId:'thread-1',turnId:'turn-1',itemId:'file1',grantRoot:'outside'}});
    }
    if(!message.method && f.responses.length===3)child.complete();
  });
  await f.runner({prompt:'test',request:async value=>{asked.push(value);return {allow:true};}});
  assert.equal(asked.length,1);assert.equal(asked[0].input.changes[0].diff,'+hello');
  assert.equal(f.responses.find(x=>x.id===81).result.decision,'accept');
  assert.equal(f.responses.find(x=>x.id===82).result.decision,'decline');assert.equal(f.responses.find(x=>x.id===83).result.decision,'decline');
});

test('stale requests and unsupported authorization surfaces fail closed',async()=>{
  let asked=0;
  const f=fixture((message,child)=>{
    if(message.method==='turn/start'){
      child.emitMessage({id:1,method:'item/commandExecution/requestApproval',params:{threadId:'other-thread',turnId:'turn-1',itemId:'cmd',command:'bad'}});
      child.emitMessage({id:2,method:'item/permissions/requestApproval',params:{threadId:'thread-1',turnId:'turn-1',itemId:'perm',permissions:{network:{enabled:true}}}});
      child.emitMessage({id:3,method:'mcpServer/elicitation/request',params:{threadId:'thread-1',turnId:'turn-1',itemId:'mcp',mode:'url',url:'https://example.com'}});
      child.emitMessage({id:4,method:'item/tool/call',params:{threadId:'thread-1',turnId:'turn-1',itemId:'call',tool:'unknown'}});
    }
    if(!message.method&&f.responses.length===4)child.complete();
  });
  await f.runner({prompt:'test',request:()=>{asked++;return {allow:true};}});
  assert.equal(asked,0);assert.deepEqual(f.responses.find(x=>x.id===2).result,{permissions:{},scope:'turn'});
  assert.equal(f.responses.find(x=>x.id===3).result.action,'decline');assert.equal(f.responses.find(x=>x.id===4).error.code,-32601);
});

test('short questions retain question IDs; secret questions never travel through chat',async()=>{
  const asks=[];
  const f=fixture((message,child)=>{
    if(message.method==='turn/start'){
      child.emitMessage({id:11,method:'item/tool/requestUserInput',params:{threadId:'thread-1',turnId:'turn-1',itemId:'q',questions:[{id:'a',question:'Which?',header:'Choice'},{id:'b',question:'Why?',header:'Reason'}]}});
      child.emitMessage({id:12,method:'item/tool/requestUserInput',params:{threadId:'thread-1',turnId:'turn-1',itemId:'secret',questions:[{id:'key',question:'Key?',isSecret:true}]}});
    }
    if(!message.method&&f.responses.length===2)child.complete();
  });
  await f.runner({prompt:'test',request:async req=>{asks.push(req);return {allow:true,answer:'answer '+req.questions[0].id};}});
  assert.equal(asks.length,2);assert.deepEqual(f.responses.find(x=>x.id===11).result.answers,{a:{answers:['answer a']},b:{answers:['answer b']}});
  assert.deepEqual(f.responses.find(x=>x.id===12).result,{answers:{}});
});

test('server-resolved approval invalidates the pending callback instead of sending a late accept',async()=>{
  let release,approvalSignal;
  const f=fixture((message,child)=>{
    if(message.method==='turn/start'){
      child.emitMessage({id:'pending',method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',turnId:'turn-1',itemId:'cmd',command:'echo hi'}});
      setImmediate(()=>{child.event('serverRequest/resolved',{threadId:'thread-1',requestId:'pending'});release({allow:true});child.complete();});
    }
  });
  await f.runner({prompt:'test',request:req=>{approvalSignal=req.signal;return new Promise(resolve=>{release=resolve;});}});
  assert.equal(approvalSignal.aborted,true);assert.equal(f.responses.some(x=>x.id==='pending'),false);
});

test('cancel sends turn/interrupt for the owned thread/turn and waits for interrupted completion',async()=>{
  const controller=new AbortController();
  const f=fixture((message,child)=>{
    if(message.method==='turn/start')controller.abort();
    if(message.method==='turn/interrupt'){child.answer(message,{});setTimeout(()=>child.complete('interrupted'),20);}
  });
  const result=await f.runner({prompt:'wait',signal:controller.signal});
  assert.equal(result.outcome,'cancelled');
  assert.equal(result.notice,'Codex 已确认本轮中断；独立后台作业未核验。');
  assert.equal(result.text,'');
  assert.deepEqual(f.calls.find(x=>x.method==='turn/interrupt').params,{threadId:'thread-1',turnId:'turn-1'});
});

test('missing interruption confirmation never becomes a confirmed stop or a partial model reply',async()=>{
  for(const acknowledge of [false,true]){
    const controller=new AbortController();
    const f=fixture((message,child)=>{
      if(message.method==='turn/start'){
        child.event('item/completed',{threadId:'thread-1',turnId:'turn-1',item:{id:'partial',type:'agentMessage',text:'untrusted partial output'}});
        controller.abort();
      }
      if(message.method==='turn/interrupt'&&acknowledge)child.answer(message,{});
    },{interruptTimeoutMs:20});
    const result=await f.runner({prompt:'wait',signal:controller.signal});
    assert.equal(result.outcome,'cancelled');assert.equal(result.text,'');
    assert.equal(result.notice,'已请求中断，未收到确认；请检查本机 Codex。');
    assert.doesNotMatch(result.notice,/已确认|untrusted/);
  }
});

test('completion racing a stop is reported separately from confirmed interruption',async()=>{
  const controller=new AbortController();
  const f=fixture((message,child)=>{
    if(message.method==='turn/start'){controller.abort();child.complete('completed',[{type:'agentMessage',text:'partial'}]);}
    if(message.method==='turn/interrupt')child.answer(message,{});
  });
  const result=await f.runner({prompt:'wait',signal:controller.signal});
  assert.equal(result.outcome,'cancelled');assert.equal(result.text,'');
  assert.match(result.notice,/本轮已结束/);assert.doesNotMatch(result.notice,/已确认本轮中断/);
});

test('timeout interrupts once, close joins the run, and a closed runner cannot restart',async()=>{
  const f=fixture((message,child)=>{if(message.method==='turn/interrupt'){child.answer(message,{});child.complete('interrupted');}},{taskTimeoutMs:25});
  const result=await f.runner({prompt:'wait'});assert.equal(result.outcome,'limit');
  assert.match(result.notice,/达到执行时限。Codex 已确认本轮中断/);assert.equal(result.text,'');
  assert.equal(f.calls.filter(x=>x.method==='turn/interrupt').length,1);
  await f.runner.close();await assert.rejects(f.runner({prompt:'hello'}),/closed/);
});

test('malformed stdout and unexpected process exit return error, never successful completion',async()=>{
  for(const action of ['malformed','exit']){
    const f=fixture((message,child)=>{if(message.method==='turn/start'){if(action==='malformed')child.stdout.write('bad json\n');else child.emit('exit',1);}});
    const result=await f.runner({prompt:'test'});assert.equal(result.outcome,'error');assert.match(result.notice,/Codex 未能完成/);assert.equal(result.text,'');
  }
});
