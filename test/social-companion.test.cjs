'use strict';
// Real local SQLite, deterministic clocks, synthetic models/transports only.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {SocialStore} = require('../src/bot/social-store.cjs');
const {SocialCompanion, scopeFor} = require('../src/bot/social-companion.cjs');
const {DEFAULT_FLOW} = require('../src/bot/social-flow.cjs');
const {incomingBody}=require('./helpers/social-incoming-frame.cjs');
const {MessageJournal} = require('../src/bot/journal.cjs');

const START = new Date(2026, 10, 5, 12, 0, 0).getTime(), MINUTE = 60000;
const SCOPE = scopeFor('87654321', '12345678', 'claude-ju');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-social-engine-'));
  const clock = {time: START}, now = () => clock.time;
  const store = new SocialStore({root, now}); assert.equal(store.available, true);
  store.configure({enabled: true, proactiveMessages: true, qzonePosts: true, activeStart: 0, activeEnd: 24,
    intervalMinutes: 30, maxMessagesPerDay: 2, maxPostsPerDay: 1, ...options.config});
  const calls = [], messages = [], replies = [], posts = [], reads = [], engines = [];
  const create = (selectedStore = store, extra = {}) => {
    const engine = new SocialCompanion({store: selectedStore, scope: SCOPE, now, tickMs: 0, flow: {debounceMs:0,bubbleDelayMs:0},
      execute: async args => {
        calls.push(args);
        return options.execute ? options.execute(args, calls.length) : {outcome: 'reply_ended', text: args.prompt.includes('Consider whether') ? '{"action":"message","text":"前面聊的那本书，后来读得怎么样了？"}' : '我记得，我们接着聊。'};
      },
      send: async (text, contextToken) => { replies.push({text, contextToken}); return {id: 'reply-' + replies.length}; },
      sendProactive: async (text, id, signal) => { messages.push({text, id, signal}); if (options.sendError) throw Error('synthetic ambiguous timeout'); return {id: 'message-' + messages.length}; },
      publishPost: async (text, id, signal) => { posts.push({text, id, signal}); return {id: 'post-' + posts.length, visibilityVerified: false}; },
      readPost: async id => { reads.push(id); return {id, text: posts.at(-1).text}; },
      ...extra});
    engines.push(engine); return engine;
  };
  const engine = create();
  const seed = (text = '我在读一本关于海洋的书。', at = clock.time - 20 * MINUTE, id = 'seed') => store.append(SCOPE, {id, role: 'user', text, at});
  t.after(async () => {
    for (const item of engines) await item.stop();
    const resolved = path.resolve(root), parent = path.resolve(os.tmpdir()) + path.sep;
    assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('arcade-social-engine-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  return {root, clock, now, store, engine, create, seed, calls, messages, replies, posts, reads};
}

test('post generation uses a fresh context without private memory or conversation and never supplies model account tools', async t => {
  const privateNote = 'PRIVATE_NOTE_A7391', privateChat = 'PRIVATE_CONVERSATION_B8402';
  const f = fixture(t, {execute: async (_args, call) => ({outcome: 'reply_ended', text: call === 1 ? '{"action":"post","text":"discard this decision draft"}' : '把书页里的海浪，留给今天的小小想象。'})});
  f.store.setNotes(SCOPE, privateNote); f.seed(privateChat);
  f.store.scheduleFollowup(SCOPE,{text:'PRIVATE_FOLLOWUP_C9513',dueAt:f.now()+86400000,timeZone:'UTC'});
  const result = await f.engine.consider();
  assert.deepEqual(result, {action: 'post', accepted: true, visibilityVerified: false});
  assert.equal(f.calls.length, 2); assert.match(f.calls[0].prompt, /PRIVATE_NOTE_A7391/); assert.match(f.calls[0].prompt, /PRIVATE_CONVERSATION_B8402/);
  assert.match(f.calls[0].prompt,/PRIVATE_FOLLOWUP_C9513/);
  assert.doesNotMatch(f.calls[1].prompt, /PRIVATE_NOTE_A7391|PRIVATE_CONVERSATION_B8402|PRIVATE_FOLLOWUP_C9513|discard this decision draft/);
  for (const call of f.calls) { assert.equal(Object.hasOwn(call, 'resume'), false); assert.deepEqual(await call.request({tool: 'Write'}), {allow: false}); }
  assert.equal(f.posts.length, 1); assert.equal(f.messages.length, 0); assert.deepEqual(f.reads, ['post-1']);
  assert.equal(f.store.actions(SCOPE, 20).find(a => a.kind === 'post').state, 'published');
});

test('QQ bubble diagnostics freeze unattempted and in-flight counts at cancellation while retaining late receipts', async t => {
  const model=deferred(),secondSend=deferred(),secondEntered=deferred();
  t.after(()=>{model.resolve({outcome:'reply_ended',text:'一\n\n二\n\n三\n\n四'});secondSend.resolve({id:'second-receipt'});});
  const f=fixture(t,{execute:()=>model.promise}),journal=new MessageJournal({root:f.root,now:f.now});let engine,calls=0;
  engine=f.create(f.store,{onChange:()=>journal.observe(engine.snapshot()),send:async()=>{calls++;if(calls===2){secondEntered.resolve();return secondSend.promise;}return {id:`receipt-${calls}`};}});
  journal.claim('owner','bubble-cancel','deepseek');
  const input=await engine.receive({id:'bubble-cancel',text:'PRIVATE_REQUEST',contextToken:'PRIVATE_TOKEN'});
  journal.disposition('owner','bubble-cancel','queued',input.taskId);journal.observe(engine.snapshot());
  model.resolve({outcome:'reply_ended',text:'PRIVATE_ONE\n\nPRIVATE_TWO\n\nPRIVATE_THREE\n\nPRIVATE_FOUR'});
  await secondEntered.promise;engine.cancel();
  const cancelled=engine.snapshot().tasks[0].bubbleDelivery;
  assert.deepEqual(cancelled,{version:1,planned:4,attempted:2,accepted:1,unknown:0,inFlight:1,unattemptedAtCancel:2,inFlightAtCancel:1});
  assert.equal(journal.snapshot().companionDelivery[0].unattemptedAtCancel,2);assert.equal(journal.snapshot().companionDelivery[0].inFlight,1);
  secondSend.resolve({id:'second-receipt'});await engine.whenIdle();
  const final=engine.snapshot().tasks[0];assert.equal(final.state,'cancelled');assert.equal(calls,2);
  assert.deepEqual(final.bubbleDelivery,{...cancelled,accepted:2,inFlight:0});
  assert.equal(cancelled.accepted,1,'previous snapshots cannot mutate into later receipt evidence');
  const saved=journal.snapshot().companionDelivery[0];assert.equal(saved.accepted,2);assert.equal(saved.inFlight,0);assert.equal(saved.inFlightAtCancel,1);
  assert.equal(journal.available,true);assert.doesNotMatch(JSON.stringify(journal.snapshot()),/PRIVATE_/);
  assert.doesNotMatch(fs.readFileSync(journal.file).toString('utf8'),/PRIVATE_/);
});

test('unknown or generic bubble acknowledgements never become confirmed accepted counters', async t => {
  for(const result of ['throw','generic']){
    const f=fixture(t,{execute:async()=>({outcome:'reply_ended',text:'第一段\n\n第二段'})});
    let sends=0;
    const engine=f.create(f.store,{send:async()=>{sends++;if(result==='throw')throw Error('ambiguous');return {};}});
    await engine.receive({id:result,text:'聊聊'});await engine.whenIdle();
    const d=engine.snapshot().tasks[0].bubbleDelivery;assert.equal(d.accepted,0);assert.equal(d.inFlight,0);
    assert.equal(d.unknown,result==='throw'?1:2);assert.equal(d.attempted,sends);assert.equal(d.unattemptedAtCancel,null);
  }
});

test('a failed pre-send durable action does not count an attempt and local replies do not gain QQ counters', async t => {
  const f=fixture(t,{execute:async()=>({outcome:'reply_ended',text:'第一段\n\n第二段'})});
  const record=f.store.recordAction.bind(f.store);f.store.recordAction=()=>{throw Error('synthetic storage failure');};
  await f.engine.receive({id:'no-send',text:'聊聊'});await f.engine.whenIdle();
  const task=f.engine.snapshot().tasks[0];assert.equal(task.state,'error');assert.equal(task.bubbleDelivery.planned,2);assert.equal(task.bubbleDelivery.attempted,0);assert.equal(f.replies.length,0);
  f.store.recordAction=record;await f.engine.respondLocally('本地聊聊');
  assert.equal(f.engine.snapshot().tasks.at(-1).bubbleDelivery,undefined);
});

test('chat remains quiet for fifteen minutes and an unanswered proactive message is not repeated', async t => {
  const f = fixture(t, {config: {qzonePosts: false}}); f.seed('我想聊一下那本书。', f.clock.time);
  assert.deepEqual(await f.engine.consider(), {action: 'wait', reason: 'quiet_or_limit'}); assert.equal(f.calls.length, 0);
  f.clock.time += 14 * MINUTE; await f.engine.consider(); assert.equal(f.calls.length, 0);
  f.clock.time += MINUTE; assert.equal((await f.engine.consider()).accepted, true); assert.equal(f.messages.length, 1);
  f.clock.time += 3 * 60 * MINUTE; assert.equal((await f.engine.consider()).action, 'wait');
  f.clock.time += 24 * 60 * MINUTE; assert.equal((await f.engine.consider()).action, 'wait');
  assert.equal(f.messages.length, 1); assert.equal(f.calls.length, 1);
});

test('daily proactive allowance and unanswered-message barrier survive store and engine restart', async t => {
  const f = fixture(t, {config: {qzonePosts: false, maxMessagesPerDay: 1}}); f.seed();
  assert.equal((await f.engine.consider()).accepted, true); await f.engine.stop();
  f.clock.time += MINUTE; f.store.append(SCOPE, {id: 'answered', role: 'user', text: '读完了，明天继续聊。', at: f.clock.time});
  f.clock.time += 45 * MINUTE;
  const restored = new SocialStore({root: f.root, now: f.now}), second = f.create(restored);
  assert.equal(restored.available, true); assert.equal(restored.history(SCOPE).at(-1).text, '读完了，明天继续聊。');
  assert.equal((await second.consider()).action, 'wait'); assert.equal(f.messages.length, 1);
  assert.equal(restored.actions(SCOPE, 200).filter(a => a.kind === 'message').length, 1);
  f.clock.time += 24 * 60 * MINUTE;
  assert.equal((await second.consider()).accepted, true); assert.equal(f.messages.length, 2);
});

test('incoming conversation preempts a pending initiative and receives its own reply serially', async t => {
  const pending = deferred(); t.after(() => pending.resolve({outcome: 'reply_ended', text: '{"action":"wait","text":""}'}));
  const f = fixture(t, {execute: async (args, call) => call === 1 ? pending.promise : {outcome: 'reply_ended', text: '我在，先听你说。'}}); f.seed();
  const initiative = f.engine.consider(); await turn(); assert.equal(f.calls.length, 1);
  await f.engine.receive({id: 'new-input', text: '先听我说一件刚发生的事。', contextToken: 'fresh-context'});
  assert.equal(f.calls[0].signal.aborted, true); assert.equal(f.calls.length, 1, 'new model call waits for prior runner to settle');
  pending.resolve({outcome: 'reply_ended', text: '{"action":"message","text":"stale initiative"}'});
  await initiative; await f.engine.whenIdle();
  assert.equal(f.messages.length, 0); assert.equal(f.replies.length, 1); assert.equal(f.replies[0].text, '我在，先听你说。');
  assert.equal(incomingBody(f.calls[1].prompt),'先听我说一件刚发生的事。');
});

test('pausing prevents a late model result from sending and still permits ordinary incoming chat', async t => {
  const pending = deferred(); t.after(() => pending.resolve({outcome: 'reply_ended', text: '{"action":"wait","text":""}'}));
  const f = fixture(t, {execute: async (_args, call) => call === 1 ? pending.promise : {outcome: 'reply_ended', text: '当然，我们照常聊。'}}); f.seed();
  const initiative = f.engine.consider(); await turn(); f.engine.pause();
  assert.equal(f.calls[0].signal.aborted, true); assert.equal(f.store.config().proactiveMessages, false); assert.equal(f.store.config().qzonePosts, false);
  pending.resolve({outcome: 'reply_ended', text: '{"action":"message","text":"too late"}'}); await initiative;
  assert.equal(f.messages.length, 0); assert.equal(f.posts.length, 0);
  await f.engine.receive({id: 'after-pause', text: '我回来了。', contextToken: 'fresh'}); await f.engine.whenIdle();
  assert.equal(f.replies.length, 1); assert.equal(f.engine.stopped, false);
});

test('an ambiguous proactive timeout is journaled once and is not replayed after restart', async t => {
  const f = fixture(t, {sendError: true, config: {qzonePosts: false}}); f.seed();
  assert.deepEqual(await f.engine.consider(), {action: 'message', accepted: false});
  assert.equal(f.messages.length, 1); assert.equal(f.store.actions(SCOPE, 20).find(a => a.kind === 'message').state, 'unknown');
  await f.engine.stop(); f.clock.time += 60 * MINUTE;
  const second = f.create(new SocialStore({root: f.root, now: f.now}));
  assert.equal((await second.consider()).action, 'wait'); assert.equal(f.messages.length, 1);
});

test('new input interrupts the old reply and keeps exact input when the stored history window changes', async t => {
  const first = deferred(); t.after(() => first.resolve({outcome: 'reply_ended', text: 'first done'}));
  const f = fixture(t, {execute: async (_args, call) => call === 1 ? first.promise : {outcome: 'reply_ended', text: 'answer to queued input'}});
  await f.engine.receive({id: 'first', text: 'first-original', contextToken: 'first-context'}); await turn();
  await f.engine.receive({id: 'queued', text: 'queued-original', contextToken: 'queued-context'});
  for (let n = 0; n < 35; n++) f.store.append(SCOPE, {id: 'future-' + n, role: 'user', text: 'future-marker-' + n, at: ++f.clock.time});
  first.resolve({outcome: 'reply_ended', text: 'first done'}); await f.engine.whenIdle();
  assert.equal(f.calls.length, 2); assert.equal(incomingBody(f.calls[1].prompt),'queued-original');
  assert.doesNotMatch(f.calls[1].prompt, /future-marker-/); assert.equal(f.replies.length, 1); assert.equal(f.replies[0].contextToken, 'queued-context');
  assert.equal(f.engine.snapshot().tasks[0].state, 'cancelled');
});

test('a confirmed send receipt remains sent if appending outgoing memory later fails', async t => {
  const f = fixture(t); const append = f.store.append.bind(f.store);
  f.store.append = (scope, message) => { if (message.role === 'assistant') throw Error('synthetic storage write failure'); return append(scope, message); };
  await f.engine.receive({id: 'incoming', text: '你好。', contextToken: 'context'}); await f.engine.whenIdle();
  assert.equal(f.replies.length, 1);
  const action = f.store.actions(SCOPE, 20).find(a => a.kind === 'reply');
  assert.equal(action.state, 'sent'); assert.equal(action.receipt, 'reply-1');
  assert.equal(f.engine.activityFailed, true); assert.match(f.engine.problem, /接口已接受/);
  assert.equal(f.engine.snapshot().tasks[0].deliveryFailed, false);
});

test('post readback failure retains the publish receipt and never republishes', async t => {
  const f = fixture(t, {execute: async (_args, call) => ({outcome: 'reply_ended', text: call === 1 ? '{"action":"post","text":""}' : '把好奇心夹进书页里。'})}); f.seed();
  f.engine.readPost = async () => { throw Error('synthetic readback failure'); };
  assert.equal((await f.engine.consider()).accepted, true); assert.equal(f.posts.length, 1);
  const post = f.store.actions(SCOPE, 20).find(a => a.kind === 'post'); assert.equal(post.state, 'published'); assert.equal(post.receipt, 'post-1');
  assert.match(f.engine.problem, /正文读回尚未确认/);
  f.clock.time += 60 * MINUTE; await f.engine.consider(); assert.equal(f.posts.length, 1);
});

test('invalid/control-only input and storage snapshot failure do not produce external actions', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.engine.receive({id: 'empty', text: '\x07', contextToken: 'ctx'}), {accepted: false, reason: 'invalid_text'});
  assert.equal(f.calls.length, 0); assert.equal(f.replies.length, 0);
  f.store.available = false; assert.doesNotThrow(() => f.engine.snapshot());
  assert.deepEqual(f.engine.snapshot().messages, []);
});

test('Qzone daily publishing limit survives restart independently of conversation history', async t => {
  const f = fixture(t, {config: {proactiveMessages: false, maxPostsPerDay: 1}, execute: async (_args, call) =>
    ({outcome: 'reply_ended', text: call % 2 ? '{"action":"post","text":""}' : '书签上可以住一小片海。'})});
  f.seed(); assert.equal((await f.engine.consider()).accepted, true); await f.engine.stop();
  f.clock.time += 60 * MINUTE; const second = f.create(new SocialStore({root: f.root, now: f.now}));
  assert.equal((await second.consider()).action, 'wait'); assert.equal(f.posts.length, 1); assert.equal(f.calls.length, 2);
});

test('model decisions cannot add public audience or arbitrary social actions', async t => {
  const f = fixture(t, {execute: async () => ({outcome: 'reply_ended', text: '{"action":"post","text":"hello","audience":"public"}'})}); f.seed();
  assert.equal((await f.engine.consider()).action, 'wait'); assert.equal(f.posts.length, 0); assert.equal(f.messages.length, 0);
  assert.equal(f.store.actions(SCOPE, 20).find(a => a.kind === 'decision').state, 'failed');
});

test('pausing while the separate post generator runs prevents its late text from publication', async t => {
  const pending = deferred(); t.after(() => pending.resolve({outcome: 'reply_ended', text: 'late post'}));
  const f = fixture(t, {execute: async (_args, call) => call === 1 ? {outcome: 'reply_ended', text: '{"action":"post","text":""}'} : pending.promise}); f.seed();
  const initiative = f.engine.consider(); await turn(); assert.equal(f.calls.length, 2);
  f.engine.pause(); assert.equal(f.calls[1].signal.aborted, true);
  pending.resolve({outcome: 'reply_ended', text: 'late post'}); await initiative;
  assert.equal(f.posts.length, 0); assert.equal(f.store.actions(SCOPE, 20).filter(a => a.kind === 'post').length, 0);
});

test('a short owner burst becomes one reply with all inputs and the newest reply context', async t => {
  let time=0;const f=fixture(t),engine=f.create(f.store,{timerNow:()=>time,flow:{debounceMs:40,maxBatchMs:100,bubbleDelayMs:0}});
  await engine.receive({id:'burst-a',text:'今天面试结束了。',contextToken:'a'});
  const next=await engine.receive({id:'burst-b',text:'最后一道题我没答好。',contextToken:'b'});
  await engine.receive({id:'burst-c',text:'先别给建议，听我说说。',contextToken:'c'});
  assert.equal(next.merged,true);time=100;engine.bufferWait?.abort();await engine.whenIdle();
  assert.equal(f.calls.length,1);assert.equal(f.replies.length,1);assert.equal(f.replies[0].contextToken,'c');
  for(const text of ['今天面试结束了。','最后一道题我没答好。','先别给建议，听我说说。'])assert(f.calls[0].prompt.includes(text));
  assert.equal(engine.snapshot().tasks[0].messageCount,3);
});

test('continuing input cannot extend a buffered batch beyond its maximum deadline', async t => {
  let time=0;const f=fixture(t),engine=f.create(f.store,{timerNow:()=>time,flow:{debounceMs:40,maxBatchMs:100,bubbleDelayMs:0}});
  await engine.receive({id:'bounded-a',text:'第一句。',contextToken:'a'});
  time=35;await engine.receive({id:'bounded-b',text:'第二句。',contextToken:'b'});
  time=70;await engine.receive({id:'bounded-c',text:'第三句。',contextToken:'c'});
  assert.equal(engine.queue[0].readyAt,100);
  time=95;await engine.receive({id:'bounded-d',text:'第四句。',contextToken:'d'});time=105;engine.bufferWait?.abort();await engine.whenIdle();
  assert.equal(f.calls.length,1);assert.equal(f.replies.length,1);assert.match(f.calls[0].prompt,/第四句/);
});

test('production pacing merges a 1353 ms follow-up while retaining the four-second ceiling', async t => {
  let time=0;const f=fixture(t),engine=f.create(f.store,{timerNow:()=>time,flow:{bubbleDelayMs:0}});
  assert.equal(DEFAULT_FLOW.debounceMs,1800);assert.equal(DEFAULT_FLOW.maxBatchMs,4000);
  const first=await engine.receive({id:'natural-gap-a',text:'晚安。',contextToken:'a'});
  time=1353;const next=await engine.receive({id:'natural-gap-b',text:'鲸鱼，再聊两句吧。',contextToken:'b'});
  assert.equal(next.taskId,first.taskId);assert.equal(next.merged,true);assert.equal(engine.queue[0].readyAt,3153);
  time=3000;await engine.receive({id:'natural-gap-c',text:'今天有件小事想告诉你。',contextToken:'c'});
  assert.equal(engine.queue[0].readyAt,4000);
  time=4000;engine.bufferWait?.abort();await engine.whenIdle();
  assert.equal(f.calls.length,1);assert.equal(engine.snapshot().tasks[0].messageCount,3);
  assert.match(f.calls[0].prompt,/鲸鱼，再聊两句吧/);assert.match(f.calls[0].prompt,/今天有件小事/);
});

test('the ninth buffered input cancels the old batch instead of replying to a stale queue', async t => {
  let time=0;const f=fixture(t),engine=f.create(f.store,{timerNow:()=>time,flow:{debounceMs:40,maxBatchMs:100,bubbleDelayMs:0}});
  const old=await engine.receive({id:'overflow-0',text:'先聊旧主题。',contextToken:'old'});
  for(let n=1;n<8;n++)assert.equal((await engine.receive({id:`overflow-${n}`,text:`旧补充第${n}句。`,contextToken:'old'})).taskId,old.taskId);
  const latest=await engine.receive({id:'overflow-8',text:'换个话题，只问我今天最开心的事。',contextToken:'new'});
  assert.notEqual(latest.taskId,old.taskId);assert.equal(engine.queue.length,1);
  const cancelled=engine.snapshot().tasks.find(task=>task.id===old.taskId);
  assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.outcome,'cancelled');assert.equal(cancelled.messageCount,8);
  assert.equal(f.store.history(SCOPE).filter(message=>message.role==='user').length,9);
  time=100;engine.bufferWait?.abort();await engine.whenIdle();
  assert.equal(f.calls.length,1);assert.equal(f.replies.length,1);assert.equal(f.replies[0].contextToken,'new');
  assert.equal(incomingBody(f.calls[0].prompt),'换个话题，只问我今天最开心的事。');
  assert.match(f.calls[0].prompt,/先聊旧主题/);assert.match(f.calls[0].prompt,/旧补充第7句/);
});

test('the character boundary merges exactly 2800 characters and replaces an overflowing batch without erasing inputs', async t => {
  let time=0;const f=fixture(t),engine=f.create(f.store,{timerNow:()=>time,flow:{debounceMs:40,bubbleDelayMs:0}});
  const a='旧主题A'+ '甲'.repeat(1996),b='旧主题B'+'乙'.repeat(794);
  assert.equal(a.length,2000);assert.equal(b.length,798);
  const old=await engine.receive({id:'chars-a',text:a,contextToken:'old'});
  assert.equal((await engine.receive({id:'chars-b',text:b,contextToken:'old'})).taskId,old.taskId);
  assert.equal(engine.queue[0].prompt.length,2800);
  const latest=await engine.receive({id:'chars-c',text:'现在只聊新主题。',contextToken:'new'});
  assert.notEqual(latest.taskId,old.taskId);assert.equal(engine.snapshot().tasks[0].state,'cancelled');
  assert.deepEqual(f.store.history(SCOPE).map(message=>message.text),[a,b,'现在只聊新主题。']);
  time=100;engine.bufferWait?.abort();await engine.whenIdle();
  assert.equal(f.calls.length,1);assert.equal(f.replies.length,1);assert.equal(incomingBody(f.calls[0].prompt),'现在只聊新主题。');
});

test('overflow while the old runner is settling cannot send the cancelled pending topic later', async t => {
  const pending=deferred();t.after(()=>pending.resolve({outcome:'reply_ended',text:'旧回答不应发出。'}));
  const f=fixture(t,{execute:async(_args,n)=>n===1?pending.promise:{outcome:'reply_ended',text:'只回应最新话题。'}});
  await f.engine.receive({id:'settling-current',text:'先说说电影。',contextToken:'current'});await turn();
  const queued=await f.engine.receive({id:'settling-old-queue',text:'甲'.repeat(2000),contextToken:'queued'});
  const latest=await f.engine.receive({id:'settling-new-queue',text:'新话题。'+'乙'.repeat(800),contextToken:'new'});
  assert.equal(f.calls[0].signal.aborted,true);assert.notEqual(latest.taskId,queued.taskId);
  assert.equal(f.engine.snapshot().tasks.find(task=>task.id===queued.taskId).state,'cancelled');
  pending.resolve({outcome:'reply_ended',text:'旧回答不应发出。'});await f.engine.whenIdle();
  assert.equal(f.calls.length,2);assert.deepEqual(f.replies,[{text:'只回应最新话题。',contextToken:'new'}]);
  assert.equal(f.engine.snapshot().tasks.filter(task=>task.state==='cancelled').length,2);
  assert.equal(f.store.history(SCOPE).filter(message=>message.role==='user').length,3);
});

test('read-only status and memory queries preserve a running reply', async t => {
  const pending=deferred();t.after(()=>pending.resolve({outcome:'reply_ended',text:'继续刚才的回答。'}));
  const f=fixture(t,{execute:async()=>pending.promise});
  const original=await f.engine.receive({id:'before-query',text:'聊聊刚才那本书。',contextToken:'ordinary'});await turn();
  for(const [id,text]of [['status','状态'],['memory','查看记忆'],['followups','查看回访']])await f.engine.receive({id:`query-${id}`,text,contextToken:'query'});
  assert.equal(f.calls[0].signal.aborted,false);assert.equal(f.engine.snapshot().tasks[0].id,original.taskId);assert.equal(f.engine.snapshot().tasks[0].state,'running');
  pending.resolve({outcome:'reply_ended',text:'继续刚才的回答。'});await f.engine.whenIdle();
  assert.equal(f.calls.length,1);assert.equal(f.replies.at(-1).text,'继续刚才的回答。');assert.equal(f.engine.snapshot().tasks[0].state,'reply_ended');
});

test('read-only queries preserve buffered input but explicit stop cancels it', async t => {
  let time=0;const f=fixture(t),engine=f.create(f.store,{timerNow:()=>time,flow:{debounceMs:40,bubbleDelayMs:0}});
  const buffered=await engine.receive({id:'buffered-before-query',text:'先聊小说吧。',contextToken:'ordinary'});
  await engine.receive({id:'buffered-query',text:'查看记忆',contextToken:'query'});
  assert.equal(engine.queue.length,1);assert.equal(engine.queue[0].id,buffered.taskId);assert.equal(engine.queue[0].state,'queued');
  await engine.receive({id:'buffered-stop',text:'停止',contextToken:'stop'});
  await engine.whenIdle();assert.equal(f.calls.length,0);assert.equal(engine.queue.length,0);assert.equal(engine.snapshot().tasks[0].state,'cancelled');
  assert.equal(f.store.history(SCOPE).filter(message=>message.role==='user').length,3);
});

test('ordinary replies receive current follow-up states instead of treating old creation chat as live appointments', async t => {
  const f=fixture(t);f.seed('旧创建消息：约好问我蓝色便签整理了吗。');
  const old=f.store.scheduleFollowup(SCOPE,{text:'问我蓝色便签整理了吗。',dueAt:f.now()+MINUTE,timeZone:'Australia/Sydney'});
  f.store.updateFollowup(SCOPE,old.id,{text:'问我绿色便签整理了吗。',dueAt:f.now()+2*MINUTE});f.store.cancelFollowup(SCOPE,old.id);
  f.store.scheduleFollowup(SCOPE,{text:'明天聊书。',dueAt:f.now()+86400000,timeZone:'UTC'});
  const sent=f.store.scheduleFollowup(SCOPE,{text:'薄荷浇水了吗。',dueAt:f.now(),timeZone:'UTC'});
  f.store.claimFollowup(SCOPE,sent.id);f.store.finishFollowup(SCOPE,sent.id,{state:'sent',receipt:'private-send-receipt'});
  await f.engine.receive({id:'current-reminder-question',text:'现在还有哪些约定？你能主动找我聊天吗？',contextToken:'question'});await f.engine.whenIdle();
  const data=JSON.parse(f.engine.context('in:current-reminder-question'));
  assert(data.conversation.some(x=>x.text.includes('旧创建消息')));
  const cancelled=data.followups.find(x=>x.state==='cancelled'),pending=data.followups.find(x=>x.state==='pending'),delivered=data.followups.find(x=>x.state==='sent');
  assert.equal(cancelled.text,'问我绿色便签整理了吗。');assert.equal(cancelled.dueAt,f.now()+2*MINUTE);assert.equal(cancelled.timeZone,'Australia/Sydney');
  assert.equal(pending.text,'明天聊书。');assert.equal(delivered.text,'薄荷浇水了吗。');
  assert.match(f.calls[0].prompt,/回访state\/dueAt优于旧聊天：cancelled\/missed\/failed非待办，sent已发，pending不保证送达/);
  assert.match(f.calls[0].prompt,/预约回访及主动联系/);assert.match(f.calls[0].prompt,/等待正常/);assert.match(f.calls[0].prompt,/不要否认能力、保证未来联系或编造完成/);
  assert.doesNotMatch(f.calls[0].prompt,/private-send-receipt/);assert.equal(f.messages.length,0);assert.equal(f.posts.length,0);
});

test('follow-up context is recent, bounded and excludes authority identifiers or send receipts', t => {
  const f=fixture(t);f.store.setNotes(SCOPE,'记'.repeat(1000));f.store.upsertFact(SCOPE,{text:'事实'.repeat(200)});
  for(let n=0;n<24;n++){f.clock.time++;f.store.scheduleFollowup(SCOPE,{text:`PRIVATE_APPOINTMENT_${n}_`+'长'.repeat(570),dueAt:f.now()+86400000,timeZone:'UTC'});}
  for(const budget of [200,800,1500,3000]){
    const raw=f.engine.context(undefined,budget),data=JSON.parse(raw);assert(raw.length<=budget);assert(data.followups.length<=6);
    for(const row of data.followups){assert(row.text.length<=96);assert.deepEqual(Object.keys(row),['text','state','dueAt','timeZone']);}
  }
  const recent=JSON.parse(f.engine.context()).followups;assert.match(recent[0].text,/PRIVATE_APPOINTMENT_23_/);assert(recent.every(row=>!row.text.includes('PRIVATE_APPOINTMENT_0_')));
});

test('new input cancels the unsent bubbles but preserves the receipt of the already sent bubble', async t => {
  const firstSent=deferred(),f=fixture(t,{execute:async(_args,n)=>({outcome:'reply_ended',text:n===1?'已经发出的第一段。\n\n不应该再发的第二段。\n\n不应该再发的第三段。':'我听到了新的补充。'})});
  const engine=f.create(f.store,{flow:{debounceMs:0,bubbleDelayMs:100},send:async(text,contextToken)=>{f.replies.push({text,contextToken});firstSent.resolve();return {id:'receipt-'+f.replies.length};}});
  await engine.receive({id:'old',text:'说三段话。',contextToken:'old-context'});await firstSent.promise;
  await engine.receive({id:'new',text:'等等，改个话题。',contextToken:'new-context'});await engine.whenIdle();
  assert.deepEqual(f.replies.map(r=>r.text),['已经发出的第一段。','我听到了新的补充。']);
  assert.equal(engine.snapshot().tasks[0].state,'cancelled');
  assert.equal(f.store.actions(SCOPE,20).filter(a=>a.state==='sent').length,2);
  assert.equal(f.store.history(SCOPE).filter(m=>m.role==='assistant').length,2);
});

test('an unknown bubble send stops the remaining bubbles and duplicate input never replays them', async t => {
  const f=fixture(t,{execute:async()=>({outcome:'reply_ended',text:'一段。\n\n第二段不应发送。'})});
  const engine=f.create(f.store,{send:async text=>{f.replies.push({text});throw Error('uncertain network result');}});
  await engine.receive({id:'ambiguous',text:'你好。',contextToken:'context'});await engine.whenIdle();
  assert.deepEqual(f.replies.map(r=>r.text),['一段。']);assert.equal(f.store.actions(SCOPE,20).find(a=>a.kind==='reply').state,'unknown');
  assert.deepEqual(await engine.receive({id:'ambiguous',text:'你好。',contextToken:'context'}),{accepted:false,duplicate:true});
  assert.equal(engine.snapshot().deliveryFailed,true);
});

test('local voice conversation shares scoped context but never sends its reply or cancelled output to QQ', async t => {
  const pending=deferred(),f=fixture(t,{execute:async(_args,n)=>n===1?pending.promise:{outcome:'reply_ended',text:'第二次本地回答。'}}),chunks=[];
  const first=f.engine.respondLocally('只在桌面回答我。',{onChunk:chunk=>chunks.push(chunk)});await turn();
  const second=f.engine.respondLocally('前一个问题取消，换这个。',{onChunk:chunk=>chunks.push(chunk)});
  pending.resolve({outcome:'reply_ended',text:'应被取消的本地声音。'});
  assert.equal((await first).outcome,'cancelled');assert.equal((await second).outcome,'reply_ended');
  assert.deepEqual(chunks,['第二次本地回答。']);assert.equal(f.replies.length,0);assert.equal(f.messages.length,0);
  assert.equal(f.store.history(SCOPE).at(-1).text,'第二次本地回答。');
});

test('a newer local reply cancels buffered QQ work and settles superseded local requests', async t => {
  const pending=deferred(),f=fixture(t,{execute:async(_args,n)=>n===1?pending.promise:{outcome:'reply_ended',text:'只在桌面回应最新一句。'}});
  t.after(()=>pending.resolve({outcome:'reply_ended',text:'旧回复'}));
  await f.engine.receive({id:'old-running',text:'旧问题',contextToken:'old'});await turn();
  const buffered=await f.engine.receive({id:'old-buffered',text:'旧的QQ补充',contextToken:'old-buffer'});
  const local=f.engine.respondLocally('现在只在桌面聊');await turn();
  pending.resolve({outcome:'reply_ended',text:'旧回复'});
  assert.equal((await local).outcome,'reply_ended');await f.engine.whenIdle();
  assert.equal(f.calls.length,2);assert.equal(f.replies.length,0);
  assert.equal(f.engine.snapshot().tasks.find(task=>task.id===buffered.taskId).state,'cancelled');
  assert(f.store.history(SCOPE).some(row=>row.text==='旧的QQ补充'),'actual input history remains');
});

test('failed or preempted public drafting cannot detach the next private reply from cancellation', async t => {
  const draftModel=deferred(),replyModel=deferred();
  t.after(()=>{draftModel.resolve({outcome:'reply_ended',text:'旧公开草稿'});replyModel.resolve({outcome:'reply_ended',text:'旧私聊回复'});});
  const f=fixture(t,{execute:async(_args,n)=>n===1?draftModel.promise:replyModel.promise});
  const draft=f.engine.publicDraft();const draftFailure=assert.rejects(draft);await turn();
  const incoming=await f.engine.receive({id:'after-draft',text:'先听我说',contextToken:'new'});
  draftModel.resolve({outcome:'reply_ended',text:'旧公开草稿'});await draftFailure;await turn();
  assert.equal(f.calls.length,2);assert.equal(f.engine.snapshot().currentTaskId,incoming.taskId);
  f.engine.cancel();assert.equal(f.calls[1].signal.aborted,true);
  replyModel.resolve({outcome:'reply_ended',text:'旧私聊回复'});await f.engine.whenIdle();
  assert.equal(f.replies.length,0);assert.equal(f.engine.snapshot().tasks.at(-1).state,'cancelled');
});

test('explicit voice replies skip chat batching and bubble pauses without changing QQ or ordinary local pacing', async t => {
  const f=fixture(t,{execute:async()=>({outcome:'reply_ended',text:'一段。\n\n二段。\n\n三段。'})}),chunks=[];
  const engine=f.create(f.store,{timerNow:()=>0,flow:{debounceMs:10000,maxBatchMs:10000,bubbleDelayMs:10000}});
  const voice=engine.respondLocally('用声音回答。',{voice:true,onChunk:chunk=>chunks.push(chunk)});await turn();
  assert.equal(f.calls.length,1);assert.deepEqual(chunks,['一段。','二段。','三段。']);assert.equal((await voice).outcome,'reply_ended');assert.equal(f.replies.length,0);
  await engine.receive({id:'normal-qq',text:'QQ照常等待',contextToken:'qq'});await turn();
  assert.equal(f.calls.length,1);assert.equal(engine.snapshot().tasks.at(-1).state,'queued');
  const local=engine.respondLocally('普通本地入口照常等待');await turn();
  assert.equal(f.calls.length,1);assert.equal(engine.snapshot().tasks.at(-1).state,'queued');
  await engine.stop();assert.equal((await local).outcome,'cancelled');
});

test('disconnect during input admission cannot leave an undispatched task or unresolved local result', async t => {
  const f=fixture(t),localEngine=f.create(),qqEngine=f.create();
  const local=localEngine.respondLocally('即将断开');await localEngine.stop();await turn();
  assert.equal(localEngine.snapshot().queue.length,0);assert.equal((await local).outcome,'cancelled');
  const input=qqEngine.receive({id:'admission-stop',text:'即将断开的QQ',contextToken:'qq'});await qqEngine.stop();
  assert.deepEqual(await input,{accepted:false,reason:'stopped'});assert.equal(qqEngine.snapshot().queue.length,0);assert.equal(f.calls.length,0);
});

test('stopping a buffered local conversation settles its promise without launching a model', async t => {
  const f=fixture(t),engine=f.create(f.store,{flow:{debounceMs:100}});
  const result=engine.respondLocally('还没有开始。');await turn();await engine.stop();
  assert.equal((await result).outcome,'cancelled');assert.equal(f.calls.length,0);
});

test('explicit memory commands save, correct and forget with no model-made biography or hidden old value', async t => {
  const f=fixture(t);
  await f.engine.receive({id:'remember',text:'记住：我喜欢旧值 MARKER_OLD。',contextToken:'ctx'});
  const fact=f.store.facts(SCOPE)[0];assert.equal(fact.sourceIds[0],'in:remember');assert.equal(f.calls.length,0);
  await f.engine.receive({id:'correct',text:`更正 ${fact.id.slice(0,8)}：我现在喜欢 MARKER_NEW。`,contextToken:'ctx'});
  assert.match(f.engine.context(),/MARKER_NEW/);assert.doesNotMatch(f.engine.context(),/MARKER_OLD/);
  await f.engine.receive({id:'forget',text:`忘记 ${fact.id.slice(0,8)}`,contextToken:'ctx'});
  assert.equal(f.store.facts(SCOPE).length,0);assert.doesNotMatch(f.engine.context(),/MARKER_NEW|MARKER_OLD/);
});

test('forgetting waits for an in-flight send before erasing derived history and renderer task text', async t => {
  const sending=deferred(),accepted=deferred(),f=fixture(t,{execute:async()=>({outcome:'reply_ended',text:'我记得你的 SECRET_TO_FORGET。'})});
  f.seed('SECRET_TO_FORGET',f.clock.time,'fact-source');const fact=f.store.upsertFact(SCOPE,{text:'SECRET_TO_FORGET',sourceIds:['fact-source']});
  const original=f.engine.send;f.engine.send=async(text,context)=>{if(text.includes('SECRET_TO_FORGET')){sending.resolve();await accepted.promise;}return original(text,context);};
  await f.engine.receive({id:'question',text:'你还记得吗？',contextToken:'question'});await sending.promise;
  const forgetting=f.engine.receive({id:'forget-in-flight',text:`忘记 ${fact.id.slice(0,8)}`,contextToken:'forget'});
  await turn();assert.equal(f.store.facts(SCOPE).length,1,'erase waits until the old delivery can no longer append');
  accepted.resolve();await forgetting;await f.engine.whenIdle();
  assert.equal(f.store.facts(SCOPE).length,0);assert.doesNotMatch(f.engine.context(),/SECRET_TO_FORGET/);
  assert.doesNotMatch(JSON.stringify(f.engine.snapshot()),/SECRET_TO_FORGET/);
  assert(f.store.actions(SCOPE).some(action=>action.receipt&&action.text===''),'accepted delivery barrier is retained without the private content');
});

test('an explicitly scheduled due follow-up bypasses ordinary quiet delay but sends only once', async t => {
  const f=fixture(t,{execute:async()=>({outcome:'reply_ended',text:'约好了现在聊聊，面试感觉怎么样？'})});f.seed('刚约好了现在回访。',f.clock.time);
  const item=f.store.scheduleFollowup(SCOPE,{text:'问问面试情况。',dueAt:f.clock.time,timeZone:'Australia/Sydney'});
  assert.deepEqual(await f.engine.consider(),{action:'followup',accepted:true,id:item.id});
  assert.equal(f.messages.length,1);assert.equal(f.store.followups(SCOPE)[0].state,'sent');
  await f.engine.consider();assert.equal(f.messages.length,1);
});

test('rescheduling while a follow-up model runs prevents its obsolete message from sending', async t => {
  const pending=deferred(),f=fixture(t,{execute:async()=>pending.promise});f.seed();
  const item=f.store.scheduleFollowup(SCOPE,{text:'原来的约定。',dueAt:f.clock.time,timeZone:'Australia/Sydney'});
  const running=f.engine.consider();await turn();
  f.store.updateFollowup(SCOPE,item.id,{text:'改成明天聊。',dueAt:f.clock.time+86400000});
  pending.resolve({outcome:'reply_ended',text:'过时的回访。'});assert.equal((await running).reason,'changed_followup');
  assert.equal(f.messages.length,0);assert.equal(f.store.followups(SCOPE)[0].state,'pending');
});

test('missed paused appointments become visible missed entries instead of catch-up messages', async t => {
  const f=fixture(t);f.seed();const item=f.store.scheduleFollowup(SCOPE,{text:'已错过的约定。',dueAt:f.clock.time,timeZone:'Australia/Sydney'});
  f.engine.pause();f.clock.time+=6*MINUTE;
  assert.equal((await f.engine.consider()).reason,'missed_followup');assert.equal(f.store.followups(SCOPE)[0].state,'missed');
  f.store.configure({proactiveMessages:true});await f.engine.consider();assert.equal(f.store.followups(SCOPE).find(x=>x.id===item.id).state,'missed');
  assert.equal(f.messages.filter(m=>m.text.includes('已错过')).length,0);
});

test('public drafts use public continuity only and require a separate once-only publication', async t => {
  const f=fixture(t,{execute:async()=>({outcome:'reply_ended',text:'把上一枚月亮书签，换成一片想象里的海。'})});
  f.store.setNotes(SCOPE,'PRIVATE_NOTE');f.seed('PRIVATE_CHAT');f.store.upsertFact(SCOPE,{text:'PRIVATE_FACT'});
  const reminder=f.store.scheduleFollowup(SCOPE,{text:'PRIVATE_CANCELLED_APPOINTMENT',dueAt:f.now()+MINUTE,timeZone:'UTC'});f.store.cancelFollowup(SCOPE,reminder.id);
  f.store.appendJournal(SCOPE,{id:'old-public',text:'PUBLIC_BOOKMARK',receipt:'old-accepted'});
  const draft=await f.engine.publicDraft();assert.equal(f.posts.length,0);assert.equal(draft.state,'draft');
  assert.match(f.calls[0].prompt,/PUBLIC_BOOKMARK/);assert.doesNotMatch(f.calls[0].prompt,/PRIVATE_NOTE|PRIVATE_CHAT|PRIVATE_FACT|PRIVATE_CANCELLED_APPOINTMENT/);
  const result=await f.engine.publishDraft(draft.id);assert.equal(result.accepted,true);assert.equal(result.contentVerified,true);assert.equal(result.visibilityVerified,false);
  assert.equal(f.posts.length,1);assert.equal(f.store.journal(SCOPE).length,2);
  await assert.rejects(f.engine.publishDraft(draft.id));assert.equal(f.posts.length,1);
});

test('disconnect settles a cancelled public draft without preventing later memory edits', async t => {
  const pending=deferred(),f=fixture(t,{execute:async()=>pending.promise});
  const draft=f.engine.publicDraft();await turn();const idle=f.engine.stop();
  pending.resolve({outcome:'reply_ended',text:'不可保存的过时草稿。'});
  await assert.rejects(draft);await idle;assert.equal(f.store.publicEntries(SCOPE).length,0);
});

test('an ambiguous explicit space publication persists unknown and cannot retry even after reopening', async t => {
  const f=fixture(t),draft=f.store.addPublicEntry(SCOPE,{text:'不要重复发布。'});
  f.engine.publishPost=async()=>{f.posts.push({text:'attempt'});throw Error('ambiguous');};
  assert.equal((await f.engine.publishDraft(draft.id)).unknown,true);await f.engine.stop();
  const restored=f.create(new SocialStore({root:f.root,now:f.now}));await assert.rejects(restored.publishDraft(draft.id));
  assert.equal(f.posts.length,1);assert.equal(f.store.publicEntries(SCOPE)[0].state,'unknown');
});

test('maximum persona and consecutive inputs keep model context within the runner prompt limit', async t => {
  let time=0;const f=fixture(t,{config:{description:'甲'.repeat(800),name:'乙'.repeat(40),speechExamples:[{user:'问'.repeat(240),assistant:'答'.repeat(240)}]}}),engine=f.create(f.store,{timerNow:()=>time,flow:{debounceMs:10,maxBatchMs:20,bubbleDelayMs:0}});
  f.store.setNotes(SCOPE,'记'.repeat(1000));for(let i=0;i<10;i++)f.store.upsertFact(SCOPE,{text:'事'.repeat(600)});
  for(let i=0;i<12;i++)f.store.scheduleFollowup(SCOPE,{text:'私密回访'.repeat(120),dueAt:f.now()+86400000,timeZone:'Australia/Sydney'});
  await engine.receive({id:'max-a',text:'大'.repeat(2000),contextToken:'a'});await engine.receive({id:'max-b',text:'小'.repeat(790),contextToken:'b'});time=20;engine.bufferWait?.abort();await engine.whenIdle();
  assert.equal(f.calls.length,1);assert(f.calls[0].prompt.length<=6000);assert.equal(f.replies.length,1);
});
