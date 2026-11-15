# Integrated macOS candidate — 2026-11-15

This execution integrates the original repair snapshot and the eight local
adoption-readiness commits into `codex/integrated-macos-20261115`. It does not
publish a release, operate an owner profile or accept real-model quality.
QQ is not expanded and 3D remains later.

## Inputs, preservation and integration

The original workspace was `codex/mac-update-retention` at
`3edf1ced8ec2d05fc50be01a163b83cf16d6a7a4`, with 75 modified/untracked paths.
The preparation workspace was clean at
`24fce66763bd8de8e2ea74877e31512d8c4f0500`. They remain separate workspaces.
Before writes, both states, diffs, file hashes and existing Git histories were
recorded. The recovery snapshot contains per-path bytes (including untracked
source/tests/docs), worktree/index diffs and Git bundles. It contains source,
not owner runtime profiles, API keys or chat data, and is not committed.

The input captured at 21:27 AEDT is the explicit scope; later parallel changes,
if any, remain in the original workspace and are never silently overwritten.
Final preservation checks will report observed differences rather than assuming
all hashes unchanged. The original AGENTS.md bytes were retained unchanged;
no authorization or acceptance rule was rewritten.

Original repairs were imported byte-for-byte in four reviewable groups:

| Group | Paths | Import commit |
| --- | --- | --- |
| App context, Wiki and notices | 18 | `b1c67b493f49f41b29e394074d06cee4714a228e` |
| Task/worktree recovery and native process cleanup | 12 | `bd9573a1618a6bb7cddeb5dfda040fc7827e7e0a` |
| Mac identity, backup, credentials, persona and shared wiring | 29 | `d318a3186e9cc54e9ebbbd5b6a04ea69eb557bae` |
| Existing documentation and instructions | 16 | `090e0fc45b620fc056fdcaf495ad505a96dc6274` |

Preparation commits were then cherry-picked in their original order:

| Preparation | Integration |
| --- | --- |
| `11963fe` | `05a3b59` |
| `4a95a19` | `387d7e7` |
| `f46f20e` | `8984e57` |
| `4355439` | `c50e19c` |
| `4f20b3f` | `14636bc` |
| `323ee14` | `63256a0` |
| `78ce141` | `d8a6df9` |
| `24fce66` | `8785834` |

Only the third cherry-pick conflicted: README.md (5 hunks), README.zh-CN.md
(2), docs/RELEASE.md (3) and docs/VALIDATION.md (2). Reviewed conflict hunks use
the later bilingual source/version/acceptance and CI wording; non-conflicting
content from both sides is retained. No whole-file side selection was used.
The package scripts preserve the Mac wrapper and add both readiness checks;
the prepared minimatch override and lock remain. Historic reports retain
their own time and evidence scope; this document records the integration.

## Candidate and verification plan

Candidate version is **0.4.0-preview.2**, local and unpublished. The public
remote `3edf1ce` baseline remains `0.4.0-preview.1`; neither that pinned source
nor the old public Windows preview is relabelled as this candidate.

Before building: complete integration audit, targeted credential/backup/scope,
context/notice/streaming, task/POSIX and build-consumer checks, fixed cases,
then one full regression, syntax, first-use/release checks and dependency audit.
An M09 lexical synonym exploratory gap is reported separately from required
cases. Earlier 4963/5000 totals are historical, not this execution's results.

Build only from a committed clean worktree using the existing `dist:mac` entry,
explicit arm64 and its `--publish never` policy. Build output and caches stay
outside iCloud Desktop. Generated icons derive from the tracked approved
brand source; no old package is substituted for the new artifact.

The final receipt will separately identify the full build-source commit and
any later evidence-only commit, environment, version, arch, artifact path/size/
SHA-256, archive/source match, signature and notarization state. It will also
record DMG/ZIP structure and extracted-App checks and a script-driven synthetic
run of actual packaged code under a separate test identity/profile. The owner
App must not be focused, closed or replaced by these checks.

Actual command results, artifact identity, screenshots and final preservation
checks are appended after execution. Pending is not a pass. Real provider/key,
native permission/IME/notification/sleep, installation and external-user gates
remain in [ADOPTION_TRIAL_KIT](ADOPTION_TRIAL_KIT.md).

## Executed source checks

Build source: **`8e837c44db08183060e77edddf1941d0ff609ada`**, version
`0.4.0-preview.2`. `git status --porcelain=v1` was empty immediately before
build; the source/archive identity receipt also records that clean commit.
Later changes are external verification scripts/tests and evidence/docs; none
are included by the package `files` list. Their commits are distinguished below.

[All 75 path/import hashes and eight commit mappings](evidence/macos-integration-paths-20261115.json)
are tracked source-only evidence. An independent bare-repository bundle audit
verified every imported blob against the preservation snapshot. All original
`src/`, tests and scripts match the captured repair bytes; AGENTS.md is unchanged.
No original path or preparation commit was omitted. The third preparation patch
has only the four declared prose conflicts; its other file patches and the other
seven complete patch IDs match.

Commands ran in the integration worktree on Node **24.21.0**, npm **11.19.0**,
macOS **27.2.1 (26B131)**, Apple Silicon **arm64**:

```sh
# Private npm cache under /private/tmp; no install scripts during npm ci.
npm ci --offline --ignore-scripts --no-audit --no-fund
ARCADE_PROCESS_PROOF=1 npm test
npm run check
npm run check:first-run
npm run check:release
npm audit --json
npm audit --omit=dev --json
```

| This execution | Actual result |
| --- | --- |
| Directed credential/backup/identity/persona, context/notices/stream/message, task/POSIX and build-consumer group | 191 total, **190 pass, 1 skip, 0 fail** |
| Complete root regression at build-source commit | **5020 total, 4303 pass, 717 skip, 0 fail**, 25.913 s |
| Syntax | **961** JavaScript files valid |
| First-use check at build-source commit | **285 links, 34 anchors, 4 command sets** |
| Release safety | **1** verification workflow, read-only contents, no publication steps |
| Full / production npm audit | **0 / 0** reported vulnerabilities |
| Integrated fixed cases | **19/19 required**, 0 errors / unexpected fetches; M09 exploratory gap kept separate |
| Fixed-case harness | **4/4**, 0 failures |

The directed command named these test files under `test/`: update-backup,
update-identity, credential-recovery, credential-scope-ipc, credential-entrypoints,
app-persona-selection, single-instance, wiki-pipeline, sources-companion-flow,
companion-notifier, st-local-streaming, st-local-messages, desktop-chat-main,
task-board, task-worktree, task-launch, background-sessions,
claude-program-runner, claude-program-process-group, build-matchers and brand-icon
(all with `.test.cjs`). POSIX cleanup uses harmless owned Node process groups;
it does not run a real Claude task. `build-matchers` covers the actual consumers
of the minimatch override, and this execution additionally completed native packaging.

The 717 skips are explicit limits: 667 Windows/Linux owned-IPC tests (including
one single-instance helper), 37 Windows-specific native/startup checks, and 13
optional official offline fixtures not supplied (10 QCE, two builtin, one SSQQ
ZIP). `test:transfer-helper` is also not run on macOS, matching CI: that service
requires the Windows/Linux owned-lock mechanism. No skipped item is counted as
passed. Windows, Linux and Intel Mac runtime acceptance are not established.

Fixed cases were executed after all original repairs and preparation commits
at `816e28ca762a8a9b0c27c98d508c91654a22b04b`. The later build-source commit adds
only documentation and the external package harness. All **85 loaded production
modules** were independently compared with the new ASAR, with identical hashes.
This binds the new execution's 19/19 to the packaged product bytes; earlier
16/19 or historical full-suite totals were not reused. The three required
repairs are present: M08 builtin App knowledge, M10 independent per-turn Wiki
recall and N04 source-enabled recheck before delivery. M09's approved/readable
synonym fact is still not selected by lexical retrieval; it is an exploratory
gap, not a required pass or a new retrieval project.

## New native artifacts

Actual build command (the project wrapper includes `--publish never`):

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false \
ELECTRON_BUILDER_CACHE=/private/tmp/agent-arcade-integration-build-20261115/builder-cache \
electron_config_cache=/private/tmp/agent-arcade-integration-build-20261115/electron-cache \
npm_config_cache=/private/tmp/agent-arcade-integration-build-20261115/npm-cache \
npm run dist:mac -- --arm64 \
  -c.directories.output=/private/tmp/agent-arcade-integration-build-20261115/artifacts \
  -c.extraMetadata.buildSourceCommit=8e837c44db08183060e77edddf1941d0ff609ada
```

The build exited **0**, using Electron **45.2.1** / electron-builder **26.18.1**,
outside the iCloud Desktop tree. Generated icons came from tracked approved
`ribbon-simple-v1.png`, SHA-256
`8c559b4c2356abfbae288b3f614101e7fc85fa9557d0f52f158f33ba5144981a`,
via the existing prebuild script; no old App was substituted.

| Delivery file | Bytes | SHA-256 |
| --- | ---: | --- |
| `/private/tmp/agent-arcade-integration-build-20261115/artifacts/Agent Arcade-0.4.0-preview.2-arm64.dmg` | 155471568 | `dfede15513b8aed7c1accb5a2c15049ae964f2632ee954bee0f867b380ec22a6` |
| `/private/tmp/agent-arcade-integration-build-20261115/artifacts/Agent Arcade-0.4.0-preview.2-arm64-mac.zip` | 154482694 | `0e9c9d92682898b96cdb85fe22e37e879284da400f1de33b74c34ab10d10d5d1` |

Both archives contain the same production `app.asar`, SHA-256
`11bd09f42ab1ebad1b59558b91549a35a69b7278b6a3f9b97219bc667226f58a`.
All **455 `src` files** (including tracked media and the three generated icons)
match the build inputs byte-for-byte; the **415 code/config files** have tree
SHA-256 `35cabe89d278abbafbd77157319e9356f662b3b3c9864daf4828dc1109f6e41e`.
The package uses the production `src/bootstrap.cjs`, version preview.2 and
embedded full `buildSourceCommit` above. The excluded proprietary Claude Agent
SDK is absent. The source lock hash is
`4673bb2f7270fa317985a2b3618af41374897818c7bcbbcbb6329d3791eebd3f`.

`hdiutil verify` and `unzip -tq` passed. DMG mounted read-only and ZIP extracted;
each yielded exactly one App, with matching ASAR. Mach-O is arm64; `otool -L`
records the packaged Electron framework/system dependencies. The extracted App
is executable in the isolated check described below.

`codesign --verify --deep --strict` passed; `codesign -dv --verbose=4` reports
**ad-hoc**, no TeamIdentifier, production bundle ID `io.github.agentarcade.desktop`.
The production App CDHash is `1453eadfaf45d48c257f8bd84624e8992a698fc4`.
Notarization was skipped by the builder. `xcrun stapler validate` exited **65**:
no ticket stapled. This verifies local integrity, not Developer ID trust,
Gatekeeper installation or external distribution readiness. No system trust,
quarantine, Keychain ACL or permission dialog was bypassed.

### Build-target and cache observation

Passing only `--arm64` did not suppress the explicit x64 architectures in the
existing package target configuration. The same build additionally generated
x64 artifacts; **they were not launched or accepted and are not the delivery
listed above**. Local CLI/target-factory inspection proved this corrected
future native-only invocation selects exactly arm64 DMG and ZIP:

```sh
npm run dist:mac -- --mac dmg:arm64 zip:arm64 \
  -c.electronDownload.cache=/private/tmp/agent-arcade-integration-build-20261115/electron-cache
```

The initial builder also used its default Electron download cache despite the
npm installer's `electron_config_cache`: it created the public Electron x64 ZIP
at `~/Library/Caches/electron/fb82adfe72ba90d98ee1fcb6b06511833495be5ee3638992b482dea07f0e7ad5/electron-v45.2.1-darwin-x64.zip`
(124990038 bytes). This is a tool-cache side effect outside the intended tmp
cache boundary and is recorded rather than claiming every write stayed in tmp.
It is not an owner profile or credential file; it was left intact. The explicit
`electronDownload.cache` argument above avoids that downloader default.

## Actual packaged-App checks and Keychain boundary

The harness extracts these exact final archives, clones only into its own
temporary root and starts the real package entry/bootstrap/main. The disposable
copy has a separate bundle ID, App name, Keychain service, single-instance guard
namespace, userData and App data path. Inspector instrumentation is installed
before the first JS resume; failure kills only the paused owned child. Provider
traffic goes only to a loopback stand-in; native CLI discovery/child launches and
other network access are denied. No production ASAR/main is rewritten. Test-copy
Info.plist identity and ad-hoc signature differ from the delivery App.

The first real-safeStorage attempt that completed stable message/restart checks
was `package-smoke-attempt5`: **9 checks** completed (first use, fake key,
streaming, regenerate/continue/edit, Stop, 401/429/network draft recovery, three
persona histories, three layouts/five pages and same-build restart). It then
hit a real Keychain authorization prompt when the older seed copy saved the
same fake key under the same test service. **That attempt did not fully pass.**
Earlier attempts 1–4 exposed harness wait assumptions; their premature completion
conditions are not used as evidence of successful full flows. The corrected
waits require this request's complete serial-marked reply, persisted state,
visible UI and idle state. A cold restart correctly retains configuration and
history while requiring the existing explicit “Start chatting” action.

The owner observed repeated `agent-arcade-integrated-… Safe Storage` dialogs.
All 12 owned App process IDs were checked exited; the owner's running App was
not closed/replaced. All subsequent real Keychain attempts stopped. Dedicated
synthetic test Keychain items were not deleted and no real secret was read.
Static signature comparison confirmed the same test bundle ID had different
ad-hoc designated requirements: new `cdhash 93c81d415166185802415e351fa300d5d331f1a2`,
old `cdhash 00173840cc5e7083e2d4a5c6f4e4e55cfbaf6abc`. “Always allow” for one
identity does not establish access for the other. This is consistent with
[Electron's safeStorage documentation](https://www.electronjs.org/docs/latest/api/safe-storage)
(read 2026-11-15): consistent signing is required for stable macOS recognition.
Calling the native Keychain API directly does not bypass its access controls.
Cross-build OS credential compatibility is **pending, not passed**; choosing a
sustainable signing identity and real authorization belongs to the owner.

The remaining backup/restore execution uses an explicitly synthetic storage
substitute; its result is recorded separately below. It is not an OS Keychain
fix, plaintext production storage or acceptance of a real model/credential.

### Completed no-OS synthetic run

The revised harness is committed separately as
**`8aad1c8e1e57d7a8ec68bec0079b3a4b5620e240`**. It defaults to, and only permits,
`synthetic-no-os`: before production consumers load, `require('electron')`
returns a proxy whose `safeStorage` is a fake-only envelope implementation. It
does not read the native safeStorage getter or fall back for unknown ciphertext.
A throwing-getter VM check and wrong-key/ciphertext rejection are included in
**8/8 passing safety tests**. The already-disabled Chromium cookie-encryption
fuse is read/asserted, never changed; an enabled fuse refuses fixture launch.
No signing trust, permissions or OS security setting is altered.

```sh
node --test test/integrated-mac-package-smoke.test.cjs
node scripts/integrated-mac-package-smoke.cjs \
  --artifact "/private/tmp/agent-arcade-integration-build-20261115/artifacts/Agent Arcade-0.4.0-preview.2-arm64-mac.zip" \
  --artifact "/private/tmp/agent-arcade-integration-build-20261115/artifacts/Agent Arcade-0.4.0-preview.2-arm64.dmg" \
  --seed-app "/private/tmp/agent-arcade-update-retention-20261115/mac-arm64/Agent Arcade.app" \
  --modules /private/tmp/agent-arcade-integrated-macos-20261115/node_modules \
  --output outputs/integration-20261115/package-smoke-synthetic-final
```

Result: **exit 0, 11 checks, 11 labelled screenshots, 15 loopback requests,
all fake-key/tool-free, one cancelled stream, zero renderer errors**. The
actual packaged runtime reports darwin/arm64, Electron 45.2.1, Node 24.22.1 and
SQLite 3.53.4. All five owned App processes in the final run were confirmed
exited. No more real Keychain attempt was made after the observed prompt.

Covered: App-first/Mac identity, full serial-marked stream completion,
regenerate/continue/edit/Stop, 401/429/network draft retention and explicit
recovery, three separate built-in role histories while preserving the AI
selection, three layouts and Chat/Characters/Notes/Notices/Settings pages,
same-build restart without another backup, old preview.1 → new preview.2 cold
backup and complete manual recovery. All screenshots visibly say
`SCRIPTED / SYNTHETIC · NO OS VAULT · LOCAL PROVIDER`; the lead opened the final
first-use/error/role/upgrade/recovery captures for visual review. They are not
real-model output, installation acceptance or human UI approval.

The old seed was copied read-only, never launched at its original path. Its
original ASAR stayed
`3ad4bce6b2c3fd7d32336d08b892ea0a36e47d740be82f792a354fff4d51a66e`.
The new runtime build ID is
`c2e3e0a0b786fc17afe331d28fa83f2e25f5411955d2801247b5725b1a9c67cc`;
it differs from the seed and triggers the expected pre-store snapshot.
This packaged runtime identity differs from a source-tree fingerprint because
builder normalizes the packaged package.json; neither is substituted for Git.
Three copied SQLite databases passed `quick_check`. Recovery kept the newer
synthetic directory by rename, restored the entire numbered root to the same
mapped location, checked **10 file hashes** and original modes, and reopened
the retained history/facts/fake credential envelope before continuing a reply.
This normal-exit sample had **0 WAL / 0 SHM files**; nonzero WAL/SHM preservation
is covered by the directed backup/recovery tests, not claimed as this package
sample's result. No automatic restore feature was added.

## Receipts, local commits and preservation

The tracked [sanitized evidence summary](evidence/macos-integration-20261115.json)
contains artifact identities, actual counts, signature state, case binding,
source-only mappings, screenshot names and hashes of local logs. Raw logs,
receipts, screenshots and synthetic runtime data remain local/ignored:
`/private/tmp/agent-arcade-integrated-macos-20261115/outputs/integration-20261115/`.
The native build log is
`/private/tmp/agent-arcade-integration-build-20261115/native-build.txt`.
No private profile, API key, chat transcript, signing material or raw private
acceptance file was added to Git.

Local commits after the four import groups and eight mapped preparation commits:

| Commit | Scope |
| --- | --- |
| `816e28ca762a8a9b0c27c98d508c91654a22b04b` | Identify local preview.2 and the integration record |
| `8e837c44db08183060e77edddf1941d0ff609ada` | Initial package harness/current callouts; **build source** |
| `8aad1c8e1e57d7a8ec68bec0079b3a4b5620e240` | Correct external harness waits/resume assumptions; forbid OS vault calls |
| Commit containing this report and evidence JSON | **Evidence-only** identity, final bilingual/current-status and trial-material updates; full hash reported at delivery |

The later harness and documentation do not change any `src`/package/lock input
or either final archive. The full suite was not mechanically repeated: the
changed external harness got its eight tests and both files' syntax check;
final documentation gets link/release/diff checks. The clean committed build
source and actual artifact identity remain the hashes above.

Recovery snapshot:
`/private/tmp/agent-arcade-integration-preservation-20261115-212750/`.
It includes `original/files/`, source-only manifests, staged/worktree diffs,
original/preparation Git bundles and exact 75-path import hashes. The explicit
scope is the 21:27 AEDT capture, including all then-untracked source/tests/docs.
A completed post-build check re-read **all 75 captured file hashes** and both
branch/HEAD/status values: no difference found. Original stays
`codex/mac-update-retention` at `3edf1ce` with 75 unstaged/untracked paths;
preparation stays `codex/adoption-readiness-20261115` at `24fce66`, clean.
Some iCloud dataless reads/index checks temporarily stalled; the complete
verification subsequently finished. No assumption of unchanged hashes was
used in place of that result. Ignored owner data and future concurrent edits
are outside the hash claim. No reset/clean/stash/branch switch/commit was run
in either input workspace. Original App, profile and credentials were not
opened, closed or replaced. The recovery directory is local temporary storage,
not a published asset or a durable off-machine backup.

## Remaining owner gates and stop condition

Use the updated [ADOPTION_TRIAL_KIT](ADOPTION_TRIAL_KIT.md) as the single
concentrated acceptance entry. Identity, local file route and complete-root
rollback are filled; real key/model/fee/time and human results remain unfilled.
Nothing is invited, uploaded, pushed or published.

- Choose sustainable Mac signing identity and verify real installation,
  Gatekeeper/Keychain authorization and the first real-model reply. Repeated
  authorization with ad-hoc rebuilds is a known unresolved distribution boundary.
- In a designated test profile, judge real memory/correction/forgetting,
  isolation and restart behavior; fixed injected context does not prove quality.
- Manually test system notifications, Chinese IME, native dialogs/cancel,
  permission allow/deny and sleep/wake; untriggered dialogs remain untested.
- Only after those gates, the owner arranges external trial and full seven-day
  follow-up. No external adoption or return rate has been demonstrated.

M09 synonym recall remains exploratory. Package logs also contain nonfatal
BrowserWindow hide/minimize `MaxListenersExceededWarning`; a long-session impact
has not been established and is not silently declared fixed. No QQ/3D, new
product scope or stack migration was added.

Final evidence-document checks: **285 local links, 32 anchors, four identical pinned command sets**, plus **14** local targets in the integration/build/trial documents, all present and Git-tracked. Release guard and staged diff whitespace checks pass. The two removed anchors are the earlier candidate-table links replaced by the current integration row; this is a new count, not the build-source count above.

**Outcome:** source integrated; new native arm64 artifact integrity and scripted
synthetic flows verified; cross-build real Keychain, real-model, human acceptance
and external adoption **not passed**. The independent plan ends here.
