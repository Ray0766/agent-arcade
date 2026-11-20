'use strict';

// Real BotService, QQClient, group store, record reader and ASR lease/pipeline.
// Only the in-process OneBot bridge, vault, ASR inference and model are fixtures.
const {test} = require('node:test');
const {createHash} = require('node:crypto');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {BotService} = require('../src/bot/service.cjs');
const {CharacterLibrary} = require('../src/bot/character-library.cjs');
const {QQClient} = require('../src/bot/qq.cjs');
const {GroupRecordReader} = require('../src/bot/qq-group-voice.cjs');
const {GroupVoicePipeline} = require('../src/bot/group-voice-pipeline.cjs');
const {AsrGate} = require('../src/voice/asr-gate.cjs');
const {normalizeCard} = require('../src/vendor/sillytavern/character-card.cjs');
const {wav} = require('./helpers/fixture-wav.cjs');
const {encode: encodeSilk} = require('silk-wasm');

const ACCOUNT = '87654321';
const OWNER = '12345678';
const MEMBER = '44443333';
const GROUP_A = '55556666';
const GROUP_B = '77778888';
const OUTSIDE = '99991111';
const NOW = 1800000000000;
const SYNTHETIC_NAME = 'synthetic-group-voice-private-filename.wav';
const RATE = 16000;
const DURATION = .25;
const WAVE = wav({rate: RATE, seconds: DURATION, metadata: false});
const B64 = WAVE.toString('base64');
const asText = text => ({type: 'text', data: {text}});
const recording = (data = {}) => ({type: 'record', data: {file: SYNTHETIC_NAME, file_size: WAVE.length, base64: B64, ...data}});
const filenameOnlyRecord = () => ({type: 'record', data: {file: SYNTHETIC_NAME, file_size: WAVE.length}});
const gateOf = prompt => prompt.includes('Decide whether this character should answer');
const quotedId = send => String(send.message[0]?.data?.id);
const groups = (voiceGroupIds, proactive = false) => ({
  enabled: true, groupIds: [GROUP_A, GROUP_B], proactive,
  ...(voiceGroupIds === null ? {} : {voiceGroupIds}),
});

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}

async function until(predicate, label) {
  const deadline = Date.now() + 4500;
  while (!predicate()) {
    assert(Date.now() < deadline, label);
    await delay(4);
  }
}

async function fixture(t, {voiceGroupIds = [GROUP_A, GROUP_B], available = true, configured, proactive = false, bridgeResult,
  groupRecordReader = () => new GroupRecordReader(), importedRole = false} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-group-voice-'));
  const gate = new AsrGate();
  const requests = [], sockets = [], observed = new Map(), sent = [], asrRuns = [], calls = [], holds = [], replyEvents = [];
  const state = {transcript: '合成语音：周末去公园吗？', model: null, receipt: null};
  let messageSequence = 100, sendSequence = 4000;
  class SyntheticSocket extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      sockets.push(this);
      queueMicrotask(() => {this.readyState = 1;this.emit('open');});
    }
    frame(value) {this.emit('message', Buffer.from(JSON.stringify(value)), false);}
    send(wire, callback) {
      const row = JSON.parse(wire);
      requests.push(row);
      const responses = {
        get_login_info: {user_id: Number(ACCOUNT), nickname: '合成群聊桥接'},
        get_status: {online: true, good: true},
        get_friend_list: [{user_id: Number(OWNER)}],
        get_msg: observed.get(String(row.params?.message_id)),
        send_group_msg: {message_id: ++sendSequence},
      };
      assert(Object.hasOwn(responses, row.action), 'unexpected OneBot request: ' + row.action);
      if (row.action === 'send_group_msg') sent.push(row.params);
      const data = row.action === 'get_msg' && bridgeResult ? bridgeResult(responses[row.action]) : responses[row.action];
      callback?.();
      const accepted = {status: 'ok', retcode: 0, data};
      const response = row.action === 'send_group_msg' && state.receipt ? state.receipt(row, accepted) : accepted;
      setImmediate(async () => {
        const result = await response;
        if (result && this.readyState === 1) this.frame({...result, echo: row.echo});
      });
    }
    ping() {this.emit('pong');}
    terminate() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close');
    }
  }
  const characterLibrary = importedRole ? new CharacterLibrary({root: path.join(root, 'characters')}) : null;
  const service = new BotService({
    root, characterLibrary, onGroupReply: event => replyEvents.push(event),
    vault: {isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: data => data.toString()},
    qqClientFactory: options => new QQClient({...options, now: () => NOW, timeoutMs: 350, pollTimeoutMs: 12,
      socketFactory: () => new SyntheticSocket(),
    }),
    runnerFactory: options => async ({prompt, request, signal}) => {
      calls.push({prompt, permission: await request({tool: 'Bash'}), conversationOnly: options.conversationOnly});
      if (state.model) return state.model({prompt, gate: gateOf(prompt), signal});
      return {outcome: 'reply_ended', text: gateOf(prompt)
        ? JSON.stringify({action: 'message', text: '合成接话判断'})
        : '合成群聊回复。',
      };
    },
    inboundVoiceAvailability: () => ({available, ...(configured === undefined ? {} : {configured})}),
    groupVoiceFactory: options => new GroupVoicePipeline({
      ...options,
      reader: groupRecordReader(),
      acquireLease: options => gate.acquire(options),
      createAsr: binding => ({
        async transcribe(audio, {signal, jobId}) {
          assert.equal(jobId, binding.jobId);
          const run = {audio, observedPcm: Buffer.from(audio.pcm), signal, cancels: 0};
          asrRuns.push(run);
          return typeof state.transcript === 'function' ? state.transcript(run) : state.transcript;
        },
        async cancel({jobId}) {
          assert.equal(jobId, binding.jobId);
          asrRuns.at(-1).cancels++;
        },
      }),
    }),
  });
  service.configure({
    channel: 'qq', mode: 'api', key: 'synthetic-group-voice-provider-key',
    qqOwnerId: OWNER, qqAccountId: ACCOUNT, qqToken: 'synthetic-group-voice-bridge-token',
    qqGroups: groups(voiceGroupIds, proactive),
  });
  service.socialConfigure({enabled: true, qqVoiceMessages: false, proactiveMessages: proactive, qzonePosts: false});
  let cardId;
  if (characterLibrary) {
    cardId = characterLibrary.add({card: normalizeCard({name: '合成公开群角色', description: '记录虚构路线。'})}).id;
    const {approval} = service.groupRolePreview({groupId: GROUP_A, cardId});
    service.groupRoleSet({groupId: GROUP_A, cardId, approval});
  }
  const connect = async () => {
    await service.connect();
    assert.equal(service.status, 'connected', service.problem);
    service.groupRoute.flow = {debounceMs: 0, bubbleDelayMs: 0};
  };
  t.after(async () => {
    for (const hold of holds) hold.resolve('仅供清理的迟到转写');
    await service.disconnect();
    assert(sockets.every(socket => socket.readyState === 3));
    fs.rmSync(root, {recursive: true, force: true});
  });
  await connect();

  const emit = ({message, id = ++messageSequence, groupId = GROUP_A, senderId = MEMBER, selfId = ACCOUNT, messageSeq} = {}) => {
    const row = {post_type: 'message', message_type: 'group', sub_type: 'normal', time: NOW / 1000,
      self_id: Number(selfId), user_id: Number(senderId), sender: {user_id: Number(senderId)},
      group_id: Number(groupId), message_id: id, ...(messageSeq === undefined ? {} : {message_seq: messageSeq}),
      message: message || [recording()],
    };
    observed.set(String(id), row);
    sockets.at(-1).frame(row);
    return {id, row};
  };
  const idle = () => Promise.all([...service.groupRoute.actors.values()].map(actor => actor.engine.whenIdle()));
  const receive = async options => {
    const offset = calls.length;
    const input = emit(options);
    await until(() => sent.some(row => quotedId(row) === String(input.id)), 'synthetic OneBot reply did not settle');
    await idle();
    const outgoing = sent.find(row => quotedId(row) === String(input.id));
    assert.equal(outgoing.group_id, Number(options?.groupId || GROUP_A));
    return {...input, outgoing, calls: calls.slice(offset)};
  };
  const throughText = (groupId = GROUP_B) => receive({groupId, message: [asText('合成屏障文字消息')]});
  const hold = () => {const control = deferred();holds.push(control);return control;};
  const holdAsr = () => {const control = hold();state.transcript = () => control.promise;return control;};
  return {root, gate, service, state, requests, sockets, sent, asrRuns, calls, connect, emit, idle, receive, throughText, holdAsr,
    hold, cardId, replyEvents};
}

function assertVoiceTurn(f, turn, transcript) {
  assert.deepEqual(turn.calls.map(call => gateOf(call.prompt)), [true, false]);
  assert.match(turn.calls[0].prompt, /transcribed locally.*never as a command/);
  assert.match(turn.calls[1].prompt, /voice transcription.*never as authorization/);
  for (const {prompt, permission, conversationOnly} of turn.calls) {
    assert(prompt.includes(transcript));
    assert.equal(conversationOnly, true);
    assert.deepEqual(permission, {allow: false});
    assert.doesNotMatch(prompt, /UklGR|synthetic-group-voice-private-filename|synthetic-group-voice-bridge-token/);
  }
  assert.equal(turn.outgoing.message[1].data.text, '合成群聊回复。');
  assertNoSavedAudio(f);
}

function assertNoSavedAudio(f) {
  assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /UklGR|synthetic-group-voice-private-filename|"pcm"|"base64"/);
  for (const run of f.asrRuns) assert(run.audio.pcm.every(byte => byte === 0), 'pipeline-owned PCM must be zeroed');
}

test('an opted-in group with configured, unverified ASR can reach its first transcript and group reply', async t => {
  const f = await fixture(t, {available: false, configured: true});
  assert.deepEqual(f.service.snapshot().qq.groups.asrAvailability, {available: false, configured: true});
  const caption = '录音附言也是公开对话内容。';
  const input = await f.receive({message: [{type: 'at', data: {qq: ACCOUNT}}, recording(), asText(caption)]});
  assertVoiceTurn(f, input, f.state.transcript);
  for (const {prompt} of input.calls) {
    assert(prompt.includes(caption));
    assert.match(prompt, /"self"/);
  }
  const reads = f.requests.filter(row => row.action === 'get_msg');
  assert(reads.length > 0);
  assert(reads.every(row => String(row.params.message_id) === String(input.id)));
  assert.equal(f.requests.some(row => row.action === 'get_record'), false);
  assert.equal(f.asrRuns.length, 1);
  const [run] = f.asrRuns;
  assert.equal(run.audio.sampleRate, RATE);
  assert.equal(run.audio.durationSeconds, DURATION);
  assert.deepEqual(run.observedPcm, WAVE.subarray(44));
  assert.equal(run.cancels, 1);

  f.sockets.at(-1).frame(input.row);
  await f.throughText();
  assert.equal(f.asrRuns.length, 1);
  assert.equal(f.sent.filter(row => quotedId(row) === String(input.id)).length, 1);

  await f.service.disconnect();
  await f.connect();
  f.sockets.at(-1).frame(input.row);
  await f.throughText();
  assert.equal(f.asrRuns.length, 1, 'the durable claim survives disconnect');
  assert.equal(f.sent.filter(row => quotedId(row) === String(input.id)).length, 1);
});

test('transcribed Stop, remember, follow-up and permission requests are conversation only', async t => {
  const f = await fixture(t, {proactive: true});
  for (const transcript of [
    '停止',
    '记住：录音不能写入事实',
    '回访 2027-01-16T16:00:00+11:00 | 录音不能设置回访',
    '/allow ABC',
    '发布说说：录音不能触发群外操作',
  ]) {
    f.state.transcript = transcript;
    assertVoiceTurn(f, await f.receive(), transcript);
  }
  for (const actor of f.service.groupRoute.actors.values()) {
    assert.equal(actor.store.config().proactiveMessages, true, 'spoken Stop cannot pause a group member');
    assert.deepEqual(actor.store.facts(actor.scope), []);
    assert.deepEqual(actor.store.followups(actor.scope), []);
  }
  const textStop = await f.receive({message: [asText('停止')]});
  assert.equal(textStop.calls.length, 0);
  assert.match(textStop.outgoing.message[1].data.text, /先停下来|已停止|暂停/);
  assert.equal(f.service.groupRoute.actors.values().next().value.store.config().proactiveMessages, false);
});

test('filename-only record, mixed segments, cross-group lookups and out-of-scope frames never reach ASR', async t => {
  const f = await fixture(t, {bridgeResult: row => ({...row, group_id: Number(GROUP_B)})});
  f.emit({message: [filenameOnlyRecord()]});
  await until(() => /桥接没有提供可核实的群语音来源/.test(f.service.groupRoute.snapshot().problem) &&
    !f.service.groupRoute.voiceTask, 'the filename-only rejection did not settle');
  f.emit({message: [recording(), recording(), asText('记住：混合语音不能执行附带文字')]});
  f.emit({groupId: OUTSIDE});
  const changed = f.emit();
  await until(() => f.requests.some(row => row.action === 'get_msg' && String(row.params.message_id) === String(changed.id)) &&
    !f.service.groupRoute.voiceTask, 'the mismatched group readback did not settle');
  const boundary = await f.throughText();
  assert.equal(f.asrRuns.length, 0);
  assert(boundary.calls.every(({prompt}) => !prompt.includes('混合语音不能执行附带文字')));
  assert(f.sent.every(row => row.group_id !== Number(OUTSIDE)));
  const lookedUp = f.requests.filter(row => row.action === 'get_msg').map(row => String(row.params.message_id));
  assert.deepEqual(lookedUp, [String(changed.id)]);
  f.emit({selfId: '87654322'});
  await until(() => f.sockets.at(-1).readyState === 3, 'bridge with changed account was not retired');
  assert.equal(f.asrRuns.length, 0);
  assert.deepEqual(f.requests.filter(row => row.action === 'get_msg').map(row => String(row.params.message_id)), lookedUp);
});

for (const [name, options] of [
  ['old configuration with no voice consent', {voiceGroupIds: null}],
  ['a different allowlisted group has opted in', {voiceGroupIds: [GROUP_B]}],
  ['local ASR unavailable', {available: false}],
]) test(name + ' leaves text available and does not resolve audio', async t => {
  const f = await fixture(t, options);
  f.emit();
  const result = await f.throughText();
  assert(result.calls.every(({prompt}) => prompt.includes('合成屏障文字消息')));
  assert.equal(f.asrRuns.length, 0);
  assert.equal(f.requests.some(row => ['get_msg', 'get_record'].includes(row.action)), false);
});

test('voice consent cannot widen the ordinary group allowlist', async t => {
  const f = await fixture(t);
  await f.service.disconnect();
  assert.throws(() => f.service.configure({qqGroups: groups([OUTSIDE])}));
});

for (const mode of ['literal Stop', 'disconnect']) test(mode + ' discards the late voice result, releases the old lease and preserves text', async t => {
  const f = await fixture(t);
  const late = f.holdAsr();
  const original = f.emit();
  await until(() => f.asrRuns.length === 1, 'synthetic local ASR did not start');
  if (mode === 'literal Stop') {
    await f.receive({groupId: GROUP_B, message: [asText('停止')]});
    assert.equal(f.asrRuns[0].signal.aborted, false, 'Stop in another group cannot cancel this recording');
  }
  const stop = mode === 'literal Stop' ? f.emit({message: [asText('停止')]}) : null;
  const closing = stop ? null : f.service.disconnect();
  await until(() => f.asrRuns[0].signal.aborted, 'cancellation did not reach the recognizer');
  late.resolve('迟到转写不能发送');
  if (closing) {
    await closing;
    await f.connect();
    f.sockets.at(-1).frame(original.row);
  } else {
    await until(() => f.sent.some(row => quotedId(row) === String(stop.id)), 'plain text Stop was not acknowledged');
  }
  await f.throughText(GROUP_A);
  assert(f.calls.every(({prompt}) => !prompt.includes('迟到转写不能发送')));
  assert(f.sent.every(row => quotedId(row) !== String(original.id)));
  assert.equal(f.asrRuns.length, 1);
  assertNoSavedAudio(f);
  const lease = f.gate.acquire({scopeId: 'fresh-test-scope', jobId: 'fresh-test-job'});
  lease.release();
});

test('group recognition cannot evict another user of the app-wide ASR gate', async t => {
  const f = await fixture(t);
  const lease = f.gate.acquire({scopeId: 'synthetic-other-asr-session', jobId: 'synthetic-active-job'});
  t.after(() => lease.release());
  const busy = f.emit();
  await until(() => f.requests.some(row => row.action === 'get_msg' && String(row.params.message_id) === String(busy.id)) &&
    !f.service.groupRoute.voiceTask, 'busy active recognizer did not settle');
  assert.match(f.service.groupRoute.snapshot().problem, /本机群语音正在转写/);
  lease.assertCurrent();
  assert.equal(f.asrRuns.length, 0);
  assert.equal(f.calls.length, 0);
  assert(!f.sent.some(row => row.message[1]?.data?.text === '合成群聊回复。'));
  lease.release();
  assertVoiceTurn(f, await f.receive(), f.state.transcript);
});

const LL_RECORD_NAME = 'synthetic-shared.amr';
const LL_HOST = 'multimedia.nt.qq.com.cn';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const secondMember = '22221111';

// LLBot's PTT fileid embeds the original SHA-1, byte count and app ID.
// Both fixture sources deliberately reuse LLBot's filename.
function pttFileId(bytes) {
  let remaining = bytes.length;
  const encodedSize = [];
  while (remaining >= 128) {
    encodedSize.push((remaining & 127) | 128);
    remaining >>>= 7;
  }
  encodedSize.push(remaining);
  return Buffer.concat([
    Buffer.from([0x12, 20]), createHash('sha1').update(bytes).digest(),
    Buffer.from([0x18, ...encodedSize, 0x20, 0xfb, 0x0a]),
  ]).toString('base64url');
}

const llUrl = (fileid, rkey = 'event_key_01234', host = LL_HOST) =>
  'https://' + host + '/download?appid=1403&fileid=' + fileid + '&rkey=' + rkey;
const llRecord = (voice, url = llUrl(voice.fileid)) =>
  ({type: 'record', data: {file: LL_RECORD_NAME, file_size: String(voice.silk.length), url}});

async function toneVoice(hz) {
  const pcm = Buffer.alloc(RATE * .4 * 2);
  for (let sample = 0; sample < pcm.length / 2; sample++) {
    pcm.writeInt16LE(Math.round(Math.sin(sample / RATE * 2 * Math.PI * hz) * 10000), sample * 2);
  }
  const silk = Buffer.from((await encodeSilk(pcm, RATE)).data);
  pcm.fill(0);
  return {silk, fileid: pttFileId(silk)};
}

function llReadback(row) {
  return {...row, status: 'normal', real_id: row.message_seq, message: row.message.map(segment => {
    if (segment.type !== 'record') return segment;
    const url = new URL(segment.data.url);
    url.searchParams.set('rkey', 'fresh_key_98765');
    return {...segment, data: {...segment.data, url: String(url)}};
  })};
}

function downloadFixtures(sources, downloaded) {
  return () => new GroupRecordReader({
    createDownloader: () => ({
      close() {},
      async download(value, {signal, assertCurrent, expectedResourceDigest, expectedSourceBytes}) {
        assertCurrent();
        assert.equal(signal.aborted, false);
        const url = new URL(value);
        assert.equal(url.hostname, LL_HOST);
        assert.equal(url.pathname, '/download');
        assert.equal(url.searchParams.get('appid'), '1403');
        assert.equal(url.searchParams.get('rkey'), 'fresh_key_98765');
        const fileid = url.searchParams.get('fileid');
        assert(sources.has(fileid), 'only the exact synthetic QQ source can be downloaded');
        const bytes = Buffer.from(sources.get(fileid));
        assert.equal(bytes.length, expectedSourceBytes);
        downloaded.push({fileid, bytes});
        return {bytes, resourceDigest: expectedResourceDigest};
      },
    }),
  });
}

test('LLBot same-named PTT records use the exact refreshed URL and distinct pinned decoder outputs', async t => {
  const low = await toneVoice(320), high = await toneVoice(740);
  const downloaded = [];
  const f = await fixture(t, {
    bridgeResult: llReadback,
    groupRecordReader: downloadFixtures(new Map([[low.fileid, low.silk], [high.fileid, high.silk]]), downloaded),
  });
  const expected = [
    '6d22e207a76c47185dcc992208d82763c0d739f684051b46308ea1971e023ccd',
    '4d324a271234152b010eceabb3aa210acaeb7f056959ba30f23b2c2f7f217566',
  ];
  const results = [
    [low, GROUP_A, MEMBER, 27, '合成低频声音'],
    [high, GROUP_B, secondMember, 28, '合成高频声音'],
  ];
  const sent = [];
  for (const [index, [voice, groupId, senderId, messageSeq, transcript]] of results.entries()) {
    f.state.transcript = ({audio, observedPcm}) => {
      assert.equal(audio.sampleRate, RATE);
      assert.equal(audio.durationSeconds, .4);
      assert.equal(sha256(observedPcm), expected[index]);
      return transcript;
    };
    const turn = await f.receive({groupId, senderId, messageSeq, message: [llRecord(voice)]});
    assertVoiceTurn(f, turn, transcript);
    assert(turn.calls.every(({prompt}) => !prompt.includes(LL_RECORD_NAME) && !prompt.includes('fresh_key')));
    const otherTranscript = results[1 - index][4];
    assert(turn.calls.every(({prompt}) => !prompt.includes(otherTranscript)));
    assert.equal(turn.outgoing.group_id, Number(groupId));
    sent.push(String(turn.id));
  }
  const mediaActions = f.requests.filter(row => ['get_msg', 'get_record'].includes(row.action));
  assert.deepEqual(mediaActions.map(row => [row.action, String(row.params.message_id)]),
    sent.flatMap(id => [['get_msg', id], ['get_msg', id]]));
  assert.deepEqual(downloaded.map(value => value.fileid), [low.fileid, high.fileid]);
  assert(downloaded.every(value => value.bytes.every(byte => byte === 0)), 'downloaded SILK buffers must be wiped');
  const state = f.service.groupRoute.snapshot();
  assert.deepEqual(state.voiceSources, {[GROUP_A]: 'qq-ptt', [GROUP_B]: 'qq-ptt'});
  assert.doesNotMatch(JSON.stringify(state), /synthetic-shared|fresh_key_98765|resourceDigest/);
  assert.notEqual(expected[0], expected[1]);
});

test('LLBot rejects changed resource identity, deleted readback, hostile URL and same-length corrupt bytes', async t => {
  const voice = await toneVoice(320);
  const corrupt = Buffer.from(voice.silk);
  corrupt[corrupt.length - 1] ^= 1;
  const cases = [
    ['changed fileid', row => ({...llReadback(row), message: [llRecord(voice, llUrl(pttFileId(corrupt), 'fresh_key_98765'))]}), false, true],
    ['deleted readback', row => ({...llReadback(row), status: 'deleted'}), false, true],
    ['unsafe readback domain', row => ({...llReadback(row), message: [llRecord(voice, llUrl(voice.fileid, 'fresh_key_98765', LL_HOST + '.example.invalid'))]}), false, true],
    ['hostile event domain', llReadback, false, false, llUrl(voice.fileid, 'event_key_01234', LL_HOST + '.example.invalid')],
    ['CDN bytes do not match original hash', llReadback, true, true],
  ];
  for (const [name, bridgeResult, shouldDownload, shouldLookup, unsafeEvent] of cases) {
    await t.test(name, async t => {
      const downloaded = [];
      const f = await fixture(t, {bridgeResult,
        groupRecordReader: downloadFixtures(new Map([[voice.fileid, corrupt]]), downloaded),
      });
      const input = f.emit({messageSeq: 39, message: [llRecord(voice, unsafeEvent)]});
      await until(() => f.service.groupRoute.snapshot().problem && !f.service.groupRoute.voiceTask, 'LLBot rejection did not settle');
      assert.equal(f.asrRuns.length, 0);
      assert.equal(f.calls.length, 0);
      assert.equal(f.requests.some(row => row.action === 'get_record'), false);
      assert.deepEqual(f.requests.filter(row => row.action === 'get_msg').map(row => String(row.params.message_id)),
        shouldLookup ? [String(input.id)] : []);
      assert.equal(downloaded.length, shouldDownload ? 1 : 0);
      assert(downloaded.every(value => value.bytes.every(byte => byte === 0)));
      await f.throughText();
    });
  }
});

const promptInput = prompt => prompt.match(/\nBEGIN (ARCADE_INPUT_\d+)\n([\s\S]*?)\nEND \1/u)?.[2];
const replyIds = f => f.sent.map(quotedId);
const waitForReply = (f, row) => until(() => replyIds(f).includes(String(row.id)), 'no reply for ' + row.id);
const waitForInbound = (f, count) => until(() => f.service.groupRoute.incoming >= count, 'group input was not admitted');

test('C06 same-member text and delayed speech produce one grounded turn addressed to the latest text', async t => {
  const f = await fixture(t);
  const held = f.holdAsr();
  const speech = f.emit();
  await until(() => f.asrRuns.length === 1, 'first speech was not sent to ASR');
  const continuation = '你觉得两个地方选哪个好？';
  const text = f.emit({message: [asText(continuation)]});
  await waitForInbound(f, 2);
  assert.equal(f.asrRuns[0].signal.aborted, false);
  assert.deepEqual(f.calls, []);
  const transcript = '我在公园和图书馆之间犹豫。';
  held.resolve(transcript);
  await waitForReply(f, text);
  await f.idle();
  assert.deepEqual(replyIds(f), [String(text.id)]);
  assert.equal(f.asrRuns.length, 1);
  assert.deepEqual(f.calls.map(({prompt}) => gateOf(prompt)), [true, false]);
  for (const {prompt} of f.calls) {
    const current = promptInput(prompt);
    assert(current.includes(transcript) && current.includes(continuation));
    assert(current.indexOf(transcript) < current.indexOf(continuation));
  }
  assert(f.sent.every(row => row.group_id === Number(GROUP_A)));
  assert(!replyIds(f).includes(String(speech.id)));
  assertNoSavedAudio(f);
});

test('C06 two members are recognized serially, each receives its own reply, and queued duplicates are ignored', async t => {
  const f = await fixture(t);
  const held = f.holdAsr();
  const first = f.emit();
  await until(() => f.asrRuns.length === 1, 'first speech was not sent to ASR');
  const second = f.emit({senderId: secondMember});
  f.sockets.at(-1).frame(second.row);
  await waitForInbound(f, 2);
  assert.equal(f.requests.filter(row => row.action === 'get_msg').length, 1);
  assert.equal(f.asrRuns.length, 1);
  assert.equal(f.asrRuns[0].signal.aborted, false);
  const firstSpeech = '第一位成员的合成转写';
  const secondSpeech = '第二位成员自己的合成转写';
  f.state.transcript = secondSpeech;
  held.resolve(firstSpeech);
  await waitForReply(f, first);
  await waitForReply(f, second);
  await f.idle();
  assert.equal(f.asrRuns.length, 2);
  assert.equal(f.asrRuns[0].cancels, 1);
  assert.deepEqual(replyIds(f).sort(), [first.id, second.id].map(String).sort());
  assert.deepEqual(f.requests.filter(row => row.action === 'get_msg').map(row => String(row.params.message_id)), [first.id, second.id].map(String));
  for (const [own, other] of [[firstSpeech, secondSpeech], [secondSpeech, firstSpeech]]) {
    const input = f.calls.filter(({prompt}) => promptInput(prompt).includes(own));
    assert.deepEqual(input.map(({prompt}) => gateOf(prompt)), [true, false]);
    assert(input.every(({prompt}) => !promptInput(prompt).includes(other)));
  }
  assertNoSavedAudio(f);
});

test('C06 another group can finish ordinary text and a literal control while ASR is held', async t => {
  const f = await fixture(t);
  const held = f.holdAsr();
  const first = f.emit();
  await until(() => f.asrRuns.length === 1, 'first speech was not sent to ASR');
  const other = await f.receive({groupId: GROUP_B, message: [asText('另一群的文字可以继续。')]});
  assert.deepEqual(other.calls.map(({prompt}) => gateOf(prompt)), [true, false]);
  assert(other.calls.every(({prompt}) => promptInput(prompt).includes('另一群的文字可以继续。')));
  const status = await f.receive({groupId: GROUP_B, message: [asText('状态')]});
  assert.deepEqual(status.calls, []);
  assert.match(status.outgoing.message[1].data.text, /群聊文字陪伴已连接/);
  assert.equal(f.asrRuns[0].signal.aborted, false);
  assert(!replyIds(f).includes(String(first.id)));
  const transcript = '最初群的语音识别随后结束。';
  held.resolve(transcript);
  await waitForReply(f, first);
  await f.idle();
  assert.equal(f.sent.find(row => quotedId(row) === String(first.id)).group_id, Number(GROUP_A));
  assertVoiceTurn(f, {calls: f.calls.slice(2), outgoing: f.sent.at(-1)}, transcript);
});

test('C06 failed ASR still drains a buffered plain message from the same member', async t => {
  const f = await fixture(t);
  const held = f.holdAsr();
  const speech = f.emit();
  await until(() => f.asrRuns.length === 1, 'first speech was not sent to ASR');
  const content = '语音没有识别成功，也请保留这句文字。';
  const text = f.emit({message: [asText(content)]});
  await waitForInbound(f, 2);
  assert.equal(f.asrRuns[0].signal.aborted, false);
  held.resolve(' ');
  await waitForReply(f, text);
  await f.idle();
  assert.deepEqual(replyIds(f), [String(text.id)]);
  assert.deepEqual(f.calls.map(({prompt}) => gateOf(prompt)), [true, false]);
  for (const {prompt} of f.calls) {
    assert(promptInput(prompt).includes(content));
    assert.doesNotMatch(prompt, /incoming speech was transcribed locally|voice transcription/);
  }
  assert(!replyIds(f).includes(String(speech.id)));
  assertNoSavedAudio(f);
});

test('C06 literal Stop drops the same member’s held and buffered input and leaves later text usable', async t => {
  const f = await fixture(t);
  const held = f.holdAsr();
  const active = f.emit();
  await until(() => f.asrRuns.length === 1, 'first speech was not sent to ASR');
  const waitingVoice = f.emit();
  const waitingText = f.emit({message: [asText('停止之前的待处理文字。')]});
  await waitForInbound(f, 3);
  const stop = f.emit({message: [asText('停止')]});
  await until(() => f.asrRuns[0].signal.aborted, 'same-member Stop did not abort ASR');
  held.resolve('迟到转写不应发送。');
  await waitForReply(f, stop);
  await f.idle();
  assert.deepEqual(f.calls, []);
  await f.throughText(GROUP_A);
  assert.equal(f.asrRuns.length, 1);
  for (const old of [active, waitingVoice, waitingText]) assert(!replyIds(f).includes(String(old.id)));
  assert(f.calls.every(({prompt}) => !prompt.includes('迟到转写不应发送。') && !prompt.includes('停止之前的待处理文字。')));
  assertNoSavedAudio(f);
});

test('C06 holds at most eight additional voices and preserves metadata-only outcomes for overflow', async t => {
  const f = await fixture(t);
  const held = f.holdAsr();
  f.emit();
  await until(() => f.asrRuns.length === 1, 'first speech was not sent to ASR');
  const queued = Array.from({length: 9}, () => f.emit());
  const route = f.service.groupRoute;
  const scope = 'group:' + route.scope(GROUP_A, MEMBER, route.persona.characterId);
  const stateOf = input => {
    const id = route.journal.key(scope, 'group:' + GROUP_A + ':' + input.id).slice(0, 12);
    return route.journal.snapshot().recent.find(row => row.id === id)?.state;
  };
  await until(() => stateOf(queued.at(-1)) === 'rejected', 'voice overflow disposition did not settle');
  assert(queued.slice(0, 8).every(input => ['received', 'queued'].includes(stateOf(input))));
  assert.equal(f.asrRuns.length, 1);
  const stop = f.emit({message: [asText('停止')]});
  await until(() => f.asrRuns[0].signal.aborted, 'Stop did not abort the first recording');
  held.resolve('已取消的合成语音。');
  await waitForReply(f, stop);
  await f.throughText(GROUP_A);
  assert.equal(f.asrRuns.length, 1);
  assert(queued.every(input => !replyIds(f).includes(String(input.id))));
  assertNoSavedAudio(f);
});

const finished = text => ({outcome: 'reply_ended', text});
const decide = action => finished(JSON.stringify({action, text: action === 'message' ? '合成接话理由' : ''}));
const twoBubbles = '合成第一段。\n\n合成第二段。';

function assertReplyEvent(event, service, character) {
  assert(event);
  assert.deepEqual(Object.keys(event).sort(), ['character', 'mode', 'service']);
  assert.equal(event.service, service);
  assert.equal(event.mode, 'api');
  assert.equal(event.character, character);
}

const groupTask = (f, event) => [...f.service.groupRoute.actors.values()].flatMap(actor => actor.engine.snapshot().tasks)
  .find(task => task.inboundId === `in:group:${event.row.group_id}:${event.id}`);

async function settledText(f, text) {
  const before = f.calls.length;
  const incoming = f.emit({message: [asText(text)]});
  await until(() => f.calls.length > before, 'the group model gate did not run');
  await f.idle();
  return groupTask(f, incoming);
}

test('the group pet event occurs once after the final concrete reply receipt and identifies the actual role', async t => {
  const f = await fixture(t, {importedRole: true});
  const lastReceipt = f.hold();
  let accepted;
  f.state.model = ({gate}) => gate ? decide('message') : finished(twoBubbles);
  f.state.receipt = (row, response) => {
    if (row.params.message.at(-1).data.text !== '合成第二段。') return response;
    accepted = response;
    return lastReceipt.promise;
  };
  const input = f.emit({message: [asText('两段都发出后再给事件。')]});
  await until(() => accepted, 'the first bubble was not accepted or the second was not attempted');
  assert.deepEqual(f.sent.map(row => row.message.at(-1).data.text), ['合成第一段。', '合成第二段。']);
  assert.equal(f.replyEvents.length, 0, 'acceptance of the first bubble is insufficient');
  lastReceipt.resolve(accepted);
  await f.idle();
  assert.equal(groupTask(f, input).bubbleDelivery.accepted, 2);
  assert.equal(f.replyEvents.length, 1);
  assertReplyEvent(f.replyEvents[0], f.service, 'card-' + f.cardId);

  f.state.receipt = null;
  f.state.model = null;
  await f.throughText(GROUP_B);
  assert.equal(f.replyEvents.length, 2);
  assertReplyEvent(f.replyEvents[1], f.service, 'claude-ju');
});

test('gate wait, provider failure, partial receipts and rejected delivery produce no group pet event', async t => {
  const f = await fixture(t);
  f.state.model = () => decide('wait');
  assert.equal((await settledText(f, '接话判断应当等待。')).outcome, 'skipped');
  assert.equal(f.calls.length, 1);
  assert.equal(f.sent.length, 0);
  assert.equal(f.replyEvents.length, 0);

  f.state.model = ({gate}) => gate ? decide('message') : {outcome: 'error'};
  assert.equal((await settledText(f, '模型无法完成。')).outcome, 'error');
  assert.equal(f.calls.length, 3);
  assert.equal(f.sent.length, 0);
  assert.equal(f.replyEvents.length, 0);

  f.state.model = ({gate}) => gate ? decide('message') : finished(twoBubbles);
  f.state.receipt = (row, accepted) => row.params.message.at(-1).data.text === '合成第二段。' ? {...accepted, data: {}} : accepted;
  const partial = await settledText(f, '只确认第一段。');
  assert.equal(partial.deliveryFailed, true);
  assert.deepEqual([partial.bubbleDelivery.planned, partial.bubbleDelivery.accepted, partial.bubbleDelivery.unknown], [2, 1, 1]);
  assert.equal(f.sent.length, 2);
  assert.equal(f.replyEvents.length, 0);

  f.state.receipt = () => ({status: 'failed', retcode: 100});
  const denied = await settledText(f, '群桥接明确拒绝。');
  assert.equal(denied.deliveryFailed, true);
  assert.deepEqual([denied.bubbleDelivery.planned, denied.bubbleDelivery.attempted, denied.bubbleDelivery.accepted], [2, 1, 0]);
  assert.equal(f.sent.length, 3, 'the unreconciled action was not replayed');
  assert.equal(f.replyEvents.length, 0);
});

test('actual group Stop and raw voice still in ASR produce no pet event', async t => {
  const f = await fixture(t);
  const generating = f.hold();
  let modelSignal;
  f.state.model = ({gate, signal}) => {
    if (gate) return decide('message');
    modelSignal = signal;
    return generating.promise;
  };
  const modelInput = f.emit({message: [asText('在回复生成期间停止。')]});
  await until(() => modelSignal, 'the group model did not start');
  const stop = f.emit({message: [asText('停止')]});
  await until(() => modelSignal.aborted, 'Stop did not reach the model');
  generating.resolve(finished('取消后到达的非空模型回复。'));
  await waitForReply(f, stop);
  await f.idle();
  assert.equal(groupTask(f, modelInput).outcome, 'cancelled');
  assert.equal(f.replyEvents.length, 0);
  assert.deepEqual(replyIds(f), [String(stop.id)]);

  const transcribing = f.holdAsr();
  f.state.model = null;
  const voice = f.emit();
  await until(() => f.asrRuns.length === 1, 'the real GroupVoicePipeline did not reach the synthetic ASR');
  assert.equal(f.calls.length, 2, 'raw voice in ASR does not start a new model turn');
  assert.equal(f.replyEvents.length, 0);
  const stopVoice = f.emit({message: [asText('停止')]});
  await until(() => f.asrRuns[0].signal.aborted, 'Stop did not reach ASR');
  transcribing.resolve('取消后到达的转写。');
  await waitForReply(f, stopVoice);
  await until(() => !f.service.groupRoute.voiceTask, 'cancelled ASR did not settle');
  await f.idle();
  assert.deepEqual(replyIds(f), [String(stop.id), String(stopVoice.id)]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.replyEvents.length, 0);
  assert(!replyIds(f).includes(String(voice.id)));
});
