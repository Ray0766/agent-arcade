'use strict';

const test = require('./helpers/platform-skip.cjs').ownedIpcTest;
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('./helpers/qq-shell-owner-fixture.cjs');

async function orphan(t) {
  const f = fixture(t);
  await f.runtime.start(f.account);
  const lease = f.deadManager();
  f.state.rows = f.state.rows.filter(p => p.pid !== lease.runtime.pid);
  f.marker();
  return { ...f, lease, r: f.fresh() };
}

const other = (f, extra = {}) => ({
  pid: 940007,
  parentPid: f.lease.runtime.pid,
  name: 'unrelated.exe',
  executable: path.join(f.base, 'other', 'unrelated.exe'),
  createdAt: '2026-11-06T23:00:00.0000000Z',
  ...extra,
});

test('older unrelated branch cannot be descendant of a later recorded launcher and is preserved', async t => {
  const f = await orphan(t);
  const a = other(f);
  const b = other(f, {
    pid: 940008,
    parentPid: a.pid,
    createdAt: '2026-11-06T23:01:00.0000000Z',
  });
  f.state.rows.push(a, b);

  assert.equal((await f.r.discover()).instances[0].canInspectOrphanCleanup, true);
  const preview = await f.r.previewOrphanCleanup(f.account);
  assert.equal(preview.count, 1);
  const done = await f.r.cleanupOrphans(f.account, { expectedDigest: preview.expectedDigest });

  assert.equal(done.cleanup.processes, 'confirmed-absent');
  assert.deepEqual(f.state.stops.map(rows => rows.map(r => r.pid)), [[f.lease.runtimeTree[1].pid]]);
  assert.deepEqual(f.state.rows.filter(r => [a.pid, b.pid].includes(r.pid)), [a, b]);
});

test('older unrelated row first observed after native stop does not falsely make completed cleanup partial', async t => {
  const f = await orphan(t);
  const a = other(f);
  const preview = await f.r.previewOrphanCleanup(f.account);
  const stop = f.host.stop;
  f.host.stop = async rows => {
    await stop(rows);
    f.state.rows.push(a);
  };

  const done = await f.r.cleanupOrphans(f.account, { expectedDigest: preview.expectedDigest });
  assert.equal(done.cleanup.processes, 'confirmed-absent');
  assert.equal(done.cleanup.lease, 'cleared');
  assert.deepEqual(f.state.rows.filter(r => r.pid === a.pid), [a]);
  assert.equal(f.state.stops.length, 1);
});

for (const mode of [
  'same-time',
  'late',
  'missing-time',
  'missing-executable',
  'same-path-qq',
  'reused-owned-pid',
]) test(`unproven ${mode} identity remains blocked without a native stop`, async t => {
  const f = await orphan(t);
  const a = other(f);

  if (mode === 'same-time') a.createdAt = f.lease.runtime.createdAt;
  if (mode === 'late') a.createdAt = '2026-11-07T03:00:00.0000000Z';
  if (mode === 'missing-time') a.createdAt = '';
  if (mode === 'missing-executable') a.executable = '';
  if (mode === 'same-path-qq') {
    a.name = 'QQ.exe';
    a.executable = f.qqExe;
  }
  if (mode === 'reused-owned-pid') {
    a.pid = f.lease.runtime.pid;
    a.parentPid = 1;
    a.createdAt = '2026-11-07T03:00:00.0000000Z';
  }
  f.state.rows.push(a);

  await assert.rejects(f.r.previewOrphanCleanup(f.account), {
    code: mode === 'reused-owned-pid' ? 'ownership_lost' : 'orphan_cleanup_unverified',
  });
  assert.equal((await f.r.discover()).instances[0].canInspectOrphanCleanup, undefined);
  assert.equal(f.state.stops.length, 0);
});
