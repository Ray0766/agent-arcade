'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID, randomBytes, createCipheriv, createDecipheriv, createHash } = require('node:crypto');
const { QCEScheduleStore, planRecord, runRecord, MAX_PLANS, MAX_RUNS } = require('../src/bot/qq-qce-schedule-store.cjs');

function vault(key) {
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
    decryptString(bytes) {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
}
function fixture(t) {
  const base = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(base, 'arcade-synthetic-qce-schedules-'));
  const key = Buffer.alloc(32, 61), stores = [], v = vault(key);
  const f = { root, key, vault: v, now: Date.parse('2030-01-01T00:00:00Z') };
  f.open = (options = {}) => {
    const store = new QCEScheduleStore({ root, vault: v, now: () => f.now, ...options });
    stores.push(store); return store;
  };
  t.after(() => {
    for (const store of stores) store.close();
    assert(root.startsWith(base + path.sep + 'arcade-synthetic-qce-schedules-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return f;
}
const scope = () => ({ accountId: 'synthetic-schedule-profile', qqAccountId: '100001', workScope: 'a'.repeat(64), credentialRevision: randomUUID() });
const definition = () => ({
  name: 'Synthetic scheduled export',
  target: { kind: 'friend', peer: { chatType: 1, peerUid: 'u_SyntheticScheduledPeer' }, name: 'Synthetic friend', number: '200001' },
  targetPage: 1,
  configBaseline: { customOutputDir: null, customScheduledExportDir: null, currentExportsDir: 'C:\\Synthetic-QCE\\exports', currentScheduledExportsDir: 'C:\\Synthetic-QCE\\scheduled' },
  recurrence: { frequency: 'daily', time: '09:00', timeZone: 'UTC', dstPolicy: { missing: 'skip', repeated: 'first' }, missingMonthDay: 'skip' },
  lookbackDays: 7, format: 'JSON',
  options: { includeSystemMessages: false, preferGroupMemberName: true, resources: { image: false, video: false, audio: false, file: false }, htmlZip: false },
});
const slot = n => createHash('sha256').update(`synthetic-slot-${n}`).digest('hex');
function claim(store, s, p, extra = {}) {
  return store.claim(s, p.scheduleId, p.revision, {
    kind: 'scheduled', scheduledAt: p.nextAt, slotKey: slot(p.nextAt), nextAt: p.nextAt + 86400000, operationId: randomUUID(), ...extra,
  });
}
function enabled(store, s, now) {
  const p = store.create(s, definition());
  return store.setEnabled(s, p.scheduleId, p.revision, true, now + 60000);
}

test('encrypted definitions and run ownership survive reopen without plaintext fields or execution', t => {
  const f = fixture(t), s = scope(), store = f.open(), p = enabled(store, s, f.now);
  f.now = p.nextAt; const admitted = claim(store, s, p);
  store.close();
  const bytes = fs.readFileSync(path.join(f.root, 'qce-schedules.sqlite'));
  for (const secret of [s.accountId, s.qqAccountId, s.workScope, definition().target.peer.peerUid, definition().configBaseline.currentExportsDir]) assert.equal(bytes.includes(Buffer.from(secret)), false);
  const reopened = f.open();
  assert.deepEqual(reopened.get(s, p.scheduleId), admitted.plan);
  assert.deepEqual(reopened.runs(s), [admitted.run]);
  assert.equal(admitted.run.outcome, 'claimed');
});

test('credential rotation permits only local read/disable/remove; it cannot adopt or enable an old plan', t => {
  const f = fixture(t), store = f.open(), old = scope(), changed = { ...old, credentialRevision: randomUUID() }, p = enabled(store, old, f.now);
  assert.equal(store.list(changed).length, 1);
  assert.equal(store.get(changed, p.scheduleId).scope.credentialRevision, old.credentialRevision);
  assert.throws(() => store.update(changed, p.scheduleId, p.revision, definition()), { code: 'qce_schedules_changed' });
  assert.throws(() => store.setEnabled(changed, p.scheduleId, p.revision, true, p.nextAt + 1000), { code: 'qce_schedules_changed' });
  assert.throws(() => claim(store, changed, p), { code: 'qce_schedules_changed' });
  const disabled = store.setEnabled(changed, p.scheduleId, p.revision, false, null);
  assert.equal(disabled.scope.credentialRevision, old.credentialRevision);
  assert.equal(disabled.enabled, false);
  assert.equal(store.remove({ ...old, credentialRevision: null }, p.scheduleId, disabled.revision).removed, true);
});

test('different registered profile, actual QQ or work scope cannot see, change or erase a plan/run', t => {
  const f = fixture(t), store = f.open(), s = scope(), p = enabled(store, s, f.now), admitted = claim(store, s, p);
  for (const other of [{ ...s, accountId: 'synthetic-other' }, { ...s, qqAccountId: '300001' }, { ...s, workScope: 'b'.repeat(64) }]) {
    assert.deepEqual(store.list(other), []); assert.deepEqual(store.runs(other), []);
    assert.throws(() => store.get(other, p.scheduleId), { code: 'qce_schedules_changed' });
    assert.throws(() => store.remove(other, p.scheduleId, admitted.plan.revision), { code: 'qce_schedules_changed' });
    assert.throws(() => store.done(other, admitted.run.runId, admitted.run.revision, { outcome: 'unknown', code: 'qce_unavailable' }), { code: 'qce_schedules_changed' });
  }
});

test('two real SQLite handles admit one occurrence by plan revision and persist the winner', t => {
  const f = fixture(t), first = f.open(), second = f.open(), s = scope(), p = enabled(first, s, f.now);
  const observed = second.get(s, p.scheduleId), won = claim(first, s, p);
  assert.throws(() => claim(second, s, observed), { code: 'qce_schedules_changed' });
  assert.equal(second.runs(s).length, 1);
  assert.equal(second.get(s, p.scheduleId).lastScheduledAt, won.run.scheduledAt);
});

test('history removal and clock rewind cannot reset the scheduled high-water mark', t => {
  const f = fixture(t), store = f.open(), s = scope(), p = enabled(store, s, f.now), admitted = claim(store, s, p);
  const done = store.done(s, admitted.run.runId, admitted.run.revision, { outcome: 'accepted', code: null });
  assert.equal(store.forgetRun(s, done.runId, done.revision).forgotten, true);
  assert.deepEqual(store.runs(s), []);
  f.now -= 86400000;
  const disabled = store.setEnabled(s, p.scheduleId, admitted.plan.revision, false, null);
  assert.throws(() => store.setEnabled(s, p.scheduleId, disabled.revision, true, p.nextAt), { code: 'qce_schedules_changed' });
  const edited = store.update(s, p.scheduleId, disabled.revision, { ...definition(), name: 'Synthetic changed plan' });
  assert.equal(edited.lastScheduledAt, p.nextAt);
  assert.throws(() => store.setEnabled(s, p.scheduleId, edited.revision, true, p.nextAt), { code: 'qce_schedules_changed' });
});

test('manual run preserves scheduled cursor and terminal callback after removal cannot resurrect plan', t => {
  const f = fixture(t), store = f.open(), s = scope(), p = enabled(store, s, f.now);
  const admitted = claim(store, s, p, { kind: 'manual', scheduledAt: f.now, nextAt: null, slotKey: slot('manual') });
  assert.equal(admitted.plan.nextAt, p.nextAt); assert.equal(admitted.plan.lastScheduledAt, null);
  store.remove(s, p.scheduleId, admitted.plan.revision);
  const done = store.done(s, admitted.run.runId, admitted.run.revision, { outcome: 'unknown', code: 'qce_unavailable' });
  assert.deepEqual(store.list(s), []); assert.equal(done.outcome, 'unknown');
  assert.throws(() => store.done(s, done.runId, done.revision, { outcome: 'accepted', code: null }), { code: 'qce_schedules_changed' });
});

test('missed cursor advancement is durable and does not create a run or weaken the high-water bound', t => {
  const f = fixture(t), store = f.open(), s = scope(), p = enabled(store, s, f.now);
  const advanced = store.advance(s, p.scheduleId, p.revision, { scheduledAt: p.nextAt + 86400000, nextAt: p.nextAt + 2 * 86400000 });
  assert.equal(advanced.lastScheduledAt, p.nextAt + 86400000); assert.deepEqual(store.runs(s), []);
  assert.throws(() => claim(store, s, p), { code: 'qce_schedules_changed' });
  store.close(); assert.equal(f.open().get(s, p.scheduleId).lastScheduledAt, advanced.lastScheduledAt);
});

test('last supported slot atomically disables its plan for claim or missed-slot advancement', t => {
  const f = fixture(t), store = f.open(), s = scope();
  const p = enabled(store, s, f.now), admitted = claim(store, s, p, { nextAt: null });
  assert.equal(admitted.plan.enabled, false); assert.equal(admitted.plan.nextAt, null);
  assert.equal(admitted.plan.lastScheduledAt, p.nextAt); assert.equal(admitted.run.outcome, 'claimed');
  const other = enabled(store, s, f.now);
  const advanced = store.advance(s, other.scheduleId, other.revision, { nextAt: null, scheduledAt: other.nextAt });
  assert.equal(advanced.enabled, false); assert.equal(advanced.lastScheduledAt, other.nextAt);
  assert.equal(store.runs(s, other.scheduleId).length, 0);
  store.close(); const reopened = f.open();
  assert.equal(reopened.get(s, p.scheduleId).enabled, false); assert.equal(reopened.allEnabled().length, 0);
});

test('explicit interrupted settlement is scope-three local metadata only and invalidates late completion', t => {
  const f = fixture(t), store = f.open(), s = scope(), p = enabled(store, s, f.now), admitted = claim(store, s, p);
  const nextCredential = { ...s, credentialRevision: randomUUID() };
  assert.throws(() => store.settleInterrupted({ ...nextCredential, qqAccountId: '300001' }, admitted.run.runId, admitted.run.revision), { code: 'qce_schedules_changed' });
  const settled = store.settleInterrupted(nextCredential, admitted.run.runId, admitted.run.revision);
  assert.equal(settled.outcome, 'unknown'); assert.equal(settled.code, 'interrupted');
  assert.equal(settled.scope.credentialRevision, s.credentialRevision);
  assert.deepEqual(store.get(s, p.scheduleId), admitted.plan);
  assert.throws(() => store.done(s, admitted.run.runId, admitted.run.revision, { outcome: 'accepted', code: null }), { code: 'qce_schedules_changed' });
  assert.equal(store.forgetRun(nextCredential, settled.runId, settled.revision).forgotten, true);
  assert.equal(store.get(s, p.scheduleId).lastScheduledAt, p.nextAt);
});

test('limits are enforced transactionally and explicit safe removal restores capacity', t => {
  const f = fixture(t), first = f.open(), second = f.open(), s = scope();
  for (let i = 0; i < MAX_PLANS; i++) first.create(s, { ...definition(), name: `Synthetic plan ${i}` });
  assert.throws(() => second.create(s, definition()), { code: 'qce_schedules_limit' });
  let p = first.list(s)[0]; first.remove(s, p.scheduleId, p.revision); p = second.create(s, definition());
  for (let i = 0; i < MAX_RUNS; i++) {
    const admitted = claim(first, s, p, { kind: 'manual', scheduledAt: f.now, nextAt: null, slotKey: slot(i) });
    p = admitted.plan;
    first.done(s, admitted.run.runId, admitted.run.revision, { outcome: 'not_submitted', code: 'qce_unavailable' });
  }
  assert.throws(() => claim(second, s, p, { kind: 'manual', scheduledAt: f.now, nextAt: null, slotKey: slot('over') }), { code: 'qce_schedules_limit' });
  const old = second.runs(s)[0]; second.forgetRun(s, old.runId, old.revision);
  assert.equal(claim(first, s, p, { kind: 'manual', scheduledAt: f.now, nextAt: null, slotKey: slot('new') }).run.outcome, 'claimed');
});

test('encryption unavailable commits no plan and wrong key reopens locked', t => {
  const f = fixture(t), s = scope(), store = f.open();
  f.vault.isEncryptionAvailable = () => false;
  assert.throws(() => store.create(s, definition()), { code: 'qce_schedules_locked' });
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM plans').get().n, 0);
  f.vault.isEncryptionAvailable = () => true; store.create(s, definition()); store.close();
  const wrong = f.open({ vault: vault(Buffer.alloc(32, 62)) });
  assert.equal(wrong.state, 'locked'); assert.throws(() => wrong.list(s), { code: 'qce_schedules_locked' });
});

test('encryption failure after run insertion rolls back both admission and plan cursor', t => {
  const f = fixture(t), store = f.open(), s = scope(), p = enabled(store, s, f.now);
  const original = f.vault.encryptString; let writes = 0;
  f.vault.encryptString = text => { if (++writes === 2) throw Error('synthetic vault failure'); return original(text); };
  assert.throws(() => claim(store, s, p), { code: 'qce_schedules_locked' });
  f.vault.encryptString = original;
  assert.equal(writes, 2); assert.deepEqual(store.runs(s), []); assert.deepEqual(store.get(s, p.scheduleId), p);
});

test('malformed encrypted payload, schema or record identity is rejected without plaintext fallback', t => {
  const f = fixture(t), s = scope(), store = f.open(), p = store.create(s, definition());
  const broken = { ...p, enabled: true, nextAt: null };
  assert.throws(() => planRecord(broken), { code: 'invalid_request' });
  store.db.prepare('UPDATE plans SET payload=? WHERE id=?').run(f.vault.encryptString(JSON.stringify(broken)), p.scheduleId);
  store.close(); const reopened = f.open(); assert.equal(reopened.state, 'locked');
  assert.throws(() => reopened.list(s), { code: 'qce_schedules_locked' });
});

test('primary database disappearance is not confused with an optional SQLite sidecar', t => {
  const f = fixture(t), store = f.open(), s = scope(); store.create(s, definition());
  const original = fs.lstatSync;
  fs.lstatSync = function (name, options) {
    if (name === store.file) throw Object.assign(Error('synthetic missing primary database'), { code: 'ENOENT' });
    return original(name, options);
  };
  try { assert.throws(() => store.list(s), { code: 'qce_schedules_locked' }); }
  finally { fs.lstatSync = original; }
});

test('exact bigint database identity rejects a different inode despite otherwise valid metadata', t => {
  const f = fixture(t), store = f.open(), s = scope(); store.create(s, definition());
  const original = fs.lstatSync;
  fs.lstatSync = function (name, options) {
    const result = original(name, options);
    if (name === store.file && options?.bigint) result.ino += 1n;
    return result;
  };
  try { assert.throws(() => store.list(s), { code: 'qce_schedules_locked' }); }
  finally { fs.lstatSync = original; }
});

test('claimed occurrence survives an actual abrupt child exit and reopen never invokes a requester', t => {
  const f = fixture(t), s = scope(), store = f.open(), p = enabled(store, s, f.now);
  store.close();
  const program = `const {QCEScheduleStore}=require('./src/bot/qq-qce-schedule-store.cjs');const {createDecipheriv,createCipheriv,randomBytes}=require('node:crypto');const x=JSON.parse(process.env.QCE_SCHEDULE_SYNTHETIC);const key=Buffer.alloc(32,61);const vault={isEncryptionAvailable:()=>true,encryptString(text){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),b=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]);},decryptString(b){const c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8');}};const j=new QCEScheduleStore({root:x.root,vault,now:()=>x.at});j.claim(x.scope,x.id,x.revision,x.input);process.exit(86);`;
  const input = { kind: 'scheduled', scheduledAt: p.nextAt, slotKey: slot('abrupt'), nextAt: p.nextAt + 86400000, operationId: randomUUID() };
  const child = spawnSync(process.execPath, ['-e', program], {
    cwd: path.resolve(__dirname, '..'), windowsHide: true, timeout: 10000, encoding: 'utf8',
    env: { ...process.env, QCE_SCHEDULE_SYNTHETIC: JSON.stringify({ root: f.root, scope: s, id: p.scheduleId, revision: p.revision, at: p.nextAt, input }) },
  });
  assert.equal(child.status, 86, child.stderr); assert.equal(child.signal, null); assert.throws(() => process.kill(child.pid, 0));
  const reopened = f.open(), rows = reopened.runs(s);
  assert.equal(rows.length, 1); assert.equal(rows[0].outcome, 'claimed');
  assert.equal(reopened.get(s, p.scheduleId).lastScheduledAt, p.nextAt);
  assert.throws(() => claim(reopened, s, p), { code: 'qce_schedules_changed' });
  assert.throws(() => reopened.forgetRun(s, rows[0].runId, rows[0].revision), { code: 'qce_schedules_changed' });
  assert.deepEqual(runRecord(rows[0]), rows[0]);
  const current = { ...s, credentialRevision: randomUUID() };
  const settled = reopened.settleInterrupted(current, rows[0].runId, rows[0].revision);
  assert.equal(settled.outcome, 'unknown'); assert.equal(settled.code, 'interrupted');
  assert.equal(reopened.forgetRun(current, settled.runId, settled.revision).forgotten, true);
  assert.equal(reopened.get(s, p.scheduleId).lastScheduledAt, p.nextAt);
});
