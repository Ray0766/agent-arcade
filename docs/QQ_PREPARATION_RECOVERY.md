# Recover interrupted component preparation

The component drawer can explicitly quarantine an incomplete **new-format**
Shell or Node preparation. It preserves the directory and every remaining file;
it does not delete files, repair code, change the selected component, modify
account data, download again or start QQ. The packaged drawer was exercised on
an isolated, interrupted preparation of the official Shell archive. This does
not establish recovery of a damaged existing user installation.

## Use the existing drawer

Open **QQ accounts → Local components → Manage component versions**. Expand
**Incomplete component preparation** (`未完成的组件准备`).

1. Choose **Inspect incomplete preparation**. This reads bounded writer-record
   metadata. A listed record is not proof that its process has exited or that it
   can be recovered.
2. Select the record and choose **Verify and preview quarantine**. The preview
   identifies its component/version and file, directory and byte counts. It is
   offered only after process, filesystem, publication and installation-reference
   checks pass.
3. Choose **Quarantine and keep files** once. A successful receipt means the
   incomplete directory moved into the private local quarantine. Nothing is
   retried or started. If desired, use the ordinary **Download and prepare**
   action separately after checking the result.

Closing, hiding or switching installation discards the preview. A component
selection change also invalidates it. The single-use confirmation expires after
five minutes. A saved outcome stays available in the drawer during the current
application session; its ticket does not. The UI shows no private paths, writer
PIDs, credentials or file contents.

## What can be recovered

`QQComponentPrepared.preparationRecovery` is shared with its coordinator and
uses the same component store and actual runtime lock root. New preparation
attempts record the exact writer process identity, allocated directory identity,
fixed source identity and expected archive paths/sizes before extraction.

Only an `extracting` record whose writer has verifiably exited is eligible.
Preview and confirmation independently check the writer and directory, bind a
short-lived digest to their observations, and reject changed or reused process
identities. The same operating-system gate excludes another writer or recovery
for this version. Confirmation moves only the exact checked directory to
`qq-component-preparation-quarantine/<component>/<preparationId>`; the writer
record and file bytes remain. The action is a rename, not recursive deletion.

Recovery refuses:

- Old or unknown directories without this writer proof, unknown extra paths,
  links, replaced directories and content beyond the declared extraction limits.
- Any `prepared.json`, including an empty or invalid one, or a writer that
  durably entered `publishing`. Published output is not treated as interrupted
  extraction.
- A reference from a current/previous component selection or managed installation,
  unreadable reference metadata, or relevant installation/configuration locks.
- A live writer, unverified process observation, expired preview, changed scope
  or cancelled operation before commit.

There is no force-recovery button for those cases. Unknown files remain in place.
The existing extraction bounds still apply: at most 10,000 entries, 128 MiB per
file and 512 MiB total. Writer-record discovery is bounded to 256 records.

## Honest outcomes and fixed IPC

The existing trusted `qqComponents` IPC accepts only these additional actions:

| Action | Renderer input | Meaning |
| --- | --- | --- |
| `preparation-list` | None | Read metadata summaries, not full validation |
| `preparation-preview` | Previously listed `preparationId` | Validate one exact incomplete preparation |
| `preparation-recover` | `ticketId`, `expectedDigest` | Consume one confirmation and quarantine it |
| `preparation-dismiss` | None | Revoke this recovery preview/active recovery only |

No caller-supplied path, URL, PID, hash-to-trust, target directory or arbitrary
component is accepted. Closing this recovery view does not cancel an unrelated
background download/preparation. Main/preload reuse the existing fixed IPC;
there is no new generic command channel.

`committed: true, recovered: true` reports verified quarantine. A committed
rename with failed readback remains committed but `recovered: false`; it is not
shown as complete recovery. An uncertain rename returns
`committed: null, changeAttempted: true`. Both require a fresh inspection, not
replay of the old ticket. Follow-up list failure cannot turn a completed move
into “nothing changed.”

Ordinary preparation has a separate boundary: if its manifest was published but
OS-gate cleanup failed, the coordinator returns `preparationCommitted: true`
and a fixed issue. It may reverify the published files, but never reruns
preparation automatically and never calls this a component-selection change.

## Evidence and the prior fixture blind spot

On 2026-11-06:

- The actual `single-window-messenger-recovery-20261106` desktop drawer completed
  inspect → preview → quarantine for the official Shell 4.18.42 archive in an
  isolated store. A real production preparation child had exited with code 86
  during extraction. The preview showed one file and two directories; independent
  readback verified all **224 bytes**, file/directory identities and writer record
  retained, source directory absent, and original/copy archive hashes unchanged.
  No QQ was started and no automatic retry occurred. Receipts:
  `outputs/qq-preparation-ui-fixture-20261106.json` and
  `outputs/qq-preparation-ui-after-20261106.json`.
- An isolated real child process exited with code **86** while writing an original
  synthetic ZIP. Production targeted process observations confirmed its exit.
  Recovery retained **one partial file, two directories and 35 bytes**, preserving
  the file identity and bytes. An explicitly separate retry prepared five files.
  The ZIP was unchanged, with no QQ execution, network request or original
  installation access. Private receipt:
  `outputs/qq-preparation-live-recovery-final-20261106.json`.
- **79 coordinator/adjacent tests passed**, including exact record/quarantine
  identity, one-use confirmation, scope changes, published/unknown outcomes and
  an actual temporary-directory writer→coordinator→quarantine integration.
  `outputs/qq-preparation-coordinator-freeze-20261106-tests.txt`.
- The production drawer passed **20 synthetic checks / 6 screenshots**:
  explicit list/preview, preservation, no retry/start, uncertain commit,
  cancellation, scope/selection ABA, Chinese/English narrow views and 150% zoom.
  `outputs/qq-preparation-recovery-freeze-20261106-ui.json`.
- Integration review found an older **healthy-component repair** mismatch:
  the real coordinator returned an epoch-millisecond `expiresAt`, while the
  renderer and old fixture expected an ISO string. Previous fixture passes did
  not prove this real contract. The renderer now accepts only the numeric
  production field; the updated fixture passes an actual `QQComponents` preview
  result into the renderer and rejects ISO values. **23 checks / 7 screenshots**
  passed: `outputs/qq-component-repair-contract-20261106-ui.json`. Earlier test
  receipts remain historical evidence, not corrected results.

The earlier synthetic-archive test and production-DOM screenshots remain
separate from the later actual packaged interaction. None proves recovery of a
damaged existing installation, QQ login, or a successful retry from the actual
desktop drawer. No real account was used in the recovery operation.
