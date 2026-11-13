# Recovering a QQ runtime after an application crash

Use **QQ accounts → Recover management** for the affected account. This is
separate from logging in to QQ or reconnecting an AI. The app checks the previous
manager and recorded QQ process identities before changing ownership.

| Observed condition | Application behavior |
| --- | --- |
| The previous manager is still running | Keep its ownership; do not start a duplicate. |
| The exact recorded launcher and process tree survive | Explicit recovery may adopt that tree after rechecking its identity. Its management endpoint and QQ online state still need separate verification. |
| Every recorded process has exited, with no unknown descendants | Clear the dead ownership record. Starting QQ remains a separate action. |
| The launcher exited but verified descendants remain | Offer **Inspect remaining processes**, followed by an account/count preview and a separate **Clear these remaining processes** action. |
| A process identity changed, a parent chain is incomplete, or an unknown descendant exists | Preserve the record and refuse cleanup or duplicate start. |

## Verified residual cleanup

The preview performs no process termination. Confirming it stops only the exact
saved QQ/console processes that still match their PID, creation time, executable
and verifiable parent chain. The main process retains their Windows process
handles before stopping any candidate. The renderer cannot submit process IDs,
paths or arbitrary commands.

The confirmation binds the saved record's bytes and file identity, current
processes, installation and account. Changed records require a new preview.
The previous manager and launcher must be gone; competing managers, unknown
processes and configuration/recovery locks block the operation. A v1 record
without enough parent-chain evidence cannot be guessed into a valid cleanup.

After validation, affected companion connections are disconnected before
stopping the old background. Other identified accounts remain connected. The
old ownership record is removed only after all its descendants are confirmed
gone. Login files, OneBot configuration, model credentials and memories are not
deleted or rewritten. Choose **Start QQ**, then connect the companion when QQ
is actually online. Cleanup never starts a background or sends a message.

If stopping is partial or uncertain, the record remains and the old confirmation
is consumed. Inspect again; do not launch another QQ over it. If cleanup finished
but refreshing status failed, the interface retains the confirmed cleanup result
and asks for a refresh instead of suggesting the cleanup never happened.

## Evidence and limits

The 2026-11-06 continuation also reproduced a dead QQ worker PID reused by an
unrelated later-started program and its sole System32 console host. Explicit
Shell **Recover management** now permits metadata-only cleanup in that narrow
case: the old launcher must be absent; both later identities, executable paths,
parent relationships and creation times are independently checked; unknown
descendants still block cleanup. No foreign process is adopted or stopped.
Automatic reconciliation, normal stopping and the Node recovery route do not
use this exception. In the actual diagnostics-recovery package, the old record
was removed and both foreign process identities remained unchanged. Private
read-only receipt: `outputs/qq-foreign-recovery-live-20261106.json`.

A real test terminated only the exact retained handle of the packaged main
process. The launcher exited but five original QQ/console descendants survived.
The previous app correctly refused adoption and duplicate startup. The new
source preview recognized those five processes without stopping any. Private
receipts: `outputs/qq-crash-live-after-20261106.json` and
`outputs/qq-crash-live-source-preview-20261106.json`.

The new packaged flow passed on that exact scene: the app previewed five
residual processes, an explicit confirmation cleared them, and independent
inspection found all six original process identities gone (the launcher had
already exited). All 15 preexisting ordinary QQ process identities remained.
A separate Start brought Whale back online without a scan; independent actual
account, online and good checks passed. All three OneBot configuration hashes
and the component selection stayed unchanged. Private summary:
`outputs/qq-crash-live-summary-20261106.json`; packaged UI screenshots are linked
there. This is crash → verified cleanup → separate restart acceptance, **not**
adoption of a surviving launcher or a new model/chat acceptance.

Synthetic tests cover stale/PID-reused/incomplete trees, partial cleanup,
unknown late descendants, other-account isolation and close races; they are not
real crash recovery acceptance. This flow does not prove that Tencent will keep
a login valid, or that a surviving live launcher can be adopted on every system.

Component installation locks are separate. Explicit, proof-bound recovery for
eligible operation records is described in [component recovery](QQ_COMPONENT_RECOVERY.md);
unknown legacy records remain untouched by account cleanup. The managed Node
route has its own bounded [application-crash observation](QQ_NODE_SETUP.md#application-crash-observation):
the entire recorded Node tree exited, so only dead-tree lease recovery was
exercised, not surviving-supervisor adoption.
