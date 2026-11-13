'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNativeCron, isSupportedNativeCron } = require('../src/bot/qq-qce-native-cron.cjs');

function rejected(value) {
  assert.equal(isSupportedNativeCron(value), false);
  assert.throws(() => validateNativeCron(value), error => {
    assert.equal(error.code, 'invalid_cron');
    assert.equal(error.message, 'invalid_cron');
    return true;
  });
}

test('supported expressions are returned verbatim, including order, duplicates and leading zeros', () => {
  for (const value of [
    '* * * * *', '0 0 1 1 1', '59 23 31 12 7',
    '05,00,05 09 01,31 01,12 07,01',
    '*/15 1,13 */2 */3 1,7', '*/10,5,* 0 * * 7',
  ]) {
    assert.equal(validateNativeCron(value), value);
    assert.equal(isSupportedNativeCron(value), true);
  }
});

test('field bounds reject values that the upstream permissive parser would silently mishandle', () => {
  for (const value of [
    '60 0 1 1 1', '0 24 1 1 1', '0 0 0 1 1', '0 0 32 1 1',
    '0 0 1 0 1', '0 0 1 13 1', '0 0 1 1 0', '0 0 1 1 8',
    '0,60 0 1 1 1', '0 0 1 1 1,0', '0 0 1,32 1 1',
  ]) rejected(value);
});

test('only five fields with single ASCII space separators are accepted', () => {
  for (const value of [
    '', '*', '* * * *', '* * * * * *', ' * * * * *', '* * * * * ',
    '*  * * * *', '*\t* * * *', '* * * * *\n', '* * * * *\r\n',
    '*\n* * * *', '*\u00a0* * * *', '* * * * \u200b*', '* * * * *\0',
  ]) rejected(value);
});

test('standard cron extensions, partial integer parses and malformed list atoms are rejected', () => {
  for (const value of [
    '0 1-5 * * *', '0 1 * JAN MON', '0 1 L * *', '0 1 1W * *',
    '0 1 * * 1#2', '0 1 ? * *', '@daily', '0 1 * * SUN',
    '1e1 1 * * *', '0x10 1 * * *', '1.0 1 * * *', '+1 1 * * *',
    '-1 1 * * *', '１２ 1 * * *', '5x 1 * * *',
    ',1 1 * * *', '1, 1 * * *', '1,,2 1 * * *', '[1,2] 1 * * *',
    '(1,2) 1 * * *', '*/ 1 * * *', '** 1 * * *', '*/2/3 1 * * *',
    '1/2 1 * * *', '1-5/2 1 * * *', '*/2,,5 1 * * *',
  ]) rejected(value);
});

test('wildcard steps are positive safe integers and need no field-minimum offset or upper field bound', () => {
  for (const value of ['*/1 */24 */32 */13 */8', '*/9007199254740991 * * * *', '*/0002 * * * *']) {
    assert.equal(validateNativeCron(value), value);
  }
  for (const value of ['*/0 * * * *', '*/00 * * * *', '*/-2 * * * *', '*/+2 * * * *', '*/1.5 * * * *', '*/9007199254740992 * * * *']) rejected(value);
});

test('the 128-character input limit is exact and validation does not coerce caller objects', () => {
  const exactly128 = '0'.repeat(120) + ' 0 1 1 1';
  assert.equal(exactly128.length, 128);
  assert.equal(validateNativeCron(exactly128), exactly128);
  rejected('0' + exactly128);
  let coercions = 0;
  for (const value of [undefined, null, false, 0, 1n, Symbol('synthetic'), ['* * * * *'], new String('* * * * *'), { toString() { coercions++; throw Error('must_not_coerce'); } }]) rejected(value);
  assert.equal(coercions, 0);
});

test('the validator exposes no execution or timezone API and invalid errors do not echo input', () => {
  assert.deepEqual(Object.keys(require('../src/bot/qq-qce-native-cron.cjs')).sort(), ['isSupportedNativeCron', 'validateNativeCron']);
  rejected('synthetic-private-value');
});
