# Account-bound QCE export plans

Agent Arcade can schedule exports through the separately installed QCE 5.5.77
plugin on a managed NapCat 4.18.42 instance. This is an original local scheduler;
it does not create, adopt or enable QCE's own shared scheduled-export records.
Existing AI keys, QQ sign-in and the independent [QCE token](QQ_QCE.md) are unchanged.

**This account-bound scheduler remains 5.5.77-only.** The 6.4.2 adapters for
manual exports and native shared plans do not enable background dispatch here.
With 6.4.2, the connection is rejected before an automatic export request; local
list, pause, removal and run-history actions remain available.

## Use

Open **Manage companions → the selected QQ companion → Scheduled exports**.
The same editor is available in **QQ accounts → Local components → Manage
plugins → active QCE → Scheduled exports**. It stays inside the main window.

1. Choose **New plan**, explicitly read friends or groups, and select the target.
2. Set a name, daily/weekly/monthly time, IANA time zone, export format, and the
   number of elapsed days to include. Resource downloads are off by default.
3. Preview and save. A new or edited plan is **paused**.
4. Preview **Enable** separately to authorize future exports while this app is
   running, or choose **Run once** for one export. The preview fixes that run's
   time range; confirmation does not silently shift it.
5. Open local run records. A received creation acknowledgment is not completed
   file generation. Use the linked [manual export records](QQ_QCE_EXPORTS.md)
   to explicitly check progress, cancel a known task or save its result.

The window may be minimized and another companion selected. The app and the
correct QQ/QCE instance must still be running. Closing the app, shutting down
the computer or stopping QCE prevents future local dispatch. Closing just the
plan editor does not pause enabled plans.

Local list, pause, removal and run history remain available when QQ is offline
or the QCE token was removed. These local actions send no QCE request. Creating,
editing, enabling and running require the correct live account and plugin.
After credential revision changes, old plans can be paused or removed, but
cannot be silently adopted by the new credential; create a new plan explicitly.

## Time and recovery

- A plan follows its selected IANA zone, independently of the computer's display
  zone. Weekly plans select ISO weekdays; monthly plans select a day number.
- A missing local time during a clock jump is skipped. A repeated local time
  runs only at its first occurrence. A missing month day is skipped.
- The supported calendar is 2000–2099, using the bundled runtime's ICU time-zone
  data. Future government time-zone changes may require a runtime update.
- A lookback of seven days means the previous **7 × 24 hours** ending at that
  occurrence. It does not mean the previous calendar week.
- A five-second timer admits one operation at a time. A due slot over one minute
  late is skipped; restart advances old cursors without backfilling them.
- Each occurrence is durably claimed before an export request. Interrupted or
  unknown submissions are not automatically replayed. Clearing run history
  does not reset the scheduled high-water mark.

Records use a separate encrypted SQLite store: at most 16 plans and 128 run
records, plus the manual export journal's 64 creation records. Capacity errors
stop admission. Explicitly remove local history to free space; this does not
delete upstream tasks or exported files. An inactive interrupted claim can be
explicitly forgotten as uncertain, never relabelled as definitely unsent.

## What the status proves

**Saved** means the local plan was committed and read back. **Accepted** means a
validated QCE create acknowledgment and task identity were retained. Neither
status proves completed export, resource completeness or a verified local save.

Pause/remove stops future plan dispatch and invalidates pending local work.
It does not revoke a request already received by QCE or guarantee that file
writing stopped. Late replies cannot recreate a removed plan. Every run checks
the actual QQ, selected target page, output settings, credential revision and
owned listener again. Those checks and QCE's subsequent execution are not one
atomic account snapshot; a native account switch can still race a request.

QCE still owns shared OS-user settings and export storage. Each Arcade export
uses a separate operation directory, but this is not a filesystem sandbox or
an immutable snapshot. Upstream memory use and resource-download cost remain
subject to the [manual-export limits](QQ_QCE_EXPORTS.md).

## Validation and remaining work

The implementation is exercised through production main/session/client code,
temporary encrypted SQLite databases and isolated HTTP services with synthetic
identities. A real child-process exit preserves an uncertain claim without
replay. The recurrence cases also run in the actual bundled Electron runtime.
These checks do not accept installed-QCE scheduling on a real QQ account.
Final UI/package evidence and the current running version remain in the
[active delivery record](ACTIVE_GOAL.md).

The separate [native shared-plan manager](QQ_QCE_NATIVE_PLANS.md) is implemented
in source; it does not alter this account-bound scheduler. Arbitrary cron
expressions, previous-calendar day/week/month windows, incremental backup,
token rotation/revocation and 6.4.2 support for this account-bound scheduler
remain separate unfinished capabilities. The [access-rule editor](QQ_QCE_ACCESS_RULES.md) has its
own bounded implementation and pending real-plugin acceptance. No native
plan was changed by implementing this local scheduler.

The fixed upstream comparison used the official
[scheduler](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/core/scheduler/ScheduledExportManager.ts),
[API handlers](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/api/ApiServer.ts)
and [persistence](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/core/storage/DatabaseManager.ts),
reviewed on 2026-11-07. Thirteen isolated actual-component checks confirmed
important shared-account, timing and in-flight deletion limits; they used
synthetic dependencies and did not initialize a live plugin.
