# Recover an interrupted component operation

The source implementation adds **QQ accounts → Local components → Manage
component versions → Interrupted operation recovery** in the existing window. It
handles management records left when an operation's owning process exits.
It does not log into QQ, restore configuration contents, change the selected
component version, or start an account.

Stop the installed account backgrounds and the old NapCat Desktop manager
before recovery. The application must verify the recorded owner has exited
through both a process-table query and a direct process-identity query.
An occupied PID with a different creation time is not treated as proof that
deleting its old record is safe.

Inspect one record, review the proposed action, then explicitly clear that
record. Where more than one record remains, inspect each separately in this
order:

1. **Configuration edit marker:** clears a confirmed interrupted edit marker.
   The component and recovery locks remain. This does **not** establish that
   the previous configuration write succeeded or undo it; use configuration
   comparison/backups to inspect actual content.
2. **Recovery operation record:** clears a confirmed interrupted recovery.
   An existing component lock remains and needs its own inspection.
3. **Component operation lock:** clears the confirmed dead owner's component
   lock. The UI states if cleanup of its own recovery record is incomplete or
   its presence cannot be verified.

There is no chained cleanup or automatic startup. The most recent bounded
receipt remains visible for the current application session even if the
drawer was closed while cleanup finished. Changing the installation clears
that UI context. Receipts do not contain tokens, full paths, owner process
details, login material, or previous configuration contents.

## Records that must remain

- PID-only legacy component locks, old empty configuration markers, unknown
  schemas, damaged records and unsupported links remain untouched. File-write
  timestamps cannot reconstruct an original process identity.
- A still-running owner, disagreement between process observations, a replaced
  file, a changed installation, or another active operation blocks cleanup.
- Configuration markers bind the original owner, component-lock token and the
  exact component-lock file identity and bytes. A missing component lock is
  also part of the preview, so one appearing afterward invalidates it.
- A read-back or refresh failure after deletion must not be reported as
  “nothing changed.” Inspect the recorded outcome before attempting another
  operation. An uncertain remaining-record state is explicitly unknown.

The recovery gate is an ephemeral OS IPC endpoint. On Windows it is a named
pipe created on the local machine; it immediately closes clients and carries
no commands, credentials or user data. This is not a claim of a custom remote
access ACL. Its OS lifetime avoids a recursive chain of recovery-lock files.
See [Node IPC support](https://github.com/nodejs/node/blob/v24.22.1/doc/api/net.md#ipc-support)
and [Windows named pipe operations](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-operations).

## Validation boundary

Runtime tests use temporary directories and synthetic process observations to
cover identity reuse, legacy records, replacements, concurrent recovery,
cancellation, partial commits and configuration-marker association. A separate
synthetic Node child also verifies actual local IPC lifetime after exit.
Coordinator checks cover fixed request fields, one-use previews, installation
changes, privacy filtering and retained outcomes after refresh failures.
These checks are not a real account login or configuration-write recovery.

The packaged `single-window-lock-recovery-20261106` interface passed a bounded
production-path check. Dedicated helper processes used the actual lock writers
in the installed component directory, then exited before cleanup. The first
confirmed that recovery rejects its still-live owner. Another interrupted the
recovery method after its guard was durable but before primary-lock deletion.
Neither wrote configuration bytes or stopped any other process.

The actual application separately inspected and cleared the configuration
marker, recovery guard and primary component lock. Independent reads after
each action confirmed the other records remained unchanged. All three QQ
configuration hashes and the selected component record were unchanged; all
15 ordinary QQ process identities remained. A separate normal Whale start
retained login and passed independent account identity/online/good checks.
Private receipts: `outputs/qq-lock-live-summary-20261106.json` and seven
`outputs/qq-lock-live-*-20261106.png` screenshots.

This establishes actual OS identity, production lock-writing and packaged UI
recovery. It does **not** establish rollback from an interrupted real
configuration write, a new chat flow, or legacy-record recovery. See
[the current delivery scope](ACTIVE_GOAL.md) for the latest package, and
[QQ crash recovery](QQ_RECOVERY.md) for the separate process-leftover flow.
