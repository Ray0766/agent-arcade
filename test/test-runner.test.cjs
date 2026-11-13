'use strict';
// scripts/test.cjs decides which temporary directory the whole suite sees.
const test = require('node:test');
const assert = require('node:assert/strict');
const {tempEnvironment, split, allTests} = require('../scripts/test.cjs');

test('test runner: macOS and Linux get the resolved temporary directory in TMPDIR', () => {
  const realpath = value => value.replace(/^\/var\//, '/private/var/');
  assert.deepEqual(tempEnvironment({platform: 'darwin', tmpdir: '/var/folders/ab/T', realpath}), {TMPDIR: '/private/var/folders/ab/T'});
  assert.deepEqual(tempEnvironment({platform: 'linux', tmpdir: '/var/tmp', realpath}), {TMPDIR: '/private/var/tmp'});
  // Already resolved: nothing is set, so an explicit TMPDIR of the caller is left alone.
  assert.deepEqual(tempEnvironment({platform: 'darwin', tmpdir: '/private/var/folders/ab/T', realpath}), {});
  assert.deepEqual(tempEnvironment({platform: 'linux', tmpdir: '/tmp', realpath}), {});
});

test('test runner: Windows gets an 8.3 short temporary path expanded in both TEMP and TMP', () => {
  const short = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp', long = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp';
  // os.tmpdir() reads TEMP first and TMP second on Windows; both must agree.
  assert.deepEqual(tempEnvironment({platform: 'win32', tmpdir: short, realpath: value => value === short ? long : value}), {TEMP: long, TMP: long});
  assert.deepEqual(tempEnvironment({platform: 'win32', tmpdir: long, realpath: value => value}), {});
  // TMPDIR means nothing to os.tmpdir() on Windows and is never the answer there.
  assert.equal(Object.hasOwn(tempEnvironment({platform: 'win32', tmpdir: short, realpath: () => long}), 'TMPDIR'), false);
});

test('test runner: on this machine the chosen directory is its own resolved form', () => {
  const fs = require('node:fs'), os = require('node:os');
  const chosen = Object.values(tempEnvironment())[0] || os.tmpdir(), resolve = process.platform === 'win32' ? fs.realpathSync.native : fs.realpathSync;
  assert.equal(resolve(chosen), chosen);
});

test('test runner: options and files are told apart, and the default is every test file', () => {
  assert.deepEqual(split(['--test-concurrency=2', 'test/a.test.cjs', '--test-timeout=5', 'test/b.test.cjs']), {options: ['--test-concurrency=2', '--test-timeout=5'], files: ['test/a.test.cjs', 'test/b.test.cjs']});
  const files = allTests();
  assert(files.length > 300); assert(files.every(name => /^test[\\/][^\\/]+\.test\.cjs$/.test(name))); assert(files.some(name => name.endsWith('test-runner.test.cjs')));
});
