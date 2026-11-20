'use strict';

// Real Darwin Python, worker protocol and owned process proof. The model
// stack is synthetic, and only the public fixed reference WAV is read.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn, spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {GptSovitsSpeech} = require('../src/voice/gpt-sovits.cjs');
const {QQVoiceRenderer} = require('../src/voice/qq-render.cjs');
const {QQOwnerVoice} = require('../src/bot/qq-voice.cjs');
const {canonicalWav} = require('../src/bot/qq-voice-payload.cjs');

const checkpoints = {
  'pretrained_models/s1v3.ckpt': '87133414860ea14ff6620c483a3db5ed07b44be42e2c3fcdad65523a729a745a',
  'pretrained_models/v2Pro/s2Gv2ProPlus.pth': 'd42a22bbbf65fb2bbdd45ad6a66841156977db45c7aabe0a6992ff378d9c7d3b',
  'pretrained_models/sv/pretrained_eres2netv2w24s4ep4.ckpt': '4f5a0bf73c61eb41b174e1bb54e7ee3c83233892be8e0af1f187024e8e581a35',
  'pretrained_models/chinese-hubert-base/pytorch_model.bin': '24164f129c66499d1346e2aa55f183250c223161ec2770c0da3d3b08cf432d3c',
  'pretrained_models/chinese-roberta-wwm-ext-large/pytorch_model.bin': 'e53a693acc59ace251d143d068096ae0d7b79e4b1b503fa84c9dcf576448c1d8',
  'text/G2PWModel/g2pW.onnx': '2eb3c71fd95117b2e1abef8d2d0cd78aae894bbe7f0fac105ddc9c32ce63cbd0',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const referenceSha = '20a9b9c687db1dc2e9c5783c3e915c9694e49118fff9e72dad56b1c32a37d179';
const firstText = '第一句合成测试。', blockedText = '取消这条合成测试。', nextText = '重开后的合成测试。';

function write(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, data);
}

function setupFixture(root) {
  const repo = path.join(root, 'fixture repo');
  const modules = path.join(root, 'fixture modules');
  const reference = path.join(root, 'fixed Serena reference.wav');
  const eventFile = path.join(root, 'synthetic-render.ndjson');
  fs.copyFileSync(path.join(__dirname, '../src/assets/voice/serena-reference.wav'), reference);
  assert.equal(sha256(fs.readFileSync(reference)), referenceSha);
  const syntheticHashes = {};
  for (const [relative, expected] of Object.entries(checkpoints)) {
    const marker = `synthetic macOS render checkpoint marker: ${relative}\n`;
    write(path.join(repo, 'GPT_SoVITS', relative), marker);
    syntheticHashes[sha256(marker)] = expected;
  }
  // The test shim translates only the six exact marker digests. The public
  // reference WAV and the worker's completed render digest use real SHA-256.
  write(path.join(modules, 'sitecustomize.py'), `
import hashlib
_real_sha256 = hashlib.sha256
_synthetic_hashes = ${JSON.stringify(syntheticHashes)}

class FixtureDigest:
    def __init__(self, data=b'', **options):
        self.native = _real_sha256(data, **options)

    def update(self, data):
        self.native.update(data)

    def hexdigest(self):
        digest = self.native.hexdigest()
        return _synthetic_hashes.get(digest, digest)

    def __getattr__(self, key):
        return getattr(self.native, key)

hashlib.sha256 = FixtureDigest
`);
  write(path.join(modules, 'fixture_events.py'), `
import json
import os

def event(kind, **fields):
    with open(os.environ['ARCADE_FIXTURE_TTS_EVENTS'], 'a', encoding='utf-8') as output:
        output.write(json.dumps({'kind': kind, 'pid': os.getpid(), 'parentPid': os.getppid(), **fields}) + '\\n')
`);
  write(path.join(modules, 'torch.py'), `
from contextlib import nullcontext
from fixture_events import event

def __getattr__(name):
    if name in ('cuda', 'backends'):
        event('denied', dependency=name)
        raise AssertionError(name)
    raise AttributeError(name)

def set_num_threads(count):
    assert count == 1

def from_numpy(value):
    return value

inference_mode = nullcontext
`);
  write(path.join(modules, 'sounddevice.py'), `
from fixture_events import event
event('denied', dependency='sounddevice')
raise AssertionError('render must not import playback')
`);
  write(path.join(modules, 'torchaudio.py'), `
def load(*args, **kwargs):
    raise AssertionError('worker must replace the reference loader')
`);
  write(path.join(modules, 'soundfile.py'), `
import wave

class Reference:
    def __init__(self, frames, channels):
        self.frames = frames
        self.shape = (frames, channels)
        self.T = self

    def __len__(self):
        return self.frames

    def copy(self):
        return Reference(*self.shape)

def read(filename, *, dtype, always_2d):
    assert dtype == 'float32' and always_2d is True
    with wave.open(filename, 'rb') as audio:
        assert audio.getsampwidth() == 2
        return Reference(audio.getnframes(), audio.getnchannels()), audio.getframerate()
`);
  write(path.join(modules, 'numpy.py'), `
import builtins
import struct
from fixture_events import event

int16 = 'int16'

class Pcm:
    ndim = 1
    dtype = int16

    def __init__(self, raw):
        self.raw = bytearray(raw)
        self.size = len(self.raw) // 2

    def __getitem__(self, samples):
        assert samples.step is None
        return Pcm(self.raw[samples.start * 2:samples.stop * 2])

    def astype(self, dtype, *, copy):
        assert dtype == '<i2' and copy is False
        return self

    def tobytes(self):
        return bytes(self.raw)

    def fill(self, sample):
        assert sample == 0
        self.raw[:] = b'\\0' * len(self.raw)
        event('pcm-cleared', samples=self.size, allZero=not builtins.any(self.raw))

def audio(sample):
    return Pcm(struct.pack('<h', sample) * 9600)

def asarray(pcm):
    assert isinstance(pcm, Pcm)
    return pcm

def any(pcm):
    return builtins.any(pcm.raw)
`);
  write(path.join(modules, 'fast_langdetect/resources/lid.176.ftz'), 'synthetic language detector marker');
  write(path.join(modules, 'fast_langdetect/__init__.py'), `
from pathlib import Path
from types import SimpleNamespace

class LangDetectConfig:
    def __init__(self, custom_model_path, allow_fallback):
        assert allow_fallback is False
        assert Path(custom_model_path).read_text() == 'synthetic language detector marker'

class LangDetector:
    def __init__(self, config):
        assert isinstance(config, LangDetectConfig)

infer = SimpleNamespace(LangDetectConfig=LangDetectConfig, LangDetector=LangDetector)
`);
  write(path.join(repo, 'GPT_SoVITS/TTS_infer_pack/TTS.py'), `
import os
from pathlib import Path
import subprocess
import sys
import time
import numpy as np
import torchaudio
from fixture_events import event

class TTS_Config:
    def __init__(self, config):
        self.params = config['custom']
        for name in ('t2s_weights_path', 'vits_weights_path'):
            assert Path(self.params[name]).read_text().startswith('synthetic macOS render checkpoint marker: ')

class TTS:
    def __init__(self, config):
        params = config.params
        assert params['device'] == 'cpu' and params['is_half'] is False and params['version'] == 'v2ProPlus'
        assert os.environ['HF_HUB_OFFLINE'] == os.environ['TRANSFORMERS_OFFLINE'] == '1'
        event('loaded', device=params['device'], half=params['is_half'])

    def run(self, options):
        assert options['text_lang'] == options['prompt_lang'] == 'all_zh'
        assert options['seed'] == 20261105 and options['speed_factor'] == 1.0
        assert not any(options[key] for key in ('streaming_mode', 'parallel_infer', 'use_cuda_graph', 'use_flash_attention'))
        reference, rate = torchaudio.load(options['ref_audio_path'])
        assert rate == 24000 and reference.shape[1] == 1
        if options['text'] == ${JSON.stringify(blockedText)}:
            # Leave a partial PCM frame in the live host before cancellation.
            yield 32000, np.audio(22)
            child = subprocess.Popen([sys.executable, '-S', '-c', 'import time; time.sleep(18)'],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                event('blocked', childPid=child.pid)
                time.sleep(17)
            finally:
                child.terminate()
                child.wait(timeout=2)
            raise RuntimeError('fixture expected cancellation')
        sample = {${JSON.stringify(firstText)}: 11, ${JSON.stringify(nextText)}: 33}[options['text']]
        yield 32000, np.audio(sample)
        event('completed', sample=sample)
`);
  return {repo, modules, reference, eventFile};
}

function ps(pid) {
  const result = spawnSync('/bin/ps', ['-o', 'pid=,ppid=,pgid=,uid=,comm=', '-p', String(pid)], {encoding: 'utf8'});
  if (result.error) throw result.error;
  if (result.status === 1 && !result.stdout.trim() && !result.stderr.trim()) return null;
  assert.equal(result.status, 0, result.stderr);
  const row = result.stdout.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)$/);
  assert(row, 'unexpected ps response for an owned test process');
  return {pid: Number(row[1]), parentPid: Number(row[2]), groupId: Number(row[3]), uid: Number(row[4]), executable: row[5]};
}

async function eventually(fn, label) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const result = fn();
    if (result) return result;
    assert(Date.now() < deadline, label);
    await delay(10);
  }
}

test('Darwin local voice renders clean PCM on CPU and cancels only the owned worker group', {
  skip: process.platform !== 'darwin' ? 'requires a Darwin host' : false,
  timeout: 30000,
}, async t => {
  try { assert.equal(ps(process.pid)?.pid, process.pid); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('host sandbox does not allow read-only process inspection');
    throw error;
  }
  const homebrew = '/opt/homebrew/bin/python3';
  const command = process.env.ARCADE_TEST_MAC_TTS_PYTHON || (fs.existsSync(homebrew) ? homebrew : 'python3');
  const probe = spawnSync(command, ['-S', '-c', 'import sys; print(sys.executable)'], {encoding: 'utf8', timeout: 4000});
  if (probe.error?.code === 'ENOENT') return t.skip('no preinstalled Python 3');
  assert.equal(probe.status, 0, probe.stderr);
  const python = fs.realpathSync.native(probe.stdout.trim());
  const framework = python.match(/^(.*\/Python\.framework\/Versions\/[^/]+)\/bin\/python[\d.]*$/)?.[1];
  const executables = [python];
  const redirected = framework && path.join(framework, 'Resources/Python.app/Contents/MacOS/Python');
  if (redirected && fs.existsSync(redirected)) executables.push(fs.realpathSync.native(redirected));
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'arcade-mac-tts-render-'));
  let stopFixtures = async () => {};
  t.after(async () => {
    try { await stopFixtures(); }
    finally { fs.rmSync(root, {recursive: true, force: true}); }
  });
  const {repo, modules, reference, eventFile} = setupFixture(root);
  const children = [], hosts = [], descendants = [];
  const events = () => fs.existsSync(eventFile)
    ? fs.readFileSync(eventFile, 'utf8').trim().split('\n').filter(Boolean).map(row => JSON.parse(row))
    : [];

  const makeHost = () => {
    const host = new GptSovitsSpeech({
      pythonPath: python, repoPath: repo, referencePath: reference, renderOnly: true,
      spawnProcess(file, args, options) {
        assert.equal(file, python);
        assert.equal(args.at(-1), '--render-only');
        assert.equal(options.detached, true);
        assert.equal(options.shell, false);
        assert.equal(options.env.PYTHONNOUSERSITE, '1');
        assert.equal(Object.hasOwn(options.env, 'PYTHONPATH'), false);
        const child = spawn(file, args, {
          ...options,
          env: {...options.env, HOME: root, PATH: '/usr/bin:/bin', PYTHONPATH: modules,
            PYTHONDONTWRITEBYTECODE: '1', ARCADE_FIXTURE_TTS_EVENTS: eventFile},
        });
        children.push(child);
        return child;
      },
    });
    hosts.push(host);
    return host;
  };
  const firstHost = makeHost();
  let verifiedHost = firstHost;
  const renderer = new QQVoiceRenderer({
    createSpeech() {
      if (!verifiedHost) return makeHost();
      const host = verifiedHost;
      verifiedHost = null;
      return host;
    },
    captureRuntime: () => 'a'.repeat(64),
  });
  const socket = {readyState: 1}, accountId = '87654321', ownerId = '12345678', groupId = '55556666';
  const calls = [];
  const client = {
    ready: true, generation: 1, socket, accountId, ownerId,
    async sendGroupRecord(target, bytes, ticketId, signal, {assertCurrent}) {
      assert.equal(target, groupId);
      assert.equal(signal.aborted, false);
      assertCurrent();
      calls.push({target, bytes: Buffer.from(bytes), ticketId});
      return {outcome: 'accepted', messageId: '55'};
    },
    async sendOwnerRecord() { assert.fail('group recording must not use the private send path'); },
  };
  const binding = {status: 'connected', channel: 'qq', generation: 1, scopeId: 'synthetic-role-group',
    accountId, ownerId, groupId, role: '合成测试角色', roleId: 'fixture-role', route: {}, groupRevision: 'synthetic-group-revision', client};
  const drafts = new QQOwnerVoice({getBinding: () => binding});
  const scope = {accountId: 'synthetic-app-account', panelId: 'synthetic-panel', service: {}, generation: binding.generation,
    scopeId: binding.scopeId, client, socket, clientGeneration: client.generation, qqAccountId: accountId, ownerId, role: binding.role};
  const render = (text, signal) => renderer.render(text, {signal, scope, assertCurrent: () => assert.equal(client.socket, socket)});
  stopFixtures = async () => {
    try {
      await Promise.allSettled([drafts.close(), renderer.cancel()]);
      await Promise.allSettled(hosts.map(host => host.close()));
    }
    finally {
      for (const owned of descendants) {
        const row = ps(owned.pid);
        if (row && row.parentPid === owned.parentPid && row.groupId === owned.groupId && row.executable === owned.executable) {
          process.kill(owned.pid, 'SIGKILL');
        }
      }
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null && ps(child.pid)?.parentPid === process.pid) child.kill('SIGKILL');
      }
    }
  };

  // Capabilities prove the native process but do not load a model or output device.
  const capability = await firstHost.capabilities();
  assert.deepEqual([capability.renderAvailable, capability.outputChecked, capability.outputAvailable], [true, false, false]);
  assert.deepEqual(events(), []);
  // Use the already proven host for the first render and keep it resident for the second.
  const assertWav = (bytes, sample) => {
    const format = canonicalWav(bytes);
    assert.deepEqual([format.sampleRate, format.channels, format.bits, format.frames, format.durationSeconds], [32000, 1, 16, 9600, .3]);
    assert.deepEqual(format.bytes, bytes);
    const pair = Buffer.alloc(2);
    pair.writeInt16LE(sample);
    assert.deepEqual(bytes.subarray(44), Buffer.alloc(9600 * 2, pair));
  };
  const first = await render(firstText);
  assertWav(first, 11);
  const parent = ps(children[0].pid);
  assert.equal(parent?.parentPid, process.pid);
  assert.equal(parent.groupId, parent.pid);
  assert.equal(parent.uid, process.getuid());
  assert(executables.includes(fs.realpathSync.native(parent.executable)));
  assert.deepEqual(events().filter(row => row.kind === 'loaded'), [{kind: 'loaded', pid: parent.pid, parentPid: process.pid, device: 'cpu', half: false}]);
  assert.deepEqual(events().filter(row => row.kind === 'pcm-cleared').map(({samples, allZero}) => [samples, allZero]), [[9600, true]]);
  const draft = drafts.prepare(first);
  assert.equal(draft.recipient.groupId, groupId);
  assert.deepEqual(calls, []);
  assert.deepEqual(await drafts.send({ticketId: draft.ticketId}), {ticketId: draft.ticketId, outcome: 'accepted', messageId: '55', kind: 'voice'});
  assert.deepEqual(calls, [{target: groupId, bytes: first, ticketId: draft.ticketId}]);
  await assert.rejects(drafts.send({ticketId: draft.ticketId}), {code: 'stale_ticket'});

  const abort = new AbortController();
  const blocked = render(blockedText, abort.signal);
  const cancelled = assert.rejects(blocked, {code: 'cancelled'});
  const started = await eventually(() => events().find(row => row.kind === 'blocked'), 'cancel fixture did not spawn its descendant');
  const descendant = ps(started.childPid);
  assert.equal(started.pid, parent.pid, 'use the same resident CPU worker');
  assert.equal(descendant?.parentPid, parent.pid);
  assert.equal(descendant.groupId, parent.groupId);
  assert.equal(descendant.uid, parent.uid);
  descendants.push(descendant);
  await eventually(() => firstHost.diagnostics().audioRetained, 'partial PCM never reached the host before abort');
  abort.abort();
  await cancelled;
  assert(children[0].signalCode != null || children[0].exitCode != null);
  assert.equal(ps(parent.pid), null);
  assert.equal(ps(descendant.pid), null);
  assert.equal(firstHost.diagnostics().audioRetained, false);
  assert.equal(renderer.busy, false);
  assert.equal(calls.length, 1);

  const next = await render(nextText);
  assertWav(next, 33);
  assert.notEqual(sha256(first), sha256(next));
  assert.equal(children.length, 2);
  assert.notEqual(children[1].pid, parent.pid);
  assert.equal(events().filter(row => row.kind === 'loaded').length, 2);
  assert.deepEqual(events().filter(row => row.kind === 'completed').map(row => row.sample), [11, 33]);
  assert.equal(events().some(row => row.kind === 'denied'), false);
  assert(hosts.every(host => !host.diagnostics().events.some(row => /playback|output-ready/.test(row.event))));
  assert.equal(calls.length, 1);
  await renderer.cancel();
  assert.equal(ps(children[1].pid), null);
});
