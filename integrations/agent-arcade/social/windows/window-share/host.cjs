'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { BrowserWindow, desktopCapturer, session } = require('electron');

const pickerFile = path.join(__dirname, 'picker.html');
const pickerUrl = pathToFileURL(pickerFile).href;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const listWindows = () => desktopCapturer.getSources({ types: ['window'],
  thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });

function installWindowShare({ contents, browserSession, origin, isActive, getParent, listSources = listWindows }) {
  const partition = 'call-window-'+randomUUID();
  let active;
  function revoke() { active?.end(); }
  function navigation(_event, _url, _inPlace, mainFrame) { if (mainFrame) revoke(); }
  function changed(_event, cookie) {
    if (cookie.name === 'arcade_social' && cookie.domain?.replace(/^\./, '') === new URL(origin).hostname) revoke();
  }
  async function open(event, seat) {
    const [control, frames] = event.ports;
    function reject() {
      control?.postMessage('ended');
      for (const port of event.ports) port.close();
    }
    const frame = event.senderFrame;
    let address;
    try { address = new URL(frame.url); } catch { return reject(); }
    const chat = address.hash.slice(6);
    const trusted = () => !contents.isDestroyed() && isActive() && event.sender === contents &&
      frame === contents.mainFrame && frame.url === address.href;
    if (event.ports.length !== 2 || active || !trusted() || address.origin !== origin ||
        address.pathname !== '/' || address.search || !address.hash.startsWith('#chat/') || !uuid.test(chat) ||
        !seat || ![seat.device, seat.roomId, seat.self].every(v => typeof v === 'string' && uuid.test(v)) ||
        typeof seat.account !== 'string' || !/^[a-z0-9_]{4,24}$/.test(seat.account) ||
        typeof seat.revision !== 'string' || !seat.revision || seat.revision.length > 180) return reject();

    let picker, isolated, timer, ended = false, transferred = false, checking = false;
    let choices = [], selected, used = false;
    const current = () => !ended && trusted();
    function end() {
      if (ended) return;
      ended = true;
      active = undefined;
      clearInterval(timer);
      try { control.postMessage('ended'); } finally { control.close(); }
      if (!transferred) frames.close();
      if (isolated) isolated.setDisplayMediaRequestHandler(null);
      if (picker && !picker.isDestroyed()) picker.destroy();
    }
    active = { end };
    control.on('message', end);
    control.once('close', end);
    control.start();
    // Full lookup binds both the session cookie and device. Discovery checks
    // during playback must not renew an abandoned seat's server lease.
    async function validSeat(full) {
      if (!current()) return false;
      const query = new URLSearchParams({ revision: seat.revision });
      if (full) { query.set('roomId', seat.roomId); query.set('self', seat.self); }
      const response = await browserSession.fetch(origin+'/api/v1/conversations/'+chat+'/group-voice/'+seat.device+'?'+query,
        { credentials: 'include', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(2500),
          headers: { 'X-Social-Account': seat.account } });
      if (!response.ok || !current()) return false;
      const { room } = await response.json();
      return current() && room?.chat === chat && room.id === seat.roomId && (!full || room.self === seat.self) &&
        room.participants.some(p => p.id === seat.self && p.number === seat.account);
    }
    try {
      if (!await validSeat(true)) return end();
      const parent = getParent();
      if (!parent || parent.isDestroyed()) return end();
      isolated = session.fromPartition(partition, { cache: false });
      picker = new BrowserWindow({ parent, width: 430, height: 275, minWidth: 340, minHeight: 275, useContentSize: true, show: false, autoHideMenuBar: true,
        title: '选择共享窗口', webPreferences: { session: isolated, preload: path.join(__dirname,'capture.cjs'),
          sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, backgroundThrottling: false } });
      picker.removeMenu();
      const local = picker.webContents;
      const localFrame = f => current() && !picker.isDestroyed() && f === local.mainFrame && f.url === pickerUrl;
      local.setWindowOpenHandler(() => ({ action: 'deny' }));
      local.on('will-navigate', e => e.preventDefault());
      local.once('render-process-gone', end);
      picker.once('closed', end);
      local.ipc.handle('share:windows', async e => {
        if (!localFrame(e.senderFrame) || used) return [];
        const windows = await listSources();
        if (!localFrame(e.senderFrame) || used) return [];
        choices = windows.filter(s => s.id.startsWith('window:') && s.id !== picker.getMediaSourceId());
        return choices.map(s => s.name);
      });
      local.ipc.on('share:stop', e => { if (localFrame(e.senderFrame)) end(); });
      isolated.setDisplayMediaRequestHandler(async (request, answer) => {
        let grant;
        try {
          if (used || !localFrame(request.frame) || !request.userGesture ||
              !request.videoRequested || request.audioRequested) return;
          used = true;
          const index = await local.executeJavaScript("document.getElementById('target').selectedIndex - 1");
          const choice = choices[index];
          if (!choice || !await validSeat(true)) return;
          const windows = await listSources();
          selected = windows.find(s => s.id === choice.id && s.id.startsWith('window:'));
          if (selected && localFrame(request.frame)) grant = { video: selected };
        } catch { grant = undefined; }
        finally { answer(grant || null); if (!grant) end(); }
      });
      local.ipc.on('share:ready', e => {
        if (!selected || !localFrame(e.senderFrame) || transferred) return;
        local.postMessage('share:frames', null, [frames]);
        transferred = true;
        picker.hide();
      });
      timer = setInterval(async () => {
        if (checking || ended) return;
        checking = true;
        try {
          if (!await validSeat(false) || (selected && !(await listSources()).some(s => s.id === selected.id))) end();
        } catch { end(); } finally { checking = false; }
      }, 1500);
      await picker.loadFile(pickerFile);
      if (current()) picker.show(); else end();
    } catch { end(); }
  }
  contents.ipc.on('arcade:openCallWindow', open);
  contents.on('did-start-navigation', navigation);
  contents.on('render-process-gone', revoke);
  browserSession.cookies.on('changed', changed);
  function dispose() {
    revoke();
    browserSession.cookies.removeListener('changed', changed);
    contents.removeListener('did-start-navigation', navigation);
    contents.removeListener('render-process-gone', revoke);
    if (!contents.isDestroyed()) contents.ipc.removeListener('arcade:openCallWindow', open);
    contents.removeListener('destroyed', dispose);
  }
  contents.once('destroyed', dispose);
  return { revoke, dispose };
}
module.exports = { installWindowShare };
