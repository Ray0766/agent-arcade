'use strict';
// Minimal RFC 5545 reader for reminders: VEVENT starts and VTODO due times from
// one local .ics file or one https calendar URL. Calendar text is data only.
const fs = require('node:fs');
const path = require('node:path');
const {makeEvent, isSourceId, cleanText, digest} = require('./event.cjs');
const {fetchBounded, httpsUrl, displayUrl} = require('./feed.cjs');
const {absolutePath} = require('./folder.cjs');

const MINUTE = 60000, DAY = 86400000;
const MAX_BYTES = 2 * 1024 * 1024, MAX_COMPONENTS = 5000, MAX_INSTANCES = 500, MAX_STEPS = 20000, MAX_SEEN = 500, MAX_EVENTS = 50;
const WINDOW_BACK = DAY, WINDOW_AHEAD = 31 * DAY, GRACE = 5 * MINUTE, FETCH_INTERVAL = 15 * MINUTE, EXPANSION_TTL = 60 * MINUTE;
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const fail = (code, message) => Object.assign(new Error(message || code), {code});
const formatters = new Map();

function formatter(zone) {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {timeZone:zone, hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit'});
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value);
    formatters.set(zone, format);
  }
  return format;
}
function validZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return null;
  try { return formatter(zone).resolvedOptions().timeZone; } catch { return null; }
}
// "Wall" values are local calendar fields packed with Date.UTC, so date
// arithmetic stays in whole local days across DST changes.
function offsetAt(zone, at) {
  const p = {};
  for (const part of formatter(zone).formatToParts(at)) p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}
function wallToEpoch(wall, zone) {
  if (zone === 'UTC') return wall;
  let at = wall - offsetAt(zone, wall);
  const second = offsetAt(zone, at);
  if (wall - second !== at) at = wall - second;
  return at;
}

function unescapeText(value) {
  return value.replace(/\\([\\;,nN])/g, (match, c) => (c === 'n' || c === 'N' ? '\n' : c));
}
function parseLine(line) {
  let quoted = false, colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) { colon = i; break; }
  }
  if (colon < 1) return null;
  const head = line.slice(0, colon).split(';'), params = {};
  for (const part of head.slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return {name:head[0].toUpperCase(), params, value:line.slice(colon + 1)};
}
function parseDate(value, params, defaultZone) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(value).trim());
  if (!m) return null;
  const allDay = m[4] === undefined;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], allDay ? 0 : +m[4], allDay ? 0 : +m[5], allDay ? 0 : +m[6]);
  if (!Number.isFinite(wall)) return null;
  // An unknown TZID (for example a Windows zone name) falls back to the source's zone.
  const zone = m[7] ? 'UTC' : (!allDay && params?.TZID && validZone(params.TZID)) || defaultZone;
  return {wall, zone, allDay, floating:!m[7]};
}
function parseRule(value, defaultZone) {
  const parts = {};
  for (const item of String(value).split(';')) { const eq = item.indexOf('='); if (eq > 0) parts[item.slice(0, eq).toUpperCase()] = item.slice(eq + 1); }
  const freq = String(parts.FREQ || '').toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const int = (text, max) => (/^\d{1,6}$/.test(text || '') && +text >= 1 ? Math.min(+text, max) : null);
  const rule = {freq, interval:int(parts.INTERVAL, 1000) || 1, count:int(parts.COUNT, 100000), until:null, days:null};
  if (parts.UNTIL) rule.until = parseDate(parts.UNTIL, null, defaultZone);
  if (freq === 'WEEKLY' && parts.BYDAY) {
    const days = [...new Set(parts.BYDAY.split(',').map(x => WEEKDAYS.indexOf(x.trim().toUpperCase().replace(/^[+-]?\d+/, ''))).filter(x => x >= 0))];
    if (days.length) rule.days = days.sort((a, b) => a - b);
  }
  return rule;
}

function parseCalendar(input, {timeZone} = {}) {
  const text = Buffer.isBuffer(input) || input instanceof Uint8Array ? null : input;
  if (text !== null && typeof text !== 'string') throw fail('invalid_calendar', 'The calendar is not text.');
  if ((text === null ? input.byteLength : Buffer.byteLength(text)) > MAX_BYTES) throw fail('too_large', 'The calendar is larger than 2 MiB.');
  const defaultZone = timeZone === undefined ? new Intl.DateTimeFormat().resolvedOptions().timeZone : validZone(timeZone);
  if (!defaultZone) throw fail('invalid_input', 'Invalid time zone.');
  const source = (text === null ? new TextDecoder('utf-8').decode(input) : text).replace(/^\ufeff/, '');
  if (!/^BEGIN:VCALENDAR\s*$/im.test(source)) throw fail('invalid_calendar', 'The file is not an iCalendar document.');
  const components = [];
  let current = null, depth = 0;
  for (const line of source.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (!line) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      const type = prop.value.trim().toUpperCase();
      if (current) depth++;
      else if (type === 'VEVENT' || type === 'VTODO') {
        if (components.length >= MAX_COMPONENTS) throw fail('too_many_components', `The calendar has more than ${MAX_COMPONENTS} entries.`);
        current = {type, uid:'', summary:'', status:'', start:null, end:null, due:null, rule:null, recurrenceId:null, exdates:[]}; depth = 0;
      }
      continue;
    }
    if (prop.name === 'END') {
      if (current && depth > 0) depth--;
      else if (current && prop.value.trim().toUpperCase() === current.type) { components.push(current); current = null; }
      continue;
    }
    if (!current || depth > 0) continue;
    switch (prop.name) {
      case 'UID': current.uid = cleanText(prop.value, 300); break;
      case 'SUMMARY': current.summary = cleanText(unescapeText(prop.value), 200); break;
      case 'STATUS': current.status = prop.value.trim().toUpperCase().slice(0, 20); break;
      case 'DTSTART': current.start = parseDate(prop.value, prop.params, defaultZone); break;
      case 'DTEND': current.end = parseDate(prop.value, prop.params, defaultZone); break;
      case 'DUE': current.due = parseDate(prop.value, prop.params, defaultZone); break;
      case 'RECURRENCE-ID': current.recurrenceId = parseDate(prop.value, prop.params, defaultZone); break;
      case 'RRULE': current.rule = parseRule(prop.value, defaultZone); break;
      case 'EXDATE':
        for (const item of prop.value.split(',').slice(0, 500)) {
          const date = current.exdates.length < 500 && parseDate(item, prop.params, defaultZone);
          if (date) current.exdates.push(date);
        }
        break;
      default:
    }
  }
  return {components, timeZone:defaultZone};
}

function* candidates(rule, wall0, from) {
  const first = new Date(wall0), interval = rule.interval, skip = rule.count ? 0 : Math.max(0, from - 2 * DAY - wall0);
  if (rule.freq === 'DAILY') {
    for (let k = Math.floor(skip / (interval * DAY)); ; k++) yield wall0 + k * interval * DAY;
  } else if (rule.freq === 'WEEKLY') {
    const day0 = Math.floor(wall0 / DAY), timeOfDay = wall0 - day0 * DAY, weekday = (first.getUTCDay() + 6) % 7;
    const monday = day0 - weekday, days = rule.days || [weekday];
    for (let w = Math.max(0, Math.floor(skip / (7 * DAY * interval)) - 1) * interval; ; w += interval) {
      for (const offset of days) { const at = (monday + w * 7 + offset) * DAY + timeOfDay; yield at >= wall0 ? at : null; }
    }
  } else {
    const y = first.getUTCFullYear(), m = first.getUTCMonth(), d = first.getUTCDate();
    const rest = [first.getUTCHours(), first.getUTCMinutes(), first.getUTCSeconds()];
    for (let k = 0; ; k += interval) {
      const at = rule.freq === 'MONTHLY' ? Date.UTC(y, m + k, d, ...rest) : Date.UTC(y + k, m, d, ...rest);
      yield new Date(at).getUTCDate() === d ? at : null; // skip months without that day
    }
  }
}
// Real start instants of one component inside [from, to].
function instances(base, rule, excluded, from, to) {
  const out = [];
  const keep = at => { if (at >= from && at <= to && !excluded.has(at)) out.push(at); };
  if (!rule) { keep(wallToEpoch(base.wall, base.zone)); return out; }
  const until = rule.until;
  const untilWall = until && (until.allDay || (until.floating && until.zone !== 'UTC')) ? until.wall + (until.allDay ? DAY - 1 : 0) : null;
  const untilReal = until && untilWall === null ? wallToEpoch(until.wall, until.zone) : null;
  let steps = 0, count = 0;
  for (const wall of candidates(rule, base.wall, from)) {
    if (++steps > MAX_STEPS) break;
    if (wall === null) continue;
    if (rule.count && count >= rule.count) break;
    count++;
    if ((untilWall !== null && wall > untilWall) || wall > to + 2 * DAY) break;
    if (wall < from - 2 * DAY) continue;
    const at = wallToEpoch(wall, base.zone);
    if (untilReal !== null && at > untilReal) break;
    keep(at);
    if (out.length >= MAX_INSTANCES) break;
  }
  return out;
}
function expandCalendar(calendar, now) {
  const from = now - WINDOW_BACK, to = now + WINDOW_AHEAD, overrides = new Map(), out = [];
  for (const c of calendar.components) {
    if (!c.recurrenceId || !c.uid) continue;
    if (!overrides.has(c.uid)) overrides.set(c.uid, new Set());
    overrides.get(c.uid).add(wallToEpoch(c.recurrenceId.wall, c.recurrenceId.zone));
  }
  for (const c of calendar.components) {
    const todo = c.type === 'VTODO', base = todo ? c.due : c.start;
    if (!base || c.status === 'CANCELLED' || (todo && c.status === 'COMPLETED')) continue;
    const excluded = new Set(c.exdates.map(x => wallToEpoch(x.wall, x.zone)));
    if (!c.recurrenceId && c.uid) for (const at of overrides.get(c.uid) || []) excluded.add(at);
    const duration = !todo && c.end ? Math.max(0, wallToEpoch(c.end.wall, c.end.zone) - wallToEpoch(base.wall, base.zone)) : 0;
    const uid = c.uid || digest(`${c.type}|${c.summary}|${base.wall}`, 24);
    for (const at of instances(base, c.recurrenceId ? null : c.rule, excluded, from, to)) {
      out.push({key:digest(`${c.type}|${uid}|${at}`, 20), uid, todo, title:c.summary, at, end:duration ? at + duration : null, allDay:base.allDay});
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function createIcsSource({id, file, url, leadMinutes = 15, timeZone, fetchImpl = globalThis.fetch, readFile = fs.promises.readFile, now = Date.now, timeoutMs = 20000} = {}) {
  if (!isSourceId(id)) throw fail('invalid_input', 'The source id must be 1-64 characters of A-Z, a-z, 0-9, _ or -.');
  if ((file === undefined) === (url === undefined)) throw fail('invalid_input', 'A calendar needs exactly one of a local file or an https URL.');
  const local = file !== undefined ? absolutePath(file, 'calendar file') : null, remote = url !== undefined ? httpsUrl(url) : null;
  if (!Number.isInteger(leadMinutes) || leadMinutes < 1 || leadMinutes > 1440) throw fail('invalid_input', 'The reminder lead time must be between 1 and 1440 minutes.');
  if (timeZone !== undefined && !validZone(timeZone)) throw fail('invalid_input', 'Invalid time zone.');
  if (typeof fetchImpl !== 'function' || typeof readFile !== 'function' || typeof now !== 'function') throw fail('invalid_input', 'Invalid calendar source options.');
  let calendar = null, contentKey = null, fetchedAt = null, expanded = null, expandedAt = null;
  async function refresh(signal) {
    const at = now();
    if (remote && calendar && fetchedAt !== null && at - fetchedAt < FETCH_INTERVAL && at >= fetchedAt) return;
    let bytes;
    if (remote) bytes = (await fetchBounded(remote.href, {fetchImpl, timeoutMs, signal, maxBytes:MAX_BYTES, accept:'text/calendar, text/plain;q=0.5'})).bytes;
    else {
      // Refuse an oversized real file before reading it into memory.
      if (readFile === fs.promises.readFile && (await fs.promises.stat(local)).size > MAX_BYTES) throw fail('too_large', 'The calendar is larger than 2 MiB.');
      const content = await readFile(local, {signal});
      bytes = typeof content === 'string' ? Buffer.from(content) : content;
      if (!(bytes instanceof Uint8Array)) throw fail('invalid_calendar', 'The calendar is not text.');
    }
    if (bytes.byteLength > MAX_BYTES) throw fail('too_large', 'The calendar is larger than 2 MiB.');
    const key = digest(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1'));
    if (key !== contentKey) { calendar = parseCalendar(bytes, {timeZone}); contentKey = key; expanded = null; }
    fetchedAt = at;
  }
  async function poll(cursor, signal) {
    if (signal?.aborted) throw fail('aborted');
    await refresh(signal);
    const at = now();
    if (!expanded || at < expandedAt || at - expandedAt >= EXPANSION_TTL) { expanded = expandCalendar(calendar, at); expandedAt = at; }
    const seen = cursor && typeof cursor === 'object' && Array.isArray(cursor.seen) ? cursor.seen.filter(x => typeof x === 'string').slice(-MAX_SEEN) : [];
    const known = new Set(seen), events = [];
    for (const item of expanded) {
      if (item.at - at > leadMinutes * MINUTE) break;
      if (at - item.at > GRACE || known.has(item.key) || events.length >= MAX_EVENTS) continue;
      known.add(item.key); seen.push(item.key);
      events.push(makeEvent({source:id, kind:item.todo ? 'calendar.due' : 'calendar.upcoming', subject:item.uid, key:String(item.at),
        title:item.title || '(untitled)', detail:new Date(item.at).toISOString(), at,
        data:{start:item.at, ...(item.end ? {end:item.end} : {}), allDay:item.allDay}}));
    }
    return {cursor:{seen:seen.slice(-MAX_SEEN)}, events};
  }
  return Object.freeze({id, kind:'ics', intervalMs:MINUTE, fetchIntervalMs:remote ? FETCH_INTERVAL : MINUTE,
    target:remote ? displayUrl(remote) : path.basename(local), poll});
}

module.exports = {createIcsSource, parseCalendar, expandCalendar, LIMITS:Object.freeze({MAX_BYTES, MAX_COMPONENTS, MAX_INSTANCES, MAX_SEEN})};
