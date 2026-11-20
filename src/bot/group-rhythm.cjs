'use strict';

const fs = require('node:fs');
const {atomicJSON} = require('../core/files.cjs');

const MINUTE = 60000;
const QUIET_TIME = 15 * MINUTE;
const FOLLOWUP_GRACE = 5 * MINUTE;
const MAX_MEMBERS = 40;
const MAX_ATTEMPTS = 64;
const MAX_BYTES = 32768;
const empty = () => ({
  members: [], registrations: [], activityAt: null, humanAt: null, decisionAt: null,
  lastAttemptAt: null, attempts: [],
});
const stamp = value => Number.isSafeInteger(value) && value >= 0;
const validId = value => typeof value === 'string' && value.length > 0 &&
  value.length <= 256 && !/[\x00-\x20\x7f]/.test(value);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

function validState(state) {
  if (!state || Object.keys(state).some(key => !Object.hasOwn(empty(), key))) return false;
  const {members, registrations = [], attempts} = state;
  return Array.isArray(members) && members.length <= MAX_MEMBERS &&
    members.every(validId) && new Set(members).size === members.length &&
    Array.isArray(registrations) && registrations.length <= MAX_MEMBERS && registrations.every(row =>
      row && Object.keys(row).length === 2 && validId(row.senderId) && typeof row.characterId==='string' && /^[a-z0-9-]{1,50}$/.test(row.characterId)) &&
    new Set(registrations.map(row => JSON.stringify([row.senderId, row.characterId]))).size === registrations.length &&
    Array.isArray(attempts) && attempts.length <= MAX_ATTEMPTS && attempts.every(stamp) &&
    ['activityAt', 'humanAt', 'decisionAt', 'lastAttemptAt'].every(key =>
      state[key] === null || stamp(state[key]));
}

// One connection owns this platform/account/persona/group. The in-memory run
// is shared by its member engines. Only timestamps and delivery routing IDs
// are persisted here. Neither member facts nor response text belongs here.
class GroupRhythm {
  constructor({file, scope, now}) {
    Object.assign(this, {file, scope, now});
    this.state = empty();
    this.run = null;
    this.selection = null;
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.size > MAX_BYTES) throw Error('Invalid group rhythm file.');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved?.schema !== 1 || saved.scope !== scope || !validState(saved.state)) {
        throw Error('Invalid group rhythm state.');
      }
      this.state = {...empty(), ...saved.state};
    } catch (error) {
      if (error.code !== 'ENOENT') this.failed = true;
    }
  }

  save(patch) {
    if (this.failed) throw Error('Group rhythm storage is unavailable.');
    const state = {...this.state, ...patch};
    try {
      const record = {schema: 1, scope: this.scope, state};
      if (!validState(state) || Buffer.byteLength(JSON.stringify(record, null, 2)) > MAX_BYTES) {
        throw Error('Group rhythm state exceeds its bounds.');
      }
      atomicJSON(this.file, record);
      this.state = state;
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  recordActivity({human = false} = {}) {
    const at = this.now();
    if (human && ['idle', 'source-notice'].includes(this.run?.kind)) this.run.controller.abort();
    this.save({
      activityAt: Math.max(this.state.activityAt ?? at, at),
      ...(human ? {humanAt: Math.max(this.state.humanAt ?? at, at)} : {}),
    });
  }

  budgetAvailable(limit) {
    const now = this.now();
    // Preserve future reservations if the clock rolls backwards. A local date
    // change must never reopen headroom by erasing an uncertain future send.
    const used = this.state.attempts.filter(at => at > now || sameDay(at, now)).length;
    return !this.failed && used < limit;
  }

  idleEligible(intervalMinutes, {decision = false} = {}) {
    const now = this.now();
    const {activityAt, humanAt, lastAttemptAt, decisionAt} = this.state;
    return activityAt !== null && humanAt !== null && now - activityAt >= QUIET_TIME &&
      (lastAttemptAt === null || humanAt > lastAttemptAt) &&
      (!decision || decisionAt === null || now - decisionAt >= intervalMinutes * MINUTE);
  }

  feedEligible(intervalMinutes, {decision = false} = {}) {
    const now = this.now();
    const {activityAt, lastAttemptAt, decisionAt} = this.state;
    return (activityAt === null || now - activityAt >= QUIET_TIME) &&
      (lastAttemptAt === null || now - lastAttemptAt >= intervalMinutes * MINUTE) &&
      (!decision || decisionAt === null || now - decisionAt >= intervalMinutes * MINUTE);
  }

  recordDecision() {
    this.save({decisionAt: this.now()});
  }

  reserveAttempt(limit) {
    if (!this.budgetAvailable(limit)) throw Error('Group proactive limit reached.');
    const at = this.now();
    const attempts = this.state.attempts.filter(value => value >= at - 2 * 86400000);
    this.save({
      attempts: [...attempts, at],
      activityAt: Math.max(this.state.activityAt ?? at, at),
      lastAttemptAt: Math.max(this.state.lastAttemptAt ?? at, at),
    });
  }
}

module.exports = {GroupRhythm, FOLLOWUP_GRACE, MAX_MEMBERS};
