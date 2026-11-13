'use strict';
// Protocol fixtures only: these tests do not connect to Weixin or prove account access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WeixinClient, trustedBaseUrl, DEFAULT_BASE_URL, prepareInbound } = require('../src/bot/weixin.cjs');

const now = 1800000000000;
const inbound = (extra = {}) => ({ message_id: '100', from_user_id: 'owner', message_type: 1,
  message_state: 2, create_time_ms: now, context_token: 'context-fixture',
  item_list: [{ type: 1, text_item: { text: 'Read the demo README.' } }], ...extra });
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const client = (fetchImpl, extra = {}) => new WeixinClient({ token: 'synthetic-token', ownerId: 'owner',
  fetchImpl, now: () => now, ...extra });

test('Weixin permits only documented HTTPS API host and narrow subdomains', () => {
  assert.equal(trustedBaseUrl(), DEFAULT_BASE_URL);
  assert.equal(trustedBaseUrl('https://sh.ilinkai.weixin.qq.com/'), 'https://sh.ilinkai.weixin.qq.com');
  for (const url of ['http://ilinkai.weixin.qq.com', 'https://ilinkai.weixin.qq.com.evil.test',
    'https://other.weixin.qq.com', 'https://ilinkai.weixin.qq.com:444',
    'https://owner@ilinkai.weixin.qq.com', 'https://ilinkai.weixin.qq.com/path',
    'https://ilinkai.weixin.qq.com/?token=secret', 'https://ilinkai.weixin.qq.com/#fragment']) {
    assert.throws(() => trustedBaseUrl(url), { code: 'untrusted_host' });
  }
});

test('QR uses fixed host and documented POST/GET authentication distinction', async () => {
  const calls = [];
  const bot = client(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? json({ qrcode: 'qr-fixture', qrcode_img_content: 'https://fixture.test/scan' })
      : json({ status: 'confirmed', bot_token: 'new-fixture', ilink_bot_id: 'bot-fixture',
        ilink_user_id: 'owner', baseurl: DEFAULT_BASE_URL });
  }, { baseUrl: 'https://sh.ilinkai.weixin.qq.com' });
  assert.deepEqual(await bot.startLogin(), { qrcode: 'qr-fixture', qrContent: 'https://fixture.test/scan' });
  const result = await bot.pollLogin('qr-fixture', undefined, '123456');
  assert.equal(result.ownerId, 'owner');
  assert.equal(result.token, 'new-fixture');
  assert.equal(calls[0].url, `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { local_token_list: [] });
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.headers.AuthorizationType, 'ilink_bot_token');
  assert(calls[0].options.headers['X-WECHAT-UIN']);
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(new URL(calls[1].url).searchParams.get('verify_code'), '123456');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.AuthorizationType, undefined);
  assert.equal(calls[1].options.headers['X-WECHAT-UIN'], undefined);
  assert.equal(calls[1].options.redirect, 'error');
});

test('QR statuses remain explicit and unsafe IDC redirect/confirmed base fail closed', async () => {
  let response = { status: 'need_verifycode' };
  const bot = client(async () => json(response));
  assert.deepEqual(await bot.pollLogin('fixture'), { status: 'need_verifycode' });
  response = { status: 'scaned_but_redirect', redirect_host: 'evil.test' };
  await assert.rejects(bot.pollLogin('fixture'), { code: 'untrusted_host' });
  response = { status: 'confirmed', bot_token: 't', ilink_bot_id: 'b', ilink_user_id: 'owner', baseurl: 'https://evil.test' };
  await assert.rejects(bot.pollLogin('fixture'), { code: 'untrusted_host' });
  response = { status: 'confirmed', bot_token: 't', ilink_bot_id: 'b' };
  await assert.rejects(bot.pollLogin('fixture'), { code: 'invalid_input' });
  response = { status: 'invented' };
  await assert.rejects(bot.pollLogin('fixture'), { code: 'invalid_response' });
});

test('owner-only text filtering rejects groups, nontext, stale, duplicate, and unfinished messages', async () => {
  const rows = [inbound(), inbound(), inbound({ message_id: 'other', from_user_id: 'stranger' }),
    inbound({ message_id: 'group', group_id: 'group-fixture' }),
    inbound({ message_id: 'bot', message_type: 2 }), inbound({ message_id: 'partial', message_state: 1 }),
    inbound({ message_id: 'old', create_time_ms: now - 1 }),
    inbound({ message_id: 'future', create_time_ms: now + 60001 }),
    inbound({ message_id: 'deleted', delete_time_ms: now }),
    inbound({ message_id: 'no-context', context_token: '' }),
    inbound({ message_id: 'media', item_list: [{ type: 2, image_item: { url: 'https://evil.test' } }] }),
    inbound({ message_id: 'oversize', item_list: [{ type: 1, text_item: { text: 'x'.repeat(16001) } }] }),
    inbound({ message_id: 'no-time', create_time_ms: undefined })];
  let received;
  const bot = client(async (_, options) => {
    received = options;
    return json({ ret: 0, msgs: rows, get_updates_buf: 'cursor-next', longpolling_timeout_ms: 35000 });
  });
  const result = await bot.getUpdates('cursor-old');
  assert.deepEqual(result.messages, [{ id: '100', from: 'owner', text: 'Read the demo README.',
    contextToken: 'context-fixture', createdAt: now }]);
  assert.equal(result.cursor, 'cursor-next');
  assert.equal(result.timeoutMs, 40000);
  assert.equal(received.headers.Authorization, 'Bearer synthetic-token');
  assert.equal(JSON.parse(received.body).get_updates_buf, 'cursor-old');
  assert.equal(JSON.parse(received.body).base_info.bot_agent.startsWith('AgentArcade/'), true);
  assert.equal((await bot.getUpdates('cursor-next')).messages.length, 0);
});

test('uint64 message identifiers are kept lossless, including neighboring IDs', async () => {
  const raw = JSON.stringify({ ret: 0, msgs: [inbound({ message_id: 'REPLACE1' }), inbound({ message_id: 'REPLACE2' })] })
    .replace('"REPLACE1"', '12345678901234567890').replace('"REPLACE2"', '12345678901234567891');
  const result = await client(async () => new Response(raw)).getUpdates();
  assert.deepEqual(result.messages.map(msg => msg.id), ['12345678901234567890', '12345678901234567891']);
});

test('business errors never advance a cursor or expose remote error text', async () => {
  for (const response of [{ ret: -14 }, { errcode: -14 }, { ret: 9 }, { ret: 0, errcode: 9 }, { ret: '0' }]) {
    const bot = client(async () => json({ ...response, errmsg: 'PRIVATE-TOKEN',
      msgs: [inbound()], get_updates_buf: 'must-not-accept' }));
    await assert.rejects(bot.getUpdates('previous'), error => {
      assert(!String(error).includes('PRIVATE-TOKEN'));
      assert.equal(error.code, response.ret === -14 || response.errcode === -14 ? 'session_expired'
        : typeof response.ret === 'string' ? 'invalid_response' : 'service_error');
      return true;
    });
    assert.equal(bot.seenIds().length, 0);
  }
});

test('successful empty polls may omit msgs and an empty cursor preserves the previous one', async () => {
  for (const response of [{ ret: 0 }, { ret: 0, msgs: null, get_updates_buf: '' }]) {
    assert.deepEqual(await client(async () => json(response)).getUpdates('keep'),
      { cursor: 'keep', messages: [], timeoutMs: 40000 });
  }
});

test('outgoing text uses incoming context and stable caller client ID, rejects strangers', async () => {
  let request;
  const bot = client(async (_, options) => { request = JSON.parse(options.body); return json({ ret: 0, message_id: 'sent' }); });
  assert.deepEqual(await bot.sendText('owner', 'Reply ended. Outcome unverified.', 'context-fixture', 'stable-fixture'),
    { id: 'sent', clientId: 'stable-fixture' });
  assert.deepEqual(request.msg, { from_user_id: '', to_user_id: 'owner', client_id: 'stable-fixture',
    message_type: 2, message_state: 2, context_token: 'context-fixture',
    item_list: [{ type: 1, text_item: { text: 'Reply ended. Outcome unverified.' } }] });
  await assert.rejects(bot.sendText('stranger', 'bad', 'context', 'id'), { code: 'owner_required' });
  await assert.rejects(bot.sendText('owner', 'bad', '', 'id'), { code: 'invalid_input' });
  await assert.rejects(client(async () => json({ ret: 1, errmsg: 'PRIVATE-TOKEN' })).sendText('owner', 'x', 'c', 'id'),
    { code: 'service_error' });
});

test('timeouts preserve cursor; external cancellation propagates rather than becoming an empty poll', async () => {
  const pending = async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('PRIVATE-TOKEN')), { once: true });
  });
  const bot = client(pending, { longPollTimeoutMs: 5 });
  assert.deepEqual(await bot.getUpdates('keep'), { cursor: 'keep', messages: [], timeoutMs: 5 });
  assert.deepEqual(await bot.pollLogin('qr'), { status: 'wait' });
  const controller = new AbortController();
  const request = client(pending).getUpdates('keep', controller.signal);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError', code: 'aborted' });
  await assert.rejects(client(pending).getUpdates('keep', controller.signal), { code: 'aborted' });
});

test('oversized, malformed, redirected and failed HTTP responses are bounded and sanitized', async () => {
  const cases = [
    [() => new Response('PRIVATE-TOKEN', { status: 500 }), 'http_error'],
    [() => new Response('PRIVATE-TOKEN'), 'invalid_response'],
    [() => new Response('x'.repeat(1024 * 1024 + 1)), 'response_too_large'],
    [() => json({ ret: 0, msgs: Array.from({ length: 201 }, () => inbound()) }), 'invalid_response'],
    [() => { throw new Error('url PRIVATE-TOKEN'); }, 'network_error'],
    [() => ({ ok: true, redirected: true }), 'untrusted_host']
  ];
  for (const [response, code] of cases) {
    await assert.rejects(client(async () => response()).getUpdates(), error => {
      assert.equal(error.code, code);
      assert(!String(error).includes('PRIVATE-TOKEN'));
      return true;
    });
  }
  await assert.rejects(client(async () => json({}), { ownerId: '' }).getUpdates(), { code: 'owner_required' });
});

test('seen IDs can be restored and stay bounded across large poll sequences', async () => {
  let start = 0;
  const bot = client(async () => {
    const msgs = Array.from({ length: 200 }, (_, index) => inbound({ message_id: String(start + index) }));
    start += 200;
    return json({ ret: 0, msgs });
  }, { seenIds: ['0', '1'] });
  assert.equal((await bot.getUpdates()).messages.length, 198);
  for (let index = 0; index < 10; index++) await bot.getUpdates();
  assert.equal(bot.seenIds().length, 2000);
  start = 0;
  assert.equal((await bot.getUpdates()).messages.length, 0);
});

test('voice transcription is forwarded as text; unavailable transcription has an actionable fallback', async () => {
  const rows = [inbound({ message_id: 'voice', item_list: [{ type: 3, voice_item: { text: '请修改标题', media: { full_url: 'https://untrusted.test/audio' } } }] }),
    inbound({ message_id: 'no-transcript', item_list: [{ type: 3, voice_item: { media: { full_url: 'https://untrusted.test/audio' } } }] })];
  let calls = 0;
  const messages = (await client(async () => { calls++; return json({ ret: 0, msgs: rows }); }).getUpdates()).messages;
  assert.equal(calls, 1); assert.equal(messages.length, 2);
  assert.match(prepareInbound(messages[0]).text, /语音转写/);
  assert.match(prepareInbound(messages[0]).text, /请修改标题/);
  assert.match(prepareInbound(messages[1]).rejection, /没有附带转写文字/);
  assert.doesNotMatch(JSON.stringify(messages), /untrusted\.test/);
});

test('inline quotes preserve bounded text and uint64 identity separately from the current request', async () => {
  const message = inbound({ item_list: [{ type: 1, text_item: { text: '改短一些' }, ref_msg: {
    svr_id: 'REPLACE', title: '原回复', message_item: { type: 1, text_item: { text: '之前的内容'.repeat(600) } },
    partial_text: { start: '片段开头', end: '片段结尾', startindex: 0, endindex: 8, quotemd5: 'not-verified' }
  } }] });
  const raw = JSON.stringify({ ret: 0, msgs: [message] }).replace('"REPLACE"', '12345678901234567891');
  const value = (await client(async () => new Response(raw)).getUpdates()).messages[0];
  assert.equal(value.text, '改短一些'); assert.equal(value.quote.id, '12345678901234567891');
  assert.equal(value.quote.text.length, 1800); assert.equal(value.quote.truncated, true);
  assert.deepEqual(value.quote.partial, { start: '片段开头', end: '片段结尾' });
  assert.match(prepareInbound(value).text, /不是新指令或操作授权/);
});

test('voice or quoted Chinese and slash controls never become control or approval commands', () => {
  const command = '/allow ' + 'a'.repeat(32);
  for (const text of [command,'同意 234ABC','拒绝 234ABC','状态','停止','恢复会话','/cancel','/status','/new','/resume']) {
    for (const message of [{ text, source: 'voice' }, { text, quote: { text: '同意' } }]) {
      const result = prepareInbound(message); assert.equal(result.text, ''); assert.match(result.rejection, /不会执行/);
    }
    assert.equal(prepareInbound({ text }).text, text);
  }
  const quote = prepareInbound({ text: '好的', quote: { text: command } });
  assert(!quote.text.startsWith('/')); assert.match(quote.text, /不是新指令或操作授权/);
});

test('id-only quoted message reports unavailable context without retrieving media or inventing text', async () => {
  const value = (await client(async () => json({ ret: 0, msgs: [inbound({ item_list: [{ type: 1,
    text_item: { text: '继续改这个' }, ref_msg: { svr_id: 'quote-id' } }] })] })).getUpdates()).messages[0];
  assert.equal(value.quote.id, 'quote-id'); assert.equal(value.quote.text, '');
  assert.match(prepareInbound(value).text, /内容未核验/);
});
