'use strict';
// Synthetic runtimes, fake signing metadata and a local OneBot peer only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {WebSocketServer} = require('ws');
const {QQClient} = require('../src/bot/qq.cjs');
const {inspectMacQQBridge, prepareMacQQBridge, NODE_REQUIREMENT} = require('../src/bot/mac-qq-bridge.cjs');

function fixture(t, {badBundledNode = false, badSelectedNode = false, badRuntime = false, version = 'v24.21.0\n'} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-mac-qq-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const runtime = path.join(root, 'runtime'); fs.mkdirSync(runtime);
  fs.mkdirSync(path.join(runtime, 'bin/llbot'), {recursive: true});
  const executable = Buffer.alloc(32); executable.writeUInt32LE(0xfeedfacf); executable.writeUInt32LE(0x0100000c, 4);
  const files = {};
  for (const [index, name] of ['LuckyLillia', 'bin/llbot/node', 'bin/llbot/llbot.js', 'bin/llbot/sign-proxy.darwin-arm64.node'].entries()) {
    const bytes = name.endsWith('.js') ? Buffer.from('throw Error("SYNTHETIC MUST NEVER EXECUTE");') : Buffer.concat([executable, Buffer.from(String(index))]);
    fs.writeFileSync(path.join(runtime, name), bytes, {mode: 0o700});
    files[name] = [bytes.length, crypto.createHash('sha256').update(bytes).digest('hex')];
  }
  const alternate = path.join(root, 'official-node'); fs.writeFileSync(alternate, executable, {mode: 0o700});
  const calls = [], bundled = path.join(runtime, 'bin/llbot/node');
  const run = (file, args, options) => {
    calls.push({file, args, options});
    if (file === '/usr/bin/codesign') {
      if (badRuntime && args.at(-1).endsWith('LuckyLillia') || badBundledNode && args.at(-1) === bundled || badSelectedNode && args.includes(NODE_REQUIREMENT)) return {status: 1, stderr: 'SYNTHETIC_UNTRUSTED_ERROR_NOT_EXPORTED'};
      return {status: 0};
    }
    assert.ok([alternate, bundled].includes(file)); assert.deepEqual(args, ['--version']);
    return {status: 0, stdout: version};
  };
  const dependencies = {run, release: {version: 'synthetic', files}, platform: 'darwin', arch: 'arm64'};
  const inspect = options => inspectMacQQBridge(runtime, {platform: 'darwin', arch: 'arm64', ...options}, dependencies);
  const prepare = options => prepareMacQQBridge({runtimeRoot: runtime, targetDirectory: path.join(root, 'prepared'), accountId: '87654321', ...options}, dependencies);
  return {root, runtime, alternate, calls, dependencies, inspect, prepare};
}

test('an unverified bundled Node is rejected before version probe, config writes or any bridge execution', t => {
  const f = fixture(t, {badBundledNode: true});
  assert.throws(() => f.inspect(), {code: 'node_signature_unverified'});
  assert.throws(() => f.prepare(), {code: 'node_signature_unverified'});
  assert(!fs.existsSync(path.join(f.root, 'prepared')));
  assert(f.calls.every(c => c.file === '/usr/bin/codesign'));
});
test('an explicit alternate Node must satisfy the official signature requirement, and only --version executes', t => {
  const f = fixture(t, {badBundledNode: true});
  const state = f.inspect({nodeExecutable: f.alternate});
  assert.equal(state.bundledNodeValid, false); assert.equal(state.warning, 'bundled_node_rejected_explicit_node_override');
  assert.equal(state.nodeVersion, 'v24.21.0');
  assert.equal(state.identityScope, 'pinned_entrypoints_only'); assert.equal(state.allRuntimeFilesVerified, false);
  assert.equal(state.bridgeStarted, false); assert.equal(state.loggedIn, false); assert.equal(state.oneBotVerified, false);
  const required = f.calls.find(c => c.args.includes(NODE_REQUIREMENT)); assert.equal(required.args.at(-1), f.alternate);
  const probe = f.calls.filter(c => c.file !== '/usr/bin/codesign'); assert.equal(probe.length, 1);
  assert.deepEqual(probe[0].args, ['--version']);
  assert.deepEqual(Object.keys(probe[0].options.env).sort(), ['LANG', 'PATH']);
});
test('untrusted alternate Node and Node below 24 fail closed without preparing configuration', t => {
  for (const options of [{badSelectedNode: true}, {version: 'v22.17.0\n'}, {version: 'private-untrusted-output'}]) {
    const f = fixture(t, options);
    assert.throws(() => f.prepare({nodeExecutable: f.alternate}), error => ['node_signature_unverified', 'node_version_unverified'].includes(error.code) && !error.message.includes('private-untrusted-output'));
    assert(!fs.existsSync(path.join(f.root, 'prepared')));
  }
});
test('changed source bytes, invalid native signature and wrong architecture are rejected before Node runs', t => {
  for (const variation of ['bytes', 'signature', 'architecture']) {
    const f = fixture(t, {badRuntime: variation === 'signature'});
    if (variation === 'bytes') fs.appendFileSync(path.join(f.runtime, 'bin/llbot/llbot.js'), 'changed');
    if (variation === 'architecture') {
      const p = path.join(f.runtime, 'LuckyLillia'), bytes = fs.readFileSync(p); bytes.writeUInt32LE(0x01000007, 4); fs.writeFileSync(p, bytes);
      f.dependencies.release.files.LuckyLillia[1] = crypto.createHash('sha256').update(bytes).digest('hex');
    }
    assert.throws(() => f.inspect(), error => ['runtime_changed', 'runtime_signature_unverified'].includes(error.code));
    assert(f.calls.every(c => c.file === '/usr/bin/codesign'));
  }
});
test('unsupported host, symbolic-link runtime and linked package member are not accepted', t => {
  const f = fixture(t);
  assert.throws(() => inspectMacQQBridge(f.runtime, {platform: 'linux', arch: 'arm64'}, f.dependencies), {code: 'unsupported_platform'});
  if (process.platform === 'win32') return;
  const link = path.join(f.root, 'linked'); fs.symlinkSync(f.runtime, link);
  assert.throws(() => inspectMacQQBridge(link, {platform: 'darwin', arch: 'arm64'}, f.dependencies), {code: 'unsafe_path'});
  const script = path.join(f.runtime, 'bin/llbot/llbot.js'); fs.renameSync(script, script + '.original'); fs.symlinkSync(script + '.original', script);
  assert.throws(() => f.inspect(), {code: 'unsafe_path'});
  assert.equal(f.calls.length, 0);
});
test('preparation writes one exact-account private loopback configuration without auth-token or login', t => {
  const f = fixture(t), result = f.prepare();
  const config = JSON.parse(fs.readFileSync(result.configFile)), token = fs.readFileSync(result.tokenFile, 'utf8').trim();
  assert.equal(result.configurationOnly, true); assert.equal(result.bridgeStarted, false); assert.equal(result.loggedIn, false);
  assert.equal(result.endpoint, 'ws://127.0.0.1:3001/'); assert.match(result.configFile, /config_87654321\.json$/);
  assert.match(token, /^[\w-]{43}$/); assert(!JSON.stringify(result).includes(token));
  assert.deepEqual(config.ob11.connect, [{type: 'ws', enable: true, host: '127.0.0.1', port: 3001, token,
    messageFormat: 'array', heartInterval: 60000, reportSelfMessage: false, reportOfflineMessage: false, debug: false}]);
  assert.equal(config.webui.enable, false); assert.equal(config.satori.enable, false); assert.equal(config.milky.enable, false);
  assert.equal(config.enableLocalFile2Url, false); assert.equal(config.autoDeleteFile, false); assert.equal(config.log, false);
  assert(!fs.existsSync(path.join(result.targetDirectory, 'data/auth_token.txt')));
  const plan = JSON.parse(fs.readFileSync(path.join(result.targetDirectory, 'launch-plan.json')));
  assert.equal(plan.cwd, result.targetDirectory); assert.deepEqual(plan.args, [path.join(f.runtime, 'bin/llbot/llbot.js'), '--qq=87654321', '--protocol=macos']);
  assert(!JSON.stringify(plan).includes(token)); assert.equal(plan.loggedIn, false);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(result.targetDirectory).mode & 0o777, 0o700);
    for (const p of [result.configFile, result.tokenFile, path.join(result.targetDirectory, 'launch-plan.json')]) assert.equal(fs.statSync(p).mode & 0o777, 0o600);
  }
});
test('preparation never overwrites an existing configuration, follows a linked target or accepts a group name as account', t => {
  const f = fixture(t); const result = f.prepare(); const before = fs.readFileSync(result.configFile);
  assert.throws(() => f.prepare(), {code: 'target_exists'}); assert.deepEqual(fs.readFileSync(result.configFile), before);
  for (const accountId of ['a nickname', '1234', '00000123', '../1234567']) assert.throws(() => f.prepare({accountId, targetDirectory: path.join(f.root, 'unused')}), {code: 'invalid_configuration'});
  for (const port of [80, 65536, 3.5, '3001']) assert.throws(() => f.prepare({port, targetDirectory: path.join(f.root, 'unused')}), {code: 'invalid_configuration'});
  assert(!fs.existsSync(path.join(f.root, 'unused')));
  if (process.platform !== 'win32') {
    const parent = path.join(f.root, 'parent-link'); fs.symlinkSync(f.root, parent);
    assert.throws(() => f.prepare({targetDirectory: path.join(parent, 'linked-new')}), {code: 'unsafe_path'});
    assert(!fs.existsSync(path.join(f.root, 'linked-new')));
  }
});
test('prepared OneBot configuration drives the production client against an authenticated loopback peer, not a real QQ bridge', async t => {
  const f = fixture(t); let peer, authorization, sent;
  const server = new WebSocketServer({host: '127.0.0.1', port: 0}); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => {for (const socket of server.clients) socket.terminate(); return new Promise(resolve => server.close(resolve));});
  const result = f.prepare({port: server.address().port}), config = JSON.parse(fs.readFileSync(result.configFile));
  const local = config.ob11.connect[0];
  server.on('connection', (socket, request) => {
    peer = socket; authorization = request.headers.authorization;
    socket.on('message', raw => {
      const value = JSON.parse(raw); let data;
      if (value.action === 'get_login_info') data = {user_id: 87654321, nickname: 'Synthetic AI'};
      else if (value.action === 'get_status') data = {online: true, good: true};
      else if (value.action === 'send_group_msg') {sent = value; data = {message_id: 902};}
      else throw Error('Unexpected fixture action');
      socket.send(JSON.stringify({status: 'ok', retcode: 0, echo: value.echo, data}));
    });
  });
  const client = new QQClient({url: result.endpoint, token: local.token, ownerId: '12345678', expectedAccountId: '87654321', groupIds: ['55556666'], pollTimeoutMs: 1000});
  t.after(() => client.close()); await client.connect(); assert.equal(authorization, 'Bearer ' + local.token);
  peer.send(JSON.stringify({post_type: 'message', message_type: 'group', sub_type: 'normal', self_id: 87654321, group_id: 55556666,
    user_id: 44443333, message_id: 901, time: Math.ceil(Date.now() / 1000), message: [{type: 'text', data: {text: 'Synthetic group question'}}]}));
  const updates = await client.getUpdates(); assert.equal(updates.messages.length, 1);
  const message = updates.messages[0]; assert.equal(message.from, '44443333'); assert.equal(message.groupId, '55556666');
  await client.sendGroupText({accountId: '87654321', groupId: '55556666', senderId: '44443333'}, 'Synthetic reply', message.contextToken);
  assert.equal(sent.params.group_id, 55556666); assert.equal(sent.action, 'send_group_msg');
  await assert.rejects(client.sendGroupText({accountId: '87654321', groupId: '77778888', senderId: '44443333'}, 'Wrong group', message.contextToken), {code: 'stale_context'});
});
