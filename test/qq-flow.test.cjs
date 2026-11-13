'use strict';

// Local acceptance fixture, not Tencent/NapCat or model acceptance. Real WebSocket,
// QQClient, service, dispatcher, SQLite and temporary files; scripted AI executor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {once} = require('node:events');
const {WebSocketServer} = require('ws');
const {BotService} = require('../src/bot/service.cjs');

const OWNER = '12345678', ACCOUNT = '87654321', TOKEN = 'synthetic-local-onebot-token';
const CONTENT = 'ARCADE_QQ_LOCAL_FIXTURE';
const vault = {isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString()};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (predicate()) return; await wait(10); }
  assert(predicate(), label || 'local QQ flow did not reach expected state');
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-qq-flow-'));
  const server = new WebSocketServer({host: '127.0.0.1', port: 0});
  const sent = [], actions = [], executions = [], decisions = [], sockets = [];
  let service, sequence = 0, closedRunners = 0, aborted = false;
  t.after(async () => {
    await service?.disconnect();
    for (const socket of server.clients) socket.terminate();
    await new Promise(resolve => server.close(resolve));
    assert(root.startsWith(path.join(os.tmpdir(), 'arcade-qq-flow-')));
    fs.rmSync(root, {recursive: true, force: true});
  });
  server.on('connection', (socket, request) => {
    assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
    sockets.push(socket);
    socket.on('message', raw => {
      const message = JSON.parse(String(raw)); actions.push(message.action);
      let data;
      if (message.action === 'get_login_info') data = {user_id: Number(ACCOUNT), nickname: 'Synthetic QQ AI'};
      else if (message.action === 'get_status') data = {online: true, good: true};
      else if (message.action === 'get_friend_list') data = [{user_id: Number(OWNER), nickname: 'Synthetic owner', remark: ''}];
      else if (message.action === 'send_private_msg') {
        assert.equal(message.params.user_id, Number(OWNER));
        assert.equal(message.params.auto_escape, true);
        assert.equal(message.params.message.length, 1);
        assert.equal(message.params.message[0].type, 'text');
        sent.push(message.params.message[0].data.text);
        data = {message_id: 100000 + sent.length};
      } else assert.fail(`Unexpected fixture action: ${message.action}`);
      socket.send(JSON.stringify({status: 'ok', retcode: 0, echo: message.echo, data}));
    });
  });
  await once(server, 'listening');
  service = new BotService({root, vault,
    codexRunnerFactory: () => {
      const execute = async ({prompt, request, signal}) => {
        executions.push(prompt);
        if (prompt === 'Synthetic greeting') return {outcome: 'reply_ended', text: '你好，这是本机合成流程的直接回复。', sessionId: 'synthetic-thread'};
        if (prompt === 'Synthetic long task') {
          await new Promise(resolve => { if (signal.aborted) return resolve(); signal.addEventListener('abort', resolve, {once: true}); });
          aborted = signal.aborted;
          // Deliberately tempting text must never escape a cancelled result.
          return {outcome: 'cancelled', text: 'FALSE_SUCCESS_FROM_CANCELLED_FIXTURE'};
        }
        const name = prompt === 'Synthetic approved file' ? 'approved.txt'
          : prompt === 'Synthetic denied file' ? 'denied.txt'
          : prompt === 'Synthetic pending file' ? 'pending.txt' : null;
        if (!name) throw Error('Unknown synthetic input');
        const target = path.join(root, name);
        const decision = await request({kind: 'permission', tool: 'Write', input: {file_path: target, content: CONTENT}, signal});
        decisions.push(decision);
        if (decision.allow && !signal.aborted) {
          fs.writeFileSync(target, CONTENT, {flag: 'wx'});
          return {outcome: 'reply_ended', text: `Synthetic file written: ${name}`};
        }
        return {outcome: signal.aborted ? 'cancelled' : 'reply_ended', text: 'Synthetic request denied; no file written.'};
      };
      execute.close = async () => { closedRunners++; };
      return execute;
    },
  });
  service.configure({channel: 'qq', mode: 'codex', workspace: root,
    qqUrl: `ws://127.0.0.1:${server.address().port}/`, qqOwnerId: OWNER, qqToken: TOKEN});
  const send = (text, extra = {}) => {
    const message_id = extra.message_id ?? ++sequence;
    // OneBot timestamps are seconds. Ceil avoids the production first-partial-
    // second cutoff without sleeping; this is at most 999ms into the future.
    sockets.at(-1).send(JSON.stringify({post_type: 'message', message_type: 'private', sub_type: 'friend',
      self_id: Number(ACCOUNT), user_id: Number(OWNER), time: Math.ceil(Date.now() / 1000), message_id,
      message: [{type: 'text', data: {text}}], ...extra}));
    return message_id;
  };
  await service.connect();
  assert.equal(service.status, 'connected');
  assert.equal(service.snapshot().qq.check.ownerIsFriend, true);
  assert.equal(service.journal.snapshot().storage, 'sqlite');
  return {root, service, send, sent, actions, executions, decisions,
    get aborted() { return aborted; }, get closedRunners() { return closedRunners; }};
}

test('local QQ flow: owner chat is direct; one explicit approval writes and independently verifies a file', async t => {
  const f = await fixture(t);
  f.send('Untrusted stranger task', {user_id: 99999999});
  f.send('Untrusted group task', {message_type: 'group', group_id: 11223344});
  f.send('Synthetic greeting');
  await until(() => f.sent.length === 1, 'chat should produce one direct reply');
  assert.deepEqual(f.executions, ['Synthetic greeting']);
  assert.deepEqual(f.sent, ['你好，这是本机合成流程的直接回复。']);
  assert.equal(f.service.snapshot().tasks.tasks[0].state, 'reply_ended');

  f.send('Synthetic approved file');
  await until(() => f.service.snapshot().tasks.pending.length === 1 && f.sent.some(x => x.startsWith('需要你确认：Write')));
  const pending = f.service.snapshot().tasks.pending[0];
  assert.equal(fs.existsSync(path.join(f.root, 'approved.txt')), false);
  assert.match(pending.alias, /^[2-9A-HJ-NP-Z]{6}$/);
  assert.equal(f.sent.filter(x => x.startsWith('需要你确认：Write')).length, 1);
  f.send(`同意 ${pending.alias}`);
  await until(() => f.sent.includes('Synthetic file written: approved.txt'));
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'approved.txt')), Buffer.from(CONTENT));
  assert.deepEqual(f.decisions, [{allow: true}]);
  assert.equal(f.service.snapshot().tasks.tasks.at(-1).state, 'reply_ended', 'file readback is external evidence, not an invented dispatcher success state');
  f.send(`同意 ${pending.alias}`);
  await until(() => f.sent.some(x => x.includes('确认码无效')));
  assert.equal(f.executions.length, 2); assert.equal(f.decisions.length, 1);
  assert(f.actions.includes('get_status')); assert(f.actions.includes('get_friend_list'));
});

test('local QQ flow: denial leaves no artifact; stop aborts the scripted runner without publishing success', async t => {
  const f = await fixture(t);
  f.send('Synthetic denied file');
  await until(() => f.service.snapshot().tasks.pending.length === 1);
  const alias = f.service.snapshot().tasks.pending[0].alias;
  f.send(`拒绝 ${alias}`);
  await until(() => f.sent.includes('Synthetic request denied; no file written.'));
  assert.equal(fs.existsSync(path.join(f.root, 'denied.txt')), false);
  assert.deepEqual(f.decisions, [{allow: false}]);
  f.send('Synthetic long task');
  await until(() => f.executions.includes('Synthetic long task'));
  f.send('停止');
  await until(() => f.aborted && f.sent.includes('本轮已取消。'));
  assert.equal(f.service.snapshot().tasks.tasks.at(-1).state, 'cancelled');
  assert.equal(f.service.snapshot().tasks.pending.length, 0);
  assert(!f.sent.some(x => x.includes('FALSE_SUCCESS_FROM_CANCELLED_FIXTURE')));
});

test('local QQ flow: reconnect does not replay a persisted message or an old permission', async t => {
  const f = await fixture(t);
  const original = f.send('Synthetic pending file');
  await until(() => f.service.snapshot().tasks.pending.length === 1 && f.sent.some(x => x.startsWith('需要你确认：Write')));
  const alias = f.service.snapshot().tasks.pending[0].alias;
  await f.service.disconnect();
  assert.equal(f.closedRunners, 1); assert.deepEqual(f.decisions, [{allow: false}]);
  assert.equal(fs.existsSync(path.join(f.root, 'pending.txt')), false);
  const sentBeforeReconnect = f.sent.length;
  await f.service.connect();
  assert.equal(f.service.status, 'connected');
  assert.equal(f.sent.length, sentBeforeReconnect, 'connecting itself sends no chat receipt');
  f.send('Synthetic pending file', {message_id: original});
  f.send('Synthetic pending file', {time: Math.floor(Date.now() / 1000) - 60});
  f.send(`同意 ${alias}`);
  await until(() => f.sent.some(x => x.includes('确认码无效')));
  f.send('Synthetic greeting');
  await until(() => f.sent.includes('你好，这是本机合成流程的直接回复。'));
  assert.deepEqual(f.executions, ['Synthetic pending file', 'Synthetic greeting']);
  assert.equal(f.service.snapshot().tasks.pending.length, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'pending.txt')), false);
  assert(!f.sent.slice(sentBeforeReconnect).some(x => x.startsWith('需要你确认：')));
});
