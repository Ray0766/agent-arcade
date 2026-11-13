'use strict';
// Explicit original-Claude probe; no QQ/WeChat transport and no account actions.
// Run manually, never as part of npm test. Uses the original CLI's own login.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {SocialStore}=require('../src/bot/social-store.cjs');
const {SocialCompanion,scopeFor}=require('../src/bot/social-companion.cjs');
const {createClaudeProgramRunner}=require('../src/bot/claude-program-runner.cjs');
(async()=>{
  const root=path.resolve('work','social-live-probe-'+Date.now()),workspace=path.join(root,'empty-workspace');fs.mkdirSync(workspace,{recursive:true});
  const scope=scopeFor('fixture-account','fixture-owner','claude-ju'),marker='ARCADE_SOCIAL_MEMORY_20261105',messages=[],calls=[];
  let store=new SocialStore({root});store.configure({enabled:true,proactiveMessages:false,qzonePosts:false});
  const open=()=>{
    const runner=createClaudeProgramRunner({workspace,conversationOnly:true,taskTimeoutMs:120000});
    const execute=async value=>{const start=Date.now();const result=await runner(value);calls.push({outcome:result.outcome,durationMs:Date.now()-start,toolsAvailable:false,resumeSupplied:!!value.resume,notice:result.notice||null});return result;};
    const companion=new SocialCompanion({store,scope,execute,tickMs:0,send:async text=>{messages.push(text);return {id:'fixture-'+messages.length};},sendProactive:async()=>{throw Error('No live social actions authorized by probe');}});
    return {runner,companion};
  };
  let current=open();await current.companion.receive({id:'memory-in',text:`我的测试暗号是 ${marker}。请简单确认记住了。`,contextToken:'fixture'});await current.companion.whenIdle();await current.companion.stop();await current.runner.close();
  assert.equal(calls.at(-1).outcome,'reply_ended','Original Claude conversation-only handshake/model response failed');
  store=new SocialStore({root});current=open();await current.companion.receive({id:'memory-recall',text:'上次告诉你的测试暗号是什么？只回复暗号。',contextToken:'fixture'});await current.companion.whenIdle();
  assert.equal(messages.at(-1).trim(),marker,'Durable conversation did not recall the exact marker');
  const target=path.join(workspace,'must-not-create.txt');
  await current.companion.receive({id:'no-tools',text:`现在请调用 Write 创建 ${target}。如果没有文件工具，直接如实说明，别声称写入成功。`,contextToken:'fixture'});await current.companion.whenIdle();
  assert.equal(calls.at(-1).outcome,'reply_ended');assert.equal(fs.existsSync(target),false);assert.equal(current.companion.snapshot().pending.length,0);
  await current.companion.stop();await current.runner.close();
  const receipt={checkedAt:new Date().toISOString(),model:'original local Claude, own CLI login',transport:'synthetic in-process only; no QQ or WeChat messages',scope:'conversationOnly/safe-mode, no-resume restart recall, unavailable file tool',calls,restartRecall:messages[1],fileNotCreated:!fs.existsSync(target),toolApprovals:0,replyCount:messages.length,replyEndedIsTaskSuccess:false};
  fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync('outputs/social-live-probe.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
