'use strict';
const crypto = require('node:crypto');

const MAX_TEXT = 6000, MAX_MESSAGES = 60, MAX_QUEUE = 3, REQUEST_TTL = 5 * 60 * 1000;
const outcomes = new Set(['reply_ended', 'error', 'limit', 'cancelled']);
const terminal = task => outcomes.has(task.state);
function clean(value, limit = MAX_TEXT) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '') : '';
  const redacted = text.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|password|secret|token|authorization)["']?\s*[:=]\s*["']?)[^\s"'`,;}\]]+/gi, '$1[redacted]');
  return redacted.length <= limit ? redacted : `${redacted.slice(0, Math.max(0, limit - 40))}\n[内容超限，完整结果请在本机查看。]`;
}
function serializeRequest(request) {
  try {
    const value = { tool: request.tool, input: request.input ?? { questions: request.questions } };
    if (request.kind === 'question' && request.questions) value.questions = request.questions;
    const text = JSON.stringify(value);
    // Never authorize a shortened/redacted version of an operation.
    if (!text || Buffer.byteLength(text, 'utf8') > 3000 || clean(text) !== text) return null;
    return text;
  } catch { return null; }
}

class Dispatcher {
  constructor({ execute, send, onChange = () => {}, now = Date.now } = {}) {
    if (typeof execute !== 'function' || typeof send !== 'function') throw new TypeError('execute and send are required');
    this.execute = execute; this.send = send; this.onChange = onChange; this.now = now;
    this.tasks = []; this.messages = []; this.queue = []; this.pending = new Map();
    this.seen = new Set(); this.current = null; this.sessionId = undefined; this.contextToken = undefined;
    this.stopped = false; this.draining = false; this.generation = 0; this.sendChain = Promise.resolve();
    this.drainPromise = Promise.resolve();
    this.failedFinals = new Map();
  }

  snapshot() {
    return {
      stopped: this.stopped, hasSession: Boolean(this.sessionId), currentTaskId: this.current?.id || null,
      queue: this.queue.map(task => task.id), deliveryFailed: this.tasks.some(task => task.deliveryFailed),
      tasks: this.tasks.map(task => ({ id: task.id, prompt: clean(task.prompt), state: task.state,
        outcome: task.outcome || null, createdAt: task.createdAt, updatedAt: task.updatedAt,
        activity: clean(task.activity || '', 300), text: clean(task.text || ''), deliveryFailed: task.deliveryFailed })),
      pending: [...this.pending.values()].map(p => ({ code: p.code, kind: p.kind, tool: p.tool,
        expiresAt: p.expiresAt, taskId: p.task.id })),
      messages: this.messages.map(message => ({ ...message })),
    };
  }

  _change() {
    try { Promise.resolve(this.onChange(this.snapshot())).catch(() => {}); } catch { /* UI observers cannot interrupt dispatch. */ }
  }

  _message(direction, text, taskId, deliveryFailed = false) {
    const message = { id: crypto.randomUUID(), role: direction === 'incoming' ? 'user' : 'assistant', direction, text: clean(text), at: this.now(), taskId: taskId || null, deliveryFailed };
    this.messages.push(message); this.messages = this.messages.slice(-MAX_MESSAGES); return message;
  }

  _deliver(text, { task, kind = 'status', contextToken = this.contextToken, guard } = {}) {
    const body = clean(text);
    const attempt = this.sendChain.then(async () => {
      if (this.stopped || (guard && !guard())) return false;
      const message = this._message('outgoing', body, task?.id);
      try {
        await this.send(body, contextToken);
        if (task && ['final', 'waiting'].includes(kind)) task.deliveryFailed = false;
        if (task && kind === 'final') this.failedFinals.delete(task.id);
        this._change(); return true;
      } catch {
        message.deliveryFailed = true;
        if (task) task.deliveryFailed = true;
        if (task && kind === 'final') this.failedFinals.set(task.id, body);
        this._change(); return false;
      }
    });
    this.sendChain = attempt.then(() => undefined, () => undefined);
    return attempt;
  }

  async receive({ id, text, contextToken } = {}) {
    if (this.stopped) return { accepted: false, reason: 'stopped' };
    if (!['string', 'number'].includes(typeof id) || !String(id) || String(id).length > 180 || typeof text !== 'string') return { accepted: false, reason: 'invalid' };
    const key = String(id);
    if (this.seen.has(key)) return { accepted: false, duplicate: true };
    // Retain dedupe guarantees for the entire connection rather than forgetting
    // old IDs and accidentally executing a replay. Reconnect after this limit.
    if (this.seen.size >= 10000) return { accepted: false, reason: 'message_limit' };
    this.seen.add(key); this.contextToken = contextToken; this._expire();
    const body = text.trim(); this._message('incoming', body); this._change();
    if (!body || body.length > MAX_TEXT) {
      await this._deliver('消息为空或超过 6000 字符，请缩短后重新发送。'); return { accepted: false, reason: 'invalid_text' };
    }
    if (body.startsWith('/')) return this._command(body);
    const active = [...this.pending.values()];
    if (active.length) {
      if (active.length === 1 && active[0].kind === 'question') {
        this._resolve(active[0], { allow: true, answer: body });
        await this._deliver('已收到回答。', { task: active[0].task }); return { accepted: true, answer: true };
      }
      await this._deliver('当前仍有确认请求。权限只能用 /allow CODE 或 /deny CODE；回答问题请用 /answer CODE 内容。本条消息不会创建新任务。');
      return { accepted: false, reason: 'confirmation_pending' };
    }
    if (this.queue.length >= MAX_QUEUE) {
      await this._deliver('等待队列已满（最多 3 条），请等当前任务结束或使用 /cancel。'); return { accepted: false, reason: 'queue_full' };
    }
    const task = { id: crypto.randomUUID(), prompt: body, state: 'queued', createdAt: this.now(), updatedAt: this.now(), deliveryFailed: false };
    this.tasks.push(task); this.queue.push(task); this._trim(); this._change();
    const ack = this._deliver(`任务 ${task.id.slice(0, 8)} 已收到${this.current ? '，正在排队' : ''}。`, { task, kind: 'ack' });
    this._kick(); await ack; return { accepted: true, taskId: task.id };
  }

  async _command(body) {
    const [name] = body.split(/\s/);
    const command = name.toLowerCase();
    if (command === '/status' && body === name) {
      const state = this.current ? `当前：${this.current.state}（${this.current.id.slice(0, 8)}）` : '当前空闲';
      const waits = [...this.pending.values()].map(p => `待${p.kind === 'question' ? '回答' : '批准'}：${p.tool}，剩余 ${Math.max(0, Math.ceil((p.expiresAt - this.now()) / 1000))} 秒`).join('\n');
      await this._deliver(`${state}\n排队：${this.queue.length}/3\n会话：${this.sessionId ? '将继续上次会话' : '下次新建会话'}${waits ? `\n${waits}` : ''}`);
      // Codes are only sent together with the full bounded operation/question,
      // never in a context-free status summary that could invite blind approval.
      for (const p of this.pending.values()) await this._sendPending(p);
      const last = [...this.failedFinals.entries()].at(-1);
      if (last) await this._deliver(last[1], { task: this.tasks.find(t => t.id === last[0]), kind: 'final' });
      return { accepted: true, status: true };
    }
    if (command === '/new' && body === name) {
      if (this.current || this.queue.length) {
        await this._deliver('当前仍有任务，请先 /cancel 并等本地执行停止，再使用 /new。'); return { accepted: false, reason: 'busy' };
      }
      this.sessionId = undefined; this.generation++; this._change(); await this._deliver('已清除会话上下文，下次任务将新建会话。'); return { accepted: true };
    }
    if (command === '/cancel' && body === name) {
      this._cancel(false); await this._deliver('已清空等待队列并请求中止当前任务。新任务将等本地执行停止后开始。'); return { accepted: true };
    }
    const match = body.match(/^\/(allow|deny|answer)\s+([a-f0-9]{32})(?:\s+([\s\S]+))?$/i);
    if (match) {
      const pending = this.pending.get(match[2].toLowerCase());
      if (!pending || pending.expiresAt <= this.now() || pending.task !== this.current || pending.generation !== this.generation) {
        await this._deliver('确认码无效、已过期或不属于当前任务，未批准任何操作。'); return { accepted: false, reason: 'stale_code' };
      }
      const action = match[1].toLowerCase();
      if (action === 'deny') this._resolve(pending, { allow: false });
      else if (pending.kind === 'permission' && action === 'allow' && !match[3]) this._resolve(pending, { allow: true });
      else if (pending.kind === 'question' && action === 'answer' && match[3]?.trim()) this._resolve(pending, { allow: true, answer: match[3].trim() });
      else {
        await this._deliver('命令与请求不匹配：权限使用 /allow CODE；问题使用 /answer CODE 回答。'); return { accepted: false, reason: 'wrong_confirmation' };
      }
      await this._deliver(action === 'deny' ? '已拒绝本次请求。' : '已收到本次确认。', { task: pending.task }); return { accepted: true };
    }
    await this._deliver('可用命令：/status、/new、/cancel、/allow CODE、/deny CODE、/answer CODE 内容。');
    return { accepted: false, reason: 'unknown_command' };
  }

  _kick() {
    if (this.draining || this.stopped) return;
    this.draining = true;
    // Assign the idle promise before execute/onChange can synchronously trigger
    // disconnect. A replacement dispatcher must wait for the actual runner.
    let settled;
    this.drainPromise = new Promise(resolve => { settled = resolve; });
    this._drain().catch(() => {}).finally(() => {
      this.draining = false; settled();
      if (this.queue.length && !this.stopped) this._kick();
    }).catch(() => {});
  }

  async _drain() {
    while (this.queue.length && !this.stopped) {
      const task = this.queue.shift(); this.current = task;
      const controller = new AbortController(); task.controller = controller; task.state = 'running'; task.updatedAt = this.now(); this._change();
      let result;
      try {
        result = await this.execute({ prompt: task.prompt, resume: this.sessionId, signal: controller.signal,
          onUpdate: update => {
            if (task !== this.current || controller.signal.aborted || this.stopped) return;
            task.activity = clean(typeof update === 'string' ? update : update?.text || update?.tool || '', 300);
            task.updatedAt = this.now(); this._change();
          }, request: request => this._request(task, request) });
      } catch { result = { outcome: controller.signal.aborted ? 'cancelled' : 'error' }; }
      for (const pending of [...this.pending.values()]) if (pending.task === task) this._resolve(pending, { allow: false });
      if (typeof result?.sessionId === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(result.sessionId)) this.sessionId = result.sessionId;
      const outcome = controller.signal.aborted || this.stopped ? 'cancelled' : outcomes.has(result?.outcome) ? result.outcome : 'error';
      task.state = task.outcome = outcome; task.updatedAt = this.now();
      task.text = outcome === 'reply_ended' ? clean(result?.text || '本轮没有可显示的回复文本。', MAX_TEXT - 100) : '';
      const labels = { reply_ended: '回复结束（任务结果未验证）', error: '执行出错，请在本机查看详情。任务结果未验证。', limit: '达到执行限制，本轮已停止。任务结果未验证。', cancelled: '本轮已取消。' };
      const final = `任务 ${task.id.slice(0, 8)}：${labels[outcome]}${task.text ? `\n${task.text}` : ''}`;
      this.current = null; delete task.controller; this._change();
      if (!this.stopped) void this._deliver(final, { task, kind: 'final' });
    }
  }

  _request(task, request) {
    this._expire();
    if (this.stopped || task !== this.current || task.controller.signal.aborted || request?.signal?.aborted || !['permission', 'question'].includes(request?.kind)) return Promise.resolve({ allow: false });
    const questions = request.questions || request.input?.questions;
    const serialized = serializeRequest(request);
    if (!serialized || typeof request.tool !== 'string' || !request.tool || request.tool.length > 80 || this.pending.size >= 8 ||
      (request.kind === 'permission' && request.input === undefined) ||
      (request.kind === 'question' && (!Array.isArray(questions) || questions.length !== 1 || typeof questions[0]?.question !== 'string'))) {
      void this._deliver('请求过大、格式不受支持或包含敏感参数，已拒绝远程确认。请在本机处理。', { task }); return Promise.resolve({ allow: false });
    }
    const code = crypto.randomBytes(16).toString('hex'), expiresAt = this.now() + REQUEST_TTL;
    return new Promise(resolve => {
      const pending = { code, kind: request.kind, tool: clean(request.tool, 80), expiresAt, task, generation: this.generation, resolve };
      pending.message = request.kind === 'permission'
        ? `任务 ${task.id.slice(0, 8)} 请求本机权限。批准后此操作可读取、修改文件或影响本机，请核对完整参数。\n${serialized}\n批准：/allow ${code}\n拒绝：/deny ${code}\n确认码 5 分钟内有效，仅限本次请求。`
        : `任务 ${task.id.slice(0, 8)} 需要回答一个问题；回答不会批准其他本机操作。\n${serialized}\n请回复 /answer ${code} 你的回答，或直接回复答案。\n拒绝：/deny ${code}\n确认码 5 分钟内有效。`;
      pending.timer = setTimeout(() => this._expireOne(pending), REQUEST_TTL); pending.timer.unref?.();
      this.pending.set(code, pending); this._waitingState(task); this._change();
      if (request.signal?.addEventListener) {
        pending.signal = request.signal; pending.abort = () => this._resolve(pending, { allow: false });
        request.signal.addEventListener('abort', pending.abort, { once: true });
      }
      void this._sendPending(pending);
    });
  }

  _sendPending(pending) {
    return this._deliver(pending.message, { task: pending.task, kind: 'waiting',
      guard: () => this.pending.get(pending.code) === pending && pending.task === this.current &&
        pending.generation === this.generation && pending.expiresAt > this.now() });
  }

  _waitingState(task) {
    if (task.controller.signal.aborted) return;
    const requests = [...this.pending.values()].filter(p => p.task === task);
    task.state = requests.some(p => p.kind === 'permission') ? 'waiting_permission' : requests.length ? 'waiting_question' : 'running';
    task.updatedAt = this.now();
  }

  _resolve(pending, value) {
    if (!this.pending.has(pending.code)) return;
    this.pending.delete(pending.code); clearTimeout(pending.timer);
    if (pending.signal && pending.abort) pending.signal.removeEventListener('abort', pending.abort);
    this._waitingState(pending.task); pending.resolve(value); this._change();
  }

  _expire() {
    for (const pending of [...this.pending.values()]) if (pending.expiresAt <= this.now()) this._expireOne(pending);
  }

  _expireOne(pending) {
    if (!this.pending.has(pending.code)) return;
    this._resolve(pending, { allow: false });
    if (!this.stopped) void this._deliver('确认请求已过期，已拒绝本次操作。', { task: pending.task });
  }

  _cancel(stopping) {
    this.generation++;
    for (const task of this.queue.splice(0)) { task.state = task.outcome = 'cancelled'; task.updatedAt = this.now(); }
    if (this.current) { this.current.state = 'cancelling'; this.current.controller.abort(); }
    for (const pending of [...this.pending.values()]) this._resolve(pending, { allow: false });
    if (stopping) { this.stopped = true; this.contextToken = undefined; }
    this._change();
  }

  stop() { this._cancel(true); }

  whenIdle() { return this.drainPromise; }

  _trim() {
    while (this.tasks.length > 60) {
      const index = this.tasks.findIndex(terminal); if (index < 0) break;
      this.failedFinals.delete(this.tasks[index].id); this.tasks.splice(index, 1);
    }
  }
}
module.exports = { Dispatcher, clean };
