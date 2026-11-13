'use strict';
// Capability check only. No account credentials, messages or model requests.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { MessageJournal } = require('../src/bot/journal.cjs');
if (process.argv.includes('--child')) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-sqlite-probe-'));
  try {
    const journal = new MessageJournal({ root });
    if (!journal.claim('synthetic-owner', 'synthetic-message', 'api')) throw Error('Claim failed');
    const reopened = new MessageJournal({ root });
    const duplicateSuppressed = !reopened.claim('synthetic-owner', 'synthetic-message', 'native');
    if (!duplicateSuppressed || reopened.snapshot().interrupted !== 1) throw Error('Restart check failed');
    console.log(JSON.stringify({ electron: process.versions.electron || null, node: process.versions.node,
      sqlite: true, duplicateSuppressed, uncertainAfterRestart: reopened.snapshot().interrupted }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
} else {
  const receipt = {
    system: JSON.parse(execFileSync(process.execPath, [__filename, '--child'], { encoding: 'utf8', windowsHide: true })),
    electron: JSON.parse(execFileSync(require('electron'), [__filename, '--child'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true
    }))
  };
  console.log(JSON.stringify(receipt, null, 2));
}
