# First QQ setup inside Agent Arcade

This is the Windows **existing QQ program** route. It creates an independent
application-owned Shell installation without requiring NapCat Desktop to create
the instance. A supported QQ executable must already be installed for this route.
The separate [Node-component route](QQ_NODE_SETUP.md) is implemented in the source
and does not require selecting `QQ.exe`. Its first native startup failed; the
repaired package subsequently passed create/select/configure/start/QR/stop/return
with preserved original files and process identities. Node authentication,
messaging and clean-machine acceptance remain pending. That route does not
change this Shell prerequisite.

## Entry and operation

Open **QQ accounts → Local components → Set up QQ** in the main window. Labels may be
translated according to the application language.

1. Choose the installed `QQ.exe` in the native file picker. Agent Arcade checks
   the executable's identity, x64 PE header, hash, product metadata and Windows
   Authenticode signature. The page shows the observed version and signature;
   it does not receive the executable path or certificate details.
2. Reuse an already prepared, verified Shell **4.18.42** package, or explicitly
   prepare that fixed official version. Preparation is a download/extraction
   operation, not a QQ launch. Cancellation discards the pending operation.
3. Create the environment. This consumes the short-lived program selection and
   rechecks its identity. It creates a new descriptor, writable working
   directory and QQ-data directory. Existing accounts and login data are not
   copied. Creation does not select, launch or connect the environment.
4. After disconnecting QQ companions and stopping the managed instances, select
   **Use this environment**. The selection is persisted separately. The previous
   installation remains available through **Return to previous environment**.
5. Use the existing account configuration and lifecycle controls to create an
   account entry and start it. Login, actual account identity, companion binding
   and AI connection are separate steps.

A running old manager, external or unverified QQ processes, a changed selection
or an in-progress operation can block switching. The application does not stop
those processes automatically. A successful selection is not proof of login or
of QQ/AI message delivery.

## Data and recovery

New environments are under the local component store in
`qq-installations/<opaque-id>`. Their descriptor references the chosen program
and the verified prepared Shell. It sets the new runtime's `NAPCAT_QQ_DATA_DIR`
and working directory; imported legacy installations retain their existing data
layout. The prepared selection starts with no fabricated original rollback
target. Returning to the previous installation is a separate operation from
switching its Shell component version.

The main process owns paths, descriptors, temporary capabilities and package
objects. The setup drawer receives bounded summaries. Closing the drawer,
changing the selected companion, hiding/minimizing the window or changing the
installation invalidates its pending work. An acknowledged disk change remains
reported as committed if a later refresh fails; the app does not replay it.

An interrupted descriptor publication can leave two hard links to the same
descriptor. Advanced recovery first previews an exact directory/file-identity
and digest-bound operation. Confirmation removes only the proven temporary
link, preserves the descriptor, and does not start QQ. Unknown, replaced or
additional files are not automatically removed.

## Verification boundary

Automated checks cover fixed package/version selection, exact executable
identity, descriptor publication/recovery, rejected links and replacements,
mutual exclusion, cancellation, selection persistence, return to a previous
installation and the unchanged legacy data-path behavior. Synthetic program and
process fixtures are not a live QQ login test.

Before this integration, a read-only observation of the installed QQ program
identified version **9.9.36.53644**, x64, with a valid Tencent signature and stable
file identity/hash. This observation did not execute QQ or create an environment.

The first actual packaged flow on 2026-11-06 created an empty separate environment,
selected it, configured an account, started QQ, displayed its full QR, and returned
to the original installation. The original three bridge configurations, program
and prepared-component hashes, and 15 ordinary QQ process identities stayed
unchanged. No authentication was performed. The private receipt is
`outputs/qq-first-setup-live-summary-20261106.json`.

That run exposed a same-account encrypted recovery-record collision across
installations, a Stop warning whose instantaneous cause was not captured, and
stale diagnostic UI data after switching back. Fix acceptance remains pending;
the later independent process audit found no surviving target or lease, but this
does not turn the original Stop response into a clean pass.

The subsequent fixed-package run verified a separate installation-scoped encrypted
endpoint file, with all three legacy ciphertext files byte-identical before and
after that run. Returning to the original environment also removed the previous
environment's visible diagnostics and error feedback. Stop still returned
`orphaned_children`; a later independent audit again found no target or lease.
Three subsequent real stops passed, including one with the original native
script and manager-only diagnostics. Same-operation process inspections were
empty before releasing ownership. The earlier failure causes remain unexplained;
the later passes do not retrospectively accept those failed operations. These
limited results do not establish encrypted recovery after an application crash.

The additional [complete Windows Node route](QQ_NODE_SETUP.md) retains this Shell
route and its prior installation. Its bounded pre-authentication lifecycle has
separate actual evidence; this does not establish Node login or messaging.

The executable check covers `QQ.exe`, not all adjacent native libraries or QQ's
earliest startup writes. First login and full data isolation still require separate
live evidence. No compatibility claim follows from the signature alone. The human login exercises and original
nine-feature acceptance limits remain in [the acceptance ledger](COMPANION_ACCEPTANCE.md).

The fixed official Shell remains a separate dependency with its own terms. This
feature is original installation-management code; it is not an independently
implemented QQ protocol core.
