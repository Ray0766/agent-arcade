'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {ClaudeSessionMonitor, parseSessions, reconcileSessionEvidence} = require('../src/bot/claude-sessions.cjs');
const SESSION = '1f0e2c9a-6d0b-4c11-9f39-2a77c1d4e8b5';
const workspace = path.resolve('.');

test('session JSON strips names/prompts and limits scope, fields and unknown states', () => {
  const output = JSON.stringify([
    {sessionId: SESSION, status: 'idle', name: 'private prompt', transcript: 'secret'},
    {id: 'aabbccdd', kind: 'background', cwd: workspace, state: 'done', status: 'idle', startedAt: 100, pid: 55},
    {id: '11223344', cwd: path.resolve(workspace, '..'), state: 'working'},
    {id: 'deadbeef', state: 'future state', status: 'future status', waitingFor: 'private prompt'},
    {id: '--all', state: 'working'},
  ]);
  const rows = parseSessions(output, workspace);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].status, 'idle'); assert.equal(rows[0].kind, 'unknown');
  assert.equal(rows[1].state, 'done'); assert.equal(rows[1].outcome, 'unverified');
  assert.equal(rows[2].state, 'unknown'); assert.equal(rows[2].waitingFor, '');
  assert.doesNotMatch(JSON.stringify(rows), /private|secret|name|transcript/);
  assert.throws(() => parseSessions('{bad', workspace));
  assert.throws(() => parseSessions('{}', workspace));
  assert.throws(() => parseSessions(' '.repeat(1024 * 1024 + 1), workspace));
  assert.throws(() => parseSessions(JSON.stringify([{sessionId: SESSION}, {sessionId: SESSION}]), workspace));
  assert.throws(() => parseSessions(JSON.stringify([{sessionId: SESSION, id: 'aabbccdd'}, {sessionId: '11111111-1111-1111-1111-111111111111', id: 'aabbccdd'}]), workspace));
});

test('session monitor coalesces polling and sanitizes failure without a fake completion', async () => {
  let release, count = 0, clock = 1000;
  const monitor = new ClaudeSessionMonitor({cli: {cli: process.execPath}, now: () => clock,
    run: async (cli, args, options) => {
      count++; assert.equal(cli, process.execPath); assert.deepEqual(args, ['agents', '--json', '--all', '--cwd', fs.realpathSync(workspace)]);
      assert.equal(options.shell, false); assert.equal(options.windowsHide, true); assert.equal(options.timeout, 8000);
      return new Promise(resolve => { release = resolve; });
    }});
  const first = monitor.refresh(workspace), second = monitor.refresh(workspace);
  assert.equal(first, second); assert.equal(count, 1);
  release({stdout: JSON.stringify([{sessionId: SESSION, status: 'waiting', waitingFor: 'permission prompt'}])});
  await first; assert.equal(monitor.snapshot().available, true); assert.equal(monitor.snapshot().stale, false);
  clock += 31000; assert.equal(monitor.snapshot().stale, true);
  monitor.run = async () => { throw Error('PRIVATE SECRET stdout'); };
  const failed = await monitor.refresh(workspace);
  assert.equal(failed.available, false); assert.equal(failed.sessions[0].status, 'waiting');
  assert.doesNotMatch(failed.error, /PRIVATE|SECRET/);
});

test('reconciliation preserves hook truth and distinguishes missing, conflict and subagent scope', () => {
  const tasks = [{session: SESSION, agent: '', state: 'running'}, {session: SESSION, agent: 'child', state: 'running'}];
  const original = structuredClone(tasks);
  const snap = {available: true, checkedAt: 1000, observedSessionIds: [SESSION], sessions: [{sessionId: SESSION, state: 'done', status: 'idle'}]};
  const result = reconcileSessionEvidence(tasks, snap, 1001);
  assert.deepEqual(tasks, original); assert.equal(result[0].state, 'running');
  assert.equal(result[0].sessionEvidence.agreement, 'conflict');
  assert.equal(result[0].sessionEvidence.outcome, 'unverified');
  assert.equal(result[1].sessionEvidence.agreement, 'unavailable');
  assert.equal(reconcileSessionEvidence(tasks, {...snap, sessions: []}, 1001)[0].sessionEvidence.agreement, 'missing');
  const unrelated = reconcileSessionEvidence(tasks, {...snap, sessions: [], observedSessionIds: []}, 1001)[0];
  assert.equal(unrelated.sessionEvidence.agreement, 'unavailable');
  assert.equal(unrelated.sessionEvidence.reason, 'outside_observed_scope');
  assert.equal(reconcileSessionEvidence(tasks, snap, 40000)[0].sessionEvidence.agreement, 'stale');
  assert.equal(reconcileSessionEvidence([{session: SESSION, state: 'done'}], snap, 1001)[0].sessionEvidence.agreement, 'consistent');
});

test('executable and directory validation reject shell wrappers and invalid scope', () => {
  assert.throws(() => new ClaudeSessionMonitor({cli: 'claude'}));
  assert.throws(() => new ClaudeSessionMonitor({cli: path.join(os.tmpdir(), 'claude.cmd')}));
  const monitor = new ClaudeSessionMonitor({cli: process.execPath});
  assert.throws(() => monitor.refresh('relative'));
  assert.throws(() => monitor.refresh(__filename));
});
