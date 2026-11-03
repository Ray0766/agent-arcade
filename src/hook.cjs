#!/usr/bin/env node
'use strict';
// Observer only: never print decisions, deny actions, or fail a Claude hook.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalize } = require('./core/events.cjs');
const { atomicJSON, readJSON } = require('./core/files.cjs');
const timer = setTimeout(() => process.exit(0), 1500);
let data = ''; let bytes = 0;
process.stdin.on('data', chunk => {
  bytes += chunk.length;
  if (bytes > 2 * 1024 * 1024) process.exit(0);
  data += chunk;
});
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    const root = process.env.AGENT_ARCADE_HOME || path.join(os.homedir(), '.agent-arcade');
    const config = readJSON(path.join(root, 'config.json'));
    const e = normalize(JSON.parse(data), { captureResults: config.captureResults === true });
    if (e) {
      const inbox = path.join(root, 'inbox');
      fs.mkdirSync(inbox, { recursive: true, mode: 0o700 });
      // Bound offline storage. Drop oldest events after 24h or 2,000 entries.
      const names = fs.readdirSync(inbox).filter(n => /^\d+-[\w-]+\.json$/.test(n)).sort();
      for (let i = 0; i < names.length; i++) if (i < names.length - 1999 || Number(names[i].split('-')[0]) < Date.now() - 86400000) fs.unlinkSync(path.join(inbox, names[i]));
      atomicJSON(path.join(inbox, `${e.at}-${e.id}.json`), e);
    }
  } catch { /* Observability must not interrupt the agent. */ }
  clearTimeout(timer);
  process.exit(0);
});
