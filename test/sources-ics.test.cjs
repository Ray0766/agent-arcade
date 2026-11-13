'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const {createIcsSource, parseCalendar, expandCalendar} = require('../src/sources/ics.cjs');

const FILE = path.join(os.tmpdir(), 'agent-arcade-sources-test.ics');
const cal = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join('\r\n');
const event = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const iso = list => list.map(x => new Date(x.at).toISOString());
function source(text, clock, extra = {}) {
  return createIcsSource({id:'cal', file:FILE, timeZone:'UTC', now:() => clock.now, readFile:async () => Buffer.from(typeof text === 'function' ? text() : text), ...extra});
}

test('folded lines are joined and text escapes are decoded', () => {
  const parsed = parseCalendar(cal(...event('UID:a1', 'SUMMARY:Team sync\\, weekly\\; room', '  B\\nagenda', 'DTSTART:20260310T100000Z',
    'BEGIN:VALARM', 'SUMMARY:nested alarm is ignored', 'END:VALARM')), {timeZone:'UTC'});
  assert.equal(parsed.components.length, 1);
  assert.equal(parsed.components[0].summary, 'Team sync, weekly; room B agenda');
  assert.equal(parsed.components[0].start.wall, Date.UTC(2026, 2, 10, 10));
});

test('TZID wall times convert correctly on both sides of a DST change', () => {
  const parsed = parseCalendar(cal(
    ...event('UID:before', 'SUMMARY:Before', 'DTSTART;TZID=America/New_York:20260307T090000'),
    ...event('UID:after', 'SUMMARY:After', 'DTSTART;TZID=America/New_York:20260308T090000'),
    ...event('UID:daily', 'SUMMARY:Daily', 'DTSTART;TZID=America/New_York:20260307T090000', 'RRULE:FREQ=DAILY;COUNT=3'),
    ...event('UID:floating', 'SUMMARY:Floating', 'DTSTART:20260308T090000'),
    ...event('UID:allday', 'SUMMARY:All day', 'DTSTART;VALUE=DATE:20260308')), {timeZone:'Asia/Shanghai'});
  const byUid = uid => iso(expandCalendar(parsed, Date.UTC(2026, 2, 7)).filter(x => x.uid === uid));
  assert.deepEqual(byUid('before'), ['2026-03-07T14:00:00.000Z']);
  assert.deepEqual(byUid('after'), ['2026-03-08T13:00:00.000Z']);
  assert.deepEqual(byUid('daily'), ['2026-03-07T14:00:00.000Z', '2026-03-08T13:00:00.000Z', '2026-03-09T13:00:00.000Z']);
  assert.deepEqual(byUid('floating'), ['2026-03-08T01:00:00.000Z']);
  assert.deepEqual(byUid('allday'), ['2026-03-07T16:00:00.000Z']);
});

test('weekly RRULE honors BYDAY, UNTIL, INTERVAL, EXDATE and the expansion window', () => {
  const parsed = parseCalendar(cal(
    ...event('UID:w', 'SUMMARY:W', 'DTSTART:20260302T090000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260311T090000Z;WKST=MO;BYSETPOS=1'),
    ...event('UID:x', 'SUMMARY:X', 'DTSTART:20260302T090000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=3', 'EXDATE:20260317T090000Z'),
    ...event('UID:old', 'SUMMARY:Old daily', 'DTSTART:19990101T080000Z', 'RRULE:FREQ=DAILY'),
    ...event('UID:m', 'SUMMARY:Monthly 31st', 'DTSTART:20260131T080000Z', 'RRULE:FREQ=MONTHLY'),
    ...event('UID:y', 'SUMMARY:Yearly', 'DTSTART:20200315T080000Z', 'RRULE:FREQ=YEARLY'),
    ...event('UID:c', 'SUMMARY:Cancelled', 'DTSTART:20260305T080000Z', 'STATUS:CANCELLED')), {timeZone:'UTC'});
  const all = expandCalendar(parsed, Date.UTC(2026, 2, 1)), byUid = uid => iso(all.filter(x => x.uid === uid));
  assert.deepEqual(byUid('w'), ['2026-03-02T09:00:00.000Z', '2026-03-04T09:00:00.000Z', '2026-03-09T09:00:00.000Z', '2026-03-11T09:00:00.000Z']);
  assert.deepEqual(byUid('x'), ['2026-03-03T09:00:00.000Z', '2026-03-31T09:00:00.000Z']);
  const old = byUid('old');
  assert.equal(old.length, 32); // 08:00 on each day of [now - 1 day, now + 31 days]
  assert.equal(old.at(-1), '2026-03-31T08:00:00.000Z');
  assert.equal(old[0], '2026-02-28T08:00:00.000Z');
  assert.deepEqual(byUid('m'), ['2026-03-31T08:00:00.000Z']);
  assert.deepEqual(byUid('y'), ['2026-03-15T08:00:00.000Z']);
  assert.deepEqual(byUid('c'), []);
});

test('an occurrence is emitted exactly once across polls and restarts', async () => {
  const start = Date.UTC(2026, 2, 10, 10), clock = {now:start - 20 * 60000};
  const text = cal(...event('UID:a1', 'SUMMARY:Review <b>plan</b>', 'DTSTART:20260310T100000Z', 'DTEND:20260310T103000Z'));
  const src = source(text, clock);
  assert.equal(src.intervalMs, 60000);
  let result = await src.poll(null);
  assert.deepEqual(result.events, []);
  clock.now = start - 10 * 60000;
  result = await src.poll(result.cursor);
  assert.equal(result.events.length, 1);
  const [emitted] = result.events;
  assert.equal(emitted.kind, 'calendar.upcoming');
  assert.equal(emitted.title, 'Review <b>plan</b>');
  assert.deepEqual(emitted.data, {start, end:start + 30 * 60000, allDay:false});
  clock.now += 60000;
  assert.deepEqual((await src.poll(result.cursor)).events, []);
  assert.deepEqual((await source(text, clock).poll(JSON.parse(JSON.stringify(result.cursor)))).events, []);
  // A fresh cursor after the start has passed by more than five minutes stays quiet.
  clock.now = start + 6 * 60000;
  assert.deepEqual((await source(text, clock).poll(null)).events, []);
  clock.now = start + 4 * 60000;
  assert.equal((await source(text, clock).poll(null)).events.length, 1);
});

test('a recurring series reminds once per occurrence and the cursor stays bounded', async () => {
  const clock = {now:Date.UTC(2026, 2, 2, 8, 50)};
  const src = source(cal(...event('UID:d', 'SUMMARY:Daily', 'DTSTART:20260302T090000Z', 'RRULE:FREQ=DAILY')), clock);
  let cursor = {seen:Array.from({length:500}, (_, i) => `old${i}`)}, ids = new Set();
  for (let day = 0; day < 3; day++) {
    clock.now = Date.UTC(2026, 2, 2 + day, 8, 50);
    for (let i = 0; i < 2; i++) { const result = await src.poll(cursor); cursor = result.cursor; for (const e of result.events) ids.add(e.id); }
  }
  assert.equal(ids.size, 3);
  assert.equal(cursor.seen.length, 500);
  assert.ok(!cursor.seen.includes('old0') && cursor.seen.includes('old499'));
});

test('a due VTODO reminds once; completed and cancelled ones are ignored', async () => {
  const clock = {now:Date.UTC(2026, 2, 10, 9, 50)};
  const todo = (uid, ...lines) => ['BEGIN:VTODO', `UID:${uid}`, `SUMMARY:${uid}`, 'DUE:20260310T100000Z', ...lines, 'END:VTODO'];
  const src = source(cal(...todo('open', 'STATUS:NEEDS-ACTION'), ...todo('done', 'STATUS:COMPLETED'), ...todo('dropped', 'STATUS:CANCELLED'),
    'BEGIN:VTODO', 'UID:nodue', 'SUMMARY:nodue', 'END:VTODO'), clock);
  const result = await src.poll(null);
  assert.deepEqual(result.events.map(e => [e.kind, e.title]), [['calendar.due', 'open']]);
  assert.deepEqual((await src.poll(result.cursor)).events, []);
});

test('oversized, non-calendar and over-populated input is rejected', async () => {
  const clock = {now:0};
  await assert.rejects(source(() => 'a'.repeat(2 * 1024 * 1024 + 1), clock).poll(null), {code:'too_large'});
  await assert.rejects(source('<html>not a calendar</html>', clock).poll(null), {code:'invalid_calendar'});
  const many = cal(...Array.from({length:5001}, (_, i) => event(`UID:${i}`, 'DTSTART:20260310T100000Z')).flat());
  assert.throws(() => parseCalendar(many, {timeZone:'UTC'}), {code:'too_many_components'});
});

test('a calendar URL is https only, fetched at most every 15 minutes and never follows redirects', async () => {
  const clock = {now:Date.UTC(2026, 2, 10, 9, 50)}; let calls = 0, status = 200;
  const text = cal(...event('UID:a1', 'SUMMARY:Remote', 'DTSTART:20260310T100000Z'));
  const fetchImpl = async (url, options) => {
    calls++; assert.equal(options.redirect, 'manual');
    return status === 200 ? new Response(text, {headers:{'content-type':'text/calendar'}}) : new Response(null, {status, headers:{location:'https://elsewhere.example/'}});
  };
  const src = createIcsSource({id:'remote', url:'https://calendar.example/a.ics?token=secret', timeZone:'UTC', now:() => clock.now, fetchImpl});
  assert.equal(src.target, 'https://calendar.example/a.ics');
  const first = await src.poll(null);
  assert.equal(first.events.length, 1);
  clock.now += 60000; await src.poll(first.cursor);
  assert.equal(calls, 1);
  clock.now += 15 * 60000; await src.poll(first.cursor);
  assert.equal(calls, 2);
  clock.now += 15 * 60000; status = 302;
  await assert.rejects(src.poll(first.cursor), {code:'redirected'});
  for (const options of [{url:'http://calendar.example/a.ics'}, {url:'https://u:p@calendar.example/a.ics'}, {file:'relative.ics'},
    {file:FILE, url:'https://calendar.example/a.ics'}, {}, {file:FILE, leadMinutes:0}, {file:FILE, timeZone:'Mars/Olympus'}]) {
    assert.throws(() => createIcsSource({id:'x', ...options}), {code:'invalid_input'}, JSON.stringify(options));
  }
});
