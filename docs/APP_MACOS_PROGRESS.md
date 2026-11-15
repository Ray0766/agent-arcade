# App companionship and macOS delivery — 2026-11-14

Scope: the App conversation and macOS adaptation. QQ expansion and the
independent QQ experiment remain paused. 3D characters remain a later plan
under [NEXT_SESSION_PROMPT](NEXT_SESSION_PROMPT.md); no models or new renderer
were created. This ledger separates implemented behavior from live acceptance.

## Local retention and switcher repair — 2026-11-15

App data and the Electron profile were backed up before implementation; three
copied SQLite databases passed integrity checks. Startup now snapshots existing
App data before stores/migrations on a changed build. Mac identity preserves the
historic name; locked credentials have safe retry and a confirmed encrypted-backup-first
reset, retaining chat/memory. See [CREDENTIAL_RETENTION](CREDENTIAL_RETENTION.md)
and [UPDATE_BACKUPS](UPDATE_BACKUPS.md).

The companion area now exposes App-only built-in persona selection and existing
profile switching. It preserves the AI/key and social activity settings;
returning to a persona restores its private history/memory. 48 targeted checks
and five renderer checks/eight inspected screenshots passed.

An isolated copy with offline-installed locked dependencies passed 5000 tests
(4283 passed, 717 platform skips, zero failures); final backup/identity checks
passed 15/15 and syntax covered 951 JavaScript files. Two real ad-hoc packages
with different CDHashes retained a dedicated test Keychain fake key, exact chat
and memory and continued through an intercepted provider. Source fingerprints
were checked against the worktree. The test entry loads production main directly
to leave the owner's running App untouched; normal bootstrap remains tested
separately. Local receipts/screenshots: `outputs/update-retention/`,
`outputs/credential-recovery-ui/`, `outputs/companion-switcher-ui/`.

Normal-entry candidate: `/private/tmp/agent-arcade-update-retention-20261115/mac-arm64/Agent Arcade.app`.
Strict codesign and all 455 packaged source-file byte comparisons passed;
test entry/proprietary SDK are absent. It is local, ad-hoc signed, unnotarized
and uninstalled. Real-user Keychain prompts, certificate-backed distribution,
real models and human acceptance remain open. Existing uncommitted work was
preserved; nothing was committed, pushed or released. Earlier figures below
describe their own 2026-11-14 checkpoint.

## Delivery checklist

Later on 2026-11-15, the owner explicitly authorized activating the new candidate
on the real profile. A fresh 94-file/nine-SQLite backup passed integrity checks.
The saved DeepSeek key loaded without re-entry; original vault bytes and both
chat rows were retained. Real renderer switching through the three main personas
kept the provider/key, isolated their history and restored the original choice.
A cold comparison retained all original rows in 12 chat/memory tables. Normal
relaunch finished with one candidate App running and no debugging flags. No
key plaintext was read/logged, test message sent or model called. Private
receipts: `work/upgrade-check/`. Real-model and human/system-dialog acceptance
remain open; this supersedes only the earlier "production profile not opened"
boundary for this later, explicitly authorized activation.

| Capability / entrance | Current implementation and evidence | Remaining completion condition |
| --- | --- | --- |
| First run → choose AI → save key → App chat | Real Mac Electron, OS-encrypted **fake** key, actual API runner with HTTP replaced locally; streaming, Stop, classified 401/402/429/network errors and restart covered by `scripts/app-macos-smoke.cjs`. | Real provider key/model, Keychain prompts and day-to-day use remain unaccepted. |
| Built-in character → Notes / reflection | App prompts now include the selected character's approved enabled rules and relevant Wiki lines. Wiki read/propose switches remain off by default; pending candidates do not apply; private facts stay scoped. A 6000-character prompt contains at most 1600 characters of optional knowledge. `test/local-builtin-pipeline.test.cjs`, `wiki-pipeline`, `wiki-proposals`, `reflection`. | A real model must use approved material correctly; approval UX needs owner acceptance. |
| Notes → retrieval | English/Chinese stop terms, heading filtering and a normalized relevance threshold suppress conversational noise; per-turn recall remains bounded. `test/wiki-search.test.cjs`, `wiki-pipeline`. | Retrieval quality on the owner's real notebook remains unmeasured. |
| Built-in empty chat | Character welcome and three starters only fill the draft; no fabricated history, model call or automatic send. Real Electron screenshot `outputs/app-macos-smoke/empty-starters.png`. | Owner evaluation of wording remains open. |
| Built-in messages → regenerate / continue / edit | Actual API runner streaming, alternatives, continuation and persisted edits now work for built-ins too. A snapshot race that kept the edit form open after saving was fixed; late output cannot replace a stopped turn. `local-builtin-pipeline`, `st-local-messages`, `st-local-streaming`, real Electron smoke. | Real-model content and repeated reliability remain unaccepted. |
| Characters → import / export / world info / conversation settings | Existing V1/V2/V3 PNG/JSON parser, lorebooks, settings, presets, regex and branches are connected to library-character prompts; see [parity and explicit exclusions](SILLYTAVERN_PARITY.md). Existing `st-*` tests exercise these paths; built-ins keep their own persona pipeline. | Real card/model round trips, native file dialogs and ignored-settings interoperability remain unaccepted. Excluded extensions/CHARX/auto-mode are not silently promoted into current scope. |
| Characters → groups / dispatcher | Existing 2–8 member library groups use real scheduling/prompt modules with fake runners in `st-group-chat-pipeline`, `group-dispatcher`; dispatcher stays off by default. | Real provider scoring capability, real group conversations and human acceptance remain open. |
| Together → App memory | Explicit remember/correct/forget commands and editor use separate character facts; correction/forget invalidates derived histories. Tests cover local memory, restart, branches and isolation. | Real App-model long-term recall and daily quality remain unaccepted; prior QQ evidence does not accept App behavior. |
| Notes → proposals / reflection | Candidates are inert until individual approval. Enabled rules now reach built-ins as well as library characters/groups. Existing proposal/verification/reflection tests and new built-in pipeline tests cover the boundary. | Real-model proposals and scheduled reflection remain unaccepted. |
| Notices → calendar / folder / RSS / page | Actual local `.ics` and folder readers reach SQLite App chat with a fake wording runner; source disable, restart and no replay covered by `sources-companion-flow`. Cursor persistence failure now withholds delivery and reports `state_unavailable`; oversized cursors are rejected. Queued/in-flight notices recheck that their source is still enabled and addressed to the companion. `sources-registry`, `companion-notifier`. | User-selected calendars/folders, real HTTPS feeds and model wording need acceptance. System notifications, sleep/wake and App Nap remain open. |
| Work → Tasks → history / cleanup | Earlier finished entries have an expandable history, diff and explicit removal/discard. Records naming worktrees cannot be silently pruned. Real Git and Electron checks: [TASK_BOARD](TASK_BOARD.md), `outputs/task-board-ui.json`. | Human cleanup acceptance; no automatic deletion was introduced. |
| Work → Tasks → rework | Original brief and current reason enter a new round in the same validated worktree. Only a confirmed stopped previous job allows another writer. Durable launch intent, unknown/no-replay and scope checks remain enforced. `task-board`, `task-worktree` tests. | Installed Claude Code is too old for real background dispatch; 2.1.317+ and actual trust/permission behavior are required. Hand-back still requires owner acceptance. |
| macOS local Claude → Stop / exit | An owned POSIX process group receives TERM, then bounded KILL if needed, including surviving descendants after leader exit. Real three-generation Node children were removed; unrelated process retained. `claude-program-process-group` tests, [MACOS](MACOS.md). Old CLI versions now show an upgrade diagnosis rather than missing-install wording. | Actual Claude long-shell cleanup remains unaccepted. Detached groups and forced App death are outside this guarantee. |
| macOS startup / storage / single window / hooks / package | Reuse first real-Mac evidence in [MACOS](MACOS.md). This round additionally exercises standard bootstrap, fake-key restart, real Edit shortcuts and Command+Enter. Three layouts/compact render; system-theme updates use injected nativeTheme events, not an OS appearance change. | Title bar, Dock/menu-bar icon, native dialogs/IME, notification prompts, Finder discovery, real hooks/background tasks, Intel/second Mac and notarization remain as listed there. |
| README / handoff / scripts | Current scope and evidence are linked here; optional independently deployed services are distinguished from direct App chat. New smoke scripts are isolated and repeatable; no real key is needed. | Published preview remains older; no commit, push, release or notarized installer is claimed. |

## Reproduce

Use `npm test` for the repository suite and `node scripts/check.cjs` for syntax.
`node scripts/app-macos-smoke.cjs` uses a fresh temporary data folder and
Electron profile, a prelude that installs the provider replacement before loading the standard bootstrap, a fake key and an intercepted
DeepSeek endpoint. `node scripts/task-board-ui-smoke.cjs` uses a real temporary
Git worktree with labelled synthetic task states and enters main directly.
Their screenshots and receipts live in ignored `outputs/`; they are not
published evidence or human acceptance.

No production profile, existing credentials, original Claude/Codex login
material, QQ process or external chat was changed by these checks.

The final arm64 package also passed `codesign --verify --deep --strict` and
`ARCADE_EXECUTABLE=… node scripts/mac-package-smoke.cjs`: a fresh keyless
profile rendered, the Edit menu existed, macOS restrictions were correct,
17 changed packaged source files matched exactly and the proprietary SDK was
absent. Local package: `/private/tmp/agent-arcade-macos-delivery-20261114/mac-arm64/Agent Arcade.app`.
It remains ad-hoc signed and unnotarized; no installer or publication occurred.

Final validation: `npm test` completed **4970 tests: 4253 passed, 0 failed,
717 platform skips** (22.38 s on this Mac). `node scripts/check.cjs` checked
941 JavaScript files; the final settings-copy edit and smoke update also passed
individual syntax checks. Earlier full-run failures were two outdated launch
fixtures missing the newly required worktree validation interface; they were
fixed without loosening production validation, followed by 39 targeted passes
and the final green full run. `git diff --check` passed.
