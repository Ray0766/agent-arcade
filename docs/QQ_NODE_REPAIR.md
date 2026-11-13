# Repair managed Node components

Source integration, 2026-11-07. This repairs the code of an existing managed
Node installation at the **same fixed NapCat version, 4.18.42**. It is separate
from [creating a complete Node installation](QQ_NODE_SETUP.md) and from the
[Shell component-selection recovery](QQ_COMPONENT_REPAIR.md). It does not
upgrade versions, restore an account database or start QQ.

## Open and inspect

In the existing main window, open **QQ accounts → Local components → Manage
component versions → Repair this version**. The Chinese entrance is **QQ 账号
→ 本机组件 → 管理组件版本 → 修复同版运行组件**. Select **Check repair requirements**
(`检查修复条件`); opening the drawer alone does not download or repair anything.

Missing or damaged runtime code can remain inspectable when its managed
installation descriptor and original prepared manifest are valid. This does
not bypass normal startup checks. Damaged metadata, an unknown installation,
unverified paths or an unresolved conflicting operation cannot be treated as
a healthy repair source. Already healthy components need no repair.

The check identifies installations sharing this code inside the selected
component store and shows known registered companions. This is not an inventory
of every external installation. All QQ processes using the shared code must be
verified stopped before replacement; the application does not stop them for
you. Close NapCat Desktop as instructed if it is also managing the components.

## Prepare, preview and confirm

**Download and check this version** explicitly prepares the pinned
`NapCat.Shell.Windows.Node.zip` source. It may download 118.4 MiB when no verified
cache is available. Preparation checks the archive and complete file manifest
without replacing active code. The fixed source and license boundary are
described in [Node setup](QQ_NODE_SETUP.md#fixed-upstream-package).

Review the shared scope and preservation details, then select **Repair this
version** once. A single-use confirmation expires after five minutes. The
operation repeats identity, stopped-process and integrity checks before making
the first live code change.

Only runtime code is replaced. The original code tree, when present, is
retained; a missing original cannot be presented as a backup. Installation
descriptors, the original prepared manifest, work-directory selections and
account-data directory identities are preserved. The repair does not read
account-data contents, migrate login data or prove that all account databases
are healthy. Related component operations share a gate; arbitrary external
programs are not thereby prevented from changing files.

## Results and interrupted operations

The result separates confirmed code replacement and full readback from an
unknown outcome or a known write whose final verification is incomplete.
Unknown work is not automatically retried. Inspect its record before choosing
an available recovery preview:

- **Complete this repair** publishes the already verified prepared tree from
  an eligible interrupted state.
- **Restore original code** returns the retained original tree. It may still
  be damaged; restoration is not a successful repair.
- **Verify completed operation and finish** verifies the original result and
  finishes an interrupted cleanup without replacing code again. The original
  outcome remains a repair, restoration or abandonment; cleanup does not turn
  restored or unchanged damaged code into a healthy repair.
- **Abandon this repair** leaves current code as it was, including existing
  damage or absence, and retains the unused prepared copy in history. It does
  not delete that copy or repair the original damage.

Only decisions supported by the observed physical state are offered. Pending
live-code recovery continues to block startup until resolved. Closing or
cancelling revokes unused confirmation and waits for owned work to settle; it
does not undo a committed replacement. If cleanup is unconfirmed, the drawer
keeps an actionable Close retry rather than reporting successful closure.
Changing account or installation invalidates the old panel and its tickets.

## Retained code and storage

Expand **Retained code and storage** (`保留代码与空间`) to review eligible completed
records. Removing retained code requires a separate preview and confirmation
and cannot be undone. It never removes current runtime code, the original
manifest, installation descriptors or account-data directories. An abandoned
prepared copy is removed only through this separate action.

Storage is bounded to 16 records and 8 GiB, including prepared and retained
trees. There is no automatic deletion under storage pressure. An interrupted
history cleanup keeps its own record; **Review remaining cleanup** permits
only an explicitly confirmed continuation of that cleanup. It does not repeat
the live code repair.

## Verification boundary

The final UI checkpoint passed **17 checks with 14 inspected screenshots**,
including Chinese/English 430 px layouts, keyboard focus and reduced motion.
Fourteen lifecycle/state cases used the production renderer, coordinator and
ownership panel with a synthetic helper. Three additional flows used the
production repairer, OS gate and history code with real temporary NTFS objects:
damaged-code replacement followed by explicit retirement; missing-code
preparation followed by abandonment and separate retirement; and a persisted
abandonment whose pending-marker cleanup failed, then was explicitly settled
without creating live code. Their archive and
expected-manifest bytes were explicit synthetic seams. The adjacent
pending-update UI checkpoint passed 15 checks. No live account or installed QQ
component was changed by these UI checks.

A separate final official-archive component probe passed five cases on
temporary NTFS objects: full pinned preparation, two-installation gate
exclusion, an owned inert bundled Node process blocking repair, actual child
exit followed by explicit reconciliation, and recovery of missing code. All
704 official files were checked; the retained damaged tree received a separate
full readback. Source hashes stayed fixed and owned child exits were confirmed.
The process host observed only the probe's own PIDs. No QQ entry point, real
account, authentication or external network request was part of that probe.

The integrated package passed 3,590 regression checks with one existing opt-in
skip and no failures, 590 syntax checks, and source identity for all 292 bundled
source files. Its disposable-profile desktop smoke passed after the existing
single-window owner exited normally. This establishes packaged desktop behavior,
not a repair of the user's installed QQ environment. Real Node login, messaging,
clean-machine use, every possible power-loss phase and cross-version migration
remain separate and unaccepted.

The original nine-feature human gates remain **unfinished**: public-journal
audience exclusion, suppression of a known remaining unsent bubble queue, and
hands-free spoken interruption. This repair does not satisfy any of them; see
the [consolidated test stage](COMPANION_TEST_STAGE.md).
