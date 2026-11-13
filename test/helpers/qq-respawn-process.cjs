'use strict';

// Local process fixture only: a supervisor replaces a worker when it exits.
// No QQ installation, account, network connection or user data is involved.
if (process.argv[2] === 'worker') {
  setInterval(() => {}, 1000);
} else {
  const { spawn } = require('node:child_process');
  let worker, stopping = false, shutdown;
  const workers = [];
  const startWorker = () => {
    if (stopping) return;
    worker = spawn(process.execPath, [__filename, 'worker'], {
      windowsHide: true, stdio: 'ignore',
    });
    const started = worker;
    started.once('spawn', () => { workers.push(started.pid); if (process.connected) process.send?.({ workerPid: started.pid }); });
    worker.once('exit', startWorker);
  };
  // Private fixture IPC, never a product control or numeric-PID kill fallback.
  // The ChildProcess handle identifies this exact worker even if an old PID is
  // later reused. Preserve the normal respawn behavior until explicit shutdown.
  function stopFixture() {
    if (shutdown) return shutdown;
    stopping = true;
    shutdown = (async () => {
      const active = worker;
      if (active && active.exitCode === null && active.signalCode === null) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('owned worker did not exit')), 2500);
          active.once('exit', () => { clearTimeout(timer); resolve(); });
          active.once('error', error => { clearTimeout(timer); reject(error); });
          if (!active.kill()) { clearTimeout(timer); reject(Error('owned worker shutdown failed')); }
        });
      }
      if (process.connected) process.send?.({ type:'fixture-stopped', workers }, () => process.exit(0));
      else process.exit(0);
    })().catch(() => {
      if (process.connected) process.send?.({ type:'fixture-shutdown-failed', workers });
      process.exitCode = 1;
    });
    return shutdown;
  }
  process.on('message', value => { if (value?.type === 'stop-fixture') void stopFixture(); });
  process.once('disconnect', () => { void stopFixture(); });
  startWorker();
}
