'use strict';
// The command line a board dispatch would run, captured from an injected
// runner. No Claude process is started.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {BackgroundSessions, launchArgs, assertSafeLaunchArgs, PERMISSIONS, FORBIDDEN_FLAGS, FORBIDDEN_MODES} = require('../src/bot/background-sessions.cjs');
const {TaskBoard} = require('../src/bot/task-board.cjs');

// Quoted from `claude --help` of 2.1.318 (2026-11-13), plus the lifecycle words the probe looks for.
const HELP = `  --bg, --background                    Start the session in the background and
                                        return immediately. Prints the id that
                                        \`claude attach\`, \`logs\`, \`stop\` and \`rm\`
  --dangerously-skip-permissions        Bypass all permission checks.
  -n, --name <name>                     Set a display name for this session
  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "manual",
                                        "dontAsk", "plan")
  respawn <id>   stop <id>`;
const DENY = ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'bypassPermissions', 'dontAsk', '--permission-prompts', '--allowedTools', '--allowed-tools', '--add-dir', '--settings', '--bare'];
const SESSION = '1f0e2c9a-6d0b-4c11-9f39-2a77c1d4e8b5', LAUNCH = '00000000-0000-4000-8000-000000000001';

function setup(t, {help = HELP} = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-launch-')));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const calls = [], rows = [];
  const run = async (cli, args, opts) => {
    calls.push({cli, args, opts}); assert.equal(opts.shell, false);
    if (args[0] === '--version') return {stdout: '2.1.318 (Claude Code)'};
    if (args[0] === '--help') return {stdout: help};
    if (args[0] === '--bg') { rows.push({sessionId: SESSION, name: args[args.indexOf('--name') + 1], id: 'aabbccdd', cwd: opts.cwd, kind: 'background', state: 'working', status: 'busy'}); return {stdout: 'backgrounded · aabbccdd'}; }
    if (args[0] === 'agents') return {stdout: JSON.stringify(rows)};
    if (args[0] === 'stop') rows[0].state = 'stopped';
    return {stdout: ''};
  };
  const manager = new BackgroundSessions({root: path.join(home, 'task-board-sessions'), cli: process.execPath, run, enabled: true});
  const worktrees = {available: async () => ({available: true, version: '2.53.0'}), resolveRepo: async project => project,
    create: async ({taskId, project}) => { const worktree = path.join(home, 'task-worktrees', taskId); fs.mkdirSync(worktree, {recursive: true}); return {project, worktree, branch: `arcade/task-${taskId}`, baseCommit: 'b'.repeat(40)}; },
    snapshot: async () => ({head: 'b'.repeat(40), statusHash: 'a'.repeat(64), at: 1}), boundaryCheck: async () => ({}), remove: async () => ({removed: true})};
  const board = new TaskBoard({home, worktrees, sessions: async () => manager, newId: () => 'launch000001', newLaunchId: () => LAUNCH});
  const options = args => args.slice(0, args.includes('--') ? args.indexOf('--') : args.length);
  return {home, calls, rows, manager, board, options};
}

test('dispatch launches in the worktree with accept-edits and nothing that skips permissions', async t => {
  const h = setup(t), project = path.join(h.home, 'project'); fs.mkdirSync(project);
  // Even a title that spells a dangerous flag stays literal prompt text after "--".
  const {task} = await h.board.create({title: 'Fix --dangerously-skip-permissions docs', brief: 'bypassPermissions is mentioned in README; $(rm -rf x) && echo', project});
  const result = await h.board.dispatch(task.id);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.preauthorized, true);
  const launch = h.calls.find(call => call.args[0] === '--bg'), worktree = path.join(h.home, 'task-worktrees', 'launch000001');
  assert.deepEqual(launch.args.slice(0, 6), ['--bg', '--name', `arcade-${LAUNCH}`, '--permission-mode', 'acceptEdits', '--']);
  assert.equal(launch.args.length, 7); assert.equal(typeof launch.args[6], 'string'); assert(launch.args[6].includes('标题：Fix --dangerously-skip-permissions docs'));
  assert.equal(launch.opts.cwd, worktree); assert.notEqual(launch.opts.cwd, project); assert.equal(launch.opts.shell, false); assert.equal(launch.cli, process.execPath);
  assert.deepEqual([h.board.find(task.id).sessionId, h.board.find(task.id).jobId, h.board.find(task.id).launchId, h.board.find(task.id).preauthorized], [SESSION, 'aabbccdd', LAUNCH, true]);
  const stopped = await h.board.stop(task.id); assert.equal(stopped.ok, true);
  assert.deepEqual(h.calls.find(call => call.args[0] === 'stop').args, ['stop', 'aabbccdd']);
  // Deny-list over every command of the whole flow (probe, launch, list, stop).
  assert(h.calls.length >= 5);
  for (const call of h.calls) for (const value of h.options(call.args)) {
    for (const denied of DENY) assert(!value.toLowerCase().includes(denied.toLowerCase()), `${denied} in ${JSON.stringify(h.options(call.args))}`);
    assert.notEqual(value, 'auto');
  }
  for (const call of h.calls) if (call.args.includes('--permission-mode')) assert(['default', 'acceptEdits'].includes(call.args[call.args.indexOf('--permission-mode') + 1]));
  // The ledger holds identities only: no prompt, title or brief.
  assert.doesNotMatch(fs.readFileSync(h.manager.file, 'utf8'), /Fix|README|prompt|标题/);
  assert.equal(h.manager.snapshot().jobs.length, 0, 'a stopped task releases its ownership record');
});

test('pre-authorization is used only when the CLI itself lists the mode', async t => {
  for (const help of ['--background --name respawn stop', HELP.replace('"acceptEdits", ', ''), HELP.replace('--permission-mode <mode>', '--other <mode>')]) {
    const h = setup(t, {help}), project = path.join(h.home, 'project'); fs.mkdirSync(project);
    const capability = await h.board.capabilities();
    assert.deepEqual([capability.claude.available, capability.preauthorization.available, capability.preauthorization.reason], [true, false, 'accept_edits_mode_not_listed_by_cli']);
    const {task} = await h.board.create({title: 'plain', project}), result = await h.board.dispatch(task.id);
    assert.equal(result.ok, true); assert.equal(result.preauthorized, false);
    assert.deepEqual(h.calls.find(call => call.args[0] === '--bg').args.slice(3, 6), ['--permission-mode', 'default', '--']);
    assert.equal(h.manager.supportsPermission('acceptEdits'), false);
  }
  const h = setup(t); await h.manager.probe();
  assert.deepEqual(h.manager.permissionModes, ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan']);
  assert.equal(h.manager.supportsPermission('acceptEdits'), true);
  // Listed by the CLI is not enough: only the two offered modes can ever be asked for.
  for (const mode of ['bypassPermissions', 'dontAsk', 'auto', 'plan', 'manual']) assert.equal(h.manager.supportsPermission(mode), false, mode);
});

test('no caller can make this module build a permission-skipping launch', async t => {
  assert.deepEqual([...PERMISSIONS], ['default', 'acceptEdits']);
  for (const denied of DENY) assert(FORBIDDEN_FLAGS.includes(denied) || FORBIDDEN_MODES.includes(denied), denied);
  for (const permission of ['bypassPermissions', 'dontAsk', 'auto', 'plan', 'manual', '', 'ACCEPTEDITS', 'acceptEdits --dangerously-skip-permissions', undefined === 0, null, 7, ['acceptEdits']]) {
    assert.throws(() => launchArgs({launchId: LAUNCH, permission, prompt: ''}), /not offered/, String(permission));
    const h = setup(t);
    await assert.rejects(h.manager.create({cwd: h.home, permission, prompt: ''}), /not offered/);
    assert(!h.calls.some(call => call.args[0] === '--bg')); assert.equal(h.manager.snapshot().jobs.length, 0);
  }
  for (const args of [['--bg', '--dangerously-skip-permissions', '--', ''], ['--bg', '--allow-dangerously-skip-permissions'], ['--bg', '--permission-mode', 'bypassPermissions'], ['--bg', '--permission-mode=bypassPermissions'],
    ['--bg', '--permission-mode', 'dontAsk'], ['--bg', '--permission-mode', 'auto'], ['--bg', '--permission-mode', 'plan'], ['--bg', '--PERMISSION-MODE=BypassPermissions'], ['--bg', '--Dangerously-Skip-Permissions'],
    ['--bg', '--allowedTools', 'Bash'], ['--bg', '--allowed-tools=Bash'], ['--bg', '--add-dir', '/'], ['--bg', '--settings', '{}'], ['--bg', '--permission-prompts', 'none'], ['--bg', '--bare'], ['--bg', 7], 'string']) {
    assert.throws(() => assertSafeLaunchArgs(args), /refused|not offered|must be strings/, JSON.stringify(args));
  }
  // Text after "--" is the prompt and is never read as an option.
  assert.deepEqual(launchArgs({launchId: LAUNCH, permission: 'acceptEdits', prompt: '--dangerously-skip-permissions'}), ['--bg', '--name', `arcade-${LAUNCH}`, '--permission-mode', 'acceptEdits', '--', '--dangerously-skip-permissions']);
  assert.throws(() => launchArgs({launchId: 'x; --dangerously-skip-permissions', prompt: ''}), /launch tag/);
  assert.throws(() => launchArgs({launchId: LAUNCH, prompt: 'x'.repeat(8001)}), /8,000/);
});

test('existing callers are unchanged: default permission, own launch tag, workspace as the directory', async t => {
  const h = setup(t);
  await h.manager.create({workspace: h.home, prompt: 'hello'});
  const launch = h.calls.find(call => call.args[0] === '--bg');
  assert.deepEqual(launch.args.slice(-4), ['--permission-mode', 'default', '--', 'hello']); assert.equal(launch.opts.cwd, h.home);
  assert.match(launch.args[2], /^arcade-[a-f0-9-]{36}$/);
  await assert.rejects(h.manager.create({cwd: h.home, launchId: 'not-a-uuid'}), /fresh launch tag/);
  await assert.rejects(h.manager.create({cwd: h.home, launchId: h.manager.snapshot().jobs[0].launchId}), /fresh launch tag/);
  assert.equal(h.manager.release('00000000-0000-4000-8000-00000000ffff'), false);
  assert.equal(h.manager.release(h.manager.snapshot().jobs[0].launchId), true); assert.equal(h.manager.snapshot().jobs.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(h.manager.file, 'utf8')).jobs.length, 0);
  assert(!h.calls.some(call => ['stop', 'rm', 'respawn'].includes(call.args[0])), 'releasing a record never touches the session');
});
