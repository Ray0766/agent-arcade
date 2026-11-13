'use strict';
const test = require('./helpers/platform-skip.cjs').ownedIpcTest, assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fixture, deferred } = require('./helpers/qq-shell-code-repair-fixture.cjs');
const F = require('../src/bot/qq-node-repair-fs.cjs');
const M = require('../src/bot/qq-managed-shell-repair-metadata.cjs');
const ticket = p => ({ ticketId: p.ticketId, expectedDigest: p.expectedDigest });
const prepare = async f => f.helper.preview({ observationId: (await f.helper.inspect()).observationId });
const fault = () => Object.assign(Error('Synthetic I/O interruption'), { code: 'EIO' });

test('shared Shell code repair preserves original bytes, descriptors, metadata and account paths without reading account contents', async t => {
  const f = fixture(t), before = F.tree(f.p.codeRoot), metadata = fs.readFileSync(f.p.manifestPath);
  const descriptors = f.records.map(row => fs.readFileSync(row.paths.descriptor));
  const preview = await prepare(f); assert.equal(preview.scope.installations.length, 2);
  const result = await f.helper.confirm(ticket(preview));
  assert.equal(result.committed, true); assert.equal(result.readback, 'full-manifest');
  assert.equal(result.accountDataVerification, 'not-read'); assert.equal(result.oldTreeRetained, true);
  const old = F.tree(path.join(f.p.operationsRoot, preview.operationId, 'old-code'));
  assert.equal(old.files, before.files); assert.equal(old.rows.find(r => r.kind === 'file').sha256, before.rows.find(r => r.kind === 'file').sha256);
  assert(fs.readFileSync(f.p.manifestPath).equals(metadata));
  f.records.forEach((row, index) => {
    assert(fs.readFileSync(row.paths.descriptor).equals(descriptors[index]));
    assert.equal(fs.readFileSync(path.join(row.paths.configDir, 'opaque.json'), 'utf8'), 'SYNTHETIC_KEEP_CONFIG');
    assert.equal(fs.readFileSync(path.join(row.paths.qqDataDir, 'opaque.db'), 'utf8'), 'SYNTHETIC_KEEP_DATA');
  });
  assert.equal(M.assertManagedShellRepairReady({ root: f.root }), undefined);
  assert.throws(() => f.helper.confirm(ticket(preview)), { code: 'preview_required' });
  assert.equal((await f.helper.inspect()).state, 'healthy');
});

test('absent original publishes same-version code without fabricating retained original', async t => {
  const f = fixture(t, { missing: true }), p = await prepare(f), result = await f.helper.confirm(ticket(p));
  assert.equal(result.committed, true); assert.equal(result.oldTreeRetained, false);
  assert.equal(result.liveCode, 'same-version-verified'); assert(!fs.existsSync(path.join(f.p.operationsRoot, p.operationId, 'old-code')));
});

test('same-byte record replacement, stale scope, expiry and newly running process prevent first live mutation', async t => {
  for (const mode of ['record', 'scope', 'expiry', 'running']) {
    const f = fixture(t), p = await prepare(f);
    if (mode === 'record') { const file = path.join(f.p.operationsRoot, p.operationId, 'prepared.json'), copy = path.join(f.temp, 'replacement'); fs.writeFileSync(copy, fs.readFileSync(file)); fs.renameSync(copy, file); }
    if (mode === 'scope') fs.appendFileSync(f.records[1].paths.descriptor, ' ');
    if (mode === 'expiry') f.state.mono += 300000;
    if (mode === 'running') f.state.rows.push({ pid: 123, name: 'QQ.exe', executable: f.records[0].value.qq.file });
    const result = await f.helper.confirm(ticket(p)); assert.equal(result.committed, false, mode);
    assert.equal(fs.readFileSync(path.join(f.p.codeRoot, 'napcat.mjs'), 'utf8'), 'SYNTHETIC_DAMAGED_CODE');
  }
});

test('missing cache, any account lease and incomplete relevant process metadata refuse preparation', async t => {
  for (const mode of ['cache', 'lease', 'process']) {
    const f = fixture(t);
    if (mode === 'cache') f.options.packages.verify = async () => { throw Object.assign(Error('No cached archive'), { code: 'package_not_staged' }); };
    if (mode === 'lease') fs.writeFileSync(path.join(f.lockRoot, '1'.repeat(64) + '.json'), 'opaque-stale-or-partial');
    if (mode === 'process') f.state.rows.push({ pid: 123, name: 'QQ.exe', executable: '' });
    const observation = await f.helper.inspect(); assert.equal(observation.canPrepare, false, mode);
    if (mode !== 'cache') await assert.rejects(f.helper.preview({ observationId: observation.observationId }));
  }
});

test('first directory move interrupted leaves startup blocked and explicit restore returns exact damaged original', async t => {
  const f = fixture(t), p = await prepare(f);
  f.io.renameSync = (from, to) => { if (path.basename(from) === 'staged-code') throw fault(); fs.renameSync(from, to); };
  const result = await f.helper.confirm(ticket(p)); assert.equal(result.committed, null); assert(result.recoveryRequired);
  assert.throws(() => M.assertManagedShellRepairReady({ root: f.root }), { code: 'shell_repair_recovery_required' });
  f.io.renameSync = fs.renameSync; await f.helper.close(); f.helper = f.make();
  const inspection = await f.helper.inspect(); assert.deepEqual(inspection.pending[0].decisions, ['complete-prepared', 'restore-original']);
  const restore = await f.helper.reconcilePreview({ operationId: p.operationId, decision: 'restore-original' });
  const restored = await f.helper.reconcileConfirm(ticket(restore)); assert.equal(restored.committed, true);
  assert.equal(restored.liveCode, 'original-restored'); assert.equal(restored.readback, 'original-proof');
  assert.equal(fs.readFileSync(path.join(f.p.codeRoot, 'napcat.mjs'), 'utf8'), 'SYNTHETIC_DAMAGED_CODE');
  assert.equal((await f.helper.inspect()).state, 'damaged');
});

test('restart after first move can complete retained verified stage; another publication is never replayed', async t => {
  const f = fixture(t), p = await prepare(f);
  f.io.renameSync = (from, to) => { if (path.basename(from) === 'staged-code') throw fault(); fs.renameSync(from, to); };
  await f.helper.confirm(ticket(p)); await f.helper.close(); f.helper = f.make(); f.io.renameSync = fs.renameSync;
  const q = await f.helper.reconcilePreview({ operationId: p.operationId, decision: 'complete-prepared' });
  let moves = 0;
  f.io.renameSync = (from, to) => { moves++; fs.renameSync(from, to); throw fault(); };
  const result = await f.helper.reconcileConfirm(ticket(q)); assert.equal(result.committed, true); assert.equal(result.readback, 'full-manifest');
  assert(result.recoveryRequired); assert.equal(moves, 1);
  f.io.renameSync = () => assert.fail('Acknowledgement must not move code');
  const ack = await f.helper.reconcilePreview({ operationId: p.operationId, decision: 'acknowledge-complete' });
  assert.equal((await f.helper.reconcileConfirm(ticket(ack))).recoveryRequired, false); f.io.renameSync = fs.renameSync;
});

test('post-publication corruption keeps known commit separate from verified live code', async t => {
  const f = fixture(t), p = await prepare(f);
  f.io.renameSync = (from, to) => { fs.renameSync(from, to); if (path.basename(from) === 'staged-code') fs.writeFileSync(path.join(to, 'napcat.mjs'), 'LATE_DAMAGE'); };
  const result = await f.helper.confirm(ticket(p));
  assert.equal(result.committed, true); assert.equal(result.liveCode, 'unverified'); assert.equal(result.readback, 'unavailable');
  assert(result.recoveryRequired); assert.equal((await f.helper.inspect()).pending[0].decisions.length, 0);
});

test('intent before link failure remains discoverable and explicit abandonment does not touch live code', async t => {
  const f = fixture(t), p = await prepare(f); f.io.linkSync = () => { throw fault(); };
  const result = await f.helper.confirm(ticket(p)); assert.equal(result.committed, false); assert(result.recoveryRequired);
  assert.throws(() => M.assertManagedShellRepairReady({ root: f.root }), { code: 'shell_repair_recovery_required' });
  f.io.linkSync = fs.linkSync;
  const q = await f.helper.reconcilePreview({ operationId: p.operationId, decision: 'abandon-prepared' });
  const abandoned = await f.helper.reconcileConfirm(ticket(q)); assert.equal(abandoned.committed, true); assert.equal(abandoned.liveCode, 'unchanged');
  assert.equal(M.assertManagedShellRepairReady({ root: f.root }), undefined);
});

test('retained original replaced by equal bytes but different identity is not adopted for recovery', async t => {
  const f = fixture(t), p = await prepare(f); f.io.renameSync = (from, to) => { if (path.basename(from) === 'staged-code') throw fault(); fs.renameSync(from, to); };
  await f.helper.confirm(ticket(p)); f.io.renameSync = fs.renameSync;
  const old = path.join(f.p.operationsRoot, p.operationId, 'old-code'), file = path.join(old, 'napcat.mjs');
  const copy = path.join(f.temp, 'same-bytes'); fs.writeFileSync(copy, fs.readFileSync(file)); fs.renameSync(copy, file);
  const inspection = await f.helper.inspect(); assert.deepEqual(inspection.pending[0].decisions, []);
  await assert.rejects(f.helper.reconcilePreview({ operationId: p.operationId, decision: 'restore-original' }), { code: 'shell_repair_recovery_required' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC_DAMAGED_CODE');
});

test('pending cleanup failure preserves known completed publication; retry only removes exact pending marker', async t => {
  const f = fixture(t), p = await prepare(f); f.io.unlinkSync = file => { if (file === f.p.pending) throw fault(); fs.unlinkSync(file); };
  const result = await f.helper.confirm(ticket(p)); assert.equal(result.committed, true); assert(result.recoveryRequired);
  await f.helper.close(); f.helper = f.make(); f.io.unlinkSync = fs.unlinkSync;
  f.io.renameSync = () => assert.fail('A known completed publication must not repeat');
  const q = await f.helper.reconcilePreview({ operationId: p.operationId, decision: 'acknowledge-complete' });
  assert.equal((await f.helper.reconcileConfirm(ticket(q))).recoveryRequired, false); f.io.renameSync = fs.renameSync;
});

test('cancelled preparation becomes ended owned history; close failure retains known stage until explicit retry', async t => {
  const f = fixture(t), inspection = await f.helper.inspect(); f.state.stageHeld = deferred();
  const preparing = f.helper.preview({ observationId: inspection.observationId });
  while (!f.state.stageCalls) await new Promise(resolve => setImmediate(resolve));
  const dismissed = f.helper.discard(); f.state.stageHeld.resolve(); await assert.rejects(preparing, { code: 'cancelled' }); await dismissed;
  assert.equal((await f.helper.inspect()).history[0].state, 'abandoned');
  const p = await prepare(f); assert(p.ticketId); f.state.closeError = true;
  await assert.rejects(f.helper.close(), { code: 'shell_repair_cleanup_unconfirmed' }); assert.equal(f.helper.closed, false);
  assert.equal(f.helper.stages.size, 1); f.state.closeError = false; assert.equal((await f.helper.close()).closed, true);
});

test('same-store competing helper cannot enter while a stage owns the shared gate', async t => {
  const f = fixture(t), inspection = await f.helper.inspect(); f.state.stageHeld = deferred();
  const preparing = f.helper.preview({ observationId: inspection.observationId });
  while (!f.state.stageCalls) await new Promise(resolve => setImmediate(resolve));
  try { await assert.rejects(f.make().inspect(), { code: 'shell_repair_busy' }); }
  finally { f.state.stageHeld.resolve(); }
  assert((await preparing).ticketId);
});

test('completed history remains descriptive after a new valid installation joins the shared code scope', async t => {
  const f = fixture(t), first = await prepare(f);
  assert.equal((await f.helper.confirm(ticket(first))).committed, true);
  const id = randomUUID(), added = M.paths(f.root, id);
  fs.mkdirSync(added.configDir, { recursive: true }); fs.mkdirSync(added.qqDataDir);
  const value = { ...structuredClone(f.records[0].value), setupId: id,
    installationId: F.sha(added.installationRoot.toLowerCase()) };
  fs.writeFileSync(added.descriptor, JSON.stringify(value) + '\n');
  fs.writeFileSync(path.join(f.p.codeRoot, 'napcat.mjs'), 'NEW_DAMAGE');
  const observed = await f.helper.inspect();
  assert.equal(observed.scope.installations.length, 3);
  assert.equal(observed.history.length, 1); assert.equal(observed.pending.length, 0);
  assert.equal(observed.canPrepare, true);
  const next = await f.helper.preview({ observationId: observed.observationId });
  assert.equal(next.scope.installations.length, 3);
  assert.equal((await f.helper.confirm(ticket(next))).committed, true);
});
