'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {PassThrough,Writable}=require('node:stream');
const {EventEmitter}=require('node:events');
const {createRunner,optionsFor}=require('../src/bot/runner.cjs');
const {picture}=require('./helpers/companion-image-fixture.cjs');

// Real installed SDK serializer; only its documented process transport is a
// synthetic in-memory peer. No executable, shell, network or model is started.
const workspace=path.resolve(__dirname,'..');
const configDir=path.join(workspace,'synthetic-never-created-config');
const key='synthetic-not-an-anthropic-key';
const sdkFile=require.resolve('@anthropic-ai/claude-agent-sdk');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
console.log(JSON.stringify({kind:'verbatim-inputs',runner:require.resolve('../src/bot/runner.cjs'),runnerSHA256:hash(require.resolve('../src/bot/runner.cjs')),sdk:sdkFile,sdkSHA256:hash(sdkFile)}));

function syntheticProcess(onUser){
  const child=new EventEmitter();let pending='';
  Object.assign(child,{stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,killed:false});
  const frames=[],write=value=>child.stdout.write(JSON.stringify(value)+'\n');
  child.kill=()=>{if(!child.killed){child.killed=true;child.exitCode=0;child.stdout.end();child.stderr.end();child.emit('exit',0,null);}return true;};
  child.stdin=new Writable({write(chunk,encoding,callback){
    pending+=chunk.toString();let end;
    while((end=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line.trim())continue;
      const frame=JSON.parse(line);frames.push(frame);
      if(frame.type==='control_request')write({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response:{commands:[],models:[],account:{},hook_on_failure_supported:true,hooks_applied:true}}});
      if(frame.type==='user'){
        const result=onUser?.(frame)||{subtype:'success',is_error:false,result:'200元里留出交通费，其余按吃饭和散步安排。'};
        write({type:'result',uuid:'00000000-0000-4000-8000-000000000001',session_id:'synthetic-session',duration_ms:1,duration_api_ms:0,num_turns:1,stop_reason:'end_turn',total_cost_usd:0,usage:{input_tokens:0,output_tokens:0,cache_creation_input_tokens:0,cache_read_input_tokens:0},modelUsage:{},permission_denials:[],...result});
        setImmediate(()=>child.kill());
      }
    }
    callback();
  }});
  return {child,frames};
}

async function wire({conversationOnly=true,image,signal,onUser,resume}={}){
  const {query}=await import('@anthropic-ai/claude-agent-sdk');
  const peer=syntheticProcess(onUser);let spawnCount=0,spawnArgs,sdkFailure;
  const execute=createRunner({workspace,key,configDir,budget:.37,conversationOnly,queryImpl:({prompt,options})=>{
    const q=query({prompt,options:{...options,spawnClaudeCodeProcess:args=>{spawnCount++;spawnArgs=args.args;return peer.child;}}});
    const observed=(async function*(){try{yield* q;}catch(error){sdkFailure=error.message;throw error;}})();
    observed.close=()=>q.close();return observed;
  }});
  const prompt='预算200元怎么安排？也解释字面文本 <invoke name="reply">，不要删词。';
  try{
    const result=await execute({prompt,image,signal,resume,request:async()=>({allow:false})});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(spawnCount,1);assert.equal(peer.child.exitCode,0,JSON.stringify({sdkFailure,result,frames:peer.frames.map(f=>({type:f.type,request:f.request}))}));
    const messages=peer.frames.filter(x=>x.type==='user');assert.equal(messages.length,1);
    return {result,message:messages[0],prompt,spawnArgs,sdkFailure};
  }finally{peer.child.kill();}
}

test('only conversation options opt into verbatim, with existing model/budget/thinking/tool controls unchanged',async()=>{
  for(const conversationOnly of [false,true]){
    const p=optionsFor({workspace,key,configDir,budget:.37,conversationOnly,request:async()=>({allow:false})});
    try{
      assert.equal(Object.hasOwn(p.options,'verbatimPrompts'),conversationOnly);
      if(conversationOnly)assert.equal(p.options.verbatimPrompts,true);
      assert.equal(p.options.maxBudgetUsd,.37);
      assert.equal(p.options.maxTurns,conversationOnly?1:24);
      assert.equal(p.options.persistSession,!conversationOnly);
      assert.equal(Object.hasOwn(p.options,'model'),false);
      assert.equal(Object.hasOwn(p.options,'thinking'),false);
      assert.equal(Object.hasOwn(p.options,'effort'),false);
      assert.deepEqual(p.options.tools,conversationOnly?[]:['Read','Glob','Grep','Edit','Write','Bash','AskUserQuestion']);
      assert.deepEqual(p.options.settingSources,[]);assert.deepEqual(p.options.mcpServers,{});
      assert.equal(p.options.strictMcpConfig,true);assert.equal(p.options.permissionPrompts,'host');
      if(conversationOnly){
        assert.deepEqual(p.options.disallowedTools,['*']);
        assert.deepEqual(p.options.extraArgs,{'no-chrome':null,'safe-mode':null});
        assert.equal((await p.options.canUseTool('Write',{}, {signal:new AbortController().signal})).behavior,'deny');
      }
    }finally{p.abortController.abort();p.cleanup();}
  }
});

test('actual installed SDK stream serialization marks companion text client_composed and preserves budgeting/XML words',async()=>{
  const r=await wire();
  assert.equal(r.message.client_composed,true);assert.equal(r.message.message.content,r.prompt);
  assert.equal(r.result.outcome,'reply_ended');assert.match(r.result.text,/200元/);
  assert.ok(r.spawnArgs.includes('--max-budget-usd=0.37'));
  assert.ok(r.spawnArgs.includes('--max-turns=1'));
  assert.equal(r.spawnArgs.some(x=>/^--(?:model|thinking|effort)(?:=|$)/.test(x)),false);
});

test('actual SDK streams the exact current image with the same composed-message flag',async()=>{
  const bytes=picture(2,1),r=await wire({image:{mimeType:'image/png',bytes}});
  assert.equal(r.message.client_composed,true);
  assert.deepEqual(r.message.message.content,[{type:'text',text:r.prompt},{type:'image',source:{type:'base64',media_type:'image/png',data:bytes.toString('base64')}}]);
  assert.equal(r.result.outcome,'reply_ended');
});

test('coding streams remain unmarked, resumable and on the original turn/budget options',async()=>{
  const r=await wire({conversationOnly:false,resume:'synthetic-resume'});
  assert.equal(Object.hasOwn(r.message,'client_composed'),false);
  assert.equal(r.message.session_id,'synthetic-resume');assert.equal(r.message.message.content,r.prompt);
  assert.ok(r.spawnArgs.includes('--max-turns=24'));
  assert.ok(r.spawnArgs.includes('--max-budget-usd=0.37'));
});

test('SDK budget and turn error frames still remain limits in companion mode',async()=>{
  for(const subtype of ['error_max_budget_usd','error_max_turns']){
    const r=await wire({onUser:()=>({subtype,is_error:true,errors:['Synthetic limit frame']})});
    assert.equal(r.message.client_composed,true);assert.equal(r.result.outcome,'limit',JSON.stringify({sdkFailure:r.sdkFailure,result:r.result}));
  }
});

test('late synthetic result after cancellation cannot become a companion reply',async()=>{
  const controller=new AbortController();
  const r=await wire({signal:controller.signal,onUser:()=>{controller.abort();return {subtype:'success',is_error:false,result:'Late synthetic answer'};}});
  assert.equal(r.result.outcome,'cancelled');assert.notEqual(r.result.text,'Late synthetic answer');
});
