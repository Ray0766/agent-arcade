# Fixed local macOS credential component — 2026-11-16

Implementation and package completed on `codex/stable-credential-broker-20261116`, based on
`38f82de20bb833b0a2b2fc749c6b93cddcbc2e94`. The owner's request is to implement
and verify a local update-safe solution, preserve existing credentials/history,
and avoid repeated authorization exercises. No push, publication or new account.

The previous fixed self-signed App certificate did not prevent a separate
Keychain partition mismatch when the App CDHash changed. This repair moves only
the macOS vault cryptographic client into a fixed, separately installed native
executable. Ordinary App updates neither recompile, re-sign nor replace it.
The original Keychain item and v10 encrypted files are retained in place.

## Decision and boundaries

- Fixed helper reads only `agent-arcade Safe Storage` / `agent-arcade Key` from login
  Keychain. No key creation/deletion, master export, arbitrary service/path,
  blanket ACL or partition change is implemented for production.
- Legacy v10 compatibility follows the pinned Electron 45.2.1 macOS algorithm:
  PBKDF2-HMAC-SHA1/1003, salt `saltysalt`, AES-128-CBC with the historic IV and
  padding. This repair does not silently migrate formats or claim CBC is AEAD.
- The helper authenticates its real parent process, UID/start time, certificate
  requirement, hardened/kill flags and sealed resources. The App authenticates
  the actual helper PID/signature/CDHash before sending a secret-bearing request.
  Private installation directories are not a sandbox against a compromised UID.
- Node Worker + bounded shared memory keeps existing synchronous vault APIs.
  Errors are fixed, limits enforced, transport buffers cleared. Ordinary helper
  access forbids system interaction. Authorization is one explicit status-only
  command; no arbitrary decrypt command or automatic retry is exposed.
- Mac package fuses disable RunAsNode, Node options and Node inspector; ASAR
  integrity and only-load-ASAR are enabled. Bootstrap rejects Chromium remote
  debugging/code-loading switches. The existing disabled cookie-encryption fuse
  is preserved, not changed from an encrypted cookie format.
- First access by the new fixed helper can still require one owner OS grant.
  A locked Keychain/revoked permission must stop safely; these are not ordinary
  App-update prompts. A future helper security update requires an explicit
  versioned transition, never a silent replacement.

## Verification results

Native synthetic crypto/protocol tests pass. A real isolated native integration
uses a dedicated fake Keychain and three signed callers with different CDHashes:
all use the same helper and retain its bytes/CDHash. Legacy known answers,
A→B→C encryption compatibility, wrong caller ID/signer rejection, bounds and
parent-death cleanup pass. Fake-item partition setup simulates an already granted
helper; it does not claim human initial authorization. User default/search lists
are verified/restored, and no owner vault/model is involved.

The first never-activated production draft was preserved before replacing its
invalid legacy query (`MatchLimitAll` + password data). The final helper first
checks unique references, then reads exactly one item. No old credential or
chat file was changed by that correction; the draft never accessed the item.

Final source regression passes: **5064 total, 4347 passed, 717 platform skips,
zero failures**; syntax covers 976 JavaScript files. Final first-run docs pass 290
links/32 anchors/four command sets; the one release workflow is read-only with
no publication. Final native synthetic tests pass. A sandbox-only attempt could
not bind loopback sockets (1048 failures); the same suite under the permitted
local test environment passes. No product workaround was added for that runner
restriction. The 19 required fixed cases pass; the synonym exploration remains
separate and has one documented gap.

Strict signatures, ZIP CRC, DMG checksum and signed pins pass. All 462 packaged
`src/` files match the build commit or the three declared generated icons from
the tracked brand image; no private credentials/signing files/SDK are packaged.
RunAsNode, Node-options and inspector fuses are disabled; ASAR integrity and
ASAR-only loading are enabled. Main flags are hard/kill/runtime. This is a
personal-use self-signed arm64 build, not Developer ID or notarized distribution.
Build environment: macOS 27.2.1 (26B131), arm64; Node 24.21.0, npm 11.19.0,
Electron 45.2.1, electron-builder 26.18.1, Xcode 27.2 (27B52).

The first explicit initial authorization timed out after 120 seconds, before a
persistent grant was recorded. Read-only exact-item metadata confirmed the
helper was absent from both the decrypt policy and partition. The owner then
explicitly confirmed readiness; that single live request succeeded. The helper
now matches the trusted-app requirement and its CDHash partition, with no
unrestricted decrypt ACL. No automatic interactive retry was performed.

**Actual signed App A → B → cold B all pass** using the same original Keychain
key and a fixed public synthetic literal. Every ordinary request has system
interaction disabled. A and B have different App CDHashes, while helper bytes,
signature/CDHash and resulting v10 ciphertext are identical. This verifies the
local ordinary-update mechanism; it does not certify every future macOS or a
future change to the fixed helper itself.

The actual B ZIP was extracted, strictly verified and installed at
`/Users/ray/Applications/Agent Arcade.app`; the old preview.4 App is retained in
`previous-app/Agent Arcade.app` under the cold backup. The DMG was also mounted
read-only; its App ASAR matches the verified build. Original three vault files
remain byte-identical; all 33 tables in three chat/memory databases match the
cold backup exactly, including after opening/switching and exiting the new App.

The normal installed App opens the old history, shows the original profile's
DeepSeek API key as saved without returning it to the renderer, switches back
to the existing separate test profile and reaches ready after a cold restart.
Native UI screenshots are retained in this conversation and were inspected;
no new chat message/model call was made in this repair. The previous real
DeepSeek validation remains in its dated report, not a new model acceptance.

One existing shutdown issue remains: visible Quit closed the window but left
an idle main process. Cold verification sent TERM only to the verified own
executable/PID after visible Quit, then relaunched normally. The final App is
left running without debugger flags. This non-Keychain issue was not expanded
into a separate product change.

Production admission found and corrected the legacy account suffix before any
owner authorization: the existing item metadata is service `agent-arcade Safe
Storage`, account `agent-arcade Key`. An earlier unactivated helper used only
`agent-arcade`, so its noninteractive status returned `KEYCHAIN_MISSING`. The
unused helper/profile were archived privately; the existing item and vaults
were left untouched. New production pins refer only to the corrected helper.

## Immutable local identities

- Worktree: `/private/tmp/agent-arcade-stable-vault-20261116`.
- Branch: `codex/stable-credential-broker-20261116`.
- A: `0.4.0-preview.5`, source `880bd0844e365bc8456c475dac1ecdf3eb6b42de`, CDHash `e3a57c325b9130b3657711efd202942615bd1283`.
- B: `0.4.0-preview.6`, **build source** `00e7b31b79f353ed7b28637fa043ef4e21d32619`, CDHash `a49dead003c15a18d6dfa7e380b58db526b81f68`. A later documentation commit is evidence, not the build source.
- Fixed helper SHA-256 `7a0a7b8d5ca19afeecd790d687846abe0b94c5949b082ebfeed4cb2de71b5ecc`, CDHash `aa89a8c1870e464c45db4898eade0e367d3ba3a0`; ordinary builds verify it and refuse replacement.
- `/private/tmp/agent-arcade-stable-vault-build-20261116/update-B/Agent Arcade-0.4.0-preview.6-arm64.dmg`: 155664728 bytes; SHA-256 `664b3d5b107c68e3da7110a0cd1c02013927493b9b6e618262b3d379e3454562`.
- `/private/tmp/agent-arcade-stable-vault-build-20261116/update-B/Agent Arcade-0.4.0-preview.6-arm64-mac.zip`: 154571060 bytes; SHA-256 `fe5d64301aab519beedbb1a8dbb704e153d91a143aa00d05e1956ac09ffe433c`.

Cold backup: `work/backups/pre-stable-credential-20261116-021512` in the original
workspace; 255 files / 13,106,481 bytes, 57 copied SQLite checks, verified copies.
The original 75-path dirty checkout and previous preparation workspace were not
edited. The previous preview.4 bundle is preserved alongside the cold backup; the new preview.6 App is installed and running.
Private command logs, artifact identity and before/after ACL metadata, three ordinary-request receipts and installation receipt are under
`outputs/stable-vault-20261116/`,
`/private/tmp/agent-arcade-stable-vault-build-20261116/`, and the protected private
sibling. These private files are not public evidence links or committed data.

The corrected account follows the [Electron 45.2.1 compatibility patch](https://github.com/electron/electron/blob/v45.2.1/patches/chromium/feat_ensure_mas_builds_of_the_same_application_can_use_safestorage.patch),
not just the pre-patch base account in mainparts. The helper deliberately does
not implement that patch's copy/delete or new-key creation behavior.

## Reproducible commands

```sh
npm test
npm run check
npm run check:first-run
npm run check:release
node scripts/mac-credential-helper-native-unit.cjs
node scripts/mac-credential-helper-integration.cjs
node scripts/setup-mac-credential-broker.cjs --check
npm run dist:mac -- --require-stable-signing --mac dmg:arm64 zip:arm64 \
  -c.electronDownload.cache=/private/tmp/agent-arcade-integration-build-20261115/electron-cache \
  -c.directories.output=/private/tmp/agent-arcade-stable-vault-build-20261116/update-B \
  -c.extraMetadata.buildSourceCommit=00e7b31b79f353ed7b28637fa043ef4e21d32619
```

The recorded build also used the existing local npm/builder caches. The package
entry forces no publication, no notarization and no timestamp service. Production
self-tests use only the fixed synthetic literal, not arbitrary decrypt inputs;
they do not open owner data or call a real model. Do not run the explicit initial
authorization command repeatedly as a test.

## Remaining boundaries and rollback

No real API secret was printed/exported/re-entered, no keychain item was deleted,
and no blanket trusted-app/partition change was made. Normal calls fail locked
rather than re-prompting or regenerating a key. Deliberately locked/revoked login
Keychain access still requires owner recovery. Replacing this fixed helper,
changing the certificate, another Mac or notarized distribution is a separate
explicit transition. This Mac/arm64 is the tested platform.

To roll back, quit the current App, retain its data, and restore the saved old App
bundle. The unchanged vault format/key/history do not require a data downgrade
for this repair. Use the complete verified cold snapshot with its manifest only
if data restoration is necessary; never restore only a SQLite main file without
its matching WAL/SHM. The backup does not export the system Keychain key.

Local commits, in order: `9b96728`, `3aef96e`, `a50b320`, `a104147`, `880bd08`,
`00e7b31`, followed by the evidence/documentation commit containing this report.
The earlier failed admission/build attempts are retained as failed attempts and
are not delivered packages. No push, upload, release or publication occurred.
