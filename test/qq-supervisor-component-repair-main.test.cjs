'use strict';
const test = require('./helpers/platform-skip.cjs').ownedIpcTest, assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { fixture, add, base, hold, QQ } = require('./helpers/qq-supervisor-main-fixture.cjs');
const A = require('./helpers/qq-supervisor-app-fixture.cjs');
const { fixture: hostFixture } = require('./helpers/qq-component-repair-desktop-fixture.cjs');
const budget = { timeout: 20000 };
const names = ['Read', 'Preview', 'Confirm', 'Discard'].map(s => 'qqSupervisorComponentRepair' + s);
const registration = () => ({ label: 'Synthetic Shell repair', origin: 'https://supervisor.arcade.invalid',
  instanceId: randomUUID(), token: A.TOKEN, caSelectionId: null, spkiSha256: null, replace: null });
async function setup(t, host) {
  const f = fixture(t, { clientFactory: host?.makeClient }), row = await add(f), b = base(row);
  assert.equal((await f.invoke('qqSupervisorList', b)).ok, true);
  const input = registration();
  if (host) {
    const ca = path.join(f.root, 'synthetic-test-ca.pem'); fs.writeFileSync(ca, A.material.caPem);
    f.state.picker = hold(); f.state.picker.resolve({ canceled: false, filePaths: [ca] });
    const picked = await f.invoke('qqSupervisorPickCA', b); assert.equal(picked.ok, true, JSON.stringify(picked));
    Object.assign(input, { origin: host.options.origin, instanceId: host.config.instanceId, caSelectionId: picked.ca.selectionId });
  }
  const saved = await f.invoke('qqSupervisorCreate', { ...b, registration: input });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  return { f, row, b, ref: { ...b, supervisorId: saved.link.supervisorId } };
}
function requests({ b, ref }) { return [ref, { ...ref, action: 'repair', observationId: randomUUID(), operationId: null },
  { ...b, ticketId: randomUUID() }, ref]; }

test('actual preload exposes exactly the four repair calls and main rejects extra authority or foreign frames', budget, async t => {
  const s = await setup(t), { f } = s, payloads = requests(s), calls = [];
  let api;
  const file = path.resolve(__dirname, '../src/preload.cjs');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { require(id) {
    assert.equal(id, 'electron'); return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'arcade'); api = value; } },
      ipcRenderer: { invoke(name, value) { calls.push({ name, value }); return Promise.resolve(); }, on() {}, removeListener() {} } };
  } }, { filename: file });
  assert.deepEqual(Object.keys(api).filter(name => name.startsWith('qqSupervisorComponentRepair')).sort(), [...names].sort());
  for (let n = 0; n < names.length; n++) {
    const method = names[n], request = payloads[n]; assert(f.handlers.has('arcade:' + method));
    await api[method](request); assert.equal(calls.at(-1).name, 'arcade:' + method); assert.deepEqual(calls.at(-1).value, request);
    await assert.rejects(f.invoke(method, request, { sender: {}, senderFrame: {} }), /Untrusted sender/);
    for (const field of ['path', 'command', 'expectedQQ', 'installation']) {
      const r = await f.invoke(method, { ...request, [field]: 'synthetic-forbidden-authority' });
      assert.equal(r.ok, false, method); assert.equal(r.error.code, 'invalid_request', method);
    }
  }
  assert.equal(f.state.network, 0); assert.equal(f.api.remote().session.session, null);
});

test('actual hidden or newly selected profile cannot use any old repair admission', budget, async t => {
  for (const cause of ['hidden', 'profile']) {
    const s = await setup(t), { f } = s;
    if (cause === 'hidden') { f.state.visible = false; f.events.hide(); await f.api.closeRemoteManagement(); }
    else { f.accounts.selectedId = 'second'; f.api.observe(); }
    for (const [n, request] of requests(s).entries()) assert.equal((await f.invoke(names[n], request)).ok, false, cause + names[n]);
    assert.equal(f.state.network, 0);
  }
});

test('actual registered main repair read/preview/confirm reach HTTPS and SQLite once without ordinary Start', budget, async t => {
  const host = await hostFixture(t, { expectedQQ: QQ }), { f, b, ref } = await setup(t, host);
  const read = await f.invoke(names[0], ref); assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.inspection.state, 'damaged'); assert.equal(read.inspection.canPrepare, true);
  const preview = await f.invoke(names[1], { ...ref, action: 'repair', observationId: read.inspection.observationId, operationId: null });
  assert.equal(preview.ok, true, JSON.stringify(preview)); assert.equal(preview.preview.kind, 'component-repair');
  const input = { ...b, ticketId: preview.preview.ticketId }, done = await f.invoke(names[2], input);
  assert.equal(done.ok, true, JSON.stringify(done)); assert.equal(done.componentRepairChange.operation.result.committed, true);
  assert.equal(done.componentRepairChange.pending, false); assert.equal((await f.invoke(names[2], input)).ok, false);
  assert.equal(host.network.filter(r => r.path.endsWith('/confirmations')).length, 1);
  assert.equal(host.state.stageCalls, 1); assert.deepEqual(host.runtimeCalls, []);
  assert.equal(f.api.remote().session.session, null); assert.equal(f.api.supervisor().panel.clients.size, 0);
});

test('actual main discard preserves staged bytes and parent replacement rejects old preview identity', budget, async t => {
  const host = await hostFixture(t, { expectedQQ: QQ }), { f, row, b, ref } = await setup(t, host);
  const read = await f.invoke(names[0], ref), preview = await f.invoke(names[1], { ...ref, action: 'repair',
    observationId: read.inspection.observationId, operationId: null });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  const discarded = await f.invoke(names[3], ref); assert.equal(discarded.ok, true, JSON.stringify(discarded));
  assert.equal(discarded.discarded, true); assert.equal(host.adapter.ticket, null);
  assert(fs.existsSync(path.join(host.p.operationsRoot, preview.preview.operationId, 'staged-code')));
  const changed = await f.invoke('qqRemoteUpdate', { ...b, revision: row.revision, patch: { label: 'Synthetic renamed parent' } });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.equal((await f.invoke(names[2], { ...b, ticketId: preview.preview.ticketId })).ok, false);
  assert.equal(host.network.filter(r => r.path.endsWith('/confirmations')).length, 0); assert.deepEqual(host.runtimeCalls, []);
});
