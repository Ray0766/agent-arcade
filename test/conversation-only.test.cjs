'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDeepSeekRunner}=require('../src/bot/deepseek-runner.cjs');
const {createGPTRunner}=require('../src/bot/gpt-runner.cjs');
const {createCodexRunner}=require('../src/bot/codex-runner.cjs');
const {optionsFor}=require('../src/bot/runner.cjs');
const key='fixture-key-no-real-provider';
function workspace(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-no-tools-'));t.after(()=>{assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});return root;}
for(const [name,create,reply,rogue]of [
  ['DeepSeek',createDeepSeekRunner,{choices:[{finish_reason:'stop',message:{role:'assistant',content:'你好'}}]},
    {choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'call_a',type:'function',function:{name:'Write',arguments:'{"path":"never.txt","content":"NO"}'}}]}}]}],
  ['GPT',createGPTRunner,{status:'completed',output:[{id:'msg_a',type:'message',role:'assistant',content:[{type:'output_text',text:'你好'}]}]},
    {status:'completed',output:[{id:'fc_a',type:'function_call',call_id:'call_a',name:'Write',arguments:'{"path":"never.txt","content":"NO"}'}]}]
]){
  test(`${name} conversation-only sends no tools, rejects old sessions and refuses unexpected provider calls`,async t=>{
    const root=workspace(t),requests=[],responses=[reply,rogue];let approvals=0;
    const run=create({workspace:root,key,conversationOnly:true,fetchImpl:async(url,init)=>{requests.push(JSON.parse(init.body));return Response.json(responses.shift());}});
    t.after(()=>run.close());
    const first=await run({prompt:'hello',request:async()=>{approvals++;return {allow:true};}});
    assert.equal(first.outcome,'reply_ended');assert.equal(first.text,'你好');
    assert.deepEqual(requests[0].tools,[]);assert.equal(requests[0].tool_choice,'none');
    assert.equal((await run({prompt:'do not resume',resume:first.sessionId,request:async()=>({allow:true})})).outcome,'error');
    assert.equal(requests.length,1);
    const second=await run({prompt:'rogue response',request:async()=>{approvals++;return {allow:true};}});
    assert.equal(second.outcome,'error');assert.equal(approvals,0);assert.equal(requests.length,2);assert.deepEqual(fs.readdirSync(root),[]);
  });
}
test('Claude API conversation mode advertises no tools, has no persisted coding resume and denies callbacks',async t=>{
  const root=workspace(t);let approvals=0;
  const prepared=optionsFor({workspace:root,key,configDir:root,conversationOnly:true,request:async()=>{approvals++;return {allow:true};}});
  t.after(prepared.cleanup);assert.deepEqual(prepared.options.tools,[]);assert.deepEqual(prepared.options.disallowedTools,['*']);assert.equal(prepared.options.persistSession,false);
  assert.ok(Object.hasOwn(prepared.options.extraArgs,'safe-mode'));
  const hook=await prepared.options.hooks.PreToolUse[0].hooks[0]({tool_name:'Write'});
  assert.equal(hook.hookSpecificOutput.permissionDecision,'deny');
  assert.equal((await prepared.options.canUseTool('Write',{}, {signal:new AbortController().signal})).behavior,'deny');
  assert.equal(approvals,0);
  assert.throws(()=>optionsFor({workspace:root,key,configDir:root,conversationOnly:true,resume:'old-task'}),/cannot resume/);
});
test('local Codex does not masquerade as a no-tool social runner without a verified protocol guarantee',()=>{
  assert.throws(()=>createCodexRunner({workspace:process.cwd(),conversationOnly:true}),/not yet supported/);
});
