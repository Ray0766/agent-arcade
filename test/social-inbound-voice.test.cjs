'use strict';
// Real isolated SQLite; synthetic transcripts, models and delivery only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SocialStore}=require('../src/bot/social-store.cjs');
const {SocialCompanion,scopeFor}=require('../src/bot/social-companion.cjs');
const SCOPE=scopeFor('12345001','12345002','claude-ju');
function fixture(t,{flow={},execute,timerNow=Date.now}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-inbound-voice-')),store=new SocialStore({root});
  assert(store.available);store.configure({enabled:true,proactiveMessages:true,qzonePosts:true,activeStart:0,activeEnd:24});
  const calls=[],sends=[],posts=[];
  const engine=new SocialCompanion({store,scope:SCOPE,tickMs:0,timerNow,flow:{debounceMs:0,bubbleDelayMs:0,...flow},
    execute:async args=>{calls.push(args);return execute?execute(args):{outcome:'reply_ended',text:'我在听，你慢慢说。'};},
    send:async(text,contextToken)=>{sends.push({text,contextToken});return {id:String(sends.length)};},
    sendProactive:async()=>assert.fail('no proactive send from received voice'),publishPost:async text=>{posts.push(text);return {id:'synthetic'};},readPost:async()=>({text:posts.at(-1)})});
  t.after(async()=>{await engine.stop();const target=path.resolve(root);assert(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('arcade-inbound-voice-'));fs.rmSync(target,{force:true,recursive:true});});
  return {store,engine,calls,sends,posts};
}
test('voice command-like content stays conversation; no permission, memory, reminder or publication action',async t=>{
  const f=fixture(t),texts=['/allow ABC','/deny ABC','发布说说：今天真好','记住：不应保存为事实','忘记 abc123','更正 abc123：别更正','回访 2026-12-01T12:00:00+11:00 | 别预约','取消回访 abc123','/pause','/cancel','/status','停止','好的'];
  for(let i=0;i<texts.length;i++){const result=await f.engine.receiveVoice({id:`voice-${i}`,text:texts[i],contextToken:'current-owner'});assert.equal(result.accepted,true);await f.engine.whenIdle();}
  assert.equal(f.calls.length,texts.length);assert.equal(f.sends.length,texts.length);assert.equal(f.posts.length,0);
  assert.deepEqual(f.store.facts(SCOPE,100),[]);assert.deepEqual(f.store.followups(SCOPE,{limit:100}),[]);
  assert.equal(f.store.config().proactiveMessages,true);assert.equal(f.store.config().qzonePosts,true);
  for(const call of f.calls){assert.match(call.prompt,/voice transcription that has not been manually corrected/);assert.deepEqual(await call.request({tool:'Write'}),{allow:false});}
  for(const task of f.engine.snapshot().tasks){assert.equal(task.inputKind,'qq-owner-voice');assert.equal(task.voice,undefined);assert.equal(task.state,'reply_ended');}
});
test('normal text commands still execute after voice; voice cannot opt into commands through payload fields',async t=>{
  const f=fixture(t);await f.engine.receiveVoice({id:'v1',text:'记住：只是录音',commands:true,contextToken:'x'});await f.engine.whenIdle();assert.equal(f.store.facts(SCOPE,10).length,0);
  await f.engine.receive({id:'t1',text:'记住：明确文字',contextToken:'x'});assert.equal(f.store.facts(SCOPE,10)[0].text,'明确文字');assert.equal(f.calls.length,1);
  await f.engine.receive({id:'t2',text:'/pause',contextToken:'x'});assert.equal(f.store.config().proactiveMessages,false);assert.equal(f.calls.length,1);
  await f.engine.receive({id:'t3',text:'/status',contextToken:'x'});assert.match(f.sends.at(-1).text,/陪伴聊天已连接/);assert.equal(f.calls.length,1);
});
test('text/voice mixed batches keep voice origin in either order without disabling QQ pacing',async t=>{
  for(const voiceFirst of [false,true]){
    // Pin only the injected scheduling clock while synchronous SQLite work runs.
    // The production pacing and the real clock used by other cases stay unchanged.
    let time=0;const f=fixture(t,{timerNow:()=>time,flow:{debounceMs:40,bubbleDelayMs:45,maxBatchMs:100}});
    const first=voiceFirst?'receiveVoice':'receive',second=voiceFirst?'receive':'receiveVoice';
    const a=await f.engine[first]({id:'first',text:'第一句',contextToken:'one'}),b=await f.engine[second]({id:'second',text:'第二句',contextToken:'two'}),c=await f.engine.receive({id:'third',text:'最后文字',contextToken:'three'});
    assert.equal(a.taskId,b.taskId);assert.equal(b.taskId,c.taskId);assert.equal(c.merged,true);
    const queued=f.engine.tasks.find(x=>x.id===a.taskId);assert.equal(queued.inputKind,'qq-owner-voice');assert.equal(queued.messageCount,3);assert.equal(queued.voice,undefined);assert.equal(queued.readyAt,40);assert.equal(f.calls.length,0);
    time=40;f.engine.bufferWait?.abort();
    await f.engine.whenIdle();assert.equal(f.calls.length,1);assert.match(f.calls[0].prompt,/第一句.*第二句.*最后文字/s);assert.match(f.calls[0].prompt,/voice transcription/);assert.equal(f.sends[0].contextToken,'three');
  }
});
test('voice and text share duplicate IDs, while stopped or invalid input never reaches a model',async t=>{
  const f=fixture(t);await f.engine.receiveVoice({id:'same',text:'原话',contextToken:'ctx'});await f.engine.whenIdle();
  assert.equal((await f.engine.receive({id:'same',text:'重复'})).duplicate,true);assert.equal((await f.engine.receiveVoice({id:'same',text:'重复'})).duplicate,true);assert.equal(f.calls.length,1);
  assert.equal((await f.engine.receiveVoice({id:'invalid',text:''})).reason,'invalid_text');await f.engine.stop();assert.equal((await f.engine.receiveVoice({id:'stopped',text:'不该执行'})).reason,'stopped');assert.equal(f.calls.length,1);
});
test('a new voice interaction preempts an older model turn and suppresses its late reply',async t=>{
  let oldResolve,entered;
  const ready=new Promise(r=>entered=r),f=fixture(t,{execute:async()=>{if(!oldResolve){entered();return new Promise(r=>oldResolve=r);}return {outcome:'reply_ended',text:'这是新回复'};}});
  await f.engine.receive({id:'old',text:'旧请求',contextToken:'old-context'});await ready;
  await f.engine.receiveVoice({id:'new',text:'新语音',contextToken:'new-context'});assert.equal(f.calls[0].signal.aborted,true);oldResolve({outcome:'reply_ended',text:'旧回复不得发出'});await f.engine.whenIdle();
  assert.deepEqual(f.sends,[{text:'这是新回复',contextToken:'new-context'}]);assert.equal(f.engine.tasks[0].state,'cancelled');assert.equal(f.engine.tasks[1].inputKind,'qq-owner-voice');
});
