'use strict';
const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, dialog, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Store } = require('./core/store.cjs');
const { NotificationGate, coalesceChanges } = require('./core/notify.cjs');
const { atomicJSON, readJSON, drainInbox } = require('./core/files.cjs');
const integration = require('./core/integration.cjs');
const { validateTheme } = require('./core/theme.cjs');
const { demoStore } = require('./core/demo.cjs');
const { createIcon } = require('./core/icon.cjs');
const root = process.env.AGENT_ARCADE_HOME || path.join(os.homedir(), '.agent-arcade');
const settingsFile = process.env.AGENT_ARCADE_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
let config = { language: 'en', notifications: false, quiet: false, captureResults: false, alwaysOnTop: false, compact: false, theme: 'workshop', ...readJSON(path.join(root, 'config.json')) };
const live = new Store(readJSON(path.join(root, 'state.json')));
let demo = process.argv.includes('--demo'), sample = demoStore(), win, tray, quitting = false, problem = '', timer;
const gate = new NotificationGate();
const themes = new Map();
const store = () => demo ? sample : live;
const indexURL = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
function saveConfig() { atomicJSON(path.join(root, 'config.json'), config); }
function snapshot() { return { tasks: store().snapshot(), demo, config, installed: integration.installed(settingsFile), lastEventAt: live.lastEventAt, problem, theme: themes.get(config.theme) || themes.get('workshop'), themes: [...themes].map(([id,t])=>({id,name:t.name})) }; }
function publish() { if (win && !win.isDestroyed()) win.webContents.send('arcade:snapshot', snapshot()); }
function show() { if (win) { win.show(); win.focus(); } }
function applyWindow() {
  win.setAlwaysOnTop(config.alwaysOnTop === true);
  win.setMinimumSize(config.compact ? 440 : 900, config.compact ? 380 : 640);
  win.setSize(config.compact ? 490 : 1200, config.compact ? 600 : 830);
}
function register(channel, fn) {
  ipcMain.handle(`arcade:${channel}`, async (event, value) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== indexURL) throw Error('Untrusted sender');
    return fn(value);
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.whenReady().then(() => {
    if (!fs.existsSync(path.join(root,'config.json'))) config.language = app.getLocale().startsWith('zh') ? 'zh' : 'en';
    app.setAppUserModelId('io.github.agentarcade.desktop');
    for (const name of ['workshop','moonbase']) themes.set(name, validateTheme(readJSON(path.join(__dirname, 'themes', `${name}.json`))));
    const custom = readJSON(path.join(root, 'theme.json'), null);
    try { if (custom) themes.set('custom', validateTheme(custom)); } catch { problem = 'Saved theme is invalid; using Workshop.'; }
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    const icon = nativeImage.createFromBuffer(createIcon());
    win = new BrowserWindow({ width:1200, height:830, minWidth:900, minHeight:640, backgroundColor:'#f5f3ed', title:'Agent Arcade', autoHideMenuBar:true, icon,
      webPreferences:{ preload:path.join(__dirname,'preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true } });
    win.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.on('close', e => { if (!quitting && tray) { e.preventDefault(); win.hide(); } });
    register('snapshot', snapshot);
    register('demo', value => { demo = value === true; if (demo) sample = demoStore(); publish(); return snapshot(); });
    register('acknowledge', id => { if (typeof id === 'string') store().acknowledge(id); if (!demo) atomicJSON(path.join(root,'state.json'),live.export()); publish(); });
    register('clear', () => { store().clearFinished(); if (!demo) atomicJSON(path.join(root,'state.json'),live.export()); publish(); });
    register('config', patch => {
      if (!patch || typeof patch !== 'object') throw Error('Invalid settings');
      const oldCompact = config.compact;
      for (const k of ['notifications','quiet','captureResults','alwaysOnTop','compact']) if (typeof patch[k] === 'boolean') config[k] = patch[k];
      if (['en','zh'].includes(patch.language)) config.language = patch.language;
      if (themes.has(patch.theme)) config.theme = patch.theme;
      if (patch.captureResults === false) { for (const t of live.tasks.values()) t.result = ''; atomicJSON(path.join(root,'state.json'),live.export()); }
      saveConfig(); win.setAlwaysOnTop(config.alwaysOnTop); if (oldCompact !== config.compact) applyWindow(); publish(); return snapshot();
    });
    register('install', async () => {
      const { stdout } = await promisify(execFile)('node', ['-p','process.execPath'], { timeout:5000, windowsHide:true });
      const nodePath = stdout.trim();
      if (!path.isAbsolute(nodePath)) throw Error('Install Node.js 22 or newer, then restart Agent Arcade.');
      const result = integration.install({ settingsFile, root, sourceDir:__dirname, nodePath }); publish(); return result;
    });
    register('uninstall', () => { integration.uninstall(settingsFile); publish(); });
    register('importTheme', async () => {
      const picked = await dialog.showOpenDialog(win, { properties:['openFile'], filters:[{name:'Arcade theme', extensions:['json']}] });
      if (picked.canceled) return;
      const file = picked.filePaths[0]; if (fs.statSync(file).size > 32000) throw Error('Theme must be under 32 KB.');
      const theme = validateTheme(JSON.parse(fs.readFileSync(file,'utf8')));
      atomicJSON(path.join(root,'theme.json'),theme); themes.set('custom',theme); config.theme = 'custom'; saveConfig(); publish();
    });
    try {
      if (icon.isEmpty()) throw Error('Tray icon is empty');
      tray = new Tray(icon);
      tray.setToolTip('Agent Arcade'); tray.on('click',show);
      tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Agent Arcade',click:show},{label:'Quit',click:()=>{quitting=true;app.quit();}}]));
    } catch { tray = null; }
    applyWindow(); win.loadURL(indexURL);
    timer = setInterval(() => {
      try {
        const changes = drainInbox(root,live,{captureResults:config.captureResults}); problem = '';
        for (const c of coalesceChanges(changes)) if (!demo && gate.allow(c,{enabled:config.notifications,quiet:config.quiet,focused:win.isFocused() && win.isVisible()}) && Notification.isSupported()) {
          const zh = config.language === 'zh';
          const labels = zh ? {waiting:'需要你确认',error:'检测到错误',done:'回复结束 · 任务结果尚未验证'} : {waiting:'Needs your attention',error:'Error observed',done:'Response ended · outcome unverified'};
          const n = new Notification({title:`Agent Arcade · ${c.task.project}`,body:labels[c.task.state],silent:true});
          n.on('click',show); n.show();
        }
      } catch (error) { problem = `Event inbox: ${error.message}`; }
      publish();
    },1000);
  }).catch(error => { dialog.showErrorBox('Agent Arcade',error.message); app.quit(); });
}
app.on('before-quit', () => { quitting = true; clearInterval(timer); });
app.on('window-all-closed', () => app.quit());
