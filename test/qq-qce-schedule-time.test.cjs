'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRecurrence, nextOccurrence, LIMITS } = require('../src/bot/qq-qce-schedule-time.cjs');

const rule = (timeZone = 'UTC', time = '09:00', extra = {}) => ({
  frequency: 'daily', time, timeZone,
  dstPolicy: { missing: 'skip', repeated: 'first' }, missingMonthDay: 'skip', ...extra,
});
const next = (r, after) => nextOccurrence(r, Date.parse(after));
function occurrence(r, after, utc, localDate) {
  const value = next(r, after);
  assert.equal(value.utc, utc);
  assert.equal(value.at, Date.parse(utc));
  assert(value.at > Date.parse(after));
  assert.equal(value.localDate, localDate);
  assert.equal(value.localTime, r.time);
  assert.match(value.slotKey, /^[0-9a-f]{64}$/);
  return value;
}

test('canonical weekly ordering is detached and aliases use the runtime IANA identity', () => {
  const source = rule('australia/sydney', '09:05', { frequency: 'weekly', weekdays: [7, 1, 4] });
  const value = validateRecurrence(source);
  assert.equal(value.timeZone, 'Australia/Sydney');
  assert.deepEqual(value.weekdays, [1, 4, 7]);
  source.weekdays[0] = 2;
  source.dstPolicy.missing = 'shift';
  assert.deepEqual(value.weekdays, [1, 4, 7]);
  assert.equal(value.dstPolicy.missing, 'skip');
  assert.equal(validateRecurrence(rule('UTC')).timeZone, 'UTC');
});

test('strict schema rejects coercion, unknown fields, offsets, policies and invalid weekdays', () => {
  const invalid = [null, [], {}, rule(''), rule('+11:00'), rule('Missing/Zone'), rule(' UTC'),
    rule('UTC', '9:00'), rule('UTC', '24:00'), rule('UTC', '09:60'), rule('UTC', '09:00:00'),
    rule('UTC', '09:00', { cron: '* * * * *' }), rule('UTC', '09:00', { monthDay: 1 }),
    rule('UTC', '09:00', { weekdays: [1] }), rule('UTC', '09:00', { frequency: 'hourly' }),
    rule('UTC', '09:00', { dstPolicy: { missing: 'shift', repeated: 'first' } }),
    rule('UTC', '09:00', { dstPolicy: { missing: 'skip', repeated: 'both' } }),
    rule('UTC', '09:00', { missingMonthDay: 'last-day' }),
    ...[[], [0], [8], ['1'], [1, 1], new Array(1), [1, 2, 3, 4, 5, 6, 7, 1]].map(weekdays => rule('UTC', '09:00', { frequency: 'weekly', weekdays })),
    ...[0, 32, 1.5, '31', undefined].map(monthDay => rule('UTC', '09:00', { frequency: 'monthly', monthDay })),
  ];
  for (const value of invalid) assert.throws(() => validateRecurrence(value), { code: 'invalid_recurrence' });
  let invoked = false;
  const access = rule(); Object.defineProperty(access, 'time', { get() { invoked = true; return '09:00'; } });
  assert.throws(() => validateRecurrence(access), { code: 'invalid_recurrence' });
  assert.equal(invoked, false);
});

test('UTC exact equality advances, subminute after remains strictly exclusive', () => {
  const r = rule();
  occurrence(r, '2030-04-07T08:59:59.999Z', '2030-04-07T09:00:00.000Z', '2030-04-07');
  occurrence(r, '2030-04-07T09:00:00.000Z', '2030-04-08T09:00:00.000Z', '2030-04-08');
  occurrence(r, '2030-04-07T09:00:00.001Z', '2030-04-08T09:00:00.000Z', '2030-04-08');
});

test('Sydney 2030 spring gap is skipped instead of moved to 03:30', () => {
  occurrence(rule('Australia/Sydney', '02:30'), '2030-10-04T16:30:00.000Z', '2030-10-06T15:30:00.000Z', '2030-10-07');
});

test('Sydney 2030 fold selects only first, even when after is between both instants', () => {
  const r = rule('Australia/Sydney', '02:30');
  occurrence(r, '2030-04-06T15:29:59.999Z', '2030-04-06T15:30:00.000Z', '2030-04-07');
  occurrence(r, '2030-04-06T15:45:00.000Z', '2030-04-07T16:30:00.000Z', '2030-04-08');
  occurrence(r, '2030-04-06T16:29:59.999Z', '2030-04-07T16:30:00.000Z', '2030-04-08');
});

test('New York spring gap and autumn duplicate use exact explicit policies', () => {
  occurrence(rule('America/New_York', '02:30'), '2030-03-09T07:30:00.000Z', '2030-03-11T06:30:00.000Z', '2030-03-11');
  const r = rule('America/New_York', '01:30');
  occurrence(r, '2030-11-03T05:29:59.999Z', '2030-11-03T05:30:00.000Z', '2030-11-03');
  occurrence(r, '2030-11-03T05:45:00.000Z', '2030-11-04T06:30:00.000Z', '2030-11-04');
  occurrence(r, '2030-11-03T06:29:59.999Z', '2030-11-04T06:30:00.000Z', '2030-11-04');
});

test('Lord Howe half-hour gap and half-hour fold are not treated as one-hour DST', () => {
  const folded = rule('Australia/Lord_Howe', '01:45');
  occurrence(folded, '2030-04-06T14:44:59.999Z', '2030-04-06T14:45:00.000Z', '2030-04-07');
  occurrence(folded, '2030-04-06T15:00:00.000Z', '2030-04-07T15:15:00.000Z', '2030-04-08');
  occurrence(rule('Australia/Lord_Howe', '02:15'), '2030-10-04T15:45:00.000Z', '2030-10-06T15:15:00.000Z', '2030-10-07');
});

test('half-hour and quarter-hour ordinary offsets convert across UTC dates', () => {
  occurrence(rule('Asia/Kolkata', '00:15'), '2030-01-01T17:00:00.000Z', '2030-01-01T18:45:00.000Z', '2030-01-02');
  occurrence(rule('Asia/Kathmandu', '00:15'), '2030-01-01T17:00:00.000Z', '2030-01-01T18:30:00.000Z', '2030-01-02');
  occurrence(rule('Pacific/Kiritimati', '00:15'), '2030-01-01T09:00:00.000Z', '2030-01-01T10:15:00.000Z', '2030-01-02');
});

test('Apia date-line skip omits the whole missing 2011-12-30 local day', () => {
  occurrence(rule('Pacific/Apia', '12:00'), '2011-12-29T22:00:00.000Z', '2011-12-30T22:00:00.000Z', '2011-12-31');
});

test('weekly ISO Sunday/Monday is evaluated in the requested timezone', () => {
  const r = rule('Pacific/Kiritimati', '00:15', { frequency: 'weekly', weekdays: [1, 7] });
  occurrence(r, '2030-04-06T09:59:00.000Z', '2030-04-06T10:15:00.000Z', '2030-04-07');
  occurrence(r, '2030-04-06T10:15:00.000Z', '2030-04-07T10:15:00.000Z', '2030-04-08');
});

test('a weekly nonexistent clock time skips to the next selected weekday', () => {
  occurrence(rule('America/New_York', '02:30', { frequency: 'weekly', weekdays: [7] }),
    '2030-03-03T07:30:00.000Z', '2030-03-17T06:30:00.000Z', '2030-03-17');
});

test('monthly 31 skips February/April and never overflows into a different month', () => {
  const r = rule('UTC', '12:00', { frequency: 'monthly', monthDay: 31 });
  occurrence(r, '2030-01-31T12:00:00.000Z', '2030-03-31T12:00:00.000Z', '2030-03-31');
  occurrence(r, '2030-03-31T12:00:00.000Z', '2030-05-31T12:00:00.000Z', '2030-05-31');
});

test('monthly leap day and non-leap missing day follow the actual Gregorian calendar', () => {
  const r = rule('UTC', '00:00', { frequency: 'monthly', monthDay: 29 });
  occurrence(r, '2032-01-29T00:00:00.000Z', '2032-02-29T00:00:00.000Z', '2032-02-29');
  occurrence(r, '2031-01-29T00:00:00.000Z', '2031-03-29T00:00:00.000Z', '2031-03-29');
});

test('monthly slot falling in a DST gap skips that month', () => {
  occurrence(rule('America/New_York', '02:30', { frequency: 'monthly', monthDay: 10 }),
    '2030-02-10T07:30:00.000Z', '2030-04-10T06:30:00.000Z', '2030-04-10');
});

test('slot keys remain canonical on rewind; UTC jumps do not cause implicit backfill', () => {
  const r = rule('America/New_York', '01:30', { frequency: 'weekly', weekdays: [7, 1] });
  const a = next(r, '2030-11-03T05:00:00.000Z');
  const same = next({ ...r, weekdays: [1, 7] }, '2030-11-03T04:00:00.000Z');
  assert.equal(a.slotKey, same.slotKey);
  const jumped = next(r, '2030-11-10T07:00:00.000Z');
  assert.equal(jumped.localDate, '2030-11-11');
  assert.notEqual(jumped.slotKey, a.slotKey);
  assert.equal(next(r, '2030-11-03T05:00:00.000Z').slotKey, a.slotKey);
});

test('multiple returned occurrences are strictly increasing and never reuse a local fold slot', () => {
  const r = rule('America/New_York', '01:30');
  let after = Date.parse('2030-10-31T12:00:00.000Z');
  const keys = new Set(), dates = new Set();
  for (let i = 0; i < 7; i++) {
    const n = nextOccurrence(r, after);
    assert(n.at > after); assert(!keys.has(n.slotKey)); assert(!dates.has(n.localDate));
    keys.add(n.slotKey); dates.add(n.localDate); after = n.at;
  }
  assert.equal(keys.size, 7);
});

test('integer UTC boundaries and supported end are explicit; invalid values never use Date.now', () => {
  for (const after of [NaN, Infinity, 0.5, '2030-01-01', new Date()]) {
    assert.throws(() => nextOccurrence(rule(), after), { code: 'invalid_schedule_time' });
  }
  for (const after of [LIMITS.minEpochMs - 1, LIMITS.maxEpochMsExclusive]) {
    assert.throws(() => nextOccurrence(rule(), after), { code: 'schedule_time_out_of_range' });
  }
  assert.equal(nextOccurrence(rule('UTC', '23:59'), LIMITS.maxEpochMsExclusive - 1), null);
  assert.equal(nextOccurrence(rule('UTC', '00:00'), LIMITS.minEpochMs).utc, '2000-01-02T00:00:00.000Z');
});

test('module never relies on implicit local Date getters or current clock', () => {
  const oldNow = Date.now, oldHours = Date.prototype.getHours, oldDate = Date.prototype.getDate;
  Date.now = Date.prototype.getHours = Date.prototype.getDate = () => { throw Error('implicit_local_time'); };
  try {
    occurrence(rule('Australia/Sydney', '23:45'), '2030-06-01T12:00:00.000Z', '2030-06-01T13:45:00.000Z', '2030-06-01');
  } finally { Date.now = oldNow; Date.prototype.getHours = oldHours; Date.prototype.getDate = oldDate; }
});
