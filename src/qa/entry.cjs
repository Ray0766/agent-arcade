'use strict';

// This entry exists only in the local QQ QA package. The production entry,
// profile namespace and credential policy remain in the recovered source.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { credentialStartupAllowed } = require('../core/credential-startup-policy.cjs');

const args = process.argv;
if (!credentialStartupAllowed(args) || args.some(arg => /^--arcade-(?:vault-migration|credential-)/.test(arg))) {
  app.exit(1);
} else {
  const root = fs.mkdtempSync('/private/tmp/arcade-qq-qa-profile.');
  fs.chmodSync(root, 0o700);
  const name = 'agent-arcade-qq-first-use-qa';
  const bundleId = 'io.github.agentarcade.qq-first-use-qa';
  const identity = require('../core/app-identity.cjs');
  identity.configureAppIdentity = application => {
    application.setName(name);
    return {name, bundleId};
  };
  app.setName(name);
  for (const type of ['userData', 'sessionData', 'crashDumps', 'logs']) {
    const directory = path.join(root, type);
    fs.mkdirSync(directory, {mode: 0o700});
    app.setPath(type, directory);
  }
  process.env.AGENT_ARCADE_HOME = path.join(root, 'data');
  process.env.AGENT_ARCADE_CLAUDE_SETTINGS = path.join(root, 'unused-claude-settings.json');
  const single = require('../core/single-instance.cjs');
  const acquire = single.acquireSingleInstance;
  single.acquireSingleInstance = options => acquire({...options, namespace:name});
  if (args.includes('--arcade-qa-verify')) {
    require('./verify.cjs').arm({app, root});
  }
  module.exports = require('../bootstrap.cjs');
}
