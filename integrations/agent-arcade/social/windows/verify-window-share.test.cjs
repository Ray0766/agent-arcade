'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const root = path.join(__dirname, 'window-share');
const source = path.join(root, 'host.cjs');
const pickerUrl = pathToFileURL(path.join(root, 'picker.html')).href;
const origin = 'http://127.0.0.1:9002';
const id = suffix => '00000000-0000-4000-8000-' + String(suffix).padStart(12, '0');
const chat = id(1);
const seat = { account: 'visitor', device: id(2), roomId: id(3), self: id(4), revision: 'current' };
const first = { id: 'window:1:0', name: 'First window' };
const chosen = { id: 'window:2:0', name: 'Chosen window' };
const own = { id: 'window:3:0', name: 'Picker itself' };
const screen = { id: 'screen:1:0', name: 'Whole screen' };

function ipcEmitter() {
  return Object.assign(new EventEmitter(), {
    handles: new Map(),
    handle(name, fn) { this.handles.set(name, fn); },
  });
}

function fakePort() {
  return Object.assign(new EventEmitter(), {
    messages: [], closed: false,
    postMessage(data) { this.messages.push(data); },
    close() { this.closed = true; },
    start() {},
  });
}

function fixture() {
  const queries = [];
  const timers = new Set();
  const pickers = [];
  const state = { member: seat.account, list: [first, chosen, own, screen] };
  const local = {
    setDisplayMediaRequestHandler(fn) { this.display = fn; },
  };
  class Picker extends EventEmitter {
    constructor(options) {
      super();
      assert.equal(options.webPreferences.session, local);
      assert.equal(options.webPreferences.sandbox, true);
      assert.equal(options.webPreferences.contextIsolation, true);
      assert.equal(options.webPreferences.nodeIntegration, false);
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: pickerUrl },
        ipc: ipcEmitter(),
        setWindowOpenHandler() {},
        executeJavaScript: async () => 1,
        postMessage: (...args) => { this.sends ??= []; this.sends.push(args); },
      });
      pickers.push(this);
    }
    loadFile(file) { assert.equal(file, path.join(root, 'picker.html')); }
    removeMenu() {}
    getMediaSourceId() { return own.id; }
    isDestroyed() { return !!this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    show() { this.visible = true; }
    hide() { this.visible = false; }
  }
  const electron = { BrowserWindow: Picker, session: { fromPartition: () => local } };
  const ordinaryRequire = createRequire(source);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), {
    module, __dirname: root, URL, URLSearchParams, AbortSignal,
    require: name => name === 'electron' ? electron : ordinaryRequire(name),
    setInterval(fn) { timers.add(fn); return fn; },
    clearInterval(fn) { timers.delete(fn); },
  });
  const frame = { url: origin + '/#chat/' + chat };
  const contents = Object.assign(new EventEmitter(), {
    ipc: ipcEmitter(), mainFrame: frame, isDestroyed: () => false,
  });
  const browserSession = {
    cookies: new EventEmitter(),
    async fetch(address, options) {
      const url = new URL(address);
      assert.equal(url.pathname, '/api/v1/conversations/' + chat + '/group-voice/' + seat.device);
      assert.equal(options.headers['X-Social-Account'], seat.account);
      assert.equal(options.credentials, 'include');
      assert.equal(options.redirect, 'error');
      queries.push(Object.fromEntries(url.searchParams));
      return { ok: true, json: async () => ({
        room: { chat, id: seat.roomId, self: seat.self, participants: [{ id: seat.self, number: state.member }] },
      }) };
    },
  };
  const share = module.exports.installWindowShare({
    contents, browserSession, origin, isActive: () => true,
    getParent: () => ({ isDestroyed: () => false }), listSources: async () => state.list,
  });
  async function open(senderFrame = frame) {
    const ports = [fakePort(), fakePort()];
    const [receive] = contents.ipc.listeners('arcade:openCallWindow');
    await receive({ sender: contents, senderFrame, ports }, seat);
    return ports;
  }
  return { browserSession, contents, local, open, pickers, queries, share, state, timers };
}

test('the trusted current seat can grant only the explicitly selected window and sends no capture audio', async () => {
  const f = fixture();
  const blocked = await f.open({ url: origin + '/#chat/' + chat });
  assert.equal(f.queries.length, 0);
  assert.ok(blocked.every(p => p.closed));
  f.state.member = 'other_user';
  const unseated = await f.open();
  assert.equal(f.pickers.length, 0);
  assert.ok(unseated.every(p => p.closed));

  f.state.member = seat.account;
  const [control, frames] = await f.open();
  assert.deepEqual(f.queries.at(-1), { revision: seat.revision, roomId: seat.roomId, self: seat.self });
  const [picker] = f.pickers;
  assert.equal(picker.visible, true);
  const frame = picker.webContents.mainFrame;
  const names = await picker.webContents.ipc.handles.get('share:windows')({ senderFrame: frame });
  assert.deepEqual(Array.from(names), [first.name, chosen.name]);
  const grants = [];
  await f.local.display({ frame, videoRequested: true, audioRequested: false, userGesture: true }, value => grants.push(value));
  assert.equal(grants.length, 1);
  assert.equal(grants[0].video, chosen);
  assert.equal(Object.hasOwn(grants[0], 'audio'), false);
  picker.webContents.ipc.emit('share:ready', { senderFrame: frame });
  picker.webContents.ipc.emit('share:ready', { senderFrame: frame });
  assert.equal(picker.sends.length, 1);
  assert.deepEqual(Array.from(picker.sends[0][2]), [frames]);
  assert.equal(picker.visible, false);

  const [poll] = f.timers;
  f.state.list = [first, own];
  await poll();
  assert.deepEqual(f.queries.at(-1), { revision: seat.revision });
  assert.equal(picker.isDestroyed(), true);
  assert.equal(control.closed, true);
  assert.deepEqual(control.messages, ['ended']);
  assert.equal(f.local.display, null);
  assert.equal(f.timers.size, 0);
  f.share.dispose();
});

test('selection cancellation, mismatched gestures, navigation and account changes revoke the picker', async () => {
  const f = fixture();
  const [control, frames] = await f.open();
  f.pickers[0].destroy();
  assert.deepEqual(control.messages, ['ended']);
  assert.equal(frames.closed, true);
  const [gesture] = await f.open();
  const picker = f.pickers.at(-1);
  const frame = picker.webContents.mainFrame;
  const grants = [];
  await f.local.display({ frame, videoRequested: true, audioRequested: false, userGesture: false }, value => grants.push(value));
  assert.deepEqual(grants, [null]);
  assert.deepEqual(gesture.messages, ['ended']);
  const [navigation] = await f.open();
  f.contents.emit('did-start-navigation', {}, origin + '/', false, true);
  assert.deepEqual(navigation.messages, ['ended']);
  const [retired] = await f.open();
  f.state.member = 'other_user';
  const [poll] = f.timers;
  await poll();
  assert.deepEqual(retired.messages, ['ended']);
  f.state.member = seat.account;
  const [cookie] = await f.open();
  f.browserSession.cookies.emit('changed', {}, { name: 'arcade_social', domain: '127.0.0.1' });
  assert.deepEqual(cookie.messages, ['ended']);
  f.contents.emit('destroyed');
  assert.equal(f.browserSession.cookies.listenerCount('changed'), 0);
});
