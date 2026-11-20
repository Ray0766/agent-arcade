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

test('only explicit, singular PUBLIC on a direct VEVENT supplies safe group calendar fields', async () => {
  const start = Date.UTC(2026, 10, 19, 21), clock = {now:start - 10 * 60000};
  const startLine = 'DTSTART:20261119T210000Z';
  const variants = [
    ['public', 'CLASS:PUBLIC'], ['private', 'CLASS:PRIVATE'], ['confidential', 'CLASS:CONFIDENTIAL'],
    ['unspecified'], ['unknown', 'CLASS:X-UNKNOWN'], ['duplicate', 'CLASS:PUBLIC', 'CLASS:PUBLIC'],
    ['contradictory', 'CLASS:PRIVATE', 'CLASS:PUBLIC'],
    ['cancelled', 'CLASS:PUBLIC', 'STATUS:CANCELLED'],
    ['contradictory-status', 'CLASS:PUBLIC', 'STATUS:CANCELLED', 'STATUS:CONFIRMED'],
    ['ambiguous-time', 'CLASS:PUBLIC', 'DTSTART:20261119T210200Z'],
    ['malformed-override', 'CLASS:PUBLIC', 'RECURRENCE-ID:invalid'],
    ['alarm-public', 'BEGIN:VALARM', 'CLASS:PUBLIC', 'END:VALARM'],
  ];
  const src = source(cal(...variants.flatMap(([uid, ...lines]) => event(`UID:${uid}`, `SUMMARY:${uid}`, startLine,
    'DESCRIPTION:private body', 'LOCATION:private location', 'URL:https://calendar.example/secret', ...lines)),
  'BEGIN:VTODO', 'UID:todo', 'SUMMARY:todo', 'DUE:20261119T210000Z', 'CLASS:PUBLIC', 'END:VTODO',
  'BEGIN:X-ADAPTER', ...event('UID:nested', 'SUMMARY:nested', startLine, 'CLASS:PUBLIC'), 'END:X-ADAPTER'), clock);
  const first = await src.poll(null);
  assert.deepEqual(first.events.map(item => item.title), [...variants.filter(([name]) => !['cancelled', 'ambiguous-time'].includes(name)).map(([name]) => name),
    'todo', 'nested', 'ambiguous-time']);
  const [publicReminder] = first.events;
  const current = [{id:publicReminder.id, title:'public', start, localTime:'2026-11-19T21:00:00', timeZone:'UTC', allDay:false}];
  const ownerCalendarIds = first.events.filter(item => item.kind === 'calendar.upcoming').map(item => item.id);
  assert.deepEqual(first.groupCalendar, {current, newIds:[publicReminder.id]});
  assert.deepEqual(await src.poll(first.cursor), {cursor:first.cursor, events:[], ownerCalendarIds, groupCalendar:{current, newIds:[]}});
  clock.now = start + 5 * 60000;
  assert.deepEqual((await src.poll(first.cursor)).groupCalendar, {current, newIds:[]});
  clock.now++;
  assert.deepEqual((await src.poll(first.cursor)).groupCalendar, {current:[], newIds:[]});
});

test('PUBLIC duplicate starts, duplicate recurrence overrides and incomplete calendars cannot become group candidates', async () => {
  const clock = {now:Date.UTC(2026, 10, 20, 20, 50)};
  const start = 'DTSTART:20261120T210000Z';
  const original = 'RECURRENCE-ID:20261120T210000Z';
  const sufficientlyLong = 'a'.repeat(202);
  const input = cal(
    ...event('UID:duplicate', 'SUMMARY:First', start, 'CLASS:PUBLIC'),
    ...event('UID:duplicate', 'SUMMARY:Second', start, 'CLASS:PUBLIC', 'STATUS:CANCELLED'),
    ...event('UID:series', 'SUMMARY:Series', 'DTSTART:20261119T210000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'CLASS:PUBLIC'),
    ...event('UID:series', 'SUMMARY:Moved', 'DTSTART:20261120T210200Z', original, 'CLASS:PUBLIC'),
    ...event('UID:series', 'SUMMARY:Private moved', 'DTSTART:20261120T210500Z', original, 'CLASS:PRIVATE'),
    ...event(`UID:${sufficientlyLong}1`, 'SUMMARY:Ambiguous public reminder ID', start, 'CLASS:PUBLIC'),
    ...event(`UID:${sufficientlyLong}2`, 'SUMMARY:Ambiguous private reminder ID', start, 'CLASS:PRIVATE'),
    ...event('UID:single', 'SUMMARY:Single', start, 'CLASS:PUBLIC'));
  const first = await source(input, clock).poll(null);
  assert.equal(first.events.length, 6);
  assert.equal(first.events[1].id, first.events[2].id);
  assert.deepEqual(first.groupCalendar.current.map(row => row.title), ['Single']);
  assert.deepEqual(first.groupCalendar.newIds, [first.events.find(row => row.title === 'Single').id]);

  const incomplete = await source(input.replace('END:VCALENDAR', ''), clock).poll(null);
  assert.deepEqual(incomplete.events, first.events);
  assert.deepEqual(incomplete.groupCalendar, {current:[], newIds:[]});
});

test('group calendar keeps the interpreted local wall time on recurrence and date-only events', async () => {
  const clock = {now:Date.UTC(2026, 2, 7, 15, 50)};
  const input = cal(
    ...event('UID:daily', 'SUMMARY:New York', 'DTSTART;TZID=America/New_York:20260307T090000', 'RRULE:FREQ=DAILY;COUNT=3', 'CLASS:PUBLIC'),
    ...event('UID:allday', 'SUMMARY:Shanghai', 'DTSTART;VALUE=DATE:20260308', 'CLASS:PUBLIC'));
  const src = source(input, clock, {timeZone:'Asia/Shanghai'});
  let result = await src.poll(null);
  assert.deepEqual(result.groupCalendar.current, [{id:result.events[0].id, title:'Shanghai', start:Date.UTC(2026, 2, 7, 16),
    localTime:'2026-03-08', timeZone:'Asia/Shanghai', allDay:true}]);
  clock.now = Date.UTC(2026, 2, 8, 12, 50);
  result = await src.poll(result.cursor);
  assert.deepEqual(result.groupCalendar.current, [{id:result.events[0].id, title:'New York', start:Date.UTC(2026, 2, 8, 13),
    localTime:'2026-03-08T09:00:00', timeZone:'America/New_York', allDay:false}]);
  assert.deepEqual(result.groupCalendar.newIds, [result.events[0].id]);
});

test('monthly ordinal weekdays recur on the selected weekday in owner and group results', async () => {
  for (const {ordinal, days, oldDays} of [
    {ordinal:'1TU', days:['2026-12-01', '2027-01-05', '2027-02-02'], oldDays:['2027-01-01', '2027-02-01']},
    {ordinal:'-1TU', days:['2026-12-29', '2027-01-26', '2027-02-23'], oldDays:['2027-01-29', '2027-02-28']},
  ]) {
    const clock = {now:0};
    const src = source(cal(...event('UID:monthly', 'SUMMARY:Monthly club', 'CLASS:PUBLIC',
      `DTSTART:${days[0].replace(/-/g, '')}T100000Z`, `RRULE:FREQ=MONTHLY;COUNT=3;BYDAY=${ordinal}`)), clock);
    let cursor = null;
    for (const day of [...days, ...oldDays].sort()) {
      clock.now = Date.parse(`${day}T09:50:00Z`);
      const result = await src.poll(cursor);
      cursor = result.cursor;
      if (days.includes(day)) {
        assert.equal(result.events.length, 1);
        assert.equal(result.groupCalendar.current[0].localTime, `${day}T10:00:00`);
        assert.deepEqual(result.groupCalendar.newIds, [result.events[0].id]);
      } else {
        assert.deepEqual(result.events, []);
        assert.deepEqual(result.groupCalendar, {current:[], newIds:[]});
      }
    }
  }
});

test('an unsupported monthly selector combination does not expose fallback group dates or suppress an exact exception', async () => {
  const clock = {now:Date.UTC(2027, 0, 1, 9, 50)};
  const input = cal(
    ...event('UID:monthly', 'SUMMARY:Unsupported monthly', 'DTSTART:20261201T100000Z', 'CLASS:PUBLIC',
      'RRULE:FREQ=MONTHLY;COUNT=3;BYDAY=1TU;BYMONTHDAY=1,2,3,4,5,6,7'),
    ...event('UID:monthly', 'SUMMARY:Exact public exception', 'CLASS:PUBLIC', 'RECURRENCE-ID:20270201T100000Z',
      'DTSTART:20270202T100000Z'));
  const src = source(input, clock);
  const first = await src.poll(null);
  assert.equal(first.events[0].title, 'Unsupported monthly');
  assert.deepEqual(first.groupCalendar, {current:[], newIds:[]});
  clock.now = Date.UTC(2027, 1, 2, 9, 50);
  const explicit = await src.poll(first.cursor);
  assert.equal(explicit.groupCalendar.current[0].title, 'Exact public exception');
  assert.deepEqual(explicit.groupCalendar.newIds, [explicit.events[0].id]);
});

test('THISANDFUTURE updates owner and group timing with independent visibility and exact exceptions', async () => {
  for (const edit of ['cancelled', 'private', 'shifted']) {
    const clock = {now:0};
    const shifted = edit === 'shifted';
    const calendar = range => cal(
      ...event('UID:club', 'SUMMARY:Reading club', 'CLASS:PUBLIC', 'DTSTART:20261201T100000Z', 'RRULE:FREQ=WEEKLY;COUNT=4'),
      ...event('UID:club', 'SUMMARY:Edited', `CLASS:${edit === 'private' ? 'PRIVATE' : 'PUBLIC'}`,
        `STATUS:${edit === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, `RECURRENCE-ID${range ? ';RANGE=THISANDFUTURE' : ''}:20261208T100000Z`,
        `DTSTART:20261208T${shifted ? '110000' : '100000'}Z`),
      ...event('UID:club', 'SUMMARY:Exact exception', 'CLASS:PUBLIC', 'RECURRENCE-ID:20261215T100000Z', 'DTSTART:20261215T110000Z'),
      ...event('UID:unrelated', 'SUMMARY:Other club', 'CLASS:PUBLIC', 'DTSTART:20261222T100000Z'));
    const withRange = source(calendar(true), clock), oneOccurrence = source(calendar(false), clock);
    let cursor, groupAnnouncements = [], ownerReminders = [];
    for (const [day, hour] of [[1, 10], [8, 10], [8, 11], [15, 11], [22, 10], [22, 11]]) {
      clock.now = Date.UTC(2026, 11, day, hour) - 10 * 60000;
      const next = await withRange.poll(cursor);
      cursor = next.cursor;
      ownerReminders.push(...next.events.map(item => [day, hour, item.title]));
      assert(next.events.every(item => next.ownerCalendarIds.includes(item.id)));
      for (const occurrence of next.groupCalendar.current) {
        if (next.groupCalendar.newIds.includes(occurrence.id)) groupAnnouncements.push([day, hour, occurrence.title]);
      }
      if (day === 22 && hour === 11 && shifted) {
        assert.equal(next.events.length, 1);
        const [occurrence] = next.groupCalendar.current;
        assert.equal(next.events[0].id, occurrence.id);
        assert.deepEqual(cursor.groupShiftSeen, [occurrence.id]);
        const restarted = await source(calendar(true), clock).poll(JSON.parse(JSON.stringify(cursor)));
        assert.deepEqual(restarted.events, []);
        assert.deepEqual(restarted.groupCalendar, {current:[occurrence], newIds:[]});
        assert.deepEqual(restarted.ownerCalendarIds, [occurrence.id]);
      }
    }
    assert.deepEqual(groupAnnouncements, [[1, 10, 'Reading club'], ...(shifted ? [[8, 11, 'Edited']] : []),
      [15, 11, 'Exact exception'], [22, 10, 'Other club'], ...(shifted ? [[22, 11, 'Reading club']] : [])]);
    assert.deepEqual(ownerReminders, [[1, 10, 'Reading club'], ...(edit === 'cancelled' ? [] : [[8, shifted ? 11 : 10, 'Edited']]),
      [15, 11, 'Exact exception'], ...(edit === 'private' ? [[22, 10, 'Reading club']] : []),
      [22, 10, 'Other club'], ...(shifted ? [[22, 11, 'Reading club']] : [])]);
    clock.now = Date.UTC(2026, 11, 22, 9, 50);
    const isolated = await oneOccurrence.poll(null);
    assert(isolated.events.some(item => item.title === 'Reading club' && item.detail === '2026-12-22T10:00:00.000Z'));
  }
});

test('shifted owner reminders adopt original occurrence keys across old cursors and retire stale queued IDs', async () => {
  const day = hour => Date.UTC(2026, 11, 15, hour);
  const clock = {now:day(10) - 10 * 60000};
  const publicSeries = event('UID:club', 'SUMMARY:Reading club', 'CLASS:PUBLIC', 'DTSTART:20261201T100000Z', 'RRULE:FREQ=WEEKLY;COUNT=3');
  const shifted = cal(...publicSeries, ...event('UID:club', 'SUMMARY:Edited', 'CLASS:PUBLIC',
    'RECURRENCE-ID;RANGE=THISANDFUTURE:20261208T100000Z', 'DTSTART:20261208T110000Z'));
  let input = cal(...publicSeries);
  const src = source(() => input, clock);
  const old = await src.poll(null);
  const [oldId] = old.ownerCalendarIds;
  const [originalKey] = old.cursor.seen;
  input = shifted;
  assert.deepEqual((await src.poll(old.cursor)).ownerCalendarIds, []);

  clock.now = day(11) - 10 * 60000;
  const previouslySent = await source(cal(...event('UID:club', 'SUMMARY:Reading club', 'CLASS:PUBLIC',
    'DTSTART:20261215T110000Z')), clock).poll(null);
  const [shiftedId] = previouslySent.ownerCalendarIds;
  for (const oldCursor of [old.cursor, previouslySent.cursor, {seen:[], groupShiftSeen:[shiftedId]}]) {
    const migrated = await source(shifted, clock).poll(JSON.parse(JSON.stringify(oldCursor)));
    assert.deepEqual(migrated.events, []);
    assert(migrated.cursor.seen.includes(originalKey));
    assert.deepEqual(migrated.ownerCalendarIds, [shiftedId]);
    assert(!migrated.ownerCalendarIds.includes(oldId));
  }
  const freshSource = source(shifted, clock);
  const fresh = await freshSource.poll(null);
  assert.deepEqual(fresh.cursor.seen, [originalKey]);
  assert.equal(fresh.events[0].detail, '2026-12-15T11:00:00.000Z');
  assert.deepEqual(fresh.groupCalendar.newIds, [shiftedId]);
  clock.now = day(11) + 35 * 60000;
  assert.deepEqual((await freshSource.poll(fresh.cursor)).ownerCalendarIds, [shiftedId]);
  clock.now++;
  assert.deepEqual((await freshSource.poll(fresh.cursor)).ownerCalendarIds, []);
  clock.now = day(10) - 10 * 60000;
  assert.deepEqual((await freshSource.poll(fresh.cursor)).ownerCalendarIds, []);
});

test('a public range shift keeps local wall time across DST and an ambiguous range fails closed', async () => {
  const clock = {now:Date.UTC(2026, 2, 8, 14, 50)};
  const recurrence = 'RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=America/New_York:20260301T090000';
  const calendar = (extra = []) => cal(
    ...event('UID:club', 'SUMMARY:Reading club', 'CLASS:PUBLIC', 'DTSTART;TZID=America/New_York:20260301T090000', 'RRULE:FREQ=WEEKLY;COUNT=2'),
    ...event('UID:club', 'SUMMARY:Public move', 'CLASS:PUBLIC', recurrence, 'DTSTART;TZID=America/New_York:20260301T110000'),
    ...extra);
  const shifted = await source(calendar(), clock).poll(null);
  const [occurrence] = shifted.groupCalendar.current;
  assert.equal(occurrence.start, Date.UTC(2026, 2, 8, 15));
  assert.equal(occurrence.localTime, '2026-03-08T11:00:00');
  assert.equal(occurrence.timeZone, 'America/New_York');
  assert.deepEqual(shifted.groupCalendar.newIds, [occurrence.id]);

  clock.now = Date.UTC(2026, 2, 8, 12, 50);
  const conflicting = await source(calendar(event('UID:club', 'SUMMARY:Conflicting move', 'CLASS:PRIVATE', recurrence,
    'DTSTART;TZID=America/New_York:20260301T100000')), clock).poll(null);
  assert.equal(conflicting.events[0].title, 'Reading club');
  assert.deepEqual(conflicting.groupCalendar, {current:[], newIds:[]});
});

test('edits, removal and cancellation change current group eligibility without replaying owner reminders', async () => {
  const start = Date.UTC(2026, 10, 19, 23);
  for (const transport of ['local', 'https']) {
    for (const edit of ['removed', 'renamed', 'private', 'cancelled']) {
      const clock = {now:start - 45 * 60000};
      const asCalendar = ({name = 'First title', classification = 'PUBLIC', status = 'CONFIRMED'} = {}) =>
        cal(...event('UID:edit', `SUMMARY:${name}`, 'DTSTART:20261119T230000Z', `CLASS:${classification}`, `STATUS:${status}`));
      let text = asCalendar(), fetches = 0;
      const src = transport === 'local' ? source(() => text, clock, {leadMinutes:60}) : createIcsSource({
        id:'cal', url:'https://calendar.example/calendar.ics', timeZone:'UTC', now:() => clock.now, leadMinutes:60,
        fetchImpl:async () => { fetches++; return new Response(text, {headers:{'content-type':'text/calendar'}}); },
      });
      const initial = await src.poll(null);
      const [original] = initial.groupCalendar.current;
      assert.equal(original.id, initial.events[0].id);
      text = {removed:cal(), renamed:asCalendar({name:'Edited title'}), private:asCalendar({classification:'PRIVATE'}),
        cancelled:asCalendar({status:'CANCELLED'})}[edit];
      const latest = {current:edit === 'renamed' ? [{...original, title:'Edited title'}] : [], newIds:[]};
      clock.now += 60000;
      const immediate = await src.poll(initial.cursor);
      assert.deepEqual(immediate.events, []);
      assert.deepEqual(immediate.groupCalendar, transport === 'local' ? latest : {current:[original], newIds:[]});
      clock.now += 15 * 60000;
      const checked = await src.poll(immediate.cursor);
      assert.deepEqual(checked.events, []);
      assert.deepEqual(checked.groupCalendar, latest);
      assert.equal(fetches, transport === 'https' ? 2 : 0);
    }
  }
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
