'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
const { Dispatcher } = require('../src/bot/dispatcher.cjs');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(check) { for(let i=0;i<100;i++){if(check())return;await flush();}assert.fail('Dispatcher did not settle'); }
function setup(execute, options = {}) {
  const sent = [], changes = []; let id = 0;
  const dispatcher = new Dispatcher({ execute, send: async(text, contextToken) => { sent.push({text,contextToken}); }, onChange: s => changes.push(s), ...options });
  return { dispatcher, sent, changes, receive: (text, messageId) => dispatcher.receive({id:messageId ?? String(++id),text,contextToken:'CONTEXT_TOKEN_SECRET'}) };
}
const permission = { kind:'permission',tool:'Bash',input:{command:'node -e "console.log(123)"'} };
const reply = (sessionId='session-1',text='Synthetic reply') => ({sessionId,text,outcome:'reply_ended'});

test('messages are deduplicated and tasks run serially with explicit conversation resume',async()=>{
 const gates=[deferred(),deferred()],calls=[];let active=0,peak=0;
 const h=setup(async request=>{const index=calls.length;calls.push(request);peak=Math.max(peak,++active);const result=await gates[index].promise;active--;return result;});
 const first=await h.receive('First task','same');const duplicate=await h.receive('First task','same');
 assert(first.accepted);assert(duplicate.duplicate);await h.receive('Second task','next');
 assert.equal(calls.length,1);assert.equal(calls[0].resume,undefined);
 calls[0].onUpdate('A local progress update');await flush();assert(!h.sent.some(m=>m.text.includes('local progress')));
 gates[0].resolve(reply('saved-session','First response'));
 await until(()=>calls.length===2);assert.equal(calls[1].prompt,'Second task');assert.equal(calls[1].resume,'saved-session');assert.equal(peak,1);
 gates[1].resolve(reply('saved-session','Second response'));await until(()=>!h.dispatcher.current);
 await h.dispatcher.sendChain;
 assert(h.sent.some(m=>m.text.includes('回复结束（任务结果未验证）')));
 assert.equal(h.dispatcher.snapshot().tasks.length,2);
 await h.receive('/new');assert.equal(h.dispatcher.snapshot().hasSession,false);h.dispatcher.stop();
});

test('parallel incoming prompts retain order and the waiting queue is bounded to three',async()=>{
 const gate=deferred(),calls=[];const h=setup(async p=>{calls.push(p);return gate.promise;});
 await Promise.all(['A','B','C','D'].map((text,i)=>h.receive(text,`parallel-${i}`)));
 assert.deepEqual(calls.map(c=>c.prompt),['A']);assert.equal(h.dispatcher.snapshot().queue.length,3);
 assert.equal((await h.receive('E')).reason,'queue_full');assert.equal((await h.receive('/new')).reason,'busy');
 await h.receive('/cancel');assert(calls[0].signal.aborted);assert.equal(h.dispatcher.snapshot().queue.length,0);
 gate.resolve(reply());await until(()=>!h.dispatcher.current);assert.equal(calls.length,1);
 assert(h.dispatcher.snapshot().tasks.every(t=>t.outcome==='cancelled'));h.dispatcher.stop();
});

test('permission requires an explicit one-use code and ordinary text cannot enqueue work',async()=>{
 const answers=[];const h=setup(async({request})=>{answers.push(await request(permission));answers.push(await request(permission));return reply();});
 await h.receive('Do a harmless synthetic task');await until(()=>h.dispatcher.snapshot().pending.length===1);
 const first=h.dispatcher.snapshot().pending[0].code;assert.match(first,/^[a-f0-9]{32}$/);
 const beforeStatus=h.sent.length;await h.receive('/status');
 const status=h.sent.slice(beforeStatus);assert(status.some(m=>m.text.startsWith('当前：')&&!m.text.includes(first)));
 assert(status.some(m=>m.text.includes(first)&&m.text.includes('可读取、修改文件或影响本机')));
 assert.equal((await h.receive('Please do something else')).reason,'confirmation_pending');assert.equal(h.dispatcher.snapshot().queue.length,0);
 await h.receive(`/allow ${first}`);await until(()=>h.dispatcher.snapshot().pending[0]?.code!==first);
 const second=h.dispatcher.snapshot().pending[0].code;assert.notEqual(second,first);
 assert.equal((await h.receive(`/allow ${first}`)).reason,'stale_code');assert.equal(h.dispatcher.snapshot().pending.length,1);
 await h.receive(`/deny ${second}`);await until(()=>!h.dispatcher.current);
 assert.deepEqual(answers,[{allow:true},{allow:false}]);
 assert(h.sent.some(m=>m.text.includes('可读取、修改文件或影响本机')&&m.text.includes(permission.input.command.replaceAll('"','\\"'))));h.dispatcher.stop();
});

test('expired codes deny the request and never authorize a later task',async()=>{
 let now=1000,decision;const h=setup(async({request})=>{decision=await request(permission);return reply();},{now:()=>now});
 await h.receive('Expire permission');await until(()=>h.dispatcher.snapshot().pending.length===1);
 const code=h.dispatcher.snapshot().pending[0].code;now+=300001;
 assert.equal((await h.receive(`/allow ${code}`)).reason,'stale_code');await until(()=>!h.dispatcher.current);
 assert.deepEqual(decision,{allow:false});assert.equal(h.dispatcher.snapshot().pending.length,0);h.dispatcher.stop();
});

test('cancel invalidates approval and never starts another execute before the old one stops',async()=>{
 const finish=deferred(),calls=[],decisions=[];
 const h=setup(async p=>{calls.push(p);if(calls.length===1){decisions.push(await p.request(permission));await finish.promise;}return reply('resumable');});
 await h.receive('First');await until(()=>h.dispatcher.snapshot().pending.length===1);
 const code=h.dispatcher.snapshot().pending[0].code;await h.receive('/cancel');
 assert(calls[0].signal.aborted);assert.equal(h.dispatcher.snapshot().pending.length,0);
 assert.equal((await h.receive(`/allow ${code}`)).reason,'stale_code');await h.receive('After cancellation');assert.equal(calls.length,1);
 finish.resolve();await until(()=>calls.length===2&&!h.dispatcher.current);
 assert.deepEqual(decisions,[{allow:false}]);assert.equal(h.dispatcher.snapshot().tasks[0].outcome,'cancelled');
 assert.equal(calls[1].resume,'resumable');h.dispatcher.stop();
});

test('stop denies pending requests and codes cannot cross dispatcher restarts',async()=>{
 let firstDecision;const first=setup(async({request})=>{firstDecision=await request(permission);return reply();});
 await first.receive('Before restart');await until(()=>first.dispatcher.snapshot().pending.length===1);
 const stale=first.dispatcher.snapshot().pending[0].code;first.dispatcher.stop();
 await until(()=>!first.dispatcher.current);assert.deepEqual(firstDecision,{allow:false});
 assert.equal((await first.receive(`/allow ${stale}`)).reason,'stopped');
 let nextDecision;const next=setup(async({request})=>{nextDecision=await request(permission);return reply();});
 await next.receive('After restart');await until(()=>next.dispatcher.snapshot().pending.length===1);
 assert.equal((await next.receive(`/allow ${stale}`)).reason,'stale_code');
 await next.receive(`/deny ${next.dispatcher.snapshot().pending[0].code}`);await until(()=>!next.dispatcher.current);
 assert.deepEqual(nextDecision,{allow:false});next.dispatcher.stop();
});

test('stop and whenIdle wait for the old execute to actually settle',async()=>{
 const gate=deferred();let signal;
 const h=setup(async request=>{signal=request.signal;await gate.promise;return reply();});
 await h.receive('Wait for real shutdown');h.dispatcher.stop();assert(signal.aborted);
 const idle=h.dispatcher.whenIdle();assert.equal(idle,h.dispatcher.whenIdle());
 let settled=false;idle.then(()=>{settled=true;});await flush();assert.equal(settled,false);
 gate.resolve();await idle;assert.equal(settled,true);assert.equal(h.dispatcher.snapshot().currentTaskId,null);
 assert.equal(h.dispatcher.snapshot().tasks[0].outcome,'cancelled');
});

test('a single question is answered explicitly or by plain reply, never by allow',async()=>{
 for(const plain of [false,true]){
  let answer;const question={kind:'question',tool:'AskUserQuestion',questions:[{question:'Synthetic choice?',options:[{label:'One'},{label:'Two'}]}]};
  const h=setup(async({request})=>{answer=await request(question);return reply();});
  await h.receive('Ask one question');await until(()=>h.dispatcher.snapshot().pending.length===1);
  const code=h.dispatcher.snapshot().pending[0].code;
  assert.equal((await h.receive(`/allow ${code}`)).reason,'wrong_confirmation');assert.equal(answer,undefined);
  await h.receive(plain?'One':`/answer ${code} One`);await until(()=>!h.dispatcher.current);
  assert.deepEqual(answer,{allow:true,answer:'One'});assert.equal(h.dispatcher.snapshot().tasks.length,1);h.dispatcher.stop();
 }
});

test('oversized or sensitive tool JSON is denied rather than truncated for authorization',async()=>{
 const decisions=[];const h=setup(async({request})=>{
  decisions.push(await request({...permission,input:{command:'x'.repeat(3100)}}));
  decisions.push(await request({...permission,input:{token:'PRIVATE_AUTH_SECRET'}}));
  decisions.push(await request({kind:'question',tool:'AskUserQuestion',questions:[{question:'one'},{question:'two'}]}));return reply();
 });
 await h.receive('Reject invalid requests');await until(()=>!h.dispatcher.current);await h.dispatcher.sendChain;
 assert.deepEqual(decisions,[{allow:false},{allow:false},{allow:false}]);
 assert(!h.sent.some(m=>m.text.includes('/allow ')));assert(!JSON.stringify(h.dispatcher.snapshot()).includes('PRIVATE_AUTH_SECRET'));h.dispatcher.stop();
});

test('tool cancellation removes its pending permission and abort listener',async()=>{
 const tool=new AbortController();let decision;const h=setup(async({request})=>{decision=await request({...permission,signal:tool.signal});return reply();});
 await h.receive('A tool can cancel independently');await until(()=>h.dispatcher.snapshot().pending.length===1);
 const code=h.dispatcher.snapshot().pending[0].code;assert.equal(getEventListeners(tool.signal,'abort').length,1);
 tool.abort();await until(()=>!h.dispatcher.current);
 assert.deepEqual(decision,{allow:false});assert.equal(getEventListeners(tool.signal,'abort').length,0);
 assert.equal((await h.receive(`/allow ${code}`)).reason,'stale_code');h.dispatcher.stop();
});

test('a permission message queued behind a slow send is suppressed after tool cancellation',async()=>{
 const sendGate=deferred(),tool=new AbortController(),sent=[];let decision;
 const h=setup(async({request})=>{decision=await request({...permission,signal:tool.signal});return reply();},{send:async text=>{sent.push(text);if(sent.length===1)await sendGate.promise;}});
 const received=h.receive('Slow acknowledgement');await until(()=>h.dispatcher.snapshot().pending.length===1);
 tool.abort();await until(()=>!h.dispatcher.current);sendGate.resolve();await received;await h.dispatcher.sendChain;
 assert.deepEqual(decision,{allow:false});assert(!sent.some(text=>text.includes('/allow ')));h.dispatcher.stop();
});

test('delivery failure remains separate from execution outcome and status can resend the result',async()=>{
 let sends=0;const h=setup(async()=>reply('session-1','A final response'),{send:async()=>{if(++sends<=2)throw Error('SEND_INTERNAL_SECRET');},onChange:()=>Promise.reject(Error('OBSERVER_SECRET'))});
 await h.receive('Deliver safely');await until(()=>!h.dispatcher.current);await h.dispatcher.sendChain;
 assert.equal(h.dispatcher.snapshot().tasks[0].outcome,'reply_ended');assert.equal(h.dispatcher.snapshot().deliveryFailed,true);
 assert(!JSON.stringify(h.dispatcher.snapshot()).includes('INTERNAL_SECRET'));
 await h.receive('/status');await h.dispatcher.sendChain;assert.equal(h.dispatcher.snapshot().deliveryFailed,false);h.dispatcher.stop();
});

test('snapshots and messages are bounded and never expose transport tokens or internal errors',async()=>{
 const h=setup(async()=>{throw Error('MODEL_INTERNAL_SECRET');});
 await h.receive('A safe user task');await until(()=>!h.dispatcher.current);await h.dispatcher.sendChain;
 for(let i=0;i<40;i++)await h.receive('/status');
 const snapshot=h.dispatcher.snapshot();assert.equal(snapshot.messages.length,60);
 assert(snapshot.messages.every(m=>m.text.length<=6000&&['user','assistant'].includes(m.role)));
 assert(!JSON.stringify(snapshot).includes('MODEL_INTERNAL_SECRET'));assert(!JSON.stringify(snapshot).includes('CONTEXT_TOKEN_SECRET'));
 h.dispatcher.stop();
 const long=setup(async()=>reply('session','x'.repeat(20000)));await long.receive('Bound result');await until(()=>!long.dispatcher.current);await long.dispatcher.sendChain;
 assert(long.sent.every(m=>m.text.length<=6000));long.dispatcher.stop();
});
