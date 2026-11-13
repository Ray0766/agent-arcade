# Decisions and evidence

## 2026-11-13 — AGPL-3.0, App-first companion, listen/notify, SillyTavern port

Owner decisions: the project is fully open source under AGPL-3.0 with no paid features; the goal is one download that works with one AI API key; the in-App companion is the default experience and ordinary QQ becomes an optional existing capability that is not extended.

- **License.** Changed from MIT to AGPL-3.0 so SillyTavern code ([AGPL-3.0](https://github.com/SillyTavern/SillyTavern/blob/release/LICENSE), read 2026-11-13) can be adapted. Alternative kept MIT and reimplemented everything; rejected by the owner in favour of porting speed. Earlier published revisions stay MIT (`LICENSE-MIT-HISTORICAL`).
- **NapCat.** Its [Limited Redistribution License](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/LICENSE) forbids publicly releasing modified code and commercial use, so no project license of ours permits copying it. The upstream repository was reduced to two commits ("Keep README only", "docs: ending") with no releases on 2026-11-12 (GitHub API, checked 2026-11-13). In-app component download therefore cannot succeed any more; existing installs keep working. Alternatives to NapCat were not researched.
- **Proprietary dependency.** Of 179 runtime packages in the lockfile only `@anthropic-ai/claude-agent-sdk` 0.3.317 and its eight platform packages are not open source. They are now `optionalDependencies`, excluded from packaged files; Claude API conversation uses `@anthropic-ai/sdk` 1.4.0 (Apache-2.0) through `src/bot/claude-direct-runner.cjs`. Claude API task mode needs the optional SDK. This is an engineering reading of license compatibility, not legal advice.
- **Listen/notify.** One bounded in-process bus (`src/core/bus.cjs`) instead of Node `EventEmitter` (needs dedupe and isolation) or an external broker (no need). Sources follow the existing pull contract and are driven by the existing one-second tick. First sources: ICS file/URL, folder listing, RSS/Atom/page hash. No file watching dependency: polling `readdir`+`stat` is bounded and stable on Windows. External content is data only and never enters the command dispatcher.
- **Companion notices.** Source events marked for the companion are stored in a dedicated table and delivered through a deterministic gate (hours, daily cap, five-minute gap, quiet after the owner speaks); the model only words the message. QQ delivery additionally needs the existing proactive setting and eligibility.
- **SillyTavern port.** Pinned upstream revision `06bde939fb1e9c4c8d8641d810f0a916b5bce127`. Adapted logic lives in `src/vendor/sillytavern/` with per-file provenance; UI is rewritten in the existing style because upstream UI depends on jQuery and global state. Card scripts/extensions are never executed; a card system prompt applies only to tool-less conversation. Budgets are in characters (no tokenizer dependency).
- **Limits.** All of the above is verified by unit tests and isolated demo-window screenshots with synthetic data only. No real calendar/feed, real model call through the new paths, real QQ notice, or packaged build was exercised. The memory database schema and config gained fields, so a profile opened by this code cannot be opened by the 2026-11-13 package again without restoring a backup.

## 2026-11-08 — explicit adapters for fixed QCE 6.4.2

Retain 5.5.77 and adapt the existing four management surfaces to the official
[6.4.2 release](https://github.com/shuakami/qq-chat-exporter/releases/tag/v6.4.2),
pinned at `eb7d154891d818690b28025bc9f9bf35c5cfd533`. Do not treat the latest tag as
a version wildcard. A separate Rust child changes process ownership and listener
verification; adding a version string to the old whitelist is insufficient.
6.4.2 is limited to a fixed app-owned managed Shell launch. The old 5.5.77
Shell/Node paths remain, and Arcade account-bound automatic plans stay 5.5.77-only.

Reuse the existing main/session/client and one-use preview flows: version-bind
manual export records, accept queued creation and complete cancellation records,
omit unused native-plan nulls, and construct access-rule baselines from fields
the new API actually returns. Partial writes and unknown results remain distinct
from acknowledgment, readback and durable storage. No new token is extracted
from upstream files or logs; rotation/revocation is still outside the adapter.

The fixed Rust API binds all IPv4 interfaces. Arcade still uses owned loopback,
without claiming local-only server exposure. Managed launch fixes the binary,
uses a non-default bridge port instead of upstream default-port reclamation,
and sets QCE_NO_AUTO_OPEN=1 without rewriting the browser preference. Install,
upgrade and enable remain explicit; a hot enable must pass the same environment
and migration checks. No automatic restart or enable fallback is introduced.

The fixed [startup](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/main.rs) and [path manager](https://github.com/shuakami/qq-chat-exporter/blob/eb7d154891d818690b28025bc9f9bf35c5cfd533/qq-chat-export-server/src/paths/mod.rs)
can migrate old exports. This increment does not build a cross-version migration
transaction: allow only absent legacy sources or two validated custom export
directories, otherwise refuse. Rechecks do not remove the external-writer race.
QCE can still initialize its database and resume existing enabled native plans.

Fixed source and bounded component checks support these contracts. The real
Rust server, authenticated account workflows, exports and persistence have not
yet been run or accepted. Existing SSQQ delivery evidence remains unchanged.
See [entry, startup limits and verification](QQ_QCE.md).

## 2026-11-08 — bounded pictures in the manual QQ client

The fixed SSQQ frontend already renders QQ/group avatars and message pictures
with image elements. Reuse that consumer and Arcade's existing PNG/JPEG byte
downloader rather than enabling the page's unrestricted outside network. Only
the owned view's image requests for the exact four supported Tencent hosts and
known path shapes can mint a short-lived local ticket. Main performs the bounded
read with no QQ bearer, browser cookie or inherited authorization header.

Electron's [WebRequest contract](https://www.electronjs.org/docs/latest/api/web-request)
provides request identity and resource type, while its
[protocol contract](https://www.electronjs.org/docs/latest/api/protocol) requires
registration on the view's actual session. These existing APIs fit the pinned
Electron architecture; no new framework is needed. A real Electron probe found
that an HTTPS-to-HTTP redirection did not reach the custom handler. The candidate
uses a private HTTPS ticket address in the same isolated session and checks both
requests. This routing observation is empirical, not a general browser guarantee.

The benefit under validation is visible avatars and existing conversation
pictures in one window. It does not add arbitrary CDN access, GIF/video support,
uploads or model vision. Two real Tencent avatar reads produced valid JPEG/PNG
and closed their owned sockets; original-frontend and actual-account display
remain distinct acceptance steps. Sources checked 2026-11-08.

## 2026-11-08 — repair fixed Shell bytes without changing the selected installation

The existing component-selection rollback cannot repair the sole prepared
Shell4.18.42 code tree: there is no independently prepared alternative version
to select. Add a separate explicit repair that reuses the pinned official cache,
stopped-instance gate, component manifest and durable supervisor requests.
Stage and verify replacement bytes before retaining the original tree and
publishing at the same code path. Keep selection and account-data locations
unchanged. This costs a second code tree and explicit interrupted-state recovery;
it avoids inventing a version rollback or reinstalling account data.

The fixed archive and upstream provenance remain in the component manifest;
this increment did not choose a new upstream version. Official archive testing
restored684 files in isolated NTFS, while HTTPS/SQLite and renderer checks used
temporary/synthetic hosts. Actual desktop acceptance covered normal original
account restoration and an empty remote entry, not remote repair. No claim that
this prevents QQ logout. See [repair workflow and boundaries](QQ_SHELL_CODE_REPAIR.md).

## 2026-11-08 — fixed SSQQ frontend as a separate manual account client

Use the fixed official SSQQ v3.5.2 static frontend inside an owned
`WebContentsView` in the existing window. Its original plugin only serves that
page, so preparation does not require installing or enabling the plugin. Keep
the AGPL-3.0-only frontend and its provenance separate from Arcade source rather
than copying it into the MIT interface. The separate wrapper license does not
relicense the frontend or remove distribution obligations.

This is an explicit manual account tool, not an AI channel or a read-only proxy.
It can operate contacts and groups outside the AI owner scope. Main verifies the
selected QQ identity and injects credentials only into its exact owned local
OneBot socket; the page receives no Arcade preload. A separate persistent local
browser profile retains native preferences, while outside network requests, new
windows and downloads are denied. Use SSQQ's native pink preset and system-theme
consumer; do not recolor the upstream page with a global filter.

The benefit to verify is fewer windows without mixing manual account access
with AI context. The cost is a fixed frontend/version boundary and missing
external avatars/media. Loading is not connection or delivery, and unconfirmed
cleanup retains the original resources for explicit retry. Native Electron and
loopback checks do not accept real QQ use. See [Manual QQ client](QQ_MANUAL_CLIENT.md)
for the entrance, license and current evidence boundaries.

## 2026-11-08 — independent App conversation

Keep the existing channel-backed desktop conversation and add an explicit App
source. Reusing its connected QQ engine alone would keep requiring a configured,
online social account; silently detaching that engine would change which QQ
history and memory the user is speaking to. A separate local controller reuses
the existing bounded `SocialCompanion`, `SocialStore` and no-tools provider
adapters, with a separate SQLite directory and no channel client or scheduler.
This adds one owned runner/store per started companion and explicit retirement
on credential, persona or configuration changes. It adds no SDK or protocol.

The practical benefit to verify is a saved AI connection becoming usable before
QQ setup, with an obvious choice between separate App and channel contexts.
This is a workflow improvement hypothesis, not a measured retention or naturalness
claim. Start sends no model request; actual provider validity is checked by a
real conversation. Provider support inherits each existing adapter's limits;
Codex and legacy Channels remain excluded from this no-tools path. Independent
voice is left out of this increment and is not implied by desktop text readiness.
The current implementation and execution points are recorded in
[desktop conversation](DESKTOP_CHAT.md) and [active scope](ACTIVE_GOAL.md).

## 2026-11-07 — separate dead-owner lock proof

Resolve the observed component-lock/plan circular dependency with a narrow
ownership proof, not a general ignore-pending switch. Reuse the existing plan
parser, full prepared-tree verification and installation OS gate. Keep exact
file/parent identities and independently check the original process owner.
Removing a recovery guard, removing the primary lock and reconciling a plan are
separate actions with distinct receipts. Clearing a lock does not start QQ.

The benefit is recovery from the three observed service-process interruption
points without manually deleting a lock. The cost is a separately granted
service namespace and schema-3 typed ledger/client migration. All families keep
one shared operation slot and history limits. A completed result can explicitly
mean no lock was removed, and unknown cleanup preserves known removal facts.

Real isolated child/HTTPS/SQLite/NTFS chains passed. An early combined UI refusal
was not fully diagnosed and remains a stated limitation despite later passing
runs. Existing legacy account leases do not prove an installation's identity;
their combined live/dead-process recovery is still separate unfinished work.
No model credential, current QQ account or operated launcher was replaced.

## 2026-11-07 — explicit pending-plan recovery authority

Reuse the existing opaque-plan preservation helper through a separately enabled
supervisor extension. Ordinary process Status can be blocked by the same plan
that needs inspection, so recovery discovery must use its dedicated selection
context. This avoids copying the file transaction or offering arbitrary remote
paths. It is useful for an already stopped, lease-free, fully verified prepared
installation; it is not an upstream updater or code rollback.

The host administrator opts in. The cost is typed desktop/service journal
migration and a shared operation slot across process and file recovery. Existing
process wire shapes remain unchanged. Querying the original receipt is distinct
from newly authorized filesystem reconciliation; a settled reconciliation can
leave the original plan active. Model credentials remain untouched.

Actual child crashes revealed an additional component-lock dependency: both the
remote preview and the existing local lock-recovery path can reject a lock while
a pending plan/journal exists. Keep this limitation in the delivery scope and
develop a dedicated ownership-verified path. Do not remove the lock manually in
a test and present the subsequent success as automatic recovery. See
[the recovery guide](QQ_SUPERVISOR_RECOVERY.md) for implementation and evidence.

## 2026-11-07 — optional remote QQ supervision

The existing WebUI restart request is the baseline: it is useful only while the
QQ runtime can answer. Add a separate, optional Windows supervisor to start,
stop and recover a fixed installed instance when QQ's WebUI is unavailable.
Reuse `QQRuntimeManager` ownership checks; do not add an arbitrary remote shell
or broaden the resumable-file helper's token authority. Installation and data
upgrade transactions remain a separate unfinished capability.

Use Node 24's built-in HTTPS/SQLite with a separate encrypted desktop link,
explicit TLS trust, durable operation IDs and no automatic mutation retries.
The additional cost is one separately deployed host process, certificate/token
setup and a bounded journal. No model call is needed for lifecycle decisions.
The proposed benefit is remote control while QQ is stopped. The desktop/service
flow now exercises that distinction with an inert runtime boundary; separate
service checks use an actual owned inert Windows process. Real remote QQ
acceptance is still pending. This is not a reliability or
performance superiority claim.

Official documentation checked 2026-11-07: [Node HTTPS](https://nodejs.org/api/https.html),
[Node child processes](https://nodejs.org/api/child_process.html), and
[Microsoft Win32_Process](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process).
The exact [Node 24.18.0 SQLite documentation](https://nodejs.org/download/release/v24.18.0/docs/api/sqlite.html)
was also opened: its built-in interface is release-candidate status, not a claim
that this integration is fully stable. Synchronous short journal transactions
are bounded and need no external native binding.
The current Node pages describe v26; deployed/tested runtime remains Node 24,
and no v26-only API is selected. Exact v22 documentation URLs failed to load in
the web tool. Process identity must include creation time and executable, not
PID alone. Existing application TLS and process adapters are the implementation
baseline; no new dependency is justified. The existing remote-instance list and
QQ account controls are the visual references; preserve their task hierarchy,
single-window navigation and original 17px/14px scale rather than adding a
separate dashboard. [Implementation and acceptance](QQ_SUPERVISOR.md).

## 2026-11-07 — offline retirement of transfer records

Keep the existing encrypted SQLite job store and authenticated helper workflow.
The active 64-record pool previously had no reachable maintenance path for an
expired job or a deleted/changed remote binding. Direct deletion would release
capacity but discard unknown outcomes and file-location evidence. Instead, an
explicit local confirmation moves the full original record into a bounded ended
pool; a second independent confirmation can forget that evidence. Neither action
contacts the helper, changes credentials or deletes transfer files.

The cost is one schema migration, a small encrypted ended envelope, exact
operation ownership and a same-window record pane. Job payloads remain bounded
to 8 MiB across both pools; reserve 64 × 2 KiB separately for envelopes so a
legal full v1 database is still retireable. No new dependency or model is used.
The existing 16 MiB SQLite file limit and remote recovery binding remain intact.
Previous packaged source refuses schema v2, so deployment requires controlled
old-app exit; this is not a backwards-compatible database downgrade.

Use the previously inspected NapCat contextual management and aligned-row
references recorded in [UI references](UI_REFERENCES.md). Present one primary
decision, retain original mist-pink 17/14 typography, and place uncertainty beside
the exact action. Keep the active network view owned underneath the local pane.
Preview, commit fact, current local observation and remote success are distinct.
The [feature guide](QQ_TRANSFER_RECORDS.md) records usage and final verification
scope; isolated SQLite/NTFS/owned-child and renderer evidence is not real-host
transfer acceptance.

## 2026-11-07 — same-version managed Node repair

Keep the existing Electron, component store and fixed official 4.18.42 Node
archive. Reinstalling into a new account directory is a useful fallback, but
does not meet the goal of repairing damaged code while retaining the original
installation and data-directory identities. Add a separate metadata-only
recovery entrance; normal startup still requires full code validation. The
[fixed source and prior native observations](QQ_NODE_SETUP.md#fixed-upstream-package)
remain the baseline. No new dependency, protocol implementation or model call
is needed.

Serialize participating operations by the shared code root, retaining the gate
through spawn/adoption. Verify all managed installations in that store and
stopped processes before replacing code. Keep exact original manifest and
descriptor bytes, retain the previous tree, and require explicit decisions
after an interruption. A completed result whose final record cleanup failed
can be verified and settled without another code replacement. Known abandoned
staging is separately retireable; uncertain partial ownership remains blocked.
This adds a recovery transaction, staging/history owners and a small drawer
section. It does not promise cross-version migration, filesystem isolation
from external programs or crash recovery at every possible instruction.

Use the existing inspected NapCat contextual management and Things-style
aligned rows from [UI references](UI_REFERENCES.md). Keep one primary decision,
secondary preservation details and the existing mist-pink 17/14 typography.
Component history is not a second account-card grid. Independent temporary
filesystem and renderer checks distinguish healthy repair, original restoration,
abandonment and uncertain cleanup; official archive and packaged acceptance are
separate evidence layers. See [usage and limits](QQ_NODE_REPAIR.md).

## 2026-11-07 — native shared QCE schedule management

Keep QCE's existing shared plans separate from Arcade's account-bound plans.
Mixing the two lists would lend the native scheduler guarantees it does not
have: actual-QQ binding for future runs, IANA timezone behavior and durable
occurrence claims. A dedicated child view in the same plugin dialog keeps the
daily entrance unified without migrating existing records.

Implement the fixed eight-route native API through original bounded controls,
including complete editable options and per-plan output directories. Compared
with opening the upstream page, this reuses actual-account/listener/credential
checks and the current one-window UI. Reduced window switching remains a
usability hypothesis. The cost is three backend modules, a small cron validator,
one view and protocol/lifecycle tests; no new scheduler or dependency is needed.

The fixed [5.5.77 scheduler](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/core/scheduler/ScheduledExportManager.ts)
and [API](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/api/ApiServer.ts)
expose all operations, but shared state and captured old tasks limit pause,
deletion and persistence. Reuse the prior 13 component observations; seven
new independent counterexamples cover old-definition overwrite, queued work
after deletion, overlapping all-queues and actual cron grammar. Native run-all
authorization means the eligible set when the server receives the request,
not the advisory preview list. No automatic retry or inferred ownership of
unknown-created records is added.

Use the inspected NapCat contextual controls and Things' quiet aligned rows
from [UI references](UI_REFERENCES.md): one observed list, one editor/preview,
secondary history and bulk controls. Transform them into the existing mist-pink
surface with original 17/14 typography. Do not use decorative account cards for
individual plans, or imply native timers stop when the dialog closes. Actual
plugin/page interaction was not performed for this increment. See the
[implementation boundary](QQ_QCE_NATIVE_PLANS.md).

## 2026-11-07 — fixed QCE access-rule editor

Keep optional QCE administration in the existing plugin dialog. Compare an
embedded upstream page with a small native adapter; choose the latter to retain
the reviewed account/listener/token boundary and avoid another management
window. This costs three bounded backend modules, a form and lifecycle tests;
fewer window switches remains a usability hypothesis, not a measured benefit.

The fixed [5.5.77 API](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/api/ApiServer.ts)
and [SecurityManager](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/security/SecurityManager.ts)
support exact rules, a disabled flag and an advertised host. Sixteen isolated
actual-component checks and five independent counterexamples verified important
limits: enabled empty lists allow all; writes can fail silently; reads can
write shared state; host editing does not change the listener. No token-rotation
or session-revocation HTTP route was found. Do not invent one or edit secret
files directly. These are fixed-version findings, not claims about current 6.x.

Use read → one-change preview → once-only confirmation → separate observation.
Keep unknown submission outcomes unknown, and show self-lock and allow-all
effects before confirmation. No automatic recovery changes. Existing model
credentials remain separate; no new dependency is needed.

For UI, compare a bulk settings form with a compact rule list and one editor.
Choose the latter, retaining the inspected NapCat contextual actions and Things'
secondary-detail hierarchy in [UI references](UI_REFERENCES.md). Transform them
into the existing mist-pink surface and 17/14 typography. Decorative login
flourishes do not belong around individual IP rows; controls and precise effects
take precedence. The upstream QCE page itself was not visually reviewed.
Actual installed-plugin acceptance and persistent rule changes remain pending;
see [access rules](QQ_QCE_ACCESS_RULES.md).

## 2026-11-07 — account-bound export recurrence

For unattended exports from a chosen QQ conversation, compare native QCE plans
with an original Arcade scheduler using the existing manual export adapter.
The fixed [5.5.77 scheduler](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/core/scheduler/ScheduledExportManager.ts)
uses shared OS-user records and process-local time; its supplied timezone is
unused. An in-flight task can restore a deleted enabled record. Thirteen
isolated official-component checks reproduced these and related timing limits,
using intercepted timers and synthetic dependencies, with no live account.

Choose original profile/actual-QQ/work/credential-bound local plans. Save edits
paused, enable separately, and retain a durable occurrence claim and high-water
mark before each dispatch. A lost reply is not retried. Pause/removal is local
and remains available offline; already submitted QCE work is not promised to
stop. Recheck native identity, exact target and paths for every run, while
acknowledging that those checks and upstream execution are not atomic.

For the bounded daily/weekly/monthly rules, use the runtimes' standard Intl
calendar/timezone data with exact round-trip validation. Node 24.18.0 and
Electron 45.2.1 differ in native Temporal availability and ICU data; both passed
the same 18 targeted recurrence cases. The current
[cron-parser implementation](https://github.com/harrisiirak/cron-parser)
adds general cron/Luxon behavior beyond the chosen explicit skip-gap/first-fold
contract. No new dependency is needed for this finite 2000–2099 policy. This is
not a replacement for arbitrary cron or a guarantee about future timezone laws.

UI alternatives were another account-card grid or a compact plan list with a
separate editor. Choose the latter: one action at a time, explicit preview and
quiet local history. Reuse the inspected NapCat contextual controls and Things'
secondary-detail hierarchy in [UI references](UI_REFERENCES.md), retaining the
selected mist pink, original font and 17/14 sizes. Neither reference supplies
account isolation or export semantics. Cost is an encrypted plan/run store,
finite recurrence module, serial runner and editor; the actual usability and
installed-QCE benefit remain to be verified. See [the usage and boundaries](QQ_QCE_SCHEDULES.md).

## 2026-11-07 — owned manual QCE exports, with explicit unknown outcomes

For a user exporting one selected QQ conversation, keep the established native
plugin subview. The mature alternative is the full upstream QCE page, which
already has broader export/schedule controls but exposes shared task history
and a separate page lifecycle. The original adapter adds an observed target,
time/format/resource preview, one create, owned-task status/cancel and a native
download in the same window. This does not improve upstream export fidelity.

The fixed [5.5.77 API implementation](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/api/ApiServer.ts)
and [persistence](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/core/storage/DatabaseManager.ts)
were reviewed against the release artifact on 2026-11-07. Creation has no
idempotency key and persistence can lag the response; cancellation can precede
remaining writes. Use encrypted local operation records before submission,
separate UUID output folders and only received, scope-bound task IDs. Unknown
creation is not replayed, and a later status does not rewrite a lost receipt.
Keep saved-file hash evidence separate from remote completeness.

Reuse the previously inspected NapCat contextual-action grouping and Things'
quiet secondary details in [UI references](UI_REFERENCES.md). A target form and
compact local history fit this task better than another account-card grid.
Retain mist pink, original fonts and 17/14 type sizes; do not import upstream
artwork, page scripts, global task ownership or success semantics. One explicit
progress view has bounded polling; opening the feature does not start networking.

Cost: a pinned exporter adapter, encrypted record schema and download lifecycle
checks. Benefit to verify in real use: fewer separate windows and recoverable,
truthful local ownership. Isolated tests do not establish actual QQ export
acceptance, cancellation completeness or usability improvement. See
[the entrance and limits](QQ_QCE_EXPORTS.md).

## 2026-11-07 — dedicated QCE folder settings, separate from AI credentials

The fixed QCE 5.5.77 source exposes authenticated system/config routes with two
default-directory fields; it does not expose the existing generic NapCat plugin
configuration contract. Implement a dedicated native editor and a separate
encrypted QCE credential record. The mature baseline is QCE's own web settings
page. Keeping these two settings in the selected-account window can reduce
window switching; this benefit remains a hypothesis until installed-plugin
acceptance. No browser embedding, new dependency or architecture change is needed.

The fixed [API source](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/api/ApiServer.ts)
and [PathManager](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/lib/utils/PathManager.ts)
were reviewed on 2026-11-07 against the released artifact. The QCE token is
independent, defaults share OS-user storage, authenticated reads update access
bookkeeping, and failed writes may have partial effects. Send only one selected
field after a bounded preview and fresh observation; do not promise server CAS,
full private-field preservation, durable storage or automatic recovery.

Reuse the inspected NapCat selected-instance navigation and the owner's chosen
mist-pink character-card page. Their grouping becomes two quiet summary rows and
one focused editor, preserving the original 17/14 typography. Decoration and
upstream page code are not copied; plugin internals cannot serve as proof of
account login or success. See [the actual entrance and limits](QQ_QCE.md).

The cost is a pinned-version adapter, separate token setup and owned local
listener verification. It does not replace the full QCE web interface or manage
SSQQ's browser-local settings. Actual installed-plugin verification remains
pending; this increment does not require re-entering existing AI keys.

## 2026-11-07 — genuine byte resume requires a separate server contract

An isolated fixed-handler probe confirmed that NapCat 4.18.42 ignores Range and
If-Range (returns the full file), lacks validators/HEAD and does not merge upload
chunks. Retain its ordinary file workflow. Add an optional original transfer
helper and same-window view; require separate explicit deployment and credentials.
This costs one service, TLS/permission setup and storage maintenance. The concrete
benefit is continuing a verified partial rather than repeating all bytes. No
general speed advantage or real-host reliability result is claimed.

Research on 2026-11-07 checked [tus 1.0](https://tus.io/protocols/resumable-upload),
the npm-distributed [server 2.4.7](https://registry.npmjs.org/@tus%2fserver/2.4.7)
and [utils 0.7.3](https://registry.npmjs.org/@tus%2futils/0.7.3), published
2026-11-02, with package integrity/license readback. Reuse the mature protocol
engine rather than inventing another upload wire protocol. The stock FileStore
uses file size as offset and does not fsync/journal that offset; use an original
bounded durable store, full SHA-256 and a separate no-overwrite publication
receipt. Do not advertise the unsupported tus checksum extension. Immutable
download snapshots use [HTTP Range semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests).

SFTP was the mature alternative: the [OpenSSH manual](https://man.openbsd.org/sftp.1)
documents byte resume and the optional fsync extension, but it still needs SSH
accounts/host-key setup, stable content and final publication checks. A second
custom chunk protocol would repeat protocol maintenance without removing those
storage obligations. The chosen helper has isolated pinned dependencies and
does not alter the Electron/QQ architecture. Node 24.18.0/Windows is the tested
service baseline; Linux and real remote deployment remain unaccepted.

Reuse the already inspected NapCat account-management structure and the project's
approved mist-pink page: one selected account, a narrow child view, quiet job rows
and explicit actions. Keep the existing system font and 17/14 hierarchy. No new
dashboard, account window or decorative data is introduced. Product-design
references guide grouping and hierarchy, not protocol truth or copied assets.

Current component evidence includes actual HTTPS/NTFS continuation, five process
crash boundaries, two competing service processes and state/staging on separate
volumes. Independent review replaced a racy stale-PID lock with an OS-held gate
and tightened persisted-record validation before recovery. An actual NTFS probe
found rounded default numeric file IDs in 19 of 20 temporary files; identity
checks now use exact BigInt stat fields. The final client passed six actual
isolated helper-service flows, including two process exits and explicit recovery.
Main and production-renderer integration have bounded fixture-based checks;
real QQ identity, remote deployment and packaged runtime acceptance remain
separate. Read [usage and limits](QQ_RESUMABLE_TRANSFERS.md) and the active goal.

## 2026-11-07 — fixed cleaner defaults, not an invented generic plugin API

The remaining plugin-settings scope was checked against fixed NapCat 4.18.42
[routing](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/router/Plugin.ts)
and the [official catalog](https://github.com/NapNeko/napcat-plugin-index/blob/b27f051d574fe039232c233ea3bd6173a0766db9/plugins.v4.json).
The current catalog read matched that pin. Being listed does not establish a
shared configuration schema or authenticate installed code.

The mature baseline is builtin's existing explicit Read → difference preview →
one-time Save flow. Reuse its identity/scope/expiry handling and original static
UI for the already active cleaner **1.2.0**, but adapt its actual dedicated
`config`/`config/options` routes. An arbitrary JSON/schema/HTML editor would add
unreviewed fields, plugin callbacks and potential secrets without solving the
missing API contracts, so it was not adopted. The benefit is configuring the
supported defaults from the same app without opening another plugin page;
no measured speed or reliability improvement over upstream is claimed.

The exact [cleaner release archive](https://github.com/NapNeko/napcat-plugin-index/releases/download/v1.0.0/napcat-plugin-cleaner.zip)
is 115,382 bytes, SHA-256
`9b35ccf4fd9f3530bccd06ffb0a88bfb70c8bd35ef18383618fc05c13ca7307a`.
Only eleven known defaults enter the renderer. Unknown options and schedules
stay private; confirmation rechecks the whole baseline and sends only the
edited known fields. Saving changes future cleanup defaults and newly created
schedules' inherited options; it does not clean or change existing task options.
No additional production dependency, process, model request or API cost is
introduced by this settings adapter.

Actual isolated NTFS execution of the fixed official handlers confirmed both
normal disk readback and the key limitation: their save function catches disk
errors, so a success response and new in-memory options do not prove durable
saving. Twelve component checks passed with an inert context/empty schedules;
zero timer, network, child, QQ, cleanup or schedule actions occurred. Source
backend/adjacent82 and actual-main20 checks passed separately. This is not real
installed-plugin/account acceptance or proof of server atomicity. Downloaded
implementations stay outside the public source and package.

The examined [ssqq 3.5.2 entry](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/blob/v3.5.2/ssqq.napcat-plugin/index.ts)
(release manifest `3.5.2-3`) only registers its static page;
[QCE 5.5.77](https://github.com/shuakami/qq-chat-exporter/blob/v5.5.77/plugins/qq-chat-exporter/index.mjs)
starts a separate API. Matching release ZIP entries expose no generic config
getter/setter/schema. At that checkpoint their own configuration remained
unfinished pending a separate contract. The later [manual SSQQ client](QQ_MANUAL_CLIENT.md)
now exposes its independent browser settings without a generic plugin setter;
QCE follows its separate dedicated adapters and acceptance boundaries.

## 2026-11-07 — ZIP extraction through the existing file connection

The retained remote-file gap is extracting a selected ZIP into an explicitly
chosen directory. A server-native archive API would avoid round-trip traffic,
but the fixed 4.18.42 handlers do not provide one. Use the existing raw download,
private held-descriptor staging, mkdir and upload contracts. Do not add a remote
shell or silently assume an extract endpoint. Preserve archive paths, including
a wrapper directory, and refuse observed output-root collisions instead of
merging into an existing tree.

Reuse the pinned ZIP reader and bounded transfer policy. The
[reader's official documentation](https://github.com/thejoshwolfe/yauzl#no-crc-32-checking),
checked 2026-11-07, explicitly leaves CRC checking to callers and supports stored
and deflated entries. Keep our CRC, decoded-size, path, type, resource and
held-file checks; a successfully opened ZIP alone does not validate its contents.
Validate all entries before the first target write. Metadata restoration,
atomic remote writes and resumable transfer remain outside this increment.

The benefit is a reviewable extraction flow within the same app and verified
connection. Its cost is download/upload/readback traffic and local temporary
space. Separate a validated archive manifest, acknowledged write steps and later
destination observations; none establishes the original source filesystem,
durability or attribution after an ambiguous response. Integration and UI
evidence belong in the [file guide](QQ_REMOTE_FILES.md); real remote acceptance
must remain separate from local component tests.

## 2026-11-07 — Account-free first result and bounded remote copy

First-use connections now expose the existing local sample inspector. Keeping
the sample only in Work & results made a new user face account setup before
seeing any working behavior. Reuse the actual Workbench/MCP result viewer,
without a model request, another IPC or changed credentials. The same fonts,
type scale and mist-pink controls remain; this is an entry correction, not a
new onboarding wizard. Production-DOM checks cover exact sample bytes/hash,
keyboard access, retry and narrow Chinese/English. The final packaged app was
also opened with a separate empty home/profile: the visible first-use action
returned the actual 79-byte, two-line sample, matching an independently computed
SHA-256, and Format JSON worked. This is a fresh-profile flow on this Windows
machine, not a clean-machine installation claim.

For remote copy, the mature baseline is a server-native filesystem copy. The
fixed [NapCat 4.18.42 file handlers](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/File.ts)
have no such route. Compose its existing raw download, mkdir and multipart
upload contracts within the same authenticated file view instead of inventing
an action or running a remote shell. The practical gain is an explicit copy
workflow in this window, at the cost of extra traffic, private local staging
and non-atomic writes. Separate step acknowledgements from destination byte
observations and never upgrade an unknown result from a later match.

Fixed-handler component experiments on 2026-11-07 confirmed that directory ZIPs
omit empty directories, and collision uploads can rename without returning the
new name. Supplement ZIP files with observed directories, reject unsupported
archives before target writes, and state the missing hidden-empty-directory,
snapshot, link and metadata proof. No real remote acceptance is claimed.
See [copy behavior and limits](QQ_REMOTE_FILES.md#copy-within-the-selected-remote).

## 2026-11-07 — Preserve an upstream pending plan without replaying it

An upstream pending-update marker currently blocks both QQ startup and component
selection. The existing separate updater is the mature alternative, but its
fixed 4.18.42 implementation can replace files before recording failures and
replays the remaining paths on startup. For an intact prepared component,
provide an original, explicit retain-and-deactivate action instead. Require the
complete manifest/archive/native binding and a stopped installation; the
original four-file baseline remains unsupported. This is not rollback of code
already replaced, a cross-version updater or a data migration.

Primary sources rechecked 2026-11-07: the
[4.18.42 release](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.42)
(published 2026-10-30) and the fixed
[update implementation](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/UpdateNapCat.ts).
The original helper never follows plan-supplied paths. It journals intent,
preserves the exact file without replacing an unknown destination, verifies
the retained bytes and leaves unknown outcomes blocked for explicit review.
No dependency, account-data change or automatic start is added. The practical
benefit is a same-window path for one previously unresolved startup condition;
no comparative time, uptime or general reliability improvement is measured.

Keep this infrequent operation in the existing component drawer instead of a
new recovery page. Reuse the already visually inspected NapCat Desktop compact
management actions and Things aligned action rows, as recorded in
[UI references](UI_REFERENCES.md): visible object/state/action, one explicit
preview and bounded details. Do not copy their code/art or treat desktop layout
as a mobile pattern. Preserve the selected mist-pink surfaces, original
characters, typeface, 17px headings and 14px body. Narrow Chinese/English,
keyboard focus and uncertain outcomes receive dedicated UI checks.

Full regression passed 473 syntax files and 3,120 tests (one existing opt-in
skip); the production UI passed 15 checks/nine inspected images. An isolated
official Shell input on NTFS preserved exact bytes/inode and rejected a damaged
copy. This is component evidence, not an interrupted real QQ update. Evidence
and remaining limits are recorded in [pending-update recovery](QQ_PENDING_UPDATE.md).

## 2026-11-07 — Complete manual remote files in the existing window

Use the registered remote's verified HTTPS client for an explicit file-management
subview. The mature baseline is NapCat's separate WebUI file manager; SFTP is an
alternative requiring an independently configured SSH account/service and host
trust. This change reuses the existing registration and window rather than adding
a second daily application or remote shell. Fewer context switches are the intended
benefit; no measured time saving or superiority over SFTP is claimed.

The fixed upstream 4.18.42 file router/handlers and disk uploader were reviewed at
commit `9335843246e3b7a17944861f3ac8731a259732c2` on 2026-11-07. It remained the
latest release, published 2026-10-30. Implement its list/text/create/mkdir/write/
rename/move/delete/batch/upload/download surface with original code. Keep the
existing management JSON transport's 128 KiB bound; use a separate fixed-route
streaming adapter and owned local file handles for transfers. No model call or new
production dependency is needed. Native selection uses the existing Electron
[open/save dialog API](https://www.electronjs.org/docs/latest/api/dialog), scoped
to the main window and invalidated by a changed owner.

The server lacks conditional writes, link identity, transactional batches and
upload final-name receipts. Fresh observations detect known changes but cannot
close the server-side race. Error responses after submission remain unknown;
local download publication and remote acknowledgement are separate. Actual fixed
upstream component probes in temporary directories confirmed partial batch
effects, UTF-8 uploads, collision renaming and file/ZIP bytes. They are not a
deployed-server or account acceptance claim. Details and fixed primary source
links are in [remote files](QQ_REMOTE_FILES.md).

Two layout directions were compared: an independent Files subview in the existing
dialog, or file forms appended to all seven management settings. Choose the first
to keep the selected directory and operation visible. Re-inspected official
[NapCat Desktop 3.5.19 imagery](https://github.com/NapNeko/NapCatQQ-Desktop/blob/v3.5.19/README.md)
for object-attached actions, and a [Things official layout image](https://culturedcode.com/things/2024-01-20/images/whatsnew-collage-io60.png)
for quiet aligned rows. These are static visual references, not hands-on file
manager evaluations. Retain the project's mist-pink tokens, Chinese fallback font
stack, 17px heading and 14px content/control scale; do not copy their assets, dark
card grid, macOS chrome or task-complete semantics. Busy operation state replaces
unrelated rows so cancellation remains reachable.

The operated `single-window-remote-files-20261107` checkpoint passed 467 syntax
files, 3,072 tests with one existing opt-in skip, desktop smoke and package/source
identity. Its actual empty registration entry passed and original Ju/Whale QQ
and AI configurations restored without key/QR entry. No real remote file request
was made; server durability, file races and advanced host operations remain
outside the accepted evidence.

Remote process inventory/start/kill and transactional component/data replacement
need a separately reviewed server contract. Uploading files is not an implicit
deployment or permission to execute them. Those scope items remain unfinished.

## 2026-11-07 — Native Passkey ceremonies for remote WebUI access

Add explicit registration and authentication to the existing remote-instance
detail dialog. The mature baseline is using Passkeys in the separately opened
NapCat WebUI. Reuse its four fixed authentication routes and the app's verified
HTTPS transport, while Windows supplies the authenticator prompt. A local
file-origin renderer cannot safely claim an unrelated remote RP through browser
WebAuthn. An original narrow native bridge preserves the captured origin and
parent-window ownership without loading remote HTML or adding a generic native
call interface. The possible reduction in window switching remains an unmeasured
workflow benefit, not a proven speed or reliability improvement.

Keep Passkey actions in a separate subview rather than alongside all management
forms: the user reviews one registered destination and one ceremony at a time.
Reuse the previously inspected NapCat list/detail and Things progressive-detail
methods in [the UI analysis](UI_REFERENCES.md), retaining the existing 17/14 type
scale and mist-pink shell. Their visual structure does not establish credential
trust, remote identity or the outcome of a Windows authenticator prompt.

Registration requires existing matched/version-checked access and an explicit
one-use preview. Authentication can precede QQ login, but WebUI authentication
is observed separately from QQ identity and online state. A same-scope private
client can transfer to the QQ sign-in view; it is not reauthenticated with a
possibly stale saved token. Token-recovery candidates remain unchanged and the
original resolution gates stay in force. Passkeys do not replace AI API keys,
alter local QQ ownership or grant new chat permissions.

Use the existing Windows PowerShell/.NET interop pattern rather than adding a
large native dependency. The cost is a versioned ABI bridge, exact cancellation,
owned-helper exit checks and additional session-lifecycle tests. Initial support
requires a registered DNS HTTPS origin and Windows WebAuthn availability; IP
origins and other operating systems retain the token route. Upstream shared
challenges and non-atomic credential writes prevent claims of atomic enrollment
or durable success. Unknown verification is never automatically replayed. The
fixed server exposes no Passkey list/revoke endpoint; do not invent one.

Primary sources checked 2026-11-07: NapCat 4.18.42 fixed
[handlers](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/Auth.ts)
and [challenge/storage implementation](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/helper/PasskeyHelper.ts),
Microsoft's [versioned ABI](https://github.com/microsoft/webauthn/blob/master/webauthn.h),
[MakeCredential](https://learn.microsoft.com/en-us/windows/win32/api/webauthn/nf-webauthn-webauthnauthenticatormakecredential)
and [GetAssertion](https://learn.microsoft.com/en-us/windows/win32/api/webauthn/nf-webauthn-webauthnauthenticatorgetassertion).
Implemented in the operated `single-window-passkey-20261107` package: 454 syntax
files and 3,000 tests passed with one existing opt-in skip; package identity
matched 230 source files. The new UI passed 20 synthetic checks/12 inspected
images. Real source and ASAR availability/ABI queries returned API9 and confirmed
owned helper exit. Actual packaged empty-list/form/back/close and original
Ju/Whale connection restoration passed without QR/key entry or a remote request.
Native availability/ABI checks and synthetic ceremonies do not prove real
enrollment, authentication or cancellation. Those remain in consolidated
acceptance; see [the usage and limitations](QQ_REMOTE.md).

## 2026-11-07 — Remote QQ login in the existing window

Add a dedicated QQ sign-in subview to the remote-instance detail pane. Compared
with placing a QR beside all seven management forms, the subview keeps one
target and one primary action visible. It reuses the already inspected local
QR layout and NapCat/Things progressive-detail references in
[the UI analysis](UI_REFERENCES.md). Keep the existing 17/14 type scale, mist-pink
shell and plain white QR quiet zone. Remote registrations remain distinct from
local account cards; no second window or new visual assets are needed.

The mature baseline is the separately opened upstream WebUI. Reusing its fixed
4.18.42 contracts through the existing verified HTTPS transport can remove a
window switch and keep the expected QQ visible. This is a workflow hypothesis,
not a measured speed or reliability advantage. No new dependency is required:
the current local QR encoder supplies the image. A controlled remote host and
phone login are still required for real acceptance.

Fixed-source review separates cached QR reads, explicit refresh, a one-time
existing-login attempt and persistent automatic-login preferences. A scan or
initialization phase is not online identity proof. Before/after observations
must match the registered QQ; the upstream has no atomic scan-session identity
or QR expiry contract. The App's display lifetime is therefore not a server
expiry claim. Pending token recovery may temporarily authenticate one explicitly
chosen candidate for sign-in, while preserving both candidates and all existing
management restrictions. See the fixed
[login handlers](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/QQLogin.ts),
[runtime state](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/helper/Data.ts)
and [Shell login callbacks](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-shell/base.ts),
reviewed on 2026-11-07. The implementation is in the operated
`single-window-remote-login-20261107` package. Full regression passed 446 syntax
files and 2,933 tests with one existing optional skip; package identity matched
226 source files. The production login UI passed 21 synthetic checks with 13
inspected images, separately from actual packaged empty-list/form/cancel/close.
No real remote was registered or contacted. Real scan, saved-login behavior and
remote recovery remain unaccepted; see [the guide](QQ_REMOTE.md).

## 2026-11-06 — Separate remote management from local runtime ownership

Extend the single window with an independent remote-instance list and detail
view, retaining the original typography and mist-pink theme. The alternative
was to add arbitrary URLs to the local account cards. Choose a separate view
because local cards promise process ownership and installation scope that a
remote WebUI cannot establish. Reuse the inspected NapCat list/detail method
and the existing restrained progressive-detail pattern from the
[UI reference analysis](UI_REFERENCES.md), without copying their code or treating
remote HTTP status as a local runtime state.

Use fixed 4.18.42 routes, normal TLS validation and an independent encrypted
registry. Every credential-bearing request uses the verified socket. Keep
network/authenticator/TLS/restart changes distinct; retained encrypted token
candidates address the upstream revoke-before-verification rotation behavior.
The mature alternative is opening the official WebUI in a browser. The benefit
here is one application entrance with scoped previews and explicit unknown
outcomes, not proven performance, uptime or full feature parity. This requires
registry, transport, session and UI work but no heavy dependency or model call.
Remote filesystem/process management is a separate, larger contract.

Implementation and isolated validation are complete for this bounded view.
The operated `single-window-remote-management-20261106` package passed actual
empty-list/form/cancel/close checks without entering a token, saving a
registration or making a remote request. Transport, client/session, main/registry
and production-DOM checks are distinct from that packaged entrance evidence.
An isolated Windows probe verified encrypted storage across normal exit and
reopening; it does not establish sudden-termination recovery. Actual remote
authentication and management changes remain pending. Fixed official handlers,
practical usage and remaining boundaries are listed in
[remote QQ management](QQ_REMOTE.md). Existing encrypted companion credentials
and local loopback routing are retained.

## 2026-11-06 — Separate plugin preparation from file deployment

The next single-window increment manages local plugin files, catalog packages,
updates, removal and explicit restoration. The current upstream installer
replaces the old directory and then attempts to load/reload the plugin; its
local Import route is disabled. Calling that route cannot honestly provide a
non-executing package preview. Use an independent staged ZIP reader and a
stopped-runtime directory transaction, retaining displaced files outside the
plugin scan directory. Reuse the pinned `yauzl` dependency and existing runtime
configuration lease. Do not copy upstream implementation or add a second app.

The practical benefit is a reviewable file change and retained recovery source.
This is not evidence of better QQ uptime or complete plugin compatibility.
Existing private configuration and enable preferences stay unchanged: enabled
plugins, including the builtin's default, may load on a later manual QQ start.
All runtimes sharing that work directory must be stopped for deployment.
Preparing a package alone does not require stopping them. Interrupted directory
changes require explicit recovery before an app-managed startup.

Choose a separate file-management view in the same window instead of enlarging
the online plugin registry view. It remains usable while QQ is stopped and
does not weaken the registry's identity checks. Retain the inspected NapCat
Desktop's compact list/detail organization and the app's existing preview/
result pattern. The previously inspected Things interface informs restrained
reading density and progressive detail, without adopting its task-list model
for plugin states. See the [reference analysis](UI_REFERENCES.md). Use the
selected mist-pink styling and original type sizes.
Do not embed plugin web pages or treat catalog illustrations as trusted UI.

Primary sources checked 2026-11-06: fixed 4.18.42
[routes](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/router/Plugin.ts),
[store installer](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/PluginStore.ts)
and [loader](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/network/plugin/loader.ts).
The [official index](https://github.com/NapNeko/napcat-plugin-index) contains no
per-package digest or signature. Exact release asset metadata and downloaded
bytes must be compared separately; that establishes content integrity, not
publisher authentication or permission to redistribute. The file lifecycle,
recovery and runtime gates are implemented and passed temporary-file and
production-DOM checks. The operated package passed actual offline Read/Close,
observing the shared scope and no supported installed plugin files. No real
plugin deployment or loading is yet claimed; see [verification boundaries](QQ_PLUGINS.md).

## 2026-11-06 — Typed plugin settings in the existing drawer

Extend the existing management drawer with explicit Read, local edits, preview
and one-time Save. The alternative was to embed the upstream generic schema
editor. Choose the typed subview because its reactive callbacks execute before
Save, its HTML would cross the renderer trust boundary, and its schema has no
secret-field metadata. Keep the complete bounded baseline in main, preserve
unknown fields and expose only the five reviewed builtin fields. Optional
absence is a real value, not permission to fill schema defaults.

The benefit over opening the separate manager is one account-bound entrance
with the app's existing scope and cancellation behavior. No performance,
reliability or complete upstream feature-parity advantage is established.
Retain the already inspected NapCat Desktop management density and the
project's existing friend-editor read/preview/result pattern. Keep mist-pink
styling and existing typography; plugin theme examples do not change that UI.

Rechecked fixed 4.18.42 primary sources on 2026-11-06: [GET/POST
implementation](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/api/Plugin.ts),
[builtin getter, setter and public resources](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-plugin-builtin/index.ts)
and [schema builder](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/network/plugin/config.ts).
No dependency or copied upstream implementation is added. Reads can execute
installed code; matching ID/schema is not code authentication. Memory readback
is not persistence/reload proof. Source and synthetic protocol/UI checks passed;
the packaged real registry still reported no manager. Actual plugin configuration
acceptance remains unfinished. See [the implementation boundary](QQ_PLUGINS.md).

## 2026-11-06 — Local plugin controls with explicit shared scope

Reuse the existing owned-runtime verification and authenticated local WebUI
adapter for fixed 4.18.42 list/status routes. This supplies the missing in-app
entry without a new dependency, embedded general WebUI or separate manager
window. The baseline remains the upstream manager; no speed or stability
advantage is established by adding the entry. See [contracts and primary
sources](QQ_PLUGINS.md).

Compared a toggle on every account card with a dedicated drawer under Local
components. Choose the drawer: Shell preferences can share a work directory,
and activating a plugin can execute code outside Arcade's owner-only AI route.
Show the current instance, affected registered companions and an explicit
preview. Use the already inspected component drawer for placement and the
existing friend-management view for read/preview/receipt and keyboard behavior.
Preserve the original typography and chosen mist-pink palette; the earlier
NapCat Desktop visual reference informs management density, not code reuse or
an assertion that every upstream capability is present.

List reads do not register a missing manager or run configuration hooks. A
status acknowledgement is separate from registry observation, persistence and
complete cleanup. Configuration hooks, installation and remote management need
their own implementation; this bounded delivery does not remove them from the
goal. Source/protocol checks and real plugin acceptance remain separate.

## 2026-11-06 — Manual existing-friend management, separate from AI authority

Extend the existing account directory with a fixed-target remark editor and
explicit removal request, preserving the earlier owner-remark restoration
entry. Use a separately owned request-only QQ connection and the established
selected-account/runtime proof. Never retarget the ordinary client's owner ID
to make an arbitrary contact look like the authorized chat owner.

Pinned NapCat 4.18.42 exposes both actions, but they have different result
contracts. Remarks use a void bridge handler; deletion returns an undocumented
native value. Keep deletion outcome unknown even after a successful outer
envelope, and display a subsequent cached-list observation independently.
Strict known refusal shapes are distinguishable, but cannot establish which
internal branch ran because native values are returned without a discriminator.
Do not claim that native deletion was never invoked. Two additional removal
flags are explicit and initially off; their effects and undo are unverified.
See [fixed official sources and boundaries](QQ_CONTACT_ADMIN.md).

Compared per-row edit/delete buttons with one **Manage friend** drawer entry.
Choose the latter to retain a fixed target and prevent destructive controls
from competing with directory browsing. Reuse the already inspected owner
remark view's read/preview/result hierarchy and the group-management drawer's
collapsed destructive section. Preserve the chosen mist-pink palette, original
font and 17/14-pixel hierarchy. Those earlier application references guide the
interaction; no new award or real-account result is implied by this choice.

Removing the configured owner is allowed as an explicit account action, even
with AI connected. It does not revoke local authority or erase memory. The
preview explains that stopping message processing requires disconnecting AI
or changing its binding. This avoids an arbitrary account-management block
while making the actual effects clear.

## 2026-11-06 — Explicit group and member management in the existing drawer

Extend the joined-group directory with all six remaining manual administration
classes: cards, individual mute, whole-group mute, administrators, removal, and
leave/dissolve. Keep the established independent request-only session rather
than borrowing an AI connection or adding model tools. The current owner-only
chat scope does not change. Exact group/member/role observations, explicit
preview and a consumed confirmation bind each request; remote cached data is
not atomic authorization proof.

Pinned NapCat 4.18.42 handlers have three acknowledgement semantics. Card
equality is observed by the bridge, mute handlers check native result zero,
and role/removal/leave handlers only complete their awaited calls. Keep those
different and show later readback separately. [Fixed sources and current
acceptance](QQ_GROUP_ADMIN.md) record the details and unfinished real-group gate.

Two UI directions were compared: expand many actions within every member row,
or enter one focused member/group subview. Choose the subview to retain one
target and one pending change while preserving the previous search/page.
Borrow the reviewed group-profile confirmation hierarchy and member-directory
density, both already visually inspected in their running fixtures; continue
the selected mist-pink treatment and original 17/14-pixel typography. This adds
no new main window or general dashboard. It is a workflow extension, not a new
visual design award or a claim of real group acceptance.

## 2026-11-06 — Own QQ nickname and avatar within the existing profile view

Extend explicit account management without granting models new tools or
connecting another UI window. For nickname changes, choose the pinned
`set_qq_profile` action with only `{nickname}` over reconstructing the native
profile from public fields: public `sex:unknown` loses the distinction between
unknown and private. Its handler also saves its internally read signature, sex
and birthday, so preview states that boundary. The supported observed signature
is checked before submission, but this is not atomic preservation of the
handler's different cache. Native result zero, rejection, outer acknowledgement
and later observations stay separate. See [profile scope](QQ_SELF_PROFILE.md).

For avatars, reuse the bounded image decoder/metadata stripping and independently
owned management socket. A random private PNG path was chosen over base64 input
because the pinned avatar failure path can include the file argument in bridge
logs. Unknown uploads are bounded and retained, not replayed or described as
cancelled remotely. No verified current-avatar API was found; the local role
portrait cannot serve as readback. See [avatar contract and source](QQ_AVATAR.md).
Research used NapCat 4.18.42 at commit
`9335843246e3b7a17944861f3ac8731a259732c2`, checked 2026-11-06.

The UI compared expanding avatars inline with a separate subview inside the
same profile dialog. The subview keeps image preview and its actual QQ target
together and avoids competing nickname/signature tickets. It carries forward
the previously reviewed NapCat Desktop account-management hierarchy and the
user-approved mist-pink treatment, with this project's own assets and original
17/14-pixel typography. The existing image sender supplies the explicit local
selection/preview interaction; its owner-message action and AI socket are not
reused. No new image assets, award claim or copied third-party UI code was
introduced. Actual AI-disconnected Whale UI submissions, independent readback
and ordinary-owner-QQ display passed for a temporary nickname/portrait and their
explicit restorations. The observed profile hashes remained unchanged outside
the nickname; native private-field precision and remote image bytes are not
established. A real success-state validation glitch was reproduced and fixed
with a separate production-adapter UI check; no extra account mutation was
needed for that display-only fix. Actual evidence and synthetic design checks
remain distinct in the feature guides.

## 2026-11-06 — Verify configured QQ candidates through the existing connection

An online QQ card with one configured companion could show only **Check status**
until it had a verified identity record, making saved API credentials appear
missing. Add **Verify and connect AI** without treating the expected QQ number
or preset portrait as proof. Choose a narrow main-process connection guard over
a UI-only button: bind the profile/runtime across awaits, permit only this
connection's own generation advance, and retain the existing QQClient identity,
owner and account-claim checks. Reusing the established connection and credential
store avoids another setup flow or duplicate authentication implementation;
ambiguous bindings remain blocked and existing connection calls stay compatible.
Independent fresh state must establish success. The 222 adjacent checks and
15 synthetic UI checks passed. The actual packaged Ju and Dragon candidate
connections subsequently passed with their saved credentials, alongside Whale's
existing verified route; no key re-entry, QR or test message was required. The
combined checkpoint passed 2423 tests with one opt-in skip. This is an internal
integration decision, not new provider research or evidence of remaining API
balance or a fresh model reply. See [QQ entry boundaries](QQ_INTEGRATION.md).

## 2026-11-06 — Messenger Page relay and observed voice stages

Use the official Page/webhook route for Messenger, with a separately operated
HTTPS relay. A personal Facebook account is not an interchangeable API identity.
Keep native bounded HTTP, Node SQLite and the existing Dispatcher instead of
adding a second agent engine. Exact raw-body HMAC verification, atomic inbound
claims and a separate durable outgoing-attempt record address different failure
modes; an unknown delivery is never automatically repeated. A directly authored
owner unsubscribe stops local work before any relay acknowledgement can delay
it. Deployment, token acquisition and Meta approval remain external prerequisites.
Primary sources, the candidate Graph version and unavailable official pages are
recorded in [Messenger](MESSENGER.md). Local HTTP/SQLite and synthetic Graph/UI
checks are not real Meta acceptance or a demonstrated setup-cost advantage.

For local QQ voice generation, expose existing validated provider stages rather
than estimate a percentage from elapsed time. The fixed account/panel observer
stops on cancellation or replacement and never initiates another synthesis.
One real local component run took 35.791 seconds to settle, mostly preparation;
the change explains waiting and does not claim faster synthesis. The existing
manual preview/send boundary and original font metrics remain. See
[voice scope and evidence](QQ_VOICE.md).

## 2026-11-06 — Finish the selected room style and extend fixed-owner channels

The owner asked for the QQ page's selected mist-pink treatment across the app,
while explicitly retaining the existing type family and size hierarchy. Keep
page structure/domain controls; share restrained surface/action/separator tokens
rather than duplicate QR ornaments around every chat. The earlier NapCat/Things
visual analysis remains the reference. The production-renderer fixture checks
unchanged font metrics, Chinese/English narrow layouts, focus and account-scoped
credential drafts; source inspection is not real login acceptance. The latest
UI run passed 24 checks with 23 screenshots, including the new X settings and
voice neutral controls (`outputs/room-x-20261106/ui.json`). It made no model,
device, login or social API calls. The changed screenshots were opened.

For X, use the standard owner-specific DM API with a pre-authorized OAuth 2 user
token and fixed numeric self/owner identities. The mature native `fetch` baseline
meets the three fixed endpoints without the general SDK's default retry or an
extra subscription/webhook lifecycle. Bound decompressed bodies, deadlines,
pagination and request budgets, and never replay an uncertain POST. Preserve
the existing Dispatcher and actual-account journal namespace rather than add a
second task engine. X's [user-authentication contract](https://docs.x.com/x-api/direct-messages/lookup/integrate)
and [rate table](https://docs.x.com/x-api/fundamentals/rate-limits) were checked
2026-11-06. A 75-second poll is deliberately slower than QQ; paid identity/DM
reads, token expiry, standard-DM availability and the applicable
[automation requirements](https://help.x.com/en/rules-and-policies/x-automation)
remain explicit. It does not implement encrypted Chat or prove platform
approval. Initial UI/configuration is not an accepted X account connection.
Native PKCE/refresh and the newer Activity stream remain alternatives requiring
separate App/subscription/lifetime evidence, not hidden prerequisites completed
by this source batch. Messenger requires its own Page/webhook/deployment work.
See [X boundaries](X.md) for the evolving source contract and real-test gates.

## 2026-11-06 — Batch native process observations without caching ownership

QQ Node endpoint verification launched several PowerShell processes for each
account. Keep the existing exact PID/creation/path/parent and listener checks,
but collect one bounded raw observation inside a single PowerShell invocation
and share it across accounts in that operation. Each account still validates
its own lease/tree/endpoint; a second independent observation remains required.
Do not share an ownership verdict across requests or fall back after failed
native observation. QR URLs/images leave the main process only after the final
endpoint check spanning HTTP and local encoding.

A same-machine three-pair read-only benchmark measured mean raw query-group time
**2624.89 ms split versus 1956.63 ms batched**. These are local collection costs,
not a measured QR or application-wide speedup. Independent review also found
that a newly created valid worker's listener could evade the old second-round
PID filter. The second check now derives listener candidates from its current
tree; wildcard and duplicate-loopback counterexamples reject the result. Tests,
benchmarks and exact source hashes are in private
`outputs/qq-node-observation-implementation-20261106.json`. Real packaged
pre-login checks after this optimization remain separate from the earlier
Node setup pass. No new dependency, account permission or model fee is added.


## 2026-11-06 — Keep account overview and focus scanning in one dialog

The owner selected **login concept 02: account cards plus a centered scan
dialog**, after comparing the interactive list/detail draft and generated
alternatives. Preserve the multi-account overview and give scanning one focused
surface within the existing window. Keep original portraits and all
configuration, backup, diagnostic and recovery entry points; move secondary
controls into local disclosures rather than remove capabilities.

References inspected on this date: the apps/chat demo images in the
[NapCat Desktop v3.5.19 README](https://github.com/NapNeko/NapCatQQ-Desktop/blob/v3.5.19/README.md)
and the [Things official interface image](https://culturedcode.com/things/2024-01-20/images/whatsnew-collage-io60.png).
Borrow compact identity/action grouping and aligned content hierarchy, not
their assets, implementation, extra windows or task-completion semantics.
NapCat's images are browser previews with demo data, not a verified login
sequence. [The reference record](UI_REFERENCES.md#qq-login-overview-and-scan-dialog-2026-11-06)
documents the specific translations and exclusions.

Six generated logo studies and five login concepts supported visual comparison.
The owner retained **misty pink and logo 06, the pink ribbon**, refining its
openings into negative-space chat-bubble and bot silhouettes. Variant 07's added
colored symbols were rejected; variant 08 explored that cutout direction, not a
final approval. The owner found variant 11's bot too prominent and complex.
Simplified variant 12 is now a reversible preview candidate for the next package;
the logo is still not final. Blue remains a comparison variant.
Generated screens and QR artwork are not functional evidence. Hide the duplicate
top AI-companion strip only on the QQ page and retain it elsewhere; local QQ
selection must not change the selected AI profile or connect it. Start and Show
QR remain explicit. Closing the scan view invalidates its QR presentation,
without logging out or stopping QQ; existing identity, busy and stale-result
checks remain. Dialog source has reached a checked checkpoint; variant 12's asset checks and packaged
inspection remain pending. Prior list/detail checks do not establish this revised whole-app or
real-account flow, which still awaits verification. No measured usability or
competitive advantage is claimed.

## 2026-11-06 — Reuse one idle QQ recognizer with explicit process ownership

Keep the installed Qwen3-ASR 0.6B, qwen-asr 0.0.6 and Transformers 4.57.6 stack.
The mature baseline is one process per recording; it remains available in source.
The measured repeated-load cost justifies retaining one clean model for 30 idle
seconds, restricted to the same account/owner/role/connection/runtime binding.
This is a lifecycle optimization, not a new recognition model or quality claim.
It adds no cloud fee/download; the prior local experiment allocated about 1.58 GB
GPU memory while resident. A model pool, local HTTP server and vLLM migration
would add lifecycle/deployment cost without evidence they are needed here.

Checked 2026-11-06: [Qwen's official Python examples](https://github.com/QwenLM/Qwen3-ASR#python-package-usage)
separate model construction from transcription and accept in-memory waveform/rate
tuples. Retain the bounded, offline transformers path already installed on this
Windows machine; do not adopt the documentation's remote-URL examples.
[Node's close event](https://nodejs.org/api/child_process.html#event-close) describes
child exit and closed stdio; it is not an application-level proof that a generic
descendant tree is absent. The pinned [CPython 3.11.9 Windows launcher](https://github.com/python/cpython/blob/v3.11.9/PC/launcher.c)
creates a job object, starts another interpreter and waits. Derive the expected
venv base from its local metadata, then independently verify exact process
identities and absence. Do not rely on a launcher acknowledgement alone.

The resident protocol separates ready, per-job transcript, clean-job and explicit
finish. Only successful clean jobs can park; errors/cancellation close the host.
The app gate retains uncertain ownership, rejects parallel neural recognizers
and prevents a stale timer or old service cleanup from closing a later job.
New text, disconnect, account changes, desktop voice and idle expiry retire the
exact idle host. Unconfirmed shutdown keeps the app and its cleanup proof alive
for another Quit attempt. Windows fallback still works during active QQ ASR.

Formal-host real evidence: one original 6.64-second clip, two independent jobs,
one worker, 12.296 seconds first / 0.703 seconds second, exact text for both;
close 4.300 seconds, independent process inspection empty. Both ordinary-Python
and venv layouts also passed inert native exit checks. These are bounded local
component observations. Initial recognition remains slow; idle GPU cost and
Windows-only identity support remain. No QQ voice, new human speech, long-run
accuracy or spoken interruption is accepted by these checks. Full details and
private receipt paths are in [QQ voice recognition](QQ_INBOUND_VOICE.md).

## 2026-11-06 — Restore a healthy recorded selection without trusting damaged code

Existing activation and rollback both verify the current code before recording
it as a previous version. Keep that rule. Add a separate explicit recovery for
a damaged prepared Shell current selection with a healthy same-version recorded
previous target. Its transaction clears the rollback entry while preserving the
damaged directory and exact historical selection bytes. This addresses the
observed source-level recovery gap without turning an integrity failure into a
startup bypass, arbitrary downloader or QQ-data migration.

Reuse the same installation lock, stopped-process guards and component drawer.
The extra cost is repeated bounded synchronous tree checks and one-use preview
state; an original target retains its four-file baseline while a prepared target
has full manifest verification. The UI names these scopes and separates a saved
selection from unknown write/readback outcomes. The official-file-input probe
uses a copied temporary installation, not deliberate damage to the owner's
working accounts. See [the implementation and evidence boundary](QQ_COMPONENT_REPAIR.md).

## 2026-11-06 — Inspect group members without opening group conversations

Use the existing account directory drawer rather than another account window
or a generic administration dashboard. Preserve the NapCat Desktop reference's
compact account identity and the existing chat application's restrained side
panel; reuse this project's typography, original avatars and warm-neutral
surfaces. A back action keeps the group search/page, so inspecting one roster
does not restart navigation. A separate full management page would add space
for actions that are not currently implemented or authorized.

The [OneBot contract](https://github.com/botuniverse/onebot-11/blob/master/api/public.md#get_group_member_list-获取群成员列表)
and pinned [NapCat implementation](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/group/GetGroupMemberList.ts)
were checked on 2026-11-06. Existing-cache return during refresh prevents a
realtime completeness claim. Use bounded account/membership checks before and
after reading, allowlist four display fields, and keep results out of model
context. The practical benefit is an in-app roster inspection without switching
managers; reduced operation time remains an unmeasured hypothesis. See
[implementation and acceptance boundaries](QQ_GROUP_MEMBERS.md).

## 2026-11-06 — Keep QQ management local and use observed process topology

The first actual Node startup exposed a direct System32 console host that the
Node-only tree rule rejected. Admit that exact path only under the verified
supervisor, with creation-time checks; keep unknown paths/descendants rejected.
The frozen repaired build has not yet run through recovery/stop, so source
regressions are not proof of a successful lifecycle.

The pinned [upstream WebUI parser](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/src/helper/config.ts)
defaults its host to `::`, including fallback after invalid configuration. Its
[server entry](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-webui-backend/index.ts)
uses that host even when it logs a localhost URL. Checked 2026-11-06. Seed new
work directories with a fixed loopback host; validate the complete supported
configuration and actual listeners, without overwriting existing user files.
Recovery and Stop remain available for a nonlocal old configuration. This
reduces exposure of the management service; it does not establish that native
QQ never opens other listeners or prompts Windows Firewall.

## 2026-11-06 — Separate friend decisions and voice chat from task authority

Use the existing OneBot connection for a bounded friend-request inbox, with
explicit Accept/Decline buttons in the original same-window drawer. The baseline
was switching to another QQ manager and repeating account selection. The
proposed benefit is fewer context switches while retaining the actual sending
account; no measured time advantage is claimed. Follow the NapCat Desktop
reference's compact account identity/actions and the existing directory's flat
rows, not its code, icons or dashboard decoration. The existing original
portraits and warm-neutral/orange palette remain. A global-header collision
and incorrect theme accent were found by loading production CSS, then repaired
and checked in Chinese/English narrow-window fixture screenshots.

Requests never enter model input or gain message authority. Current-connection
collection cannot provide offline or pre-handshake history. Fixed protocol
sources, limits and verification commands are in [friend requests](QQ_FRIEND_REQUESTS.md).

For owner voice, reuse the installed local Qwen baseline instead of introducing
a billed speech API or opening a microphone to transcribe QQ files. Preserve a
separate no-device worker, exact original-message recheck and no-command chat
entry. The shared model installation has one recognition lease; cancellation
must confirm the exact worker exited before another job can use it. Transcripts
go to the selected chat model and local scoped history, without authorizing
posts, tools or memory mutations. See [voice boundaries](QQ_INBOUND_VOICE.md).
A real model call on a 2.26-second synthetic clip took 32.618 seconds cold and
changed the final particle from “啦” to “了”. This proves a functioning local
inference/exit path, not exact transcription, acceptable conversational latency,
phone codec compatibility or a real QQ conversation. Cold-start latency remains
a limitation, not a claimed performance improvement.

## 2026-11-06 — Keep two QQ setup routes in the same window

Retain the verified installed-QQ Shell path and add the fixed upstream Windows
Node package as a separate installation engine. This removes the QQ.exe picker
from the new route while preserving the user's original installation. A compact
native radio group in the existing setup drawer is preferable to another
installer window or another manager application. Creation, selection, startup
and authentication remain distinct actions.

The official [v4.18.42 release](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.42)
and [fixed build recipe](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/.github/workflows/release-publish.yml)
were checked on 2026-11-06. The recipe packages Node 22.11.0 with QQ native
dependencies from 9.9.31-49738. The independently inspected asset fits the
existing extraction bounds; no expansion of those limits was needed. Keep its
archive identity, complete immutable file manifest and upstream terms separate
from Agent Arcade's original management implementation.

The cost is a distinct supervisor/worker proof, root-first stopping and
per-account work/data paths. These cannot reuse the Shell route's real
acceptance. At this source checkpoint, preparation and initializer tests plus
dual-route UI fixtures pass; native Node startup and clean-Windows compatibility
are still pending. See [setup and verification boundaries](QQ_NODE_SETUP.md).

## 2026-11-06 — Trace an uncertain stop without weakening process ownership

Two actual stops in the new independent Shell environment returned an orphan
warning, although later independent inventories found no target process or
lease. Keep these as failures. Add optional, main-process-only local diagnostics
for the operation stage and bounded process identities; exclude credentials,
message bodies, command lines, account numbers and original executable paths.
The environment flag is off by default and is not a renderer or saved setting.
File-write/serialization failures cannot change a lifecycle result.

An actual inert Node-process probe exposed a PowerShell `Generic.List` array
conversion error in the detailed trace. The corrected conversion was verified
with another owned, network-free process tree. Two subsequent QQ operations
had complete same-operation empty final inventories and clean UI responses;
they do not explain the prior failures. A third run kept the original native
stop script and recorded only manager observations; it also stopped cleanly,
with six recorded process identities absent before lease release. These three
passes do not establish the cause of the original failures. No Shell
termination-order change follows from an unproven respawn hypothesis.

The process-tree review also identified inconsistent creation-time checks in
the missing-parent path. Microsoft's
[Win32_Process documentation](https://learn.microsoft.com/en-us/windows/desktop/cimwin32prov/win32-process),
checked 2026-11-06, explains that a parent PID can refer to a later process after
reuse and that creation time distinguishes this case. This is a reason to check
the captured identities, not evidence that PID reuse caused the observed failures.
The source now excludes a fully identified row only when its creation clearly
predates its recorded parent. Unknown metadata and owned-PID reuse still block
cleanup. Three negative fixtures first reproduced the issue, then 200 adjacent
checks passed. Private receipts are indexed in `WORK_LOG.md`; no trace is
published as user data.

## 2026-11-06 — Edit only the connected companion's owner remark

Extend the existing directory with a detail view for its exact configured owner,
instead of adding another conversation toolbar control or exposing a generic
QQ action interface. The directory can browse accounts independently, so its
selected runtime must match the currently connected companion before editing is
offered. This changes that QQ's friend remark, not the person's nickname,
character identity or companion memory. Original panel/controller code reuses
the existing verified QQ client. No upstream implementation is copied.

Checked the installed NapCat 4.18.42 sources on 2026-11-06 at commit
`9335843246e3b7a17944861f3ac8731a259732c2`:
[SetFriendRemark](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/user/SetFriendRemark.ts)
accepts a QQ ID and remark and checks friendship. Its schema declares null, but
the `Promise<void>` handler can produce a successful envelope with omitted
`data`. Accept only those two empty forms after exact echo, status and numeric
zero return-code validation; the first packaged test exposed the null-only
compatibility error. See [the retained failure and fix](QQ_OWNER_REMARK.md);
[GetFriendList](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/user/GetFriendList.ts)
reads a base friend map. Its `no_cache` detail request does not establish a
fresh remote remark. Therefore separate request acceptance from matching,
different or unavailable cache observation. A comparison before writing is
not atomic server-side compare-and-set.

The main process retains the exact supported original value only for the open
panel. Saving consumes one short-lived ticket; a transport ambiguity requires
an explicit read before further action. Restore is another explicit write whose
target comes from that retained original, never a renderer-supplied friend or
restore value. Unsupported original values remain read-only instead of being
truncated. The application limit is 60 Unicode code points and 120 UTF-16 units,
not a claimed QQ protocol limit. The corrected ready package has one bounded
real change/readback/restoration pass, including independent cache comparisons;
see [evidence and remaining synchronization limits](QQ_OWNER_REMARK.md).

## 2026-11-06 — Generate a short QQ voice draft before sending

The manual WAV flow already has a real bounded send/readback. Requiring users
to prepare a file separately adds work, so extend the existing local Serena
GPT-SoVITS provider with an explicit text-to-WAV operation. Keep file selection
as the alternative; do not add a second voice model or cloud service. The
existing verified assets and [pinned local setup](VOICE_LOCAL_SETUP.md) remain
the baseline. No additional inference fee or automatic download is introduced;
the existing CUDA/Python setup and its clean-machine limitation remain.

Use the same single-window voice drawer: write a short sentence, generate,
listen, then separately send to the displayed owner. Configuration discovery
does not start a model, inspect a microphone or claim model readiness. Generation
does not read conversation history, open an audio device or send a message.
It accepts at most 120 Unicode code points / 240 UTF-16 units and rejects an
output over 30 seconds as a whole. Generated bytes receive the same scoped,
expiring, single-use ticket as selected WAVs.

One app-wide renderer owns one worker. In this first version it closes the
worker and confirms exit before publishing a draft; an unconfirmed exit blocks
replacement rather than accumulating processes. This trades repeated cold-load
latency for a simple, verifiable lifecycle. Retaining a warm model is a later
optimization requiring measurements. Framed PCM, a complete-stream hash and
late-cancellation checks prevent incomplete or superseded output from becoming
a sendable draft. These are implementation choices, not claims of novel TTS
research or superior perceived voice quality. Real model generation, UI use,
QQ acceptance and recipient playback are recorded separately in
[the voice evidence](QQ_VOICE.md).

## 2026-11-06 — Recover management records without guessing process identity

The component transaction guard and the configuration-edit marker can outlive
their owner after interruption. The previous PID-only/empty records cannot
establish their original process identity. Retain them rather than infer it
from a file timestamp. New records carry an observed process creation identity;
configuration markers also bind the exact owning component lock.

Use three separate inspect/confirm operations for the configuration marker,
recovery guard and component lock. One successful removal never cascades to
another or starts QQ. Preserve the committed result if later cleanup, UI close
or refresh fails, and show an unknown remaining-file state explicitly. The
session-only receipt contains no process paths, tokens or configuration values.
This adds a recovery path within the existing Electron architecture rather
than a second manager or another product window.

A Windows named pipe supplies a crash-lifetime recovery gate without creating
another durable recovery-lock file. This uses existing [Node IPC support](https://github.com/nodejs/node/blob/v24.22.1/doc/api/net.md#ipc-support)
and [Windows pipe lifetime](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-operations);
it carries no commands/data and does not claim a custom remote-access ACL.
No new dependency, network service or model call is required. The two agents'
independent review and focused runtime/coordinator/UI checks are recorded in
[recovery boundaries](QQ_COMPONENT_RECOVERY.md). Real writer-interruption and
packaged UI checks are separate from actual configuration-write crash recovery.

## 2026-11-06 — Explicit recovery of verified crash leftovers

A real packaged main-process crash exited the NapCat launcher but left five
QQ/console descendants. Their PID, creation time, executable and current parent
chain still matched the prior observation. The original recovery flow correctly
refused both takeover and duplicate start, but offered no way to finish this
bounded recovery inside the application.

Add a distinct inspect → review count/account → explicit cleanup operation.
Require the original manager and launcher to be gone, saved process proofs and
current parent chains to agree, no unrecorded descendants or competing manager,
and an unchanged digest-bound lease. Retain exact Windows process handles before
stopping any candidate. Confirm all recorded descendants are gone before removing
the old ownership record. Preserve incomplete/unknown records; never silently
clear a lock or use a process-name kill. Cleanup does not start QQ or authenticate.

Changing the launcher to detached mode was rejected as a way to manufacture a
successful adoption test. Node's Windows job behavior and native descendants
have distinct lifetimes; an unchanged process tree must be observed before
adoption can be claimed. References: deployed Electron 45.2.1's
[Node/libuv Windows job creation](https://github.com/nodejs/node/blob/v24.22.1/deps/uv/src/win/process.c#L69-L96),
[spawn assignment](https://github.com/nodejs/node/blob/v24.22.1/deps/uv/src/win/process.c#L1084-L1100),
and Microsoft's [TerminateProcess contract](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess).
Checked 2026-11-06. The actual failure is in private `outputs/qq-crash-live-*`
receipts; the new cleanup requires separate packaged acceptance.

## 2026-11-06 — Manual owner image sharing

Reuse Electron's existing native PNG/JPEG decoder and the fixed QQ private-send
contract for a small, explicit image flow. A main-process file picker supplies
bounded local bytes; re-encoding excludes original metadata. One expiring ticket
binds the profile, character, connection generation, real sender and configured
owner. The user reviews the recipient and preview before Send. A timeout after
submission remains unknown and cannot replay the same ticket.

This adds a result-sharing entrance without another model, image service or
group/recipient selector. It does not add incoming image understanding or an
autonomous media tool. Rich voice/media support remains separate. Official
interfaces, limits and source/native/UI checks are in [QQ image sharing](QQ_MEDIA.md).
The one-window convenience is a workflow hypothesis until actual use is checked.

## 2026-11-06 — streaming ZIP preparation without executing the component

Choose exact **yauzl 3.4.0** (MIT, Node >=12) for the existing Electron/Node
process; use exact **yazl 3.3.1** (MIT) only to generate original test fixtures.
The maintained [upstream parser](https://github.com/thejoshwolfe/yauzl) exposes
lazy entries, strict filenames, size validation and descriptor-based streams.
We add Windows-safe names, collision/link/bomb bounds, CRC32 and per-file
SHA-256, using the same verified ZIP descriptor. This avoids a new subprocess
protocol and hand-written archive parsing. Microsoft's mature
[ZipArchive](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.ziparchive)
was the alternative; a Windows .NET/PowerShell helper would add deployment,
cancellation and hashing boundaries without a benefit for this local Node flow.
Package metadata and upstream licenses were checked on 2026-11-06; versions
and transitive dependencies are locked in `package-lock.json`.

Only explicitly staged official Shell versions are accepted. A new version
directory and sorted hash manifest never overwrite installed code or data.
The official v4.18.42 archive actually produced 684 files and passed read-back;
29 temporary-fixture tests cover meaningful rejection and cancellation risks.
This is preparation evidence, not component launch or rollback acceptance.
See [the contract and exact limits](QQ_COMPONENT_PREPARED.md).

## 2026-11-06 — Original single-window local management

The owner selected an original Electron management layer and retained the current characters, AI adapters, memory and voice modules. Implementation now centers on one visible window, per-account process ownership, exact identity checks and safe recovery. The prior feasibility review below is historical; current status and unfinished work are tracked in [QQ integration](QQ_INTEGRATION.md) and [the active delivery scope](ACTIVE_GOAL.md).

The local WebUI adapter uses each account's observed runtime endpoint, verified against its process tree. Global `webui.json` was rejected as a routing source because it can hold the most recently started account's port. Raw management tokens stay in main; QR images receive an opaque runtime revision so the view clears them when that endpoint changes. Process proof checks executable path, PID and creation time; Windows `Get-Process` creation ticks are normalized to the precision exposed by CIM rather than falsely rejecting the same process.

Configuration creation/editing and importing a bridge into an AI profile are separate operations. Original bytes are backed up privately, unknown configuration fields are preserved, and competing managers block writes. A saved configuration, live QQ login, verified owner relationship and completed AI task are distinct results. A new expected-QQ binding rejects a wrong account at first connection and on reconnect. No arbitrary frontend WebUI, group activity or message replay is added by these controls.

The frontend borrows NapCat Desktop's compact navigation, warm surfaces and clear account identity; Things provides a second reference for reading density and progressive detail. Both are transformed into the existing conversation-first interface with original avatars; [visual analysis and screenshots](UI_REFERENCES.md) record the boundaries. Isolated UI/protocol tests and read-only checks of installed accounts have passed within their stated scope. Real managed migration/start/stop, integrated authentication, excluded-friend Qzone visibility and spoken interruption remain unaccepted. Further billing/store discussion is deferred while this functionality is implemented.

## 2026-11-05 — NapCat integration feasibility and single-app direction

**Owner request:** assess bringing NapCat functionality and its desktop visual style into Agent Arcade so daily use needs one visible application. This review changes no running accounts, credentials, installation, source licensing or release. Remaining companion acceptance stays deferred as requested.

**License distinction, checked against upstream on 2026-11-05:** NapCatQQ [main LICENSE](https://github.com/NapNeko/NapCatQQ/blob/main/LICENSE) and the installed [v4.18.42 LICENSE](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/LICENSE) use the Limited Redistribution License for NapCat. It prohibits commercial use and public release of modified code, requires retained license/source/copyright for redistribution, and refers additional rights to the author. Source visibility must not be described as unrestricted open-source reuse; these restrictions do not meet the [OSI definition](https://opensource.org/osd). NapCatQQ Desktop [v3.5.19 LICENSE](https://github.com/NapNeko/NapCatQQ-Desktop/blob/v3.5.19/LICENSE) is GPL version 3. Reusing Desktop code requires its applicable notices, corresponding-source and combined-work obligations; it cannot simply be relabeled as this project's MIT code. Desktop's license does not grant rights to the separately licensed core or Tencent QQ. A modified all-in-one public distribution therefore cannot be assumed permitted. Any eventual bundled distribution needs a concrete component/license review, and permissions beyond the core license need its author's grant. Merely separating processes does not remove these restrictions.

**Technical finding:** the existing `src/bot/account-manager.cjs` manages AI profiles; `src/bot/qq-setup.cjs` exports OneBot connection configuration and links to external setup. Neither owns the QQ/NapCat process lifecycle. Upstream [QQLogin routes](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-webui-backend/src/router/QQLogin.ts) expose QR retrieval/refresh, login status and quick login. These support a potential in-app login view through an authenticated local adapter. Desktop's own lifecycle is Rust/Tauri-backed; its [UI transport](https://github.com/NapNeko/NapCatQQ-Desktop/blob/v3.5.19/src-ui/core/ipc/transport.ts) depends on Tauri invoke/listen. Embedding those pages alone would not supply a working Electron account manager. This is source-level feasibility, not a tested embedded login flow.

**Recommended direction:** preserve Electron and current AI/voice/memory modules, independently implement a local component manager around separately installed, unmodified QQ/NapCat, retain OneBot for messages, and use narrowly scoped local management endpoints for login/status. The user sees one window while QQ/NapCat still run as separate processes. Initial concrete scope would be account selection, QR refresh, identity-checked connection, start/stop, logs and failure recovery. Installation/update ownership, migration rollback and avoiding simultaneous control by two managers must be resolved before taking over the existing instances. An alternative wholesale Desktop fork would introduce React/Tauri/Rust migration or a new backend bridge and GPL distribution work, while still leaving the core-license restrictions; it is not selected by this feasibility review.

**Visual reference and boundary:** the owner's actual Desktop screenshot shows a narrow icon rail, warm neutral surfaces, orange primary actions, avatar/name/account identity, and explicit runtime/login states. Borrow this hierarchy for account management while preserving original character art and a conversation-led main view. Do not copy upstream logos, assets or frontend code under an assumed MIT grant. No redesigned interface or second visual-reference analysis is claimed in this review.

**Limits:** bringing capabilities into one window is not equivalent to implementing every NapCat endpoint or every QQ feature. Friend/group administration and additional autonomous-contact scope remain separate work. This integration would not prevent Tencent session expiry, guarantee fewer processes or establish lower resource use. No account or group permission has been expanded.

## 2026-11-04 — GPT API beside native Codex and DeepSeek

**Task and scope:** make GPT and DeepSeek selectable for ordinary chat and approved file tasks through either implemented messaging channel. GPT API is separate from native Codex authentication/execution. Keep Electron, existing portraits, single-owner dispatch, QQ onboarding and per-provider credentials; no account scraping, new bridge or all-in-one framework.

**Protocol choice:** current [Sol documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) requires Responses for tool calling. Use native fetch to the fixed endpoint, strict schemas, no parallel local tool execution, explicit encrypted reasoning inclusion and `store:false`. Retain required reasoning/phase items only in memory; incomplete responses do not run partial tools. [Function calling](https://developers.openai.com/api/docs/guides/function-calling), [reasoning](https://developers.openai.com/api/docs/guides/reasoning), [conversation state](https://developers.openai.com/api/docs/guides/conversation-state), checked 2026-11-04. Sol is the default; Astra is optional. No new SDK is required for this bounded text/function loop. The tradeoff is maintaining our small response parser; a full Agents SDK or hosted agent environment would add lifecycle and execution semantics this milestone does not need.

**DeepSeek baseline:** keep its own Chat Completions implementation. Current official [models](https://api-docs.deepseek.com/quick_start/pricing/), [tools](https://api-docs.deepseek.com/guides/tool_calls/) and [thinking contract](https://api-docs.deepseek.com/guides/thinking_mode/) match the existing adapter. Extract its file validation/execution into a shared module so GPT adds no second permission/path implementation. This changes internal ownership, not the tool scope. Safe local API diagnostics now reach chat without relaying raw error bodies or partial model success text.

**UI choice and evidence:** reuse the established [conversation references](UI_REFERENCES.md), execution-method field and Connections catalog instead of adding another setup page. GPT/Codex share the project's original Dragon Girl; DeepSeek remains Whale Girl. Model choices and saved-key flags follow the selected provider, and an unsaved key clears through either navigation route. Source UI and deterministic chat/file/permission/cancel flows pass; actual paid provider availability and social-account delivery remain unaccepted. Benefits are choice and consistent permission behavior; no quality, latency, cost-saving or usability superiority has been measured. See [current validation](VALIDATION.md).

## 2026-11-04 — make personal QQ setup reviewable

**Task:** prioritize the ordinary friend-account experience already demonstrated by Bothouse. Read-only inspection of the local Bothouse GPT/Claude QQ adapter confirmed the same forward OneBot WebSocket architecture: separate account login and bridge setup, no automatic friend acceptance. Keep our adapter; adopting the larger framework would not remove those account steps.

**Choice:** add ordered setup inside the existing conversation sidebar, fixed upstream download/guide links, OS-encrypted token preparation and main-process-only clipboard export. Preserve existing tokens and other bridge settings. Read-only identity/online/friendship checks replace the ambiguous “settings saved = connected” assumption. A full setup wizard was the alternative; the sidebar needs less navigation and preserves conversation context. The design reuses the two already analyzed conversation references in [UI_REFERENCES](UI_REFERENCES.md), with no copied assets or new visual overhaul.

**Current primary sources:** [OneBot account/status/friend APIs](https://github.com/botuniverse/onebot-11/blob/master/api/public.md), [NapCat connection schema](https://github.com/NapNeko/NapCatQQ/blob/main/packages/napcat-onebot/config/config.ts), and [NapCat Desktop connection guide](https://napneko.github.io/NapCatQQ-Desktop/docs/connections/), checked 2026-11-04. Desktop latest resolved to v3.5.18; the guide names v3.5.2. This is source/document inspection, not release compatibility acceptance. The exported JSON is one NapCat websocketServers entry; Desktop's form has its own Universal/API+events and root-path controls.

**Benefit and cost:** the app can show the actual account to add and explain offline/wrong-owner/non-friend failures before starting an AI. Compared with manual configuration, this removes token creation and protocol-format lookup from routine setup; no timed usability improvement has been measured. Two bounded metadata RPCs add setup/reconnect work. Friend data is reduced to one boolean and discarded. Missing optional API support remains unknown. No new dependency, proprietary login, bridge installation, automatic approval or group/multi-user access is added. Actual QQ account acceptance remains pending because no spare account is available.

## 2026-11-04 — personal QQ channel, local Codex and DeepSeek API

**Task and boundary:** the owner wants an AI with its own social account that can be added as a friend. QQ therefore connects to a separately logged-in personal-account OneBot bridge, not QQ OpenAPI. Current WeChat remains ClawBot; an ordinary WeChat friend's autonomous account is not implemented. The owner has no spare QQ yet and explicitly chose code and local acceptance for this milestone. One channel, one allowed private sender, one selected backend and one workspace remain active at a time; group/multi-friend routing is not implied.

**Incremental choice:** preserve Electron, the light conversation UI, permission dispatcher and personas. Add three adapters instead of adopting an all-in-one bot framework. For Codex, official [App Server](https://learn.chatgpt.com/docs/app-server) supplies correlated threads, turn events, approvals and interruption, unlike parsing terminal/exec output. It was checked against local CLI `0.166.0-alpha.6` schemas. It reuses original login and inherits original configuration; it is not the isolated API runner. The cost is maintaining an evolving protocol, not a separate API subscription.

**QQ:** [NapCat's documented OneBot connection](https://napneko.github.io/NapCatQQ-Desktop/docs/connections/) provides the personal-account shape requested. Use standard forward WebSocket with loopback-only address and Bearer token (`ws` pinned to 8.22.1); no QQ client, installer or NapCat code is bundled. This avoids implementing proprietary login but depends on an unofficial bridge, upstream terms and account availability. Tencent's [WeChat agreement](https://oper.my-qcloud.com/cgi-bin/readtemplate?lang=zh_CN&s=default&t=weixin_agreement) restricts unauthorized integrations; ClawBot evidence cannot establish a supported ordinary-account API. No personal WeChat availability or account safety is promised. [Setup](QQ.md).

**DeepSeek:** use its fixed official HTTPS chat endpoint and native fetch. Current [models](https://api-docs.deepseek.com/quick_start/pricing/) are `deepseek-flash` (default) and `deepseek-v4-pro`; [tool calling](https://api-docs.deepseek.com/guides/tool_calls/) supplies structured requests. A direct runner avoids assuming Claude SDK-compatible permissions. It provides approved Read/Write/Edit/List/question actions, no shell. History is bounded and in memory. Thinking defaults off; required [reasoning context](https://api-docs.deepseek.com/guides/thinking_mode/) is preserved if enabled through the runner API. There is API billing without a dollar-budget guarantee. No extra model SDK. Sources checked 2026-11-04.

**Demonstrable benefit:** one channel/permission UI routes to independent execution backends and their own characters, while a reply stays distinct from checked results. Direct real Codex chat, same-thread 22-byte artifact and confirmed turn interruption passed; QQ WebSocket and DeepSeek/model fixtures exercise the other paths. Remote QQ and live DeepSeek utility remain unverified; no comparative speed, usability or novelty claim. Reviews caught and fixed unsaved key carryover between providers and same-socket QQ account switching. [Evidence](VALIDATION.md#qq-local-codex-and-deepseek--localsource-2026-11-04).

**UI boundary:** reuse the established conversation-first references in [UI_REFERENCES](UI_REFERENCES.md). Channel and backend settings remain separate; original character assets follow the backend. Configuration, connected state and acceptance evidence are distinct. No new borrowed artwork or visual redesign.

## WeChat control without a second terminal protocol — 2026-11-04

**Decision:** keep the original interactive Claude Code and Channels route, but let the Windows app open its own visible CLI console and record its exact PID, UTC creation time, executable path and generated session UUID. Typed `停止`/`/cancel` can then request force termination of that verified process tree; `恢复会话`/`/resume` explicitly opens the same project's UUID. Manual launches remain unowned. No login credential, terminal keystroke protocol, new PTY dependency or global process-name kill is introduced.

**Baseline and benefit:** copying a command and stopping the CLI manually remains the fallback. The new path removes routine launch-command copying and gives the app a concrete stop target. One controlled live Windows flow now demonstrates those actions, but there is no measured interruption, latency or cost improvement against a baseline. The costs are Windows-specific lifecycle code, force-stop semantics, bounded metadata and recovery failure cases. Force stop is not rollback or graceful tool cancellation, and it does not prove independent jobs stopped.

**Official checks:** local Claude Code **2.1.317** `stop --help` and `respawn --help` limit these commands to background sessions; they cannot be used as an interactive-session interrupt. The [CLI reference](https://code.claude.com/docs/en/cli-reference) documents exact `--session-id`/`--resume` and interactive confirmation for development Channels. [Agent view](https://code.claude.com/docs/en/agent-view) documents background-process handoff and `CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF=1`; set it only in newly launched processes, without assuming old sessions or detached jobs are controlled. Background + Channels remains a separate unaccepted composition.

Microsoft's [Start-Process reference](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process) and [taskkill reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill), checked 2026-11-04, support the mature Windows mechanism. A hidden, profile-free PowerShell launcher opens the visible CLI and returns process metadata. Before `/PID … /T /F`, identity is checked and its process handle retained; only main-process exit is read back. Restored metadata never grants an app restart stop ownership. This avoids an extra native dependency, but does not provide OS containment.

**Permission and reconnect choice:** keep explicit authority while reducing entry burden to `同意 CODE`/`拒绝 CODE` with six-character, expiring, rate-limited aliases. `状态` resends the same request without extending its TTL. A casual “好的”, quoted text or transcription cannot approve. The [Channels permission reference](https://code.claude.com/docs/en/channels-reference#relay-permission-prompts) still makes local-first races and one-operation decisions explicit. Successful ordinary forwarding stays silent; native replies carry no fixed result prefix.

For temporary local HTTP poll failure, preserve the stdio connection/client/cursor for at most 30 seconds after the first error, with 250 ms initial exponential backoff capped at 2 seconds. Never retry an uncertain MCP write or silently replay input. [Official MCP reconnection](https://code.claude.com/docs/en/mcp#automatic-reconnection) requires manual reconnect for an exited interactive stdio server; that is different from keeping our still-running relay alive through a transient local request failure. Permanent denial, bad data and a cursor gap still close the channel. This is not an all-network or app-crash recovery guarantee.

**Evidence and limits:** current full-suite checkpoint is 206 passed/one opt-in skipped. One real WeChat/local Claude run passed natural chat, independent 21-byte artifact verification, allow/deny, stopping an active bounded Node task with its Claude parent, app restart and same-UUID recovery followed by a fresh reply. Recovery required the owner's original-CLI confirmation. The live run exposed bare confirmation codes being forwarded; a targeted fix now gives format guidance without authorizing or forwarding the issued code, and the rebuilt app passed that live counterexample. Broader reliability, API mode, voice/quotes, sleep/outage recovery and detached jobs remain unaccepted. See [validation](VALIDATION.md#wechat-control-and-recovery--localsource-2026-11-04) and [sanitized receipt](evidence/wechat-flow-20261104.json); older decisions below describe their historical versions.

## Default AI personas — 2026-11-04

The owner's latest clarification explicitly selects the community mapping **Claude = Ju, Codex = Dragon Girl**, replacing the earlier Claude dragon choice. Keep DeepSeek Whale Girl, Gemini Rainbow Cat and a short-haired Doubao helper. The owner also confirmed anime avatars, names and light conversational style together. There is no verified universal popularity ranking; the Doubao appearance is a project choice. [Sources, exact generation prompts and asset provenance](PERSONAS.md).

Compared with one shared Sprout avatar, provider-specific portraits make the selected identity visible; better recognition remains a usability hypothesis. The active portraits were generated independently without copied reference images. The latest Ju asset adds about 2 MB to the earlier 9.3 MB of generated PNGs; the unused earlier Claude dragon is preserved. No runtime dependency, extra model request or new provider integration is introduced. Sprout and pixel appearance remain selectable. A fixed, optional style block follows the existing API/native instructions; it does not change authority, factual reporting or response-boundary semantics. Original artwork avoids depending on unverified redistribution terms of downloaded community images.

Source and packaged UI/protocol checks passed; real-model adherence to the voice and phone-side persona replies are unverified. [Validation record](VALIDATION.md#default-personas--localsource-revision-2026-11-04).

The 2026-11-04 working-desktop revision and its visual/HCI evidence are recorded in [UI_REFERENCES.md](UI_REFERENCES.md). It keeps the existing event and execution contracts while simplifying navigation, setup and conversation hierarchy.

Reviewed **2026-11-03** for the Windows preview. This record explains the retained design and the validation work; it is not a claim that live acceptance or a comparative user study has passed. See [VALIDATION.md](VALIDATION.md) for measured results and remaining checks.

## Decision: keep the current observation architecture

Keep **Electron + short-lived Node observer + bounded local inbox + deterministic reducer**. Keep Sprout Bot, Moss Workshop and Lunar Post. The user needs to find the session that needs intervention while another session keeps working. A new framework or a new character does not resolve the current accuracy risks.

| Choice and current evidence | Practical benefit over the baseline | Cost, boundary and fallback |
| --- | --- | --- |
| Official Claude Code lifecycle hooks, not screen/image classification. [Hook reference](https://code.claude.com/docs/en/hooks); [official v2.1.316 release](https://github.com/anthropics/claude-code/releases/tag/v2.1.316), checked 2026-11-03. | Explicit session/tool identities and response boundaries can be tested deterministically. No vision model, recurring inference charge or continuous screen access is needed. | Hook coverage depends on the installed Claude version. Missing events remain uncertain; terminal inspection is the fallback. Reading current docs does not prove the installed version emits every field. |
| Electron **45.2.1** is pinned in `package.json`. The [official release record](https://releases.electronjs.org/release/v45.2.1) identifies it as stable, released 2026-10-30, including Chromium fixes. | Retains the working renderer, tray, notifications and package pipeline. Compared with a browser-only page, it supports a persistent desktop window and OS integration. | Electron has a multi-process runtime and a larger binary than a minimal native shell. CPU, memory, DPI and suspend/resume need measurements. No measured bottleneck currently justifies a Tauri/native rewrite and its integration cost. |
| Local file inbox rather than a new HTTP/WebSocket service. | Hooks can leave observations while the scene is closed. Atomic files and replay IDs give a simple recovery path without a port, authentication token or server lifetime. | A one-second polling interval introduces bounded nominal UI delay; disk scheduling and process startup can add more. Latency is not yet a measured guarantee. Retain bounded input/queue/history and measure before considering a persistent transport. |
| Declarative sprites and colors rather than executable theme plugins. | Community artwork can change the scene without acquiring filesystem or command privileges. Local assets also work without an account or network connection. | Seven fixed state sprites are deliberately limited. Keep labels controlled by the app; reject scripts, remote fonts/images and oversized JSON. |

Direct development dependencies are pinned (Electron 45.2.1, electron-builder 26.18.1, Playwright 1.64.1). A resolved lockfile is required for reproducible installs; pins alone do not lock transitive dependencies. Node 22+ is the documented observer baseline. The scene and reducer need no model or cloud account; **real Claude Code tasks still use the user's existing Claude access and may incur its normal usage costs**.

The installed electron-builder 26.18.1 official schema also distinguishes `signExecutable: false` from `signAndEditExecutable: false`: the latter disables resource editing, leaving Electron's name/version/icon in the executable. Inspection of the first local package confirmed that problem. Use `signExecutable: false` to keep original app resources while producing an explicitly unsigned preview; verify the rebuilt executable metadata.

## Official semantics that constrain the product

The following are summaries of the [current hook contract](https://code.claude.com/docs/en/hooks), not task-success evidence:

- `Stop` observes the main agent finishing a response. Interruptions do not necessarily emit it; API failures use `StopFailure`. Other Stop hooks can continue the turn.
- `PostToolUseFailure` records a tool failure, which may be followed by recovery. Permission denial and pre-execution validation rejection have different coverage.
- `background_tasks` and `session_crons` can reveal work/wakeups remaining after a response. On `SubagentStop` those arrays describe the **parent** registry.
- `last_assistant_message` avoids transcript scraping but is only response text. A child using `SubagentHandback` can deliver its report earlier, so its closing text is not necessarily the report.
- A notification's type matters: idle reminders must not be treated as permission requests.
- Current command hooks support **exec form**: `command` is the Node executable and `args` contains the observer path. This avoids shell interpretation and Windows quoted-string pitfalls. Use it with a tested supported version; do not silently claim compatibility with older versions.

Product wording must expose this distinction at the station itself: **“Response ended / 回复结束”** describes the observation; “task passed” requires independent checks outside this observer. A parcel opens the saved reply when capture was enabled; it is not a validation badge. The first preview's earlier **“Ready / 已交付”** labels and completion wording were a gap to correct, even though the settings explained the limitation.

## Safety and privacy checks within this architecture

The [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security) recommends current dependencies, renderer isolation, sandboxing, CSP and sender validation. Source inspection found explicit `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`; navigation/new windows are denied; IPC checks the main frame, sender and exact local page. Preload exposes specific methods, and replies are rendered as text. These are useful controls, **not a full security audit**. Verify packaged behavior as well as source configuration.

Keep notifications opt-in and silent, with quiet mode, focus suppression, recent-event filtering and per-station cooldown. Keep result capture off by default. No prompts, tool arguments, raw errors or transcript paths belong in the inbox or screenshots. A future deep link should be an explicit validated integration, never a shell command assembled from event text. Protecting attention and local data is part of the product, not an optional theme feature.

## A demonstrable highlight, and the evidence still needed

**Demonstration:** session A needs permission; session B is still building. The user identifies A from its labeled station, responds in Claude Code, sees A resume, then observes a response boundary. A deliberately failed tool can recover; a response that says a requested check failed must still read “Response ended”, not “success”. Repeat with quiet mode and with the app focused.

The narrow differentiating hypothesis is **persistent, individually identifiable multi-session status with restrained, evidence-based feedback**. Correct event-to-state mapping is testable now. Faster recognition, fewer terminal checks and lower interruption cost remain hypotheses until a comparison is run.

| Closest alternative / baseline | What is established by its own materials | What Agent Arcade should test, without assuming superiority |
| --- | --- | --- |
| [PeonPing official repository](https://github.com/PeonPing/peon-ping), reviewed 2026-11-03 | It already provides agent sound/visual notifications, naming, packs, mute controls and focus-related options. Platform support varies; some focus features are macOS-specific. Its docs describe terminal title and multi-pane limitations. | Compare a persistent station map against event alerts for two or more concurrent sessions. Animated characters, silence controls and customization alone are not new advantages. No head-to-head run has been completed. |
| Claude Code's own terminal/session UI and official hook notifications | The source tool remains the authority for permission decisions, full context and results. | Compare the number of terminal switches needed to find the waiting session. The scene loses detail and cannot approve permissions or currently jump directly into the correct terminal. |

For a later comparison, predefine the same event sequence, two sessions, starting windows, notification settings and tasks for both conditions. Record correct session identification, time to identify/resume, terminal switches, emitted notifications and false success interpretations. Report raw observations and sample size. An event replay or an attractive screenshot cannot establish these human outcomes.

## Visual and content references actually inspected

Two official static visuals were opened at full size on 2026-11-03. They were used for analysis only, saved in a temporary directory and **not added to the repository or used as shipped assets**. No hands-on use of either app/game is claimed. Static visuals cannot verify animation timing or interaction quality.

| Specific reference and observed detail | Principle → conversion into Agent Arcade | Boundary |
| --- | --- | --- |
| [CapWords official site](https://capwords.app/), specifically its [Blueberry Yogurt flashcard image](https://framerusercontent.com/images/ygzmWxzEXOhAvGAGc06NcOX9vQ.png?height=2200&width=1626): one cutout object, a clear white outline, a large object name and quieter pronunciation line. Apple lists CapWords as the **2025 Delight and Fun app winner**, not a finalist, on its [award record](https://developer.apple.com/design/awards/2025/). | A playful object earns its place by anchoring concrete information. Convert that into one Sprout Bot + state prop + explicit response/permission label; keep event evidence in a secondary detail view. Object and language should explain the same fact. | Do not copy the photos, sticker styling, typography or sounds. No claim that its learning outcomes transfer to monitoring. The static image does not demonstrate the transition animation; the award does not establish suitability for Windows. |
| Apple's [2026 Is This Seat Taken? screenshot](https://www.apple.com/newsroom/images/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/article/Apple-WWDC26-Apple-Design-Awards-Is-This-Seat-Taken_big.jpg.large.jpg), linked from the [official winner announcement](https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/): bounded bus seats organize distinct characters; the selected character's request appears separately from the scene. It is the **2026 Delight and Fun game winner**. | Spatial grouping helps identify individual actors, while a separate explanation handles detail. Retain stable per-session stations, distinct work/attention/parcel silhouettes and a detail dialog for timestamped events. Preserve task names in compact mode. | Monitoring should not inherit puzzles, objectives, scores, waiting for animations or game-driven urgency. Do not copy characters, bus art, textures or dialogue. No player testing or causal readability result is inferred from the screenshot. |

### Project expression and scope

Two feasible directions were considered: a text-first event list with a small character icon, or the existing set of miniature workstations with a separate event view. Retain the workstations: they preserve the project's authored identity and make per-session locations the memorable element. The event list remains the accurate detail/fallback. This is a refinement, not a layout or art replacement.

- **Color:** Moss ink `#243C37`, sky `#EDF2E7`, floor `#DCE6D2`, attention amber `#EFB856`; Lunar ink `#343954`, sky `#E2E5F1`, floor `#CBD1E3`. State words and props carry meaning alongside color.
- **Type:** local system sans (`Segoe UI`, `Microsoft YaHei`, sans-serif fallback), no downloaded font. Existing hierarchy: page heading 28–32 px, section heading 14 px, task name 12 px, status/detail text 9–12 px. Small status text needs a real scaling/readability check; the declared sizes are not accessibility evidence.
- **Space/density:** keep each station's name/state above its scene and fact/age below; 18 px full-view grid gap, 10 px compact gap. Multiple stations should remain identifiable without decorative metrics expanding their footprint.
- **Motion:** work, attention, smoke and parcel correspond to observed states. Reduced-motion mode must preserve props/labels; absence of motion cannot mean absence of status. Do not add entry animations or audio to compensate for ambiguous wording.
- **Language:** action text says what happens (“Install hooks”, “Open response”, “Clear responses”), status says what was observed. Both languages must preserve “response ended ≠ independently verified success”. Use synthetic examples only where visibly marked as demo.

These references inform structure and semantics. Original Sprout Bot pixels and scene vectors remain MIT project assets; third-party reference images remain their owners' works. Current local UI screenshots, genuine event receipts, resource measurements and pending Windows acceptance belong in [VALIDATION.md](VALIDATION.md), not in marketing claims.

## 0.1.3 observation and idle-delivery refinement

The [official hook contract](https://code.claude.com/docs/en/hooks#tools-that-require-user-interaction) treats AskUserQuestion and ExitPlanMode as user-interaction tools. A real 2.1.317 AskUserQuestion flow emitted PreToolUse, PermissionRequest and a generic permission_prompt notification before the answer. Preserve the specific question meaning through those events instead of relabeling it as operation approval. Track question IDs alongside pending approvals so parallel completions and saved-state restoration keep their meaning. A 100-entry pending limit retains uncertainty on overflow rather than treating dropped requests as granted.

Keep the one-second inbox poll, but deduplicate unchanged renderer snapshots and update relative ages locally. This removes repeated IPC copies and structural rendering without a new transport or framework. A narrow [baseline/current probe](evidence/snapshot-probe.json) confirmed zero repeated snapshots in each sampled idle window while ages, new events and uncertainty still updated. A cached JSON fingerprint consumes additional bounded memory; no CPU/RSS improvement is inferred from message counts, and the 0.1.2 memory result remains the published baseline.

Real Esc cancellation emitted no terminal hook. The UI consequently labels its section “Recent observations / 最近观测”; the last running observation becomes uncertain after five minutes. This makes the boundary visible without inventing an immediate cancellation signal or replacing the original character/theme direction.

## 0.2: owner-operated WeChat task bot

**Decision, 2026-11-03:** the user explicitly changed the workflow to sending a WeChat message that dispatches work. Preserve Electron, Sprout Bot, both themes and the tested observer. Add separate execution modules and a task inbox. This supersedes the observation-only scope for the optional bot; characters still cannot approve actions.

- **Execution:** pin official Claude Agent SDK **0.3.317** / native **2.1.317**. A CLI `-p` process is the baseline; the SDK runs the same loop with maintained permission, stream, session and cancellation APIs, avoiding a second internal-control-protocol implementation. It adds dependencies, a bundled binary, paid API calls and an execution attack surface. No latency/memory/cost improvement is claimed. Current official sources and version controls are in [BOT_TECH_NOTES.md](BOT_TECH_NOTES.md). A real invalid-key run returned an authentication error without tool approval or subscription fallback; valid-key execution remains pending.
- **WeChat:** use the Tencent iLink protocol at **[874637a0dbc24050f72d1385add4fc6170a2d726](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/docs/protocol_zh_CN.md)** (upstream main 2026-10-13, checked 2026-11-03). The mature alternative is [Tencent's OpenClaw Weixin plugin](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/README.zh_CN.md) and gateway. Only QR/long-poll/text are implemented here to retain this desktop/Claude boundary without another agent gateway. This costs protocol maintenance and omits its media/multi-account/routing. The client document is not a complete service guarantee. Unsupported service/login behavior fails clearly; adopting the maintained gateway is the fallback, not a universal-account promise.
- **Authority:** require owner pairing, an API key under SDK terms, OS encryption and explicit single-use tool confirmation. Native Windows is not a sandbox. No automatic connect/replay/resume after restart. Dispatcher messages are never interpolated into shell command strings.
- **Substitutes/claim:** OpenClaw's official channel already offers conversational access. [QClaw](https://www.tencent.com/tencent-launches-qclaw-globally-lowering-barriers-to-ai-agent-deployment/) already describes remote tasks; this 2026-04-21 international announcement concerns WhatsApp/Telegram and is not evidence of domestic WeChat behavior. PeonPing remains the observer-notification baseline. Chat dispatch is not claimed novel or superior. The testable focus is **one owned task's request/approval/cancel/result remains correlated, and an ended reply never becomes verified success**. The protocol fixture demonstrates logic; lower interruption/terminal switching and service reliability remain hypotheses without a user comparison.

**UI choice:** setup + an evidence-oriented task inbox, rather than embedding a second full chat client or replacing the scene with a generic dashboard. The primary action is “Start receiving tasks”; conversation stays in WeChat. A narrow setup column and wider reading column stack in compact mode. Reuse Moss colors and local sans/CJK fallback: 28–32 px heading, 17 px section title, 12–13 px body, 11 px secondary text. Movement reflects running/waiting/ended; text retains meaning with reduced motion.

Reuse the two actual visual inspections above: **CapWords' object + concrete label** becomes Sprout Bot beside the task fact; **Is This Seat Taken?'s actor + separate request** becomes stable identity plus readable parameters/results. Educational/game interactions, artwork and fonts do not transfer. Static visuals provide structure, not proof of animation/usability. No third-party art is shipped.

**Evidence:** 91 automated checks, mock protocol output, actual Electron UI/OS-vault checks, native binary startup and a real QR request; see [VALIDATION.md](VALIDATION.md). Real WeChat/paid-task receipt, resource impact and comparison with mature alternatives remain unverified. Original code/assets are MIT; [SDK terms remain separate](../THIRD_PARTY_NOTICES.md).

### Clarify the actual ClawBot entrance (preview.2)

Checked 2026-11-03: Tencent's [2026-09-30 channel guide](https://intl.cloud.tencent.com/zh/document/product/1316/84459) names the phone's WeChat → Me → Settings → Plugins → ClawBot entry and the ClawBot conversation. The [2026-09-07 integration guide](https://cloud.tencent.com/document/product/1831/137450) treats an actual returned WeChat result as acceptance, not an online badge. The [upstream maintainer](https://github.com/Tencent/openclaw-weixin/issues/52#issuecomment-4407647606) confirms bot conversation messages, not sending as the personal account to friends. The [2026-03-23 official release record](https://cloud.tencent.com/document/product/213/130654) also names Android QR support; iOS-only wording from one guide is not a full availability matrix. Windows WeChat entry/version and independent-client service eligibility remain unverified.

Move pairing before execution setup and name the real destination. Keep credentials issued, channel online, incoming text received and send accepted distinct. This addresses an observed onboarding gap without replacing Electron, adding OpenClaw or changing characters. It does not prove service delivery. Native desktop automation was unavailable during this continuation; no social message, phone authorization or permission approval was automated, and real acceptance remains pending.

## 0.3: retain API and add the original local Claude Code CLI

**Decision, 2026-11-03:** the user explicitly requested both entry points. Keep API mode and its managed SDK task contract as the default. Add an optional local mode using the user's original interactive Claude Code and [official Channels](https://code.claude.com/docs/en/channels). This retains Electron, Sprout Bot, themes, WeChat pairing and the observer. It does not route a subscription credential through the SDK or add a Claude sign-in flow to Agent Arcade.

The baseline is the existing API key + SDK runner: bounded serial tasks, per-tool host approval, tracked response result and app-managed abort. Local mode's practical benefit is using the CLI's own existing login/session without an additional Agent Arcade API key. Costs are a persistent local terminal, explicit development-channel consent, a loopback broker/Node MCP process and research-preview protocol maintenance. Keeping API mode also keeps the bundled SDK/native runtime; no package-size, performance or cost improvement is claimed.

Current [channel reference](https://code.claude.com/docs/en/channels-reference) requires custom channels to use `--dangerously-load-development-channels` with interactive confirmation; the flag is ignored in `-p`/SDK runs. It bypasses only the channel allowlist, not tool permissions or organization policy. Original CLI authentication and usage remain with Anthropic's flow; see [authentication/credential boundaries](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use). We require the locally checked CLI **2.1.317+**, Node **22.13+**, and pin MCP SDK **1.32.2** / zod **4.6.7**. The current Node stdio fixture negotiated MCP **2025-11-25**; a future protocol revision must be rechecked against Channels registration compatibility.

The selected design uses a random-port, capability-authenticated `127.0.0.1` broker in Electron. The channel receives only a temporary relay capability, not the app's WeChat token/API key or Claude credentials. A private MCP config is generated per connection and removed on close where possible; revocation makes stale files unusable. This avoids implementing Claude's internal stdin control protocol. System Node requires the channel and dependencies outside ASAR, an explicit packaging/sidecar verification target.

State/authority differs deliberately: native messages can combine, MCP initialization is not model receipt, reply submission is not a response boundary, and a remote permission verdict is not proof of adoption. Native permission previews are upstream display text, not complete raw arguments; elided/redacted/oversized values fail closed remotely. The existing CLI's read/allow rules remain authoritative. `/cancel` stops new relay input and sends pending denials; real interruption stays in the original terminal with Ctrl+C. Stop/new-session semantics are not silently copied from the API Dispatcher.

The UI adds a method selector and conditional setup text in the existing column; switching is disabled during a connection and keeps the API key. The local character stays idle unless a real relay permission is pending, rather than animating guessed execution/completion. Existing inspected references continue to inform actor + concrete fact; this is no new art direction. Original-CLI registration and a basic native WeChat/file/reply flow subsequently passed on 2026-11-04 with preview.1; [VALIDATION.md](VALIDATION.md) separates that evidence from fixtures and the remaining verdict-race/stop/recovery checks.

### 0.3.0-preview.2: natural native conversation

**Decision, 2026-11-04:** the live preview.1 route required approving the reply tool even for ordinary conversation, and injected transport/result boilerplate into chat. Keep API mode's existing approval contract. For native mode, launch with `--allowedTools mcp__agent-arcade-wechat__reply --permission-mode default`: allow this exact return path for the current session, without permanent settings, wildcard tools or permission bypass. Existing deny/ask rules, hooks and organization policy still apply. The [official CLI flag reference](https://code.claude.com/docs/en/cli-reference) and [MCP rule syntax](https://code.claude.com/docs/en/permissions#mcp) were checked on this date.

The baseline is repeated one-time approval for ordinary replies; the alternative of disabling permissions would widen execution authority and is rejected. The practical intended benefit is fewer approval messages during conversation. Successful forwarding now stays silent and reply bodies have no fixed result/unverified prefix. Necessary permissions/errors remain visible; channel instructions still require evidence for work claims. Model adherence and reduced interruption remain to be verified with preview.2, not inferred from the earlier live run.

Keep the same setup/scene and original assets. Move MCP/counter details behind the existing desktop connection-details disclosure so the main text answers what to do next. This follows the existing actor + concrete fact references; no new visual system or third-party artwork is introduced. The earlier live Write artifact is independently evidenced, while native `/cancel`, reconnect, approval races, forced Write permission and API live flow remain outside that acceptance.

### Chat-led UI reconstruction

**Decision, 2026-11-04:** after reviewing the previous working-desktop layout, the owner explicitly selected a refined chat tool with the original character as an accent. Replace the wide workspace sidebar and repeated titles with a narrow navigation rail, a readable transcript and an optional connection inspector. The scene-led alternative was considered and declined by the owner. Reference observations, palette, typography and adaptation boundaries are in [UI_REFERENCES.md](UI_REFERENCES.md).

The intended benefit is easier reading and less setup content between the owner and the conversation. The concrete changes are spatial hierarchy, user/assistant message treatment, keyboard-accessible setup controls and stable transcript scrolling. This is not a measured usability gain. Preserve Electron and the existing execution/state contracts; no new dependency or model request is required. A bounded write-only clipboard IPC supports explicit reply copying without broad browser permission changes. Real WeChat transport, authorization and execution behavior are outside this visual revision.

## 2026-11-04 — Implement the six requested technology candidates

The owner explicitly requested implementation after reviewing the radar. Preserve Electron and the existing native/API chat paths. Implement voice/quote normalization and a transactional SQLite receipt ledger directly; add official session JSON as independent evidence; expose owned-background lifecycle and bounded MCP artifact tasks/viewer as experimental entries. No new runtime dependency. The demonstrated restart gap justifies SQLite; no automatic replay or authorization recovery. Reuse the chat UI typography, spacing and restrained surfaces from the already inspected references; an artifact is the primary no-account action on the new Work & results page, with session controls below. No decorative metrics or claimed performance gains.

Real original CLI testing revealed --bg does not preserve a requested session UUID on this Windows version; bind a persisted random launch tag, CLI short ID and observed actual UUID instead. Empty-session create/stop/respawn/stop passed after this correction. Background Channels/remote permissions remain unverified. See [implementation and source links](TECHNOLOGY_IMPLEMENTATION.md), [CLI record](CLAUDE_SESSIONS.md), [recovery](WECHAT_RECOVERY.md), and [MCP boundaries](MCP_EXTENSIONS.md). Validation is recorded separately from implementation.


## 2026-11-04 — Original Claude program mode for chat-first use

**Decision:** after the owner rejected repeated custom Channels startup confirmation, use the installed unmodified original Claude CLI's programmatic `-p` entry point for Ju (`claude` mode). Preserve Electron, the existing Dispatcher, QQ/WeChat transports and personas. Retain Channels as `native` compatibility mode and Claude API separately. Do not auto-confirm the old warning, copy credentials, automatically migrate historical conversations or skip tool permissions.

The [official headless guide](https://code.claude.com/docs/en/headless) and [CLI reference](https://code.claude.com/docs/en/cli-reference), checked 2026-11-04, provide structured input/output, exact session resume and permission hosts. Compared with Channels, program mode removes the interactive startup step. Compared with API/SDK `query`, direct original CLI spawning retains the user's own installed login flow; this is not a claim that all subscription-based product deployments are permitted. The [product and credential terms](https://code.claude.com/docs/en/legal-and-compliance) and [SDK authentication restrictions](https://code.claude.com/docs/en/agent-sdk/quickstart#setup) remain distinct boundaries.

Implementation uses the stdio control contract from locked SDK **0.3.317** types against tested original CLI **2.1.317**, with explicit fail-closed hook initialization, bounded output, per-turn processes, exact session IDs, one-time approvals and checked stopping. The documented MCP permission-tool alternative would add a server process; no performance advantage is claimed for the chosen route. Compatibility must be checked after CLI upgrades.

[Real QQ evidence](evidence/claude-program-qq-20261104.json) now demonstrates Ju chat/continuation, a specifically approved 27-byte file independently read back, stopping at a pending Write, and normal reconnection without a terminal/Channels prompt. The measurable demonstrated benefit is eliminating that startup confirmation in this controlled flow, not a quantified general usability gain. QQ denial, long-running-shell cancellation, other roles and WeChat program-mode delivery remain outside this acceptance. [Architecture and limits](CLAUDE_PROGRAM.md), [validation](VALIDATION.md).

## 2026-11-04 — Prepare the AI before connecting chat

**Decision:** the owner also wants WeChat to use local Claude program mode and wants the app to prepare AI login/API access before connecting QQ or WeChat. Reuse the existing transport-independent Dispatcher and `claude` runner. Reorder and clarify setup instead of adding another execution backend or changing the Electron UI framework. Keep existing provider keys, role profiles and chat pairing; explicitly change only the selected WeChat profile while disconnected. Do not copy credentials between roles or automatically migrate old Channels conversations.

The baseline connected a chat account first and treated a saved API key as sufficient to start. The new flow separates **AI access checked**, **chat account paired/bridge checked**, and **actual round trip accepted**. This can expose authentication failures before the owner scans or sends work; the reduction in setup effort is a hypothesis until observed. Original CLI login checks do not prove a model call, and provider metadata checks do not prove tools or final delivery. Keep login inside the original Claude/Codex flow and keys inside the app's existing encrypted vault.

Official sources checked 2026-11-04: DeepSeek's [first API call](https://api-docs.deepseek.com/) requires its own API key; [GET /models](https://api-docs.deepseek.com/api/list-models/) lists available models and [GET /user/balance](https://api-docs.deepseek.com/api/get-user-balance/) reports balance availability. These offer small bounded readiness probes without generating chat; they are not a substitute for the actual chat/file acceptance. Tencent's [ClawBot setup](https://intl.cloud.tencent.com/zh/document/product/1316/84459) and [upstream maintainer explanation](https://github.com/Tencent/openclaw-weixin/issues/52#issuecomment-4407647606) retain the bot-conversation boundary, not ordinary personal WeChat friend messaging. The [official QQ robot platform](https://github.com/tencent-connect/bot-docs) is distinct from this project's personal-account bridge. [NapCat's own connection guide](https://napneko.github.io/NapCatQQ-Desktop/docs/connections/) separates QQ login, actual account identity, OneBot connectivity and application message handling; keep those checks distinct as well.

**Subsequent bounded WeChat acceptance:** the [real desktop ClawBot receipt](evidence/claude-program-wechat-20261104.json) passed ordinary chat with zero tool approvals and one specifically approved Write, independently read back as **24 exact bytes**. Existing pairing and the original login were retained; no new QR scan or Channels startup confirmation was required. Original CLI auth status observed **2.1.318**, method `claude.ai`; the previous [Ju QQ program flow](evidence/claude-program-qq-20261104.json) remains a separate 2.1.317 receipt. The concrete comparison is the removal of the earlier Channels startup confirmation in this run, with file approval preserved, not measured overall efficiency superiority.

This used the `claude-program-preview` packaged runner. The newer AI-first onboarding and provider screens subsequently passed **isolated packaged UI acceptance**, with synthetic account/model boundaries, encrypted fixture-key storage, login-state variants, required account/project configuration, saved-pairing reuse, Chinese/English and 430-pixel layout. The local receipts `outputs/onboarding-packaged.json` and `outputs/providers-packaged.json` explicitly exclude live accounts and models. Fresh human sign-in/expired credentials, real messaging through that newer package and program-mode WeChat denial, stop, long-running cancellation and outage recovery remain **pending acceptance**. Historical Channels receipts retain their own scope; no cross-channel or universal-account success is inferred. See [setup and boundaries](WECHAT.md) and [program-mode contract](CLAUDE_PROGRAM.md).

## 2026-11-05 — autonomous social characters as the product direction

**Owner direction:** emotional conversation with selectable personas, embodied in their own ordinary social accounts. The character should keep its identity and relationships, initiate conversation, and manage its social presence, including posts. The desired experience is a persistent AI character participating in the user's existing social software. This changes the core product priority from dispatching coding tasks to sustained character interaction. Existing coding capabilities are reusable optional features, not the next acceptance milestone.

**Proposed first target:** an independent QQ account. Preserve Electron, provider adapters, original portraits and verified account identity/receipt handling. Add editable character definitions independent of model choice, durable character/contact memory, and a separate proactive-action path. The current QQ sender only replies to the configured owner with an active inbound context; scheduled fake inbound tasks or deleting that check would not constitute a proper proactive design. Contact scope, posting audience, cadence and autonomous-action policy remain to be selected; no autonomous sends or posts were enabled by this research.

**Primary-source check, 2026-11-05:** [NapCat's account/friend API list](https://napneko.github.io/onebot/api) includes private messages, avatar/profile/signature changes and friend-request handling. [NapCat 4.18.42](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.42) includes Qzone work; the merged [Qzone change #2124](https://github.com/NapNeko/NapCatQQ/pull/2124) documents feed/detail reading, posts, comments, likes and related account actions. These are capabilities of a third-party QQ bridge, not Tencent's official bot API, and not evidence that Agent Arcade has implemented or tested them. Existing ClawBot support does not provide ordinary personal-WeChat or Moments control.

**Benefit and cost:** reuse the installed messaging foundation while making character continuity and appropriate initiative the central interaction. The substantial new work is persistent conversation/relationship state, action scheduling and reconciliation, and per-account/contact isolation. The current SQLite journal stores receipt metadata, not long-term character memory; persona configuration currently supplies preset identity/style, not autonomous social goals. A useful first experiment is one character that recalls a user-approved past topic after restart, chooses whether and when to follow up within a configured contact window, and can publish a bounded character post to a selected test audience. Naturalness, interruption cost and emotional value are hypotheses until evaluated in real use. Account profiles should identify the character as AI; generated fictional experiences must not be stored as real user events.

### Scope confirmed and first implementation, 2026-11-05

The owner selected **proactive conversation with the owner first, plus operating the character's own QQ space**. The first implementation restricts recipients to the verified bound owner and requests space visibility for that owner explicitly; it does not extend permission to all friends or groups. The proposed scope above is now resolved. [Companion setup and limits](COMPANION.md) describe the new source preview.

Preserve Electron, original artwork, existing provider access and coding mode. Add a separate `SocialCompanion` controller, tool-free model invocation and a scoped SQLite conversation store. The controller validates model proposals against contact hours, a 15-minute quiet period, daily ceilings and unanswered-message suppression. The model can choose to wait. Default consideration interval is 180 minutes, with at most two proactive messages and one post per day; both activities are opt-in. These deterministic rules replace a fixed scheduled greeting baseline, without claiming measured improvement in naturalness or emotional benefit.

Memory retains 120 recent messages and explicit editable notes for each authenticated QQ account/contact/character. It is not unlimited recall or automatically inferred relationship memory. Public character description is separate from private notes. Space text is generated by a fresh no-resume call with public persona context only, and sent using NapCat's selected-friend parameters rather than its public default. Attempts are durable before writes; uncertain sends are not retried. Clearing conversation blanks retained action text but preserves minimal receipt/rate-limit records.

Claude's installed CLI help and [official reference](https://code.claude.com/docs/en/cli-reference) confirm empty `--tools`, all-tool denial, safe mode, replacement system prompt, no Chrome and no-session-persistence options. A real original-CLI probe completed three tool-free replies, exact marker recall after reopening app memory and no requested file creation (`outputs/social-live-probe.json`); this is direct model acceptance over synthetic transport. Local Codex remains a coding backend; its companion path is disabled until tool removal can be enforced through a verified App Server contract.

Synthetic renderer acceptance covers bilingual settings, narrow layout, focus preservation, pause, explicit clear-memory confirmation and unknown delivery states (`outputs/social-ui.json`). Actual QQ proactive messages, post content and second-account visibility are still pending: an isolated probe stopped at vault decryption before connecting. Automatic approval review rejected a proposed direct bridge-token read; it was not used and the temporary probe path was removed. Continue account testing through the normal application credential path. No real social send or publication is claimed by these records, and no release is implied.

## 2026-11-05 — Bothouse reuse review for sustained companionship

**Question:** the owner observed Bothouse's Feiyu initiating QQ conversations and posting to QQ Space, and asked which mechanisms Agent Arcade could reuse. This review inspects source and public examples, not Feiyu's live deployment, private conversations, credentials or account actions. It makes recommendations; no new social actions or runtime changes were enabled.

**Versions:** clean local Bothouse GPT checkout at `920f176b281399490a6c966a29ea90341b577bf3` and Bothouse Claude checkout at `d89b1600f1eec351f64b2ba241e12620d11c229a` (November 1). GitHub's current upstream `main` was independently resolved on November 5 to [`745a8fb22a5d28739947234761fcae4628b18c04`](https://github.com/zuiho-kai/bothouse/commit/745a8fb22a5d28739947234761fcae4628b18c04). Remote references below are pinned to that revision; local findings are not described as the latest version.

### Verified mechanisms and the QQ Space evidence gap

- The local heartbeat path is `bridge/core/heartbeat.go:332` (tick), `:350` (optional idle check), `:365` (configured prompt / HEARTBEAT.md), then `bridge/core/engine.go:2823` (`ExecuteHeartbeat`) reconstructs the platform destination and runs a model turn. The QQ adapter reconstructs `qq:<userID>` at `bridge/platform/qq/qq.go:1048` and sends `send_private_msg` at `:743`. This explains how the implementation can send without a fresh incoming message. Upstream still has this [heartbeat scheduler](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/bridge/core/heartbeat.go).
- Both clean local tracked trees had no matches for `qzone`, `send_qzone`, `taotao`, or QQ-space terms. Upstream repository code searches for `qzone` and `send_qzone_msg` returned no results; its QQ adapter was also inspected. This is a bounded negative finding, not proof that the owner's observed bot cannot post. Project/user skills and deployment scripts can extend the engine, but the actual Feiyu posting component was not located.
- The [autonomy module](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/companion/autonomy/__main__.py) continues attributed prior discussions and explicit next-time commitments, with durable intent records and a daily journal. Its routing is Discord-specific; it is not a QQ Space publisher. Likewise the new [proactive authorization](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/docs/PROACTIVE_AUTHORIZATION.md) handles approved inferred work from source streams, not an emotional-companion engine.

### Recommended adaptation, in order

| Mechanism and source | Concrete benefit over our current baseline | Adaptation, cost and acceptance |
| --- | --- | --- |
| **Commitment-based follow-up**: [durable one-shot later jobs](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/dsh/collab/later.mjs), [timer context recheck](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/bridge/core/timer_context.go) | Our interval-only `consider()` lacks a record such as "ask how Friday's interview went." | Add contact/character-scoped source message, topic, due time, expiry and cancellation state to SQLite. Recheck later owner corrections, quiet hours and unanswered messages before sending. Moderate controller/storage work; no second scheduler service or shell execution. Verify restart, cancellation, overdue handling and one actual owner follow-up without duplicate delivery. |
| **Long-term relationship facts**: [memory-index injection](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/bridge/core/memoryindex.go), [wiki ingest](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/bridge/contrib/wiki/README.md), [lexical BM25 search](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/bridge/contrib/wiki/llmwiki/search.py) | We retain 120 messages, but prompt context takes at most 30 recent messages plus manual notes under a character budget: the default proactive history budget is 3000; reply history receives the remaining space within the full 6000-character prompt bound. Older preferences and agreements are not automatically retained. | Store bounded, attributable preference/fact/commitment candidates with correction and deletion. Use only this app's scoped conversations, not Bothouse's broad original-CLI transcript collection. Start with SQLite and lexical retrieval; a vector service is not required. Extraction adds model calls and must not turn guesses into facts. Test older-than-window recall, corrections, deletion and cross-contact isolation. |
| **Continuous public character journal**: [activity and journal generation](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/companion/autonomy/__main__.py), [attributed reading edition](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/companion/autonomy/reading.py) | Our current post generation sees public persona only, so it has no durable record of earlier interests or published posts. | Keep separate public activity/post continuity, derived from actual app creations or explicitly shareable material; do not feed private relationship notes to the post generator. Reuse our existing NapCat Qzone adapter. Validate a real owner-visible post and continuity across two dates; fictional character details must not become claims of real-world actions. |
| **Short chat bubbles**: [QQ Send / splitBubbles](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/bridge/platform/qq/qq.go#L1035-L1068) | We currently deliver one text reply; a long response reads like a report. | Optional bounded splitting for ordinary social text, preserving code/permission messages. Small adapter/UI change, but each part needs a receipt and partial-delivery handling. Upstream splits at blank lines; it does not establish a typing-delay or naturalness benefit. |
| **Portable character packs**: [persona packs](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/docs/persona-packs.md) | Our built-in selection plus editable name/description does not support importing/exporting full user-created characters. | Declarative avatar, public persona, speech style, author/version/license; preview before import, edit as a copy, restore defaults. Moderate UI/asset-validation work. Exclude scripts, tools and hidden credentials; identity choice must not change account authority. |

**Architecture decision:** keep Electron/Node, existing original portraits, provider adapters, QQ identity checks and the `wait/message/post` controller. Bothouse's main bridge is Go and its broader memory/autonomy stack includes Python and model-driven wiki maintenance; copying the whole stack would add processes and setup cost without fixing our pending real QQ acceptance. Borrow contracts and selected bounded code where useful. Our heartbeat equivalent already exists, so increasing its frequency is not the primary missing feature. Comparative naturalness and emotional value remain hypotheses, not measured improvements.

**Licensing:** upstream [LICENSING.md](https://github.com/zuiho-kai/bothouse/blob/745a8fb22a5d28739947234761fcae4628b18c04/LICENSING.md) identifies project-owned code as Apache-2.0, cc-connect-derived bridge code under its retained MIT notice, and third-party assets under their own terms. Any later copied implementation must record origin, retained license/notices and modifications; our MIT license would not relicense those files. No Bothouse code or artwork was copied by this review.

**First demonstrable target:** the owner mentions a concrete next-day event, the character retains its source after restart, and later sends one relevant follow-up in the permitted window; a correction or cancellation suppresses it. Pair this with a real post from separate public character material. This extends the existing one-owner scope and supplies testable continuity, rather than claiming full account autonomy or silently adding other friends.

## 2026-11-05 — broader open-source companion references

The owner explicitly invited references beyond Bothouse. Inspected official current/pinned source and documentation for MaiBot, Koishi, SillyTavern, Mem0, AstrBot and Project AIRI. The [companion reference comparison](TECH_RADAR.md#2026-11-05--companion-project-references) records revisions, concrete modules, cost/licensing distinctions and acceptance criteria. Selected near-term mechanisms are bounded input batching, cancellable short-message delivery, source-backed correctable memory and portable declarative persona fields. Existing commitment follow-up/public journal work stays first; unified account management follows one live-accepted companion, and interruptible voice follows text reliability.

Keep Electron/Node, the original portraits and existing providers/transports. Do not add a second bot framework, a vector service or Live2D solely to resemble a reference. This research does not modify runtime behavior, contact scope, credentials, current account connections or published releases. No upstream performance/naturalness claim is treated as measured Agent Arcade improvement.

## 2026-11-05 — Implement all nine companion features

**Authorization and delivery boundary:** the owner explicitly requested all nine mechanisms as one continuing implementation and acceptance task. Earlier prioritization controls order, not scope. The source now implements agreed follow-ups, attributable long-term memory, a public character journal, short message bubbles, portable character cards, consecutive-message batching, reply interruption, unified account management and local interruptible voice. [Entrances and contracts](COMPANION.md) and the [acceptance ledger](COMPANION_ACCEPTANCE.md) separate implemented behavior from real acceptance. Vespera is excluded at the owner's request. The scope remains each character's bound owner and its own QQ space, without extending to other friends, groups or ordinary personal WeChat.

**Architecture and baseline:** retain Electron 45.2.1, existing Node SQLite, provider adapters, encrypted vaults, original portraits and independently installed NapCat 4.18.42. Add bounded tables/controllers to the existing process rather than adopting Bothouse's Go/Python stack, a vector service, another bot framework or a hosted voice provider. The prior baseline retained recent conversation and notes, produced one reply at a time and ran independent application instances. The new deterministic controls can retain explicit facts beyond the recent window, suppress changed appointments, interrupt unsent output and select independent connected profiles in one window. These are testable behavior differences, not measured emotional or naturalness gains. Model generation still incurs the selected provider's ordinary costs; even a decision to wait can require a model call. Batching and local speech add no model or service dependency; their actual effect on latency, token use and resource consumption is not benchmarked.

**Continuity choices:** facts are explicit owner-approved text with source/time/revision, not inferred biographies. The prompt selects bounded facts and recent context under the existing 6,000-character limit; durable storage does not imply guaranteed retrieval. Correcting or forgetting clears the relationship's recent messages and freeform notes, cancels related follow-ups and suppresses old in-flight results while keeping independent facts. This deliberately favors forgetting over preserving a recent transcript that may contain paraphrases of the removed fact. Appointments require an explicit timestamp/time zone. They bypass random-initiative quiet/cooldown rules, but retain pause, active-window, connection and daily limits. An overdue appointment is shown as missed rather than replayed after restart. Public journal generation receives only public persona and accepted public entries, never relationship facts or conversation. These choices adapt the [Bothouse and broader reference contracts](TECH_RADAR.md#2026-11-05--companion-project-references), without copying their framework, private transcript collection or artwork.

**Conversation and management:** a 900 ms merge window has a four-second ceiling and bounded messages/characters. Up to four paragraph bubbles each have their own receipt; a newer message cancels old generation and unsent bubbles. Unknown external delivery is terminal, not a reason to retry. The manager holds up to six separate data roots and services, imports existing roots by reference, and verifies actual account claims within this process. It does not acquire cross-process ownership or auto-connect after restart. This avoids a new server while preserving independent credentials, memory and cancellation; real simultaneous account isolation remains to be demonstrated.

**Cards and voice:** adapt the bounded presentation subset of the [Character Card V3 specification](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md), including speaking examples and author/license metadata. Apply only after preview while disconnected, excluding tools, system instructions, private memory and remote assets. The desktop exports its own JSON format. Local voice uses installed Windows `System.Speech` recognition/synthesis as a mature no-download baseline. Microsoft's [recognizer](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine) and [playback cancellation](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.speakasynccancelall) contracts were checked on this date. This costs no additional speech API key but is Windows-only, depends on installed languages and has no reliable speaker echo cancellation. Hands-free requires headphones. Account/panel IDs and generation cancellation keep old voice controls/results from crossing sessions; the text route remains available when speech is unavailable. [Detailed boundaries and native evidence](VOICE_AND_CHARACTER_CARDS.md).

**QQ-space evidence review:** pinned NapCat commit `9335843246e3b7a17944861f3ac8731a259732c2`, checked 2026-11-05. The [SendQzoneMsg action](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/extends/SendQzoneMsg.ts) and [RPC mapping](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-core/data/qzone-rpc.ts) map `ugc_right: 16` plus the bound `target_uins` to selected-friend publication. The [SnowLuma detail parser](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-core/data/qzone-snowluma.ts) does not retain audience fields. Therefore interface acceptance, exact-text readback and actual audience verification remain three separate claims; `visibilityVerified` stays false. Acceptance requires publisher text readback, owner visibility and explicit denial to a controlled non-whitelisted account while owner visibility still works. An empty feed or network failure is not exclusion evidence. `set_qzone_msg_right` is a mutation and may echo requested values, so it cannot be used as a read-only visibility check.

**Verification checkpoint:** the recorded full suite passed 476 of 477 tests with one skipped in 10.524 seconds. Voice/card/lifecycle checks passed 16/16; the renderer passed 18 synthetic checks. Real Whale/DeepSeek evidence confirms two QQ bubbles, a saved fact, one space post with readback/owner visibility and a subsequent thematic draft. A Ju JSON card round trip preserved three examples and AI/channel configuration. Later Ju/Claude API QQ chat produced four observed bubbles with a bounded listening-style and existing-context observation; the card editor refresh still needs packaged rechecking. Whale credential migration now yields a readable managed copy; Ju and Whale connect together in one process. Their full isolation/recovery flows, non-owner space visibility, remaining memory/follow-up/control flows and human voice remain unfinished. The native speech probe alone establishes only one playback/cancel sequence. See [validation](VALIDATION.md) and the [sanitized receipt](evidence/companion-nine-20261105.json). No new release, comparative superiority or full social-account autonomy is claimed.

## 2026-11-05 — Ju switches to Claude API; migration progress

**Owner decision:** after reaching Ju's Max subscription limit, the owner requested the existing Claude API backend instead of local subscription-backed program mode. Preserve QQ identity, persona and memory; keep the local option and other characters' backends. The owner subsequently saved the key directly in the app and completed QQ sign-in. A real controlled QQ request returned four distinct Claude API bubbles with separate receipts, observed in owner QQ. This is one verified round trip, not an authentication redesign or a reason to change billing.

**Current official source:** [Monthly API credits for Max, Ultra, and Team plans](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans), checked 2026-11-05, describes credits claimable by eligible subscribers through a linked Claude Console organization. They are separate from subscription usage limits and do not replenish those limits. This may make the existing API path useful while the subscription limit is reached, but the owner's eligibility, claim and API balance were not inspected or established. No credit claim, purchase, auto-reload or billing feature is part of this change.

**Migration continuation:** the running preview displayed successful Whale credential migration and readability; the manager uses a managed copy and keeps the source files/business-data root. The GUI helper reads stdin through fd 0 with a ready handshake. Ju and Whale then connected together, and Ju's actual API chat passed while Whale stayed connected. Whale's fresh chat after migration, three-account isolation and selective disconnect/reconnect still need acceptance. Readability, connected state and a particular account's actual round trip remain separate evidence.

## 2026-11-05 — Dragon selects GPT API; human voice input diagnosis

**Latest owner decision:** use the existing GPT API backend for Dragon, replacing the earlier local-Codex default and temporary coding-only selection. Keep the local option, QQ identity, persona and memory. After the owner saved its key, the manager connected Ju, Dragon and Whale together. Dragon's controlled QQ input at 10:13:36.980 UTC received a matching reply with a distinct sent receipt, independently seen in actual owner QQ. Dragon's proactive/space switches stayed off. This verifies one API/QQ conversation, not full account isolation, selective reconnect or billing.

**Official source:** [API credits for ChatGPT subscribers](https://developers.openai.com/api/docs/guides/chatgpt-api-credits), searched and opened on 2026-11-05. Eligible Pro $200 subscribers can claim $200 per billing cycle into a linked API organization; the first grant is prorated. Claiming is required, credits expire with the cycle, and they do not increase ChatGPT or signed-in Codex usage limits. The existing Responses API backend is the relevant application path; this is not a claim that the owner's benefit was activated or that its balance is available. No billing changes or credit-claim feature are added.

**Independent voice diagnosis:** a real Ju microphone attempt reached listening but no transcript, corroborated by the owner's observation. Initial read-only checks identified Steam's virtual input. After the owner selected Sony and reported Windows input-meter activity, new checks confirmed Sony for default console/multimedia capture and SAPI. Attempt 3 still timed out without a transcript; the user's audibility was not confirmed. This does not prove absent hardware input or an API error. The subsequent interface revision makes starting and finishing recording explicit instead of asking the user to meet an externally started short window. It previews recognized text and submits only on finish, using Microsoft's [RecognizeAsyncStop](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.recognizeasyncstop) to finish the active recognition. A ten-minute listening fallback, five-second finish bound and empty-text suppression are implemented. Twenty-one automated voice tests and seven synthetic UI checks passed; recognition, heard model replies and speech interruption remain unaccepted.

## 2026-11-05 — speech quality remains a delivery blocker

The owner subsequently confirmed that manual recognition and read-aloud respond, but found transcription inaccurate and the voice robotic. This is not voice acceptance. The speech provider is Windows System.Speech around the selected text model; replacing it need not replace Claude/GPT/DeepSeek or relationship memory. The latest source adds an editable review after Finish and requires a separate Send, with a single-use account/panel-bound draft. Twenty-three automated voice tests and ten synthetic UI checks passed; they do not establish recognition quality or a packaged real review flow.

[The bounded Chinese speech review](VOICE_RESEARCH.md) compares Qwen3 ASR/TTS as the principal open-model candidate, portable FunASR as a smaller ASR option, CosyVoice3 as a Chinese TTS comparison and Alibaba cloud speech as an explicitly selected baseline. All sources were checked on 2026-11-05; no candidate was installed, recorded, called or listened to. Windows/dependency and weight-license boundaries, region-specific charges and reported-latency measurement scope are explicit. Prefer the current pluggable Electron architecture; no NVIDIA-only runtime is selected for a headline millisecond figure. Cloud microphone transfer requires the owner's explicit choice before enablement.

## 2026-11-05 — widen conversational batching after a real missed merge

The actual owner QQ pair “晚安” then “鲸鱼” arrived 1,353 ms apart. Under the original 900 ms window it created distinct tasks: the first cancelled, the second replied. This is evidence that the initial window was too narrow for this interaction, not a successful merge or a general measured optimum. Use 1,800 ms in the source while retaining the four-second batch-ready ceiling; ordinary first replies wait 900 ms longer. A new packaged QQ run must verify the tradeoff.

Overflow beyond eight inputs/2,800 combined characters now cancels superseded pending tasks instead of queuing stale topic replies. Real incoming rows and terminal cancellation records are kept; the newest turn can consult earlier inputs only within the existing bounded context. Status/memory/follow-up queries no longer cancel ordinary replies; explicit stop and memory mutations still do. Already submitted QQ sends cannot be retracted, and model cancellation does not prove remote computation stopped. Forty-four targeted automated tests passed, including six new boundary cases. Permissions, transports, voice and model adapters are unchanged.

**Actual continuation:** the reviewed package later merged two independent QQ inputs 1,151 ms apart into one recorded controller task, returning two separately receipted bubbles observed in owner QQ. This accepts one bounded real pair, not a universal optimal delay or observed HTTP request count. That running package corresponds to the 499-test checkpoint.

## 2026-11-05 — authoritative appointment state in private conversation context

Real Ju prose referred to an old blue-note appointment after its topic/time had changed and it was cancelled, and understated the app's voluntary proactive-contact capability. The scheduler itself retained the correct cancelled state and did not send, so fix the model's context/capability description rather than changing account permissions or scheduling policy.

Supply up to six recent structured appointment summaries (topic capped at 96 characters, state, due time and time zone), with at most 800 serialized characters and one quarter of the available context budget. Explain that this current state overrides older creation messages and that pending does not guarantee future delivery. Ordinary replies/private initiative decisions may use these summaries; public draft and public post generation still receive only public character/journal context. Do not expose approval IDs or send receipts to the model.

Identity wording now states that enabled proactive contact can occur within active hours, cooldown, quiet/unanswered rules and daily limits, can choose no action and cannot promise future contact or claim an unconfirmed send. Fifty-four targeted social/service/store checks passed, including private/public isolation and maximum prompt bounds. This source correction is later than the running reviewed package and has not yet had its own packaged real-model check. No scheduling authority, channel, model adapter or running-account setting changed.
