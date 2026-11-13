# Local transfer records

The remote QQ management dialog has a **Local transfer records** entrance. It
shows resumable-helper records from this application home even when the remote
registration was deleted, its binding changed, or the job expired. Opening it
does not authenticate a server or start, resume or pause a transfer.

This is a local maintenance flow. The existing authenticated helper browser and
its exact remote-binding checks remain the entrance for network recovery. A
matching local registration does not prove that the server is online or that a
file was delivered.

## Use

1. Open **QQ accounts → Remote instances → Local transfer records**.
2. Inspect an active record. If this process still owns its operation or an
   unclosed resource, first choose **Pause local operation**. This waits for that
   exact operation's late acknowledgement and checkpoint; it does not pause a
   different attempt or cancel work on the server.
3. Choose **Stop recovery and remove…**, review the effect, then confirm
   **Keep outcome and remove**. This removes the recovery entry from the active pool and preserves
   its complete encrypted original record in **Ended records**.
4. An ended record can be inspected and explicitly forgotten with a separate
   **Delete ended record… → Delete ended record** confirmation. This removes its local recovery evidence. It does not
   delete source, partial, downloaded or server files.

The preview states whether the complete record is retained or removed. A failed
or uncertain mutation is not automatically retried. **Check local records** reads
the current tables and distinguishes the original record, the archived original,
absence, and a changed record. Absence alone cannot prove who deleted a record
or turn an earlier unknown operation into a historical success.

Going back closes only the local records pane. Its underlying authorized transfer
view remains owned. Closing the whole remote dialog, switching its application
context, minimizing, or quitting follows the existing retirement rules and
waits for the relevant owners. Neither operation changes saved AI keys.

## Retention and migration

- Active records and ended records each have a limit of 64. There is no automatic
  eviction. A full ended pool rejects archiving and retains the original active
  record; explicitly forgetting an ended record releases space.
- Original job JSON payloads across both pools are bounded to 8 MiB. Ended-record
  envelopes have a separate reserve of at most 2 KiB each, so all decrypted
  payloads remain within 8 MiB + 128 KiB. This lets a legal full version-1 store
  retire its jobs without discarding facts. Existing per-job and 16 MiB database
  limits still apply. To add new job payloads at the limit, explicitly forget an
  unneeded ended record first.
- The original job state, pending request, scope, byte counters, file proofs and
  saved/published three-state facts are preserved inside the encrypted envelope.
  A former `transferring` record is presented as requiring reconciliation; it is
  not rewritten as completed or cancelled.
- SQLite schema version 2 adds an ended-record table. Migration from version 1
  validates existing encrypted jobs and updates the schema in one transaction.
  Unsupported/corrupt storage remains locked. Previous binaries reject version
  2; do not run an old and new application against the same home simultaneously.
- A record with an old `cleanupPending` flag but no current process owner may be
  archived only after acquiring its normal per-job OS gate. The original flag
  remains evidence of uncertainty; this does not claim that a resource or server
  was cleaned up.

The gate protects local record mutation across processes. Exact revisions and
one-use five-minute previews protect against stale actions. A committed database
change remains recorded as committed if later gate cleanup fails; the application
retains that gate owner for cleanup retry instead of repeating the transaction.

## Verification boundary

The implementation is included in the operated
`single-window-transfer-records-20261107` package. Store checks use fresh
encrypted SQLite databases, actual filesystem sentinels and owned child
processes. Controller checks exercise actual main IPC and exact operation
ownership; the Pause flow additionally uses production Session/Stage and an
owned synthetic TLS service. Twelve renderer checks passed with eleven
inspected images. These isolated checks do not use real account credentials,
the OS vault or a real remote host.

The final regression passed 3,643 tests with one existing opt-in skip and no
failures. All 295 packaged source files matched; disposable desktop smoke and
both resulting screenshots were checked. The original-profile application
opened the offline entrance with no registered server, showed both empty pools,
expanded ended records, returned and closed normally. A metadata-only read
independently confirmed the original empty SQLite store migrated from version 1
to 2; no user record was archived or deleted. Nonempty migration and mutation
remain isolated-component evidence. Ju/Whale QQ and AI configuration restored
without QR or key entry; no new model request was made.

This feature does not accept a real remote transfer, ordinary QQ account login,
model billing, or any of the deferred human companion tests. See
[resumable transfers](QQ_RESUMABLE_TRANSFERS.md) and
[current delivery scope](ACTIVE_GOAL.md).
