'use strict';
// Watches one directory level by polling names, sizes and modification times.
// File contents are never read and events carry the file name only.
const fs = require('node:fs');
const path = require('node:path');
const {makeEvent, isSourceId} = require('./event.cjs');

const MAX_EVENTS = 50, MIN_INTERVAL = 5000, MAX_INTERVAL = 86400000, HARD_MAX_ENTRIES = 5000, BATCH = 32;
const fail = (code, message) => Object.assign(new Error(message || code), {code});
const TITLES = {'folder.added':'File added', 'folder.changed':'File changed', 'folder.removed':'File removed'};

function absolutePath(value, label) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\x00-\x1f]/.test(value) || !path.isAbsolute(value)) {
    throw fail('invalid_input', `The ${label} must be an absolute path.`);
  }
  return path.normalize(value);
}
function createFolderSource({id, dir, intervalMs = 30000, maxEntries = 2000, fsImpl = fs.promises, now = Date.now} = {}) {
  if (!isSourceId(id)) throw fail('invalid_input', 'The source id must be 1-64 characters of A-Z, a-z, 0-9, _ or -.');
  const root = absolutePath(dir, 'folder');
  if (!Number.isInteger(intervalMs) || intervalMs < MIN_INTERVAL || intervalMs > MAX_INTERVAL) throw fail('invalid_input', 'The check interval must be between 5 seconds and 24 hours.');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > HARD_MAX_ENTRIES) throw fail('invalid_input', `The file limit must be between 1 and ${HARD_MAX_ENTRIES}.`);
  if (!fsImpl || typeof fsImpl.readdir !== 'function' || typeof fsImpl.lstat !== 'function' || typeof now !== 'function') throw fail('invalid_input', 'Invalid folder source options.');
  async function listing(signal) {
    const names = (await fsImpl.readdir(root, {withFileTypes:true})).filter(entry => entry.isFile() && !entry.isSymbolicLink()).map(entry => entry.name);
    if (names.length > maxEntries) throw fail('too_many_entries', `The folder has more than ${maxEntries} files.`);
    const files = new Map();
    for (let index = 0; index < names.length; index += BATCH) {
      if (signal?.aborted) throw fail('aborted');
      await Promise.all(names.slice(index, index + BATCH).map(async name => {
        let stat;
        try { stat = await fsImpl.lstat(path.join(root, name)); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
        if (stat.isFile() && !stat.isSymbolicLink()) files.set(name, [stat.size, Math.round(stat.mtimeMs)]);
      }));
    }
    return files;
  }
  async function poll(cursor, signal) {
    if (signal?.aborted) throw fail('aborted');
    const current = await listing(signal);
    const stored = cursor && typeof cursor === 'object' && cursor.files && typeof cursor.files === 'object' && !Array.isArray(cursor.files) ? cursor.files : null;
    if (!stored) return {cursor:{files:Object.fromEntries(current)}, events:[]};
    const previous = new Map(Object.entries(stored).filter(([, sig]) => Array.isArray(sig) && sig.length === 2));
    const changes = [];
    for (const [name, sig] of current) {
      const old = previous.get(name);
      if (!old) changes.push(['folder.added', name, sig]);
      else if (old[0] !== sig[0] || old[1] !== sig[1]) changes.push(['folder.changed', name, sig]);
    }
    for (const [name, sig] of previous) if (!current.has(name)) changes.push(['folder.removed', name, sig]);
    changes.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    // Only the reported changes are folded into the cursor, so anything past
    // the cap is detected again and reported by the next poll.
    const at = now(), events = [];
    for (const [kind, name, sig] of changes.slice(0, MAX_EVENTS)) {
      if (kind === 'folder.removed') previous.delete(name); else previous.set(name, sig);
      events.push(makeEvent({source:id, kind, subject:name, key:`${sig[0]}:${sig[1]}`, title:`${TITLES[kind]}: ${name}`, at,
        data:kind === 'folder.removed' ? {name:name.slice(0, 255)} : {name:name.slice(0, 255), size:sig[0]}}));
    }
    return {cursor:{files:Object.fromEntries(previous)}, events};
  }
  return Object.freeze({id, kind:'folder', intervalMs, target:root, poll});
}

module.exports = {createFolderSource, absolutePath, MAX_EVENTS};
