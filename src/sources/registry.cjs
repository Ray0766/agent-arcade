'use strict';
// Drives the configured listen sources from a cheap once-a-second tick.
const fs = require('node:fs');
const path = require('node:path');
const {atomicJSON} = require('../core/files.cjs');
const {cleanText, digest} = require('./event.cjs');
const {validateSources, loadSources, saveSources, sourceOptions, displayTarget} = require('./config.cjs');
const {createIcsSource} = require('./ics.cjs');
const {createFolderSource} = require('./folder.cjs');
const {createFeedSource} = require('./feed.cjs');

const MAX_IN_FLIGHT = 2, MAX_BACKOFF = 30 * 60000, POLL_TIMEOUT = 120000, MAX_EVENTS_PER_POLL = 100;
const MAX_CURSOR_BYTES = 1024 * 1024, MAX_STATE_BYTES = 24 * 1024 * 1024, STATE_VERSION = 1;
const DEFAULT_FACTORIES = Object.freeze({
  ics: (config, {now}) => createIcsSource({...sourceOptions(config), now}),
  folder: (config, {now}) => createFolderSource({...sourceOptions(config), now}),
  feed: (config, {now}) => createFeedSource({...sourceOptions(config), now}),
});
const signature = config => digest(JSON.stringify([config.kind, Object.entries(sourceOptions(config)).sort(([a], [b]) => (a < b ? -1 : 1))]));
function shortError(error) {
  const code = typeof error?.code === 'string' && /^[\w.-]{1,40}$/.test(error.code) ? error.code : 'error';
  // First line only: no stack, and no credentials if a message ever quotes a URL.
  const message = cleanText(String(error?.message ?? '').split(/\r?\n/, 1)[0].replace(/\/\/[^/\s@]*@/g, '//').replace(/([?&][\w.-]{1,40}=)[^&\s]+/g, '$1\u2026'), 160);
  return {code, message:message || code};
}

class SourceRegistry {
  #file; #stateFile; #publish; #now; #factories; #entries = new Map(); #active = new Set(); #closed = false; #problem = null; #savedState = null;
  constructor({file, publish, now = Date.now, factories, stateFile} = {}) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new TypeError('The source list file must be an absolute path.');
    if (typeof publish !== 'function' || typeof now !== 'function') throw new TypeError('publish and now must be functions.');
    this.#file = file; this.#stateFile = stateFile || path.join(path.dirname(file), 'sources-state.json');
    this.#publish = publish; this.#now = now; this.#factories = {...DEFAULT_FACTORIES, ...(factories || {})};
  }
  get problem() { return this.#problem; }

  load() {
    if (this.#closed) throw new Error('The source registry is closed.');
    const {sources, problem} = loadSources(this.#file);
    this.#problem = problem || null;
    this.#rebuild(sources, this.#readState());
    return {problem:this.#problem};
  }
  configure(nextConfig) {
    if (this.#closed) throw new Error('The source registry is closed.');
    const sources = saveSources(this.#file, validateSources(nextConfig));
    this.#problem = null;
    this.#rebuild(sources, null);
    this.#saveState();
    return this.snapshot();
  }
  snapshot() {
    return [...this.#entries.values()].map(({config, lastCheckedAt, lastEventAt, lastError}) => ({
      id:config.id, kind:config.kind, name:config.name, enabled:config.enabled, notify:config.notify,
      lastCheckedAt, lastEventAt, lastError:lastError ? {...lastError} : null, target:displayTarget(config),
    }));
  }
  tick() {
    try {
      if (this.#closed) return;
      const now = this.#now();
      for (const run of this.#active) if (now - run.startedAt >= POLL_TIMEOUT) this.#fail(run, Object.assign(new Error('The check took too long.'), {code:'timeout'}), true);
      const due = [...this.#entries.values()].filter(e => e.source && e.config.enabled && !e.run && e.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt);
      for (const entry of due) { if (this.#active.size >= MAX_IN_FLIGHT) break; this.#start(entry, now); }
    } catch { /* tick must never throw into the app timer */ }
  }
  close() {
    this.#closed = true;
    for (const entry of this.#entries.values()) this.#drop(entry);
    this.#entries.clear();
  }

  #start(entry, now) {
    const run = {entry, controller:new AbortController(), startedAt:now};
    entry.run = run; this.#active.add(run);
    let pending;
    try { pending = Promise.resolve(entry.source.poll(entry.cursor, run.controller.signal)); } catch (error) { pending = Promise.reject(error); }
    pending.then(result => this.#succeed(run, result), error => this.#fail(run, error, false)).catch(() => {});
  }
  #finish(run) {
    if (!this.#active.delete(run)) return false;
    if (run.entry.run === run) run.entry.run = null;
    return !this.#closed && !run.controller.signal.aborted && this.#entries.get(run.entry.config.id) === run.entry;
  }
  #succeed(run, result) {
    if (!this.#finish(run)) return;
    const entry = run.entry, now = this.#now();
    if (!result || typeof result !== 'object' || !Array.isArray(result.events)) return this.#record(entry, {code:'invalid_result', message:'The source returned an invalid result.'}, now);
    let cursorJson = null;
    try { cursorJson = result.cursor === undefined || result.cursor === null ? null : JSON.stringify(result.cursor); } catch { /* unserializable */ }
    if (cursorJson !== null && Buffer.byteLength(cursorJson) > MAX_CURSOR_BYTES) cursorJson = null;
    const changed = cursorJson !== entry.cursorJson;
    entry.cursor = cursorJson === null ? null : JSON.parse(cursorJson); entry.cursorJson = cursorJson;
    // Persist the cursor before delivery: a crash may lose a notification but
    // never repeats one.
    if (changed) this.#saveState();
    for (const event of result.events.slice(0, MAX_EVENTS_PER_POLL)) {
      if (!event || typeof event !== 'object' || typeof event.id !== 'string') continue;
      entry.lastEventAt = now;
      try { Promise.resolve(this.#publish(event, {...entry.config})).catch(() => {}); } catch { /* one bad delivery must not stop the rest */ }
    }
    entry.failures = 0; entry.lastError = null; entry.lastCheckedAt = now; entry.nextAt = now + entry.intervalMs;
  }
  #fail(run, error, abort) {
    const live = this.#finish(run);
    if (abort) run.controller.abort();
    if (live) this.#record(run.entry, shortError(error), this.#now());
  }
  #record(entry, error, now) {
    entry.failures++; entry.lastCheckedAt = now; entry.lastError = {...error, at:now};
    entry.nextAt = now + Math.min(MAX_BACKOFF, entry.intervalMs * 2 ** Math.min(entry.failures, 20));
  }
  #drop(entry) {
    if (entry.run) { const run = entry.run; this.#active.delete(run); entry.run = null; run.controller.abort(); }
    try { entry.source?.close?.(); } catch { /* best effort */ }
    entry.source = null;
  }
  #rebuild(sources, restored) {
    const now = this.#now(), next = new Map();
    for (const config of sources) {
      const sig = signature(config), old = this.#entries.get(config.id);
      if (old && old.sig === sig && old.source && config.enabled) {
        // Same target: keep the instance, its cursor, schedule and any poll in flight.
        old.config = config; next.set(config.id, old); this.#entries.delete(config.id);
        continue;
      }
      const saved = old && old.sig === sig ? old : restored?.[config.id]?.sig === sig ? restored[config.id] : null;
      const cursorJson = saved?.cursorJson ?? null;
      const entry = {config, sig, source:null, intervalMs:60000, cursor:cursorJson === null ? null : JSON.parse(cursorJson), cursorJson,
        nextAt:now, run:null, failures:0, lastCheckedAt:old?.sig === sig ? old.lastCheckedAt : null,
        lastEventAt:old?.sig === sig ? old.lastEventAt : null, lastError:null};
      if (config.enabled) {
        try {
          const source = this.#factories[config.kind](config, {now:this.#now});
          if (!source || typeof source.poll !== 'function' || !Number.isInteger(source.intervalMs) || source.intervalMs < 1000) throw Object.assign(new Error('The source could not be created.'), {code:'invalid_source'});
          entry.source = source; entry.intervalMs = source.intervalMs;
        } catch (error) { entry.lastError = {...shortError(error), at:now}; }
      }
      next.set(config.id, entry);
    }
    for (const entry of this.#entries.values()) this.#drop(entry);
    this.#entries = next;
  }
  #readState() {
    try {
      if (fs.statSync(this.#stateFile).size > MAX_STATE_BYTES) return null;
      const state = JSON.parse(fs.readFileSync(this.#stateFile, 'utf8'));
      if (!state || state.version !== STATE_VERSION || !state.cursors || typeof state.cursors !== 'object' || Array.isArray(state.cursors)) return null;
      const out = Object.create(null);
      for (const [id, item] of Object.entries(state.cursors)) {
        if (!item || typeof item.sig !== 'string' || item.cursor === undefined || item.cursor === null) continue;
        const cursorJson = JSON.stringify(item.cursor);
        if (Buffer.byteLength(cursorJson) <= MAX_CURSOR_BYTES) out[id] = {sig:item.sig, cursorJson};
      }
      return out;
    } catch { return null; }
  }
  #saveState() {
    const cursors = {};
    for (const [id, entry] of this.#entries) if (entry.cursorJson !== null) cursors[id] = {sig:entry.sig, cursor:entry.cursor};
    const json = JSON.stringify(cursors);
    if (json === this.#savedState) return;
    // A failed state write only costs a re-baseline after restart.
    try { atomicJSON(this.#stateFile, {version:STATE_VERSION, cursors}); this.#savedState = json; } catch { /* keep running from memory */ }
  }
}

module.exports = {SourceRegistry, DEFAULT_FACTORIES};
