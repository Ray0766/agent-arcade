# Native QCE shared schedules

This distinct manager has source adapters for QCE **5.5.77 and 6.4.2** on owned
NapCat **4.18.42**. Version 6.4.2 requires the fixed managed Shell launch and
[startup checks](QQ_QCE.md#fixed-642-startup-boundary); its Rust runtime has not
yet been accepted on a real account. It targets QCE's shared scheduled-export records.
It does not adopt, migrate or replace [Arcade's account-bound plans](QQ_QCE_SCHEDULES.md).
The existing saved QCE token is reused; model API keys are unrelated.

## Entrance and complete flow

Open **QQ accounts → Local components → Manage plugins → active QCE → QCE
shared schedules**. The child view stays in the main window. Local credential
status is separate from the explicit server read.

The flow covers listing, inspection, creation, editing, enabling/disabling,
removal, one-plan execution, execution history and native **Run all**. New plans
default paused. Existing unknown fields are retained in the main process;
editing a known option must not erase other option members. Unsupported legacy
definitions must remain identifiable and manageable where the fixed API permits,
rather than silently normalized into a different plan.

New or changed targets come from an explicitly read current friend/group page.
Raw native IDs and peer UIDs stay private to the main process. A current QQ
check authorizes the management connection; it does not prove an old shared
plan belongs to that QQ, or bind a future native run to that identity.

Preview one intended change before confirming it once. A refresh, account or
credential change, dismissal or close invalidates old drafts. Native requests
have no idempotency key: an unknown create or trigger is never retried or
attributed to another record by matching names or timestamps.

## Native timing and export options

The implementation retains daily, Monday-weekly, first-day-monthly and custom
plans; JSON, HTML and TXT; native time ranges; format-specific resource/export
options; and explicit per-plan output-directory control. Output paths are
confined to this foreground editor and preview, not global snapshots, model
context or logs. A selected directory is not a sandbox or overwrite guarantee.

Native custom cron has a limited five-field grammar: integers, `*`, comma
lists and `*/n`. It does not implement numeric ranges, names, seconds or the
full syntax of a general cron library. Sunday is **7**; day-of-month and
weekday are **AND**. Step matching uses the field's actual value modulo `n`.
Existing nonconforming expressions must not be advertised as valid schedules.
The 6.4.2 parser additionally requires unsigned 32-bit numeric fields and a
nonempty expanded set; older permissive steps are not silently accepted.

QCE matches its process-local clock. Its supplied timezone argument is ignored,
and the actual IANA timezone is not exposed. Weekly is Monday and monthly is
day 1; a reported `nextRun` is not an authoritative countdown. Repeated DST
times may run twice, missing times may be skipped, and no durable occurrence
claim or catch-up is provided.

Native time ranges also have limits. “Last week” starts at local midnight
seven days ago rather than the previous Monday. “Yesterday” uses 24 elapsed
hours from the previous local midnight. In 5.5.77, “Last month” can overflow
short months when subtracting the month; 6.4.2 uses the previous calendar month.
Last 7/30 days are elapsed windows; custom ranges are relative seconds evaluated
when execution starts. Incremental backup is not added by this adapter.

For 6.4.2, unused cron/range fields are omitted rather than sent as null. An
update can leave old inactive fields in upstream storage; the UI does not claim
they were deleted. Run-all uses the reported triggered count, still only a queue
acknowledgment. Arcade keeps its 128-plan read/preview bound and refuses an
oversized response instead of truncating it, even though QCE supports more.
These differences follow the pinned [routes](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/api/routes/scheduled.rs),
[cron parser](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/scheduler/cron.rs) and [scheduler](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/scheduler/manager.rs).

## Requests, execution and results

Enabling a native plan authorizes QCE's own scheduler. It can continue after
the Arcade window or app closes, while QCE remains running; later execution
uses whichever QQ the native core then holds. Multiple QCE processes sharing
the same OS-user storage can load the same plans.

One-plan **Run** can run a paused plan and waits for a native execution-history
response. A bounded wait or closing the view stops local waiting, not QCE's
export. A received native `success`, `partial` or `failed` report is separate
from verified bytes or a local save. Success with zero messages may have no
file. Raw paths, error details and failed-resource samples are not projected
from history.

**Run all** means all eligible shared plans when QCE receives the request,
optionally including paused plans. The preview list/count is an observation,
not an immutable selected set. The immediate response acknowledges a queue,
not completion. Each all-queue is sequential internally, but other queues,
timers and individual triggers can overlap.

Disabling or removing a plan does not cancel a running or captured queued task.
An older execution can save its captured definition after an edit or removal,
including restoring enabled state on reload. Matching current readback does
not prove durable deletion or pause. The native API has no running-job
inventory, cancellation endpoint, compare-and-swap or durable-save receipt.
The app does not issue automatic repair writes or pretend to stop that work.

History records are not manual-export task IDs and cannot be passed into the
existing owned-task download flow. Verified per-run native output download
needs a separate provenance/snapshot contract or an explicitly selected file
with weaker attribution. It remains unfinished rather than fabricated.

## Evidence and unfinished acceptance

The following is historical **5.5.77** evidence, not a 6.4.2 runtime result.
The fixed official [API](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/api/ApiServer.ts),
[scheduler](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/core/scheduler/ScheduledExportManager.ts)
and [persistence](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/core/storage/DatabaseManager.ts)
were reviewed. The preceding 13 isolated component checks are reused without
rerunning them. Seven new independent component counterexamples cover queued
deletion, late old-definition writes, overlapping queues and cron semantics.
They use actual fixed components with inert dependencies and temporary
synthetic files; no real QQ, HTTP request or plugin initialization occurred.

Thirteen new actual-main checks plus seven adjacent suites passed 108/108 over
owned synthetic HTTP. They cover one-use actions, actual-account changes,
credential/foreground ownership, unknown creation, shared run-all and native
history without fabricated download identity. An initial valid partial-history
failure was retained and repaired by projecting only the five public counters;
the same original assertion passed afterward.

The backend passed 22 focused checks and the cron validator seven. The final
renderer passed 16 checks with 13 inspected images, including Chinese/English
430 px views, keyboard controls, unsupported old records, output-directory
choices, unknown results and close/retry. It uses production DOM, session and
client over isolated HTTP; its account, credential store and native scheduler
are synthetic, and it does not run production main. Adjacent access-rule and
account-bound-plan renderer suites passed 16 and 17 checks respectively.

Full regression passed 3,517 tests, with one existing opt-in skip and no failures;
572 JavaScript syntax checks passed. Packaging and the latest operated version
are tracked in the [active delivery record](ACTIVE_GOAL.md). Real installed-QCE
management, scheduled execution, persistence and QQ delivery remain unaccepted.
No actual native plan, running account or saved credential was changed while
preparing this increment.
