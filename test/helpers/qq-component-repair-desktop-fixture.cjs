'use strict';
// Real HTTPS, SQLite, client, encrypted-container contract and Panel; only the
// signed-program metadata, code archive and process list are synthetic.
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { fixture: shell, deferred } = require('./qq-shell-code-repair-fixture.cjs');
const A = require('./qq-supervisor-app-fixture.cjs');
const { createService } = require('../../src/qq-supervisor/server.cjs');
const { SupervisorComponentRepair } = require('../../src/qq-supervisor/component-repair.cjs');
const { QQSupervisorClient } = require('../../src/bot/qq-supervisor-client.cjs');
const { QQSupervisorLinks } = require('../../src/bot/qq-supervisor-links.cjs');
const { QQSupervisorPanel } = require('../../src/bot/qq-supervisor-panel.cjs');

async function fixture(t, { enabled = true, wrapHelper, wrapClient, expectedQQ = A.QQ } = {}) {
  const f = shell(null), stateDir = path.join(f.temp, 'service'), appRoot = path.join(f.temp, 'app');
  fs.mkdirSync(stateDir); fs.mkdirSync(appRoot);
  const config = { instanceId: randomUUID(), expectedQQ, stateDir, token: A.TOKEN,
    installation: { componentStoreRoot: f.root, setupId: f.records[0].setupId, lockRoot: f.lockRoot },
    componentRepair: { enabled } };
  const runtimeCalls = [], runtime = { manager: { host: f.processHost },
    async observe() { runtimeCalls.push('observe'); throw Error('No healthy runtime discovery'); },
    async execute() { runtimeCalls.push('execute'); throw Error('No ordinary process action'); },
    async close() { return { closed: true }; } };
  let adapter, helper;
  const releases = [], clients = [], panels = [], network = [];
  const service = await createService({ config, tls: A.material, runtimeFactory: () => runtime,
    componentRepairFactory: (c, o) => (adapter = new SupervisorComponentRepair(c, { ...o,
      monotonic: () => f.state.mono,
      helperFactory: opts => { helper = f.make({ ...opts, io: f.io, packages: f.options.packages,
        stageFactory: f.options.stageFactory }); wrapHelper?.(helper); return helper; },
    })) });
  await service.listen(); service.server.on('request', r => network.push({ method: r.method, path: r.url }));
  const options = { origin: `https://remote.arcade.invalid:${service.server.address().port}`,
    trust: { caPem: A.material.caPem }, instanceId: config.instanceId, expectedQQ, token: A.TOKEN,
    lookup: async () => [{ address: A.REMOTE, family: 4 }], connect: A.mappedSocket };
  const parent = { remoteId: randomUUID(), panelId: randomUUID(), remoteRevision: randomUUID(),
    expectedQQ, parentGeneration: 1, contextKey: { synthetic: true }, origin: 'https://webui.arcade.invalid' };
  const base = { remoteId: parent.remoteId, panelId: parent.panelId };
  const links = new QQSupervisorLinks({ root: appRoot, vault: A.vault });
  const entry = links.create({ remoteId: parent.remoteId, remoteRevision: parent.remoteRevision,
    expectedQQ, label: 'Synthetic code repair', origin: options.origin,
    instanceId: config.instanceId, trust: options.trust, token: A.TOKEN });
  const ref = { ...base, supervisorId: entry.supervisorId };
  const makeClient = e => { const c = new QQSupervisorClient({ ...e, lookup: options.lookup, connect: options.connect });
    wrapClient?.(c); clients.push(c); return c; };
  const makePanel = (l = links) => { const p = new QQSupervisorPanel({ links: l,
    captureParent: () => structuredClone(parent), clientFactory: makeClient, monotonic: () => f.state.mono });
    panels.push(p); return p; };
  const panel = makePanel(); await panel.list(base);
  t.after(async () => { for (const release of releases) release(); f.state.stageHeld?.resolve(); f.state.closeError = false;
    for (const p of panels) await p.close(); for (const c of clients) await c.close();
    await service.close(); await f.cleanup(); });
  return { ...f, config, appRoot, service, adapter, runtimeCalls, options, clients, panels, network,
    parent, base, ref, entry, links, panel, makePanel, makeClient, vault: A.vault,
    get repairHelper() { return helper; },
    hold() { const d = deferred(); releases.push(d.resolve); return d; },
    async preview(action = 'repair', operationId = null) { const r = await panel.componentRepairRead(ref);
      return panel.componentRepairPreview({ ...ref, action,
        observationId: action === 'repair' ? r.inspection.observationId : null, operationId }); },
    async confirm() { const p = await this.preview(); return panel.componentRepairConfirm({ ...base, ticketId: p.preview.ticketId }); },
  };
}
module.exports = { fixture, deferred };
