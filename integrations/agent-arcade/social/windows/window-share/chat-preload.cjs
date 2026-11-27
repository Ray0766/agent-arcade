'use strict';
// This small sandbox preload can be registered on the Friends partition or
// included in its bundled privacy preload by the desktop integration.
const { ipcRenderer, contextBridge } = require('electron');
if (process.isMainFrame && /^https?:$/.test(location.protocol) && location.pathname === '/' && !location.search) {
  contextBridge.exposeInMainWorld('arcadeCallWindowAvailable', true);
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.type !== 'arcade-open-call-window' ||
        e.ports.length !== 2) return;
    if (!navigator.userActivation.isActive) {
      e.ports[0].postMessage('ended');
      e.ports.forEach(p => p.close());
      return;
    }
    ipcRenderer.postMessage('arcade:openCallWindow', e.data.seat, [...e.ports]);
  });
}
