# Recover a recorded healthy QQ component

Source integration, 2026-11-06. In **QQ accounts → Local components → Component
versions**, expand **Recover healthy components**, inspect the recovery target,
then explicitly confirm. This restores the component selection; it does not
rewrite the damaged directory, download a replacement or automatically start QQ.

This selection-recovery route remains distinct from the newer
[fixed-version Shell code repair](QQ_SHELL_CODE_REPAIR.md), which replaces actual
code bytes from a verified local cache. A managed Shell with only the one pinned
selection has no different recorded healthy target for this older route; it must
not be presented as successful byte repair.

## Eligible installations

This route is limited to a persisted Shell selection whose current component
is a prepared version and whose recorded previous selection is healthy and
the same version. The current manifest and selection metadata must still be
intact. Missing, changed or additional ordinary code files can qualify.

An original target has the existing **four mandatory files** checked; a
prepared target has its **full manifest** checked. These scopes are displayed
separately. A damaged manifest, unsafe link, changed QQ executable, changed
installation identity, unknown lock, running related process or pending
upstream update blocks recovery. Node components, a damaged original current
selection, missing previous target and cross-version changes are not supported
by this route. None is treated as a reason to bypass a normal startup check.

## What confirmation changes

The main process privately binds a one-use five-minute confirmation to the
current selection, observed damaged tree, healthy target and installation.
The actual expiry uses a monotonic clock. Before changing the selection it
takes the existing installation lock and repeats stopped-process, identity,
integrity and cancellation checks.

Exact prior selection bytes are retained in bounded private history. The new
selection points to the healthy recorded target and has no previous rollback
entry, so the damaged version cannot immediately become the next rollback.
Both code directories, account configuration, QQ program and login data are
preserved. This action never copies login data or starts an account.

Closing or cancelling invalidates the unused repair confirmation. It does not
undo a write that has already committed. A repair-specific dismissal does not
cancel an unrelated component download. Changing the installation invalidates
old results and confirmation tickets.

## Results and remaining limits

The interface distinguishes a confirmed saved selection, a saved selection with
incomplete readback, and an attempted write whose result is unknown. Lock
cleanup warnings remain separate. Unknown results are not replayed; inspect the
current state before taking a new action. The bounded last outcome remains
visible when reopening the drawer, without storing confirmation tickets in
the public application snapshot.

This uses the existing application's component manifests, ownership locks and
selection transaction. It is an independently implemented recovery path; it
does not introduce an upstream auto-updater or weaken ordinary activation and
rollback checks. Full-tree inspection is bounded but synchronous. Locks protect
cooperating Arcade operations, not arbitrary programs writing the same files.
Repeated observations narrow races but are not an atomic filesystem-wide lock.

## Verification

The backend and actual production coordinator were exercised together with
temporary installations: corruption, different file identity despite equal
bytes, changed targets, locks, active processes, expiry, cancellation, preserved
history and ambiguous/post-commit writes. The formal backend and adjacent
regression checkpoint passed **403/403** across ten files;
`outputs/qq-component-repair-formal-regression-20261106.txt` records the run.
These tests do not
damage the user's installation or establish QQ login after recovery.

An independent probe copied the existing verified official Shell package into
a new private temporary installation, then changed only that copy. It read
684 files / 126 directories, recovered the selection, retained the exact prior
selection bytes and damaged copy, and independently matched source files,
manifest, archive, synthetic QQ program and configuration afterward. It took
14.328 seconds and executed no QQ/native code. Receipt:
`outputs/qq-component-repair-official-input-20261106.json`. It used the frozen
draft; promotion changed only a source comment, independently compared with
the formal implementation. This is official-file input with a synthetic
installation/process inventory, not real-account recovery.

The formal production-CSS UI fixture passed **22 checks / seven inspected
screenshots**, including Chinese/English narrow layouts, 150% zoom, different
target verification scopes, unknown outcomes, expiry and selection changes.
Receipt: `outputs/qq-component-repair-painted-20261106-ui.json`. Reproduce with
`node scripts/qq-component-repair-ui-smoke.cjs`.

The frozen `single-window-component-repair-20261106` build matches 148 source
files; 1796 of 1797 checks passed, with one skip. The build has not been launched.
Real recovery
of an already damaged user installation is not yet accepted; a healthy account
installation is not deliberately corrupted for testing. The ordinary
[component switch](QQ_COMPONENT_SELECTION.md), [lock recovery](QQ_COMPONENT_RECOVERY.md)
and [process recovery](QQ_RECOVERY.md) remain distinct operations.
