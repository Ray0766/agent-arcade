# Manual QCE chat exports

The same-window source adapters cover **QCE 5.5.77 and 6.4.2** with
**NapCat 4.18.42**. The old Shell/Node baseline is retained; 6.4.2 requires the
fixed managed Shell launch and [startup checks](QQ_QCE.md#fixed-642-startup-boundary).
The new Rust process has not been run against a real account. The flow reuses the
optional plugin's [separate encrypted token](QQ_QCE.md), not an AI API key.
No exporter code is copied into or bundled with Agent Arcade.

## Use

1. Select the companion and open **QQ accounts → Local components → Manage
   plugins**. Read the installed list and choose QCE's **Export chat history**.
2. Opening shows local records only. If QCE has not been configured, use the
   existing QCE token setup. Existing Claude, GPT and DeepSeek keys stay saved.
3. Explicitly read a page of friends or groups. Choose an observed conversation,
   a time range, JSON/TXT/HTML/Excel format and any desired resource downloads.
4. Preview the exact target and options, then confirm once. The exporter writes
   into a separate operation folder beneath its current export directory.
5. Check the recorded task's progress. When it reports completion, choose
   **Save export file…** and a destination in the native save dialog. A successful
   save reports independently read-back local bytes and SHA-256.

Cancellation has its own preview and one submission. Closing the view stops
local observation or transfer; it does not cancel a running upstream export.
Removing a local record does not cancel a task or delete its exported files.
No automatic export, schedule execution or startup polling is added.

## What each result means

- **Request accepted:** a valid create response was recorded locally. It does
  not prove completed export or durable upstream task storage.
- **Outcome unknown:** the request may have taken effect. It is not retried.
  Without a received task ID the app cannot recover the task by matching names
  or searching shared history.
- **Completed:** the exporter reports completion. Resource failures or an HTML
  ZIP fallback may still have occurred; no file has yet been saved by the app.
- **Saved locally:** the transferred file was published and read back at the
  chosen destination. Its hash proves those bytes, not the completeness or
  semantic accuracy of the chat export.
- **Cancellation acknowledged:** the upstream handler replied. Its later
  parsing, resource or file-writing stages may still continue; this is not a
  settled-process guarantee.

HTML ZIP output can fall back to a plain HTML file. JSON, TXT and Excel may have
resource sidecars: downloading the main file does not include all sidecars.
HTML exports are saved as files, never rendered or executed inside the app.

For 6.4.2, creation is acknowledged as **queued**; cancellation must return the
matching complete cancelled task. Neither establishes that every upstream write
has stopped. New records also bind the fixed plugin version. After switching
versions, old records can be viewed or forgotten locally, but cannot be queried,
cancelled or downloaded through the other version. No task is recreated. These
shapes come from the fixed [export handler](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/api/routes/messages.rs)
and [task handler](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/api/routes/tasks.rs).

## Ownership, recovery and bounds

The selected account is checked against both the managed NapCat instance and
QCE. Requests use only the fixed owned loopback listener and reviewed routes.
The app retains encrypted creation records scoped to the profile, actual QQ,
work directory identity and saved QCE credential revision. Only those recorded
task IDs can be observed, cancelled or downloaded. Global upstream task history,
arbitrary download URLs and renderer-supplied output paths are not used.

After restart, records do not automatically execute anything. An interrupted
attempt stays uncertain until an explicit observation is possible. Replacing or
removing a token changes the credential-store revision; old records are not
silently rebound, including when another saved QCE token changed that shared
revision. Their same-account/work-directory local summaries remain removable,
with observation and downloads disabled. Up to 64 creation records are retained;
explicit local removal frees space without changing upstream tasks. Records
from a different actual QQ or work scope remain inaccessible in that view.

Target pages contain at most 100 entries, with at most 100 pages. A request spans
at most 366 days; downloads are limited to 128 MiB. These bounds do not impose a
message-count or memory cap on the upstream exporter, which accumulates message
data. Dense histories and resource downloads can therefore remain expensive.

QCE's settings/task storage is shared by the operating-system user. Checking
identity before and after requests is not an atomic account snapshot. Separate
operation folders avoid ordinary filename collisions but do not exclude external
file changes or filesystem links. The upstream download route supplies no
immutable hash, so a matching local SHA is not a remote snapshot guarantee.
Authenticated reads may update upstream access bookkeeping. The app's loopback
destination does not prove that QCE's own listener is exposed only locally.

## Validation boundary

The source uses real temporary SQLite/files and isolated loopback HTTP with
synthetic identities, credentials and exporter responses. An owned child exit
after durable admission has been reopened without a task replay. These are
component and integration checks, not actual QQ chat-history export acceptance.
Production-renderer and final package evidence are recorded in the
[current scope](ACTIVE_GOAL.md). Real installed-QCE export, resource completeness,
cancel behavior and account recovery remain in the consolidated test stage.

The fixed contract comes from the upstream [API/export/download handlers](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/api/ApiServer.ts),
[task persistence](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/core/storage/DatabaseManager.ts)
and [message fetcher](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/core/fetcher/BatchMessageFetcher.ts),
reviewed on 2026-11-07 against the pinned release artifact. Original
[account-bound scheduled exports](QQ_QCE_SCHEDULES.md) reuse this creation and
ownership path and still require 5.5.77. [Native shared plans](QQ_QCE_NATIVE_PLANS.md)
and [access rules](QQ_QCE_ACCESS_RULES.md) have separate two-version adapters.
Real installed-QCE exports, cancellation and download acceptance remain pending;
older 5.5.77 component results are not 6.4.2 runtime evidence.
