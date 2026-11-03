'use strict';
// Reproducible preview resource probe. Uses a disposable home and synthetic data.
// Run: node scripts/measure.cjs [optional-output.json]
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { normalize } = require('../src/core/events.cjs');
const { atomicJSON } = require('../src/core/files.cjs');

const INTERVAL_MS = 1000, INTERVALS = 12, WARMUP_MS = 3000;
const budgets = {
  idle: { meanCPUPercentOfOneCoreBelow: 5, peakSummedWorkingSetMiBBelow: 300 },
  synthetic200Idle: { meanCPUPercentOfOneCoreBelow: 10, peakSummedWorkingSetMiBBelow: 500 },
};
const round = value => Math.round(value * 1000) / 1000;
const identity = metric => `${metric.pid}:${metric.creationTime}`;

async function reading(app) {
  const sample = await app.evaluate(({ app }) => ({
    monotonicNs: process.hrtime.bigint().toString(),
    processes: app.getAppMetrics().map(m => ({
      pid: m.pid, creationTime: m.creationTime, type: m.type,
      cumulativeCPUSeconds: m.cpu.cumulativeCPUUsage,
      workingSetKiB: m.memory.workingSetSize,
    })),
  }));
  assert(sample.processes.length > 0, 'No Electron process metrics');
  for (const metric of sample.processes) {
    assert(Number.isFinite(metric.cumulativeCPUSeconds), 'This Electron/platform does not expose cumulative CPU time');
    assert(Number.isFinite(metric.workingSetKiB), 'Missing process working set');
  }
  return sample;
}

async function measureStage(app, name, stationCount, budget) {
  await delay(WARMUP_MS);
  const raw = [await reading(app)];
  for (let i = 0; i < INTERVALS; i++) {
    await delay(INTERVAL_MS);
    raw.push(await reading(app));
  }
  const samples = [];
  let totalCPUSeconds = 0, totalWallSeconds = 0;
  for (let i = 1; i < raw.length; i++) {
    const before = raw[i - 1], after = raw[i];
    const previous = new Map(before.processes.map(m => [identity(m), m]));
    const wallSeconds = Number(BigInt(after.monotonicNs) - BigInt(before.monotonicNs)) / 1e9;
    let cpuSeconds = 0;
    const appeared = [], disappeared = [];
    for (const current of after.processes) {
      const old = previous.get(identity(current));
      if (old) cpuSeconds += Math.max(0, current.cumulativeCPUSeconds - old.cumulativeCPUSeconds);
      else appeared.push(identity(current));
    }
    const currentIDs = new Set(after.processes.map(identity));
    for (const old of before.processes) if (!currentIDs.has(identity(old))) disappeared.push(identity(old));
    totalCPUSeconds += cpuSeconds; totalWallSeconds += wallSeconds;
    samples.push({
      interval: i, wallSeconds: round(wallSeconds), cpuSeconds: round(cpuSeconds),
      cpuPercentOfOneCore: round(cpuSeconds / wallSeconds * 100),
      summedWorkingSetMiB: round(after.processes.reduce((sum, m) => sum + m.workingSetKiB, 0) / 1024),
      processCount: after.processes.length, appeared, disappeared,
    });
  }
  const meanCPUPercentOfOneCore = totalCPUSeconds / totalWallSeconds * 100;
  const peakSummedWorkingSetMiB = Math.max(...samples.map(s => s.summedWorkingSetMiB));
  const processSetStable = samples.every(s => s.appeared.length === 0 && s.disappeared.length === 0);
  const stage = {
    name, stationCount, synthetic: stationCount > 0, animations: 'Idle stations; reduced-motion media preference enabled',
    warmupSeconds: WARMUP_MS / 1000, intervals: INTERVALS,
    measuredWallSeconds: round(totalWallSeconds), totalCPUSeconds: round(totalCPUSeconds),
    meanCPUPercentOfOneCore: round(meanCPUPercentOfOneCore),
    peakIntervalCPUPercentOfOneCore: Math.max(...samples.map(s => s.cpuPercentOfOneCore)),
    peakSummedWorkingSetMiB, processSetStable, budget,
    withinPreviewBudget: processSetStable && meanCPUPercentOfOneCore < budget.meanCPUPercentOfOneCoreBelow && peakSummedWorkingSetMiB < budget.peakSummedWorkingSetMiBBelow,
    samples, raw,
  };
  console.log(`${name}: CPU ${stage.meanCPUPercentOfOneCore}% of one core; summed peak working set ${peakSummedWorkingSetMiB} MiB; preview budget ${stage.withinPreviewBudget ? 'met' : 'not met'}.`);
  return stage;
}

(async () => {
  const tempBase = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempBase, 'arcade-resource-'));
  // Raw process metrics stay in gitignored outputs unless explicitly redirected.
  const output = path.resolve(process.argv[2] || 'outputs/resources-private.json');
  const env = { ...process.env, AGENT_ARCADE_HOME: root, AGENT_ARCADE_CLAUDE_SETTINGS: path.join(root, 'claude-settings.json') };
  delete env.ELECTRON_RUN_AS_NODE;
  atomicJSON(path.join(root, 'config.json'), { language: 'en', notifications: false, quiet: true, captureResults: false });
  let app;
  try {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], env, timeout: 30000 });
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.bringToFront();
    await page.locator('#empty').waitFor();
    const runtime = await app.evaluate(({ app, screen, BrowserWindow }) => ({
      electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
      primaryDisplay: { scaleFactor: screen.getPrimaryDisplay().scaleFactor, size: screen.getPrimaryDisplay().size },
      windowBounds: BrowserWindow.getAllWindows()[0].getBounds(),
      windowVisible: BrowserWindow.getAllWindows()[0].isVisible(),
      windowFocused: BrowserWindow.getAllWindows()[0].isFocused(),
      appVersion: app.getVersion(),
    }));
    console.log('Preview budgets declared before measurement:', JSON.stringify(budgets));
    const idle = await measureStage(app, 'idle', 0, budgets.idle);
    const injectedAt = Date.now();
    for (let i = 0; i < 200; i++) {
      const event = normalize({ hook_event_name: 'SessionStart', session_id: `synthetic-${i}`, cwd: `/synthetic/station-${String(i).padStart(3, '0')}` }, { now: injectedAt + i });
      atomicJSON(path.join(root, 'inbox', `${event.at}-${event.id}.json`), event);
    }
    await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 200);
    const synthetic200Idle = await measureStage(app, 'synthetic200Idle', 200, budgets.synthetic200Idle);
    const report = {
      measuredAtUTC: new Date().toISOString(), command: 'node scripts/measure.cjs',
      purpose: 'One-machine preview resource check, not a user study or a real Claude workload benchmark',
      machine: { platform: os.platform(), release: os.release(), architecture: os.arch(), cpuModel: os.cpus()[0].model, logicalProcessors: os.cpus().length, totalMemoryGiB: round(os.totalmem() / 1024 ** 3) },
      runtime, protocol: {
        warmupSecondsPerStage: 3, intervalSeconds: 1, intervalsPerStage: 12,
        cpu: 'Sum of per-process cumulativeCPUUsage deltas divided by monotonic wall time, times 100. 100% means one logical core fully used; not normalized by logical core count.',
        memory: 'Sum of Electron app.getAppMetrics memory.workingSetSize KiB, divided by 1024. Shared pages can be counted once per process; this is not unique physical footprint.',
        workload: 'Normal foreground window. First stage has zero stations. Second injects 200 synthetic SessionStart events into the real inbox/reducer/UI; then measures settled idle stations with no further events. Reduced motion enabled.',
        excluded: 'Claude processes, observer startup cost, 200-event ingestion burst, animation cost, startup cost, sustained event throughput, long-term leaks, packaged builds, OS sleep/resume, multi-screen scaling, controller CPU, GPU hardware utilization.',
        processChurn: 'If a process appears/disappears between readings its final interval CPU is unavailable; raw readings are retained and any churn makes the preview budget verdict inconclusive/false.',
        references: ['https://www.electronjs.org/docs/latest/api/structures/cpu-usage', 'https://www.electronjs.org/docs/latest/api/structures/process-metric', 'https://www.electronjs.org/docs/latest/api/structures/memory-info'],
      },
      stages: [idle, synthetic200Idle],
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).stages.length, 2);
    console.log(`Resource evidence saved: ${output}`);
  } finally {
    if (app) await app.close();
    if (!path.resolve(root).startsWith(`${tempBase}${path.sep}`)) throw Error('Unsafe resource fixture cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
