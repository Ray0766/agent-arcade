# Local QQ plugin management

## Builtin offline preparation and configuration — 2026-11-08 local

For the fixed builtin **1.0.0**, open **QQ accounts → Local components → Plugin
files and installation → Read plugin files → Current files → Preset automatic
replies off** (**预设关闭自动回复**). Explicitly read, preview and confirm once.
All QQ instances sharing the installation must be stopped, and the plugin's
enable preference must already be disabled. The app does not stop/start QQ,
enable the plugin or execute its code for this operation.

This changes only `enableReply` to `false` in the builtin's fixed configuration
file. Other JSON text is preserved, with original bytes or original absence
retained separately. Already-false settings are reported as unchanged. Linked,
ambiguous, changed or unsupported files are refused; uncertain writes are not
reported as a verified disable or automatically retried. This is separate from
the installation's disabled preference: the reviewed builtin defaults to replying
to matching-prefix messages from any private chat or group when enabled.

The actual **single-window-builtin-offline-replies-20261108** app completed this
flow on the original shared Shell **4.18.42** installation. Builtin was disabled
and its configuration file was absent. One UI confirmation created only
`enableReply:false`; independent six-check disk readback verified the original
absence record, fixed plugin files, unchanged enable preferences and the new
false setting.

After Ju's normal QQ start without scanning, an explicit Enable showed the
plugin enabled and loaded. The running configuration read showed replies off.
Only the description changed from `这是一个内置插件的配置示例` to a unique test
marker. The save returned a bridge acknowledgement and matching observation,
with independent disk readback. A normal UI Stop/Start, an intervening empty
launcher observation and a new launcher identity established a real restart.
A fresh registry/configuration read still showed the loaded plugin, marker and
false reply setting; the disk hash matched. A separate preview/save restored
the original description, again with acknowledgement, matching observation and
disk verification. Explicit Disable then produced an observed-disabled result;
the final builtin and Cleaner enable preferences were both false.

The final configuration retains replies off and the original description.
The plugin's normal save materialized its prefix/default fields, so this does
**not** restore the original missing file or all original bytes. It does not
test automatic replies, every plugin callback, cleanup or crash recovery.
Private disk evidence is in `outputs/builtin-offline-replies-live-20261108`;
the UI acceptance record is
`outputs/builtin-offline-replies-actual-ui-20261108/receipt.json`.

The increment passed **156 targeted checks / 6 syntax checks / 757 stable
inputs**, plus **11 renderer checks / 4 screenshots / 90 stable inputs**.
The build verified 376 inputs and 369 packaged sources; isolated desktop smoke
passed. These are bounded component, renderer and actual-use results, not a new
full-suite or public-release claim.

## Plugin panel continuity — delivered 2026-11-08 local

Current package and runtime are tracked in [ACTIVE_GOAL.md](ACTIVE_GOAL.md).
The following panel-continuity evidence belongs to **single-window-profile-backups-20261108**.
For the same selected account, a transient unverified runtime status now leaves
the plugin panel visible with actions disabled. Fresh identity/runtime checks
are still required before management resumes; changing accounts or closing the
panel retains its existing cancellation boundary. This does not turn an unknown
operation into success or automatically repeat a write.

The actual new package restored Ju and Whale QQ/AI from saved configuration,
without scanning, key entry or a model request. An explicit Whale registry read
showed Cleaner1.2.0 **disabled**, then Close returned to the overview. No live
outage was forced, so continuity during uncertainty is isolated-renderer
verification, not a new real-failure acceptance. The earlier installed Cleaner
save/restart workflow below remains its own evidence.

The combined package passed412 targeted tests,23 renderer checks/12 screenshots,
49-source supervisor assembly,378 stable build inputs/367 matching packaged
sources and isolated desktop smoke. The first targeted wrapper's count-parsing
failure is retained separately from the reviewed412-pass rerun; neither is a new
full-suite claim. Private delivery evidence is
`outputs/profile-backups-delivery-20261108.json`. Its remote empty-list/form/top
Return/Close inspection did not register a host; actual remote backup/restore
remains unaccepted. The bottom form Cancel input was tool-rejected before action.

## Installed Cleaner acceptance — 2026-11-08 local

The actual `single-window-appearance-invalid-20261108` app completed the local
Cleaner **1.2.0** workflow against the original shared Shell **4.18.42**
installation. The entry is **QQ accounts → Local components → Plugin files
and installation**; runtime status and defaults are under **Manage plugins**.

The app prepared the existing official ZIP, previewed the three-companion
scope and installed only after both running managed QQ trees were normally
stopped. Independent readback matched all **3 files /398,972 bytes** to the
fixed ZIP and found a complete deployment record with no pending transaction.
The twelve ordinary QQ process identities stayed present. On the next normal
start, the plugin manager appeared and Cleaner was initially disabled.

One live instance explicitly enabled Cleaner and read its eleven defaults.
Only retention changed **7 →8 days**. After normal stop/start, the actual
plugin editor read **8** again; independent disk hashes and changed process
identities corroborated persistence. A separate confirmed save restored **7**,
with the other ten defaults unchanged and zero scheduled tasks. Cleaner was
then explicitly disabled; another normal stop/start and registry read showed
disabled. The final seven-day configuration was verified on disk across that
restart, rather than by enabling the plugin again. Its installed files remain
available, but it is not left running.

Ju and Whale QQ/AI connections were restored using saved configuration, with
independent QQ identity/online/good checks, three unchanged OneBot hashes and
four unchanged encrypted credential hashes. No scan, key entry, model call,
test message, cleanup request, schedule change or plugin dashboard was used.
Initialization itself reads the QQ login mapping, as in the reviewed plugin.
Dragon remained unstarted. Evidence: the private
`outputs/cleaner-live-20261108/acceptance.json` and its linked UI/process/disk
receipts. The app's 362 source files were unchanged; this was real acceptance
of the existing build, not a new test-suite or release claim.

One transient unverified status closed the management panel. The QQ processes
remained present and the UI returned online without a restart. The exact
failure code was not captured, so neither a logout nor a Cleaner cause is
established. A later explicit read succeeded. The newer panel-continuity change
above addresses the closing behavior without establishing that failure's cause.
Builtin/SSQQ/QCE real flows, actual cleanup behavior, broader plugin
compatibility and long-term stability are not covered by this acceptance.

## Registry and earlier evidence

This source adds a **Manage plugins** drawer under QQ accounts → Local
components. Select a registered QQ companion with its current local runtime
online, read that instance's plugin registry, preview a status change and
confirm once. It uses the existing saved management configuration; no API key
needs to be entered again. The `single-window-plugin-admin-20261106` package
passed an actual read/close flow with AI disconnected: it showed the shared
three-companion scope and correctly reported that this instance had no plugin
manager. No real plugin was activated or disabled.

Only the fixed NapCat **4.18.42** local WebUI list, status, reviewed builtin
configuration and cleaner **1.2.0** default-options routes are exposed.
The online registry view never downloads a plugin, registers a missing manager,
renders plugin HTML, opens a plugin page or changes a remote listening address.
The examined ssqq/QCE releases have no compatible generic configuration
interface. A separate [QCE export-folder editor](QQ_QCE.md) now implements the
reviewed 5.5.77 system/config routes using its own token and owned local listener;
it does not embed the plugin page or reuse AI credentials. The separate
[access-rule editor](QQ_QCE_ACCESS_RULES.md) uses the same independent token.
SSQQ's browser-local preferences remain unfinished. Separate
[remote management](QQ_REMOTE.md) has its own credential and acceptance scope.
The separate file-management source addition below supplies static preparation,
installation, updates, removal and restoration. The builtin editor was packaged
in `single-window-plugin-config-20261106`; the cleaner extension below was a later
source addition. Cleaner and builtin now have the separate bounded installed-
plugin save/restart acceptance described above.

## Plugin files and installation

Choose **QQ accounts → Local components → Plugin files and installation**.
This separate view works while the selected QQ is stopped. Opening it does not
read files or contact a catalog automatically. **Read plugin files** shows
bounded disk metadata, prepared packages and retained recovery records; it
does not report which plugins are loaded.

Use **Choose local ZIP** or explicitly read the official catalog and choose
**Download and inspect**. Preparation checks the ZIP layout, supported ID,
manifest/entry, Windows paths, links, expansion limits, CRC and file digests.
Catalog downloads additionally match the exact GitHub release asset ID, size
and SHA-256. The official index is archived; inclusion and a matching digest
are not publisher authentication, code review or a package license. The fixed
runtime supports builtin, cleaner, ssqq and qce; unsupported catalog entries
cannot be installed here. No dependency installation or plugin script runs.

Prepared packages remain available after closing the panel. Read again, select
one package and preview the change and affected registered companions. Before
**Confirm apply**, explicitly stop every QQ sharing its work directory. The app
checks actual stopped state under its existing configuration/start lease; it
does not stop accounts for you. A Node account's separate work directory is
handled independently. Reading and preparation can happen while QQ is running.

Installation or update copies checked files into the selected work directory.
An update preserves existing internal `data/`, external plugin configuration
and enable preferences. Old trees are retained outside the plugin scan
directory. **Review removal** moves the current tree into retained history
rather than deleting it. **Review restore** of a completed backup restores
the selected whole old tree and its data, retaining displaced current data;
it does not merge histories or roll back the current enable preferences.
Without the new option below, existing/default preferences can load code on
a later manual QQ start, including the builtin's default-enabled behavior.

**First installation kept disabled.** In **Prepared packages**, an eligible
new plugin defaults to **Keep disabled after installation** (**安装后保持停用**).
Uncheck it to retain upstream/default behavior. Existing installations or an
existing target preference are ineligible; updates preserve the prior choice.
Invalid or duplicate-key preference JSON is refused rather than replaced.
This choice does not start QQ or execute plugin code.

The actual **single-window-plugin-first-disabled-20261108** app prepared the
official builtin **1.0.0** and applied one explicit first-disabled installation.
Independent twelve-check readback verified the four new files (**23,857 bytes**),
target preference=false, unchanged other preferences/plugin configurations/
OneBot files, and a complete V2 transaction without pending recovery. Original
ordinary QQ identities remained present. After normal first starts, an explicit
Ju registry read showed builtin1.0.0 and Cleaner1.2.0 both **Disabled**. Neither
was enabled and no configuration action was invoked. This accepts installation
and the live first-start registry state, not plugin execution, builtin
configuration persistence, callback instrumentation or OS-crash recovery.

Actual use recorded six checks/six screenshots. Ju/Whale each restored QQ/AI
with one Start, without scan, key entry or model request; independent identity/
online/good and four unchanged vault hashes passed. Evidence: private
outputs/plugin-first-disabled-delivery-20261108.json and its linked install,
first-start and account receipts. The latest package remains tracked in
[ACTIVE_GOAL.md](ACTIVE_GOAL.md).

Under the same shared-directory stopped lease, this option adds only the
target plugin's `false` entry to `config/plugins.json` before exposing its
code. Other preference text and plugin configuration remain unchanged. A V2
journal retains the original preference bytes or absence and the staged
disabled file's identity. Explicit recovery of an interrupted V2 installation
can restore that original preference as well as the old code state; this is
different from ordinary restoration of a completed backup, which preserves
the current preference. Unknown or externally altered files are not overwritten.
The receipt identifies this intentional preference change rather than claiming
that the entire configuration file was untouched.

The fixed 4.18.42 loader still scans metadata/source files for a disabled entry,
but skips module import and initialization on that first start. The entry stays
registered as **Disabled**; configuration/page controls may be absent because
its module was never loaded. This does not certify earlier execution or all
plugin behavior. Isolated temporary-NTFS checks cover the write order, original
bytes, interrupted recovery and existing V1 behavior. The bounded live
first-start registry acceptance above does not extend to those failure cases.

Two directory renames are not one atomic filesystem transaction. A durable
journal identifies interrupted changes; app-managed startup is then refused
until explicit recovery. An unknown or externally altered record is retained
and refused rather than guessed or erased. A successful file receipt proves
local readback and the reported configuration/preference result, not initialization,
compatibility or behavior. No automatic retry, restart, registration or loading
is performed. Closing cannot undo a rename that already happened.

Bounds: 64 MiB ZIP/single file, 256 MiB expanded content, 4,096 entries,
16 directory levels, and 64 prepared/history records. Unrecognized partials
are retained and may require local inspection; no automatic deletion is used
to make room. Original avatar, API, account and QQ login data are not migrated
by these operations.

The `single-window-plugin-installation-20261106` package passed actual offline
Read/Close with the original profile: it showed the three registered companions
sharing the installation and no supported installed plugin files. No package
was deployed, removed, restored or executed in that account installation.
The full regression passed 422 syntax files and 2,780 tests, with one existing
opt-in test skipped and zero failures. The corrected production-DOM fixture
passed 23 checks/14 inspected images; it used inert temporary packages, the
intended synthetic transport and an explicit fallback-network block. Earlier
fixture runs accidentally used the official static catalog/download path;
their synthetic-only/no-network claim is withdrawn. No downloaded plugin ran.
The standard desktop smoke passed and 216 packaged source files matched.

An official 8,071-byte builtin ZIP was also independently
downloaded and checked, yielding four files/23,857 bytes with matching complete
readback. That static probe did not execute the plugin or touch an installed
QQ work directory. It did not establish plugin loading or side effects; the
later bounded builtin workflow above is separate evidence.

## Reviewed builtin configuration

Choose **Manage plugins → Builtin plugin → Configure → Read configuration**.
Entering the configuration view performs no read. The explicit Read can execute
the installed plugin's getter; saving and the subsequent observation may also
execute its code. This is not secret storage: the reviewed builtin exposes its
configuration through its own public resources. Do not put API keys here.

The editor supports command prefix, reply switch, description, and the builtin's
demo theme/features. The last two are plugin examples, not Agent Arcade's theme,
character or AI capabilities. Missing optional fields remain absent unless
explicitly changed; they can also be explicitly removed. Unknown/reactive fields
stay private in the main process and are preserved in the replacement payload.
The app does not render schema HTML, run change callbacks or open an SSE stream.

After editing, preview the exact field differences and affected registered
companions, then confirm once. A five-minute, single-use preview binds the full
private configuration/schema, plugin registry identity and installation scope.
The app reads again before submission and refuses an observed change. This is
an optimistic comparison, not an atomic compare-and-set across other managers.
Closing, minimizing or changing accounts cancels unsent work, including a Read
waiting for another plugin view to close. It cannot undo already executed code.

Save acknowledgement and observed matching configuration are separate from
durable disk saving, successful reload and plugin behavior. The builtin getter
reads memory; its setter can change memory before a disk failure. The generic
upstream setter also ignores a reload failure. An uncertain write stays unknown,
with no automatic retry, restart or restoration. An empty or unsupported response
cannot be converted into an editable default configuration.

## Cleaner defaults

Choose **Manage plugins → Cache cleaner → Configure → Read configuration**.
This source extension requires the already active `napcat-plugin-cleaner`
**1.2.0**. It does not install or enable the plugin. The app reads its dedicated
options route rather than pretending it implements the builtin schema API.
Other versions and inactive/missing plugins are refused.

The editor exposes ten category switches: video, video thumbnails, voice,
images, received files, logs, log caches, QQ temporary files, NapCat data and
NapCat temporary files. **NapCat data is not described as harmless cache.**
Retention is an integer from **0 to 365 days**; zero means a later cleanup
does not retain files on account of their age. All eleven fields must already
exist and have valid types; an empty response does not invent editable defaults.

Read, edit, preview the differences and affected registered companions, then
confirm once. Only explicitly changed known options are submitted. Other
options and saved schedules remain private and unchanged. A full private
configuration comparison refuses an observed intervening change before saving;
it is not a server-side atomic transaction.

Saving changes the defaults used by future manual cleanup and inherited by
new schedules. Existing schedules retain their own options. This operation
does not run cleanup or alter timers; previously configured schedules can
still run independently. The UI states that scope before confirmation.

The official plugin catches disk-write errors and can return success after
changing memory only. Consequently, a save response plus matching subsequent
read is **not verified disk persistence**. An unknown result is never retried
automatically. No plugin HTML, dynamic callbacks, arbitrary JSON editor,
cleanup or schedule route is exposed by this extension.

Verification on 2026-11-07: 82 backend/adjacent tests and 20 actual-main checks
passed with synthetic accounts and loopback HTTP. Separately, the exact
official cleaner entry was run against an isolated temporary NTFS directory,
an inert context and empty schedules: twelve checks passed, including actual
save/readback and a disk-error case that changed memory while preserving the
old disk bytes. Five handler calls and two save attempts made no network,
child-process, QQ, timer, cleanup or schedule calls. This is component evidence,
not an installed-plugin/account acceptance. The downloaded implementation stays
outside the public source and application package.

The later original-installation acceptance above adds real deployment, enable,
default save/restart-readback and disable persistence. It does not reclassify
these earlier isolated checks or accept any actual cache deletion.

The official ssqq **3.5.2-3** entry only registers its static page. QCE
**5.5.77** launches its own separate API; neither exposes the generic
configuration schema/getter/setter. The dedicated [QCE folder editor](QQ_QCE.md)
now uses its separate reviewed routes. [Manual QCE exports](QQ_QCE_EXPORTS.md)
also have a source adapter for observed conversations and app-owned tasks.
[Account-bound export plans](QQ_QCE_SCHEDULES.md) reuse that adapter with local
IANA recurrence and offline pause/removal; they do not adopt native QCE plans.
The separate [access-rule editor](QQ_QCE_ACCESS_RULES.md) adds a bounded
read/preview/change flow for rules, filter status and advertised host;
isolated main/UI and package checks passed, while real installed-plugin
acceptance is pending. A distinct [native shared-plan manager](QQ_QCE_NATIVE_PLANS.md)
is implemented in source for all eight fixed native routes, including custom output
directories and shared run-all; it does not turn native records into account-bound
Arcade plans. SSQQ preferences, token rotation/revocation and broader version
compatibility remain unfinished. Real native-plan acceptance remains pending.

## Account and work-directory scope

This section describes registry/builtin/cleaner settings. QCE default export
folders instead share OS-user storage, as shown in its dedicated editor.

The selected live QQ instance receives the change. Some Shell installations
share a work directory, including the saved plugin enable preferences. The
preview lists registered companions sharing that exact directory, even when
they are offline. A saved change may affect their next startup; it does not
immediately change every running manager. This list does not claim to discover
every unmanaged process outside Agent Arcade. Managed Node work directories
are account-specific.

Opening the drawer and reading its registry do not load plugin modules. An
explicit enable request can load and initialize installed code. Plugins are
independent of Arcade's owner-only AI route and may act on other private or
group messages. Package identifiers are not code signatures. No model tool or
autonomous contact permission is added by this screen.

## What each result means

- **Active:** the bridge registry reports enabled and loaded.
- **Disabled:** the registry reports disabled; cleanup of every background
  timer, connection or other side effect is not independently verified.
- **Stopped:** enabled but not loaded. This is not proof of process termination.
- **Acknowledged:** the fixed status action returned successfully. A subsequent
  registry observation is displayed separately.
- **Unknown:** submission may have occurred, but its result is unclear. The app
  does not automatically retry, restore or restart it.

For status preferences, the upstream save path swallows disk errors and cleanup
catches plugin errors.
Consequently, even acknowledgement plus a matching registry observation does
not prove persistence or complete shutdown. Five-minute, one-use previews bind
the selected instance, component/work-directory identities, affected registered
profiles and observed registry. Account, runtime or scope changes invalidate an
unsubmitted preview. Closing the panel retires its own client, not the AI or
runtime-polling connection.

## Sources and verification boundary

Reviewed 2026-11-06 against commit
`9335843246e3b7a17944861f3ac8731a259732c2`:

- [Fixed list/status routes](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/router/Plugin.ts)
  and [list/status semantics](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/Plugin.ts).
- [Loader policy and preference saving](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/network/plugin/loader.ts),
  [lifecycle and cleanup](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/network/plugin-manger.ts)
  and [work-directory paths](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-common/src/path.ts).
- [Builtin message handler](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-plugin-builtin/index.ts)
  illustrates why plugin code is not restricted by Arcade's configured owner.

Local protocol/UI checks and actual-account acceptance are recorded separately.
The configuration addition passed 27 new backend/session checks and 16 new
actual-main IPC cases over synthetic localhost responses. These overlap the
full 2,697-test checkpoint: 2,696 passed, one existing opt-in skip and no failures.
Its production-DOM suite passed 21 checks/12 inspected images, including optional
absence, exact differences, overlong emoji, close/switch races and narrow layouts.
The standard desktop smoke passed; 210 packaged source files matched the tree.
The new package's actual registry read/close still reported no manager, so no
real configuration getter or save was exercised.

The preceding list/status checkpoint:
Sixty-five focused protocol, lifecycle, scope and actual-main IPC cases passed,
including the existing WebUI cases; they overlap the full regression total.
The production-DOM/adapter suite passed 19 checks with nine inspected images,
including narrow windows and retained typography. The full package checkpoint
passed 398 syntax files and 2,630 tests, with one existing opt-in real process
test skipped and zero failures. The standard desktop smoke also passed after
normal old-app exit; its first launch had been correctly rejected by the global
single-window guard. Package/source identity matched 205 source files, two
notices, 11 metadata fields and three unpacked resources.

Private actual evidence: `outputs/qq-plugin-admin-packaged-ui-20261106.json` and
`outputs/qq-plugin-admin-runtime-20261106.json`. The read used the existing QQ
login and encrypted provider configuration without re-entry. Synthetic UI and
protocol receipts are not substituted for a real plugin's behavior.

Those earlier checkpoints did not exercise real plugin status changes or
configuration persistence because their accounts had no plugin manager. The
later Cleaner and builtin workflows above supply bounded local acceptance;
plugin side-effect cleanup and real remote-host acceptance remain unverified.
