'use strict';

// Independent OneBot v11 client. A separately installed local bridge owns the
// QQ login; this module never requests credentials or changes the QQ client.
const {randomUUID} = require('node:crypto');
const {prepareInbound} = require('./weixin.cjs');
const {validateImagePayload, QQMediaError} = require('./qq-media.cjs');
const {ownerRecordParams, QQVoiceError} = require('./qq-voice-payload.cjs');
const {QQOwnerRemarkError, validateRemark, safeCode: remarkCode} = require('./qq-owner-remark.cjs');
const {captureOwnerVoice} = require('./qq-inbound-voice.cjs');
const {captureOwnerImage} = require('./qq-inbound-image.cjs');
const {captureOwnerQuote} = require('./qq-quoted-image.cjs');

const MAX_FRAME = 1024 * 1024;
const MAX_QUEUE = 200;
const MAX_SEEN = 10000;
const MAX_TEXT = 16000;
const MAX_FRIENDS = 10000;
const MAX_SOCIAL_TEXT = 2000;
const DEFAULT_QQ_URL = 'ws://127.0.0.1:3001/';

class QQError extends Error {
  constructor(code) {
    super(`QQ bridge request failed (${code}).`);
    this.name = code === 'aborted' ? 'AbortError' : 'QQError';
    this.code = code;
  }
}

function validateQQUrl(value = DEFAULT_QQ_URL) {
  let url;
  try { url = new URL(value); } catch { throw new QQError('invalid_bridge_url'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      !url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new QQError('invalid_bridge_url');
  }
  return url.href;
}

function validateQQOwner(value) {
  const id = Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== 'string' || !/^[1-9]\d{4,14}$/.test(id) || !Number.isSafeInteger(Number(id))) {
    throw new QQError('invalid_owner');
  }
  return id;
}

function eventId(value) {
  if (Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^-?\d{1,20}$/.test(value)) return value;
  return null;
}

function sameQQ(value, expected) {
  return (Number.isSafeInteger(value) || typeof value === 'string') && String(value) === expected;
}

function socialText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_SOCIAL_TEXT || value.includes('\0')) {
    throw new QQError('invalid_social_text');
  }
  return value;
}

function socialId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new QQError('invalid_social_id');
  }
  return value;
}

function remarkGuard(client, signal, assertCurrent) {
  const accountId=client.accountId,ownerId=client.ownerId,generation=client.generation,socket=client.socket;
  return () => {
    if(signal?.aborted)throw new QQOwnerRemarkError('cancelled');
    if(client.ownerId!==ownerId||client.accountId!==accountId)throw new QQOwnerRemarkError('account_changed');
    if(client.generation!==generation||client.socket!==socket)throw new QQOwnerRemarkError('changed');
    if(!client.ready||client.closed||socket?.readyState!==1)throw new QQOwnerRemarkError('disconnected');
    assertCurrent();
  };
}

const FRIEND_REQUEST_CODES = new Set(['invalid_request', 'disconnected', 'changed', 'closed', 'expired',
  'stale_request', 'operation_in_progress', 'cancelled', 'invalid_response', 'account_changed', 'account_offline', 'status_unverified']);
function friendRequestCode(error) {
  if (error?.code === 'aborted') return 'cancelled';
  if (error?.code === 'account_mismatch') return 'account_changed';
  if (error?.code === 'bridge_unhealthy') return 'status_unverified';
  return FRIEND_REQUEST_CODES.has(error?.code) ? error.code : 'invalid_response';
}

function friendRequestGuard(client, signal, assertCurrent) {
  const accountId = client.accountId, ownerId = client.ownerId, generation = client.generation, socket = client.socket;
  const check = () => {
    if (signal?.aborted) throw new QQError('cancelled');
    if (client.closed) throw new QQError('closed');
    if (client.accountId !== accountId || client.ownerId !== ownerId) throw new QQError('account_changed');
    if (client.generation !== generation || client.socket !== socket) throw new QQError('changed');
    if (!client.ready || !accountId || socket?.readyState !== 1) throw new QQError('disconnected');
  };
  return () => {
    check();
    const result = assertCurrent();
    // The last guard must finish before the fixed write is invoked. An async
    // callback cannot authorize a write while its eventual decision is pending.
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new QQError('invalid_request');
    }
    check();
  };
}

// Do not silently strip an image/file/CQ code and execute its remaining text.
// Replies stay text metadata by default. Only no-tools companionship may
// attach a private exact-reference descriptor; no lookup occurs in this parser.
function normalizeMessage(message) {
  if (typeof message === 'string') {
    if (message.includes('[CQ:')) return {text: '', unsupported: 'qq_segments'};
    return {text: message};
  }
  if (!Array.isArray(message) || !message.length || message.length > 40) return {text: '', unsupported: 'qq_segments'};
  let text = '', quote = null;
  for (const segment of message) {
    if (segment?.type === 'text' && typeof segment.data?.text === 'string') {
      text += segment.data.text;
      if (text.length > MAX_TEXT) return {text: '', unsupported: 'qq_oversize'};
    } else if (segment?.type === 'reply' && !quote && eventId(segment.data?.id)) {
      quote = {id: eventId(segment.data.id), title: 'QQ 引用（原文未读取）', text: ''};
    } else return {text: '', unsupported: 'qq_segments'};
  }
  return {text, ...(quote ? {quote} : {})};
}

function prepareQQInbound(message) {
  if (message.unsupported === 'qq_image') return {...message, text: '', rejection: '这张图片没有读到，请重新发送单张 JPG 或 PNG；可以附上一句想问的话。'};
  if (message.unsupported === 'qq_segments') return {...message, text: '', rejection: '当前 QQ 接入只处理文字和文字引用。图片、文件、语音及其他消息段未执行，请单独输入需求。'};
  if (message.unsupported === 'qq_oversize') return {...message, text: '', rejection: '这条 QQ 消息过长，没有作为任务执行，请缩短后重发。'};
  return prepareInbound(message);
}

function defaultSocketFactory(url, options) {
  const WebSocket = require('ws');
  return new WebSocket(url, options);
}

class QQClient {
  constructor({url = DEFAULT_QQ_URL, token, ownerId, expectedAccountId, acceptAfter, now = Date.now,
    socketFactory = defaultSocketFactory, timeoutMs = 10000, pollTimeoutMs = 20000,
    heartbeatTimeoutMs = 90000, onFriendRequest = () => {}, allowOwnerVoice = false, allowOwnerImage = false, receiveOwnerMessages = true} = {}) {
    this.url = validateQQUrl(url);
    this.ownerId = validateQQOwner(ownerId);
    this.expectedAccountId = expectedAccountId === undefined ? '' : validateQQOwner(expectedAccountId);
    if (this.expectedAccountId === this.ownerId) throw new QQError('owner_is_agent_account');
    if (typeof token !== 'string' || !/^[\x21-\x7e]{16,256}$/.test(token)) throw new QQError('invalid_token');
    this.token = token;
    this.now = now;
    if (typeof onFriendRequest !== 'function') throw new QQError('invalid_input');
    if (typeof allowOwnerImage !== 'boolean') throw new QQError('invalid_input');
    this.allowOwnerImage = allowOwnerImage;
    if (typeof allowOwnerVoice !== 'boolean') throw new QQError('invalid_input');
    if (typeof receiveOwnerMessages !== 'boolean') throw new QQError('invalid_input');
    this.receiveOwnerMessages = receiveOwnerMessages;
    this.onFriendRequest = onFriendRequest;
    this.allowOwnerVoice = allowOwnerVoice;
    this.connectedAt = null;
    this.acceptAfter = acceptAfter ?? now();
    if (!Number.isSafeInteger(this.acceptAfter) || this.acceptAfter < 0) throw new QQError('invalid_input');
    this.socketFactory = socketFactory;
    this.timeoutMs = Math.max(1, Math.min(15000, timeoutMs));
    this.pollTimeoutMs = Math.max(1, Math.min(30000, pollTimeoutMs));
    this.heartbeatTimeoutMs = Math.max(100, Math.min(120000, heartbeatTimeoutMs));
    this.socket = null;
    this.generation = 0;
    this.accountId = '';
    this.nickname = '';
    this.ready = false;
    this.closed = false;
    this.pending = new Map();
    this.queue = [];
    this.seen = new Set();
    this.waiter = null;
    this.cursor = 0;
    this.lastError = null;
    this.connectionPromise = null;
    this.everConnected = false;
    this.contextToken = '';
  }

  connect(signal) {
    if (signal?.aborted) return Promise.reject(new QQError('aborted'));
    if (this.closed) return Promise.reject(new QQError('closed'));
    // Keep explicit expiry across a gap between polls. A user-requested new
    // connection creates a fresh client after the owner logs in through NapCat.
    if (this.lastError?.code === 'login_required') return Promise.reject(this.lastError);
    if (this.ready && this.socket?.readyState === 1) return Promise.resolve({accountId: this.accountId, nickname: this.nickname});
    if (this.connectionPromise) return this.connectionPromise;
    const operation = this._connect(signal);
    this.connectionPromise = operation;
    operation.then(() => { if (this.connectionPromise === operation) this.connectionPromise = null; },
      () => { if (this.connectionPromise === operation) this.connectionPromise = null; });
    return operation;
  }

  async _connect(signal) {
    const generation = ++this.generation;
    let socket;
    try {
      socket = this.socketFactory(this.url, {headers: {Authorization: `Bearer ${this.token}`},
        followRedirects: false, handshakeTimeout: this.timeoutMs, maxPayload: MAX_FRAME, perMessageDeflate: false});
    } catch { throw new QQError('connect_failed'); }
    this.socket = socket;
    this.lastError = null;
    if (this.everConnected) this.acceptAfter = Math.max(this.acceptAfter, this.now());
    this.everConnected = true;
    const current = () => this.socket === socket && this.generation === generation && !this.closed;
    const onAbort = () => { if (current()) this._drop(new QQError('aborted')); };
    this.removeSignal = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, {once: true});
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new QQError('connect_timeout')), this.timeoutMs);
        const cleanup = () => { clearTimeout(timer); socket.off('open', opened); socket.off('close', closed); socket.off('error', failed); socket.off('unexpected-response', unexpected); };
        const fail = error => { cleanup(); reject(error); };
        const opened = () => { cleanup(); current() ? resolve() : reject(new QQError('aborted')); };
        const closed = () => fail(new QQError('disconnected'));
        const failed = () => fail(new QQError('connect_failed'));
        const unexpected = (_request, response) => {
          response.resume?.();
          fail(new QQError([401, 403].includes(response.statusCode) ? 'unauthorized' : 'connect_failed'));
        };
        socket.once('open', opened); socket.once('close', closed); socket.once('error', failed);
        socket.once('unexpected-response', unexpected);
        socket.on('error', () => { if (current()) this._drop(new QQError('bridge_error')); });
        socket.on('close', () => { if (current()) this._drop(new QQError('disconnected')); });
        socket.on('message', (data, binary) => { if (current()) this._frame(data, binary); });
        socket.on('pong', () => { if (current()) this.lastActivity = this.now(); });
      });
      if (!current() || signal?.aborted) throw new QQError('aborted');
      const data = await this._request('get_login_info', {}, signal);
      let account;
      try { account = validateQQOwner(data?.user_id); } catch { throw new QQError('invalid_login_info'); }
      if (this.expectedAccountId && account !== this.expectedAccountId) throw new QQError('account_mismatch');
      if (account === this.ownerId) throw new QQError('owner_is_agent_account');
      if (this.accountId && account !== this.accountId) throw new QQError('account_changed');
      if (!current() || signal?.aborted) throw new QQError('aborted');
      this.accountId = account;
      this.nickname = typeof data.nickname === 'string' ? data.nickname.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '')
        .trim().slice(0, 128).replace(/[\uD800-\uDBFF]$/u, '') : '';
      // A live socket and cached account identity do not prove a live QQ login.
      // Repeat this read-only check on every new socket, including reconnects.
      await this._requireOnline(signal);
      if (!current() || signal?.aborted) throw new QQError('aborted');
      const connectedAt = this.now();
      if (!Number.isSafeInteger(connectedAt) || connectedAt < 0) throw new QQError('invalid_input');
      this.contextToken = '';
      // Request-event freshness is relative to this verified socket, never the
      // ordinary-message replay cutoff retained in acceptAfter.
      this.connectedAt = connectedAt;
      this.ready = true;
      this.lastActivity = connectedAt;
      this.heartbeat = setInterval(() => {
        if (!current()) return;
        if (this.now() - this.lastActivity > this.heartbeatTimeoutMs) return this._drop(new QQError('heartbeat_timeout'));
        try { socket.ping(); } catch { this._drop(new QQError('disconnected')); }
      }, Math.max(100, Math.min(15000, Math.floor(this.heartbeatTimeoutMs / 3))));
      this.heartbeat.unref?.();
      return {accountId: this.accountId, nickname: this.nickname};
    } catch (error) {
      if (current()) this._drop(error instanceof QQError ? error : new QQError('connect_failed'));
      throw error instanceof QQError ? error : new QQError('connect_failed');
    }
  }

  async _requireOnline(signal) {
    const status = await this._request('get_status', {}, signal);
    if (!status || typeof status !== 'object' || Array.isArray(status) || typeof status.online !== 'boolean') {
      throw new QQError('status_unverified');
    }
    if (!status.online) throw new QQError('account_offline');
    if (status.good === false) throw new QQError('bridge_unhealthy');
  }

  async inspect(signal) {
    const alreadyReady = this.ready && this.socket?.readyState === 1;
    const {accountId, nickname} = await this.connect(signal);
    const generation = this.generation;
    const assertConnected = () => {
      if (signal?.aborted) throw new QQError('aborted');
      if (!this.ready || this.generation !== generation || this.accountId !== accountId) {
        throw this.lastError || new QQError('disconnected');
      }
    };
    const optional = async action => {
      try {
        const data = await this._request(action, {}, signal);
        assertConnected();
        return data;
      } catch (error) {
        assertConnected();
        if (error.code === 'aborted') throw error;
        return null;
      }
    };
    // The new connection has already checked online status. Inspecting an
    // existing socket must check it again; only friendship remains optional.
    if (alreadyReady) {
      try { await this._requireOnline(signal); assertConnected(); }
      catch (error) { if (this.generation === generation) this._drop(error); throw error; }
    }
    const friends = await optional('get_friend_list');
    assertConnected();
    let ownerIsFriend = null;
    if (Array.isArray(friends) && friends.length <= MAX_FRIENDS) {
      try {
        const ids = friends.map(friend => validateQQOwner(friend?.user_id));
        ownerIsFriend = ids.includes(this.ownerId);
      } catch { /* An incomplete or malformed list cannot prove friendship. */ }
    }
    return {accountId, nickname, online: true, ownerIsFriend};
  }

  _drop(error) {
    const socket = this.socket;
    this.socket = null;
    this.generation++;
    this.ready = false;
    this.connectedAt = null;
    this.lastError = error;
    this.contextToken = '';
    this.queue = [];
    clearInterval(this.heartbeat);
    this.removeSignal?.();
    this.removeSignal = null;
    for (const pending of [...this.pending.values()]) pending.reject(error);
    this.waiter?.();
    try { socket?.terminate(); } catch { /* already closed */ }
  }

  _frame(raw, binary) {
    if (binary || !(typeof raw === 'string' || Buffer.isBuffer(raw)) || Buffer.byteLength(raw) > MAX_FRAME) {
      this._drop(new QQError('invalid_frame')); return;
    }
    let frame;
    try { frame = JSON.parse(String(raw)); } catch { this._drop(new QQError('invalid_frame')); return; }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) { this._drop(new QQError('invalid_frame')); return; }
    this.lastActivity = this.now();
    if (typeof frame.echo === 'string') {
      // Action responses cannot also be events. Never let a forged echo bypass
      // the account binding check below or resolve an unrelated send receipt.
      if (frame.post_type !== undefined) { this._drop(new QQError('invalid_frame')); return; }
      const pending = this.pending.get(frame.echo);
      if (!pending) return;
      if (frame.status !== 'ok' || frame.retcode !== 0) pending.reject(new QQError('action_failed'));
      else pending.resolve(frame.data);
      return;
    }
    // Some bridges can switch the signed-in QQ account without closing the WS.
    // Retaining the old reply context would then send from the wrong identity.
    if (this.accountId && frame.self_id !== undefined && !sameQQ(frame.self_id, this.accountId)) {
      this._drop(new QQError('account_changed')); return;
    }
    if (frame.post_type === 'notice' && frame.notice_type === 'bot_offline' &&
        this.accountId && sameQQ(frame.self_id, this.accountId)) {
      // NapCat 4.18.42 forwards QQ's title/description here. Recognize only the
      // observed exact system signature, never infer auth failure from arbitrary
      // text or relay that text to the UI. Other offline notices stay uncertain.
      const expired = frame.tag === '下线通知' &&
        ['你的账号当前登录已失效，请重新登录', '你的账号当前登录已失效，请重新登录。'].includes(frame.message);
      this._drop(new QQError(expired ? 'login_required' : 'account_offline')); return;
    }
    if (frame.post_type === 'meta_event') {
      if (frame.meta_event_type === 'heartbeat') {
        if (frame.status?.online === false) this._drop(new QQError('account_offline'));
        else if (frame.status?.good === false) this._drop(new QQError('bridge_unhealthy'));
      }
      return;
    }
    if (frame.post_type === 'request') {
      if (this.ready && frame.request_type === 'friend' && frame.group_id === undefined && frame.echo === undefined &&
          sameQQ(frame.self_id, this.accountId)) {
        // Main owns freshness, one-use flags and the bounded inbox. Requests
        // never enter the owner-message queue, history or model input.
        const event = {post_type: 'request', request_type: 'friend', self_id: frame.self_id,
          user_id: frame.user_id, time: frame.time, comment: frame.comment, flag: frame.flag};
        try {
          const result = this.onFriendRequest(event, {client: this, generation: this.generation});
          if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
        } catch { /* An optional management consumer cannot break QQ messaging. */ }
      }
      return;
    }
    // A main-only management connection still processes identity/notices/requests,
    // but cannot create message contexts, deduplication entries or a queue.
    if (!this.receiveOwnerMessages) return;
    if (!this.ready || frame.post_type !== 'message' || frame.message_type !== 'private' || frame.sub_type !== 'friend' ||
        !sameQQ(frame.self_id, this.accountId) || !sameQQ(frame.user_id, this.ownerId) || frame.group_id !== undefined) return;
    const id = eventId(frame.message_id), createdAt = frame.time * 1000;
    if (!id || !Number.isSafeInteger(frame.time) || !Number.isSafeInteger(createdAt) || createdAt < this.acceptAfter ||
        createdAt > this.now() + 60000 || this.seen.has(id)) return;
    if (this.seen.size >= MAX_SEEN || this.queue.length >= MAX_QUEUE) { this._drop(new QQError('message_limit')); return; }
    this.seen.add(id);
    let normalized = normalizeMessage(frame.message);
    if (this.allowOwnerVoice && Array.isArray(frame.message) && frame.message.length === 1 && frame.message[0]?.type === 'record') {
      try {
        // Main enables this only for an opted-in companion. The descriptor has
        // a validated cache key, never an upstream URL, path or audio payload.
        const voice = captureOwnerVoice(frame, {accountId: this.accountId, ownerId: this.ownerId,
          companion: true, acceptAfter: this.acceptAfter, now: this.now()});
        normalized = {text: '', voice};
      } catch { /* Preserve the ordinary unsupported-segment rejection. */ }
    }
    if (this.allowOwnerImage && Array.isArray(frame.message) && frame.message.some(part => part?.type === 'image')) {
      try {
        const image = captureOwnerImage(frame, {accountId: this.accountId, ownerId: this.ownerId,
          companion: true, acceptAfter: this.acceptAfter, now: this.now()});
        normalized = {text: image.caption, image};
      } catch { normalized = {text: '', unsupported: 'qq_image'}; }
    }
    if (this.allowOwnerImage && normalized.quote && !normalized.unsupported && !prepareQQInbound(normalized).rejection) {
      try {
        const image = captureOwnerQuote(frame, {accountId: this.accountId, ownerId: this.ownerId,
          companion: true, acceptAfter: this.acceptAfter, now: this.now()});
        normalized = {text: image.caption, quote: normalized.quote, image};
      } catch { /* Preserve the original bounded text-quote path. */ }
    }
    if (normalized.text.length > MAX_TEXT) { normalized.text = ''; normalized.unsupported = 'qq_oversize'; }
    this.contextToken ||= randomUUID();
    this.queue.push({id, from: this.ownerId, contextToken: this.contextToken, createdAt, ...normalized});
    this.waiter?.();
  }

  _request(action, params, signal) {
    if (signal?.aborted) return Promise.reject(new QQError('aborted'));
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return Promise.reject(new QQError('disconnected'));
    if (this.pending.size >= 20) return Promise.reject(new QQError('request_limit'));
    const echo = randomUUID();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, data) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(echo);
        error ? reject(error) : resolve(data);
      };
      const timer = setTimeout(() => finish(new QQError('action_timeout')), this.timeoutMs);
      const abort = () => finish(new QQError('aborted'));
      this.pending.set(echo, {resolve: data => finish(null, data), reject: error => finish(error)});
      signal?.addEventListener('abort', abort, {once: true});
      try { socket.send(JSON.stringify({action, params, echo}), error => { if (error) finish(new QQError('send_failed')); }); }
      catch { finish(new QQError('send_failed')); }
    });
  }

  async getUpdates(cursor = '', signal) {
    if (!(cursor === '' || (typeof cursor === 'string' && /^\d{1,16}$/.test(cursor) && Number(cursor) === this.cursor))) throw new QQError('invalid_cursor');
    await this.connect(signal);
    if (!this.queue.length) {
      if (this.waiter) throw new QQError('concurrent_poll');
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); if (this.waiter === done) this.waiter = null; resolve(); };
        const timer = setTimeout(done, this.pollTimeoutMs);
        this.waiter = done;
        signal?.addEventListener('abort', done, {once: true});
        if (signal?.aborted || !this.ready) done();
      });
    }
    if (signal?.aborted) throw new QQError('aborted');
    if (!this.ready) throw this.lastError || new QQError('disconnected');
    const messages = this.queue.splice(0, MAX_QUEUE);
    this.cursor += messages.length;
    return {cursor: String(this.cursor), messages};
  }

  async sendText(to, text, contextToken, clientId = randomUUID(), signal) {
    if (to !== this.ownerId) throw new QQError('owner_required');
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT || typeof clientId !== 'string' || clientId.length > 128) throw new QQError('invalid_input');
    // A disconnected send is ambiguous; never reconnect and replay it silently.
    if (!this.ready || !this.contextToken || contextToken !== this.contextToken) throw new QQError('stale_context');
    const data = await this._request('send_private_msg', {user_id: Number(this.ownerId),
      message: [{type: 'text', data: {text}}], auto_escape: true}, signal);
    const id = eventId(data?.message_id);
    if (!id) throw new QQError('invalid_send_receipt');
    return {id, clientId};
  }

  async _socialAccount(signal) {
    // Proactive actions are a distinct path, never a fabricated inbound reply.
    // The caller owns its persisted action policy. Recheck the signed-in QQ
    // before each action because the bridge can switch accounts without a WS
    // close/event. No reconnect or ambiguous-write retry occurs here.
    if (signal?.aborted) throw new QQError('aborted');
    if (!this.ready || !this.accountId || this.closed || this.socket?.readyState !== 1) throw new QQError('disconnected');
    const accountId = this.accountId, generation = this.generation;
    const login = await this._request('get_login_info', {}, signal);
    if (this.expectedAccountId && !sameQQ(login?.user_id, this.expectedAccountId)) {
      this._drop(new QQError('account_mismatch'));
      throw new QQError('account_mismatch');
    }
    if (!sameQQ(login?.user_id, accountId)) {
      this._drop(new QQError('account_changed'));
      throw new QQError('account_changed');
    }
    const assertCurrent = () => {
      if (signal?.aborted) throw new QQError('aborted');
      if (!this.ready || this.closed || this.generation !== generation || this.accountId !== accountId || this.socket?.readyState !== 1) {
        throw this.lastError || new QQError('disconnected');
      }
    };
    assertCurrent();
    return {accountId, assertCurrent};
  }

  async sendProactiveText(to, text, clientId = randomUUID(), signal) {
    if (to !== this.ownerId) throw new QQError('owner_required');
    socialText(text); socialId(clientId);
    const {assertCurrent} = await this._socialAccount(signal);
    const data = await this._request('send_private_msg', {user_id: Number(this.ownerId),
      message: [{type: 'text', data: {text}}], auto_escape: true}, signal);
    assertCurrent();
    const id = eventId(data?.message_id);
    if (!id) throw new QQError('invalid_send_receipt');
    return {id, clientId};
  }

  readSelfProfile(signal, {assertCurrent = () => {}} = {}) {
    const {QQSelfProfileTransport}=require('./qq-self-profile-transport.cjs');
    const binding={client:this,accountId:this.accountId,socket:this.socket,clientGeneration:this.generation};
    return new QQSelfProfileTransport({now:this.now}).read(binding,{signal,assertCurrent});
  }

  setSelfSignature(value, signal, {expectedValue,assertCurrent = () => {}} = {}) {
    const {QQSelfProfileTransport}=require('./qq-self-profile-transport.cjs');
    const binding={client:this,accountId:this.accountId,socket:this.socket,clientGeneration:this.generation};
    return new QQSelfProfileTransport({now:this.now}).write(binding,{field:'signature',value,expectedValue},{signal,assertCurrent});
  }

  setSelfNickname(value, signal, {expectedValue,expectedSignature,assertCurrent = () => {}} = {}) {
    const {QQSelfProfileTransport}=require('./qq-self-profile-transport.cjs');
    const binding={client:this,accountId:this.accountId,socket:this.socket,clientGeneration:this.generation};
    return new QQSelfProfileTransport({now:this.now}).write(binding,{field:'nickname',value,expectedValue,expectedSignature},{signal,assertCurrent});
  }

  async readOwnerRemark(signal, {assertCurrent = () => {}} = {}) {
    if(typeof assertCurrent!=='function')throw new QQOwnerRemarkError('invalid_request');
    const deadline=AbortSignal.timeout(10000),combined=signal?AbortSignal.any([signal,deadline]):deadline,check=remarkGuard(this,combined,assertCurrent);
    try {
      check();let current=await this._socialAccount(combined);check();
      await this._requireOnline(combined);current.assertCurrent();check();
      const rows=await this._request('get_friend_list',{no_cache:false},combined);
      check();
      if(!Array.isArray(rows))throw new QQOwnerRemarkError('invalid_response');
      if(rows.length>MAX_FRIENDS)throw new QQOwnerRemarkError('response_too_large');
      let owner;
      for(const row of rows){
        let id;try{if(!row||typeof row!=='object'||Array.isArray(row))throw new Error();id=validateQQOwner(row.user_id);}catch{throw new QQOwnerRemarkError('invalid_response');}
        if(id===this.ownerId){if(owner)throw new QQOwnerRemarkError('invalid_response');owner=row;}
      }
      if(!owner)throw new QQOwnerRemarkError('owner_not_found');
      if(typeof owner.remark!=='string'||typeof owner.nickname!=='string')throw new QQOwnerRemarkError('invalid_response');
      const nickname=owner.nickname.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu,'').slice(0,128).replace(/[\uD800-\uDBFF]$/u,'');
      let supported=true;try{validateRemark(owner.remark);}catch{supported=false;}
      current=await this._socialAccount(combined);check();await this._requireOnline(combined);current.assertCurrent();check();
      return {accountId:current.accountId,ownerId:this.ownerId,nickname,fetchedAt:new Date(this.now()).toISOString(),source:'bridge-cache',
        ...(supported?{remark:owner.remark,supported:true}:{supported:false,reason:'original_unsupported'})};
    }catch(error){throw new QQOwnerRemarkError(deadline.aborted&&!signal?.aborted?'timeout':remarkCode(error));}
  }

  async setOwnerRemark(remark, signal, {assertCurrent = () => {}, expectedRemark} = {}) {
    let submitted=false;
    const deadline=AbortSignal.timeout(20000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
    try {
      if(typeof assertCurrent!=='function')throw new QQOwnerRemarkError('invalid_request');
      const check=remarkGuard(this,combined,assertCurrent);
      validateRemark(remark);validateRemark(expectedRemark);check();
      const baseline=await this.readOwnerRemark(combined,{assertCurrent:check});check();
      if(!baseline.supported)throw new QQOwnerRemarkError('original_unsupported');
      if(baseline.remark!==expectedRemark)throw new QQOwnerRemarkError('baseline_changed');
      const current=await this._socialAccount(combined);check();await this._requireOnline(combined);current.assertCurrent();check();
      // Fixed owner only. The read/compare is optimistic; NapCat has no CAS API.
      submitted=true;
      const receipt=await this._request('set_friend_remark',{user_id:this.ownerId,remark},combined);
      // NapCat 4.18.42 declares a null return schema, but its Promise<void>
      // handler also produces an omitted JSON data field. _request has already
      // checked the matching echo, status === 'ok' and numeric retcode === 0.
      if(receipt!==null&&receipt!==undefined)throw new QQOwnerRemarkError('change_unknown');
      return {outcome:'accepted'};
    }catch(error){return {outcome:submitted?'unknown':'not_submitted',code:submitted?'change_unknown':deadline.aborted&&!signal?.aborted?'timeout':remarkCode(error)};}
  }

  async decideFriendRequest(value, {signal, assertCurrent = () => {}} = {}) {
    let submitted = false;
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'approve,flag' ||
          typeof value.approve !== 'boolean' || typeof value.flag !== 'string' || !value.flag || value.flag.length > 512 ||
          /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value.flag) || typeof assertCurrent !== 'function') throw new QQError('invalid_request');
      const {flag, approve} = value, check = friendRequestGuard(this, signal, assertCurrent);
      check();
      const current = await this._socialAccount(signal); check();
      await this._requireOnline(signal); current.assertCurrent(); check();
      // Fixed action and explicit Boolean; no target, optional remark, implicit
      // approval, reconnect or retry. The caller has already consumed its flag.
      submitted = true;
      const receipt = await this._request('set_friend_add_request', {flag, approve}, signal);
      // The pinned void handler may omit data. The transport still requires a
      // matched echo, status === 'ok', and numeric retcode === 0.
      if (receipt !== null && receipt !== undefined) throw new QQError('invalid_response');
      // Preserve a genuine acceptance even if the panel changes afterwards.
      // This receipt is not independent confirmation of resulting friendship.
      return {outcome: 'accepted'};
    } catch (error) {
      return {outcome: submitted ? 'unknown' : 'not_submitted', code: submitted ? 'unknown' : friendRequestCode(error)};
    }
  }

  async sendOwnerImage(to, pngBytes, clientId = randomUUID(), signal, {assertCurrent = () => {}} = {}) {
    let submitted = false, bytes;
    try {
      if (to !== this.ownerId || typeof clientId !== 'string' || !clientId || clientId.length > 128 ||
          /[\p{Cc}\p{Cf}]/u.test(clientId) || typeof assertCurrent !== 'function') throw new QQMediaError('invalid_request');
      validateImagePayload(pngBytes); bytes = Buffer.from(pngBytes);
      // Explicit owner media has its own preflight. It cannot reconnect or
      // broaden a text reply into arbitrary segments, files, URLs or targets.
      assertCurrent();
      let current = await this._socialAccount(signal); assertCurrent();
      await this._requireOnline(signal); current.assertCurrent(); assertCurrent();
      current = await this._socialAccount(signal); current.assertCurrent(); assertCurrent();
      const params = {user_id: this.ownerId, message: [{type: 'image', data: {file: `base64://${bytes.toString('base64')}`}}]};
      submitted = true;
      const receipt = await this._request('send_private_msg', params, signal);
      const messageId = eventId(receipt?.message_id);
      if (!messageId) throw new QQMediaError('send_unknown');
      // Matching bridge acceptance is not proof of display/read/delivery. A
      // context change after the receipt must not turn acceptance into failure.
      return {outcome: 'accepted', messageId};
    } catch (error) {
      const code = new QQMediaError(error?.code === 'aborted' ? 'cancelled' : error?.code).code;
      return {outcome: submitted ? 'unknown' : 'not_sent', code: submitted ? 'send_unknown' : code};
    } finally { bytes?.fill(0); }
  }

  async sendOwnerRecord(to, wavBytes, clientId = randomUUID(), signal, {assertCurrent = () => {}} = {}) {
    let submitted = false;
    try {
      if (to !== this.ownerId || typeof clientId !== 'string' || !clientId || clientId.length > 128 ||
          /[\p{Cc}\p{Cf}]/u.test(clientId) || typeof assertCurrent !== 'function') throw new QQVoiceError('invalid_request');
      // Validate before preflight; the renderer cannot supply paths, URLs,
      // segment types or recipients. NapCat owns its subsequent SILK conversion.
      const params = ownerRecordParams(this.ownerId, wavBytes);
      assertCurrent();
      let current = await this._socialAccount(signal); assertCurrent();
      await this._requireOnline(signal); current.assertCurrent(); assertCurrent();
      current = await this._socialAccount(signal); current.assertCurrent(); assertCurrent();
      submitted = true;
      const receipt = await this._request('send_private_msg', params, signal);
      const messageId = eventId(receipt?.message_id);
      if (!messageId) throw new QQVoiceError('send_unknown');
      // This is matched bridge acceptance, not proof of recipient playback.
      return {outcome: 'accepted', messageId};
    } catch (error) {
      const code = new QQVoiceError(error?.code === 'aborted' ? 'cancelled' : error?.code).code;
      return {outcome: submitted ? 'unknown' : 'not_sent', code: submitted ? 'send_unknown' : code};
    }
  }

  async publishQzoneText(text, {audience = 'self', clientId = randomUUID()} = {}, signal) {
    socialText(text); socialId(clientId);
    if (!['owner', 'self'].includes(audience)) throw new QQError('invalid_social_audience');
    const {assertCurrent} = await this._socialAccount(signal);
    // NapCat 4.18.42 SendQzoneMsg: 16 = selected friends, 64 = self.
    // Never omit ugc_right: upstream defaults to 1 (public). Publishing is one
    // request; no downgrade/retry to a wider audience on bridge failure.
    const params = {content: text, ugc_right: audience === 'owner' ? 16 : 64,
      ...(audience === 'owner' ? {target_uins: [this.ownerId]} : {})};
    const data = await this._request('send_qzone_msg', params, signal);
    assertCurrent();
    let id;
    try { id = socialId(data?.tid); } catch { throw new QQError('invalid_send_receipt'); }
    if (!Number.isSafeInteger(data?.time) || data.time < 0) throw new QQError('invalid_send_receipt');
    // A write receipt confirms the bridge response, not recipient visibility.
    return {id, clientId, time: data.time, audience, visibilityVerified: false};
  }

  async getOwnQzonePost(id, signal) {
    socialId(id);
    const {accountId, assertCurrent} = await this._socialAccount(signal);
    const data = await this._request('get_qzone_msg_detail', {tid: id, target_uin: accountId, pos: 0, num: 1}, signal);
    assertCurrent();
    if (data?.tid !== id || typeof data.content !== 'string' || data.content.length > MAX_SOCIAL_TEXT) throw new QQError('invalid_post_receipt');
    // Keep social-feed comments and other people's data out of the app's result.
    return {id, text: data.content};
  }

  close() {
    this.closed = true;
    this._drop(new QQError('closed'));
  }
}

module.exports = {QQClient, QQError, DEFAULT_QQ_URL, validateQQUrl, validateQQOwner, prepareQQInbound};
