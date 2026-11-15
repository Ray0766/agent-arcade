'use strict';
// No Keychain is created/opened. This script uses only synthetic native tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'darwin') {
  console.log('SKIP: native credential helper requires macOS.');
  process.exit(0);
}
const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'arcade-native-vault-unit-'));
fs.chmodSync(temporary, 0o700);
const config = path.join(temporary, 'BrokerConfiguration.swift');
const source = path.join(root, 'src/mac/credential-helper.swift');
fs.writeFileSync(config, `enum BrokerConfiguration {
    static let peerRequirement = "identifier \\\"agent-arcade.test.unit-peer\\\""
    static let service = "agent-arcade.test.native-unit"
    static let account = "agent-arcade.test.native-unit"
    static let keychainPath = ${JSON.stringify(path.join(temporary, 'never-opened.keychain-db'))}
    static let testing = true
}
`, { mode: 0o600 });
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 60_000,
    maxBuffer: 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}
try {
  const base = ['swiftc', '-parse-as-library', '-O', '-module-cache-path', path.join(temporary, 'module-cache')];
  const unit = path.join(temporary, 'native-unit');
  const compiled = run('/usr/bin/xcrun', [...base, '-D', 'BROKER_NATIVE_UNIT', source, config, '-o', unit]);
  assert.equal(compiled.status, 0, compiled.stderr);
  const checked = run(unit, []);
  assert.equal(checked.status, 0, 'Synthetic native crypto/protocol checks failed.');
  assert.match(checked.stdout, /checks passed; no Keychain access/);
  const normal = path.join(temporary, 'normal-main-not-installed');
  const normalCompile = run('/usr/bin/xcrun', [...base, source, config, '-o', normal]);
  assert.equal(normalCompile.status, 0, normalCompile.stderr);
  // Unknown CLI flags are rejected before parent validation or Keychain APIs.
  const bypass = run(normal, ['--self-test'], { input: '' });
  assert.equal(bypass.status, 1);
  assert.deepEqual(JSON.parse(bypass.stdout), { version: 1, status: 'error', code: 'invalid_request' });
  assert.equal(bypass.stderr, '');
  console.log('PASS: native synthetic known answers, protocol bounds, normal-main compile and CLI-bypass refusal; no Keychain access.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
