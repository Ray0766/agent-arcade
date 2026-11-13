'use strict';
// Backwards-compatible entry point. The selected product presentation is now
// account cards plus a native sign-in dialog. Run one fixture, not two suites.
// The production fixture retains explicit Start/QR/AI boundaries, account and
// installation ABA, process generation, recovery, orphan confirmation, directory,
// components, first setup, add-account empty state, keyboard and viewport checks.
require('./qq-login-dialog-ui-smoke.cjs');
