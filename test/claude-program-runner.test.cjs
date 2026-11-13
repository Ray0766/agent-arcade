'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {createClaudeProgramRunner,environment,compatible}=require('../src/bot/claude-program-runner.cjs');
function fixture(script=()=>{},options={}){
  const frames=[],launches=[],children=[];
  const spawnImpl=(command,args,launch)=>{
    launches.push({command,args,...launch});const child=new EventEmitter();children.push(child);
    child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;child.signalCode=null;
    child.sessionId=args[args.indexOf(args.includes('--resume')?'--resume':'--session-id')+1];
    child.emitMessage=message=>child.stdout.write(JSON.stringify(message)+'\n');
    child.answer=(id,response)=>child.emitMessage({type:'control_response',response:{subtype:'success',request_id:id,response}});
    child.request=(id,request)=>child.emitMessage({type:'control_request',request_id:id,request});
    child.finish=(extra={})=>child.emitMessage({type:'result',subtype:'success',is_error:false,session_id:child.sessionId,user_message_uuid:child.messageId,result:'你好，收到。',...extra});
    child.exit=(code=0)=>{if(child.exitCode!==null)return;child.exitCode=code;child.emit('exit',code,null);};
    child.kill=()=>{child.killed=true;child.exit();return true;};
    child.stdin=new Writable({write(chunk,encoding,done){
      const frame=JSON.parse(chunk.toString());frames.push(frame);
      if(frame.type==='control_request'&&frame.request.subtype==='initialize'){
        child.hookId=frame.request.hooks.PreToolUse[0].hookCallbackIds[0];
        if(!options.noInitialize)child.answer(frame.request_id,{claude_code_version:'2.1.317',hook_on_failure_supported:true,hooks_applied:true,...options.initialize});
      }
      if(frame.type==='user')child.messageId=frame.uuid;
      setImmediate(()=>script(frame,child));done();
    },final(done){if(!options.noExit)child.exit();done();}});
    return child;
  };
  const runner=createClaudeProgramRunner({workspace:process.cwd(),executable:'fixture-claude.exe',spawnImpl,requestTimeoutMs:100,taskTimeoutMs:1000,interruptTimeoutMs:30,exitTimeoutMs:15,...options});
  return {runner,frames,launches,children};
}
const replies=f=>f.frames.filter(x=>x.type==='control_response');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('conversation-only CLI removes tools and persistence and refuses rogue callbacks without asking',async()=>{
  let asked=0;
  const f=fixture((frame,child)=>{
    if(frame.type==='user'){
      child.request('hook',{subtype:'hook_callback',callback_id:child.hookId,input:{hook_event_name:'PreToolUse',tool_name:'Write',tool_input:{}}});
      child.request('tool',{subtype:'can_use_tool',tool_name:'Write',input:{file_path:'never.txt',content:'NO'}});
    }
    if(replies(f).length===2)child.finish();
  },{conversationOnly:true});
  const result=await f.runner({prompt:'Natural social chat',request:async()=>{asked++;return {allow:true};}});
  assert.equal(result.outcome,'reply_ended');assert.equal(asked,0);
  const args=f.launches[0].args;
  assert.equal(args[args.indexOf('--tools')+1],'');assert.equal(args[args.indexOf('--disallowedTools')+1],'*');
  assert.ok(args.includes('--no-session-persistence'));assert.ok(args.includes('--no-chrome'));assert.ok(args.includes('--safe-mode'));assert.ok(args.includes('--system-prompt'));
  assert.equal(replies(f)[0].response.response.hookSpecificOutput.permissionDecision,'deny');
  assert.equal(replies(f)[1].response.response.behavior,'deny');
  await assert.rejects(f.runner({prompt:'No old coding context',resume:result.sessionId}),/cannot resume/);
});

test('original CLI program mode uses its own login and no Channels; result is only reply_ended',async()=>{
  const f=fixture((frame,child)=>{if(frame.type==='user')child.finish();});
  const result=await f.runner({prompt:'hello'});
  assert.equal(result.outcome,'reply_ended');assert.equal(result.text,'你好，收到。');
  const launch=f.launches[0];assert.equal(launch.shell,false);assert.equal(launch.windowsHide,true);
  assert.ok(launch.args.includes('--permission-prompt-tool=stdio'));assert.ok(launch.args.includes('--print'));
  assert.equal(launch.args[launch.args.indexOf('--setting-sources')+1],'');
  assert.equal(launch.args[launch.args.indexOf('--mcp-config')+1],'{"mcpServers":{}}');
  assert.equal(launch.args.some(x=>/channels|skip-permissions|bypassPermissions|--bare/.test(x)),false);
  assert.equal(launch.env.CLAUDE_CONFIG_DIR,undefined);assert.equal(launch.env.ANTHROPIC_API_KEY,undefined);
  assert.equal(launch.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS,'1');assert.equal(f.children[0].exitCode,0);
  assert.deepEqual(f.frames[0].request.hooks.PreToolUse[0].onFailure,'block');
});

test('environment keeps OS plumbing but excludes API, provider, OAuth, session and injected SDK credentials',()=>{
  const result=environment({PATH:'path',USERPROFILE:'user',ANTHROPIC_API_KEY:'secret',ANTHROPIC_AUTH_TOKEN:'secret',CLAUDE_CODE_OAUTH_TOKEN:'secret',ANTHROPIC_BASE_URL:'https://invalid',CLAUDE_CONFIG_DIR:'other',CLAUDE_CODE_USE_BEDROCK:'1',CLAUDECODE:'1',NODE_OPTIONS:'dangerous'});
  assert.equal(result.PATH,'path');assert.equal(result.USERPROFILE,'user');
  for(const name of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CONFIG_DIR','CLAUDE_CODE_USE_BEDROCK','CLAUDECODE','NODE_OPTIONS'])assert.equal(result[name],undefined);
});

test('fail-closed hook support and registered hooks are required before sending any user prompt',async()=>{
  for(const initialize of [{claude_code_version:'2.1.316'},{claude_code_version:undefined},{hook_on_failure_supported:false},{hooks_applied:false}]){
    const f=fixture(()=>{}, {initialize});const result=await f.runner({prompt:'never run'});
    assert.equal(result.outcome,'error');assert.equal(result.sessionId,'','A planned UUID from failed startup is not a resumable session');assert.equal(f.frames.some(x=>x.type==='user'),false);
  }
  assert.equal(compatible('2.1.317'),true);assert.equal(compatible('2.2.0'),true);assert.equal(compatible('broken'),false);
});

test('known tools are forced to ask while unknown/background tool attempts are denied by the registered hook',async()=>{
  const f=fixture((frame,child)=>{
    if(frame.type==='user')for(const [id,tool,input]of [['a','Write',{}],['b','Task',{}],['c','Bash',{run_in_background:true}]])child.request(id,{subtype:'hook_callback',callback_id:child.hookId,input:{hook_event_name:'PreToolUse',tool_name:tool,tool_input:input}});
    if(replies(f).length===3)child.finish();
  });
  await f.runner({prompt:'test'});
  assert.deepEqual(replies(f).map(x=>x.response.response.hookSpecificOutput.permissionDecision),['ask','deny','deny']);
});

test('permission returns only the exact approved input and never stores a broader permission',async()=>{
  const input={file_path:'project-proof.txt',content:'approved'};let asked;
  const f=fixture((frame,child)=>{
    if(frame.type==='user')child.request('write',{subtype:'can_use_tool',tool_name:'Write',tool_use_id:'tool-1',input});
    if(frame.type==='control_response')child.finish();
  });
  const result=await f.runner({prompt:'write',request:async req=>{asked=req;return {allow:true,updatedPermissions:['ignored'],updatedInput:{file_path:'other'}};}});
  assert.equal(result.outcome,'reply_ended');assert.equal(asked.kind,'permission');assert.deepEqual(asked.input,input);
  assert.deepEqual(replies(f)[0].response.response,{behavior:'allow',updatedInput:input,toolUseID:'tool-1'});
});

test('denied, unsupported, background, and locally restricted tools never gain approval',async()=>{
  let asks=0;
  const f=fixture((frame,child)=>{
    if(frame.type==='user')for(const [id,p]of [['deny',{tool_name:'Write',input:{}}],['unknown',{tool_name:'Agent',input:{}}],['background',{tool_name:'Bash',input:{command:'echo fixture',run_in_background:true}}],['local',{tool_name:'Bash',input:{command:'echo fixture'},requires_user_interaction:true}]])child.request(id,{subtype:'can_use_tool',...p});
    if(replies(f).length===4)child.finish();
  });
  await f.runner({prompt:'test',request:async()=>{asks++;return {allow:false};}});
  assert.equal(asks,1);assert.ok(replies(f).every(x=>x.response.response.behavior==='deny'));
});

test('single question answers are routed through the same request and do not become a new tool task',async()=>{
  const question='Which filename?';let asked;
  const f=fixture((frame,child)=>{
    if(frame.type==='user')child.request('question',{subtype:'can_use_tool',tool_name:'AskUserQuestion',input:{questions:[{question}]}});
    if(frame.type==='control_response')child.finish();
  });
  await f.runner({prompt:'test',request:async req=>{asked=req;return {allow:true,answer:'note.txt'};}});
  assert.equal(asked.kind,'question');assert.deepEqual(replies(f)[0].response.response.updatedInput.answers,{[question]:'note.txt'});
});

test('CLI cancellation invalidates a pending approval and discards a late allow',async()=>{
  let release,approvalSignal;
  const f=fixture((frame,child)=>{
    if(frame.type==='user'){
      child.request('pending',{subtype:'can_use_tool',tool_name:'Write',input:{file_path:'test',content:'x'}});
      setImmediate(()=>{child.emitMessage({type:'control_cancel_request',request_id:'pending'});release({allow:true});child.finish();});
    }
  });
  await f.runner({prompt:'test',request:req=>{approvalSignal=req.signal;return new Promise(resolve=>{release=resolve;});}});
  assert.equal(approvalSignal.aborted,true);assert.equal(replies(f).length,0);
});

test('exact UUID resume uses a new owned process and retains conversation identity',async()=>{
  const f=fixture((frame,child)=>{if(frame.type==='user')child.finish();});
  const first=await f.runner({prompt:'first'}),second=await f.runner({prompt:'continue',resume:first.sessionId});
  assert.equal(second.sessionId,first.sessionId);assert.equal(f.launches.length,2);
  assert.equal(f.launches[1].args[f.launches[1].args.indexOf('--resume')+1],first.sessionId);
  assert.equal(f.launches[1].args.includes('--continue'),false);
  await assert.rejects(f.runner({prompt:'bad',resume:'latest'}),/UUID/);
});

test('cancellation interrupts the current input, invalidates approvals and waits for owned process exit',async()=>{
  const controller=new AbortController();let approvalSignal;
  const f=fixture((frame,child)=>{
    if(frame.type==='user'){child.request('pending',{subtype:'can_use_tool',tool_name:'Write',input:{}});setImmediate(()=>controller.abort());}
    if(frame.request?.subtype==='interrupt'){child.answer(frame.request_id,{still_queued:[],cancelled:[]});setTimeout(()=>child.finish({subtype:'error_during_execution',is_error:true}),10);}
  });
  const result=await f.runner({prompt:'wait',signal:controller.signal,request:req=>{approvalSignal=req.signal;return new Promise(()=>{});}});
  assert.equal(result.outcome,'cancelled');assert.equal(result.text,'');assert.match(result.notice,/进程已退出/);assert.equal(approvalSignal.aborted,true);
  assert.ok(f.frames.some(x=>x.request?.subtype==='interrupt'&&x.request.cancel_queued===true));assert.equal(f.children[0].exitCode,0);
});

test('unconfirmed process exit cannot be reported as cancelled',async()=>{
  const controller=new AbortController();
  const f=fixture((frame)=>{if(frame.type==='user')controller.abort();},{noExit:true,terminateImpl:async()=>{}});
  const result=await f.runner({prompt:'wait',signal:controller.signal});
  assert.equal(result.outcome,'error');assert.match(result.notice,/尚未确认/);assert.equal(result.text,'');
  await assert.rejects(f.runner({prompt:'do not start another process'}),/closed/);assert.equal(f.children.length,1);
});

test('timeout terminates only the spawned child after interrupt and EOF fail to end it',async()=>{
  let terminated=0;
  const f=fixture(()=>{}, {noExit:true,taskTimeoutMs:20,terminateImpl:async child=>{terminated++;child.exit();}});
  const result=await f.runner({prompt:'wait'});assert.equal(result.outcome,'limit');assert.equal(terminated,1);assert.match(result.notice,/进程已退出/);
});

test('wrong-session results, reused request IDs and oversized or malformed output fail closed',async()=>{
  for(const emit of [child=>child.finish({session_id:'other'}),child=>child.finish({session_id:undefined}),child=>child.stdout.write('not json\n'),child=>child.stdout.write('x'.repeat(2*1024*1024+1)),child=>{child.request('duplicate',{subtype:'unknown'});child.request('duplicate',{subtype:'unknown'});}]){
    const f=fixture((frame,child)=>{if(frame.type==='user')emit(child);});
    const result=await f.runner({prompt:'test'});assert.equal(result.outcome,'error');assert.equal(result.text,'');
  }
});

test('a valid reply followed by a failed process exit is reported as an error',async()=>{
  const f=fixture((frame,child)=>{if(frame.type==='user'){child.finish();child.exit(7);}});
  const result=await f.runner({prompt:'test'});assert.equal(result.outcome,'error');assert.equal(result.text,'');
});

test('close aborts startup/run and prevents more calls; a pre-aborted request starts no process',async()=>{
  const controller=new AbortController();controller.abort();const f=fixture();
  assert.equal((await f.runner({prompt:'test',signal:controller.signal})).outcome,'cancelled');assert.equal(f.children.length,0);
  const g=fixture(()=>{}, {noInitialize:true});const pending=g.runner({prompt:'test'});await tick();await g.runner.close();
  assert.equal((await pending).outcome,'cancelled');await assert.rejects(g.runner({prompt:'again'}),/closed/);
});
