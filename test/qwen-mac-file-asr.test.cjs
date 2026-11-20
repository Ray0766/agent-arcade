'use strict';

// Darwin integration with the production resident worker and POSIX proof.
// The Qwen, torch and numpy modules in temporary PYTHONPATH are fixtures.
// The only child processes are a preinstalled Python and its synthetic child.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {QwenWarmFileAsr} = require('../src/voice/qwen-warm-file-asr.cjs');
const {createWarmFileAsrProvider} = require('../src/voice/warm-file-asr-runtime.cjs');
const {AsrGate} = require('../src/voice/asr-gate.cjs');

function ps(pid) {
  const probe = spawnSync('/bin/ps', ['-o', 'pid=,ppid=,pgid=,comm=', '-p', String(pid)], {encoding: 'utf8'});
  if (probe.error) throw probe.error;
  if (probe.status === 1 && !probe.stdout.trim() && !probe.stderr.trim()) return null;
  assert.equal(probe.status, 0, probe.stderr);
  const row = probe.stdout.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+?)$/);
  assert(row, 'unrecognized ps result for an owned fixture process');
  return {pid: Number(row[1]), parentPid: Number(row[2]), groupId: Number(row[3]), executable: row[4]};
}

function executablePaths(python) {
  const paths = [python];
  const framework = python.match(/^(.*\/Python\.framework\/Versions\/[^/]+)\/bin\/python[\d.]*$/)?.[1];
  if (framework) {
    const redirect = path.join(framework, 'Resources', 'Python.app', 'Contents', 'MacOS', 'Python');
    if (fs.existsSync(redirect)) paths.push(fs.realpathSync.native(redirect));
  }
  return paths;
}

async function eventually(fn, label) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = fn();
    if (value) return value;
    assert(Date.now() < deadline, label);
    await delay(10);
  }
}

const offline = {
  PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
  HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1',
};
const audio = sample => {
  const pcm = Buffer.alloc(8000);
  pcm.writeInt16LE(sample);
  return {pcm, sampleRate: 16000, durationSeconds: .25};
};

function setupModel(root) {
  const model = path.join(root, 'fixture model');
  const modules = path.join(root, 'fixture modules');
  fs.mkdirSync(model);
  fs.mkdirSync(modules);
  for (const name of ['config.json', 'model.safetensors', 'preprocessor_config.json']) {
    fs.writeFileSync(path.join(model, name), 'synthetic marker, no model weights');
  }
  for (const [name, version] of [['qwen_asr', '0.0.6'], ['transformers', '4.57.6']]) {
    const dist = path.join(modules, name + '-' + version + '.dist-info');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'METADATA'), 'Metadata-Version: 2.1\nName: ' + name + '\nVersion: ' + version + '\n');
  }
  fs.writeFileSync(path.join(modules, 'torch.py'), `
import types
cuda = types.SimpleNamespace(is_available=lambda: False)
backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: True))
float32 = 'synthetic-float32'
bfloat16 = 'synthetic-bfloat16'
float16 = 'synthetic-float16'

def set_num_threads(count):
    assert isinstance(count, int) and count > 0
`);
  fs.writeFileSync(path.join(modules, 'numpy.py'), `
float32 = 'synthetic-numpy-float32'

class Waveform:
    def __init__(self, pcm):
        self.sample = int.from_bytes(pcm[:2], 'little', signed=True)

    def astype(self, dtype):
        assert dtype == float32
        return self

    def __truediv__(self, divisor):
        assert divisor == 32768.0
        return self

    def fill(self, value):
        assert value == 0
        self.sample = 0

def frombuffer(pcm, dtype):
    assert dtype == '<i2' and len(pcm) == 8000
    return Waveform(pcm)
`);
  fs.writeFileSync(path.join(modules, 'qwen_asr.py'), `
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import types

def event(kind, **fields):
    with open(os.environ['ARCADE_FIXTURE_ASR_EVENTS'], 'a', encoding='utf-8') as output:
        output.write(json.dumps({'kind': kind, 'pid': os.getpid(), 'parentPid': os.getppid(), **fields}) + '\\n')

class Qwen3ASRModel:
    @staticmethod
    def from_pretrained(model_path, **kwargs):
        assert Path(model_path).is_dir()
        assert kwargs['local_files_only'] is True and kwargs['trust_remote_code'] is False
        assert kwargs['use_safetensors'] is True
        assert kwargs['dtype'] == 'synthetic-float32'
        assert kwargs['device_map'] in ('cpu', {'': 'cpu'})
        for key in ['HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_HUB_DISABLE_TELEMETRY', 'DO_NOT_TRACK']:
            assert os.environ.get(key) == '1'
        event('loaded')
        return Qwen3ASRModel()

    def transcribe(self, audio, language):
        waveform, rate = audio
        assert rate == 16000 and language in ('Chinese', 'English')
        if waveform.sample == 41:
            descendant = subprocess.Popen([sys.executable, '-S', '-c', 'import time; time.sleep(17)'],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                event('blocked', childPid=descendant.pid)
                time.sleep(16)
            finally:
                descendant.terminate()
                descendant.wait(timeout=2)
            raise RuntimeError('fixture job should have been cancelled')
        event('transcribed', sample=waveform.sample, language=language)
        return [types.SimpleNamespace(text='合成转写-' + str(waveform.sample))]
`);
  return {model, modules};
}

test('Darwin resident CPU file ASR proves readiness, closes exact processes and permits a new owner', {
  skip: process.platform !== 'darwin' ? 'requires a Darwin host' : false,
  timeout: 30000,
}, async t => {
  try {assert.equal(ps(process.pid)?.pid, process.pid);}
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('host sandbox does not allow read-only process inspection');
    throw error;
  }
  const pythonProbe = spawnSync(process.env.ARCADE_TEST_MAC_ASR_PYTHON || 'python3',
    ['-S', '-c', 'import sys; print(sys.executable)'], {encoding: 'utf8', timeout: 4000});
  if (pythonProbe.error?.code === 'ENOENT') return t.skip('no preinstalled Python 3');
  assert.equal(pythonProbe.status, 0, pythonProbe.stderr);
  const python = fs.realpathSync.native(pythonProbe.stdout.trim());
  const paths = executablePaths(python);
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'arcade-mac-file-asr-'));
  const {model, modules} = setupModel(root);
  const eventFile = path.join(root, 'synthetic-worker-events.ndjson');
  const children = [], hosts = [], gate = new AsrGate(), descendants = new Map();
  const events = () => fs.existsSync(eventFile)
    ? fs.readFileSync(eventFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : [];
  const provider = createWarmFileAsrProvider({root, gate,
    createAsr(options, onVerification) {
      const host = new QwenWarmFileAsr({...options, onVerification, timeoutMs: 7000,
        spawnProcess(file, args, options) {
          const env = {PATH: '/usr/bin:/bin', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
            PYTHONPATH: modules, ARCADE_FIXTURE_ASR_EVENTS: eventFile,
          };
          for (const [key, expected] of Object.entries(offline)) {
            assert.equal(options.env[key], expected);
            env[key] = options.env[key];
          }
          const child = spawn(file, args, {...options, env});
          children.push(child);
          return child;
        },
      });
      hosts.push(host);
      return host;
    },
  });
  const makeHost = () => provider.pipelineOptions().createAsr();
  t.after(async () => {
    // If a test assertion failed, clean up only the fixture processes created
    // here. The test still has to independently prove the normal close paths.
    try {await Promise.allSettled(hosts.map(host => host.close()));}
    finally {
      for (const [pid, owned] of descendants) {
        const observed = ps(pid);
        if (observed && observed.executable === owned.executable &&
          observed.groupId === owned.groupId && observed.parentPid === owned.parentPid) process.kill(pid, 'SIGKILL');
      }
      for (const child of children) {
        if (Number.isSafeInteger(child.pid) && child.exitCode === null &&
          child.signalCode === null && ps(child.pid)?.parentPid === process.pid) child.kill('SIGKILL');
      }
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
  const configFile = path.join(root, 'local-voice.json');
  const configuredPaths = {version: 1, asrPython: python, asrModel: model};
  const unverified = {configured: true, available: false, reason: 'asr_unverified'};
  assert.deepEqual(provider.availability(), {available: false, reason: 'asr_unavailable'});
  fs.writeFileSync(configFile, JSON.stringify(configuredPaths));
  assert.deepEqual(provider.availability(), unverified);
  assert.deepEqual(events(), [], 'configuration lookup must not launch or load anything');

  const verifyOwned = pid => {
    const row = ps(pid);
    assert.equal(row?.parentPid, process.pid);
    assert.equal(row.groupId, pid, 'ASR launches a dedicated process group');
    assert(paths.includes(fs.realpathSync.native(row.executable)), 'the child is the configured Python or its exact framework launcher');
    return row;
  };

  const normalHost = makeHost();
  assert.equal(normalHost.readySeen, false);
  const normal = randomUUID();
  const lease = gate.acquire({scopeId: 'synthetic-owner-a', jobId: normal});
  lease.attachResource(normalHost);
  assert.equal(await normalHost.transcribe(audio(11), {jobId: normal}), '合成转写-11');
  const first = verifyOwned(children[0].pid);
  assert.equal(normalHost.readySeen, true);
  assert.deepEqual(provider.availability(), {configured: true, available: true});
  assert.deepEqual(events().find(row => row.kind === 'loaded'), {kind: 'loaded', pid: first.pid, parentPid: process.pid});
  await normalHost.finish({jobId: normal, keepWarm: true});
  const resident = randomUUID();
  assert.equal(await normalHost.transcribe(audio(12), {jobId: resident, locale: 'en-US'}), '合成转写-12');
  await normalHost.finish({jobId: resident, keepWarm: true});
  assert.equal(children.length, 1);
  assert.equal(events().filter(row => row.kind === 'loaded').length, 1);
  assert.deepEqual(await normalHost.close(), {closed: true});
  await eventually(() => !ps(first.pid), 'normal close did not remove the first Python worker');
  lease.release();

  const blockedHost = makeHost();
  const successful = randomUUID();
  const pendingLease = gate.acquire({scopeId: 'synthetic-owner-b', jobId: successful});
  pendingLease.attachResource(blockedHost);
  assert.equal(await blockedHost.transcribe(audio(21), {jobId: successful}), '合成转写-21');
  await blockedHost.finish({jobId: successful, keepWarm: true});
  const second = verifyOwned(children[1].pid);
  const blockedJob = randomUUID();
  const controller = new AbortController();
  const blocked = blockedHost.transcribe(audio(41), {jobId: blockedJob, signal: controller.signal});
  blocked.catch(() => {});
  const started = await eventually(() => events().find(row => row.kind === 'blocked'), 'blocked Python inference did not create its fixture child');
  assert.equal(started.pid, second.pid);
  const descendant = ps(started.childPid);
  assert.equal(descendant?.parentPid, second.pid);
  assert.equal(descendant.groupId, second.groupId);
  descendants.set(descendant.pid, descendant);
  assert.throws(() => gate.acquire({scopeId: 'synthetic-elsewhere', jobId: randomUUID()}), {code: 'busy'});
  controller.abort();
  await assert.rejects(blocked, {code: 'cancelled'});
  assert.equal(blockedHost.closed, true);
  await eventually(() => !ps(second.pid) && !ps(descendant.pid), 'cancel left a Python process or descendant alive');
  pendingLease.release();

  fs.writeFileSync(configFile, JSON.stringify(configuredPaths, null, 2));
  assert.deepEqual(provider.availability(), unverified, 'a changed configuration requires a new verified worker');
  const retryHost = makeHost();
  const retryJob = randomUUID();
  const retry = gate.acquire({scopeId: 'synthetic-owner-c', jobId: retryJob});
  retry.attachResource(retryHost);
  assert.equal(await retryHost.transcribe(audio(31), {jobId: retryJob}), '合成转写-31');
  assert.deepEqual(provider.availability(), {configured: true, available: true});
  const final = verifyOwned(children[2].pid);
  assert.notEqual(final.pid, second.pid);
  assert.deepEqual(await retryHost.close(), {closed: true});
  await eventually(() => !ps(final.pid), 'new owner Python process survived final close');
  retry.release();
  assert.equal(gate.owner, null);
  assert(!events().some(row => row.kind === 'transcribed' && row.sample === 41), 'a cancelled result was reported');
});
