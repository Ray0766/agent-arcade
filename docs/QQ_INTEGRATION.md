# QQ in the single-window application

The current operated package, desktop entry and remaining acceptance are tracked in
[ACTIVE_GOAL.md](ACTIVE_GOAL.md). The capability inventory below separates
implementation from live acceptance; local builds are not published releases.

## Historical package checkpoints

The following package names, running states and validation counts describe their
own checkpoints, not the current runtime.

Historical prepared candidate: `single-window-supervisor-owner-ntfs-20261107`.
[Verified owner recovery](QQ_OWNER_RECOVERY.md) keeps Stop and explicit management
recovery reachable under the two supported pending-update states. Startup stays
blocked, old unproved records gain no new authority, and partial orphan trees
remain a separately unfinished cleanup flow. Full regression passed 3,873 checks
with one existing opt-in skip and zero failures after fixing a Node inheritance
regression. A subsequent NTFS lease-publication correction passed 496 adjacent
checks and all 58 service checks. One real crash test refused process proof in
the first corrected full run; an isolated repeat passed, with the initial cause
still unknown. The separate standard confirmation passed 3,877 checks, one
original opt-in skip and zero failures. See the recovery guide for the boundaries.
All 321 packaged sources match; the candidate remains unlaunched.
The original running app, launcher and encrypted model keys are retained.

Previously prepared but not operated: `single-window-supervisor-locks-20261107`
adds the separately enabled [orphan-lock recovery](QQ_SUPERVISOR_LOCK_RECOVERY.md)
alongside [remote pending-update preservation and reconciliation](QQ_SUPERVISOR_RECOVERY.md).
The original running app and launcher are retained while the remaining
account-ownership recovery cases are addressed. Full regression passed 3,824 checks,
one existing opt-in skip, zero failures; 644 syntax files and 320 packaged sources
matched. Isolated file/UI checks do not establish real remote deployment or
recovery after every crash. The final 40-check UI run passed, but an earlier
unexplained refusal remains recorded in the recovery guide. Existing model keys
need no re-entry. This package has not replaced the running app or had a fresh
packaged desktop smoke.

Historical operated package: `single-window-qq-supervisor-20261107`. The optional
[remote QQ supervisor](QQ_SUPERVISOR.md) adds separate HTTPS process control for a
fixed prepared installation; actual remote-host/QQ acceptance remains pending.
The original profile retained all API settings. After the prior processes were
already absent, explicit local management recovery, QQ start and AI connection
restored Ju and Whale without new QR or key entry. Identities/online/good,
unchanged configurations, one launcher each and one main were independently
checked. Dragon remains unstarted. Full regression passed 3,744 checks with one
existing opt-in skip; 626 syntax files, 311 packaged sources and desktop smoke
passed. This is not a new model reply or API balance check. See
[current scope and validation](ACTIVE_GOAL.md).

Previous operated package: `single-window-start-connect-20261107`. The
[saved connection entry](QQ_START_CONNECT.md) reuses the original encrypted
credentials and offers one explicit **Start and connect** action for the selected
QQ companion. Original Ju and Whale were restored without key or QR entry;
their actual identities and online state, unchanged configuration files and one
application window were independently checked. Dragon remains unstarted. This
is connection-restoration evidence, not a new model reply or API balance check.
See [current scope and validation](ACTIVE_GOAL.md).

Previous operated package: `single-window-focus-reviewed-20261107`. Original
Ju/Whale QQ and AI connections restored in one window without key/QR entry;
actual account identities, online state, configuration hashes and one new main
matched. Dragon remains unstarted. Thirteen bounded UI observations include
Together keyboard focus and the empty remote registry's open/close path.
The two focus fixes passed seven renderer checks/four inspected images and
47 adjacent credential/card checks; 512 syntax files, desktop smoke and the
254-source package identity passed. The unchanged backend retains the prior
3,282-pass/one-opt-in-skip regression, rather than a newly repeated whole suite.
The package includes cleaner options and the optional
[resumable helper](QQ_RESUMABLE_TRANSFERS.md), whose real installed-plugin and
remote-helper flows remain unaccepted. See [current scope](ACTIVE_GOAL.md).

Previous operated package: `single-window-extraction-reviewed-20261107`.
**Remote instances → Files → Extract ZIP…** adds bounded archive preparation,
explicit output-root confirmation and partial-write receipts. Source paths and
empty directories are retained; observed collisions are refused. Real remote
extraction remains unaccepted. Final 484 syntax files, 3,173 passing tests plus
one existing opt-in skip, desktop smoke and 241-source package identity passed.
The final UI passed 13 checks/nine images; actual package entry/close and original
Ju/Whale QQ/AI restoration passed without QR/key entry. Independent identities,
configuration hashes and one main matched; Dragon remains unstarted. See
[extraction limits](QQ_REMOTE_FILES.md#extract-a-selected-zip). The work-only
[independent core components](QQ_CORE_OPTIONS.md) do not replace this transport.

Previous operated package: `single-window-copy-first-use-20261107`.
**Remote instances → Files → Copy…** adds bounded single-file, directory and
batch copy with explicit preparation/confirmation and partial-outcome reporting.
Directory matches cover observable contents, not full trees or file metadata;
real authorized remote copy remains unaccepted. The first connection page also
offers a real local sample without an account/key. Actual empty-profile use and
JSON formatting passed in the package. The existing original home/profile is
restored with Ju/Whale QQ and AI connected, no key/QR entry, matching independent
identities/configuration hashes and one main. Dragon remains unstarted.
480 syntax files and 3,150 tests passed, with one existing opt-in skip and zero
failures; desktop smoke and full package/source identity passed. See [current scope](ACTIVE_GOAL.md)
and [remote copy limits](QQ_REMOTE_FILES.md#copy-within-the-selected-remote).

Previous operated package: `single-window-pending-update-20261107`.
**Local components → Manage component versions → Pending update records**
adds inspection, explicit retention/deactivation and interrupted-outcome review.
Only a fully verified healthy prepared component qualifies; existing code
changes are not rolled back. 473 syntax files, 3,120 tests and desktop smoke
passed, with one existing opt-in skip. Package identity matched 237 source files,
two notices, 11 metadata fields and three unpacked assets; voice is unchanged.
Fifteen UI checks/nine inspected images and an isolated official Shell/NTFS
component probe passed. Actual packaged original-installation refusal/close
passed without a record mutation. Ju/Whale QQ and AI restored without QR/key
entry; original configuration hashes, independent online identities, one
launcher each and one new main matched. Dragon remains unstarted. No real
interrupted-update recovery is claimed. See [recovery limits](QQ_PENDING_UPDATE.md).

The preceding package `single-window-remote-files-20261107` added **Remote
instances → Files** now provides explicit browsing, text editing, creation,
move/delete/batch actions and bounded upload/file-or-ZIP download. The original
client and same window are retained. 467 syntax files and 3,072 tests passed,
with one existing skip and zero failures; desktop smoke passed. Package identity
matched 236 source files, two notices, 11 metadata fields and three unpacked
assets; the approved voice is unchanged. New UI21/13 images and earlier remote23,
login21 and Passkey20 checks passed. Eleven fixed-upstream filesystem checks and
six HTTP transfer checks passed only as isolated component evidence.

Actual empty-list/form/back/close passed without a registration or remote
request. Ju/Whale QQ and AI restored without QR/key entry; original configuration
hashes, independent online identities, one launcher each and one new main matched.
Dragon remained unstarted. At that checkpoint, real remote files remained unaccepted;
copy, extraction, resumable transfer and process/component transactions were
still unfinished. Current implementation and acceptance are recorded above.
See [remote file limits](QQ_REMOTE_FILES.md).

The preceding operated package `single-window-passkey-20261107` adds explicit
Windows-native Passkey registration/authentication and a same-client handoff
to QQ sign-in under **QQ accounts → Remote instances**. Keys and QQ login stay
separate. 454 syntax files and 3,000 tests passed, with one existing skip and
zero failures; desktop smoke passed. Package identity matched 230 source files,
two notices, 11 metadata fields and three unpacked assets. The voice asset is
unchanged. New UI20/12 images, previous remote23 and login21 checks passed.
Source and ASAR native availability/ABI probes passed and confirmed helper exit;
no Windows Hello/security-key ceremony was opened.

Actual empty-list/blank-form/back/close passed with no registration or remote
request. Ju/Whale QQ and AI connections restored without QR or key entry;
original configuration hashes, independent online identities, one launcher
each and one new main matched. Dragon remains unstarted. Real Passkey
enrollment/authentication/cancellation and remote persistence remain unaccepted.
See [remote usage and its limits](QQ_REMOTE.md).

The preceding operated package `single-window-remote-login-20261107` adds a
same-window QQ sign-in view to **QQ accounts → Remote instances**: cached QR
display, bounded visible observations, and explicit refresh/saved-login
requests. Pending token recovery remains separate from verified login and
management authority. Full regression passed 446 syntax files and 2,933 tests
with one existing opt-in skip; desktop smoke passed. Package identity matched
226 source files, two notices, 11 metadata fields and three unpacked assets,
with the approved voice asset unchanged. New UI21 checks/13 images and the
existing remote23 checks passed using synthetic inputs.

Actual empty-list/form/scroll/cancel/close passed without a remote registration,
credential input or request. Ju/Whale QQ and AI connections were restored from
the original settings without QR, new keys or a test model/message request;
independent identity/online/good, original configuration hashes, one launcher
each and one new main matched. The old main and NapCat Desktop were absent;
the launcher was updated. Dragon remains unstarted with its authentication
gate deferred. Real remote QR/saved-login acceptance remains unfinished.
See [remote behavior and limits](QQ_REMOTE.md).

The preceding package `single-window-remote-management-20261106` added
**QQ accounts → Remote instances**, an independent encrypted registry and fixed
HTTPS management operations, without extending local process ownership or
owner-only chat. Package identity matched 224 source files, two notices, 11
metadata fields and three unpacked assets; the approved voice asset was unchanged.
439 syntax files, 2,880 passing tests plus one existing opt-in skip, the standard
desktop UI smoke and 23 remote UI checks/13 inspected synthetic images passed.

Actual single-window empty list → blank registration → cancel → close passed
without a token, registration write or remote request. The stopped Dragon
management view retained Start QQ, diagnostics and connection details without
an empty More menu. Ju/Whale QQ login and AI connections were restored from the
original configuration without QR, key entry, model requests or test messages.
Independent identity/online/good, one launcher each, original selection and
configuration hashes, one new main and the previous main's absence matched.
NapCat Desktop was absent and the launcher was updated and read back. Dragon
remains unstarted pending its earlier authentication gate. Real remote
authentication and management changes remain unaccepted. See
[remote boundaries](QQ_REMOTE.md).

The preceding package `single-window-plugin-installation-20261106` adds
**Local components → Plugin files and installation**: static local/catalog ZIP
preparation, stopped-runtime deployment, retained removal and explicit recovery.
The full suite passed 2,780 tests with one existing opt-in skip; 422 syntax files,
23 final UI cases/14 images, the desktop smoke and 216 packaged source matches
passed. Actual offline Read/Close showed shared scope and no supported installed
plugin files; no real plugin was deployed or loaded. Original keys/profile were
retained. Ju and Whale QQ/AI recovered without QR/key entry, with independent
identity/online/good and unchanged configurations. Dragon remains unstarted with
its earlier authentication gate deferred. See [plugin file boundaries](QQ_PLUGINS.md).

The preceding package `single-window-plugin-config-20261106` adds a
typed builtin settings subview inside the existing plugin drawer. Source,
synthetic protocol/UI checks and the desktop smoke passed; 210 packaged source
files matched. The actual registry read/close still found no plugin manager.
No configuration getter/save or activation was exercised; actual plugin
configuration remains unaccepted. Original saved keys and profile are retained.
Ju and Whale QQ/AI connections were restored without new QR/key input; actual
identities, online/good, original configuration hashes and one new main matched.
Dragon remains unstarted with its earlier authentication gate deferred. This
connection check is not a new model request or permanent-login guarantee.
See [configuration behavior and limits](QQ_PLUGINS.md).

The preceding `single-window-credential-scope-20261106` package retains
saved encrypted keys and original profile data, clears unsaved drafts across
companions and rejects stale credential saves. Actual Ju/Whale QQ and AI
connections were restored without key entry or QR; one main window and original
configuration hashes were checked. Dragon remains unstarted pending the earlier
authentication gate. The prior plugin/group evidence below remains bounded to
those earlier actions; the new credential fixes do not certify plugin writes.

The preceding `single-window-plugin-admin-20261106` package adds **Local components → Manage plugins**, a bounded
list/status drawer for the verified local instance. Shared Shell preferences
are disclosed before confirmation; bridge response, registry state, persistent
saving and complete cleanup are separate facts. No real plugin change is
accepted yet. Actual read/close showed the shared three-companion scope and a
missing manager, without registration or activation. The same package also
read Ju's one joined group: the UI showed 23/200 members and self search 1/23
with role `member`. Independent read-only checks confirmed 23 members,
membership and the same account identity before/after
(`outputs/qq-plugin-package-group-read-20261106.json`). This is a bounded cache
observation; large-list pagination, pending-read scope switches and all group
writes remain unaccepted. No group action was submitted. Later source added
an explicit typed builtin configuration editor; actual configuration acceptance
and other plugin contracts remain unfinished. Remote management's implemented
scope and still-pending real acceptance are described above. The later file
package addition above implements catalog/preparation and deployment workflows;
real installed-plugin behavior remains unaccepted. See [plugin management](QQ_PLUGINS.md).
That plugin-admin checkpoint restored Ju and Whale QQ/AI with independently matching
identity/online/good, one launcher each, one application main and unchanged
original configuration hashes. NapCat Desktop was absent; the launcher points
to that package at the time. Dragon remained unstarted pending its earlier sign-in gate.

The preceding contact-admin package added **Friends → Manage friend** for an existing friend's
remark and explicit removal request. Two additional removal choices are
independently off by default. Bridge acknowledgement and subsequent list
observation remain separate, and deletion never claims a verified positive
native result. See [friend management](QQ_CONTACT_ADMIN.md). Its actual read/draft/close flow preserved the original remark and friendship;
no real friend mutation was submitted. At that checkpoint Ju and Whale QQ/AI
were restored using the original profile and credentials. Dragon was left
unstarted with its earlier sign-in gate deferred. The group-admin checkpoint
below is historical.

The preceding group-management implementation adds **Groups → View members → Manage member** and
**Groups → Group profile → Group management** in the same drawer. This covers
cards, individual and whole-group mute, administrator assignment, removal,
leaving and dissolving, with separate previews and action-specific receipts.
The source/controller/IPC checks use synthetic accounts over local WebSocket;
real group writes are still unaccepted. See [group administration](QQ_GROUP_ADMIN.md).

Earlier operated addition (2026-11-06): **QQ accounts → More → QQ profile** reads
the verified account's nickname/signature and provides explicit nickname,
signature and avatar editors. Each uses independently owned request-only
management, so AI can stay disconnected. A nickname save also passes through the
bridge's coupled profile-save handler; its preservation limits are disclosed.
Avatar selection previews a local square PNG/JPEG before one-time submission.
Unknown submissions are not replayed. In `single-window-profile-editors-20261106`,
Whale passed a draft-close without mutation, a temporary nickname and explicit
original restoration, plus a temporary original-project portrait and explicit
v2 restoration. The ordinary owner QQ client visibly showed both nickname and
portrait changes/restorations. Independent observed profile hashes matched;
the upload directory was empty after success and the management socket closed
from one to zero. This is one account's bounded flow, not future synchronization,
remote image-byte equivalence or native private-profile-field precision. The
earlier signature-only acceptance is retained separately. See [profile
boundaries](QQ_SELF_PROFILE.md) and [avatar scope](QQ_AVATAR.md).

Optional [owner voice recognition](QQ_INBOUND_VOICE.md) is also integrated in
source, off by default under Companion settings. Local ASR supplies a no-command
conversation path with text replies. A real synthetic-audio inference and owned
worker cancellation have bounded evidence; the phone/QQ codec and full account
flow remain unaccepted.

Current source addition (2026-11-06): **manual friend requests**, through
**QQ accounts → Friends and groups → Friend requests**. Only the exact selected,
connected companion's current-connection events are available. Offline and
pre-handshake history are not fetched. Accept/Decline are explicit, single-use
actions; unknown results are not retried and accepting friendship does not
grant chat or task access. Protocol/UI checks pass; real QQ request handling
remains unaccepted. See [friend-request limits and checks](QQ_FRIEND_REQUESTS.md).
The operated checkpoints below are historical artifacts, not acceptance of this
new source. Current installation/build work is tracked in
[the active goal](ACTIVE_GOAL.md).

Earlier operated package (2026-11-06): `single-window-owner-remark-ready-20261106`,
local candidate **0.4.0-preview.1**. Its fixed-owner remark editor passed one
explicit change, fresh read and explicit original-value restoration. Both
accepted UI receipts had matching cache observations; independent reads also
matched the target and original. The draft remained open for 30.753 seconds;
future management polling pauses while this drawer is open. Remote-client
synchronization remains unverified. See [remark evidence](QQ_OWNER_REMARK.md).
This was the launcher target at that checkpoint; it does not establish the
current running package. GitHub publication is a separate milestone.

Previous operated package: `single-window-qq-actions-20261106`
adds a direct **Connect AI** action to a uniquely verified, online QQ card and
optional details for an accepted image/voice receipt. Whale's actual card
connection, same-window conversation navigation and one explicit send of each
media type passed. Both displayed receipt IDs independently matched the exact
records in a bounded owner-history read. This does not prove recipient viewing
or hearing, live cross-account draft isolation, or a new model conversation.
The checkpoint and private evidence are detailed below; this is a local package,
not a newly published release.

Earlier routing follow-up in the lock-recovery package (2026-11-06): companion connection errors and the
conversation page now link directly to the intended QQ account card in the same
window. Navigation does not start QQ, request a QR code, connect an AI, or change
credentials. Expired sign-in, offline and unverified-online states retain their
distinct meanings. A missing component installation exposes the existing fixed
official installation guide; this does not implement fresh QQ installation.
Startup with an unverified process identity, unconfirmed stopping and unsafe
ownership records have specific instructions instead of a generic action failure.
The isolated renderer check passed **10 checks / five screenshots**
(`outputs/qq-guidance-20261106-ui.json`), with Chinese/English narrow layouts;
the adjacent account-connection check passed 12 checks and orphan controls passed
15. These are synthetic UI checks, not packaged account or process acceptance.

The integration uses original Agent Arcade management code, not the NapCat Desktop frontend. Existing installations retain their data and can be selected in **QQ accounts → Choose data folder**. Separate app-owned preparation routes are described in [first setup](QQ_FIRST_SETUP.md) and [Windows Node setup](QQ_NODE_SETUP.md); their source and real acceptance boundaries are distinct from the earlier existing-installation evidence below.

## Entrances and state meaning

- **QQ accounts** shows installed component versions and one card per exact QQ account ID. Running, signed in, and connected to an AI are separate states.
- **Start QQ / Stop QQ** control only a process tree created by this application and verified by executable path, PID and creation time. Another manager's processes are visible but cannot be stopped or silently adopted here.
- **Show QR code / Refresh QR / Try saved sign-in** use the exact account's verified local management endpoint. The renderer receives a locally rendered image, never the WebUI token or authentication credential. A saved-login request is not a login-success receipt.
- **Recover management** checks a previous application's ownership record after a crash. Dead ownership can be cleared; a matching surviving tree can be explicitly adopted. If the launcher exited but proven descendants remain, a separate inspect/count/confirm flow clears only those verified leftovers. It preserves data and does not start QQ. Unknown identities remain blocked. See [recovery behavior and evidence](QQ_RECOVERY.md).
- **Add QQ instance / Configure connection** prepare a local instance for an existing QQ number and manage its selected loopback OneBot WebSocket server. Editing requires the old manager and affected runtime to be stopped. Unknown fields are preserved, existing files are backed up and ports are checked before writing. This does not register a QQ account or sign it in.
- **Link companion** imports the selected bridge into a disconnected companion's encrypted vault inside the main process. The expected QQ number and owner are explicit; model and character settings remain separate. The action does not start a model or establish a QQ connection. Multiple servers require an unambiguous selection.
- **Connect AI** remains available for a uniquely verified companion. **Verify and connect AI** (核对并连接 AI) additionally offers a unique configured-QQ candidate when the exact app-owned runtime is verified online. Both reuse that companion's saved settings and readable credentials; a configured role or expected QQ number is not identity proof and does not require re-entering a saved API key. The new route binds the request to its profile/runtime through asynchronous checks, then uses the existing actual-QQ, owner and account-claim checks. Success requires a fresh matching connected state, not merely a resolved request. It does not select another character, change credentials or send a test message. Ambiguous bindings still use **Choose companion**; **Open conversation** remains separate. In the actual `single-window-verify-connect-20261106` package, Ju and Dragon each advanced from a configured candidate to the matching connected account through this action; Whale's existing verified route also reconnected. No key re-entry or new QR was needed. This connection check is separate from provider/model validity or balance.
- **Configuration backups** lists private backup metadata, previews redacted changes and restores one explicitly selected file after digest and stopped-runtime checks. Restoration preserves the current bytes first; it does not update a companion's vault or establish online identity. See [backup behavior and limits](QQ_PROFILE_BACKUPS.md).
- **QQ profile**, under the intended account's More view, reads its nickname and signature through a separate verified management socket. Nickname and signature have separate exact-value previews and one-use confirmations; the avatar editor previews a local square PNG/JPEG. The selected companion's saved QQ must match, but an AI connection is not required. Closing does not stop QQ or disconnect AI. See [profile results and limits](QQ_SELF_PROFILE.md) and [avatar handling](QQ_AVATAR.md).
- **View diagnostics** shows classified runtime events and can save a bounded, redacted JSON report through the native file picker. Account identifiers, messages, credentials, paths and raw logs are excluded; there is no upload. Actual save/readback and cancellation passed after fixing an NTFS rename-identity false unknown. See [diagnostics evidence](QQ_DIAGNOSTICS.md).
- **Friends and groups** opens a same-window directory with explicit account identity, search and local pagination. The fixed owner retains **Edit remark** with a separate read/change/restore flow and bounded packaged evidence. Source also adds **Manage friend** for an exact existing contact. Independent request-only sessions allow AI to remain disconnected. **Groups → Group profile** and **View members → Manage member** provide separate explicit management previews with observed role checks. These additions do not enable group chat; real group writes and non-owner friend changes remain unaccepted. See [directory boundaries](QQ_DIRECTORY.md), [owner remark](QQ_OWNER_REMARK.md), [contact management](QQ_CONTACT_ADMIN.md), [group names](QQ_GROUP_PROFILE.md) and [group administration](QQ_GROUP_ADMIN.md).
- **Friend requests**, inside that directory, reads the selected connected companion's in-memory event inbox. It shows no offline/pre-handshake history. Explicit **Accept / Decline** consume one request; unknown outcomes require checking QQ, not replay. The five-minute lifetime, 100 pending-entry limit and 256 duplicate-history limit are local bounds. Request text/flags are not globally broadcast or persisted, and accepting a friend never opens owner chat/task permissions. See [the exact contract](QQ_FRIEND_REQUESTS.md).
- **Local components → Manage component versions** opens a same-window interface for fixed official metadata, explicit download/preparation, integrity-checked previews and same-version selection/rollback. A preparation record is not a login or startup receipt. See [archive preparation](QQ_COMPONENT_PREPARED.md) and [selection boundaries](QQ_COMPONENT_SELECTION.md).
- **Interrupted operation recovery**, inside component versions, inspects and clears one verified dead-owner configuration marker, recovery record or component lock at a time. It preserves configuration contents and does not start QQ. Legacy/unknown records remain; see [operation recovery](QQ_COMPONENT_RECOVERY.md).
- **Pending update records**, in the same component drawer, preserves and deactivates one opaque upstream plan only for a healthy prepared component after full verification and stopped-process checks. Unknown outcomes require explicit review; earlier code changes are not rolled back. See [pending-update recovery](QQ_PENDING_UPDATE.md).
- **Manage companions** is a normal page inside the main window. Repeated application launches focus the existing primary window, including launches with a different data-profile argument.
- **Share image / Send QQ voice**, beside the current conversation, preview a selected PNG/JPEG or supported mono PCM16 WAV before an explicit owner-directed send. The voice drawer also accepts a short user-written sentence for local Serena synthesis when configured, followed by optional audition and a separate Send action. It does not read chat text automatically or send generated speech automatically. See [image limits](QQ_MEDIA.md) and [local voice requirements](QQ_VOICE.md).
- **Sending details** is collapsed by default after a matched accepted media receipt. Expanding it shows that captured account, owner and message ID without issuing a history request. Unknown outcomes do not gain a success ID or a retry of the consumed ticket. The later independent history verification described below is acceptance evidence, not an added product history-query feature.

An avatar linked by a prior verified connection is labeled **Last linked** when no current connection establishes it. That history is not proof of online identity and is not used to route messages. An actual AI connection independently checks QQ identity and the designated owner.

## Capability inventory

This is a delivery inventory, not a claim that all of NapCat's interfaces are available. Preserve pending rows until their implementation and corresponding use flow are accepted.

| Capability | Current implementation | Verification boundary |
| --- | --- | --- |
| One main application window, multiple companions | Global process guard; account page and existing isolated services | A packaged repeat launch with another data/profile path exited successfully and focused the existing window. One main process/window remained; no companion config or vault was created in the alternate profile |
| Local component discovery and versions | Installed data-folder discovery and version observations; fixed official Shell package download and staging | Actual installed metadata and official 4.18.42 ZIP digest checked. Preparation and same-version selection/start evidence are separate rows; metadata alone does not establish compatibility |
| Pending upstream update records | Explicit inspection, retained deactivation and interrupted-outcome review for healthy fixed prepared Shell/Node components; no automatic start | Production backend/UI checks and an official Shell input on isolated NTFS passed. Exact retained bytes/inode and damaged-copy refusal were verified. Original four-file installations remain unsupported; real interrupted-update recovery, sudden power loss and Node native acceptance remain unaccepted. [Guide](QQ_PENDING_UPDATE.md) |
| Exact account and online state | Per-account local WebUI endpoint verified against its QQ process tree | The earlier profile-editors-fixed package restored all three accounts without new QR. The remote-files package restored Ju and Whale QQ/AI with independent identity/online/good checks, one launcher each, one new main, original selection and unchanged configuration hashes; the old main and NapCat Desktop were absent. The earlier plugin-admin group read separately matched account identity and membership before/after. Dragon remains unstarted pending its earlier sign-in gate. These observations do not establish all accounts online, persistent login or the cause of service-side expiry |
| QR and retained-login controls | Main-only authentication, local QR encoding, endpoint-generation invalidation | Local HTTP/UI fixtures pass. Whale's existing session survived managed start without scanning; the new integrated QR login flow remains unaccepted |
| Start, stop and crash recovery | Independent lifecycle manager, shared ownership locks and explicit verified-leftover cleanup | Real three-account start, isolated stop and normal exit passed. Real main crash → five-leftover cleanup → separate restart retained Whale login and preserved ordinary QQ processes. Live-launcher adoption and its encrypted-endpoint recovery remain unaccepted |
| Local instance creation and OneBot configuration | Integrated scoped edits, exact server selection, unknown-field preservation, token generation and configured/live port checks | Ju's actual existing configuration was prepared and restored. A fresh managed Node installation/account then passed creation, hidden startup, real QR display, stop and return while original files/processes remained unchanged. New-account authentication and clean-machine setup remain unaccepted; see [Node evidence](QQ_NODE_SETUP.md) |
| Bridge-to-companion linking and card connection | Main-process vault import; explicit owner/expected QQ; existing verified-profile connection plus guarded verification of one configured candidate against an exact online runtime | Whale's verified-card flow passed earlier. The new candidate action now passed actual Ju and Dragon connection in `single-window-verify-connect-20261106`; all three QQ/AI connections were subsequently visible in one window. Saved settings/credentials were reused, original OneBot hashes stayed unchanged, no new scan or test message was sent. This does not establish provider balance or a fresh model reply. Private receipts: `outputs/qq-verify-connect-packaged-ui-20261106.json` and `outputs/qq-verify-connect-runtime-20261106.json` |
| Configuration backups and restore | In-app bounded list, digest-bound redacted preview and locked exact-byte restore; preserves current file first | Actual Ju UI list → preview → restore returned the original 583 bytes and SHA-256; both original and pre-restore versions remained backed up. This is one bounded real restore, not validation of every configuration/layout |
| Self QQ profile, nickname and avatar | Fixed-self read, separate nickname/signature preview-confirm and avatar local-picker/full-preview confirmation; independently owned request-only management, AI connection not required | Earlier signature flow retained. New actual AI-disconnected nickname draft-close/change/restore and two explicit portrait uploads passed; ordinary owner QQ saw both nicknames/portraits, observed profile hashes matched, successful-upload storage emptied and socket closed 1→0. Native private-field precision, remote image-byte equality and future synchronization remain unproved. Backend/UI fixtures and later display-only fix remain separate evidence. See [self-profile limits](QQ_SELF_PROFILE.md) and [avatar handling](QQ_AVATAR.md) |
| Damaged prepared component recovery | Explicit return to a healthy recorded same-version Shell target; bad directory/history retained, no automatic start | 403 affected checks, 22 UI checks/seven inspected screenshots and an official-file-input temporary-installation probe passed. The original 148-source-file artifact was a build-only checkpoint; later operated packages retain the source but do not add actual damaged-account recovery acceptance. Other corruption/Node/no-previous cases remain unsupported. See [recovery boundaries](QQ_COMPONENT_REPAIR.md) |
| Bounded diagnostics | Typed login expiry, worker restart, bridge and ownership events; local redacted JSON export | Actual classified events, native save/independent file readback and cancellation passed. Original service-side cause of login expiry remains unknown; no raw logs or message contents are exported |
| QQ private text, active companionship, tasks | Existing OneBot transport and AI adapters | Bounded real conversation/task evidence in the existing ledgers; not every backend/operation is accepted |
| Owner-directed proactive messages and appointments | Existing companion controller, limits and persisted appointments | See the nine-feature ledger; no default activity toward other contacts |
| Text Qzone posts and journal continuity | Existing draft/publish/readback flow | Publication and owner readback observed; excluded-friend visibility remains unaccepted |
| Contact/group directory and owner remark | Packaged directory and fixed-owner remark editor, including a separate management session while AI is disconnected | Real directory/search/empty-group flow passed; the earlier plugin-admin package also read Ju's one existing group, 23 members and matching self search/role with independent identity/membership checks. Both owner-remark routes passed explicit change/fresh-read/restore with accepted receipts and matching cache observations; the AI-disconnected route also passed unsaved draft closure and owned socket 1→0. Remote-client synchronization, large lists and pending-read scope switches remain unaccepted; AI chat scope remains the configured owner |
| Manual existing-friend management | Source adds exact-target remark preview/confirmation and removal with two explicit additional choices, using an independent request-only session | 43 main/controller/session checks and 22 UI cases/nine inspected images passed. Actual AI-disconnected read, remark/removal previews and cancellation preserved original hashes and released the management connection. No real non-owner change or deletion has been accepted. Removing friendship does not revoke local owner authority, disconnect AI or clear memories. See [contact boundaries](QQ_CONTACT_ADMIN.md) |
| Read-only group members | Same-drawer member view, local search/pages and return; fixed group/account checks and reduced fields | Formal backend/adjacent regression 208/208; synthetic UI evidence is separate. The plugin-admin package passed one real joined-group read: 23 members, self search 1/23 and role `member`, independently matched to current account/membership. Large lists, pending-read scope switches and realtime completeness remain unaccepted. Reading grants no mutation authority; explicit management checks its own scope and observed role. Group chat remains disabled. See [member boundaries](QQ_GROUP_MEMBERS.md) |
| Explicit existing-group name management | Fixed group/account/self-role checks, exact original/new-name preview and one-use confirmation; independent request-only session, no AI connection required | 305 backend/adjacent checks include actual-main-handler and loopback protocol cases; production renderer 25 checks/seven inspected synthetic screenshots include the real session-to-renderer envelope. No real group rename has been performed. Cached role/name observations are not atomic permission proof; bridge acknowledgement and subsequent readback remain separate. Group conversations remain disabled. See [group-name contract](QQ_GROUP_PROFILE.md) |
| Manual group administration | Separate card, individual/whole-group mute, administrator, removal and leave/dissolve previews; independent request-only session and one-use scoped confirmations | 56 focused backend/session/main checks and 23 UI checks/nine inspected synthetic screenshots passed. The earlier empty-group entry and current nonempty directory/member read have actual evidence; no group management submission or live role-change race has been accepted. Each action distinguishes bridge acknowledgement from independently observed cached effects. See [group administration](QQ_GROUP_ADMIN.md) |
| Manual incoming friend requests | Current verified-connection event inbox; fixed one-use Accept/Decline, bounded private panel, no automatic approval or broadened owner routing | 13 loopback client scenarios and 14 UI checks/six inspected synthetic screenshots. Offline/pre-handshake requests are not listed; real request delivery, acceptance/decline and subsequent non-owner rejection have not been accepted. See [friend requests](QQ_FRIEND_REQUESTS.md) |
| Explicit outgoing friend applications | Not implemented; remains in scope | Fixed NapCat 4.18.42 action registration and official bundle provide no verified outgoing action. Native declarations do not establish target/source/verification or result/cancellation contracts. Incoming approval is not initiation, and no real application was sent. See [fixed sources and next evidence](QQ_MANAGEMENT_GAPS.md#explicit-outgoing-friend-applications) |
| Owner-directed images, voice files and text-generated voice | PNG/JPEG or mono PCM16 WAV preview/send; optional local text → Serena generation, explicit audition/send, accepted receipt details | Actual local text generation/cancellation/preview/send passed in the render artifact. The actions artifact then sent one image and one voice file; each exact UI receipt ID matched one same-account, fixed-owner history entry among at most five. Recipient display/hearing and live cross-account draft isolation remain unverified. Incoming owner images and explicit owner image references now have bounded real Claude/DeepSeek acceptance; see [incoming image scope and remaining limits](QQ_INBOUND_IMAGES.md). Optional [owner voice recognition](QQ_INBOUND_VOICE.md) retains separate source/component checks and no real QQ acceptance. See [image boundaries](QQ_MEDIA.md) and [voice boundaries](QQ_VOICE.md) |
| Component installation/update and rollback | Pinned official download, independent safe preparation, shared-installation lock, explicit same-version selection/rollback and same-window drawer | Real original → prepared 4.18.42 → original passed, including three backgrounds, isolated stop, unchanged configurations and Whale retained login. Cross-version upgrades and QQ client/data migrations remain unimplemented: reviewed 4.18.41 lacks the explicit QQ-data-directory override used by managed installations, and archive/config/data compatibility is unverified. The formal guard remains. See [fixed sources and next evidence](QQ_MANAGEMENT_GAPS.md#cross-version-component-upgrade-and-rollback) |
| Local plugin list and explicit status | Fixed 4.18.42 WebUI routes, selected runtime proof and shared-work preview | Earlier read/close reported the missing manager and three registered companions. Later Cleaner 1.2.0 installation, explicit enable/disable and default save/restart/readback passed; actual cleanup and broader plugin behavior remain unaccepted. [Plugin boundaries](QQ_PLUGINS.md) |
| Reviewed builtin plugin configuration | Packaged source with passing synthetic checks: explicit Read, five typed fields, difference preview, one-time save and separate observation | No real plugin configuration acceptance yet. Missing optional fields and private unknown fields are preserved; no HTML/SSE/change callbacks. Memory observation is not persistence/reload proof. [Plugin boundaries](QQ_PLUGINS.md) |
| Cleaner default options | Source extends the same editor for already active cleaner 1.2.0; eleven typed values, changed-only patch and full private baseline comparison | Backend, actual-main and production-DOM checks plus an isolated official-component save/readback passed. That component also confirmed code-zero responses can coexist with disk-write failure. A later installed Cleaner 1.2.0 flow read eleven defaults, changed retention 7 → 8, read 8 after restart, restored 7 and disabled the plugin; the final seven-day value and disabled state survived restart. No actual cleanup or scheduled run was tested. Saving does not run cleanup or change existing schedules. [Cleaner defaults](QQ_PLUGINS.md#cleaner-defaults) |
| QCE default export folders | Dedicated source editor for active QCE 5.5.77 on owned managed NapCat 4.18.42; separate encrypted token, one selected directory per preview/save | Production main/session/renderer over isolated HTTP and official handler component checks are separate from real installed-plugin acceptance, which remains pending. Defaults share OS-user scope; failed writes may have partial effects. No export, schedule or token refresh is triggered. [QCE folders](QQ_QCE.md) |
| QCE access rules | Same-window read, add/remove rule, filter toggle, captured reported-address shortcut and advertised-host preview; source, isolated main/UI and package checks passed | Uses the separate QCE token and shared OS-user configuration. Empty lists allow all; a rule can block the app's later access. Acknowledgment/readback do not prove durability. Real installed-plugin acceptance, token rotation and session revocation remain unfinished. [Access rules](QQ_QCE_ACCESS_RULES.md) |
| Account-bound scheduled exports | Original local daily/weekly/monthly IANA plans; explicit enable, encrypted occurrence admission, serial dispatch, offline pause/removal and local history | Reuses owned manual exports, without creating native QCE plans. Missed slots and interrupted submissions are not replayed; accepted creation is not completed export. Production main over isolated HTTP/SQLite and both-runtime recurrence checks are separate from real installed-plugin acceptance, which remains pending. [Export plans](QQ_QCE_SCHEDULES.md) |
| Native QCE shared schedules | Distinct source manager for list/detail/create/edit/enable/disable/remove, run/history and native run-all; native timing, resource options and per-plan output folders | These are shared OS-user records, not Arcade-owned plans. Future runs use QCE's then-current QQ; pause/removal cannot cancel captured work, and old runs can restore stale definitions. Isolated component, actual-main and production-renderer checks are separate from real installed-plugin acceptance, which remains pending. [Shared schedules](QQ_QCE_NATIVE_PLANS.md) |
| QCE manual chat export | Source target/range/options preview, one create, encrypted owned-task records, explicit progress/cancel and native file download | Isolated component/integration flows are not real QQ export acceptance. Lost creation replies are not replayed or adopted from global history; cancelled does not prove all writing stopped. Local file hashes cover saved bytes. [Manual exports](QQ_QCE_EXPORTS.md) |
| Plugin files, catalog, installation/update/removal and explicit restore | Original static preparation plus a stopped-work-directory transaction; single-window source and temporary-file workflows pass | Exact release asset digest and ZIP/tree checks are content integrity, not code authentication. Internal data and external configuration are retained; pending changes protect app-managed startup. Later Cleaner 1.2.0 installation/loading and its bounded default save/restart/disable flow passed. Actual cleanup, other plugin behavior and real update/removal/restore remain unaccepted. [File-management boundaries](QQ_PLUGINS.md) |
| Independent remote WebUI management | Separate encrypted registration, exact HTTPS origin/trust, observed QQ/version checks and seven one-use management operations | 35 transport, 29 client/session and 36 registry/panel/main checks, plus 23 UI checks/13 synthetic images passed. Actual packaged empty list/form/cancel/close passed with no remote request or saved registration. Normal-exit OS-encryption reopening passed in an isolated profile. Real remote authentication, writes, persistence, restart and sudden-termination recovery remain unaccepted. See [remote management](QQ_REMOTE.md) |
| Remote QQ sign-in | Same-window cached QR display, visible bounded observations and one-use refresh/saved-login requests; exact expected QQ and fixed version | 31 new backend, eight new actual-main, 49 transport and 21 UI cases passed with synthetic inputs; selected backend paths also use real local TLS. Actual packaged entry/form/cancel/close passed, but no real remote was registered or contacted. Scan, saved login and remote recovery remain unaccepted; pending credential candidates are not changed by temporary sign-in. See [remote sign-in](QQ_REMOTE.md) |
| Remote WebUI Passkey | Windows-native registration/authentication, strict fixed-origin policy and same-client QQ sign-in handoff in one window | Synthetic backend/main/UI flows and real source/ASAR availability/ABI probes passed. No actual credential creation, authentication, native cancellation or remote persistence has been accepted; the fixed WebUI has no reviewed listing/revocation endpoint. A separate default-disabled [stopped-installation extension](QQ_PASSKEY_MANAGEMENT.md) now implements native listing/revocation with isolated verification; actual remote maintenance remains unaccepted. AI keys and QQ authentication remain separate. See [Passkey limits](QQ_REMOTE.md#passkey-access-to-a-registered-remote-webui) |
| Basic remote files | Existing authenticated client; explicit browse/text/create/mkdir/write/rename/move/delete/batch and bounded upload/download; changes have one-use previews | Production tests/UI and fixed-upstream temporary-filesystem/HTTP component probes passed. Actual packaged empty registration entry passed; no real authorized remote-server file operation has been accepted. A directory scope is not a symlink sandbox and cancellation does not undo remote effects. See [remote files](QQ_REMOTE_FILES.md) |
| Same-remote file/directory/batch copy | Original bounded raw download/private staging/mkdir/upload composition; source and target remain in the authenticated view | Code, production UI and fixed-handler component checks passed. Directory results compare observable contents, not a complete tree or metadata snapshot. Real authorized remote copy remains unaccepted. [Limits](QQ_REMOTE_FILES.md#copy-within-the-selected-remote) |
| Optional resumable transfers | Separate original helper deployment, tus uploads, immutable Range downloads and encrypted recovery records in the same window | Source, actual isolated HTTPS/filesystem/crash flows and production-renderer checks passed. Separate TLS and helper credentials are required; existing AI keys and NapCat transfer routes remain unchanged. The packaged empty registry was inspected separately; real helper registration and remote transfers remain unaccepted. [Usage and limits](QQ_RESUMABLE_TRANSFERS.md) |
| Same-window manual QQ client | Fixed SSQQ v3.5.2 static frontend (manifest 3.5.2-3), explicit local ZIP preparation and opening for a verified owned QQ account; no SSQQ plugin enable required | Isolated Session/socket, native Electron/frontend and synthetic shell checks passed separately. Manual controls cover the selected account, not only the AI owner; no page responses are supplied to AI. Independent local browser preferences, native pink/day/night and restricted external media are documented in [Manual QQ client](QQ_MANUAL_CLIENT.md). Bounded real Ju contacts/history, owner-text delivery, language retention across explicit view reopening and Escape/close socket cleanup passed. External avatars/images are unavailable; media, files, groups, other accounts and full-restart preference persistence remain unaccepted. |
| Other plugin configuration and remote host/file interfaces | Remain unfinished beyond the explicit builtin/cleaner/QCE scope above | SSQQ browser preferences are exposed through the separate fixed manual client above, with the bounded real-account acceptance stated there. Credential rotation/revocation and latest-version support remain unfinished. Native shared plans, original account-bound plans and access-rule work have separate implementation and acceptance records. Bounded ZIP extraction exists in source, with real-server acceptance pending. Separately enabled [supervisor process recovery](QQ_SUPERVISOR.md), [fixed-instance OneBot backups](QQ_REMOTE_PROFILE_BACKUPS.md) and [native Passkey maintenance](QQ_PASSKEY_MANAGEMENT.md) are implemented with isolated verification, not real-host acceptance. A generic plugin executor and the remaining remote component/data operations are unfinished; remote management does not enable OneBot WSS chat |
| Fixed-version Shell code repair | Separately enabled supervisor operation; verified local official cache, shared stopped-instance gate, retained original tree and explicit interrupted-work recovery | Production source and isolated official-archive NTFS, HTTPS/SQLite and renderer checks passed. This restores actual code bytes, not a previous selection. Real remote deployment and a user's damaged installation remain unaccepted. [Usage and limits](QQ_SHELL_CODE_REPAIR.md). |
| Independently implemented QQ core | Executable bounded static compatibility probe | Ordinary-account login, inbound messages, sending and Qzone are not implemented by this probe |
| Existing WeChat connection in the new daily app | Existing ClawBot transport retained; original paired profile imported as a fourth companion through encrypted migration | Imported pairing actually connected in the integrated package; original Claude program backend retained. The later directory package correctly showed pending and then successful connection. No new WeChat chat |

## Build and verification checkpoint — 2026-11-06

The operated `single-window-self-profile-20261106` package matched **180 source
files**, with **347 syntax checks** and **2350 tests / 2349 passed / one skipped /
zero failed**. Its bounded profile acceptance is described above and in the
[self-profile record](QQ_SELF_PROFILE.md#bounded-real-account-check--2026-11-06).
It does not establish that all AIs are connected, long-term stability, or a new
public release. The older package checkpoints below retain their own scope.

The earlier owner-remark-ready package matched **121 source files**, candidate version
**0.4.0-preview.1**. Its last full regression was **1201 tests / 1200 passed / one
skipped / zero failed**, with **216 syntax files** checked; the subsequent
version-display correction passed 38 affected tests and changed-file syntax
checks. Remark UI fixtures passed 20 checks/eight screenshots and directory
polling six/three. Real evidence is separate in
`outputs/qq-owner-remark-live-summary-20261106.json`. The first real package's
false-unknown result remains recorded, not rewritten as success.

The preceding actions package was `dist/single-window-qq-actions-20261106/win-unpacked`:
**119 source files** matched with no mismatches, **209 syntax checks** passed;
the full checkpoint was **1156 tests / 1155 passed / one skipped / zero failed**
(12,839.3954 ms). The build identity retains its build-time `launched:false`;
the following actual operation is separate evidence.

Isolated UI checks passed **20 checks / six screenshots** for the QQ-card
shortcut, **12 checks** for the adjacent management page, **19 checks / ten
screenshots** for image receipt details and **38 checks / 17 screenshots** for
voice receipt details. Those fixtures do not use live QQ accounts or models.

Through the actual package, Whale retained its existing login. One card Connect
click showed pending, then independently matched the connected QQ; the page
stayed on that card until an explicit Open conversation action. One image and
one previously generated voice file were separately previewed and explicitly
sent to its configured owner. Receipt details were initially collapsed, then
opened deliberately. An independent read-only check of at most the last five
owner-conversation records matched each exact displayed message ID and media
kind. The check did not send a message or save raw conversation text.

Evidence: `outputs/qq-actions-live-summary-20261106.json`,
`outputs/qq-receipt-details-live-history-20261106.json`,
`outputs/single-window-qq-actions-20261106-identity.json`, and the corresponding
`-tests.txt` / `-check.txt` files. This is bounded single-account acceptance:
the other characters were not started, recipient display/playback and human
hearing were not observed, and live cross-account draft isolation was not tested.
This run did not retest microphone input, hands-free interruption or a model
conversation. The product shows existing receipts; independent history matching
is not a new user-facing history API.

The preceding text-generation package is `dist/single-window-qq-render-20261106/win-unpacked`:
**119 source files** matched, **208 syntax checks** passed; full checkpoint
**1156 tests / 1155 passed / one skipped / zero failed**. Voice UI passed
**33 checks / 14 synthetic screenshots**. Actual text entry → cancelled generation
→ preserved-text regeneration → local preview → one explicit owner QQ send
passed, including independent worker-exit and bounded history checks.
`outputs/qq-render-ui-live-summary-20261106.json` records the exact limitations;
recipient playback and direct UI-ID correlation remained pending in that artifact.
The later actions package above establishes exact ID correlation separately. No automatic
speech send or inbound audio understanding was added.

The preceding manual voice package is `dist/single-window-qq-voice-playbackfix-20261106/win-unpacked`:
**118 source files** matched, **205 syntax checks** passed; full frozen checkpoint
**1107 tests / 1106 passed / one skipped / zero failed**. Voice UI passed
**20 checks / seven screenshots**. Actual selected synthetic WAV preview,
discard, local audition, one explicit send and independent owner-history
readback passed within the limits in `outputs/qq-voice-live-summary-20261106.json`.
Recipient display/playback remain pending. Text-to-audio generation is not a
capability verified in that preceding artifact.

The preceding recovery package is `dist/single-window-lock-recovery-20261106/win-unpacked`:
**113 source files** matched, **194 syntax checks** passed. Its full checkpoint
was **1043 tests / 1042 passed / one skipped / zero failed**, followed by **47/47**
targeted checks after final coordinator/configuration-warning changes.
The recovery UI passed **15 checks / five screenshots**. Actual helper-writer
interruption → separate in-app clearing of three record types → normal Whale
restart passed, preserving all three configuration hashes, component selection
and 15 ordinary QQ identities. This did not interrupt or roll back an actual
configuration write. Receipt: `outputs/qq-lock-live-summary-20261106.json`.
Its recovery evidence remains valid within that recorded artifact and scope.

The preceding package was `dist/single-window-media-recovery-20261106/win-unpacked`:
**112 source files** matched, **955 tests / 954 passed / one skipped / zero failed**,
and **188 syntax checks**. Through that actual UI, five verified crash leftovers
were previewed and explicitly cleared, then Whale was separately restarted with
retained login. All 15 ordinary QQ process identities remained unchanged. This
accepts bounded cleanup/restart, not adoption of a still-live launcher.
See `outputs/qq-crash-live-summary-20261106.json` and [recovery evidence](QQ_RECOVERY.md).

The same package sent one selected original portrait to the configured owner
after an explicit preview. The bridge returned acceptance; an independent,
bounded owner-conversation history read found exactly one recent outgoing image.
The ordinary owner client currently requires authentication, so recipient-visible
display remains pending. See `outputs/qq-media-live-summary-20261106.json`.
Navigation and interrupted-operation recovery are included in the newer
package above, not in this earlier package's identity receipt.

The previous component package was `dist/single-window-components-cwd-20261106/win-unpacked`:
**109 source files** matched, **872 tests / 871 passed / one skipped / zero failed**,
and **178 syntax checks**. Same-version selection, three-account background
startup, isolated stop and rollback passed; Whale retained login. The first
component build's relative-database failure and preserving repair remain recorded
in `outputs/qq-component-live-summary-20261106.json` and
[selection acceptance](QQ_COMPONENT_SELECTION.md).

The preceding package was `dist/single-window-directory-20261106/win-unpacked`.
Its audit matched **104 source files**; its source checkpoint passed **762 tests:
761 passed, zero failed, one skipped**, and **168 JavaScript syntax checks**.
The lead observed actual friends/search/empty-groups/close in one window and
WeChat pending → connected without premature error feedback. Receipt:
`outputs/qq-directory-live-ui-20261106.json`. This did not send a message or call
a model. The later self-entry label and component preparation/selection UI are
source changes for the next build, not part of that package's real acceptance.

The preceding package was `dist/single-window-integrated-20261106/win-unpacked`.
Its identity audit matched 102 source files. It includes the compact QQ layout,
broken-output-pipe handling and encrypted endpoint recovery. The lead has now
observed the actual binding, restoration and connection flows detailed below;
this is not a newly published release. The build identity retains
its original `launched:false` observation; the subsequent launch is separate.

That package's full source checkpoint was **734 tests: 733 passed, zero failed,
one skipped**, with **161 JavaScript files** passing syntax validation. Use the
`tests-fixed` log: the first run exposed a stale single-instance test fixture
which had not allowed the new output-pipe guard import. The reviewed backup/IPC
checks passed **49 tests**. The newer
isolated renderer check passed **42 checks / 28 screenshots**, including
1200×830 and 900×640 account layouts. Its QQ, model and message states are
explicitly synthetic. Filesystem/configuration tests use temporary files and
fake process/vault services, not production account configuration.

The earlier managed package's checkpoint was 715 tests / 714 passed / one
skipped and 156 syntax files; its identity audit matched 100 source files. The
earlier initial single-window checkpoint was 689 tests / 688 passed / one
skipped, 154 syntax files and 36 renderer checks. Each remains evidence for its
own revision, not the subsequent fixes.

Private evidence paths, not distributable account data:

- `outputs/single-window-20261106-final-tests.txt` and `outputs/single-window-20261106-final-check.txt`;
- `outputs/single-window-20261106-identity.json` and `outputs/single-window-20261106-build.txt`;
- `outputs/companion-qq-config-20261106-final2-ui.json` and its screenshots;
- `outputs/qq-console-integrated-readonly-20261106.json`, `outputs/qq-runtime-backend-check-20261106.json` and `outputs/qq-profile-config-readonly-20261106.json`.
- `outputs/single-window-ready-20261106-repeat.json`;
- `outputs/single-window-managed-20261106-identity.json`, `outputs/single-window-managed-20261106-tests.txt` and `outputs/single-window-managed-20261106-check.txt`;
- `outputs/single-window-integrated-20261106-identity.json`, `outputs/single-window-integrated-20261106-tests-fixed.txt`, `outputs/single-window-integrated-20261106-check.txt` and `outputs/single-window-integrated-20261106-build.txt`;
- `outputs/qq-profile-backups-ipc-reviewed-20261106.txt` and `outputs/companion-qq-density-20261106-ui.json`;
- `outputs/qq-manager-handoff-20261106.json`, `outputs/qq-managed-live-20261106.json` and `outputs/wechat-offline-import-2026-11-05T17-43-11-723Z.json`.
- `outputs/qq-profile-real-restore-20261106.json` and `outputs/single-window-integrated-20261106-live.json`.

The old manager's three instances were stopped through its normal controls,
followed by its normal exit. Arcade then started each account independently;
the recorded all-running stage contains **six processes per account**. Whale
retained login without scanning, with matching `get_login_info` and
`online=true`, `good=true`. After stopping only Ju, Dragon and Whale retained
the exact same PID/creation-time/process sets. Normal application exit left
zero component processes; the lead's exit observation also confirmed cleared
ownership leases. The per-account OneBot configuration digests stayed unchanged
through all recorded stages. These observations do not establish the cause of
Ju/Dragon's already-invalid sessions or make reauthentication unnecessary.

Subsequent packaged UI checks completed Ju's prepare/list/preview/restore flow:
the original **583-byte** file's SHA-256 matched exactly after restoration, and
the original and **607-byte** pre-restore versions were both retained as private
backups. Whale's saved binding could then be decrypted and connected while
retaining DeepSeek. The imported WeChat pairing also connected with the original
Claude program backend. A premature failure message during its pending
long-poll connection was identified and repaired in source, with 12 headless UI
checks; that feedback repair was pending packaging at this historical checkpoint.

A **687-byte encrypted endpoint record** was observed on disk during the same
runtime. This establishes record creation and normal current operation, not
recovery after a crash. The two old launchers now route through the unified
launcher; reopening the old WeChat entrance kept the same main process/window,
with one of each. No new chat, voice, Space or crash-survivor acceptance is
claimed. Human-dependent checks remain deferred to
[the test stage](COMPANION_TEST_STAGE.md). The directory drawer was then source
for a subsequent package; its later actual evidence is recorded above.

## Moving from the existing manager

1. Keep the existing component and account-data directories. No reinstallation or profile deletion is required.
2. Stop the old manager's local bots and close it normally. Desktop 3.5.19 refuses normal exit while local bots are active; hiding its window is insufficient. Agent Arcade's current global Desktop conflict guard means the handoff is a coordinated transition, not mixed control by both managers.
3. Open **QQ accounts**, verify the exact account IDs and installed versions, then start the desired accounts. The installed QQ component decides whether its retained login is still valid.
4. On an online QQ card with one verified ready companion, choose **Connect AI** and wait for the independently checked state. Use **Open conversation** separately. If the association is ambiguous or unavailable, use **Choose companion / Manage companions** to inspect it; no automatic selection or connection is made. A server-invalidated session still needs its owner's sign-in; retries do not repair it.
5. To roll back, stop the app-owned QQ processes and close Agent Arcade before returning to the previous manager. Retain the original data and configuration backups. Do not run both managers against one account simultaneously.

The detailed [migration and rollback procedure](QQ_MIGRATION.md) preserves profiles and treats scanning as conditional authentication, not a required step on every launch. Bounded handoff/lifecycle, Whale binding, Ju restoration and proven-leftover crash cleanup have been observed above. New integrated QR authentication, adoption of a still-live launcher and new conversation after this management migration remain separate acceptance work. The remaining real checks are kept in [the dedicated test stage](COMPANION_TEST_STAGE.md) and [the nine-feature ledger](COMPANION_ACCEPTANCE.md). No simulated QR, local protocol fixture or successful package build substitutes for those checks.

## Implementation boundaries

The local management client uses fixed loopback HTTP routes, bounded responses and timeouts, exact account checks and no redirects. The installed WebUI listener may bind more broadly than loopback; connecting locally does not establish that the upstream listener is private. Global `webui.json` is not a per-account port map: the adapter verifies each observed endpoint against the actual account process tree.

Configuration, credentials and runtime ownership are separate concerns. Non-secret account metadata may survive restarts, while credentials remain in the OS-encrypted vault. A verified disconnected send is not silently replayed; unknown outcomes remain unknown. The independent core probe is described in [QQ_NATIVE_PROBE_NOTES.md](QQ_NATIVE_PROBE_NOTES.md).

Configuration writes and companion linking are separate actions. A saved file
with a failed refresh is still reported as saved. Closing while a config write
is in progress waits for its lock; it cannot turn a completed write into an
"unchanged" result. Stopping a runtime holds its management lock through the
companion disconnect, while connection entrances reject the affected stopping
account. These are tested control-flow protections, not a real-account stop
receipt.

## Next independent implementation work

1. **Component installation/update coverage:** fixed official archive download,
   preparation and same-version stopped-runtime selection/rollback now have
   implementation and bounded real evidence. Cross-version compatibility and
   QQ client/data upgrades remain unfinished. The reviewed 4.18.41 data-directory
   difference prevents treating it as a safe managed rollback target; keep the
   existing guard and obtain a verified target/data contract. See
   [the remaining contracts](QQ_MANAGEMENT_GAPS.md#cross-version-component-upgrade-and-rollback).
   Clean-machine setup acceptance also remains separate from the implemented
   app-owned Node preparation route and its bounded local evidence.
   The historical proposal below is not their acceptance.
2. **Remaining contact surfaces:** the directory, explicit owner media,
   local text-to-voice and fixed-owner remark flows have the bounded evidence
   above. Manual incoming friend requests now have source and synthetic
   verification, but real handling remains an acceptance gap, not missing UI.
   Explicit group-name and group administration now have source and local
   protocol/UI checks; one populated-group/member read passed separately, while
   actual group-profile/admin writes and live role-change races remain unaccepted.
   Existing-friend remark/removal now has source implementation, with real
   non-owner changes and deletion still unaccepted. Outbound requests remain
   unimplemented. For outgoing
   applications, the fixed bridge lacks a verified
   callable contract; [number validation and incoming approval cannot replace
   it](QQ_MANAGEMENT_GAPS.md#explicit-outgoing-friend-applications). None may
   silently enable autonomous activity toward new people or groups.
3. **Advanced management and independent core:** local plugin management and
   the fixed HTTPS remote view now have implementations, with their real
   mutation gates still pending. Basic remote files are implemented but remain
   unaccepted on a real server. Keep the remaining plugin/remote host, advanced
   file, authentication and ordinary-account core work explicit, with separate
   contracts and verification. A file metadata probe is not a message
   transport or login implementation.

Backups and WeChat import now have implementations; their remaining real flows
are acceptance work rather than unimplemented UI. The original nine-feature
gates remain separate. This ordering removes no pending capability.

## Component preparation and UI source checkpoint

The independent parser is pinned **yauzl 3.4.0**, with **yazl 3.3.1** used only
for original test ZIPs. Prepared versions live outside installed account data.
The official **35,967,555-byte** Shell ZIP passed actual extraction and full
read-back: **684 files / 114,884,405 expanded bytes**, manifest digest matched.
No selection, process launch or account data mutation occurred in that check.
Receipts: `outputs/qq-component-official-stage-20261106.json` and
`outputs/qq-component-official-prepare-20261106.json`.

Twenty-nine archive tests cover meaningful path/link/collision/corruption/bomb
and storage/cancellation risks. The isolated component drawer passed **14
checks / 7 screenshots**, including original vs prepared labels, unknown
version display, digest-bound previews, cancel/close/reopen, repeated clicks,
late folder-change results, fixed lock errors, keyboard focus and Chinese/
English 430 CSS px layouts. Key screenshots were opened and inspected.
Receipt: `outputs/qq-components-reviewed-20261106-ui.json`.
These UI states are synthetic and do not establish actual activation or
rollback; the lead's subsequent real package flows are separate evidence.

## Earlier component transaction proposal — historical

Read-only review on 2026-11-06 found useful foundations: the runtime's process
proofs, shared configuration lock, console busy/epoch checks, atomic local JSON
and private backup discipline. `scripts/qq-install-probe.cjs` can inspect bounded
QQ installation metadata/PE headers without executing it. At that review point,
none downloaded, validated or switched a component release. The proposal below
is retained as decision history; the source/actual preparation checkpoint above
supersedes its implementation status.

Three small module boundaries can be developed without changing live accounts:

- **Artifact catalogue and verification:** accept an exact upstream release,
  asset ID, filename, architecture, size and digest. Stream to a bounded `.part`
  file; enforce HTTPS/allowed redirect destinations, cancellation and size limits;
  compare the expected digest before promotion. A self-computed hash alone is
  not publisher verification. Record Windows publisher-signature results where
  applicable, separately from the archive hash. Do not run an installer, script
  or archive entry while inspecting it.
- **Version store:** extract only a verified supported archive into a new
  version directory, with limits on count, expanded bytes, depth and per-file
  size. Reject traversal, Windows device/ADS names, case-colliding paths,
  links/reparse points and unexpected layouts. Preserve the original installed
  directory and stable account/config data. Failed staging leaves the active
  version unchanged and never deletes an unknown file.
- **Explicit switch and rollback:** choose a verified QQ/NapCat pair, hold an
  installation-wide lock and prove Desktop and **all** instances using the
  shared component are stopped. Persist a bounded transaction record and the
  previous pair before switching one active manifest. Recover interrupted
  transactions without silently starting accounts; keep old versions until an
  explicit cleanup. Rollback changes executable selection, not login identity,
  model configuration or private-message history.

Two existing boundaries need deliberate changes before activation is safe.
`withConfigurationLock` currently verifies only the selected account is stopped,
although the binaries are shared by all accounts. It is not yet an all-instance
upgrade lock. Also, `_installation()` binds flat NapCat executable and `config`
paths together. A version store must separate stable data from versioned code
or provide a tested compatibility layout; replacing the complete directory can
overwrite current credentials or strand the old manager. QQ rollback may not
reverse a newer QQ version's data migration. Preserve data and report that limit
instead of promising complete application rollback.

The immediate independent deliverable should therefore be **verification plus
staging**, with temporary-directory tests for corrupt downloads, path traversal,
disk-full/cancellation, version mismatch and interrupted promotion. Switching
comes after the all-instance lock and stable-data layout are integrated. Actual
download/install/start/rollback is a separate real acceptance sequence; nothing
was downloaded, installed or launched by this review.

Official references checked on 2026-11-06:

- The [NapCat Windows guide](https://napneko.github.io/guide/boot/Shell) offers
  Shell ZIP and a separate one-key installer. Those are distinct layouts; an
  archive should not be accepted merely because its name contains “NapCat”.
- [NapCat v4.18.42](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.42),
  published 2026-10-30, provides separate Framework, Shell, Windows Node and
  Windows OneKey assets. The [release metadata](https://api.github.com/repos/NapNeko/NapCatQQ/releases/tags/v4.18.42)
  observed for `NapCat.Shell.zip` lists 35,967,555 bytes and a SHA-256 digest.
  Its internal layout was not downloaded or validated in this review.
- [GitHub release assets](https://docs.github.com/en/rest/releases/assets)
  expose asset identity, size and digest, and binary download may redirect.
  Pin the chosen record; do not let a later `latest` lookup silently replace it.
- Windows [Get-AuthenticodeSignature](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature)
  can inspect a local executable signature. Signature status and an explicitly
  expected publisher are additional checks, not proof of QQ/NapCat compatibility.
