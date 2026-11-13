'use strict';
// Platform-aware functions outside core/platform.cjs, each exercised with an
// injected platform so the macOS answers are checked on any operating system.
// Nothing here starts a process: runners and file probes are synthetic.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const runner = require('../src/bot/runner.cjs');
const programRunner = require('../src/bot/claude-program-runner.cjs');
const providerLogin = require('../src/bot/provider-login.cjs');
const {findCodexExecutable} = require('../src/bot/codex-runner.cjs');
const {discoverNative, createNativeLaunch, shLiteral} = require('../src/bot/native-launch.cjs');
const integration = require('../src/core/integration.cjs');
const {instanceEndpoint, removeStaleSocket} = require('../src/core/single-instance.cjs');
const voice = require('../src/voice/runtime.cjs');

const macSource = {PATH: '/usr/bin:/bin', HOME: '/Users/owner', TMPDIR: '/var/folders/x/T/', LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', SHELL: '/bin/zsh', USER: 'owner',
  ANTHROPIC_API_KEY: 'ambient', ANTHROPIC_AUTH_TOKEN: 'ambient', CLAUDE_CODE_OAUTH_TOKEN: 'ambient', OPENAI_API_KEY: 'ambient', CODEX_API_KEY: 'ambient', NODE_OPTIONS: '--require x', HTTPS_PROXY: 'private', GH_TOKEN: 'private', DYLD_INSERT_LIBRARIES: 'x'};
const secrets = ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'NODE_OPTIONS', 'HTTPS_PROXY', 'GH_TOKEN', 'DYLD_INSERT_LIBRARIES'];

test('macOS child environments carry PATH, HOME, TMPDIR, locale, SHELL and USER, and still no ambient credential', () => {
  const api = runner.environment(macSource, 'sk-fixture-key', '/Users/owner/.agent-arcade/claude', {platform: 'darwin'});
  const program = programRunner.environment(macSource, {platform: 'darwin'});
  const login = providerLogin.loginEnvironment({...macSource, CODEX_HOME: path.resolve('codex-home')}, 'codex', {platform: 'darwin'});
  for (const env of [api, program, login]) {
    for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'USER']) assert.equal(env[name], macSource[name], name);
    for (const name of secrets) assert.equal(Object.hasOwn(env, name), false, name);
    assert.equal(env.DISABLE_TELEMETRY, '1');
  }
  assert.equal(api.ANTHROPIC_API_KEY, 'sk-fixture-key'); assert.equal(api.CLAUDE_CONFIG_DIR, '/Users/owner/.agent-arcade/claude');
  assert.equal(Object.hasOwn(program, 'ANTHROPIC_API_KEY'), false); assert.equal(Object.hasOwn(login, 'ANTHROPIC_API_KEY'), false);
  assert.equal(login.CODEX_HOME, path.resolve('codex-home'));
  // Windows keeps exactly the names it always passed.
  const windows = programRunner.environment({...macSource, SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\owner'}, {platform: 'win32'});
  for (const name of ['TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'USER']) assert.equal(Object.hasOwn(windows, name), false, name);
  assert.equal(windows.SystemRoot, 'C:\\Windows'); assert.equal(windows.PATH, macSource.PATH);
});

test('Claude Agent SDK binary: one optional package per platform and architecture', () => {
  assert.equal(runner.sdkBinaryRequest({platform: 'darwin', arch: 'arm64'}), '@anthropic-ai/claude-agent-sdk-darwin-arm64/claude');
  assert.equal(runner.sdkBinaryRequest({platform: 'darwin', arch: 'x64'}), '@anthropic-ai/claude-agent-sdk-darwin-x64/claude');
  assert.equal(runner.sdkBinaryRequest({platform: 'linux', arch: 'x64'}), '@anthropic-ai/claude-agent-sdk-linux-x64/claude');
  assert.equal(runner.sdkBinaryRequest({platform: 'win32', arch: 'x64'}), '@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe');
  // The names are the ones the installed SDK itself declares.
  let declared; try { declared = Object.keys(require('@anthropic-ai/claude-agent-sdk/package.json').optionalDependencies || {}); } catch { declared = null; }
  if (declared) for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64'], ['linux', 'arm64'], ['win32', 'x64'], ['win32', 'arm64']])
    assert(declared.includes(path.posix.dirname(runner.sdkBinaryRequest({platform, arch}))), `${platform}-${arch}`);
  for (const [platform, arch] of [['darwin', 'ia32'], ['freebsd', 'x64'], ['aix', 'ppc64']]) assert.throws(() => runner.sdkBinaryRequest({platform, arch}), /Unsupported agent platform/);
});

test('macOS provider discovery finds claude and codex outside a Finder PATH, and never a relative or script path', () => {
  const env = {PATH: '/usr/bin:/bin', HOME: '/Users/owner'};
  const present = new Set(['/Users/owner/.local/bin/claude', '/opt/homebrew/bin/codex']);
  const isFile = file => present.has(file);
  assert.equal(providerLogin.discoverExecutable('claude', {platform: 'darwin', env, isFile}), '/Users/owner/.local/bin/claude');
  assert.equal(providerLogin.discoverExecutable('codex', {platform: 'darwin', env, isFile}), '/opt/homebrew/bin/codex');
  assert.equal(providerLogin.discoverExecutable('claude', {platform: 'darwin', env, isFile, directories: []}), null);
  assert.equal(providerLogin.discoverExecutable('claude', {platform: 'darwin', env: {PATH: 'relative:./bin'}, isFile: () => true, directories: []}), null);
  assert.throws(() => providerLogin.discoverExecutable('git', {platform: 'darwin', env, isFile}), /Unsupported AI provider/);
  // Codex runner: absolute path when found, the bare name as the last resort.
  assert.equal(findCodexExecutable({platform: 'darwin', env, find: (name, options) => { assert.equal(name, 'codex'); assert.equal(options.platform, 'darwin'); return '/opt/homebrew/bin/codex'; }}), '/opt/homebrew/bin/codex');
  assert.equal(findCodexExecutable({platform: 'darwin', env, find: () => null}), 'codex');
});

test('macOS Claude Code discovery uses the found node and claude, validates versions, and starts no shell', async () => {
  const env = {PATH: '/usr/bin:/bin', HOME: '/Users/owner'}, calls = [];
  const find = (name, options) => { assert.equal(options.platform, 'darwin'); assert.equal(options.env, env); return ({node: '/opt/homebrew/bin/node', claude: '/Users/owner/.local/bin/claude'})[name] || null; };
  const runImpl = async (file, args) => { calls.push([file, ...args]);
    if (file === '/opt/homebrew/bin/node') return {stdout: JSON.stringify({path: '/opt/homebrew/Cellar/node/24.1.0/bin/node', version: '24.1.0'}) + '\n'};
    if (file === '/Users/owner/.local/bin/claude') return {stdout: '2.1.320 (Claude Code)\n'};
    throw Error('unexpected program ' + file); };
  assert.deepEqual(await discoverNative({platform: 'darwin', env, runImpl, find}), {node: '/opt/homebrew/Cellar/node/24.1.0/bin/node', cli: '/Users/owner/.local/bin/claude'});
  assert.deepEqual(calls.map(call => call[0]), ['/opt/homebrew/bin/node', '/Users/owner/.local/bin/claude']);
  assert(!calls.flat().some(value => /^(?:which|where\.exe|sh|bash|zsh)$/.test(value)));
  await assert.rejects(discoverNative({platform: 'darwin', env, runImpl, find: () => null}), /Install Node\.js 22\.13\+/);
  await assert.rejects(discoverNative({platform: 'darwin', env, runImpl, find: name => name === 'node' ? '/opt/homebrew/bin/node' : null}), /Install the native Claude Code CLI/);
  await assert.rejects(discoverNative({platform: 'darwin', env, find, runImpl: async file => file.endsWith('node') ? {stdout: JSON.stringify({path: '/usr/local/bin/node', version: '20.11.0'})} : {stdout: '2.1.320'}}), /Install Node\.js 22\.13\+/);
  await assert.rejects(discoverNative({platform: 'darwin', env, find, runImpl: async file => file.endsWith('node') ? {stdout: JSON.stringify({path: '/usr/local/bin/node', version: '22.13.0'})} : {stdout: '2.1.316'}}), /Claude Code 2\.1\.317\+/);
});

test('Windows Claude Code discovery is unchanged: node from PATH, then ~/.local/bin/claude.exe, then where.exe', async () => {
  const calls = [], env = {USERPROFILE: path.resolve('profile')}, local = path.join(env.USERPROFILE, '.local', 'bin', 'claude.exe'), other = path.resolve('tools', 'claude.exe');
  const runImpl = async (file, args) => { calls.push([file, ...args]);
    if (file === 'node') return {stdout: JSON.stringify({path: process.execPath, version: '24.1.0'})};
    if (file === 'where.exe') return {stdout: `relative\\claude.exe\r\n${other}\r\n`};
    return {stdout: '2.1.317'}; };
  const find = () => assert.fail('Windows discovery does not use the POSIX search');
  assert.deepEqual(await discoverNative({platform: 'win32', env, runImpl, find, exists: file => file === local}), {node: process.execPath, cli: local});
  assert.deepEqual(calls.map(call => call[0]), ['node', local]);
  calls.length = 0;
  assert.deepEqual(await discoverNative({platform: 'win32', env, runImpl, find, exists: file => file === other}), {node: process.execPath, cli: other});
  assert.deepEqual(calls.map(call => call[0]), ['node', 'where.exe', other]);
});

test('POSIX launch command: every path is one single-quoted literal, including spaces, quotes and shell metacharacters', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-posix-launch-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  assert.equal(shLiteral("it's"), "'it'\\''s'"); assert.equal(shLiteral('$(id) `id` ;&|'), "'$(id) `id` ;&|'"); assert.equal(shLiteral(''), "''");
  const workspace = path.join(root, "My Project's $(touch pwned) `x`; rm"), cli = path.join(root, 'Application Support', "claude's bin", 'claude');
  fs.mkdirSync(workspace, {recursive: true});
  const launch = createNativeLaunch({root, workspace, url: 'http://127.0.0.1:1/', token: 'fixture-token', node: process.execPath, cli, sourceDir: path.resolve(__dirname, '../src/bot'), platform: 'darwin'});
  t.after(() => launch.cleanup());
  const [first, second] = launch.command.split('\n');
  assert.equal(first, `cd -- ${shLiteral(workspace)}`);
  assert(second.startsWith(`CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF=1 ${shLiteral(cli)} --allowedTools mcp__agent-arcade-wechat__reply --permission-mode default --strict-mcp-config --session-id ${shLiteral(launch.sessionId)} --mcp-config ${shLiteral(launch.file)} `));
  assert.doesNotMatch(launch.command, /Set-Location|\$env:|& '/);
  // Outside the quoted literals nothing can start a substitution or a second command.
  const outside = launch.command.replace(/'\\''/g, '').replace(/'[^']*'/g, '');
  assert.doesNotMatch(outside, /[$`;&|<>]/);
  // The argument list (used when the app starts the process itself) carries the raw values.
  assert(launch.args.includes(launch.file)); assert(!launch.args.some(value => value.includes("'")));
  const windows = createNativeLaunch({root, workspace, url: 'http://127.0.0.1:1/', token: 'fixture-token', node: process.execPath, cli, sourceDir: path.resolve(__dirname, '../src/bot'), platform: 'win32'});
  t.after(() => windows.cleanup());
  assert.match(windows.command, /^Set-Location -LiteralPath '/);
});

test('hook installation on any platform writes exec-form hooks: no shell parses the node or script path', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-hook-posix-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  // A macOS-style profile location with spaces and a quote in it.
  const root = path.join(base, "Library", "Application Support", "Owner's Arcade"), settingsFile = path.join(base, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), {recursive: true});
  const nodePath = '/opt/homebrew/Cellar/node/24.1.0/bin/node';
  integration.install({settingsFile, root, sourceDir: path.resolve(__dirname, '../src'), nodePath});
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')), script = path.join(root, 'bin', 'hook.cjs');
  const hooks = Object.values(settings.hooks).flat().flatMap(group => group.hooks);
  assert(hooks.length > 0);
  for (const hook of hooks) {
    assert.equal(hook.type, 'command'); assert.equal(hook.command, nodePath); assert.deepEqual(hook.args, [script]);
    // The command is the executable alone: no quoting, no arguments and no shell operators to interpret.
    assert.doesNotMatch(hook.command, /["'\s;&|$`]/);
  }
  assert(fs.existsSync(script)); assert(fs.existsSync(path.join(root, 'bin', 'core', 'events.cjs')));
  assert.equal(integration.installed(settingsFile), true);
  integration.uninstall(settingsFile); assert.equal(integration.installed(settingsFile), false);
});

test('single-instance endpoint: a macOS socket file left by a crash is removed only when it is our own socket', () => {
  const user = {username: 'owner', homedir: '/Users/owner'}, endpoint = instanceEndpoint({platform: 'darwin', user, hostname: 'mac'});
  assert.match(endpoint, /^\/tmp\/agent-arcade-[a-f0-9]{32}\.sock$/);
  assert.match(instanceEndpoint({platform: 'win32', user, hostname: 'pc'}), /^\\\\\.\\pipe\\agent-arcade-[a-f0-9]{32}$/);
  assert(instanceEndpoint({platform: 'linux', user, hostname: 'box'}).startsWith('\0agent-arcade-'));
  const fake = (stat, removed = []) => ({removed, lstatSync: file => { if (!stat) throw Object.assign(Error('missing'), {code: 'ENOENT'}); assert.equal(file, endpoint); return stat; }, unlinkSync: file => { removed.push(file); }});
  const socket = uid => ({isSocket: () => true, uid}), file = uid => ({isSocket: () => false, uid});
  let fsFake = fake(socket(501)); assert.equal(removeStaleSocket(endpoint, {platform: 'darwin', fileSystem: fsFake, uid: 501}), true); assert.deepEqual(fsFake.removed, [endpoint]);
  // Another user's socket, an ordinary file or symlink at that name, or a missing file: left alone.
  fsFake = fake(socket(502)); assert.equal(removeStaleSocket(endpoint, {platform: 'darwin', fileSystem: fsFake, uid: 501}), false); assert.deepEqual(fsFake.removed, []);
  fsFake = fake(file(501)); assert.equal(removeStaleSocket(endpoint, {platform: 'darwin', fileSystem: fsFake, uid: 501}), false); assert.deepEqual(fsFake.removed, []);
  fsFake = fake(null); assert.equal(removeStaleSocket(endpoint, {platform: 'darwin', fileSystem: fsFake, uid: 501}), false);
  // (null, not undefined: undefined would select the real process uid.)
  fsFake = fake(socket(501)); assert.equal(removeStaleSocket(endpoint, {platform: 'darwin', fileSystem: fsFake, uid: null}), false); assert.deepEqual(fsFake.removed, []);
  // Windows pipes and Linux abstract sockets have no file to remove.
  const never = {lstatSync: () => assert.fail('no file exists for this endpoint'), unlinkSync: () => assert.fail('nothing to remove')};
  assert.equal(removeStaleSocket('\\\\.\\pipe\\agent-arcade-x', {platform: 'win32', fileSystem: never, uid: 501}), false);
  assert.equal(removeStaleSocket('\0agent-arcade-x', {platform: 'linux', fileSystem: never, uid: 501}), false);
  assert.equal(removeStaleSocket('relative.sock', {platform: 'darwin', fileSystem: never, uid: 501}), false);
});

test('voice: Windows speech is reported unavailable on macOS with a reason, before any host is constructed', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-voice-platform-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  assert.deepEqual(voice.voiceBackendAvailability({platform: 'win32'}), {windows: {available: true}});
  for (const platform of ['darwin', 'linux']) {
    const availability = voice.voiceBackendAvailability({platform}).windows;
    assert.equal(availability.available, false); assert.equal(availability.reason, 'voice_platform'); assert.match(availability.message, /only available on Windows/);
    assert.throws(() => voice.createVoiceRuntime({root, platform}), {code: 'voice_platform', message: /only available on Windows/});
    assert.throws(() => voice.createVoiceRuntime({root, backend: 'windows', platform}), {code: 'voice_platform'});
    await assert.rejects(voice.voiceCapabilities({root, backend: 'windows', platform}), {code: 'voice_platform'});
    // The optional neural backend keeps its own configuration error; an unknown backend is still rejected first.
    assert.throws(() => voice.createVoiceRuntime({root, backend: 'local-neural', platform}), /尚未安装/);
    assert.throws(() => voice.createVoiceRuntime({root, backend: 'remote-provider', platform}), /available speech provider/);
  }
  const runtime = voice.createVoiceRuntime({root, backend: 'windows', platform: 'win32'});
  assert.equal(runtime.backend, 'windows'); await runtime.speech.close();
});

test('preload bridge: macOS and Linux get no QQ-management or voice functions; the default and Windows bridges are complete', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/preload.cjs'), 'utf8');
  const expose = argv => { let api; vm.runInNewContext(source, {process: {argv}, require: () => ({contextBridge: {exposeInMainWorld: (_name, value) => { api = value; }}, ipcRenderer: {invoke: async () => null, on() {}, removeListener() {}}})}); return api; };
  const full = expose([]), windows = expose(['--arcade-platform=win32']);
  assert.deepEqual(Object.keys(windows), Object.keys(full));
  assert.deepEqual({...full.platform}, {os: 'win32', modifier: 'Ctrl', managedQQ: true, voice: true});
  const managed = Object.keys(full).filter(key => /^(?:qq|onQQ)[A-Z]/.test(key)), speech = Object.keys(full).filter(key => /^voice[A-Z]/.test(key));
  assert(managed.length > 200); assert.equal(speech.length, 7);
  for (const [name, modifier] of [['darwin', '⌘'], ['linux', 'Ctrl']]) {
    const api = expose(['--arcade-appearance=dark', `--arcade-platform=${name}`]);
    assert.deepEqual({...api.platform}, {os: name, modifier, managedQQ: false, voice: false});
    assert.throws(() => { api.platform.managedQQ = true; }, TypeError);
    assert.deepEqual(Object.keys(api).filter(key => /^(?:qq|onQQ|voice)[A-Z]/.test(key)), []);
    // Everything else is untouched, including the plain OneBot connection.
    assert.deepEqual(Object.keys(api), Object.keys(full).filter(key => !managed.includes(key) && !speech.includes(key)));
    for (const key of ['botQQPrepare', 'botQQTest', 'botQQCopyConfig', 'botQQCopyToken', 'botQQOpenGuide', 'botConfigure', 'botConnect', 'botLogin', 'desktopChatSend', 'charactersList', 'sourcesAdd', 'install', 'snapshot', 'subscribe', 'configure'])
      assert.equal(typeof api[key], 'function', key);
  }
  // A value the main process never sends cannot select a platform.
  for (const value of ['--arcade-platform=', '--arcade-platform=Darwin', '--arcade-platform=constructor', '--arcade-platform=darwin '])
    assert.equal(expose([value]).platform.os, 'win32', value);
});
