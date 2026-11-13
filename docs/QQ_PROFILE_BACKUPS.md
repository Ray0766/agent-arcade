# Private QQ configuration backups

Implemented in source on **2026-11-06**. This feature manages the raw backups
created by `QQProfileConfig`; it does not back up QQ's login/session directory,
restore online identity or change a companion's encrypted credentials.

## Use

Open **QQ accounts → the intended account → Configuration backups**.

1. Choose **List backups**, select one valid backup and choose **Preview changes**.
   Merely opening the section or listing/previewing files does not write them.
2. Review the timestamp, SHA-256, known connection changes and credential warning.
   Values that could contain secrets, arbitrary field names and full JSON are
   omitted. The preview is deliberately partial; unknown-field changes are
   identified without exposing their contents.
3. Disconnect the affected AI, stop its QQ runtime and close NapCat Desktop.
   Choose **Restore this configuration** explicitly. The current file is first
   preserved as another private backup; the selected source is not deleted.
4. Refresh state and recheck the connection. If the old port/token differs,
   explicitly save the companion binding again before connecting. Restoration
   does not generate a token, update the vault, log into QQ or connect an AI.

The restore action is separate from saving a companion binding. It restores
the chosen **exact bytes**, including BOM, whitespace and unknown fields,
instead of running the ordinary configuration editor. This can also restore
old settings that are unsuitable for the current installation; previewing a
backup is not an endorsement of those settings.

## Integrity and concurrency

- The backup ID must match the selected account's existing hashed filename
  convention. Arbitrary paths, traversal, another account's ID, symlinks,
  junction paths, hard-linked files, malformed UTF-8/JSON and oversized files
  are rejected. Legacy backups have no signed provenance manifest: the account
  association comes from the filename, and a hash does not authenticate who
  originally created or renamed a file.
- Listing computes SHA-256. Preview requires that same digest and captures the
  current file digest. Restore requires both digests and rereads them inside
  `runtime.withConfigurationLock`. A stale selection fails with
  `backup_changed` or `config_changed` instead of overwriting newer content.
- Runtime stop/manager state and both digests are rechecked after saving the
  current backup and after writing/fsyncing the temporary restore file, directly
  before its atomic rename. This protects the observed edit windows; another
  independent process does not participate in this application's lock, so this
  is not an operating-system transaction across unrelated writers.
- A failed post-write status refresh is reported as **restored, refresh failed**.
  A write/readback failure is **unverified**, not a promise that the old file is
  unchanged. Preserve both files and inspect the state before retrying.
- Private backups contain bridge secrets. No raw JSON or credential value
  crosses renderer IPC, and no file is automatically pruned or exported.

## Bounds and integration contract

`QQProfileBackups({profiles, assertCurrent?})` shares the existing profile
editor's runtime and private backup directory. `assertCurrent` is an internal
main-process closure used to invalidate an operation after a manager change or
shutdown; it is never accepted from renderer input.

| Method | Input and result |
| --- | --- |
| `list(accountId, {limit})` | Default 30, maximum 100 rows; metadata, SHA, size and eligibility only. At most 2,000 directory entries are scanned. `scanLimited` means the list may omit even a newer file. |
| `preview(accountId, {backupId, sha256})` | Returns a bounded, redacted change description and `currentSha256`. Known server fields are identified, unknown names/values are withheld. |
| `restore(accountId, {backupId, sha256, currentSha256})` | Runs under the configuration lock; returns the preserved backup ID and verified result, never a token or filesystem path. |

Files are limited to 2 MiB, known server arrays to 64 items each, parsed JSON to
64 levels and 100,000 visited values. Corrupt current JSON may be repaired if its
raw file is otherwise safe and bounded; those corrupt bytes are still preserved
first and remain ineligible as a future restore source.

The preload routes are `qqRuntimeBackups`, `qqRuntimeBackupPreview` and
`qqRuntimeBackupRestore`. Main rejects extra fields and invalid IDs/digests.
Restore blocks connection attempts for the affected QQ until the operation
settles, and rejects an already active companion instead of disconnecting it
silently. Console busy/epoch checks protect directory changes and shutdown.

## Verification

The focused module/profile/console/IPC run passed **49 tests**, including exact-byte
recovery, cross-account rejection, stale SHA checks, external edits during temp
fsync, unknown credential fields, links, size/depth limits, concurrent edits,
shutdown and committed results with failed refresh. The actual main-process
registration callbacks were also checked for strict inputs, active-companion
rejection and operation-guard cleanup. Local receipt:
`outputs/qq-profile-backups-ipc-reviewed-20261106.txt`.

The isolated renderer run passed **41 checks / 26 screenshots**. It covers
explicit selection/preview, disabled restore while QQ/Desktop/AI is active,
stale selection errors, no token in DOM, refresh-failure success wording and
Chinese/English 430 CSS px layouts. Key screenshots were opened and inspected.
Local receipt: `outputs/companion-qq-backups-20261106-ui.json`.

The automated filesystem tests use temporary fixtures and the renderer tests
replace IPC with synthetic handlers. A separate packaged Windows flow on
2026-11-06 used the installed, stopped Ju account: prepare the existing
connection, list its generated backup, select and preview it, then restore it
through the real UI. Independent readback matched the original 583-byte file
and SHA-256 exactly; both the original and the 607-byte pre-restore file remained
as private backups. Only the editor's debug field/default formatting differed;
the existing bridge credential and port were retained. No login data was
restored, no account was authenticated, and no message was sent.

Private receipts: `outputs/qq-profile-real-restore-20261106.json` and
`outputs/qq-profile-real-restored-20261106.png`. This accepts one real
configuration round trip, not restoration of every legacy schema or a
login/session backup. See [migration boundaries](QQ_MIGRATION.md).
