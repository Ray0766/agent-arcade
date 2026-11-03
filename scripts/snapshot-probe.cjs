'use strict';
// Aggregate IPC/DOM probe. Optional comparison: --baseline-ref <git-ref>.
// Does not collect hardware inventory, process IDs, or raw machine telemetry.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Store } = require('../src/core/store.cjs');
const { normalize } = require('../src/core/events.cjs');
const { atomicJSON } = require('../src/core/files.cjs');
const sourceRoot = path.resolve(__dirname, '..');
const baselineIndex = process.argv.indexOf('--baseline-ref');
const baselineRef = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : '';
const WINDOW_MS = 4200, STATIONS = 200;

async function runVariant(label, appDir, fixture) {
  const home = path.join(fixture, label);
  const store = new Store(), now = Date.now();
  for (let i = 0; i < STATIONS; i++) store.apply(normalize({
    session_id: `synthetic-idle-${i}`, hook_event_name: 'SessionStart', cwd: `/synthetic/station-${i}`,
  }, { now: now - 5000 + i }));
  atomicJSON(path.join(home, 'config.json'), { language: 'en', quiet: true, notifications: false, captureResults: false });
  atomicJSON(path.join(home, 'state.json'), store.export());
  const env = { ...process.env, AGENT_ARCADE_HOME: home, AGENT_ARCADE_CLAUDE_SETTINGS: path.join(home, 'settings.json') };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron'), args: [appDir], env, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    await page.locator('.task-card').first().waitFor();
    assert.equal(await page.locator('.task-card').count(), STATIONS);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(1500); // Exclude initial state delivery and rendering.
    await page.evaluate(() => {
      window.snapshotProbe = { messages: 0, structures: 0 };
      window.arcade.subscribe(() => window.snapshotProbe.messages++);
      const observer = new MutationObserver(records => { window.snapshotProbe.structures += records.length; });
      for (const id of ['stats', 'activity-list']) observer.observe(document.getElementById(id), { childList: true });
    });
    const sample = async () => {
      await page.evaluate(() => { window.snapshotProbe.messages = 0; window.snapshotProbe.structures = 0; });
      await page.waitForTimeout(WINDOW_MS);
      return page.evaluate(() => ({ ...window.snapshotProbe }));
    };
    const beforeAge = await page.locator('.task-card .age').first().innerText();
    const scene = await sample();
    const afterAge = await page.locator('.task-card .age').first().innerText();
    assert.notEqual(beforeAge, afterAge, 'Relative age stopped without snapshot deliveries');
    await page.locator('[data-view="activity"]').click();
    await page.waitForTimeout(1100);
    const activity = await sample();
    if (label === 'current') {
      assert.equal(scene.messages, 0, 'Idle scene received redundant snapshots');
      assert.equal(scene.structures, 0, 'Idle scene rebuilt structural DOM');
      assert.equal(activity.messages, 0, 'Idle activity view received redundant snapshots');
      assert.equal(activity.structures, 0, 'Idle activity view rebuilt structural DOM');
    }
    await page.locator('[data-view="scene"]').click();
    const event = normalize({ session_id: 'synthetic-active', hook_event_name: 'UserPromptSubmit', cwd: '/synthetic/activity-probe' });
    atomicJSON(path.join(home, 'inbox', `${event.at}-${event.id}.json`), event);
    const active = page.locator('.task-card').filter({ hasText: 'activity-probe' });
    await active.locator('.scene.running').waitFor({ timeout: 3500 });
    // Simulate clock passage in the isolated main process, not an actual OS
    // sleep or a five-minute wait. A derived state must still be published.
    await app.evaluate(() => {
      globalThis.arcadeProbeOriginalNow = Date.now;
      Date.now = () => globalThis.arcadeProbeOriginalNow() + 301000;
    });
    await active.locator('.scene.unknown').waitFor({ timeout: 3500 });
    await app.evaluate(() => { Date.now = globalThis.arcadeProbeOriginalNow; delete globalThis.arcadeProbeOriginalNow; });
    return { label, stationCount: STATIONS, sampleWindowMs: WINDOW_MS, scene, activity,
      relativeAgeAdvanced: true, newEventRendered: true, derivedStaleBoundaryRendered: true };
  } finally { await app.close(); }
}

(async () => {
  const tempBase = path.resolve(os.tmpdir());
  const fixture = fs.mkdtempSync(path.join(tempBase, 'arcade-snapshot-probe-'));
  try {
    const variants = [];
    if (baselineIndex >= 0) {
      if (!baselineRef) throw Error('--baseline-ref requires a local Git ref');
      const appDir = path.join(fixture, 'baseline-app');
      fs.mkdirSync(appDir);
      fs.cpSync(path.join(sourceRoot, 'src'), path.join(appDir, 'src'), { recursive: true });
      fs.copyFileSync(path.join(sourceRoot, 'package.json'), path.join(appDir, 'package.json'));
      for (const file of ['src/main.cjs', 'src/ui/app.js']) fs.writeFileSync(path.join(appDir, file), execFileSync('git', ['show', `${baselineRef}:${file}`], { cwd: sourceRoot }));
      variants.push(await runVariant('baseline', appDir, fixture));
    }
    variants.push(await runVariant('current', sourceRoot, fixture));
    const report = { purpose: 'Deterministic delivery/DOM activity check, not a CPU or memory benchmark', baselineRef: baselineRef || null,
      workload: '200 synthetic idle stations, reduced motion, one visible scene then activity view; initial rendering excluded', variants,
      limitations: ['A single 4.2-second sample per view; no claim of resource percentage improvement.', 'Stale boundary uses a test clock offset, not physical sleep/resume.', 'Other current modules are shared across the comparison; only main/UI delivery behavior is compared.'] };
    fs.mkdirSync(path.join(sourceRoot, 'outputs'), { recursive: true });
    const output = path.join(sourceRoot, 'outputs', 'snapshot-probe.json');
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (!path.resolve(fixture).startsWith(tempBase + path.sep)) throw Error('Unsafe probe cleanup');
    fs.rmSync(fixture, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
