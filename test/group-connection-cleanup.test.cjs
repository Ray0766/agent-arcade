'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {BotService} = require('../src/bot/service.cjs');

for (const failed of ['client', 'execute']) test(`a failed ${failed} cleanup retains the exact owned handle for explicit recovery`, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-group-cleanup-'));
  const counts = {client: 0, execute: 0};
  let rejectCleanup = true;
  const execute = async () => {throw Error('No model invocation is expected');};
  execute.close = async () => {counts.execute++; if (failed === 'execute' && rejectCleanup) throw Error('Synthetic close failure');};
  const client = {
    accountId: '100001', ready: true,
    connect: async () => ({accountId: '100001'}),
    inspect: async () => ({accountId: '100001', ownerIsFriend: true, online: true}),
    sendText: async () => {throw Error('No send expected');},
    sendProactiveText: async () => {throw Error('No send expected');},
    publishQzoneText: async () => {throw Error('No publish expected');},
    getOwnQzonePost: async () => {throw Error('No read expected');},
    sendGroupText: async () => {throw Error('No group send expected');},
    close: async () => {counts.client++; if (failed === 'client' && rejectCleanup) throw Error('Synthetic close failure');},
  };
  const vault = {isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString()};
  const service = new BotService({root, vault, qqClientFactory: () => client, runnerFactory: () => execute});
  t.after(async () => {rejectCleanup = false; await service.disconnect(); fs.rmSync(root, {recursive: true, force: true});});
  service.configure({channel: 'qq', mode: 'api', key: 'SYNTHETIC_API_KEY', qqToken: 'SYNTHETIC_BRIDGE_TOKEN', qqOwnerId: '900001', qqAccountId: '100001', qqGroups: {enabled: true, groupIds: ['500001'], proactive: false}});
  service.socialConfigure({enabled: true});
  await service.connect({assertCurrent() {
    // Fail only after both companion/route objects exist, before any poll or
    // model call. This exercises actual startup rollback, not a copied array.
    if (service.status === 'connected') throw Object.assign(Error('Synthetic changed connection'), {code: 'changed'});
  }});
  assert.equal(service.status, 'disconnecting');
  assert.equal(service[failed], failed === 'client' ? client : execute, 'a failed close must remain reachable for retry');
  assert.equal(service[failed === 'client' ? 'execute' : 'client'], null, 'a successful close must release its own handle');
  assert.equal(service.groupRoute.snapshot().active, false);
  rejectCleanup = false;
  await service.disconnect();
  assert.equal(service.status, 'disconnected');
  assert.equal(service.client, null);
  assert.equal(service.execute, null);
  assert.equal(counts[failed], 2, 'explicit recovery retries exactly the retained failed object');
}
);
