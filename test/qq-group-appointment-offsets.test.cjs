'use strict';

// Normal ordinary QQ commands, durable member stores, and the actual DeepSeek
// transport. The bridge, HTTP endpoint, and wall clock are fixtures.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const {BotService} = require('../src/bot/service.cjs');
const {QQClient} = require('../src/bot/qq.cjs');
const {createDeepSeekRunner} = require('../src/bot/deepseek-runner.cjs');

const ACCOUNT = '87654321', OWNER = '12345678', A = '44443331', B = '44443332';
const GROUP = '55556666', OTHER = '77778888';
const ORIGINAL = '2026-12-02T00:15:00+11:00';
const SECOND = '2026-12-02T14:15+05:45';
const REPLACEMENT = '2026-12-03T23:20:00-09:30';
const ELSEWHERE = '2026-12-05T10:45:00+05:45';
const LEGACY = '2026-12-06T10:30:00.000Z';
const BEACH = '合成海边早餐', LIBRARY = '合成图书馆还书', PARK = '合成公园会面', OLD = '合成历史 UTC 预约';
const REMINDER = '已到合成约定时间，提醒一下海边早餐。';
const GRACE = 5 * 60 * 1000;

async function until(predicate, label) {
  const deadline = performance.now() + 3500;
  while (!predicate()) {
    assert(performance.now() < deadline, label);
    await delay(3);
  }
}

async function fixture(t, start = '2026-12-01T11:00:00Z') {
  t.mock.timers.enable({apis: ['Date'], now: Date.parse(start)});
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-qq-appointment-offsets-'));
  const services = [], sockets = [], wire = [], sent = [];
  let rawId = 500, receiptId = 9000;
  let missingProactiveReceipt = false;

  class Bridge extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      sockets.push(this);
      queueMicrotask(() => {this.readyState = 1;this.emit('open');});
    }
    frame(value) {this.emit('message', JSON.stringify(value), false);}
    send(raw, callback) {
      const {action, params, echo} = JSON.parse(raw);
      const responses = {get_login_info: {user_id: Number(ACCOUNT)}, get_status: {online: true, good: true},
        get_friend_list: [{user_id: Number(OWNER)}],
      };
      callback?.();
      let data;
      if (action === 'send_group_msg') {
        const [anchor, content] = params.message;
        assert.equal(params.message.length, 2);
        assert(['at', 'reply'].includes(anchor.type));
        assert.equal(content.type, 'text');
        data = anchor.type==='at' && missingProactiveReceipt ? {} : {message_id: ++receiptId};
        sent.push({group: String(params.group_id), anchor, text: content.data.text.trim(),
          receipt: data.message_id ? String(data.message_id) : null, at: Date.now()});
      } else {
        assert(Object.hasOwn(responses, action), 'unexpected OneBot action: ' + action);
        data = responses[action];
      }
      this.frame({status: 'ok', retcode: 0, data, echo});
    }
    ping() {this.emit('pong');}
    terminate() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close');
    }
  }

  const create = () => {
    const service = new BotService({root,
      vault: {isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString()},
      qqClientFactory: options => new QQClient({...options, now: () => Date.now(), timeoutMs: 250, pollTimeoutMs: 10,
        socketFactory: () => new Bridge(),
      }),
      deepseekRunnerFactory: options => createDeepSeekRunner({...options, fetchImpl: async (_url, request) => {
        const payload = JSON.parse(request.body), prompt = payload.messages.at(-1).content;
        assert.equal(payload.tool_choice, 'none');
        assert.deepEqual(payload.tools, []);
        const kind = prompt.includes('A member explicitly scheduled this follow-up') ? 'followup' :
          prompt.includes('Decide whether this character should answer') ? 'gate' : 'idle';
        wire.push({kind, prompt, at: Date.now()});
        const content = kind === 'followup' ? REMINDER : JSON.stringify({action: 'wait', text: ''});
        return Response.json({choices: [{finish_reason: 'stop', message: {role: 'assistant', content}}]});
      }}),
    });
    services.push(service);
    return service;
  };
  let service = create();
  service.configure({channel: 'qq', mode: 'deepseek', key: 'synthetic-only-model-key', qqAccountId: ACCOUNT,
    qqOwnerId: OWNER, qqToken: 'synthetic-ordinary-bridge-token', qqGroups: {enabled: true, groupIds: [GROUP, OTHER], proactive: true},
  });
  service.socialConfigure({enabled: true, proactiveMessages: true, activeStart: 0, activeEnd: 24, maxMessagesPerDay: 4, qzonePosts: false});
  t.after(async () => {
    for (const item of services) await item.disconnect();
    assert(sockets.every(socket => socket.readyState === 3));
    fs.rmSync(root, {recursive: true, force: true});
  });

  const connect = async () => {
    await service.connect();
    assert.equal(service.status, 'connected', service.problem);
    service.groupRoute.flow = {debounceMs: 0, bubbleDelayMs: 0};
  };
  await connect();
  const restart = async () => {await service.disconnect();service = create();await connect();};
  const setGroupProactive = async proactive => {
    await service.disconnect();
    service.configure({qqGroups:{enabled:true,groupIds:[GROUP,OTHER],proactive}});
    await connect();
  };
  const withRole = async (characterId, operation) => {
    const {persona} = service.groupRoute, current = persona.characterId;
    persona.characterId = characterId;
    try{return await operation();}finally{persona.characterId = current;}
  };
  const actor = (member, group = GROUP) => service.groupRoute.actor(group, member);
  const frame = (member, value, group, segments) => {
    const id = ++rawId;
    sockets.at(-1).frame({post_type: 'message', message_type: 'group', sub_type: 'normal', self_id: Number(ACCOUNT),
      user_id: Number(member), sender: {user_id: Number(member), nickname: '同名合成群成员'}, group_id: Number(group),
      time: Math.floor(Date.now() / 1000), message_id: id, message: segments || [{type: 'text', data: {text: value}}],
    });
    return String(id);
  };
  const rejectSegments = async (segments,problem) => {
    const route = service.groupRoute, incoming = route.incoming, writes = sent.length, calls = wire.length;
    frame(A,'',GROUP,segments);
    await until(() => route.incoming===incoming+1 && problem.test(route.snapshot().problem),'unsafe native message was not rejected');
    assert.equal(route.journal.snapshot().recent[0].state,'rejected');
    assert.deepEqual([sent.length,wire.length],[writes,calls]);
  };
  const row = (member, topic, group = GROUP) => {
    const active = actor(member, group);
    const value = active.store.followups(active.scope, {limit: 20}).find(item => item.text === topic);
    assert(value, 'expected durable appointment: ' + topic);
    return value;
  };
  const command = async (member, value, group = GROUP) => {
    const offset = wire.length, id = frame(member, value, group);
    const reply = item => item.group === group && item.anchor.type === 'reply' && item.anchor.data.id === id;
    await until(() => sent.some(reply), 'missing native deterministic reply for ' + value);
    await actor(member, group).engine.whenIdle();
    assert.equal(wire.length, offset, 'ordinary appointment commands must not call the model');
    assert.equal(sent.filter(reply).length, 1);
    return sent.find(reply).text;
  };
  const memory = async (member, group = GROUP) => {
    const offset = wire.length, writes = sent.length;
    frame(member, '我这里明确约的时间是什么？', group);
    await until(() => wire.length > offset, 'ordinary conversation gate did not run');
    await actor(member, group).engine.whenIdle();
    assert.equal(sent.length, writes);
    assert.equal(wire.length, offset + 1);
    assert.equal(wire[offset].kind, 'gate');
    const line = wire[offset].prompt.split('\n').find(item => item.startsWith('{"currentMember":'));
    assert(line);
    return JSON.parse(line).currentMemberMemory.followups;
  };
  const setTime = value => t.mock.timers.setTime(typeof value === 'number' ? value : Date.parse(value));
  return {command, memory, row, actor, restart, setGroupProactive, withRole, rejectSegments, setTime, wire, sent,
    omitProactiveReceipt: () => {missingProactiveReceipt = true;},
    proactive: () => sent.filter(item => item.anchor.type === 'at'),
    consider: (group = GROUP) => service.groupRoute.considerGroup(group),
  };
}

function listed(display, topic, expected) {
  const match = display.split('\n').find(line => line.endsWith(' · ' + topic));
  assert(match, 'appointment missing from group list: ' + topic);
  const [code, shown] = match.split(' · ');
  assert.match(code, /^[a-z0-9-]{8}$/i);
  assert.equal(shown, expected);
  return code;
}

function appointmentRows(display) {
  return display.split('\n').flatMap(line => {
    const [code,localTime,status,topic] = line.split(' · ');
    return /^[0-9a-f-]{8,36}$/iu.test(code) && topic ? [{code,localTime,status,topic}] : [];
  });
}

test('ordinary group appointments preserve explicit offsets and rearrange the actual scheduled instant across reopen', async t => {
  const f = await fixture(t);
  for (const [member, local, topic, group] of [[A, ORIGINAL, BEACH, GROUP], [B, SECOND, LIBRARY, GROUP], [A, ELSEWHERE, PARK, OTHER]]) {
    assert((await f.command(member, `回访 ${local} | ${topic}`, group)).includes(local));
    const item = f.row(member, topic, group);
    assert.deepEqual([item.localTime, item.dueAt], [local, Date.parse(local)]);
  }
  const legacyActor = f.actor(A);
  const legacyDue = Date.parse(LEGACY);
  legacyActor.store.scheduleFollowup(legacyActor.scope, {text: OLD, dueAt: legacyDue, expiresAt: legacyDue + GRACE + 1, timeZone: 'UTC'});
  const initialA = await f.command(A, '查看回访');
  const firstCode = listed(initialA, BEACH, ORIGINAL);
  listed(initialA, OLD, LEGACY);
  assert(!initialA.includes(LIBRARY) && !initialA.includes(PARK));
  const secondCode = listed(await f.command(B, '查看回访'), LIBRARY, SECOND);
  listed(await f.command(A, '查看回访', OTHER), PARK, ELSEWHERE);

  await f.restart();
  const reopenedA = await f.command(A, '查看回访');
  assert.equal(listed(reopenedA, BEACH, ORIGINAL), firstCode);
  listed(reopenedA, OLD, LEGACY);
  assert.equal(listed(await f.command(B, '查看回访'), LIBRARY, SECOND), secondCode);
  assert.match(await f.command(B, `改期回访 ${firstCode} ${REPLACEMENT}`), /找不到/);
  assert.match(await f.command(A, `改期回访 ${firstCode} ${REPLACEMENT}`, OTHER), /找不到/);
  assert.deepEqual([f.row(A, BEACH).localTime, f.row(A, BEACH).dueAt], [ORIGINAL, Date.parse(ORIGINAL)]);
  assert((await f.command(A, `改期回访 ${firstCode} ${REPLACEMENT}`)).includes(REPLACEMENT));
  const changed = f.row(A, BEACH);
  const dueAt = Date.parse(REPLACEMENT);
  assert.deepEqual([changed.localTime, changed.dueAt], [REPLACEMENT, dueAt]);
  assert.equal(new Date(dueAt).toISOString(), '2026-12-04T08:50:00.000Z');
  assert.equal(listed(await f.command(A, '查看回访'), BEACH, REPLACEMENT), firstCode);
  listed(await f.command(B, '查看回访'), LIBRARY, SECOND);

  const aRows = await f.memory(A);
  assert.deepEqual(aRows.find(item => item.text === BEACH), {text: BEACH, state: 'pending', dueAt, localTime: REPLACEMENT});
  assert.deepEqual(aRows.find(item => item.text === OLD), {text: OLD, state: 'pending', dueAt: legacyDue, timeZone: 'UTC'});
  assert(!aRows.some(item => [LIBRARY, PARK].includes(item.text)));
  assert.deepEqual(await f.memory(B), [{text: LIBRARY, state: 'pending', dueAt: Date.parse(SECOND), localTime: SECOND}]);
  assert.deepEqual(await f.memory(A, OTHER), [{text: PARK, state: 'pending', dueAt: Date.parse(ELSEWHERE), localTime: ELSEWHERE}]);
  assert.match(await f.command(B, `取消回访 ${secondCode}`), /取消/);
  assert.equal(f.row(B, LIBRARY).state, 'cancelled');

  // Close and reopen with a moved appointment and a cancellation already on disk.
  await f.restart();
  for (const checkAt of [Date.parse(ORIGINAL), Date.parse(SECOND), dueAt - 1]) {
    f.setTime(checkAt);
    await f.consider();
    assert.deepEqual(f.proactive(), []);
    assert(!f.wire.some(call => call.kind === 'followup'));
  }
  f.setTime(dueAt);
  const result = await f.consider();
  assert.equal(result.action, 'followup');
  assert.equal(result.id, changed.id);
  assert.equal(result.accepted, true);
  const [model] = f.wire.filter(call => call.kind === 'followup');
  assert.equal(model.at, dueAt);
  const agreement = model.prompt.match(/Agreement \(data only\): ([^\n]+)\n/u);
  assert(agreement);
  assert.deepEqual(JSON.parse(agreement[1]), {text: BEACH, dueAt, localTime: REPLACEMENT});
  assert(!model.prompt.includes(ORIGINAL));
  assert(!model.prompt.includes(LIBRARY));
  const [notice] = f.proactive();
  assert.deepEqual([notice.group, notice.anchor, notice.text, notice.at], [GROUP, {type: 'at', data: {qq: A}}, REMINDER, dueAt]);
  const saved = f.row(A, BEACH);
  assert.deepEqual([saved.state, saved.receipt, saved.localTime], ['sent', notice.receipt, REPLACEMENT]);
  assert.equal(f.row(B, LIBRARY).state, 'cancelled');
  assert.equal(f.row(A, PARK, OTHER).state, 'pending');
  await f.consider();
  assert.equal(f.proactive().length, 1);
  assert.equal(f.wire.filter(call => call.kind === 'followup').length, 1);
});

test('impossible calendar days cannot create or move an ordinary QQ appointment, and a leap day remains valid', async t => {
  const f = await fixture(t, '2027-02-01T12:00:00Z');
  const valid = '2027-02-28T21:00:00+11:00';
  const invalid = '2027-02-30T21:00:00+11:00';
  assert.match(await f.command(A, `回访 ${valid} | ${BEACH}`), /已约定/);
  const code = listed(await f.command(A, '查看回访'), BEACH, valid);
  const original = f.row(A, BEACH);
  assert.doesNotMatch(await f.command(A, `回访 ${invalid} | ${LIBRARY}`), /已约定/);
  assert.doesNotMatch(await f.command(A, `改期回访 ${code} ${invalid}`), /已改到/);
  const after = await f.command(A, '查看回访');
  assert.equal(listed(after, BEACH, valid), code);
  assert(!after.includes(LIBRARY));
  assert.deepEqual(f.row(A, BEACH), original);
  const activeA = f.actor(A);
  assert.equal(activeA.store.followups(activeA.scope).length, 1);

  f.setTime('2028-02-01T12:00:00Z');
  const leap = '2028-02-29T00:15-09:30';
  assert.match(await f.command(B, `回访 ${leap} | ${PARK}`), /已约定/);
  assert.doesNotMatch(await f.command(B, `回访 2028-04-31T21:00:00+11:00 | ${OLD}`), /已约定/);
  const listing = await f.command(B, '查看回访');
  listed(listing, PARK, leap);
  assert(!listing.includes(OLD));
  assert.deepEqual(await f.memory(B), [{text: PARK, state: 'pending', dueAt: Date.parse(leap), localTime: leap}]);
  assert.deepEqual(f.proactive(), []);
});

test('ordinary QQ pages due appointments separately from cancellation and unknown delivery history', async t => {
  const f = await fixture(t);
  const appointments = Array.from({length:8},(_,index)=>({
    topic:`合成分页回访 ${index+1}`,
    localTime:`2026-12-0${index+2}T00:15:00+11:00`,
  }));
  const ids = new Map();
  for (const index of [4,0,7,3,6,2,5,1]) {
    const {topic,localTime} = appointments[index];
    const reply = await f.command(A,`回访 ${localTime} | ${topic}`);
    assert.match(reply,/已约定/u);
    assert(reply.includes(localTime));
    const code = reply.match(/^编号 ([0-9a-f-]{36})$/mu);
    assert(code, 'creation must return the exact manageable appointment identifier');
    assert.equal(code[1],f.row(A,topic).id);
    ids.set(topic,code[1]);
  }
  assert.equal(new Set(ids.values()).size,8);
  const first = await f.command(A,'查看回访'), second = await f.command(A,'查看回访 2');
  assert.match(first,/待进行的回访/u);
  assert.match(first,/第 1\/2 页/u);
  assert.match(first,/查看回访 2/u);
  assert.match(second,/第 2\/2 页/u);
  const sorted = [...appointmentRows(first),...appointmentRows(second)];
  assert.deepEqual(sorted.map(({topic,localTime})=>({topic,localTime})),appointments);
  assert.equal(appointmentRows(first).length,6);
  assert.equal(appointmentRows(second).length,2);
  for (const {code,topic} of sorted) assert(ids.get(topic).startsWith(code));
  assert.match(await f.command(A,'查看回访 3'),/没有第 3 页|页码/u);
  assert.match(await f.command(A,'查看回访 历史 0'),/页码|用法/u);
  assert.match(await f.command(A,'查看回访 历史'),/没有|暂无|空/u);

  const older = appointmentRows(second).at(-1);
  const moved = '2026-12-02T00:05:00+11:00';
  for (const [member,group] of [[B,GROUP],[A,OTHER]]) {
    assert.match(await f.command(member,'查看回访',group),/没有|暂无|空/u);
    assert.match(await f.command(member,'查看回访 历史',group),/没有|暂无|空/u);
    assert.match(await f.command(member,`改期回访 ${older.code} ${moved}`,group),/找不到/u);
  }
  assert((await f.command(A,`改期回访 ${older.code} ${moved}`)).includes(moved));
  const promoted = appointmentRows(await f.command(A,'查看回访'))[0];
  assert.deepEqual([promoted.code,promoted.localTime,promoted.topic],[older.code,moved,older.topic]);
  assert.match(await f.command(A,`取消回访 ${older.code}`),/取消/u);
  assert.equal(f.row(A,older.topic).state,'cancelled');
  for (const {topic} of appointments.slice(2,7)) {
    f.setTime(Date.now()+1000);
    assert.match(await f.command(A,`取消回访 ${ids.get(topic)}`),/取消/u);
    assert.equal(f.row(A,topic).state,'cancelled');
  }

  const firstDue = appointments[0];
  f.setTime(firstDue.localTime);
  f.omitProactiveReceipt();
  const result = await f.consider();
  assert.deepEqual([result.action,result.id,result.accepted],['followup',ids.get(firstDue.topic),false]);
  assert.equal(f.row(A,firstDue.topic).state,'unknown');
  assert.equal(f.proactive().length,1);
  assert.deepEqual([f.proactive()[0].group,f.proactive()[0].anchor,f.proactive()[0].receipt],
    [GROUP,{type:'at',data:{qq:A}},null]);
  assert.equal(f.wire.filter(call=>call.kind==='followup').length,1);

  const active = await f.command(A,'查看回访');
  assert.deepEqual(appointmentRows(active).map(({topic})=>topic),[appointments[1].topic]);
  const history = await f.command(A,'查看回访 历史'), more = await f.command(A,'查看回访 历史 2');
  assert.match(history,/回访历史/u);
  assert.match(history,/第 1\/2 页/u);
  assert.match(history,/查看回访 历史 2/u);
  assert.match(more,/第 2\/2 页/u);
  assert.equal(appointmentRows(history).length,6);
  assert.equal(appointmentRows(more).length,1);
  const completed = [...appointmentRows(history),...appointmentRows(more)];
  assert.equal(new Set(completed.map(row=>row.code)).size,7);
  assert.equal(completed.filter(({status})=>status.includes('已取消')).length,6);
  const unknown = completed.find(row=>row.topic===firstDue.topic);
  assert.match(unknown?.status,/未确认.*不重发/u);
  assert.equal(unknown.localTime,firstDue.localTime);
  assert.equal(completed.find(row=>row.topic===older.topic)?.localTime,moved);
  assert(!completed.some(row=>row.topic===appointments[1].topic));
  assert.match(await f.command(B,'查看回访 历史'),/没有|暂无|空/u);

  await f.restart();
  assert.deepEqual(appointmentRows(await f.command(A,'查看回访 历史')),appointmentRows(history));
  assert.deepEqual(appointmentRows(await f.command(A,'查看回访 历史 2')),appointmentRows(more));
  await f.consider();
  assert.equal(f.proactive().length,1);
  assert.equal(f.wire.filter(call=>call.kind==='followup').length,1);
});

test('ordinary QQ members can restore their own scoped proactive setting without sending autonomously', async t => {
  const f = await fixture(t);
  const memberProactive = (member,group=GROUP) => f.actor(member,group).store.config().proactiveMessages;
  const pauseMarker = (member,group=GROUP) => path.join(path.dirname(f.actor(member,group).store.file),'group-pause.json');
  const savedPause = file => JSON.parse(fs.readFileSync(file,'utf8'));
  const paused = await f.command(A,'暂停主动');
  assert.match(paused,/已暂停.*此搭档.*本群.*恢复主动/u);
  assert.match(await f.command(A,'状态'),/个人主动联系偏好已暂停.*恢复主动/u);
  const marker = pauseMarker(A);
  assert.deepEqual(savedPause(marker),{},'typing pause writes the legacy compatible marker');
  assert.equal(memberProactive(A),false);
  assert.equal(memberProactive(B),true);
  assert.equal(memberProactive(A,OTHER),true);

  await f.command(B,'暂停主动');
  await f.command(A,'暂停主动',OTHER);
  const alternateMarker = await f.withRole('codex-dragon',async()=>{
    assert.equal(memberProactive(A),true);
    await f.command(A,'暂停主动');
    return pauseMarker(A);
  });
  assert.notEqual(alternateMarker,marker);
  await f.restart();
  assert.equal(memberProactive(A),false,'legacy pause survives a fresh actor');

  const resumed = await f.command(A,'恢复主动');
  assert.match(resumed,/已恢复此搭档在本群对你的主动联系偏好/u);
  assert.match(resumed,/活跃时段.*冷却.*每日限额/u);
  assert.deepEqual(savedPause(marker),{paused:false});
  assert.deepEqual(savedPause(alternateMarker),{});
  await f.restart();
  assert.equal(memberProactive(A),true);
  assert.equal(memberProactive(B),false);
  assert.equal(memberProactive(A,OTHER),false);
  await f.withRole('codex-dragon',async()=>assert.equal(memberProactive(A),false));

  await f.setGroupProactive(false);
  await f.command(A,'暂停主动');
  assert.match(await f.command(A,'恢复主动'),/主人当前关闭了本群主动联系/u);
  assert.equal(memberProactive(A),false);
  assert.deepEqual(savedPause(marker),{paused:false});
  assert.match(await f.command(A,`回访 ${ORIGINAL} | ${BEACH}`),/没有创建回访/u);
  const disabled = f.actor(A);
  assert.deepEqual(disabled.store.followups(disabled.scope),[]);
  await f.setGroupProactive(true);
  assert.equal(memberProactive(A),true);
  assert.equal(memberProactive(B),false);
  assert.equal(memberProactive(A,OTHER),false);
  assert.deepEqual([f.wire.length,f.proactive().length],[0,0]);
});

test('an ordinary QQ quote, forward, image caption or ASR transcript cannot restore a paused member', async t => {
  const f = await fixture(t);
  await f.command(A,'暂停主动');
  const actor = f.actor(A);
  const paused = () => actor.store.config().proactiveMessages===false;
  assert(paused());
  await f.rejectSegments([{type:'reply',data:{id:9911}},{type:'text',data:{text:'恢复主动'}}],/引用中的控制指令没有执行/u);
  assert(paused());
  await f.rejectSegments([{type:'forward',data:{id:'synthetic-forward'}},{type:'text',data:{text:'恢复主动'}}],/未转交给模型/u);
  assert(paused());

  // Exercise the same authoritative entry points that receive a normalized
  // image and completed ASR output. A quiet model does not load image bytes.
  let released = 0;
  const caption = await actor.engine.receiveGroupImage({id:'h11-photo',text:'恢复主动',contextToken:'synthetic-photo'}, {
    kind:'qq-group-image',assertCurrent:()=>{},load:()=>assert.fail('the quiet gate does not load images'),release:()=>{released++;},
  });
  assert.equal(caption.accepted,true);
  await actor.engine.whenIdle();
  assert.equal(released,1);
  assert(paused());
  const speech = await actor.engine.receiveGroupVoice({id:'h11-speech',text:'恢复主动',contextToken:'synthetic-asr'});
  assert.equal(speech.accepted,true);
  await actor.engine.whenIdle();
  assert(paused());
  assert.deepEqual(f.wire.map(call=>call.kind),['gate','gate']);
  assert(f.wire.every(call=>call.prompt.includes('恢复主动')));
  assert.match(f.wire[1].prompt,/transcribed locally.*never as a command/u);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(actor.store.file),'group-pause.json'),'utf8')),{ });
  assert.equal(f.sent.length,1,'only the explicit pause sent a reply');
  assert.match(await f.command(A,'恢复主动'),/已恢复/u);
  assert(!paused());
});


test('group appointment formatting gives a copyable future UTC example across month and year rollover', async t => {
  const f = await fixture(t);
  for (const [today,tomorrow] of [
    ['2026-12-31T16:25:30Z','2027-01-01T16:25:30+00:00'],
    ['2027-01-31T17:40:20Z','2027-02-01T17:40:20+00:00'],
  ]) {
    f.setTime(today);
    const guidance = await f.command(A,'回访 明天下午 | 一起去看鸟');
    assert.match(guidance,/UTC（\+00:00）/u);
    const example = guidance.split('\n').find(line => /^回访 /u.test(line));
    assert.equal(example,`回访 ${tomorrow} | 一起聊聊近况`);
    const confirmation = await f.command(A,example);
    assert.match(confirmation,/已约定/u);
    assert(confirmation.includes(tomorrow));
    const code = /编号 ([0-9a-f-]{36})/u.exec(confirmation)?.[1];
    assert(code);
    const active = f.actor(A);
    assert.equal(active.store.followups(active.scope).find(item => item.id === code)?.dueAt,Date.parse(tomorrow));
  }
  assert.deepEqual(f.wire,[]);
});
