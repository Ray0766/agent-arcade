'use strict';
// Complete synthetic manifest and signed-program metadata, with real temporary
// NTFS objects. No package code or QQ process is executed by this fixture.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { randomUUID } = require('node:crypto');
const F = require('../../src/bot/qq-node-repair-fs.cjs');
const M = require('../../src/bot/qq-managed-shell-repair-metadata.cjs');
const { QQManagedShellCodeRepair } = require('../../src/bot/qq-managed-shell-code-repair.cjs');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture(t, { missing = false, manifest: suppliedManifest, archiveFile } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-shell-code-repair-'));
  const root = path.join(temp, 'components'), p = M.paths(root), lockRoot = path.join(temp, 'locks');
  fs.mkdirSync(p.versionRoot, { recursive: true }); fs.mkdirSync(lockRoot);
  if (!missing) { fs.mkdirSync(p.codeRoot); fs.writeFileSync(path.join(p.codeRoot, 'napcat.mjs'), 'SYNTHETIC_DAMAGED_CODE'); }
  const bodies = Object.fromEntries([...M.REQUIRED, 'static/index.html'].sort().map(name => [name, Buffer.from(`SYNTHETIC_REPAIRED ${name}`)]));
  const manifest = suppliedManifest || { schema: 'qq_component_prepared_v1', component: 'napcat-shell',
    versionId: M.RELEASE_ID, version: M.VERSION, source: { ...M.SOURCE }, preparedAt: '2026-11-08T00:00:00.000Z',
    requiredFiles: [...M.REQUIRED], directories: ['static'], files: Object.entries(bodies).map(([name, bytes]) =>
      ({ path: name, size: bytes.length, sha256: F.sha(bytes) })) };
  fs.writeFileSync(p.manifestPath, JSON.stringify(manifest) + '\n');
  const records = [];
  for (let i = 0; i < 2; i++) {
    const setupId = randomUUID(), ip = M.paths(root, setupId);
    fs.mkdirSync(ip.configDir, { recursive: true }); fs.mkdirSync(ip.qqDataDir);
    const value = { schema: 'qq_managed_shell_v1', setupId, installationId: F.sha(ip.installationRoot.toLowerCase()),
      engine: 'managed-shell', dataPolicy: 'isolated-new', createdAt: '2026-11-08T00:00:00.000Z',
      publication: { method: 'exclusive-link-v1', temporaryFile: `installation.${randomUUID()}.part` },
      qq: { file: path.join(temp, 'QQ.exe'), architecture: 'x64', size: 2048, sha256: 'a'.repeat(64),
        identity: { dev: 1, ino: 2, size: 2048, mtimeMs: 3 }, version: '9.9.36.53644', productName: 'QQ',
        companyName: 'Tencent', signature: { status: 'Valid', subject: 'CN=Tencent', thumbprint: 'a'.repeat(40) },
        observedAt: '2026-11-08T00:00:00.000Z' },
      current: { kind: 'prepared', version: M.VERSION, versionId: M.RELEASE_ID,
        manifestSha256: F.sha(fs.readFileSync(p.manifestPath)) }, previous: null };
    fs.writeFileSync(ip.descriptor, JSON.stringify(value) + '\n');
    fs.writeFileSync(path.join(ip.configDir, 'opaque.json'), 'SYNTHETIC_KEEP_CONFIG');
    fs.writeFileSync(path.join(ip.qqDataDir, 'opaque.db'), 'SYNTHETIC_KEEP_DATA');
    records.push({ setupId, paths: ip, value });
  }
  const state = { rows: [], mono: 1000, stageCalls: 0, stageHeld: null, stageError: null,
    stagePartial: false, closeError: false, onSnapshot: null, current: true };
  const io = Object.create(fs), opens = [];
  io.openSync = (file, ...args) => {
    opens.push(String(file));
    for (const row of records) if (String(file).startsWith(row.paths.configDir + path.sep) ||
        String(file).startsWith(row.paths.qqDataDir + path.sep)) throw Error('Recovery must not read account data');
    return fs.openSync(file, ...args);
  };
  const processHost = { snapshot: async () => { await state.onSnapshot?.(); return structuredClone(state.rows); },
    start() { throw Error('Recovery must not start processes'); }, stop() { throw Error('Recovery must not stop processes'); } };
  const packages = { verify: async () => ({ component: 'napcat-shell', version: M.VERSION,
    state: 'verified-staged', ...M.SOURCE, ...(archiveFile ? { file: archiveFile } : {}) }),
    stage() { throw Error('Shell recovery must not download'); } };
  const stageFactory = () => {
    let owned, stageRoot;
    return {
      async prepare({ operationDir, signal, assertCurrent }) {
        state.stageCalls++; F.current({ signal, assertCurrent });
        stageRoot = path.join(operationDir, 'staged-code'); fs.mkdirSync(path.join(stageRoot, 'static'), { recursive: true });
        for (const [name, bytes] of Object.entries(bodies)) { fs.writeFileSync(path.join(stageRoot, ...name.split('/')), bytes); if (state.stagePartial) break; }
        owned = F.tree(stageRoot); await state.stageHeld?.promise; F.current({ signal, assertCurrent });
        if (state.stageError) throw Object.assign(Error('Synthetic preparation error'), { code: state.stageError });
        return { path: stageRoot, proof: owned, source: { verification: 'full-pinned-archive-and-manifest',
          archiveBytes: M.SOURCE.size, fileCount: owned.files, totalBytes: owned.bytes } };
      },
      captureOwnedTree() { if (!owned) throw Error('No owned stage'); F.assertTree(stageRoot, owned); return F.tree(stageRoot); },
      async close() { if (state.closeError) throw Object.assign(Error('Synthetic close failure'), { code: 'shell_repair_cleanup_unconfirmed' }); return { closed: true }; },
    };
  };
  const options = { root, setupId: records[0].setupId, lockRoot, processHost, packages, io,
    monotonic: () => state.mono, ...(!archiveFile ? { stageFactory } : {}) };
  const helpers = [], make = (extra = {}) => { const h = new QQManagedShellCodeRepair({ ...options, ...extra }); helpers.push(h); return h; };
  const helper = make();
  async function cleanup() {
    state.closeError = false; state.stageHeld?.resolve();
    for (const h of helpers) await h.close();
    const actual = fs.realpathSync(temp), parent = fs.realpathSync(os.tmpdir());
    if (path.dirname(actual).toLowerCase() !== parent.toLowerCase() || !path.basename(actual).startsWith('arcade-shell-code-repair-')) throw Error('Unsafe fixture cleanup');
    fs.rmSync(actual, { recursive: true, force: true });
  }
  t?.after(cleanup);
  return { temp, root, p, lockRoot, records, manifest, bodies, state, io, opens, options, processHost, make, helper, cleanup };
}
module.exports = { fixture, deferred };
