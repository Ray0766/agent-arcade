'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {BackgroundSessions} = require('../src/bot/background-sessions.cjs');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-background-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const calls = [], rows = [];
  const run = async (cli, args, opts) => {
    calls.push({cli, args, opts});
    assert.equal(opts.shell, false); assert.equal(opts.timeout, args[0] === 'agents' ? 8000 : 15000);
    if (args[0] === '--version') return {stdout: '2.1.317 (Claude Code)'};
    if (args[0] === '--help') return {stdout: '--background --name respawn stop'};
    if (args[0] === '--bg') {
      const saved = JSON.parse(fs.readFileSync(path.join(root, 'background-sessions.json'), 'utf8'));
      assert.equal(`arcade-${saved.jobs[0].launchId}`, args[args.indexOf('--name') + 1]);
      rows.push({sessionId: '1f0e2c9a-6d0b-4c11-9f39-2a77c1d4e8b5', name: `arcade-${saved.jobs[0].launchId}`, id: 'aabbccdd', cwd: root, state: 'blocked', status: 'waiting', waitingFor: 'input needed'});
      return {stdout: 'backgrounded · aabbccdd'};
    }
    if (args[0] === 'agents') return {stdout: JSON.stringify(rows)};
    if (args[0] === 'stop') rows[0].state = 'stopped';
    if (args[0] === 'respawn') rows[0].state = 'blocked';
    return {stdout: ''};
  };
  return {root, calls, rows, run, manager: new BackgroundSessions({root, cli: process.execPath, run})};
}
test('background creation is opt-in, ownership persists before launch and commands use exact IDs', async t => {
  const {manager, root, calls} = setup(t);
  await assert.rejects(manager.create({workspace: root}), /Enable/); assert.equal(calls.length, 0);
  manager.setEnabled(true);
  await manager.create({workspace: root, prompt: 'Do not execute tools; literal $(private) --all'});
  const bg = calls.find(call => call.args[0] === '--bg');
  assert.deepEqual(bg.args.slice(-4), ['--permission-mode', 'default', '--', 'Do not execute tools; literal $(private) --all']);
  assert.doesNotMatch(fs.readFileSync(manager.file, 'utf8'), /private|prompt/);
  assert.equal(manager.snapshot().jobs[0].state, 'blocked');
  await assert.rejects(manager.stop('11223344'), /not created/);
  await assert.rejects(manager.stop('--all'), /exact owned/);
  await assert.rejects(manager.resume('aabbccdd'), /Stop the session/);
  await manager.stop('aabbccdd'); assert.equal(manager.snapshot().jobs[0].state, 'stopped');
  await manager.resume('aabbccdd'); assert.equal(manager.snapshot().jobs[0].state, 'blocked');
  assert(calls.some(call => JSON.stringify(call.args) === '["stop","aabbccdd"]'));
  assert(calls.some(call => JSON.stringify(call.args) === '["respawn","aabbccdd"]'));
  const restored = new BackgroundSessions({root, cli: process.execPath});
  assert.equal(restored.snapshot().jobs[0].id, 'aabbccdd'); assert.equal(restored.snapshot().jobs[0].state, 'unknown');
  assert.equal(restored.snapshot().enabled, false); assert.equal(restored.snapshot().channelsVerified, false);
});

test('uncertain launch stays recorded and cannot duplicate or adopt unrelated jobs', async t => {
  const {manager, root, run} = setup(t); manager.setEnabled(true);
  manager.run = async (cli, args, opts) => {
    if (args[0] === '--bg') throw Error('Sensitive command output');
    return run(cli, args, opts);
  };
  await assert.rejects(manager.create({workspace: root}), /not confirmed/);
  assert.equal(manager.snapshot().jobs.length, 1);
  assert.equal(manager.snapshot().jobs[0].request, 'creation-uncertain');
  await assert.rejects(manager.create({workspace: root}), /previous uncertain/);
  assert.equal(manager.snapshot().jobs.length, 1);
});

test('corrupt ledger and incompatible lifecycle are fail closed', async t => {
  const {root, manager} = setup(t);
  manager.run = async () => ({stdout: '2.1.100'}); manager.setEnabled(true);
  assert.equal((await manager.probe()).capability.available, false);
  await assert.rejects(manager.create({workspace: root}), /2.1.317/);
  fs.writeFileSync(manager.file, 'not JSON');
  const corrupt = new BackgroundSessions({root, cli: process.execPath, enabled: true});
  await assert.rejects(corrupt.stop('aabbccdd'), /ownership record/);
});

test('fresh identity is mandatory before stop and restart', async t => {
  const {manager, root, rows, calls} = setup(t); manager.setEnabled(true);
  await manager.create({workspace: root}); rows[0].sessionId = '11111111-1111-1111-1111-111111111111';
  const before = calls.filter(call => call.args[0] === 'stop').length;
  await assert.rejects(manager.stop('aabbccdd'), /identity/);
  assert.equal(calls.filter(call => call.args[0] === 'stop').length, before);
});

test('explicit workspace trust rejection clears the launch intent without approving trust', async t => {
  const {manager, root, run, calls} = setup(t); manager.setEnabled(true);
  manager.run = async (cli, args, opts) => {
    if (args[0] === '--bg') throw Object.assign(Error('CLI failed'), {stderr: 'Workspace not trusted. Run claude first.'});
    return run(cli, args, opts);
  };
  await assert.rejects(manager.create({workspace: root}), /not trusted/);
  assert.equal(manager.snapshot().jobs.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(manager.file, 'utf8')).jobs.length, 0);
  assert.equal(calls.some(call => call.args.includes('--dangerously-skip-permissions')), false);
});

test('a printed job ID without the exact random launch tag is never adopted', async t => {
  const {manager, root, run, rows} = setup(t); manager.setEnabled(true);
  manager.run = async (cli, args, opts) => {
    const result = await run(cli, args, opts);
    if (args[0] === '--bg') rows[0].name = 'some other user session';
    return result;
  };
  await assert.rejects(manager.create({workspace: root}), /matching owned/);
  assert.equal(manager.snapshot().jobs[0].sessionId, '');
  await assert.rejects(manager.stop('aabbccdd'), /identity/);
  await assert.rejects(manager.create({workspace: root}), /previous uncertain/);
});

test('a launch that never produced a session is dropped by a later refresh and no longer blocks create', async t => {
  const {manager, root, run} = setup(t); manager.setEnabled(true);
  let at = 1000000; manager.now = () => at; let fail = true;
  manager.run = async (cli, args, opts) => { if (args[0] === '--bg' && fail) throw Error('not logged in'); return run(cli, args, opts); };
  await assert.rejects(manager.create({workspace: root}), /not confirmed/);
  await manager.refresh(root); assert.equal(manager.snapshot().jobs.length, 1);
  at += 60001; await manager.refresh(root); assert.equal(manager.snapshot().jobs.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'background-sessions.json'), 'utf8')).jobs, []);
  fail = false; await manager.create({workspace: root}); assert.equal(manager.snapshot().jobs[0].id, 'aabbccdd');
});
