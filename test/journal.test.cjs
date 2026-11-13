'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { MessageJournal } = require('../src/bot/journal.cjs');
const {DatabaseSync}=require('node:sqlite');
const delivery=(overrides={})=>({version:1,planned:4,attempted:0,accepted:0,unknown:0,inFlight:0,unattemptedAtCancel:null,inFlightAtCancel:null,...overrides});
function database(root,fn){const db=new DatabaseSync(path.join(root,'bot-recovery.sqlite'));try{return fn(db);}finally{db.close();}}
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-journal-test-'));
  t.after(() => { assert(root.startsWith(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
test('SQLite commit survives a new journal and deduplicates by owner across API/native mode', t => {
  const root = setup(t), first = new MessageJournal({ root });
  assert.equal(first.available, true);
  assert.equal(first.claim('owner-one', '12345678901234567890', 'api'), true);
  first.disposition('owner-one', '12345678901234567890', 'reply_ended', 'task-one');
  const next = new MessageJournal({ root });
  assert.equal(next.claim('owner-one', '12345678901234567890', 'native'), false);
  assert.equal(next.claim('owner-two', '12345678901234567890', 'native'), true);
  assert.equal(next.snapshot().interrupted, 0);
  assert(next.snapshot().recent.some(row => row.state === 'reply_ended'));
});
test('restart preserves uncertain work and expires pending counts without replayable authorization', t => {
  const root = setup(t), journal = new MessageJournal({ root });
  journal.claim('PRIVATE_OWNER', 'PRIVATE_MESSAGE_ID', 'api');
  journal.disposition('PRIVATE_OWNER', 'PRIVATE_MESSAGE_ID', 'queued', 'task');
  journal.observe({ tasks: [{ id: 'task', state: 'waiting_permission', prompt: 'PRIVATE_PROMPT' }],
    pending: [{ code: 'PRIVATE_APPROVAL_CODE', input: 'PRIVATE_INPUT' }] });
  journal.claim('PRIVATE_OWNER', 'native-id', 'native');
  journal.disposition('PRIVATE_OWNER', 'native-id', 'forwarded_unverified');
  const restored = new MessageJournal({ root }).snapshot();
  assert.equal(restored.interrupted, 2); assert.equal(restored.pendingExpired, 1);
  assert(restored.recent.every(row => row.state === 'interrupted_unknown'));
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'bot-recovery.sqlite')).toString('utf8'), /PRIVATE_/);
  assert.equal(new MessageJournal({ root }).snapshot().pendingExpired, 0);
});
test('a receipt committed before dispatch becomes uncertain, never ready-to-replay', t => {
  const root = setup(t), journal = new MessageJournal({ root });
  journal.claim('owner', 'crash-gap', 'api');
  const restored = new MessageJournal({ root });
  assert.equal(restored.snapshot().interrupted, 1);
  assert.equal(restored.claim('owner', 'crash-gap', 'api'), false);
  restored.clear(); assert.equal(restored.snapshot().recent.length, 0);
});
test('unsupported SQLite and corrupted database fail closed without exposing raw errors', t => {
  const root = setup(t);
  const missing = new MessageJournal({ root, loadSqlite() { throw Error('PRIVATE_PATH'); } });
  assert.equal(missing.snapshot().available, false);
  assert.throws(() => missing.claim('owner', 'id', 'api'), { code: 'journal_unavailable' });
  assert.doesNotMatch(JSON.stringify(missing.snapshot()), /PRIVATE_PATH/);
  fs.writeFileSync(path.join(root, 'bot-recovery.sqlite'), 'not a database');
  const corrupt = new MessageJournal({ root });
  assert.equal(corrupt.available, false);
  assert.equal(fs.readFileSync(path.join(root, 'bot-recovery.sqlite'), 'utf8'), 'not a database');
});

test('old inbound-only databases migrate without inventing bubble history and only linked companion tasks get metadata',t=>{
  const root=setup(t);
  database(root,db=>db.exec("CREATE TABLE inbound(id TEXT PRIMARY KEY,mode TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,task_id TEXT); INSERT INTO inbound VALUES('old','claude','reply_ended',1,1,'old-task');"));
  const journal=new MessageJournal({root});assert.equal(journal.available,true);assert.deepEqual(journal.snapshot().companionDelivery,[]);
  const row={id:'new-task',state:'delivering',prompt:'PRIVATE_PROMPT',text:'PRIVATE_REPLY',bubbleDelivery:delivery()};
  journal.observe({tasks:[row]});assert.equal(journal.snapshot().companionDelivery.length,0,'unlinked task is ignored, not cached');
  journal.claim('owner','new','api');journal.disposition('owner','new','running','new-task');journal.observe({tasks:[row]});
  assert.equal(journal.snapshot().companionDelivery.length,1);assert.equal(journal.snapshot().companionDelivery[0].planned,4);
  row.bubbleDelivery=delivery({attempted:1,inFlight:1});journal.observe({tasks:[row]});assert.equal(journal.snapshot().companionDelivery[0].inFlight,1,'delivering state unchanged still persists count');
  journal.claim('owner','local','api');journal.disposition('owner','local','running','local-task');journal.observe({tasks:[{id:'local-task',local:true,state:'running',bubbleDelivery:delivery()}]});assert.equal(journal.snapshot().companionDelivery.length,1);
  assert.doesNotMatch(JSON.stringify(journal.snapshot()),/PRIVATE_|new-task/);assert.doesNotMatch(fs.readFileSync(journal.file).toString('utf8'),/PRIVATE_/);
});

test('restart converts in-flight attempts to unknown without replay or invented cancellation counts',t=>{
  const root=setup(t),journal=new MessageJournal({root});journal.claim('owner','pending-bubbles','deepseek');journal.disposition('owner','pending-bubbles','running','bubbles');
  journal.observe({tasks:[{id:'bubbles',state:'delivering',bubbleDelivery:delivery({attempted:2,accepted:1,inFlight:1})}]});
  const restored=new MessageJournal({root}),row=restored.snapshot().companionDelivery[0];
  assert.equal(row.attempted,2);assert.equal(row.accepted,1);assert.equal(row.unknown,1);assert.equal(row.inFlight,0);
  assert.equal(row.unattemptedAtCancel,null);assert.equal(row.inFlightAtCancel,null);assert.equal(restored.snapshot().interrupted,1);
  assert.equal(restored.claim('owner','pending-bubbles','deepseek'),false);
  restored.clear();assert.deepEqual(restored.snapshot().companionDelivery,[]);
});

test('malformed, regressive and oversized bubble evidence cannot be recorded as accepted delivery',t=>{
  const invalid=[{planned:5},{attempted:-1},{accepted:1},{attempted:1.5},{inFlight:2},{unattemptedAtCancel:3,inFlightAtCancel:0},{unattemptedAtCancel:4},{version:2},{prompt:'PRIVATE'}];
  for(const patch of invalid){const root=setup(t),journal=new MessageJournal({root});journal.claim('owner','input','api');journal.disposition('owner','input','running','task');
    assert.throws(()=>journal.observe({tasks:[{id:'task',state:'delivering',bubbleDelivery:delivery(patch)}]}),{code:'journal_unavailable'});assert.deepEqual(journal.snapshot().companionDelivery,[]);}
  const root=setup(t),journal=new MessageJournal({root});journal.claim('owner','input','api');journal.disposition('owner','input','running','task');
  journal.observe({tasks:[{id:'task',state:'delivering',bubbleDelivery:delivery({attempted:1,accepted:1})}]});
  assert.throws(()=>journal.observe({tasks:[{id:'task',state:'delivering',bubbleDelivery:delivery()}]}),{code:'journal_unavailable'});
  assert.equal(journal.snapshot().companionDelivery[0].accepted,1);
});

test('bubble metadata follows thirty-day pruning, removes orphan tasks and shares the inbound capacity bound',t=>{
  const root=setup(t);let now=Date.now();const journal=new MessageJournal({root,now:()=>now});
  journal.claim('owner','old','api');journal.disposition('owner','old','reply_ended','old-task');journal.observe({tasks:[{id:'old-task',state:'reply_ended',bubbleDelivery:delivery({planned:1,attempted:1,accepted:1})}]});
  database(root,db=>db.exec("UPDATE inbound SET task_id='replacement' WHERE task_id='old-task'"));journal.claim('owner','orphan-check','api');assert.deepEqual(journal.snapshot().companionDelivery,[]);
  journal.disposition('owner','orphan-check','reply_ended','expires');journal.observe({tasks:[{id:'expires',state:'reply_ended',bubbleDelivery:delivery({planned:1,attempted:1,accepted:1})}]});
  now+=31*86400000;journal.claim('owner','after-retention','api');assert.deepEqual(journal.snapshot().companionDelivery,[]);
  database(root,db=>{db.exec('BEGIN');const insert=db.prepare("INSERT INTO inbound(id,mode,state,created_at,updated_at,task_id) VALUES(?,'api','reply_ended',?,?,?)");for(let i=1;i<10000;i++)insert.run('bound-'+i,now,now,'bound-task-'+i);db.exec('COMMIT');});
  assert.throws(()=>journal.claim('owner','over-limit','api'),{code:'journal_unavailable'});
  assert.equal(database(root,db=>db.prepare('SELECT count(*) AS count FROM inbound').get().count),10000);
});
