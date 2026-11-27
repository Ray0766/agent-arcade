// Local desktop host only. Call synchronously from the share button's click.
export function startWindowShare(seat, {signal} = {}) {
  if (!window.arcadeCallWindowAvailable || !navigator.userActivation.isActive || signal?.aborted) return Promise.resolve(null);
  const control = new MessageChannel(), frames = new MessageChannel();
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  let track, ended = false, timer, startTimer, resolve, settled = false;
  const listeners = new Set();
  const ready = new Promise(r => { resolve = r; });
  function stop() {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    clearTimeout(startTimer);
    signal?.removeEventListener('abort',stop);
    window.removeEventListener('pagehide',stop);
    window.removeEventListener('hashchange',stop);
    control.port1.postMessage('stop');
    control.port1.close();
    frames.port1.close();
    context.clearRect(0,0,canvas.width,canvas.height);
    track?.requestFrame();
    track?.stop();
    resolve(null);
    for (const listener of listeners) listener();
    listeners.clear();
  }
  control.port1.onmessage = stop;
  control.port1.onmessageerror = stop;
  frames.port1.onmessageerror = stop;
  frames.port1.onmessage = ({data}) => {
    if (ended) return;
    try {
      if (track?.readyState === 'ended') return stop();
      const {width,height,pixels} = data;
      if (!(pixels instanceof ArrayBuffer) || !Number.isInteger(width) || !Number.isInteger(height) ||
          width < 1 || width > 1280 || height < 1 || height > 720 || pixels.byteLength !== width*height*4) return stop();
      if (canvas.width !== width || canvas.height !== height) { canvas.width=width; canvas.height=height; }
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels),width,height),0,0);
      if (!track) track = canvas.captureStream(0).getVideoTracks()[0];
      track.requestFrame();
      if (!settled) {
        settled = true;
        clearTimeout(startTimer);
        resolve({track, stop, onEnded(listener) {
          if (ended) listener(); else listeners.add(listener);
          return () => listeners.delete(listener);
        }});
      }
      timer = setTimeout(() => frames.port1.postMessage('next'),100);
    } catch { stop(); }
  };
  signal?.addEventListener('abort',stop,{once:true});
  window.addEventListener('pagehide',stop,{once:true});
  window.addEventListener('hashchange',stop,{once:true});
  startTimer = setTimeout(stop,120000);
  window.postMessage({type:'arcade-open-call-window',seat},location.origin,[control.port2,frames.port2]);
  frames.port1.postMessage('next');
  return ready;
}
