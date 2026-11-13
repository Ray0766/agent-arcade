'use strict';
const test = require('./helpers/platform-skip.cjs').ownedIpcTest, assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { fixture, deferred } = require('./helpers/qq-component-repair-desktop-fixture.cjs');
const { QQSupervisorLinks } = require('../src/bot/qq-supervisor-links.cjs');
const { SupervisorStore } = require('../src/qq-supervisor/store.cjs');
const C = require('../src/qq-supervisor/component-repair-policy.cjs');
const budget = { timeout: 20000 };
const disk = f => path.join(f.appRoot, 'qq-supervisor-links.json');
const confirmations = f => f.network.filter(r => r.method === 'POST' && r.path === C.BASE + '/confirmations').length;

test('desktop HTTPS repair journals encrypted proof before submission, preserves original tree and releases client', budget, async t => {
  const f = await fixture(t), p = await f.preview(), set = f.links.setPending.bind(f.links);
  let attempted = false;
  f.links.setPending = (id, revision, pending) => { const r = set(id, revision, pending);
    if (pending) { const raw = fs.readFileSync(disk(f), 'utf8');
      assert(!raw.includes(pending.requestId)); assert(!raw.includes(pending.expectedDigest));
      if (pending.phase === 'attempted') attempted = true;
    } return r;
  };
  assert.equal(p.preview.kind, 'component-repair'); assert(!Object.hasOwn(p.preview, 'expectedDigest'));
  assert.equal(p.preview.scope.installations.length, 2);
  const r = await f.panel.componentRepairConfirm({ ...f.base, ticketId: p.preview.ticketId });
  assert(attempted); assert.equal(r.componentRepairChange.outcome, 'accepted');
  assert.equal(r.componentRepairChange.operation.result.committed, true);
  assert.equal(r.componentRepairChange.operation.result.readback, 'full-manifest');
  assert.equal(fs.readFileSync(path.join(f.p.operationsRoot, p.preview.operationId, 'old-code', 'napcat.mjs'), 'utf8'), 'SYNTHETIC_DAMAGED_CODE');
  assert.equal(f.links.capture(f.entry.supervisorId).pending, null); assert.equal(f.panel.panel.clients.size, 0);
  assert.equal(confirmations(f), 1); assert.deepEqual(f.runtimeCalls, []);
  assert.doesNotMatch(JSON.stringify(r), /SYNTHETIC_|opaque\.json|[A-Z]:\\/);
});

test('disabled repair is separate from ordinary process permission and never opens code metadata', budget, async t => {
  const f = await fixture(t, { enabled: false });
  f.adapter._binding = () => assert.fail('disabled metadata access');
  const r = await f.panel.componentRepairRead(f.ref);
  assert.equal(r.capability.enabled, false); assert.equal(r.inspection, null);
  await assert.rejects(f.panel.componentRepairPreview({ ...f.ref, action: 'repair', observationId: randomUUID(), operationId: null }), { code: 'observation_expired' });
  assert.equal(f.state.stageCalls, 0); assert.equal(confirmations(f), 0); assert.deepEqual(f.runtimeCalls, []);
});

test('lost response reopens encrypted attempted request and queries disabled service without replay', budget, async t => {
  let lose = true;
  const f = await fixture(t, { wrapClient: c => { const run = c.componentRepairConfirm.bind(c);
    c.componentRepairConfirm = async (...args) => { const r = await run(...args); if (lose) { lose = false;
      throw Object.assign(Error('Synthetic reply loss'), { code: 'connection_failed', submitted: true }); } return r; }; } });
  const r = await f.confirm(); assert.equal(r.componentRepairChange.outcome, 'unknown');
  const original = f.links.capture(f.entry.supervisorId).pending; assert.equal(original.phase, 'attempted');
  await f.panel.close(); f.adapter.config.componentRepair.enabled = false;
  const links = new QQSupervisorLinks({ root: f.appRoot, vault: f.vault }), p = f.makePanel(links);
  await p.list(f.base); assert.deepEqual(links.capture(f.entry.supervisorId).pending, original);
  const q = await p.query(f.ref); assert.equal(q.componentRepairQuery.operation.phase, 'completed');
  assert.equal(q.componentRepairQuery.operation.result.committed, true);
  assert.equal(links.capture(f.entry.supervisorId).pending, null); assert.equal(confirmations(f), 1); assert.equal(f.state.stageCalls, 1);
});

test('unknown partial publication remains durable until explicit archive; then exact retained stage can be completed', budget, async t => {
  const f = await fixture(t), p = await f.preview();
  f.io.renameSync = (from, to) => { if (path.basename(from) === 'staged-code') throw Object.assign(Error('Synthetic rename interruption'), { code: 'EIO' }); return fs.renameSync(from, to); };
  const r = await f.panel.componentRepairConfirm({ ...f.base, ticketId: p.preview.ticketId });
  assert.equal(r.componentRepairChange.outcome, 'unknown'); assert.equal(r.componentRepairChange.operation.result.committed, null);
  const pending = f.links.capture(f.entry.supervisorId).pending;
  await f.panel.componentRepairRead(f.ref); assert(f.links.capture(f.entry.supervisorId).pending);
  await assert.rejects(f.panel.componentRepairDiscard(f.ref), { code: 'operation_unresolved' });
  const q = await f.panel.query(f.ref); assert.equal(q.componentRepairQuery.canEndRecovery, true);
  assert.equal(q.componentRepairQuery.operation.result.recoveryRequired, true);
  await f.panel.endRecovery({ ...f.ref, requestId: pending.requestId });
  assert.equal(f.links.capture(f.entry.supervisorId).history[0].operation.result.committed, null);
  f.io.renameSync = fs.renameSync;
  const repair = await f.preview('complete-prepared', p.preview.operationId);
  const done = await f.panel.componentRepairConfirm({ ...f.base, ticketId: repair.preview.ticketId });
  assert.equal(done.componentRepairChange.operation.result.committed, true); assert.equal(f.state.stageCalls, 1);
  assert.equal(confirmations(f), 2);
});

test('committed publication with pending-marker cleanup failure retains full partial receipt', budget, async t => {
  const f = await fixture(t), p = await f.preview();
  f.io.unlinkSync = file => { if (file === f.p.pending) throw Object.assign(Error('Synthetic unlink interruption'), { code: 'EIO' }); return fs.unlinkSync(file); };
  const r = await f.panel.componentRepairConfirm({ ...f.base, ticketId: p.preview.ticketId });
  const result = r.componentRepairChange.operation.result;
  assert.equal(result.committed, true); assert.equal(result.liveCode, 'same-version-verified');
  assert.equal(result.recoveryRequired, true); assert.equal(result.oldTreeRetained, true);
  assert.notEqual(result.code, null); assert(fs.existsSync(f.p.pending)); assert.equal(confirmations(f), 1);
});

test('local close failure after known publication leaves its request recoverable rather than dropping the result', budget, async t => {
  let failClose = false;
  const f = await fixture(t, { wrapClient: c => { const run = c.componentRepairConfirm.bind(c), close = c.close.bind(c);
    c.componentRepairConfirm = async (...args) => { const r = await run(...args); failClose = true; return r; };
    c.close = async () => { if (failClose) { failClose = false; throw Object.assign(Error('Synthetic local cleanup failure'), { code: 'cleanup_unconfirmed' }); } return close(); }; } });
  const p = await f.preview();
  const response = await f.panel.componentRepairConfirm({ ...f.base, ticketId: p.preview.ticketId });
  const pending = f.links.capture(f.entry.supervisorId).pending;
  assert.equal(response.componentRepairChange.operation.result.committed, true);
  assert.equal(response.componentRepairChange.code, 'cleanup_unconfirmed');
  assert.equal(response.componentRepairChange.pending, true); assert(pending);
  assert.equal(f.panel.panel.clients.size, 1);
  await f.panel.closeOwned(f.base); await f.panel.list(f.base);
  assert.equal((await f.panel.query(f.ref)).componentRepairQuery.operation.result.committed, true);
  assert.equal(f.links.capture(f.entry.supervisorId).pending, null);
  assert.equal(confirmations(f), 1);
});

test('query close failure retains known receipt and exact pending until explicit close retry and fresh query', budget, async t => {
  let lose = true, failClose = false, faultQuery = true;
  const f = await fixture(t, { wrapClient: c => { const confirm = c.componentRepairConfirm.bind(c),
    query = c.componentRepairQuery.bind(c), close = c.close.bind(c);
    c.componentRepairConfirm = async (...args) => { const r = await confirm(...args); if (lose) { lose = false;
      throw Object.assign(Error('Synthetic lost confirmation'), { code: 'connection_failed', submitted: true }); } return r; };
    c.componentRepairQuery = async (...args) => { const r = await query(...args); if (faultQuery) { faultQuery = false; failClose = true; } return r; };
    c.close = async () => { if (failClose) { failClose = false; throw Object.assign(Error('Synthetic query cleanup'), { code: 'cleanup_unconfirmed' }); } return close(); };
  } });
  await f.confirm(); const before = f.links.capture(f.entry.supervisorId).pending;
  const q = await f.panel.query(f.ref);
  assert.equal(q.componentRepairQuery.operation.result.committed, true);
  assert.equal(q.componentRepairQuery.code, 'cleanup_unconfirmed'); assert.equal(q.componentRepairQuery.pending, true);
  assert.deepEqual(f.links.capture(f.entry.supervisorId).pending, before);
  const requests = f.network.length;
  await assert.rejects(f.panel.query(f.ref), { code: 'cleanup_unconfirmed' });
  assert.equal(f.network.length, requests); assert.deepEqual(f.links.capture(f.entry.supervisorId).pending, before);
  await f.panel.closeOwned(f.base); await f.panel.list(f.base);
  const final = await f.panel.query(f.ref); assert.equal(final.componentRepairQuery.pending, false);
  assert.equal(final.componentRepairQuery.operation.requestId, before.requestId); assert.equal(confirmations(f), 1);
});

test('read, dismiss, expiry and changed parent invalidate local preview without submitting', budget, async t => {
  const f = await fixture(t), first = await f.preview();
  await f.panel.dismiss(f.base);
  await assert.rejects(f.panel.componentRepairConfirm({ ...f.base, ticketId: first.preview.ticketId }), { code: 'expired_ticket' });
  await assert.rejects(f.panel.componentRepairPreview({ ...f.ref, action: 'repair', observationId: randomUUID(), operationId: null }), { code: 'observation_expired' });
  // A fresh fixture avoids replacing the explicitly retained first prepared stage.
  const g = await fixture(t), p = await g.preview(); g.state.mono += 60000;
  await assert.rejects(g.panel.componentRepairConfirm({ ...g.base, ticketId: p.preview.ticketId }), { code: 'expired_ticket' });
  g.parent.parentGeneration++; assert.equal(g.panel.observe(), false);
  await assert.rejects(g.panel.componentRepairRead(g.ref), { code: 'changed' });
  assert.equal(confirmations(f) + confirmations(g), 0);
});

test('close during late HTTPS preview cannot recreate a ticket or admit old-panel work', budget, async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { wrapClient: c => { const run = c.componentRepairPreview.bind(c);
    c.componentRepairPreview = async (...args) => { const r = await run(...args); entered.resolve(); await release.promise; return r; }; } });
  t.after(() => release.resolve());
  const r = await f.panel.componentRepairRead(f.ref), job = f.panel.componentRepairPreview({ ...f.ref,
    action: 'repair', observationId: r.inspection.observationId, operationId: null });
  job.catch(() => {}); await entered.promise;
  const closing = f.panel.closeOwned(f.base); assert.equal(f.panel.panel, null); release.resolve();
  await assert.rejects(job, { code: 'changed' }); assert.equal((await closing).closed, true);
  assert.equal(f.panel.panel, null); assert.equal(confirmations(f), 0);
});

test('discard validates supervisor scope and closes only repair staging, preserving ordinary pending evidence', budget, async t => {
  const f = await fixture(t), p = await f.preview();
  await assert.rejects(f.panel.componentRepairDiscard({ ...f.ref, remoteId: randomUUID() }), { code: 'changed' });
  assert.equal(f.adapter.ticket.operationId, p.preview.operationId);
  assert.equal((await f.panel.componentRepairDiscard(f.ref)).discarded, true);
  assert.equal(f.adapter.ticket, null); assert.equal(f.repairHelper.stages.size, 0);
  assert(fs.existsSync(path.join(f.p.operationsRoot, p.preview.operationId, 'staged-code')));
  await assert.rejects(f.panel.componentRepairConfirm({ ...f.base, ticketId: p.preview.ticketId }), { code: 'expired_ticket' });
  const pending = { kind: 'process', requestId: randomUUID(), action: 'start', phase: 'attempted',
    createdAt: Date.now(), ledgerId: f.service.store.ledgerId, observationId: randomUUID(), terminal: null };
  f.links.setPending(f.entry.supervisorId, f.entry.revision, pending);
  await assert.rejects(f.panel.componentRepairDiscard(f.ref), { code: 'operation_unresolved' });
  assert.deepEqual(f.links.capture(f.entry.supervisorId).pending, pending); assert.equal(confirmations(f), 0);
});

test('mismatched operation receipt cannot clear a durable repair request', budget, async t => {
  const f = await fixture(t, { wrapClient: c => { const run = c.componentRepairConfirm.bind(c);
    c.componentRepairConfirm = async (...args) => { const r = await run(...args); const id = randomUUID();
      r.operation.operationId = id; r.operation.result.operationId = id; return r; }; } });
  const r = await f.confirm(); assert.equal(r.componentRepairChange.outcome, 'unknown');
  assert.equal(r.componentRepairChange.operation, null); assert(f.links.capture(f.entry.supervisorId).pending);
  assert.equal((await f.panel.query(f.ref)).componentRepairQuery.operation.result.committed, true);
  assert.equal(confirmations(f), 1);
});

test('v6 SQLite and encrypted histories preserve all six prior families when explicitly upgraded to v7', budget, async t => {
  const f = await fixture(t, { enabled: false }); await f.panel.close(); await f.service.close();
  const config = { ...f.config, profileBackups: { enabled: true }, passkeys: {
    enabled: false, origin: 'https://webui.arcade.invalid', recoveryRouteDeclared: false } };
  const common = () => ({ requestId: randomUUID(), ticketId: randomUUID(), expectedDigest: 'b'.repeat(64) });
  const rows = [
    { kind: 'process', begin: 'begin', get: 'get', input: { requestId: randomUUID(), action: 'start', observationId: randomUUID() } },
    { kind: 'pending-update', begin: 'beginRecovery', get: 'getRecovery', input: { ...common(), action: 'disable', recordId: 'a'.repeat(64) } },
    { kind: 'component-lock', begin: 'beginLock', get: 'getLock', input: { ...common(), action: 'clear-installation', recordId: 'a'.repeat(64) } },
    { kind: 'orphan-cleanup', begin: 'beginOrphan', get: 'getOrphan', input: { ...common(), action: 'terminate' } },
    { kind: 'native-passkey', begin: 'beginNativePasskey', get: 'getNativePasskey', input: { ...common(), action: 'revoke', recordId: 'a'.repeat(64) } },
    { kind: 'profile-backup', begin: 'beginProfileBackup', get: 'getProfileBackup', input: { ...common(), action: 'backup', backupId: null, sha256: null, currentSha256: 'c'.repeat(64) } },
  ];
  let store = await SupervisorStore.open(config), ledger = store.ledgerId;
  try { assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 6); for (const r of rows) store[r.begin](r.input); }
  finally { await store.close(); }
  store = await SupervisorStore.open(config);
  try { for (const r of rows) r.prior = store[r.get](r.input.requestId); } finally { await store.close(); }
  store = await SupervisorStore.open({ ...config, componentRepair: { enabled: true } });
  try {
    assert.equal(store.ledgerId, ledger); assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 7);
    const repair = { ...common(), action: 'repair', operationId: randomUUID() };
    for (const r of rows) { assert.deepEqual(store[r.get](r.input.requestId), r.prior);
      assert.throws(() => store.beginComponentRepair({ ...repair, requestId: r.input.requestId }), { code: 'request_conflict' }); }
    store.beginComponentRepair(repair);
    for (const r of rows) assert.throws(() => store[r.begin]({ ...r.input, requestId: repair.requestId }), { code: 'request_conflict' });
  } finally { await store.close(); }
  const entry = f.links.capture(f.entry.supervisorId);
  const oldPending = r => ({ kind: r.kind, ...r.input, phase: 'attempted', createdAt: r.prior.operation.startedAt,
    ledgerId: ledger, terminal: r.prior.operation,
    ...(r.kind === 'orphan-cleanup' ? { accountId: f.config.expectedQQ } : {}),
    ...(r.kind === 'native-passkey' ? { origin: config.passkeys.origin } : {}) });
  entry.pending = oldPending(rows[0]); entry.history = rows.map(r => ({ pending: oldPending(r), operation: r.prior.operation,
    endedAt: r.prior.operation.finishedAt + 1 }));
  const bytes = Buffer.from(JSON.stringify({ version: 6, data: f.vault.encryptString(JSON.stringify({ version: 6, entries: [entry] })).toString('base64') }));
  fs.writeFileSync(disk(f), bytes);
  const bad = new QQSupervisorLinks({ root: f.appRoot, vault: { ...f.vault, encryptString() { throw Error('Synthetic encryption failure'); } } });
  assert.deepEqual(bad.capture(entry.supervisorId), entry);
  assert.throws(() => bad.setPending(entry.supervisorId, entry.revision, entry.pending), { code: 'encryption_unavailable' });
  assert.deepEqual(fs.readFileSync(disk(f)), bytes);
  const good = new QQSupervisorLinks({ root: f.appRoot, vault: f.vault });
  assert.deepEqual(good.capture(entry.supervisorId), entry); assert.deepEqual(fs.readFileSync(disk(f)), bytes);
  good.setPending(entry.supervisorId, entry.revision, entry.pending);
  assert.equal(JSON.parse(fs.readFileSync(disk(f))).version, 7);
  assert.deepEqual(new QQSupervisorLinks({ root: f.appRoot, vault: f.vault }).capture(entry.supervisorId), entry);
});
