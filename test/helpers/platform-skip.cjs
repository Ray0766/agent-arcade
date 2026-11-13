'use strict';
// Platform skips for node:test. A test file that cannot run on a platform keeps
// every test registered there as skipped, with the reason shown in the report;
// nothing is deleted. On a supported platform these exports ARE node:test, so
// nothing changes where the tests have always run.
const nodeTest = require('node:test');

// The local QQ management layer (component stores, code gates, runtime, pending
// updates, transfer journal) and the QQ supervisor / transfer-helper services
// serialise their work with an operating-system-owned lock: a Windows named
// pipe or a Linux abstract socket. Both vanish with their owner process. macOS
// has neither (src/bot/qq-component-lock-recovery.cjs gateEndpoint,
// src/qq-supervisor/ownership.cjs, src/transfer-helper/ownership.cjs), and the
// app does not build this layer there (docs/MACOS.md).
const OWNED_IPC_REASON = 'Windows/Linux only: needs the OS-owned single-owner lock (named pipe or abstract socket) of the QQ management layer, which macOS does not have and the app does not build there';
// QCE startup verification reads the Windows user profile and refuses every
// other platform (src/bot/qq-qce-startup.cjs).
const WINDOWS_QCE_REASON = 'Windows-only: QCE startup verification inspects the Windows user profile and refuses other platforms';

const ownedIpcSkip = (platform = process.platform) => ['win32', 'linux'].includes(platform) ? false : OWNED_IPC_REASON;
const windowsOnlySkip = (reason, platform = process.platform) => platform === 'win32' ? false : reason;

// node:test itself when `skip` is false; otherwise a `test` function that
// registers each test as skipped for that reason and never runs its body.
function testUnless(skip, base = nodeTest) {
  if (!skip) return base;
  if (typeof skip !== 'string' || !skip) throw TypeError('A platform skip needs a reason.');
  const skipped = (name, ...rest) => base(typeof name === 'string' && name ? name : 'unnamed test', {skip}, () => {});
  return Object.assign(skipped, {skip: skipped, todo: skipped, only: skipped, test: skipped, it: skipped, before() {}, after() {}, beforeEach() {}, afterEach() {}});
}

module.exports = {
  testUnless, ownedIpcSkip, windowsOnlySkip, OWNED_IPC_REASON, WINDOWS_QCE_REASON,
  // Drop-in replacements for require('node:test') in a whole test file.
  ownedIpcTest: testUnless(ownedIpcSkip()),
  windowsQceTest: testUnless(windowsOnlySkip(WINDOWS_QCE_REASON)),
};
