'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {createMacQQSetup} = require('../src/bot/mac-qq-setup.cjs');

const OWNER = '12345678';
const ACCOUNT = '87654321';
const RELEASE_URL = 'https://github.com/LuckyLilliaDev/LuckyLilliaBot/releases/tag/v8.3.2';
const PRIVATE_ROOT = path.resolve('synthetic-private-mac-qq-fixture');
const RUNTIME = path.join(PRIVATE_ROOT, 'runtime');
const NODE = path.join(PRIVATE_ROOT, 'node');
const TARGET = path.join(PRIVATE_ROOT, 'fresh-configuration');
const TOKEN = 'SYNTHETIC_SECRET_TOKEN';
const INTERNAL = 'SYNTHETIC_PRIVATE_WORKER_DETAIL';
const WARNING = 'bundled_node_rejected_explicit_node_override';
const failed = code => ({ok: false, code});
const cancelled = {ok: true, cancelled: true};
const error = code => Object.assign(Error(INTERNAL), {code, token: TOKEN, path: RUNTIME});
const selected = file => ({canceled: false, filePaths: [file]});
const destination = {canceled: false, filePath: TARGET};

function deferred() {
  let resolve;
  const promise = new Promise(complete => {resolve = complete;});
  return {promise, resolve};
}

function fixture() {
  const calls = {open: [], save: 0, run: [], release: []};
  const state = {
    now: 1700000000000,
    scope: {profileId: 'primary', service: {config: {qqOwnerId: OWNER}}, generation: 7},
    open: kind => selected(kind === 'node' ? NODE : RUNTIME), save: () => destination,
  };
  const inspected = args => ({
    release: '8.3.2', nodeVersion: 'v24.13.0', files: [
      {path: 'LuckyLillia'}, {path: 'bin/llbot/node'}, {path: 'bin/llbot/llbot.js'}, {path: 'bin/llbot/sign-proxy.darwin-arm64.node'},
    ],
    runtimeRoot: args.runtimeRoot, nodeExecutable: args.nodeExecutable || path.join(RUNTIME, 'bin', 'llbot', 'node'),
    warning: args.nodeExecutable ? WARNING : null, detail: INTERNAL, token: TOKEN,
  });
  const prepared = args => ({
    prepared: true, configurationOnly: true, bridgeStarted: false, loggedIn: false,
    targetDirectory: args.targetDirectory, endpoint: `ws://127.0.0.1:${args.port}/`,
    configFile: path.join(args.targetDirectory, 'data', `config_${args.accountId}.json`),
    tokenFile: path.join(args.targetDirectory, 'onebot-token.txt'),
    token: TOKEN, command: INTERNAL,
  });
  state.run = (operation, args) => operation === 'inspect' ? inspected(args) : prepared(args);
  const setup = createMacQQSetup({
    now: () => state.now,
    getScope() {
      if (state.scopeError) throw error(state.scopeError);
      return {...state.scope};
    },
    async openDialog(kind) {calls.open.push(kind);return state.open(kind);},
    async saveDialog() {calls.save++;return state.save();},
    async run(operation, args) {calls.run.push({operation, args});return state.run(operation, args);},
    async openRelease(url) {calls.release.push(url);},
  });
  const inspect = (withNode = false) => setup.inspect({withNode});
  const prepare = (ticketId, overrides) => setup.prepare({ticketId, accountId: ACCOUNT, port: 3001, ...overrides});
  return {setup, state, calls, inspect, prepare, inspected, prepared};
}

test('inspection uses only native choices and returns a compact receipt for the exact runtime and optional Node', async () => {
  for (const withNode of [false, true]) {
    const f = fixture();
    const output = await f.inspect(withNode);
    assert.equal(output.ok, true);
    assert.match(output.ticketId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(output, {ok: true, ticketId: output.ticketId, release: '8.3.2', nodeVersion: 'v24.13.0',
      filesChecked: 4, warning: withNode ? WARNING : null, recommendedPort: 3001,
    });
    assert.deepEqual(f.calls.open, withNode ? ['runtime', 'node'] : ['runtime']);
    assert.deepEqual(f.calls.run, [{operation: 'inspect', args: {runtimeRoot: RUNTIME, nodeExecutable: withNode ? NODE : undefined}}]);
    assert.equal(f.calls.save, 0);
    assert(!JSON.stringify(output).includes(PRIVATE_ROOT));
    assert.doesNotMatch(JSON.stringify(output), /SYNTHETIC_SECRET_TOKEN|SYNTHETIC_PRIVATE_WORKER_DETAIL/);
  }
});

test('preparation uses the inspected paths and exactly one explicit save destination, and consumes the successful receipt', async () => {
  const f = fixture();
  const checked = await f.inspect(true);
  assert.equal(checked.ok, true);
  assert.deepEqual(await f.prepare('wrong-ticket'), failed('stale_ticket'));
  assert.equal(f.calls.save, 0);
  const input = {runtimeRoot: RUNTIME, nodeExecutable: NODE, targetDirectory: TARGET, accountId: ACCOUNT, port: 4433};
  const working = deferred(), entered = deferred();
  f.state.run = () => {entered.resolve();return working.promise;};
  const pending = f.prepare(checked.ticketId, {port: 4433});
  await entered.promise;
  assert.deepEqual(await f.prepare(checked.ticketId), failed('operation_in_progress'));
  assert.equal(f.calls.save, 1);
  working.resolve(f.prepared(input));
  const output = await pending;
  const {targetDirectory, endpoint, configFile, tokenFile} = f.prepared(input);
  assert.match(output.preparedId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(output, {ok: true, prepared: true, preparedId:output.preparedId,
    accountId:ACCOUNT, targetDirectory, endpoint, configFile, tokenFile});
  assert.deepEqual(f.calls.run.at(-1), {operation: 'prepare', args: input});
  assert.doesNotMatch(JSON.stringify(output), /SYNTHETIC_SECRET_TOKEN|SYNTHETIC_PRIVATE_WORKER_DETAIL/);
  assert.deepEqual(await f.prepare(checked.ticketId), failed('stale_ticket'));
  assert.equal(f.calls.save, 1);
  assert.equal(f.calls.run.length, 2);
});

test('cancelling either inspection picker or the save dialog preserves a usable current receipt', async () => {
  const f = fixture();
  const checked = await f.inspect();
  f.state.open = () => ({canceled: true});
  assert.deepEqual(await f.inspect(true), cancelled);
  assert.deepEqual(f.calls.open, ['runtime', 'runtime']);
  f.state.open = kind => kind === 'runtime' ? selected(RUNTIME) : {canceled: true};
  assert.deepEqual(await f.inspect(true), cancelled);
  assert.deepEqual(f.calls.open, ['runtime', 'runtime', 'runtime', 'node']);
  assert.equal(f.calls.run.length, 1);

  f.state.save = () => ({canceled: true});
  assert.deepEqual(await f.prepare(checked.ticketId), cancelled);
  assert.equal(f.calls.run.length, 1);
  f.state.save = () => destination;
  assert.equal((await f.prepare(checked.ticketId)).prepared, true);
  assert.equal(f.calls.save, 2);
  assert.deepEqual(f.calls.run.map(call => call.operation), ['inspect', 'prepare']);
});

test('renderer paths and invalid account or port never reach a native chooser or worker', async () => {
  const f = fixture();
  for (const value of [null, [], {}, {withNode: 'false'}, {withNode: false, runtimeRoot: RUNTIME}, {withNode: true, nodeExecutable: NODE}]) {
    assert.deepEqual(await f.setup.inspect(value), failed('invalid_request'));
  }
  assert.deepEqual(f.calls.open, []);
  const checked = await f.inspect();
  for (const patch of [{targetDirectory: TARGET}, {runtimeRoot: RUNTIME}, {nodeExecutable: NODE}, {token: TOKEN}, {ticketId: false}]) {
    assert.deepEqual(await f.prepare(checked.ticketId, patch), failed('invalid_request'));
  }
  for (const patch of [{accountId: Number(ACCOUNT)}, {accountId: OWNER}, {accountId: '0' + ACCOUNT}, {accountId: 'not QQ'},
    {port: '3001'}, {port: 3001.5}, {port: 1023}, {port: 65536}, {port: Infinity}]) {
    assert.deepEqual(await f.prepare(checked.ticketId, patch), failed('invalid_configuration'));
  }
  assert.equal(f.calls.save, 0);
  assert.equal(f.calls.run.length, 1);
});

test('profile, service, or generation changes each require a fresh native inspection', async t => {
  for (const change of [
    {profileId: 'another-profile'}, {service: {config: {qqOwnerId: OWNER}}}, {generation: 8},
  ]) await t.test(Object.keys(change)[0], async () => {
    const f = fixture();
    const before = await f.inspect();
    f.state.scope = {...f.state.scope, ...change};
    assert.deepEqual(await f.prepare(before.ticketId), failed('stale_ticket'));
    assert.equal(f.calls.save, 0);
    const after = await f.inspect();
    assert.equal(after.ok, true);
    assert.notEqual(after.ticketId, before.ticketId);
    assert.equal((await f.prepare(after.ticketId)).prepared, true);
    assert.equal(f.calls.save, 1);
  });
});

test('the runtime modal and inspection worker serialize requests and reject late results from a changed scope', async () => {
  const f = fixture();
  const modal = deferred();
  f.state.open = () => modal.promise;
  const picking = f.inspect();
  assert.deepEqual(f.calls.open, ['runtime']);
  assert.deepEqual(await f.inspect(), failed('operation_in_progress'));
  assert.deepEqual(await f.prepare('old-ticket'), failed('operation_in_progress'));
  f.state.scope.generation++;
  modal.resolve(selected(RUNTIME));
  assert.deepEqual(await picking, failed('changed'));
  assert.equal(f.calls.run.length, 0);

  const checked = deferred(), entered = deferred();
  f.state.open = () => selected(RUNTIME);
  f.state.run = (operation, args) => {entered.resolve({operation, args});return checked.promise;};
  const inspecting = f.inspect();
  const {operation, args} = await entered.promise;
  assert.equal(operation, 'inspect');
  assert.deepEqual(await f.inspect(), failed('operation_in_progress'));
  assert.deepEqual(await f.prepare('unused'), failed('operation_in_progress'));
  f.state.scope.profileId = 'other-profile';
  checked.resolve(f.inspected(args));
  assert.deepEqual(await inspecting, failed('changed'));
  assert.equal(f.calls.save, 0);
});

test('a save dialog result cannot authorize a worker after switching profiles or after the receipt expires', async t => {
  for (const reason of ['changed', 'stale_ticket']) await t.test(reason, async () => {
    const f = fixture();
    const inspected = await f.inspect();
    const saving = deferred();
    f.state.save = () => saving.promise;
    const waiting = f.prepare(inspected.ticketId);
    assert.equal(f.calls.save, 1);
    assert.deepEqual(await f.prepare(inspected.ticketId), failed('operation_in_progress'));
    if (reason === 'changed') f.state.scope.profileId = 'another-profile';
    else f.state.now += 10 * 60 * 1000;
    saving.resolve(destination);
    assert.deepEqual(await waiting, failed(reason));
    assert.deepEqual(f.calls.run.map(call => call.operation), ['inspect']);
    assert.deepEqual(await f.prepare(inspected.ticketId), failed('stale_ticket'));
    assert.equal(f.calls.save, 1);
  });
});

test('the chosen companion number still has to differ from the saved owner when the save dialog returns', async () => {
  const f = fixture();
  const inspected = await f.inspect();
  const saving = deferred();
  f.state.save = () => saving.promise;
  const pending = f.prepare(inspected.ticketId);
  assert.equal(f.calls.save, 1);

  // Retain the selected profile, service object and generation. Only the
  // owner binding changes while the native save dialog is open.
  f.state.scope.service.config.qqOwnerId = ACCOUNT;
  saving.resolve(destination);
  assert.deepEqual(await pending, failed('invalid_configuration'));
  assert.deepEqual(f.calls.run.map(call => call.operation), ['inspect']);

  f.state.save = () => destination;
  const alternative = '87654322';
  assert.equal((await f.prepare(inspected.ticketId, {accountId: alternative})).prepared, true);
  assert.equal(f.calls.run.at(-1).args.accountId, alternative);
});

test('unsupported scope, unsafe native picker results and trusted worker errors expose only stable codes', async () => {
  const f = fixture();
  f.state.scopeError = 'unsupported_platform';
  assert.deepEqual(await f.inspect(), failed('unsupported_platform'));
  assert.deepEqual(f.calls.open, []);
  f.state.scopeError = null;
  for (const pick of [{filePaths: [RUNTIME, NODE]}, selected('relative-runtime'), selected('https://example.test/runtime')]) {
    f.state.open = () => pick;
    assert.deepEqual(await f.inspect(), failed('unsafe_path'));
  }
  assert.deepEqual(f.calls.run, []);

  f.state.open = () => selected(RUNTIME);
  for (const code of ['runtime_changed', 'node_signature_unverified', 'unrecognized_native_error']) {
    f.state.run = () => {throw error(code);};
    const result = await f.inspect();
    assert.deepEqual(result, failed(code === 'unrecognized_native_error' ? 'preparation_failed' : code));
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET_TOKEN|SYNTHETIC_PRIVATE_WORKER_DETAIL|unrecognized/);
  }
  f.state.run = (_operation, args) => f.inspected(args);
  const inspected = await f.inspect();
  f.state.run = () => {throw error('target_exists');};
  assert.deepEqual(await f.prepare(inspected.ticketId), failed('target_exists'));
});

test('the release guide opens only the fixed pinned upstream page', async () => {
  const f = fixture();
  assert.deepEqual(await f.setup.guide(), {ok: true});
  assert.deepEqual(f.calls.release, [RELEASE_URL]);
  assert.deepEqual(f.calls.open, []);
  assert.deepEqual(f.calls.run, []);
});
