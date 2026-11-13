'use strict';
// Real temporary git repositories under os.tmpdir() only. No Claude process,
// network or account is involved.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {TaskWorktrees, WorktreeError, defaultRun, parseNumstat, parseStatus} = require('../src/bot/task-worktree.cjs');

let gitAvailable = true;
try { execFileSync('git', ['--version'], {stdio: 'ignore', windowsHide: true}); } catch { gitAvailable = false; }
const skip = gitAvailable ? false : 'git is not installed on this machine';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Arcade Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {cwd, encoding: 'utf8', windowsHide: true});
const code = async promise => { try { await promise; } catch (error) { assert(error instanceof WorktreeError, String(error)); return error; } assert.fail('Expected a WorktreeError'); };

function setup(t, name = 'project') {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-worktree-')));
  t.after(() => fs.rmSync(base, {recursive: true, force: true, maxRetries: 5}));
  const project = path.join(base, name), home = path.join(base, 'home');
  fs.mkdirSync(project); fs.mkdirSync(home);
  git(project, 'init', '-q'); git(project, 'config', 'core.autocrlf', 'false'); fs.writeFileSync(path.join(project, 'a.txt'), 'one\n'); git(project, 'add', '.'); git(project, 'commit', '-q', '-m', 'first');
  const calls = [], run = (file, args, options) => { calls.push({file, args, options}); return defaultRun(file, args, options); };
  const source = () => ({head: git(project, 'rev-parse', 'HEAD').trim(), status: git(project, 'status', '--porcelain=v1'), file: fs.readFileSync(path.join(project, 'a.txt'), 'utf8'), branch: git(project, 'rev-parse', '--abbrev-ref', 'HEAD').trim()});
  return {base, project, home, calls, source, worktrees: new TaskWorktrees({home, run})};
}

test('create makes a branch and a worktree outside the project; a clean one is removed without force', {skip}, async t => {
  const {project, home, source, worktrees, calls} = setup(t), before = source();
  assert.deepEqual(Object.keys(await worktrees.available()), ['available', 'version']);
  const made = await worktrees.create({taskId: 'abc123def456', project});
  assert.equal(made.worktree, path.join(home, 'task-worktrees', 'abc123def456'));
  assert.equal(made.branch, 'arcade/task-abc123def456'); assert.equal(made.baseCommit, before.head);
  assert.equal(fs.readFileSync(path.join(made.worktree, 'a.txt'), 'utf8'), 'one\n');
  assert.match(git(project, 'branch', '--list', 'arcade/task-abc123def456'), /arcade\/task-abc123def456/);
  assert.deepEqual(source(), before);
  assert.equal((await code(worktrees.create({taskId: 'abc123def456', project}))).code, 'worktree_exists');
  const task = {id: 'abc123def456', ...made};
  assert.deepEqual(await worktrees.state(task), {exists: true, dirty: false, unmerged: 0});
  assert.deepEqual(await worktrees.remove(task), {removed: true, missing: false, branchKept: false, discarded: false});
  assert.equal(fs.existsSync(made.worktree), false); assert.equal(git(project, 'branch', '--list', 'arcade/task-abc123def456'), '');
  assert.deepEqual(source(), before);
  assert(!calls.some(call => call.args.includes('--force') || call.args.includes('-D') || call.args.includes('push') || call.args.includes('merge')));
  assert.deepEqual(await worktrees.remove(task), {removed: false, missing: true, branchKept: true, discarded: false});
});

test('removal refuses uncommitted or unmerged work unless the owner discards it', {skip}, async t => {
  const {project, source, worktrees} = setup(t), before = source();
  const dirty = {id: 'dirty00001', ...await worktrees.create({taskId: 'dirty00001', project})};
  fs.writeFileSync(path.join(dirty.worktree, 'new.txt'), 'unsaved');
  let error = await code(worktrees.remove(dirty));
  assert.equal(error.code, 'worktree_has_changes'); assert.deepEqual(error.details, {dirty: true, unmerged: 0});
  error = await code(worktrees.remove(dirty, {discard: 'yes'})); assert.equal(error.code, 'worktree_has_changes');
  assert.equal(fs.readFileSync(path.join(dirty.worktree, 'new.txt'), 'utf8'), 'unsaved');
  const committed = {id: 'commit0001', ...await worktrees.create({taskId: 'commit0001', project})};
  fs.writeFileSync(path.join(committed.worktree, 'a.txt'), 'two\n'); git(committed.worktree, 'commit', '-q', '-am', 'task work');
  error = await code(worktrees.remove(committed));
  assert.deepEqual([error.code, error.details], ['worktree_has_changes', {dirty: false, unmerged: 1}]);
  assert.match(git(project, 'branch', '--list', 'arcade/task-commit0001'), /commit0001/);
  assert.deepEqual(await worktrees.remove(dirty, {discard: true}), {removed: true, missing: false, branchKept: false, discarded: true});
  assert.deepEqual(await worktrees.remove(committed, {discard: true}), {removed: true, missing: false, branchKept: false, discarded: true});
  assert.equal(fs.existsSync(dirty.worktree), false); assert.equal(fs.existsSync(committed.worktree), false);
  // The owner's checkout never moved, whatever happened to the task worktrees.
  assert.deepEqual(source(), before);
});

test('work merged into another branch is not counted as unmerged', {skip}, async t => {
  const {project, worktrees} = setup(t);
  const task = {id: 'merged0001', ...await worktrees.create({taskId: 'merged0001', project})};
  fs.writeFileSync(path.join(task.worktree, 'b.txt'), 'kept\n'); git(task.worktree, 'add', '.'); git(task.worktree, 'commit', '-q', '-m', 'task work');
  git(project, 'merge', '-q', '--ff-only', task.branch); // The owner's own merge.
  assert.deepEqual(await worktrees.state(task), {exists: true, dirty: false, unmerged: 0});
  assert.equal((await worktrees.remove(task)).removed, true);
  assert.equal(fs.readFileSync(path.join(project, 'b.txt'), 'utf8'), 'kept\n');
});

test('every git call is an argv array; a path with shell metacharacters stays one argument', {skip}, async t => {
  const {project, calls, worktrees, base} = setup(t, 'proj & co;$(echo x)');
  const made = await worktrees.create({taskId: 'meta000001', project}), task = {id: 'meta000001', ...made};
  await worktrees.snapshot(made.project); await worktrees.diffSummary(task); await worktrees.boundaryCheck({...task, boundary: {base: await worktrees.snapshot(made.project)}}); await worktrees.remove(task);
  assert(calls.length > 8);
  for (const call of calls) {
    assert.equal(call.file, 'git'); assert(Array.isArray(call.args)); assert(call.args.every(value => typeof value === 'string'));
    assert(Number.isSafeInteger(call.options.timeoutMs) && call.options.timeoutMs <= 60000);
    // No argument is a composed command line: a path is either the whole argument or absent.
    for (const value of call.args) assert(!value.includes(project) || value === project, value);
    for (const value of call.args) assert(!/^git\s|&&|\|\||[\r\n]/.test(value), value);
    assert(call.options.cwd === undefined || path.isAbsolute(call.options.cwd));
  }
  assert.equal(fs.existsSync(path.join(base, 'x')), false);
  await assert.rejects(worktrees.git(['status', 'a\0b'], project), /invalid_arguments/);
});

test('diff summary reports committed and uncommitted work, bounded', {skip}, async t => {
  const {project, worktrees} = setup(t);
  const task = {id: 'diff000001', ...await worktrees.create({taskId: 'diff000001', project})};
  fs.writeFileSync(path.join(task.worktree, 'a.txt'), 'one\ntwo\nthree\n'); git(task.worktree, 'commit', '-q', '-am', 'more');
  fs.writeFileSync(path.join(task.worktree, 'scratch.txt'), 'x');
  const summary = await worktrees.diffSummary(task);
  assert.deepEqual(summary, {exists: true, commits: 1, committed: {files: [{path: 'a.txt', insertions: 2, deletions: 0, binary: false}], fileCount: 1, insertions: 2, deletions: 0, truncated: false},
    uncommitted: {files: [{status: '??', path: 'scratch.txt'}], fileCount: 1, truncated: false}});
  const many = parseNumstat(Array.from({length: 250}, (_, index) => `1\t0\tf${index}`).join('\n'));
  assert.deepEqual([many.files.length, many.fileCount, many.insertions, many.truncated], [200, 250, 250, true]);
  assert.deepEqual(parseStatus('R  new.txt\0old.txt\0 M a.txt\0').files, [{status: 'R ', path: 'new.txt'}, {status: ' M', path: 'a.txt'}]);
  assert.deepEqual(parseNumstat('-\t-\timage.png').files, [{path: 'image.png', insertions: 0, deletions: 0, binary: true}]);
});

test('boundary check sees a changed owner checkout, cannot attribute it, and lists stray task worktrees', {skip}, async t => {
  const {project, base, worktrees} = setup(t);
  const made = await worktrees.create({taskId: 'bound00001', project}), task = {id: 'bound00001', ...made, boundary: {base: await worktrees.snapshot(made.project)}};
  let result = await worktrees.boundaryCheck(task);
  assert.deepEqual([result.sourceRepoChanged, result.sourceHeadChanged, result.sourceStatusChanged, result.attribution, result.worktreeListChecked, result.outsidePaths], [false, false, false, 'unknown', true, []]);
  // Work inside the task worktree is not a boundary problem.
  fs.writeFileSync(path.join(made.worktree, 'a.txt'), 'task edit\n');
  assert.equal((await worktrees.boundaryCheck(task)).sourceRepoChanged, false);
  fs.writeFileSync(path.join(project, 'a.txt'), 'owner or anyone\n');
  result = await worktrees.boundaryCheck(task);
  assert.deepEqual([result.sourceRepoChanged, result.sourceHeadChanged, result.sourceStatusChanged, result.attribution], [true, false, true, 'unknown']);
  // A second edit to the same already-modified file is still seen.
  const again = {...task, boundary: {base: await worktrees.snapshot(made.project)}};
  fs.writeFileSync(path.join(project, 'a.txt'), 'owner or anyone\nand more\n');
  assert.equal((await worktrees.boundaryCheck(again)).sourceStatusChanged, true);
  git(project, 'commit', '-q', '-am', 'moved on');
  assert.equal((await worktrees.boundaryCheck(task)).sourceHeadChanged, true);
  const stray = path.join(base, 'elsewhere'); git(project, 'worktree', 'add', '-q', '-b', 'arcade/task-stray00001', stray);
  assert.deepEqual((await worktrees.boundaryCheck(task)).outsidePaths.map(value => value.toLowerCase()), [stray.toLowerCase()]);
  assert.equal((await worktrees.boundaryCheck({...task, boundary: null})).sourceRepoChanged, null);
});

test('invalid projects, identifiers and foreign paths are refused before any change', {skip}, async t => {
  const {project, base, home, worktrees} = setup(t), plain = path.join(base, 'plain'); fs.mkdirSync(plain);
  assert.equal((await code(worktrees.create({taskId: 'ok00000001', project: plain}))).code, 'not_a_git_repository');
  assert.equal((await code(worktrees.create({taskId: 'ok00000001', project: 'relative/path'}))).code, 'invalid_project');
  assert.equal((await code(worktrees.create({taskId: 'ok00000001', project: path.join(base, 'missing')}))).code, 'invalid_project');
  for (const taskId of ['../escape', 'UPPER00001', 'a', 'has space1', '']) assert.equal((await code(worktrees.create({taskId, project}))).code, 'invalid_task');
  const empty = path.join(base, 'empty'); fs.mkdirSync(empty); git(empty, 'init', '-q');
  assert.equal((await code(worktrees.create({taskId: 'ok00000001', project: empty}))).code, 'no_commits');
  // A record pointing anywhere but this module's own directory and branch is never acted on.
  assert.equal((await code(worktrees.remove({id: 'ok00000001', project, worktree: project, branch: 'arcade/task-ok00000001'}, {discard: true}))).code, 'worktree_mismatch');
  assert.equal((await code(worktrees.remove({id: 'ok00000001', project, worktree: path.join(home, 'task-worktrees', 'ok00000001'), branch: 'main'}, {discard: true}))).code, 'worktree_mismatch');
  assert.equal(fs.existsSync(path.join(home, 'task-worktrees', 'ok00000001')), false);
  const nested = new TaskWorktrees({home: path.join(project, 'inside')});
  assert.equal((await code(nested.create({taskId: 'ok00000001', project}))).code, 'worktrees_inside_project');
  // From a subdirectory, the repository root is used.
  const sub = path.join(project, 'sub'); fs.mkdirSync(sub);
  assert.equal((await worktrees.resolveRepo(sub)).toLowerCase(), project.toLowerCase());
  assert.throws(() => new TaskWorktrees({home: 'relative'}), /absolute/);
});

test('a missing git binary is reported as unavailable, not as a crash', async () => {
  const worktrees = new TaskWorktrees({home: path.join(os.tmpdir(), 'arcade-none'), run: async () => { throw Object.assign(Error('spawn git ENOENT'), {code: 'ENOENT'}); }});
  assert.deepEqual(await worktrees.available(), {available: false, version: ''});
  assert.equal((await code(worktrees.resolveRepo(os.tmpdir()))).code, 'git_unavailable');
});
