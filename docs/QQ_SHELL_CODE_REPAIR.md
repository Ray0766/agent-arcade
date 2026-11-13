# Fixed-version Shell code repair

This implementation restores the prepared **NapCat Shell 4.18.42** code from
the remote host's verified local official cache. It retains the original code
tree and keeps installation records, version selections and account-data paths
in place. It does not upgrade QQ, update to a different Shell version, reinstall
an account, download an archive, or stop/start a process automatically.

The optional supervisor owns this operation. Local accounts do not need a
supervisor merely to run. The recovery code and desktop controls are included
in the local preview; the operated package and actual acceptance are recorded in
[the current scope](ACTIVE_GOAL.md).

## Entrance and prerequisites

Open **QQ accounts → Remote instances → Remote QQ process → Repair component**.
Opening the section is local; **Inspect component** contacts the selected
supervisor with its separate saved credentials. Existing AI keys are unchanged.

The administrator enables `componentRepair.enabled` in the supervisor's
[configuration](../deploy/qq-supervisor/config.example.json). This is off by
default and independent of process Start/Stop permission. The service fixes the
component store, setup and lock locations. Desktop requests cannot supply a
path, archive, URL, version or command.

All installations in the same component store share the fixed code. Explicitly
stop those instances before preparing a repair. Existing leases, a running
manager, matching QQ processes, uncertain process observations or unresolved
maintenance records block replacement. A normal QQ client using the same QQ
executable may also block it; this does not authorize terminating that client.

The fixed cached `NapCat.Shell.zip` is 35,967,555 bytes, SHA-256
`02e5ff0f79916c1e04c81c1b4590056406fb4293f1f1300c955e71fd08b2829d`.
The prepared manifest and descriptors must still be verifiable. Missing or
changed metadata is not reconstructed from a damaged code directory.

## Inspect, prepare and confirm

1. **Inspect component** reports healthy, damaged, missing or unsettled code,
   cache availability, stopped-state evidence and the shared installation count.
2. Damaged or missing code with verified prerequisites offers **Prepare repair**.
   Preparation extracts the cached archive to a separate owned directory and
   verifies every file against the pinned manifest. It does not replace live
   code. Healthy code has no repair action.
3. Review the shared scope and retained-original behavior. **Repair component
   code** uses a one-time preview; the current metadata, process state and shared
   lock are checked again before publication.
4. The result states whether code changed, whether full readback succeeded and
   whether recovery or resource cleanup remains. Code verification does not
   establish QQ sign-in, AI connectivity or task success.

Existing code is moved to the operation's retained tree before the verified
replacement is published at the original path. Descriptors, prepared manifests,
selection files and work/data locations are not rewritten. Account-data
contents are not read, imported or claimed to have been exhaustively audited.

## Interrupted work and connection loss

The service durably records an operation before file publication. The desktop
also saves the request ID before submission. **Query original operation** asks
about that same request; it does not run the replacement again. Restarted
attempted records become unknown rather than being automatically retried.

**Inspect component** lists only the recovery decisions supported by the actual
original, staged and live file identities: retain an unused preparation, complete
the verified stage, restore the retained original, or settle an already verified
publication. An original tree can itself be damaged; restoring it is not a claim
that it is healthy. Changed or unproved identities remain blocked. Normal start
and shared preparation paths respect a pending repair barrier.

**End preview and go back** releases owned staging handles and invalidates the
ticket; staged files and records remain for explicit settlement. Closing the
desktop view does not undo an accepted operation or assert that remote staging
has been removed. There is no background automatic replay or deletion. Retained
records are bounded at 16 and 8 GiB; the app does not automatically evict them.

A known file result survives a later local connection-close failure. Its original
request remains pending with the known receipt. Close the view to retry owned
connection cleanup, reopen it, and query that request. Ending local recovery
retains the unknown receipt; it does not undo remote code or remove its startup
barrier.

## Verification boundary

The original official archive was exercised on an isolated NTFS installation:
684 files / 114,884,405 bytes were restored and fully checked, with the damaged
original, two installation descriptors and synthetic data sentinels retained.
One specifically created inert process blocked the repair while alive, exited
itself, and was independently observed absent before repair proceeded. This
seven-check probe used only that created process for inventory; it does not
prove all processes on a real host were stopped. Preparation took 41.375 seconds
and confirmation 29.905 seconds within the unchanged 120-second budget.

Separate transaction, gate, metadata, HTTPS/SQLite, desktop and renderer checks
retain their individual evidence. Synthetic process facts, temporary component
trees and renderer fixtures do not accept a real remote deployment, user's
damaged installation, QQ login or OS-crash recovery.

The integrated local preview passed 325 targeted checks, 42 syntax checks and
784 stable inputs; the production renderer passed 13 checks with five images
and 94 stable inputs. The package matched 382 source files from 389 build
inputs, its isolated smoke passed, and the service assembly matched 58 files.
This is not a new full-suite run. Original-profile use passed eight checks with
ten images, including a prior-package baseline: account restoration, empty
remote registration, a blank form and cancellation, settings retention and
normal closure. No real supervisor was registered or contacted. Official NTFS,
HTTPS/SQLite and renderer evidence remain separate from real remote acceptance.
