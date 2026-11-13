# QCE export folders in Agent Arcade

The dedicated source adapter keeps QCE's two default export folders in the
existing plugin-management window. The source adapters support **NapCat 4.18.42**
with active **QCE 5.5.77 or 6.4.2**. The 5.5.77 Shell/Node baseline is retained;
6.4.2 is limited to the fixed official Windows release in an app-owned managed
Shell runtime. Other versions, standalone/remote QCE and SSQQ browser preferences
are outside this editor. Installed 6.4.2 has not yet been run or accepted.

The separate **Export chat history** view now has a source implementation for
manual target/range selection, owned tasks and native file download. See
[manual exports](QQ_QCE_EXPORTS.md) for its distinct actions and acceptance limits.

This is separate from AI connection settings. Existing Claude, GPT and DeepSeek
keys are retained. A QCE access token is only needed when explicitly configuring
this optional plugin; the app does not obtain it from logs, URLs or QCE security
files, and never substitutes an AI key or NapCat management token.

## Fixed 6.4.2 startup boundary

Preparation, installation, upgrade and enablement remain explicit operations;
opening these editors does not perform them. Preparing or enabling QCE does not
grant AI access to its data. A 6.4.2 enable request also needs a verified managed
launch environment; an older/unverified running QQ must be stopped and restarted
normally before enabling it. The app does not perform that restart automatically.

The fixed release starts a separate Rust server. Its API listens on all IPv4
interfaces (0.0.0.0:40653), although Arcade only connects to owned loopback.
This is not a local-only exposure guarantee. The app binds the Rust child and
bridge listener to the same owned QQ launch, uses a non-default bridge port to
avoid upstream's default-port reclaim branch, and rejects occupied ports without
killing their owner. QCE_NO_AUTO_OPEN=1 suppresses the browser opening for this
managed launch; the stored browser preference is not rewritten.

6.4.2 can move old default exports during startup. Before launch or explicit
enablement, the app reads and rechecks the same OS user's user-config.json
and physical paths. It permits only five absent legacy export directories, or
both valid absolute custom export directories. Unknown, linked, malformed or
changed inputs and possible migration are refused. It does not rewrite the
configuration, move old files, or guess Windows Documents from USERPROFILE.
These checks are bounded observations, not a lock against an external writer.

This is not a side-effect-free startup: QCE can initialize its own data and
resume already-enabled native shared plans. Those plans are separate from
Arcade's account-bound scheduler. The contract is pinned to the official
[startup](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/main.rs), [paths](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/paths/mod.rs) and
[scheduler](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/scheduler/manager.rs) at commit eb7d154.

## Entrance and use

1. Select the companion, open **QQ accounts → Local components → Manage
   plugins**, and explicitly read the installed plugin list.
2. For supported active QCE, choose **Export folders**. Opening this child view
   checks only the app's local credential record.
3. If needed, enter QCE's access token and choose **Save separate token**. The separate
   local record is encrypted with Electron safeStorage. Saving does not connect
   or authenticate. The reviewed release generates a 40-character alphanumeric
   token; this editor does not accept arbitrary historical/custom formats.
4. Choose **Connect and read**. The app verifies its managed process, NapCat
   registry and actual QQ, then reads QCE's own version/account and settings.
5. Choose **Change…** beside either **Default export folder** or **Default
   scheduled-export folder**. Enter an absolute Windows path or explicitly
   select **Use QCE default**. A blank custom path is not a reset.
6. Preview the selected field and confirm once. The response and independent
   readback are shown separately. Closing the panel never retries a write.

**Manage token** returns to the local credential view and closes the preceding
remote session. **Remove local copy** removes only the token saved by this app;
it does not revoke the upstream token, change QQ login or remove AI keys.

## Scope and results

QCE stores these defaults beneath the **same operating-system user's** QCE
directory. They are not isolated per QQ account. One field is sent per change;
the request can create directories but does not move existing files, start an
export, create a schedule or run a schedule. Existing schedules without their
own output directory can use the new default on later execution.

The editor shows both the returned custom setting and current effective path.
QCE can return null when its settings file is missing, unreadable or malformed;
that observation does not prove a healthy empty file. The API has no compare-and-
swap or atomic full-config transaction. A fresh four-field comparison catches
observed changes before submission, but cannot remove an external race or prove
that undisplayed fields were preserved.

“QCE responded to the save request” means the handler returned a valid success
response. It is not a disk-durability claim. An error or interrupted connection
after submission can leave partial effects. The app reports an unknown outcome
without retrying; a later matching read remains separate evidence.

## Connection and privacy

The app requests only `127.0.0.1:40653`, using QCE's separate Bearer token. It
checks the listener's exact owned process twice and refuses an unrelated,
changing or ambiguous listener. QCE itself can bind a wildcard address: this
editor does **not** establish that the service is exposed only locally.
A uniquely owned IPv6 wildcard still does not prove IPv4 reachability; a failed
loopback connection is reported without changing the listener or retrying.

Authenticated QCE reads may update its access bookkeeping. No export, schedule,
plugin enablement, browser page or security-token refresh is invoked. Paths stay
in this editor's transient replies and do not enter global snapshots or model
context. Account/window/runtime or credential changes invalidate the old panel.

## Verification boundary

The following counts describe the earlier **5.5.77** checkpoint, not 6.4.2
acceptance. At that checkpoint, the production integration passed
23 client/session checks and a 48-check
actual-main/adjacent run with synthetic credentials and account identity over
real isolated loopback HTTP. A separate eight-check component probe executed
the fixed upstream GET/PUT callbacks and PathManager with temporary storage,
including partial-effect failures. Its imports/home/filesystem were redirected
for isolation; it did not initialize the plugin or authenticate an account.
Production-renderer checks passed 17 cases with 12 inspected narrow/wide images;
ten credential/listener checks and three actual owned Windows listener probes
are separate evidence. Full regression passed 3,327 tests with one existing
opt-in skip, and 524 syntax checks passed. The unlaunched
`single-window-qce-20261107` package matched all 260 source files and retained
the approved voice asset. These checks do not accept a real installed QCE instance.
No real QCE token, account configuration, export or schedule was used for this
increment. Real installed-plugin usage remains in the consolidated test stage.

The contract was checked against the fixed upstream
[API implementation](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/api/ApiServer.ts),
[path settings](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/utils/PathManager.ts)
and [authentication](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/security/SecurityManager.ts).
Upstream implementation is not bundled into the MIT app. Manual exports use the
separate adapter above. Original [account-bound export plans](QQ_QCE_SCHEDULES.md)
reuse that adapter. The separate [access-rule editor](QQ_QCE_ACCESS_RULES.md)
adds bounded read/preview/change operations. The distinct [native shared-plan
manager](QQ_QCE_NATIVE_PLANS.md) is implemented in source without adopting those
records into Arcade's scheduler. Actual installed-plugin acceptance, token
rotation/revocation and versions beyond the two fixed adapters remain unfinished.
The 6.4.2 work covers folders, manual exports, native shared plans and access
rules through bounded component checks; no real Rust startup, migration, QCE
authentication or four-surface account workflow is claimed. Arcade account-bound
automatic plans still require 5.5.77. Earlier SSQQ evidence remains in its delivery record. The QCE-adapter package
passed component checks and original-profile application restoration without
installing or executing the Rust plugin.
