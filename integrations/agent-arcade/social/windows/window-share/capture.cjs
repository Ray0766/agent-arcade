'use strict';
const { ipcRenderer } = require('electron');
const stop = () => ipcRenderer.send('share:stop');
let video, stream;
window.addEventListener('DOMContentLoaded', async () => {
  const select = document.getElementById('target'), button = document.getElementById('share');
  document.getElementById('cancel').onclick = stop;
  window.addEventListener('keydown', e => { if (e.key === 'Escape') stop(); });
  select.onchange = () => { button.disabled = !select.value; };
  button.onclick = async e => {
    if (!e.isTrusted || !select.value || button.disabled) return;
    button.disabled = select.disabled = true;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { max: 10 } }, audio: false });
      const [track] = stream.getVideoTracks();
      if (!track || stream.getTracks().length !== 1) return stop();
      track.addEventListener('ended', stop, { once: true });
      video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      ipcRenderer.send('share:ready');
    } catch { stop(); }
  };
  try {
    const names = await ipcRenderer.invoke('share:windows');
    names.forEach((name,index) => select.add(new Option(name,String(index+1))));
    select.focus();
  } catch { stop(); }
});
window.addEventListener('pagehide', () => stream?.getTracks().forEach(t => t.stop()), {once:true});
// Only the granted window's pixels cross this port. A pull limits outstanding
// buffers to one; neither sender nor receiver queues frames for a slow peer.
ipcRenderer.once('share:frames', e => {
  const [port] = e.ports;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d',{willReadFrequently:true});
  let busy = false;
  port.onmessage = async ({data}) => {
    if (data !== 'next' || busy || !video) return;
    busy = true;
    try {
      const scale = Math.min(1,1280/video.videoWidth,720/video.videoHeight);
      const w = Math.max(1,Math.round(video.videoWidth*scale)), h = Math.max(1,Math.round(video.videoHeight*scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.drawImage(video,0,0,w,h);
      const pixels = ctx.getImageData(0,0,w,h).data.buffer;
      port.postMessage({width:w,height:h,pixels},[pixels]);
    } catch { stop(); } finally { busy = false; }
  };
  port.onmessageerror = stop;
});
