'use strict';
// Offline: injected clock, worktree and session fakes. No git, Claude process,
// network or account is involved.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {Bus} = require('../src/core/bus.cjs');
const {WorktreeError} = require('../src/bot/task-worktree.cjs');
const {TaskBoard, taskBoardHandlers, parseReport, reportFlags, claimsFixed, buildPrompt, mapObserved, CHECK_AFTER_MS, NOT_SANDBOX} = require('../src/bot/task-board.cjs');

const SESSION = '1f0e2c9a-6d0b-4c11-9f39-2a77c1d4e8b5', MINUTE = 60000, HASH = 'a'.repeat(64), HEAD = 'b'.repeat(40);
const REPORT = '背景：主人要求让导出按钮在窄窗口下可见。\n做了什么：把按钮移进工具栏第二行，跑了布局检查。\n要你做的：没有\n我加的：无';
function harness(t, options = {}) {
  const home = options.home || fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-board-'));
  if (!options.home) t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const clock = {now: options.now || 1800000000000}, events = [], calls = [], bus = new Bus(); let serial = 0;
  bus.subscribe(event => event.source === 'task-board', event => events.push(event));
  const worktrees = {
    available: async () => ({available: true, version: '2.53.0'}),
    resolveRepo: async project => { if (project.includes('plain')) throw new WorktreeError('not_a_git_repository'); return project; },
    create: async ({taskId, project}) => { const worktree = path.join(home, 'task-worktrees', taskId); fs.mkdirSync(worktree, {recursive: true}); calls.push(['worktree.create', taskId]); return {project, worktree, branch: `arcade/task-${taskId}`, baseCommit: HEAD}; },
    snapshot: async () => ({head: HEAD, statusHash: HASH, at: clock.now}),
    boundaryCheck: async () => ({checkedAt: clock.now, sourceRepoChanged: false, sourceHeadChanged: false, sourceStatusChanged: false, attribution: 'unknown', worktreeListChecked: true, outsidePaths: []}),
    diffSummary: async () => ({exists: true, commits: 0, committed: {files: [], fileCount: 0, insertions: 0, deletions: 0, truncated: false}, uncommitted: {files: [], fileCount: 0, truncated: false}}),
    remove: async (task, {discard}) => { calls.push(['worktree.remove', task.id, discard]); if (worktrees.dirty && !discard) throw new WorktreeError('worktree_has_changes', {dirty: true, unmerged: 0}); return {removed: true, missing: false, branchKept: false, discarded: !!worktrees.dirty}; },
  };
  const manager = {capability: {checked: true, available: true, version: '2.1.318', error: ''}, jobs: [], accept: true, fail: '', listed: {state: 'working', status: 'busy'},
    probe: async () => {}, supportsPermission: mode => manager.accept && mode === 'acceptEdits', snapshot: () => ({jobs: structuredClone(manager.jobs)}),
    create: async value => { calls.push(['create', value]);
      if (manager.fail === 'untrusted') throw Error('Workspace is not trusted. Open it in the original Claude Code terminal to review trust first.');
      if (manager.fail === 'uncertain') { manager.jobs.push({launchId: value.launchId, id: '', sessionId: ''}); throw Error('Background launch was not confirmed.'); }
      manager.jobs.push({launchId: value.launchId, id: 'aabbccdd', sessionId: SESSION, ...manager.listed}); return manager.snapshot(); },
    refresh: async () => { calls.push(['refresh']); return manager.snapshot(); },
    stop: async id => { calls.push(['stop', id]); const job = manager.jobs.find(item => item.id === id); if (manager.fail === 'stop') throw Error('not confirmed'); job.state = manager.fail === 'still' ? 'working' : 'stopped'; return manager.snapshot(); },
    release: launchId => { calls.push(['release', launchId]); manager.jobs = manager.jobs.filter(job => job.launchId !== launchId); return true; }};
  const store = new Map();
  const make = () => new TaskBoard({home, bus, now: () => clock.now, worktrees, sessions: async () => manager, observe: options.poll ? id => store.get(id) : null, deliver: options.deliver || null,
    newId: () => `task${String(++serial).padStart(6, '0')}`, newLaunchId: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`});
  const board = make();
  const seen = (state, extra = {}) => ({task: {session: SESSION, agent: '', state, reason: extra.reason || '', updatedAt: extra.at ?? clock.now, result: extra.result || ''}});
  const dispatched = async (title = 'Fix the export button') => { const {task} = await board.create({title, brief: 'Narrow windows hide it.', project: path.join(home, 'project')}); const result = await board.dispatch(task.id); assert.equal(result.ok, true, JSON.stringify(result)); return task.id; };
  const state = id => board.find(id).state;
  return {home, clock, events, calls, bus, worktrees, manager, store, board, make, seen, dispatched, state};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('create and update validate bounded fields; only a draft can be edited; at most 20 unfinished', async t => {
  const h = harness(t), project = path.join(h.home, 'project');
  for (const bad of [{title: '', project}, {title: 'x'.repeat(81), project}, {title: 7, project}, {title: '\n\t ', project}]) assert.deepEqual(await h.board.create(bad), {ok: false, code: 'invalid_title'});
  assert.deepEqual(await h.board.create({title: 'ok', brief: 'x'.repeat(2001), project}), {ok: false, code: 'invalid_brief'});
  assert.deepEqual(await h.board.create({title: 'ok', project: path.join(h.home, 'plain')}), {ok: false, code: 'not_a_git_repository'});
  const made = await h.board.create({title: '  Line\nbreaks removed  ', brief: 'Keep\nlines', project});
  assert.equal(made.ok, true); assert.equal(made.task.title, 'Line breaks removed'); assert.equal(made.task.brief, 'Keep\nlines'); assert.equal(made.task.state, 'draft'); assert.equal(made.task.outcome, 'unverified');
  assert.equal(h.board.update({id: made.task.id, title: 'Renamed'}).task.title, 'Renamed'); assert.equal(h.board.find(made.task.id).brief, 'Keep\nlines');
  assert.deepEqual(h.board.update({id: made.task.id, title: ''}), {ok: false, code: 'invalid_title'});
  assert.deepEqual(h.board.update({id: 'nope000000'}), {ok: false, code: 'unknown_task'});
  await h.board.dispatch(made.task.id);
  assert.deepEqual(h.board.update({id: made.task.id, title: 'Late'}), {ok: false, code: 'not_draft'});
  for (let index = 1; index < 20; index++) assert.equal((await h.board.create({title: `t${index}`, project})).ok, true);
  assert.deepEqual(await h.board.create({title: 'one too many', project}), {ok: false, code: 'too_many_unfinished'});
  assert.equal(h.board.summary().counts.unfinished, 20);
  const saved = JSON.parse(fs.readFileSync(h.board.file, 'utf8')); assert.equal(saved.version, 1); assert.equal(saved.tasks.length, 20);
});

test('observer states map to board states; Stop and SessionEnd never mean verified', async t => {
  assert.deepEqual(mapObserved('running'), {state: 'running', reason: ''});
  assert.deepEqual(mapObserved('waiting', 'permission'), {state: 'needs_input', reason: 'waiting_permission'});
  assert.deepEqual(mapObserved('waiting', '<script>'), {state: 'needs_input', reason: 'waiting_input'});
  assert.deepEqual(mapObserved('error', 'tool_error'), {state: 'needs_input', reason: 'error_tool_error'});
  assert.deepEqual(mapObserved('done'), {state: 'reported', reason: 'reply_ended'});
  assert.deepEqual(mapObserved('ended'), {state: 'reported', reason: 'session_ended'});
  assert.deepEqual(mapObserved('unknown'), {state: 'unknown', reason: 'observer_unknown'});
  assert.equal(mapObserved('idle'), null); assert.equal(mapObserved('verified'), null);
  // Full table: every live board state against every observer state.
  const expected = {running: 'running', waiting: 'needs_input', error: 'needs_input', done: 'reported', ended: 'reported', unknown: 'unknown'};
  for (const from of ['dispatched', 'running', 'rework', 'needs_input', 'reported', 'stalled', 'unknown']) for (const observed of ['idle', 'running', 'waiting', 'error', 'done', 'ended', 'unknown']) {
    const h = harness(t), id = await h.dispatched(), task = h.board.find(id);
    task.state = from; h.clock.now += 1000; h.board.observe(h.seen(observed));
    assert.equal(task.state, observed === 'idle' ? from : expected[observed], `${from} + ${observed}`);
    assert.notEqual(task.state, 'verified');
  }
  for (const from of ['draft', 'verified', 'stopped']) for (const observed of ['running', 'waiting', 'error', 'done', 'ended', 'unknown']) {
    const h = harness(t), id = await h.dispatched(), task = h.board.find(id);
    task.state = from; h.clock.now += 1000; assert.equal(h.board.observe(h.seen(observed)), false); assert.equal(task.state, from, `${from} + ${observed}`);
  }
});

test('duplicate and out-of-order events never regress a state', async t => {
  const h = harness(t), id = await h.dispatched(), start = h.clock.now;
  assert.equal(h.board.observe(h.seen('done', {at: start - 1})), false); assert.equal(h.state(id), 'dispatched'); // Before this dispatch.
  assert.equal(h.board.observe({task: {...h.seen('done').task, session: '9'.repeat(8) + SESSION.slice(8)}}), false); // Another session.
  h.board.observe(h.seen('running', {at: start + 1000})); assert.equal(h.state(id), 'running');
  h.board.observe(h.seen('waiting', {at: start + 3000, reason: 'permission'})); assert.equal(h.state(id), 'needs_input');
  h.board.observe(h.seen('running', {at: start + 2000})); assert.equal(h.state(id), 'needs_input', 'older running must not clear a newer wait');
  h.board.observe(h.seen('running', {at: start + 4000}));
  h.board.observe(h.seen('done', {at: start + 5000, result: REPORT})); assert.equal(h.state(id), 'reported');
  const reported = h.events.filter(event => event.kind === 'task.reported').length; assert.equal(reported, 1);
  for (const replay of [h.seen('done', {at: start + 5000, result: REPORT}), h.seen('running', {at: start + 4000}), h.seen('running', {at: start + 5000}), h.seen('waiting', {at: start + 3000}), h.seen('unknown', {at: start + 4500}), h.seen('error', {at: start + 100})]) {
    h.board.observe(replay); h.board.observe(replay);
    assert.equal(h.state(id), 'reported'); assert.equal(h.board.find(id).reportStatus, 'parsed');
  }
  assert.equal(h.events.filter(event => event.kind === 'task.reported').length, reported, 'a replay raises no second notification');
  // A subagent's events are progress only.
  h.board.observe({task: {...h.seen('running', {at: start + 6000}).task, agent: 'agent-1'}}); assert.equal(h.state(id), 'reported'); assert.equal(h.board.find(id).progressAt, start + 6000);
  // The session closing after its hand-back keeps the hand-back.
  h.board.observe(h.seen('ended', {at: start + 7000})); assert.equal(h.state(id), 'reported'); assert.equal(h.board.find(id).report.todo, '没有');
  h.clock.now = start + 8000; assert.equal(h.board.accept({id}).ok, true);
  for (const late of ['running', 'waiting', 'error', 'done', 'unknown']) { h.board.observe(h.seen(late, {at: start + 9000})); assert.equal(h.state(id), 'verified'); }
});

test('after a rework, a late hand-back from the earlier round is ignored', async t => {
  const h = harness(t), id = await h.dispatched(), start = h.clock.now;
  h.board.observe(h.seen('done', {at: start + 1000})); h.clock.now = start + 5000;
  assert.equal((await h.board.rework({id, why: 'Did not read the existing layout code'})).ok, true);
  h.board.observe(h.seen('done', {at: start + 1000})); h.board.observe(h.seen('done', {at: start + 4999}));
  assert.equal(h.state(id), 'needs_input'); assert.equal(h.board.find(id).reason, 'rework_not_delivered');
  h.board.observe(h.seen('running', {at: start + 6000})); assert.equal(h.state(id), 'running');
  h.board.observe(h.seen('done', {at: start + 7000})); assert.equal(h.state(id), 'reported');
});

test('restart: unfinished work becomes unknown until fresh evidence matches its session', async t => {
  const h = harness(t, {poll: true}), a = await h.dispatched('running one'), start = h.clock.now;
  h.board.observe(h.seen('running', {at: start + 1000}));
  const waiting = (await h.board.create({title: 'waiting one', project: path.join(h.home, 'project')})).task.id;
  Object.assign(h.board.find(waiting), {state: 'needs_input', reason: 'waiting_permission', sessionId: SESSION.replace(/^1/, '2')});
  const handed = (await h.board.create({title: 'handed back', project: path.join(h.home, 'project')})).task.id; Object.assign(h.board.find(handed), {state: 'reported', reason: 'reply_ended'});
  const paused = (await h.board.create({title: 'set aside', project: path.join(h.home, 'project')})).task.id; Object.assign(h.board.find(paused), {state: 'paused', pausedFrom: 'running'});
  h.board.save();
  const next = h.make();
  assert.deepEqual([next.find(a).state, next.find(a).reason, next.find(a).checkDueAt], ['unknown', 'restart_unmatched', null]);
  assert.equal(next.find(waiting).state, 'needs_input'); assert.equal(next.find(handed).state, 'reported');
  assert.deepEqual([next.find(paused).state, next.find(paused).pausedFrom], ['paused', 'unknown']);
  // The hook store still holds last run's "running": that is not fresh evidence.
  h.store.set(SESSION, {session: SESSION, agent: '', state: 'running', reason: 'working', updatedAt: start + 1000, result: ''});
  next.sessions = null; next.tick(); next.tick(); assert.equal(next.find(a).state, 'unknown');
  h.store.set(SESSION, {session: SESSION, agent: '', state: 'running', reason: 'working', updatedAt: start + 2000, result: ''});
  next.tick(); assert.equal(next.find(a).state, 'running'); assert.equal(next.find(a).checkDueAt, h.clock.now + CHECK_AFTER_MS);
  assert.equal(next.summary().columns.stalled.some(task => task.id === paused), true);
});

test('restart: an unknown entry is recovered from the session list without counting it as progress', async t => {
  const h = harness(t), id = await h.dispatched(); h.board.save();
  const next = h.make(); assert.equal(next.find(id).state, 'unknown');
  h.manager.jobs[0].state = 'blocked'; h.manager.jobs[0].status = 'waiting';
  next.tick(); await next.queue; await settle();
  assert.deepEqual([next.find(id).state, next.find(id).reason, next.find(id).progressAt], ['needs_input', 'session_waiting', null]);
  next.tick(); await next.queue; assert.equal(h.calls.filter(call => call[0] === 'refresh').length, 1, 'no further list query once recovered');
});

test('watch: renew on progress, two silent renewals, then stalled; nothing is stopped or reset', async t => {
  const h = harness(t), id = await h.dispatched(), start = h.clock.now, task = h.board.find(id);
  assert.equal(task.checkDueAt, start + CHECK_AFTER_MS);
  h.board.observe(h.seen('running', {at: start + 1000}));
  h.clock.now = start + 10 * MINUTE - 1; h.board.tick(); assert.deepEqual([task.state, task.renewals], ['running', 0]);
  // Progress in the window: renewed, and the silent budget stays untouched, indefinitely.
  for (let window = 1; window <= 6; window++) {
    h.board.observe(h.seen('running', {at: h.clock.now + 1000})); h.clock.now = task.checkDueAt; h.board.tick();
    assert.deepEqual([task.state, task.renewals, task.checkDueAt], ['running', 0, h.clock.now + CHECK_AFTER_MS], `window ${window}`);
  }
  // Still "running" but silent: two renewals at most.
  for (const renewals of [1, 2]) { h.clock.now = task.checkDueAt; h.board.tick(); assert.deepEqual([task.state, task.renewals], ['running', renewals]); }
  h.clock.now = task.checkDueAt; h.board.tick();
  assert.deepEqual([task.state, task.reason, task.checkDueAt], ['stalled', 'no_progress', null]);
  assert.deepEqual(h.events.map(event => event.kind), ['task.stalled']);
  h.clock.now += 60 * MINUTE; h.board.tick(); h.board.tick(); assert.equal(h.events.length, 1);
  assert(!h.calls.some(call => ['stop', 'release', 'worktree.remove'].includes(call[0])), 'a stalled task only raises an event');
  assert.equal(task.sessionId, SESSION); assert.equal(h.board.summary().columns.stalled[0].id, id);
  // New evidence brings it back with a fresh budget.
  h.board.observe(h.seen('running', {at: h.clock.now + 1})); assert.deepEqual([task.state, task.renewals, task.checkDueAt], ['running', 0, h.clock.now + CHECK_AFTER_MS]);
  // Progress resets a partly used silent budget.
  h.clock.now = task.checkDueAt; h.board.tick(); assert.equal(task.renewals, 0);
  h.clock.now = task.checkDueAt; h.board.tick(); assert.equal(task.renewals, 1);
  h.board.observe(h.seen('running', {at: h.clock.now + 5})); h.clock.now = task.checkDueAt; h.board.tick(); assert.equal(task.renewals, 0);
  // Waiting on the owner is not watched at all.
  h.board.observe(h.seen('waiting', {at: h.clock.now + 1, reason: 'question'})); assert.equal(task.checkDueAt, null);
  h.clock.now += 24 * 60 * MINUTE; h.board.tick(); assert.equal(task.state, 'needs_input');
});

test('a hand-back is never verified by time, evidence or the board itself; only accept does it', async t => {
  const h = harness(t, {poll: true}), id = await h.dispatched(), start = h.clock.now;
  assert.deepEqual(h.board.accept({id}), {ok: false, code: 'bad_state'});
  h.board.observe(h.seen('done', {at: start + 1000, result: REPORT})); h.board.observe(h.seen('ended', {at: start + 2000}));
  h.store.set(SESSION, {session: SESSION, agent: '', state: 'ended', reason: 'session_ended', updatedAt: start + 2000, result: ''});
  for (let hour = 0; hour < 72; hour++) { h.clock.now += 60 * MINUTE; h.board.tick(); }
  await settle();
  assert.equal(h.state(id), 'reported'); assert.equal(h.board.summary().columns.waiting[0].outcome, 'unverified');
  assert.equal(h.board.find(id).boundary.last.attribution, 'unknown');
  assert.deepEqual(h.board.accept({id, note: 'x'.repeat(201)}), {ok: false, code: 'invalid_note'});
  const accepted = h.board.accept({id, note: 'Checked the toolbar at 900px'});
  assert.deepEqual([accepted.task.state, accepted.task.outcome, accepted.task.acceptNote], ['verified', 'verified_by_owner', 'Checked the toolbar at 900px']);
  assert.deepEqual(h.board.accept({id}), {ok: false, code: 'bad_state'});
  assert.equal(h.board.summary().columns.finishedToday[0].id, id);
  await h.board.queue; assert(h.calls.some(call => call[0] === 'release'));
});

test('rework requires a reason, is counted, and is delivered only when a channel exists', async t => {
  const h = harness(t), id = await h.dispatched(), start = h.clock.now;
  assert.deepEqual(await h.board.rework({id, why: 'too early'}), {ok: false, code: 'bad_state'});
  h.board.observe(h.seen('done', {at: start + 1000}));
  for (const why of [undefined, '', '   ', 42, '\n']) assert.deepEqual(await h.board.rework({id, why}), {ok: false, code: 'reason_required'});
  assert.deepEqual(await h.board.rework({id, why: 'x'.repeat(201)}), {ok: false, code: 'reason_too_long'});
  assert.equal(h.state(id), 'reported'); assert.equal(h.board.find(id).rework, 0);
  h.clock.now = start + 2000;
  const sent = await h.board.rework({id, why: 'Did not run the layout check'});
  assert.deepEqual([sent.ok, sent.delivered, sent.task.state, sent.task.reason, sent.task.rework, sent.task.reworkWhy], [true, false, 'needs_input', 'rework_not_delivered', 1, 'Did not run the layout check']);
  h.board.observe(h.seen('done', {at: start + 3000})); h.clock.now = start + 4000; await h.board.rework({id, why: 'Did not run the layout check'});
  h.board.observe(h.seen('done', {at: start + 5000})); h.clock.now = start + 6000; await h.board.rework({id, why: 'Scope grew'});
  assert.deepEqual(h.board.summary().rework, {days: 14, count: 3, reasons: [{why: 'Did not run the layout check', count: 2}, {why: 'Scope grew', count: 1}]});
  h.clock.now += 15 * 24 * 60 * MINUTE; assert.deepEqual(h.board.summary().rework, {days: 14, count: 0, reasons: []});
  const delivered = [], d = harness(t, {deliver: async value => { delivered.push(value); return true; }}), other = await d.dispatched();
  d.board.observe(d.seen('done', {at: d.clock.now + 1000})); d.clock.now += 2000;
  const result = await d.board.rework({id: other, why: 'Wrong file'});
  assert.deepEqual([result.delivered, result.task.state, result.task.reason, result.task.checkDueAt], [true, 'running', 'rework_sent', d.clock.now + CHECK_AFTER_MS]);
  assert.equal(delivered[0].why, 'Wrong file'); assert.equal(delivered[0].task.sessionId, SESSION);
});

test('finished entries are capped at 200 and 30 days; an entry with a worktree on disk outlives the age rule', async t => {
  const h = harness(t), project = path.join(h.home, 'project'), now = h.clock.now, day = 24 * 60 * MINUTE;
  const row = (index, extra) => ({id: `done${String(index).padStart(6, '0')}`, title: `t${index}`, brief: '', project, state: 'verified', createdAt: now - 40 * day, updatedAt: now - index * 1000, finishedAt: now - index * 1000, ...extra});
  fs.writeFileSync(h.board.file, JSON.stringify({version: 1, tasks: [...Array.from({length: 230}, (_, index) => row(index)), row(900, {finishedAt: now - 31 * day, updatedAt: now - 31 * day}),
    row(901, {finishedAt: now - 31 * day, updatedAt: now - 31 * day, worktree: path.join(h.home, 'task-worktrees', 'done000901')})]}));
  const board = h.make(); board.save();
  const kept = JSON.parse(fs.readFileSync(board.file, 'utf8')).tasks.map(task => task.id);
  assert.equal(kept.length, 200); assert(kept.includes('done000000')); assert(!kept.includes('done000229')); assert(!kept.includes('done000900'));
  const aged = harness(t); fs.writeFileSync(aged.board.file, JSON.stringify({version: 1, tasks: [row(900, {finishedAt: now - 31 * day}), row(901, {finishedAt: now - 31 * day, worktree: path.join(aged.home, 'task-worktrees', 'done000901')}), row(1)]}));
  const next = aged.make(); next.clock = null; next.save();
  assert.deepEqual(next.tasks.map(task => task.id).sort(), ['done000001', 'done000901']);
  assert.equal(next.summary().columns.finishedToday.length <= 30, true);
});

test('a corrupt, oversized or partly invalid board file never throws on load', async t => {
  for (const content of ['{not json', '[]', '{"version":2,"tasks":[]}', '{"version":1,"tasks":{}}', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    const h = harness(t); fs.writeFileSync(h.board.file, content);
    const board = h.make();
    assert.deepEqual(board.tasks, []); assert.match(board.problem, /could not be read/); assert.match(board.summary().problem, /worktrees were left untouched/);
    assert.equal(fs.readdirSync(h.home).some(name => name.startsWith('task-board.json.unreadable-')), true, 'the unreadable file is kept, not overwritten');
    assert.equal((await board.create({title: 'still usable', project: path.join(h.home, 'project')})).ok, true);
  }
  const h = harness(t), project = path.join(h.home, 'project');
  fs.writeFileSync(h.board.file, JSON.stringify({version: 1, tasks: [null, {id: '../x', title: 'bad id', project, state: 'draft', createdAt: 1}, {id: 'good000001', title: 'kept', project, state: 'draft', createdAt: 5, reason: '<b>', claimFlags: ['unformatted', 'made_up'], report: {background: 'only one part'}, sessionId: 'not-a-uuid', worktree: 'relative'},
    {id: 'good000001', title: 'duplicate id', project, state: 'draft', createdAt: 5}, {id: 'good000002', title: 'bad state', project, state: 'verified!', createdAt: 5}, {id: 'good000003', title: 'relative', project: 'rel', state: 'draft', createdAt: 5}]}));
  const board = h.make(), kept = board.find('good000001');
  assert.equal(board.tasks.length, 1); assert.match(board.problem, /5 unreadable entries were skipped/);
  assert.deepEqual([kept.reason, kept.claimFlags, kept.report, kept.sessionId, kept.worktree], ['', ['unformatted'], null, '', '']);
});

test('hand-back parsing: four labelled parts in order, or the raw text flagged as unformatted', () => {
  assert.deepEqual(parseReport(REPORT), {background: '主人要求让导出按钮在窄窗口下可见。', done: '把按钮移进工具栏第二行，跑了布局检查。', todo: '没有', added: '无'});
  assert.deepEqual(parseReport('Some preamble.\n\n**Background:** The owner asked for a visible export button.\n- What was done: moved it\n  and ran the layout check.\n> Owner to do: nothing\n## Added by me: a tooltip\n\n| Entry | Went through the fix | Check result |\n|---|---|---|\n| toolbar | yes | visible at 900px |\ntrailing notes'),
    {background: 'The owner asked for a visible export button.', done: 'moved it\n  and ran the layout check.', todo: 'nothing', added: 'a tooltip'});
  assert.equal(parseReport('背景：a\n做了什么：b\n要你定的：c\n我加的：d').todo, 'c');
  for (const bad of ['', '   ', 'All done, everything works.', '背景：a\n做了什么：b\n要你做的：c', '做了什么：b\n背景：a\n要你做的：c\n我加的：d', '背景：a\n做了什么：\n要你做的：c\n我加的：d', '背景 a\n做了什么 b\n要你做的 c\n我加的 d', null, 42]) assert.equal(parseReport(bad), null, String(bad));
  assert.equal(parseReport(`背景：${'长'.repeat(5000)}\n做了什么：b\n要你做的：c\n我加的：d`).background.length, 1000);
});

test('reply text is optional: none, parsed and unformatted are distinct ordinary states', async t => {
  const h = harness(t), id = await h.dispatched(), start = h.clock.now, task = h.board.find(id);
  h.board.observe(h.seen('done', {at: start + 1000}));
  assert.deepEqual([task.state, task.reportStatus, task.report, task.reportRaw, task.claimFlags], ['reported', 'no_reply_text', null, null, []]);
  h.board.observe(h.seen('running', {at: start + 2000})); h.board.observe(h.seen('done', {at: start + 3000, result: `修好了，按钮现在能看到。${'啊'.repeat(5000)}`}));
  assert.equal(task.reportStatus, 'unformatted'); assert.equal(task.report, null); assert.equal(task.reportRaw.length, 4000);
  assert.deepEqual(task.claimFlags, ['unformatted', 'claims_fixed_without_check_table', 'bugfix_without_check_table']);
  h.board.observe(h.seen('running', {at: start + 4000})); h.board.observe(h.seen('done', {at: start + 5000, result: `${REPORT}\n\n| 入口 | 是否经过修复 | 核对结果 |\n|---|---|---|\n| 工具栏 | 是 | 900px 可见 |`}));
  assert.deepEqual([task.reportStatus, task.reportRaw, task.claimFlags, task.report.added], ['parsed', null, [], '无']);
  // The board columns never carry the raw reply; the detail view does.
  h.board.observe(h.seen('running', {at: start + 6000})); h.board.observe(h.seen('done', {at: start + 7000, result: 'free text'}));
  assert.equal(h.board.summary().columns.waiting[0].reportRaw, null); assert.equal((await h.board.diff(id)).task.reportRaw, 'free text');
});

test('claim flags are passive and distinguish a claim from a mention, a plan or a negation', () => {
  for (const text of ['已修复，导出按钮恢复。', '这个问题修好了', '两处都修完，推上去了', 'I fixed the export button.', 'The bug is now fixed.', 'Both paths have been fixed and the fix is in.']) assert.equal(claimsFixed(text), true, text);
  for (const text of ['还没修好，卡在布局。', '等修完再跑检查', '修好以后再发版', '主人说「已修复」那次其实没有', '要等上游修完才行', 'It is not fixed yet.', 'Once it is fixed I will rerun the check.', 'The word `is fixed` appears in the log.', '改了布局，等你确认。', '']) assert.equal(claimsFixed(text), false, text);
  const table = '| 入口 | 是否经过修复 | 核对结果 |\n| 工具栏 | 是 | 通过 |';
  assert.deepEqual(reportFlags('已修复', {parsed: false, bugfix: true}), ['unformatted', 'claims_fixed_without_check_table', 'bugfix_without_check_table']);
  assert.deepEqual(reportFlags(`已修复\n${table}`, {parsed: true, bugfix: true}), []);
  assert.deepEqual(reportFlags('| Entry point | Went through the fix | Check result |\nI fixed the crash.', {parsed: true, bugfix: true}), []);
  assert.deepEqual(reportFlags('重排了工具栏', {parsed: true, bugfix: false}), []);
  assert.deepEqual(reportFlags('重排了工具栏', {parsed: true, bugfix: true}), ['bugfix_without_check_table']);
});

test('bus events carry the task title and fixed labels only', async t => {
  const h = harness(t), secretBrief = 'PRIVATE_BRIEF_TEXT', secretReply = 'PRIVATE_REPLY_TEXT 已修复';
  const {task} = await h.board.create({title: 'Fix the export button', brief: secretBrief, project: path.join(h.home, 'project')}); await h.board.dispatch(task.id);
  const start = h.clock.now;
  h.board.observe(h.seen('waiting', {at: start + 1000, reason: 'permission'})); h.board.observe(h.seen('waiting', {at: start + 1500, reason: 'permission'}));
  h.board.observe(h.seen('running', {at: start + 2000})); h.board.observe(h.seen('error', {at: start + 3000, reason: 'tool_error'}));
  h.board.observe(h.seen('running', {at: start + 4000})); h.clock.now = start + 5000; h.board.observe(h.seen('done', {at: start + 5000, result: secretReply}));
  assert.deepEqual(h.events.map(event => event.kind), ['task.needs_input', 'task.needs_input', 'task.reported']);
  for (const event of h.events) {
    assert.deepEqual(Object.keys(event).sort(), ['at', 'id', 'importance', 'kind', 'notify', 'source', 'sourceName', 'subject', 'title']);
    assert.deepEqual([event.source, event.title, event.subject, event.notify], ['task-board', 'Fix the export button', task.id, 'desktop']);
    assert(['任务看板 · 等你处理', '任务看板 · 已交回，等你验收'].includes(event.sourceName));
    assert.doesNotMatch(JSON.stringify(event), /PRIVATE|已修复|Narrow|worktree|[A-Za-z]:\\\\/);
  }
  assert.deepEqual(h.bus.recent(5).map(event => event.title), ['Fix the export button', 'Fix the export button', 'Fix the export button']);
  const english = new TaskBoard({home: h.home, bus: h.bus, now: () => h.clock.now, worktrees: h.worktrees, sessions: async () => h.manager, language: () => 'en'});
  english.notify('task.stalled', english.find(task.id)); assert.equal(h.events.at(-1).sourceName, 'Task board · no progress');
});

test('dispatch: durable intent first, worktree as the working directory, refusals leave a retryable draft', async t => {
  const h = harness(t), id = await h.dispatched(), launch = h.calls.find(call => call[0] === 'create')[1], task = h.board.find(id);
  assert.deepEqual(Object.keys(launch).sort(), ['cwd', 'launchId', 'permission', 'prompt']);
  assert.equal(launch.cwd, path.join(h.home, 'task-worktrees', id)); assert.equal(launch.permission, 'acceptEdits'); assert.equal(launch.launchId, task.launchId);
  assert.deepEqual([task.state, task.sessionId, task.jobId, task.preauthorized, task.boundary.base.head], ['dispatched', SESSION, 'aabbccdd', true, HEAD]);
  assert.deepEqual(await h.board.dispatch(id), {ok: false, code: 'bad_state'});
  assert.deepEqual(await h.board.dispatch('nope000000'), {ok: false, code: 'unknown_task'});
  // Pre-authorization unavailable: the same launch with ordinary confirmations.
  const plain = harness(t); plain.manager.accept = false; const other = await plain.dispatched();
  assert.equal(plain.calls.find(call => call[0] === 'create')[1].permission, 'default'); assert.equal(plain.board.find(other).preauthorized, false);
  // An untrusted new directory: Claude refuses, the app never approves trust itself.
  const refused = harness(t); refused.manager.fail = 'untrusted';
  const made = (await refused.board.create({title: 'needs trust', project: path.join(refused.home, 'project')})).task;
  const result = await refused.board.dispatch(made.id);
  assert.deepEqual(result, {ok: false, code: 'workspace_untrusted', worktree: path.join(refused.home, 'task-worktrees', made.id)});
  assert.deepEqual([refused.board.find(made.id).state, refused.board.find(made.id).reason, refused.board.find(made.id).launchId, refused.board.find(made.id).preauthorized], ['draft', 'workspace_untrusted', '', false]);
  refused.manager.fail = ''; assert.equal((await refused.board.dispatch(made.id)).ok, true);
  assert.equal(refused.calls.filter(call => call[0] === 'worktree.create').length, 1, 'the retry reuses the worktree');
  // An unconfirmed launch may have started something: visible as unknown, never relaunched blindly.
  const unsure = harness(t); unsure.manager.fail = 'uncertain';
  const draft = (await unsure.board.create({title: 'unsure', project: path.join(unsure.home, 'project')})).task;
  assert.deepEqual(await unsure.board.dispatch(draft.id), {ok: false, code: 'launch_uncertain'});
  assert.deepEqual([unsure.board.find(draft.id).state, unsure.board.find(draft.id).reason], ['unknown', 'launch_uncertain']);
  assert.deepEqual(await unsure.board.dispatch(draft.id), {ok: false, code: 'bad_state'});
  assert.deepEqual(await unsure.board.stop(draft.id), {ok: false, code: 'launch_uncertain'});
  // Claude's own list later shows that nothing was started: back to a draft.
  unsure.manager.jobs = []; unsure.clock.now += 61000; unsure.board.tick(); await unsure.board.queue; await settle();
  assert.deepEqual([unsure.board.find(draft.id).state, unsure.board.find(draft.id).reason], ['draft', 'launch_not_started']);
  const nogit = harness(t); nogit.worktrees.available = async () => ({available: false, version: ''});
  const blocked = (await nogit.board.create({title: 'no git', project: path.join(nogit.home, 'project')})).task;
  assert.deepEqual(await nogit.board.dispatch(blocked.id), {ok: false, code: 'git_unavailable'}); assert.equal(nogit.calls.length, 0);
});

test('the dispatch prompt names the scope and the hand-back format; a fix task also asks for the check table', () => {
  const prompt = buildPrompt({title: 'Reorder the toolbar', brief: 'Second row.', branch: 'arcade/task-abc123'});
  for (const part of ['标题：Reorder the toolbar', 'Second row.', 'arcade/task-abc123', '只在当前工作目录内改动', '不要推送', '背景：', '做了什么：', '要你做的：', '我加的：', '是否完成由主人验收']) assert(prompt.includes(part), part);
  assert(!prompt.includes('| 入口 |')); assert(prompt.length < 1500);
  assert(buildPrompt({title: '修复导出按钮报错', brief: '', branch: 'b'}).includes('| 入口 | 是否经过修复 | 核对结果 |'));
  assert(buildPrompt({title: 'Fix crash on export', brief: '', branch: 'b'}).includes('| 入口 |'));
  assert(!buildPrompt({title: '修改工具栏配色', brief: '', branch: 'b'}).includes('| 入口 |'));
  assert(buildPrompt({title: 'x'.repeat(80), brief: 'y'.repeat(2000), branch: 'arcade/task-abc123def456'}).length < 8000);});

test('pause sets a task aside without touching its session; stop needs the list to confirm it', async t => {
  const h = harness(t), id = await h.dispatched(), start = h.clock.now, task = h.board.find(id);
  h.board.observe(h.seen('running', {at: start + 1000}));
  assert.deepEqual([h.board.pause(id).sessionStopped, task.state, task.pausedFrom, task.checkDueAt], [false, 'paused', 'running', null]);
  h.board.observe(h.seen('waiting', {at: start + 2000, reason: 'permission'})); h.clock.now += 60 * MINUTE; h.board.tick();
  assert.deepEqual([task.state, task.pausedFrom, h.events.length], ['paused', 'needs_input', 0]);
  assert.deepEqual([h.board.pause(id).task.state, task.pausedFrom], ['needs_input', '']);
  assert(!h.calls.some(call => call[0] === 'stop'));
  assert.deepEqual(h.board.pause('nope000000'), {ok: false, code: 'unknown_task'});
  h.manager.fail = 'stop'; assert.deepEqual(await h.board.stop(id), {ok: false, code: 'stop_unconfirmed'}); assert.equal(task.state, 'needs_input');
  h.manager.fail = 'still'; assert.deepEqual(await h.board.stop(id), {ok: false, code: 'stop_unconfirmed'}); assert.equal(task.state, 'needs_input');
  h.manager.fail = ''; const stopped = await h.board.stop(id);
  assert.deepEqual([stopped.ok, stopped.sessionStopped, stopped.task.state, stopped.task.reason, stopped.task.outcome], [true, true, 'stopped', 'stopped_by_owner', 'unverified']);
  assert.deepEqual(h.calls.filter(call => call[0] === 'stop').map(call => call[1]), ['aabbccdd', 'aabbccdd', 'aabbccdd']);
  assert.deepEqual(await h.board.stop(id), {ok: false, code: 'bad_state'}); assert.deepEqual(h.board.pause(id), {ok: false, code: 'bad_state'});
  const draft = (await h.board.create({title: 'draft', project: path.join(h.home, 'project')})).task.id;
  assert.deepEqual(await h.board.stop(draft), {ok: false, code: 'bad_state'}); assert.deepEqual(h.board.pause(draft), {ok: false, code: 'bad_state'});
});

test('remove: finished or draft only, and unsaved worktree changes need an explicit discard', async t => {
  const h = harness(t), id = await h.dispatched();
  assert.deepEqual(await h.board.remove({id}), {ok: false, code: 'not_finished'});
  h.board.observe(h.seen('done', {at: h.clock.now + 1000})); assert.deepEqual(await h.board.remove({id, discard: true}), {ok: false, code: 'not_finished'});
  h.clock.now += 2000; h.board.accept({id}); h.worktrees.dirty = true;
  assert.deepEqual(await h.board.remove({id}), {ok: false, code: 'worktree_has_changes', dirty: true, unmerged: 0});
  assert.deepEqual(await h.board.remove({id, discard: 'true'}), {ok: false, code: 'invalid_request'});
  assert.equal(h.board.find(id).state, 'verified');
  assert.deepEqual(await h.board.remove({id, discard: true}), {ok: true, worktree: {removed: true, missing: false, branchKept: false, discarded: true}});
  assert.equal(h.board.find(id), null); assert.deepEqual(h.calls.filter(call => call[0] === 'worktree.remove').map(call => call[2]), [false, true]);
  const draft = (await h.board.create({title: 'draft', project: path.join(h.home, 'project')})).task.id;
  assert.deepEqual(await h.board.remove({id: draft}), {ok: true, worktree: {removed: false, missing: true, branchKept: false, discarded: false}});
  assert.deepEqual(h.board.open(draft), {ok: false, code: 'unknown_task'});
});

test('capabilities state what was read from the CLI and that nothing here is a sandbox', async t => {
  const h = harness(t), value = await h.board.capabilities();
  assert.deepEqual(value.git, {available: true, version: '2.53.0'}); assert.deepEqual(value.claude, {available: true, version: '2.1.318'});
  assert.deepEqual(value.preauthorization, {available: true, reason: 'accept_edits_mode_listed_by_cli', mode: 'acceptEdits', scope: 'file_edits_in_task_worktree', confirmedWithRealSession: false});
  assert.match(value.notSandbox.zh, /不是沙箱/); assert.match(value.notSandbox.zh, /只有你能验收/); assert.match(value.notSandbox.en, /is a sandbox/); assert.match(value.notSandbox.en, /cannot tell who changed it/);
  assert.deepEqual(value.notSandbox, NOT_SANDBOX);
  h.manager.accept = false; assert.deepEqual((await h.board.capabilities()).preauthorization.reason, 'accept_edits_mode_not_listed_by_cli');
  h.manager.capability.available = false; assert.deepEqual([(await h.board.capabilities()).preauthorization.available, (await h.board.capabilities()).preauthorization.reason], [false, 'background_sessions_unavailable']);
  const none = new TaskBoard({home: h.home, worktrees: h.worktrees, sessions: async () => { throw Error('no CLI'); }});
  assert.deepEqual([(await none.capabilities()).claude.available, (await none.capabilities()).preauthorization.reason], [false, 'claude_unavailable']);
});

test('IPC handlers accept only a project the native picker returned in this run', async t => {
  const h = harness(t), project = path.join(h.home, 'project'); let next = '';
  const api = taskBoardHandlers(h.board, {pick: async () => next});
  assert.deepEqual(Object.keys(api), ['taskPickProject', 'taskCreate', 'taskUpdate', 'taskDispatch', 'taskAccept', 'taskRework', 'taskPause', 'taskStop', 'taskRemove', 'taskDiff', 'taskCapabilities']);
  assert.deepEqual(await api.taskCreate({title: 'typed path', project}), {ok: false, code: 'project_not_picked'});
  assert.deepEqual(await api.taskPickProject(), {ok: false, code: 'cancelled'});
  next = path.join(h.home, 'plain'); assert.deepEqual(await api.taskPickProject(), {ok: false, code: 'not_a_git_repository'});
  assert.deepEqual(await api.taskCreate({title: 'refused pick', project: next}), {ok: false, code: 'project_not_picked'});
  next = project; assert.deepEqual(await api.taskPickProject(), {ok: true, project, repository: project});
  const made = await api.taskCreate({title: 'picked', brief: '', project}); assert.equal(made.ok, true);
  for (const bad of [undefined, null, 'string', [], {project: {}}, {title: 'x', project: `${project}${path.sep}..`}]) assert.equal((await api.taskCreate(bad)).code, 'project_not_picked');
  assert.equal((await api.taskUpdate({id: made.task.id, brief: 'more'})).task.brief, 'more');
  for (const [name, value] of [['taskDispatch', {}], ['taskAccept', null], ['taskRework', 'x'], ['taskPause', 5], ['taskStop', []], ['taskRemove', undefined], ['taskDiff', {id: made.task.id}], ['taskUpdate', 7]]) assert.deepEqual(await api[name](value), {ok: false, code: 'unknown_task'}, name);
  assert.equal((await api.taskDispatch(made.task.id)).ok, true);
  assert.equal((await api.taskDiff(made.task.id)).diff.exists, true);
  assert.equal((await api.taskCapabilities()).ok, true);
  h.board.capabilities = async () => { throw Error('boom'); }; assert.deepEqual(await api.taskCapabilities(), {ok: false, code: 'internal'});
});
