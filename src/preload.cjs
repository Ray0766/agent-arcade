'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('arcade', {
  snapshot: () => ipcRenderer.invoke('arcade:snapshot'),
  demo: value => ipcRenderer.invoke('arcade:demo',value),
  configure: patch => ipcRenderer.invoke('arcade:config',patch),
  acknowledge: id => ipcRenderer.invoke('arcade:acknowledge',id),
  clear: () => ipcRenderer.invoke('arcade:clear'),
  install: () => ipcRenderer.invoke('arcade:install'),
  uninstall: () => ipcRenderer.invoke('arcade:uninstall'),
  importTheme: () => ipcRenderer.invoke('arcade:importTheme'),
  subscribe: callback => { const listener = (_e,data) => callback(data); ipcRenderer.on('arcade:snapshot',listener); return () => ipcRenderer.removeListener('arcade:snapshot',listener); },
});
