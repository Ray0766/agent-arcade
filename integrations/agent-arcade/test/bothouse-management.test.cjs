'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readAddress } = require('../src/core/bothouse-management.cjs');

test('stock Bothouse management uses 9820 when the loopback port is omitted or zero', () => {
  for (const portLine of ['', 'port = 0', 'port = 9820']) {
    const config = `[management]\nenabled = true\nhost = "127.0.0.1"\n${portLine}\n`;
    assert.deepEqual(readAddress(config), {
      host: '127.0.0.1', port: 9820, origin: 'http://127.0.0.1:9820',
    });
  }
});

test('reading stock management still requires an explicit loopback binding', () => {
  const config = '[management]\nenabled = true\n';
  for (const extra of ['', 'host = "0.0.0.0"', 'host = "127.0.0.1"\nport = 65536']) {
    assert.throws(() => readAddress(config + extra), { code: 'config' });
  }
  assert.deepEqual(readAddress(config + 'host = "::1"\nport = 59241'), {
    host: '::1', port: 59241, origin: 'http://[::1]:59241',
  });
});
