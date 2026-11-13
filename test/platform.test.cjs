'use strict';
// Every case passes the platform explicitly: the answers for macOS and Linux are
// checked on whichever operating system runs the suite.
const test = require('node:test'), assert = require('node:assert/strict');
const platform = require('../src/core/platform.cjs');
const {applicationMenuTemplate, EDIT_ROLES} = require('../src/core/app-menu.cjs');

test('shortcut labels: Command on macOS, Control elsewhere', () => {
  assert.equal(platform.modifierLabel('darwin'), '⌘');
  assert.equal(platform.modifierLabel('win32'), 'Ctrl');
  assert.equal(platform.modifierLabel('linux'), 'Ctrl');
  assert.equal(platform.modifierKeyName('darwin'), 'Meta');
  assert.equal(platform.modifierKeyName('win32'), 'Control');
  assert.equal(platform.isMac('darwin'), true); assert.equal(platform.isWindows('darwin'), false); assert.equal(platform.isLinux('linux'), true);
});

test('capabilities: Windows keeps every optional feature, macOS and Linux report each one unavailable with a reason', () => {
  const windows = platform.capabilities({platform: 'win32'});
  assert.equal(windows.platform, 'win32'); assert.equal(windows.modifier, 'Ctrl');
  for (const [name, feature] of Object.entries(windows.features)) assert.deepEqual(feature, {available: true}, name);
  for (const os of ['darwin', 'linux']) {
    const value = platform.capabilities({platform: os});
    assert.equal(value.platform, os);
    assert.deepEqual(Object.keys(value.features).sort(), Object.keys(windows.features).sort());
    for (const [name, feature] of Object.entries(value.features)) {
      assert.equal(feature.available, false, name);
      assert.equal(typeof feature.reason, 'string'); assert(feature.reason.length > 20, name);
    }
  }
  for (const name of ['managedQQ', 'qce', 'ssqqClient', 'windowsSpeech', 'qqRemoteManagement']) assert(Object.hasOwn(windows.features, name), name);
  assert.throws(() => { platform.capabilities({platform: 'darwin'}).features.managedQQ.available = true; }, TypeError);
});

test('only the QQ management channels are Windows-only; the plain OneBot connection and every other channel stay available', () => {
  for (const channel of ['qqRuntimeRefresh', 'qqComponents', 'qqFirstSetup', 'qqQceRead', 'qqSSQQOpen', 'qqSupervisor', 'qqRemote', 'qqTransfer', 'qqVoiceSend', 'qqOwnerHistoryRead'])
    assert.equal(platform.windowsOnlyChannel(channel), true, channel);
  for (const channel of ['botQQPrepare', 'botQQTest', 'botQQCopyConfig', 'botConfigure', 'botConnect', 'accountConnect', 'snapshot', 'desktopChatSend', 'charactersList', 'sourcesAdd', 'config', 'install', 'qq', 'qqq', '', null, undefined, 7])
    assert.equal(platform.windowsOnlyChannel(channel), false, String(channel));
  assert.deepEqual(platform.unsupportedResult(), {ok: false, code: 'unsupported_platform'});
  const first = platform.unsupportedResult(); first.code = 'changed'; assert.equal(platform.unsupportedResult().code, 'unsupported_platform');
});

test('lifecycle: macOS stays open without windows, shows on activate and gets a standard menu; Windows and Linux are unchanged', () => {
  const mac = platform.lifecycle({platform: 'darwin'});
  assert.deepEqual({...mac}, {quitWhenAllWindowsClosed: false, closeHidesWindowWithoutTray: true, showWindowOnActivate: true, appUserModelId: false,
    standardApplicationMenu: true, trayIconSize: 18, trayIconRetina: true, dockIcon: true});
  const windows = platform.lifecycle({platform: 'win32'});
  assert.deepEqual({...windows}, {quitWhenAllWindowsClosed: true, closeHidesWindowWithoutTray: false, showWindowOnActivate: false, appUserModelId: true,
    standardApplicationMenu: false, trayIconSize: 32, trayIconRetina: false, dockIcon: false});
  assert.deepEqual({...platform.lifecycle({platform: 'linux'})}, {...windows, appUserModelId: false});
});

test('child environment: Windows list is unchanged; POSIX adds only locale, temp, shell and user plumbing', () => {
  const source = {PATH: 'p', Path: 'p2', SystemRoot: 's', WINDIR: 'w', TEMP: 't', TMP: 't2', HOME: 'h', USERPROFILE: 'u', APPDATA: 'a', LOCALAPPDATA: 'l', COMSPEC: 'c', PATHEXT: 'e',
    TMPDIR: '/tmp/x', LANG: 'zh_CN.UTF-8', LC_ALL: 'en_US.UTF-8', LC_CTYPE: 'UTF-8', SHELL: '/bin/zsh', USER: 'owner', LOGNAME: 'owner', XDG_CONFIG_HOME: '/x',
    ANTHROPIC_API_KEY: 'secret', OPENAI_API_KEY: 'secret', NODE_OPTIONS: '--require evil', HTTP_PROXY: 'private', SSH_AUTH_SOCK: '/private', LC_lower: 'no', LC_: 'no', DYLD_INSERT_LIBRARIES: 'evil', LD_PRELOAD: 'evil'};
  const windowsNames = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'PATHEXT'];
  assert.deepEqual(platform.childEnvironmentNames('win32'), windowsNames);
  assert.deepEqual(Object.keys(platform.childEnvironment(source, {platform: 'win32'})).sort(), [...windowsNames].sort());
  for (const os of ['darwin', 'linux']) {
    const env = platform.childEnvironment(source, {platform: os});
    for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL', 'USER', 'LOGNAME', 'XDG_CONFIG_HOME']) assert.equal(env[name], source[name], name);
    for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'HTTP_PROXY', 'SSH_AUTH_SOCK', 'LC_lower', 'LC_', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD']) assert.equal(Object.hasOwn(env, name), false, name);
  }
  assert.deepEqual(platform.childEnvironment({PATH: 7, HOME: null, LANG: {}}, {platform: 'darwin'}), {});
  assert.deepEqual(platform.childEnvironment(null, {platform: 'darwin'}), {});
});

test('macOS discovery searches PATH first, then the usual install locations, without a shell', () => {
  const home = '/Users/owner', env = {PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home};
  const directories = platform.searchDirectories({platform: 'darwin', env, list: () => []});
  assert.deepEqual(directories.slice(0, 4), ['/usr/bin', '/bin', '/usr/sbin', '/sbin']);
  for (const folder of ['/Users/owner/.local/bin', '/Users/owner/.claude/local', '/opt/homebrew/bin', '/usr/local/bin', '/Users/owner/.volta/bin', '/Users/owner/Library/Application Support/fnm/aliases/default/bin'])
    assert(directories.includes(folder), folder);
  assert.equal(new Set(directories).size, directories.length);
  const present = new Set(['/opt/homebrew/bin/claude', '/Users/owner/.local/bin/claude', '/usr/local/bin/git', '/usr/bin/git']);
  const isFile = file => present.has(file);
  // The user's own install wins over Homebrew; PATH wins over both.
  assert.equal(platform.findExecutable('claude', {platform: 'darwin', env, isFile, list: () => []}), '/Users/owner/.local/bin/claude');
  assert.equal(platform.findExecutable('git', {platform: 'darwin', env, isFile, list: () => []}), '/usr/bin/git');
  assert.equal(platform.findExecutable('codex', {platform: 'darwin', env, isFile, list: () => []}), null);
  assert.equal(platform.findExecutable('claude', {platform: 'darwin', env, isFile, directories: []}), null);
  for (const name of ['', '../claude', 'a b', 'claude;rm', '/bin/sh', 7, null]) assert.throws(() => platform.findExecutable(name, {platform: 'darwin', env, isFile}), /Invalid program name/);
});

test('macOS discovery finds the newest nvm Node.js and ignores unrelated directory names', () => {
  const env = {PATH: '/usr/bin', HOME: '/Users/owner'}, calls = [];
  const list = directory => { calls.push(directory); return directory === '/Users/owner/.nvm/versions/node' ? ['v18.20.4', 'v22.13.1', 'v24.1.0', 'v9.0.0', 'lts', '../../x', 'v22.x'] : []; };
  const directories = platform.commonDirectories({platform: 'darwin', env, list});
  const nvm = directories.filter(folder => folder.includes('/.nvm/'));
  assert.deepEqual(nvm, ['/Users/owner/.nvm/versions/node/v24.1.0/bin', '/Users/owner/.nvm/versions/node/v22.13.1/bin', '/Users/owner/.nvm/versions/node/v18.20.4/bin']);
  assert.deepEqual(calls, ['/Users/owner/.nvm/versions/node']);
  const isFile = file => file === '/Users/owner/.nvm/versions/node/v24.1.0/bin/node';
  assert.equal(platform.findExecutable('node', {platform: 'darwin', env, isFile, list}), '/Users/owner/.nvm/versions/node/v24.1.0/bin/node');
});

test('Windows discovery stays on PATH with .exe; a simulated platform never reads the real home directory', () => {
  const env = {PATH: 'C:\\Tools;C:\\Program Files\\Git\\cmd', USERPROFILE: 'C:\\Users\\owner'};
  assert.deepEqual(platform.commonDirectories({platform: 'win32', env}), []);
  assert.deepEqual(platform.searchDirectories({platform: 'win32', env}), ['C:\\Tools', 'C:\\Program Files\\Git\\cmd']);
  const isFile = file => file === 'C:\\Program Files\\Git\\cmd\\git.exe';
  assert.equal(platform.findExecutable('git', {platform: 'win32', env, isFile}), 'C:\\Program Files\\Git\\cmd\\git.exe');
  assert.equal(platform.findExecutable('git.exe', {platform: 'win32', env, isFile}), 'C:\\Program Files\\Git\\cmd\\git.exe');
  // No HOME in a simulated environment: only the fixed system locations remain.
  const other = process.platform === 'darwin' ? 'linux' : 'darwin';
  assert.equal(platform.homeDirectory({platform: other, env: {}}), '');
  assert(platform.commonDirectories({platform: other, env: {}, list: () => []}).every(folder => folder.startsWith('/') && !folder.includes('owner')));
  assert.equal(platform.homeDirectory({platform: 'darwin', env: {HOME: 'relative'}}), '');
  assert.deepEqual(platform.pathDirectories({platform: 'darwin', env: {PATH: '/a::relative:/b\n:/c'}}), ['/a', '/c']);
});

test('host PATH: macOS appends only existing common locations once; Windows is never modified', () => {
  const exists = new Set(['/opt/homebrew/bin', '/usr/local/bin', '/Users/owner/.local/bin', '/usr/bin']);
  const options = {platform: 'darwin', home: '/Users/owner', list: () => [], isDirectory: folder => exists.has(folder)};
  const env = {PATH: '/usr/bin:/bin', HOME: '/Users/owner'};
  assert.equal(platform.augmentedPath({...options, env}), '/usr/bin:/bin:/Users/owner/.local/bin:/opt/homebrew/bin:/usr/local/bin');
  assert.equal(platform.applyHostPath({...options, env}), true);
  assert.equal(env.PATH, '/usr/bin:/bin:/Users/owner/.local/bin:/opt/homebrew/bin:/usr/local/bin');
  assert.equal(platform.applyHostPath({...options, env}), false);
  assert.equal(env.PATH, '/usr/bin:/bin:/Users/owner/.local/bin:/opt/homebrew/bin:/usr/local/bin');
  const empty = {HOME: '/Users/owner'};
  assert.equal(platform.applyHostPath({...options, env: empty}), true); assert.equal(empty.PATH, '/Users/owner/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin');
  const windows = {PATH: 'C:\\Windows', Path: 'C:\\Windows'};
  assert.equal(platform.applyHostPath({platform: 'win32', env: windows}), false);
  assert.deepEqual(windows, {PATH: 'C:\\Windows', Path: 'C:\\Windows'});
  assert.equal(platform.augmentedPath({platform: 'win32', env: {Path: 'C:\\Only'}}), 'C:\\Only');
});

test('platform skips keep every test registered with a reason, and are node:test itself where supported', () => {
  const skips = require('./helpers/platform-skip.cjs');
  assert.equal(skips.testUnless(false), test);
  assert.equal(skips.ownedIpcSkip('win32'), false); assert.equal(skips.ownedIpcSkip('linux'), false);
  assert.equal(skips.ownedIpcSkip('darwin'), skips.OWNED_IPC_REASON); assert.match(skips.OWNED_IPC_REASON, /^Windows\/Linux only: /);
  assert.equal(skips.windowsOnlySkip(skips.WINDOWS_QCE_REASON, 'win32'), false);
  for (const os of ['darwin', 'linux']) assert.equal(skips.windowsOnlySkip(skips.WINDOWS_QCE_REASON, os), skips.WINDOWS_QCE_REASON);
  assert.match(skips.WINDOWS_QCE_REASON, /^Windows-only: /);
  // On this host the drop-in exports are exactly what the predicates say.
  assert.equal(skips.ownedIpcTest === test, ['win32', 'linux'].includes(process.platform));
  assert.equal(skips.windowsQceTest === test, process.platform === 'win32');
  const registered = [], base = (name, options, body) => { registered.push({name, options, ran: body() === undefined}); };
  const skipped = skips.testUnless('Windows-only: fixture reason', base);
  let ran = 0;
  skipped('first', async () => { ran++; }); skipped('second', {timeout: 5}, () => { ran++; }); skipped.skip('third', () => { ran++; });
  assert.equal(ran, 0);
  assert.deepEqual(registered.map(item => [item.name, item.options.skip]), [['first', 'Windows-only: fixture reason'], ['second', 'Windows-only: fixture reason'], ['third', 'Windows-only: fixture reason']]);
  for (const reason of [true, 1, {}]) assert.throws(() => skips.testUnless(reason, base), /needs a reason/);
});

test('application menu: macOS gets App, Edit, View and Window with the standard roles; other platforms keep the default menu', () => {
  assert.equal(applicationMenuTemplate({platform: 'win32'}), null);
  assert.equal(applicationMenuTemplate({platform: 'linux'}), null);
  const menu = applicationMenuTemplate({platform: 'darwin', appName: 'Agent Arcade', language: 'en'});
  assert.deepEqual(menu.map(item => item.label), ['Agent Arcade', 'Edit', 'View', 'Window']);
  const roles = submenu => submenu.filter(item => item.role).map(item => item.role);
  assert.deepEqual(roles(menu[0].submenu), ['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit']);
  // Without these roles Command+Z/X/C/V/A do nothing in a text field on macOS.
  assert.deepEqual(roles(menu[1].submenu), ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll']);
  assert.deepEqual(roles(menu[1].submenu), EDIT_ROLES.filter(Boolean));
  assert.deepEqual(roles(menu[2].submenu), ['resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen']);
  assert.deepEqual(roles(menu[3].submenu), ['minimize', 'zoom', 'close', 'front']);
  // Role-only items: no click handler and no accelerator can diverge from the system's.
  const walk = items => { for (const item of items) { assert.equal(item.click, undefined); assert.equal(item.accelerator, undefined); assert(item.type === 'separator' || typeof item.label === 'string' && item.label.length > 0); if (item.submenu) walk(item.submenu); } };
  walk(menu);
  assert.deepEqual(roles(applicationMenuTemplate({platform: 'darwin', developer: true})[2].submenu).at(-1), 'toggleDevTools');
  const zh = applicationMenuTemplate({platform: 'darwin', language: 'zh'});
  assert.deepEqual(zh.map(item => item.label), ['Agent Arcade', '编辑', '显示', '窗口']);
  assert.equal(zh[0].submenu.at(-1).label, '退出 Agent Arcade');
  assert.equal(zh[1].submenu.find(item => item.role === 'copy').label, '拷贝');
  assert.deepEqual(applicationMenuTemplate({platform: 'darwin', language: 'constructor'}).map(item => item.label), ['Agent Arcade', 'Edit', 'View', 'Window']);
});
