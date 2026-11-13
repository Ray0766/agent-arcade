# Inspect and clean up a previous local QQ runtime

Implemented in candidate `single-window-pending-orphan-20261107`, 2026-11-07.
The packaged application passed isolated desktop smoke and opened with the
original profile, where saved encrypted credentials were recognized. The owner
stopped Computer Use with Escape during **Start and connect**; the click's result
and actual QQ/AI reconnection remain unverified. The existing launcher has not
been changed. Actual user-account orphan recovery has not been exercised. See
[current delivery scope](ACTIVE_GOAL.md) for the complete delivery boundary.

## When this entrance applies

An application crash can leave a recorded QQ child running after its launcher
and previous manager have exited. A pending component update must still prevent
a new startup. It must not force users to kill unrelated QQ processes to clear
this previous run.

For an affected account, open its management panel in **QQ accounts** and choose
**Inspect remaining processes** when offered. The application first proves the
original installation and the recorded process identities. The next confirmation
shows a count of verified remaining processes. Confirming affects only that
verified set; it does not start QQ, remove an update plan, log an account in, or
connect an AI. Existing encrypted API credentials are retained.

The new pending-update branch requires an installation-bound managed Shell v2
ownership record. Old records, another installation, Node records and ordinary
QQ do not acquire this authority. A changed process identity, unknown descendant
or uncertain previous manager remains blocked. The existing healthy-installation
cleanup path remains separate.

## Cancel and partially completed cleanup

A preview is temporary and single use. Cancel, closing the panel, changing
profiles or hiding the window retires its confirmation. If an inspection finishes
after its panel closed, its returned confirmation is discarded. A stale
confirmation cannot consume a newer one. Concurrent inspection requests remain
serialized; the second receives a busy result.

Cancellation before the native stop call prevents that call. Once stopping has
begun, closing a panel cannot undo it. The result therefore distinguishes:

- How many selected process identities are independently confirmed absent.
- Whether the exact ownership record was removed or remains unverified.
- Whether this operation's coordination resources are confirmed closed.

Process absence does not prove what caused each exit. A response missing after
submission is not proof of no effect. No uncertain result is automatically
replayed.

If a cleanup has retained resources, a later inspection can offer a separate
settlement with **zero new process terminations**. It retries only those exact
resources and observes the recorded processes again. If processes remain, their
record stays and any further termination needs another verified preview. Only
confirmed process absence, exact record removal and resource closure count as
complete cleanup. The separate update plan can still block startup afterward.

## Remaining boundaries

Three actual Windows process cases passed using original inert programs and
synthetic installation metadata. The default launcher was started through the
production path, its manager exited abnormally, and the separate product cleanup
ended only the proved recorded child. Real helper-produced two-link update
records were retained, and unrelated-process/other-installation attempts were
rejected. All 11 created test process identities were independently absent at
the end. These are native process results, not QQ protocol or login acceptance.

The production UI/main/Console/runtime flow passed 15 checks with 12 inspected
images, including an actual default-spawn crash chain. A later display-only
correction hid QR/quick-login controls for the pending orphan capability; its
two checks and three images passed without repeating native termination. Normal
login controls and existing typography were retained. After a partial result,
the first real status change can retire the old preview; two subsequent stable
status reads were checked to keep a newly issued settlement preview usable.

The final uninstrumented whole regression passed 3,936 checks, one original
opt-in skip and zero failures in 275,020.9702 ms. All 674 declared input hashes
were stable. It includes ten native inert-process cases and independent absence
checks for all 31 created identities. Syntax passed for 658 JavaScript files;
the separate service suite passed 58 checks. Package identity covered 322 source
files, two notices, 11 metadata fields and three unpacked resources. Existing
style, typography and approved voice assets were unchanged.

The first full run's three failures and the diagnostic full run's one failure
remain preserved. A test-only gate now isolates three suites that inspect the
same OS process inventory; the captured diagnostic refusal was correlated with
a concurrently exiting test launcher. This did not weaken product predicates
or change case budgets. It does not explain the earlier ordinary-start or
preview failures, whose causes remain unknown. Passing isolated repeats are
not presented as diagnoses.

This is a local entrance. The remote supervisor's existing Start, Stop and Recover
operations do not implicitly authorize orphan termination. A separately enabled
[remote extension](QQ_REMOTE_ORPHAN_CLEANUP.md) is now integrated in source for
typed pending-installation and retained-inspection-resource previews. The legacy
healthy-installation contract and actual remote-host acceptance remain unfinished.

A failure while acquiring inspection resources, before any process set was
identified, retains its exact resource owner. In the operated pending-orphan
candidate above, retry is limited to manager close, whose failure remains
visible. The following source increment adds a dedicated same-window action;
it is not part of that candidate or the acceptance counts above.

An abrupt crash before durable runtime proof, unproved recovery guards, actual
user-installation recovery and long-term QQ login stability remain separate
limitations. Isolated tests do not establish real QQ messaging, remote-host
operation or the deferred human voice/audience acceptance gates.

## Settle an incomplete inspection

The current source offers **Settle previous inspection** when an inspection
retained its own coordination resources before selecting any processes. Open
the affected account's management panel, inspect the resource-only preview and
confirm once. A failed resource close is shown as unconfirmed; an explicit new
preview can retry the remaining captured resources. Cancel leaves those resources
held and discards only the confirmation.

This action neither terminates QQ processes nor deletes their ownership records
or component-update plans. It does not disconnect another companion, close the
runtime manager or start QQ. There is no process count because no process set
was established. Unavailable process/login observations remain unknown. The
entry still works if unrelated account metadata cannot be read; authority comes
from the exact resource owner retained in memory, not from a guessed file path.

After confirmed closure, the panel displays the known result and offers an
explicit state refresh. It invalidates older in-flight reads without making a
new bridge request. A later successful page refresh can restore the ordinary
inspection entrance; closing resources alone does not establish process absence.

Bounded validation includes 56 core checks using real temporary Windows files,
descriptors and servers with injected faults, plus the independent 58-check
service suite. Eight production-DOM/main/Console/runtime checks and seven viewed
screenshots cover preview, cancellation, partial closure, retry, narrow-window
keyboard use and refresh races. QQ process inventory and connected services in
that renderer flow are synthetic. A separately labelled same-fields periodic
refresh case uses a simulated backend observation. These checks do not accept
an operated Electron package, a real user recovery or any new QQ login flow.

The prepared `single-window-inspection-resources-20261107` package contains this
increment. Its final standard regression passed 3,957 checks, one original
opt-in skip and zero failures, with 677 input hashes unchanged; 661 JavaScript
syntax checks and complete source/resource package identity passed. It has not
been started or desktop-smoke-tested. The original desktop launcher remains on
the preceding pending-orphan candidate. The first run's two native test failures
are retained separately; a fixture cleanup repair and a later passing recovery
check do not establish their original causes. See [current scope](ACTIVE_GOAL.md).
