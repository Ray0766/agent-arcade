'use strict';
// The real main-process startup, run for a chosen platform against a synthetic
// Electron (see helpers/platform-main-harness.cjs). These are the decisions a
// Windows machine can prove about macOS; what only a Mac can show is listed in
// docs/MACOS.md.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {boot} = require('./helpers/platform-main-harness.cjs');

const roles = menu => menu.template.flatMap(item => item.submenu.filter(entry => entry.role).map(entry => entry.role));

test('macOS start: no Windows QQ machinery is built, its channels refuse, and the app follows macOS window conventions', async t => {
  const h = await boot(t, {platform: 'darwin'});
  const state = h.api.state();
  assert.equal(state.hostGate.platform, 'darwin');
  // Nothing from the Windows management layer exists.
  assert.deepEqual(h.calls.constructed, []);
  for (const name of ['qqConsole', 'qqComponents', 'qqCompanionLaunch', 'remotePanel', 'transferPanel', 'supervisorPanel', 'transferLocal', 'qceScheduleTimer']) assert(state[name] === undefined || state[name] === null, name);
  // The renderer is told the platform through the preload argument.
  assert(h.window.options.webPreferences.additionalArguments.includes('--arcade-platform=darwin'));
  assert.equal(h.window.options.webPreferences.contextIsolation, true); assert.equal(h.window.options.webPreferences.sandbox, true); assert.equal(h.window.options.webPreferences.nodeIntegration, false);
  // Default macOS title bar: no hidden or inset style that could cover the top bar.
  assert.equal(h.window.options.titleBarStyle, undefined); assert.equal(h.window.options.frame, undefined);
  // Edit menu with the standard roles, so Command+C/V/X/A/Z work in text fields.
  assert.equal(h.calls.menus.length, 1);
  for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'quit', 'hide', 'minimize', 'close']) assert(roles(h.calls.menus[0]).includes(role), role);
  // AppUserModelID is Windows-only; the Dock gets the brand icon when run from source.
  assert.deepEqual(h.calls.appUserModelIds, []); assert.equal(h.calls.dockIcons.length, 1);
  // Menu-bar icon: 18pt with a 2x representation.
  assert.equal(h.calls.trays.length, 1); assert.equal(h.calls.trays[0].image.size, 18);
  assert.deepEqual(h.calls.trays[0].image.representations.map(item => [item.scaleFactor, item.width, item.height]), [[2, 36, 36]]);

  // Snapshot: the App conversation side is present; the QQ runtime is absent.
  const snapshot = await h.invoke('snapshot');
  assert.equal(snapshot.qqRuntime, undefined); assert.equal(snapshot.qqComponents, undefined); assert.equal(snapshot.qqCompanionLaunch, null);
  assert.equal(typeof snapshot.config.language, 'string'); assert(snapshot.accounts); assert(snapshot.bot); assert(Array.isArray(snapshot.personas));
  // Every Windows-only channel answers with the same fixed refusal and never reaches its handler.
  const gated = [...h.handlers.keys()].map(name => name.slice('arcade:'.length)).filter(name => /^qq[A-Z]/.test(name) || /^voice[A-Z]/.test(name));
  assert(gated.length > 100, String(gated.length));
  // (Copied with a spread: the result object is created inside the vm realm.)
  for (const name of gated) assert.deepEqual({...await h.invoke(name, {accountId: '12345678', panelId: 'x'})}, {ok: false, code: 'unsupported_platform'}, name);
  // The sender check still comes first.
  await assert.rejects(h.handlers.get('arcade:qqRuntimeRefresh')({sender: {}, senderFrame: h.event.senderFrame}), /Untrusted sender/);
  await assert.rejects(h.handlers.get('arcade:snapshot')({sender: h.window.webContents, senderFrame: {url: 'file:///other.html'}}), /Untrusted sender/);
  // The verified-identity QQ connection belongs to the managed runtime.
  await assert.rejects(h.invoke('accountConnect', {accountId: snapshot.accounts.selectedId, qqAccountId: '12345678', runtimeRevision: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}), {code: 'unsupported_platform'});
  // The plain OneBot connection, the other channels and the core features stay registered and ungated.
  for (const name of ['botQQPrepare', 'botQQTest', 'botQQCopyConfig', 'botConfigure', 'botConnect', 'botLogin', 'desktopChatSend', 'charactersList', 'lorebooksList', 'groupsList', 'sourcesAdd', 'config', 'install', 'workRefresh', 'backgroundCreate', 'providerStatus'])
    assert.equal(typeof h.handlers.get('arcade:' + name), 'function', name);
  assert.deepEqual(await h.invoke('charactersList'), []);

  // One poll and one publish touch nothing that was not built.
  assert.equal(h.intervals.length, 1); assert.equal(h.intervals[0].ms, 1000);
  h.intervals[0].fn(); h.api.publish();
  // The menu follows the interface language.
  await h.invoke('config', {language: 'zh'}); h.intervals[0].fn();
  assert.equal(h.calls.menus.length, 2); assert.equal(h.calls.menus[1].template[1].label, '编辑');
  await h.invoke('config', {language: 'en'}); h.intervals[0].fn();

  // Closing the window hides it; the app keeps running without windows; activate shows it again.
  let prevented = 0; h.window.emit('close', {preventDefault() { prevented++; }});
  assert.equal(prevented, 1); assert.equal(h.window.visible, false);
  h.appEvents.get('window-all-closed')(); assert.equal(h.calls.quits, 0);
  h.appEvents.get('activate')(); assert.equal(h.window.visible, true); assert.equal(h.calls.focuses, 1);
  for (const name of ['hide', 'minimize']) h.window.emit(name);
  await new Promise(resolve => setImmediate(resolve));

  // Quit completes its cleanup with none of the Windows machinery present.
  await h.quit();
  assert.equal(h.api.state().cleanedUp, true, h.api.state().problem); assert.equal(h.calls.quits, 1);
  // Nothing was written outside the isolated profile for Windows component stores.
  assert.equal(fs.existsSync(path.join(h.root, 'local')), false);
});

test('macOS without a menu-bar icon still hides on close and never quits by itself', async t => {
  const h = await boot(t, {platform: 'darwin', tray: false});
  assert.equal(h.api.state().tray, null);
  let prevented = 0; h.window.emit('close', {preventDefault() { prevented++; }});
  assert.equal(prevented, 1); assert.equal(h.window.visible, false);
  h.appEvents.get('window-all-closed')(); assert.equal(h.calls.quits, 0);
  h.appEvents.get('activate')(); assert.equal(h.window.visible, true);
});

test('Windows start is unchanged: the QQ layer is built, nothing is gated, and the app quits with its last window', async t => {
  const h = await boot(t, {platform: 'win32'});
  const state = h.api.state();
  assert.equal(state.hostGate.platform, 'win32');
  for (const name of ['QQConsole', 'QQComponents', 'QQRemotePanel', 'QQTransferPanel', 'QQTransferLocal', 'QQSupervisorPanel']) assert(h.calls.constructed.includes(name), name);
  assert(state.qqConsole); assert(state.qqComponents); assert(state.qqCompanionLaunch); assert(state.remotePanel); assert(state.supervisorPanel);
  assert(h.window.options.webPreferences.additionalArguments.includes('--arcade-platform=win32'));
  assert.equal(h.window.options.autoHideMenuBar, true);
  // Electron's default menu is left alone; AppUserModelID is set; the tray icon keeps its size.
  assert.deepEqual(h.calls.menus, []); assert.deepEqual(h.calls.appUserModelIds, ['io.github.agentarcade.desktop']); assert.deepEqual(h.calls.dockIcons, []);
  assert.equal(h.calls.trays[0].image.size, 32); assert.deepEqual(h.calls.trays[0].image.representations, []);
  const snapshot = await h.invoke('snapshot');
  assert.deepEqual(snapshot.qqRuntime, {observed: 'QQConsole'}); assert.deepEqual(snapshot.qqComponents, {observed: 'QQComponents'});
  // A QQ channel reaches its own handler (which validates the request), not the platform refusal.
  const answer = await h.invoke('qqRuntimeDirectory', {});
  assert.equal(answer.ok, false); assert.notEqual(answer.code, 'unsupported_platform');
  h.appEvents.get('window-all-closed')(); assert.equal(h.calls.quits, 1);
  h.appEvents.get('activate')(); assert.equal(h.calls.shows, 0);
  // With a tray the close button hides, as before.
  let prevented = 0; h.window.emit('close', {preventDefault() { prevented++; }}); assert.equal(prevented, 1);
});

test('Windows without a tray: the close button closes, as before', async t => {
  const h = await boot(t, {platform: 'win32', tray: false});
  let prevented = 0; h.window.emit('close', {preventDefault() { prevented++; }});
  assert.equal(prevented, 0); assert.equal(h.window.visible, true);
});

test('Linux start: same gating as macOS, same window lifecycle as Windows', async t => {
  const h = await boot(t, {platform: 'linux'});
  assert.deepEqual(h.calls.constructed, []); assert.deepEqual(h.calls.menus, []); assert.deepEqual(h.calls.appUserModelIds, []);
  assert.deepEqual({...await h.invoke('qqRuntimeRefresh')}, {ok: false, code: 'unsupported_platform'});
  h.appEvents.get('window-all-closed')(); assert.equal(h.calls.quits, 1);
});
