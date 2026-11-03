'use strict';

// Text-only iLink client. Protocol reference (Tencent, MIT), consulted 2026-11-03:
// https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md
// This is an independent, deliberately smaller implementation; no OpenClaw runtime.
const { randomBytes, randomUUID } = require('node:crypto');
const { version } = require('../../package.json');

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TEXT = 16000;
const MAX_SEEN = 2000;
const ID_FIELDS = new Set(['message_id', 'msg_id', 'svr_id']);

class WeixinError extends Error {
  constructor(code) {
    super(`Weixin request failed (${code}).`);
    this.name = code === 'aborted' ? 'AbortError' : 'WeixinError';
    this.code = code;
  }
}

function bounded(value, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new WeixinError('invalid_input');
  }
  return value;
}

function trustedBaseUrl(value = DEFAULT_BASE_URL) {
  let url;
  try { url = new URL(value); } catch { throw new WeixinError('untrusted_host'); }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash ||
      !(host === 'ilinkai.weixin.qq.com' || host.endsWith('.ilinkai.weixin.qq.com'))) {
    throw new WeixinError('untrusted_host');
  }
  return url.origin;
}

function checkResult(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new WeixinError('invalid_response');
  for (const field of ['ret', 'errcode']) {
    if (data[field] === undefined) continue;
    if (typeof data[field] !== 'number' || !Number.isInteger(data[field])) throw new WeixinError('invalid_response');
    if (data[field] === -14) throw new WeixinError('session_expired');
    if (data[field] !== 0) throw new WeixinError('service_error');
  }
  return data;
}

// JSON.parse source context preserves uint64 IDs on current Node/Electron.
// Older engines without source context reject unsafe numeric IDs downstream.
function parseResponse(text) {
  try {
    return JSON.parse(text, (key, value, context) => {
      if (ID_FIELDS.has(key) && typeof value === 'number' && /^\d+$/.test(context?.source || '')) {
        return context.source;
      }
      return value;
    });
  } catch { throw new WeixinError('invalid_response'); }
}

function messageId(value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value;
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

class WeixinClient {
  constructor({ token = '', baseUrl = DEFAULT_BASE_URL, ownerId = '', acceptAfter,
    seenIds = [], fetchImpl = globalThis.fetch, now = Date.now,
    timeoutMs = 15000, longPollTimeoutMs = 40000 } = {}) {
    this.baseUrl = trustedBaseUrl(baseUrl);
    this.token = bounded(token, 8192, false);
    this.ownerId = bounded(ownerId, 256, false);
    this.fetch = fetchImpl;
    this.now = now;
    this.acceptAfter = acceptAfter ?? now();
    if (!Number.isSafeInteger(this.acceptAfter) || this.acceptAfter < 0) throw new WeixinError('invalid_input');
    this.seen = new Map((Array.isArray(seenIds) ? seenIds.filter(x => messageId(x) === x).slice(-MAX_SEEN) : [])
      .map(id => [id, this.acceptAfter]));
    this.timeoutMs = Math.min(15000, Math.max(1, timeoutMs));
    this.longPollTimeoutMs = Math.min(65000, Math.max(1, longPollTimeoutMs));
    this.loginBase = DEFAULT_BASE_URL;
  }

  async request(endpoint, { method = 'POST', body, signal, auth = true,
    baseUrl = this.baseUrl, timeoutMs = this.timeoutMs } = {}) {
    if (auth && !this.token) throw new WeixinError('not_connected');
    if (signal?.aborted) throw new WeixinError('aborted');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const parts = version.split('.').map(Number);
    const headers = {
      'iLink-App-Id': 'bot',
      'iLink-App-ClientVersion': String((parts[0] << 16) | (parts[1] << 8) | parts[2])
    };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      headers.AuthorizationType = 'ilink_bot_token';
      headers['X-WECHAT-UIN'] = Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64');
    }
    if (auth) headers.Authorization = `Bearer ${this.token}`;
    try {
      const response = await this.fetch(new URL(endpoint, `${trustedBaseUrl(baseUrl)}/`).href, {
        method, headers, redirect: 'error', signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (response.redirected) throw new WeixinError('untrusted_host');
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new WeixinError('http_error');
      }
      const length = Number(response.headers.get('content-length'));
      if (length > MAX_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw new WeixinError('response_too_large');
      }
      if (!response.body) throw new WeixinError('invalid_response');
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw new WeixinError('response_too_large');
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      if (signal?.aborted) throw new WeixinError('aborted');
      if (timedOut) throw new WeixinError('timeout');
      return checkResult(parseResponse(Buffer.concat(chunks, bytes).toString('utf8')));
    } catch (error) {
      if (signal?.aborted) throw new WeixinError('aborted');
      if (timedOut) throw new WeixinError('timeout');
      if (error instanceof WeixinError) throw error;
      throw new WeixinError('network_error');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  baseInfo() { return { channel_version: version, bot_agent: `AgentArcade/${version}` }; }

  async startLogin(signal) {
    const data = await this.request('ilink/bot/get_bot_qrcode?bot_type=3', {
      body: { local_token_list: [] }, signal, auth: false, baseUrl: DEFAULT_BASE_URL
    });
    this.loginBase = DEFAULT_BASE_URL;
    return { qrcode: bounded(data.qrcode, 4096), qrContent: bounded(data.qrcode_img_content, 8192) };
  }

  async pollLogin(qrcode, signal, verifyCode = '') {
    bounded(qrcode, 4096);
    bounded(verifyCode, 32, false);
    const query = new URLSearchParams({ qrcode });
    if (verifyCode) query.set('verify_code', verifyCode);
    let data;
    try {
      data = await this.request(`ilink/bot/get_qrcode_status?${query}`, {
        method: 'GET', auth: false, signal, baseUrl: this.loginBase, timeoutMs: this.longPollTimeoutMs
      });
    } catch (error) {
      if (error.code === 'timeout') return { status: 'wait' };
      throw error;
    }
    const status = data.status;
    if (status === 'scaned_but_redirect') {
      const host = bounded(data.redirect_host, 256);
      // A redirect is protocol data, never permission to forward credentials elsewhere.
      this.loginBase = trustedBaseUrl(`https://${host}`);
      return { status };
    }
    if (status === 'confirmed') {
      return { status, token: bounded(data.bot_token, 8192), botId: bounded(data.ilink_bot_id, 256),
        ownerId: bounded(data.ilink_user_id, 256), baseUrl: trustedBaseUrl(data.baseurl) };
    }
    if (!['wait', 'scaned', 'expired', 'need_verifycode', 'verify_code_blocked', 'binded_redirect'].includes(status)) {
      throw new WeixinError('invalid_response');
    }
    return { status };
  }

  async getUpdates(cursor = '', signal) {
    if (!this.ownerId) throw new WeixinError('owner_required');
    bounded(cursor, 65536, false);
    let data;
    try {
      data = await this.request('ilink/bot/getupdates', { body: {
        get_updates_buf: cursor, base_info: this.baseInfo()
      }, signal, timeoutMs: this.longPollTimeoutMs });
    } catch (error) {
      if (error.code === 'timeout') return { cursor, messages: [], timeoutMs: this.longPollTimeoutMs };
      throw error;
    }
    const rows = data.msgs ?? [];
    if (!Array.isArray(rows) || rows.length > 200) throw new WeixinError('invalid_response');
    // Tencent's monitor treats missing/empty cursor as no replacement, not a reset.
    const nextCursor = data.get_updates_buf == null || data.get_updates_buf === ''
      ? cursor : bounded(data.get_updates_buf, 65536, false);
    const messages = [];
    for (const msg of rows) {
      if (!msg || typeof msg !== 'object' || msg.message_type !== 1 || msg.message_state !== 2 ||
          msg.from_user_id !== this.ownerId || msg.group_id || msg.delete_time_ms) continue;
      const id = messageId(msg.message_id);
      const createdAt = msg.create_time_ms;
      if (!id || this.seen.has(id) || !Number.isSafeInteger(createdAt) ||
          createdAt < this.acceptAfter || createdAt > this.now() + 60000) continue;
      this.seen.set(id, createdAt);
      if (this.seen.size > MAX_SEEN) {
        const [oldId, oldTime] = this.seen.entries().next().value;
        this.seen.delete(oldId);
        // Reject replay of evicted IDs without keeping an unbounded history.
        // Extremely delayed messages at/before this floor are deliberately dropped.
        this.acceptAfter = Math.max(this.acceptAfter, oldTime + 1);
      }
      if (!Array.isArray(msg.item_list) || msg.item_list.length < 1 || msg.item_list.length > 20 ||
          msg.item_list.some(item => !item || item.type !== 1 || typeof item.text_item?.text !== 'string')) continue;
      const text = msg.item_list.map(item => item.text_item.text).join('\n');
      if (!text.trim() || text.length > MAX_TEXT || typeof msg.context_token !== 'string' ||
          !msg.context_token || msg.context_token.length > 8192) continue;
      messages.push({ id, from: this.ownerId, text, contextToken: msg.context_token, createdAt });
    }
    const timeoutMs = Number.isFinite(data.longpolling_timeout_ms)
      ? Math.min(65000, Math.max(1000, data.longpolling_timeout_ms + 5000)) : this.longPollTimeoutMs;
    this.longPollTimeoutMs = timeoutMs;
    return { cursor: nextCursor, messages, timeoutMs };
  }

  async sendText(to, text, contextToken, clientId = randomUUID(), signal) {
    if (!this.ownerId || to !== this.ownerId) throw new WeixinError('owner_required');
    bounded(text, MAX_TEXT);
    bounded(contextToken, 8192);
    bounded(clientId, 128);
    const data = await this.request('ilink/bot/sendmessage', { body: {
      msg: { from_user_id: '', to_user_id: to, client_id: clientId, message_type: 2, message_state: 2,
        context_token: contextToken, item_list: [{ type: 1, text_item: { text } }] },
      base_info: this.baseInfo()
    }, signal });
    return { id: messageId(data.message_id), clientId };
  }

  seenIds() { return [...this.seen.keys()]; }
}

module.exports = { WeixinClient, WeixinError, trustedBaseUrl, DEFAULT_BASE_URL };
