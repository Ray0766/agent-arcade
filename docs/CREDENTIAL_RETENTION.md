# Updates, saved keys and conversations

## Observed same-signer update boundary — 2026-11-16

The preview.3 → preview.4 real update has matching, strictly verified designated requirements, but still requested OS Keychain authorization. The agent stopped on that one current dialog rather than running repeated decryption tests. A stable signature alone does not prove an existing item ACL grants access; the owner completed that current grant. A passive log check matched this App’s partition mismatch and authorization request. Original vault bytes and chat/memory rows were retained; future-update prompts remain unresolved. [API-to-chat repair and current acceptance](API_CHAT_CREDENTIALS_20261116.md) supersede any inference that all future updates are already prompt-free.

This describes the local development candidate, not an already published Mac
release. API keys are encrypted through Electron `safeStorage` in each
companion's `bot-vault.json`. App conversations and private memory are stored
separately in that companion's `local-companion/social-memory.sqlite`.
The normal data root is `~/.agent-arcade`; replacing the `.app` bundle does not
replace it. Keep the same data root and registered companion directories.

## Persistent personal-use signing — 2026-11-15

The owner authorized a dedicated long-term local certificate and necessary
signing trust after the [initial empty-identity inspection](MAC_SIGNING_STATUS_20261115.md).
This Mac now automatically reuses that certificate through a protected profile
outside the App/repository. A real cold build started with the dedicated signing
Keychain locked and completed automatically, without asking for its random
password. New preview.3 artifact/source identities and limits are in
[LOCAL_MAC_SIGNING_20261115](LOCAL_MAC_SIGNING_20261115.md).

This fixes the per-build ad-hoc identity mechanism; it does not edit an existing
Safe Storage item's access list or prove real-key access. The first transition
from an old ad-hoc App to the certificate-signed App can still require one
owner-controlled OS authorization. No repeated Safe Storage test is used to
manufacture a pass. Real API keys/chats and the running installation were not
opened or replaced in this follow-up.

## Before an updated build opens data

The normal desktop bootstrap acquires its single-window guard first. Main then
creates a [verified data snapshot](UPDATE_BACKUPS.md) before constructing stores
or migrating databases. The first startup of existing data and changes to the
code fingerprint trigger a snapshot, even when the package version is unchanged.
A failed snapshot stops startup and leaves original data in place. Completed
snapshots are not automatically removed. They contain private conversations and
encrypted credentials and must not be committed or uploaded as diagnostics.

This protects the data files; it does not export or back up the system Keychain
encryption key. Restoring an encrypted vault alone cannot recover a deleted
Keychain item, transfer a key to another Mac, or bypass system permissions.

## macOS Keychain compatibility

Mac source and packaged entry points explicitly preserve the historic app name
`agent-arcade` before Electron is ready. Keep the existing bundle ID
`io.github.agentarcade.desktop`, data paths and Electron profile. Electron 45.2.1
uses app name for its Keychain service/account; the service is
`agent-arcade Safe Storage`. Renaming the app identity can select a different key.

A stable name does not remove the Keychain access checks for executable signing
identity. Local builds remain ad-hoc signed by default. A rebuild, or switching
between source and package, can require renewed permission. Do not delete the
Keychain item or broaden its access to every application as a workaround.

For repeat personal-use builds on this Mac, the local profile automatically
selects the same identity:

```sh
node scripts/build-mac.cjs --check-signing
npm run pack:mac -- --require-stable-signing -c.directories.output=/private/tmp/agent-arcade-candidate
```

On this Mac the protected local profile pins the exact certificate, so no manual
identity environment variable is needed. The private signing Keychain is unlocked
before identity inventory for actual builds; metadata-only checks never read its
password. A missing/changed/expired pin fails rather than becoming ad-hoc. Local
profiles prohibit publication, notarization and external timestamping.

On machines without a local profile, an explicitly installed identity can still
be selected through `AGENT_ARCADE_MAC_SIGN_IDENTITY`; exact names resolve to one
certificate hash and required signing. This does not install this Mac's key on
another computer. Distribution-certificate provisioning, hardened runtime,
notarization and real Gatekeeper/Keychain acceptance are separate release work.
An ad-hoc candidate is not a guarantee of prompt-free updates.

## When saved credentials cannot be opened

The App keeps the original ciphertext and locks credential writes. Chats and
memory are retained. On the selected companion, **Recover saved credentials**
opens the recovery card:

1. Retry reading saved credentials. This does not connect a channel or call a
   model. On Mac, allow the intended App if macOS asks, then fully quit and
   reopen it if reading still fails. Electron's synchronous Keychain failure can
   be cached for the rest of that process.
2. If recovery remains impossible, explicitly prepare and confirm resetting
   **all credentials for that companion**. This includes its API keys and channel
   login credentials, which must be entered again. Other companion profiles are
   unchanged. Before retiring the active vault, the App writes, flushes and
   verifies its exact encrypted bytes under `credential-recovery/` in that same
   profile. Failure to back up or a changed account/file cancels the reset.
3. Fully quit and reopen on Mac, then enter the companion's keys again. Existing
   App chat, private memory and configuration stay in place. A retained encrypted
   backup is not proof that its missing system key can be recovered.

The confirmation is short lived and bound to the selected profile, AI mode,
channel, configuration generation and original vault bytes. Switching companions
while a recovery is pending cannot apply it to the new selection. Recovery never
reads or copies original Claude/Codex login materials.

## Verification boundary

`test/update-backup.test.cjs`, `test/update-identity.test.cjs`,
`test/credential-recovery.test.cjs`, `test/credential-scope-ipc.test.cjs` and the
bootstrap tests cover filesystem/SQLite backups, identity, locked-vault writes,
explicit reset and account-switch races with synthetic credentials.

`node scripts/credential-recovery-ui-smoke.cjs` uses the production renderer with
synthetic IPC: locked Mac recovery, retry, explicit reset, account changes and
narrow bilingual layouts. It neither uses the system Keychain nor requests a
model. Its screenshots and receipt are private local evidence in
`outputs/credential-recovery-ui/`.

`node scripts/mac-update-retention-smoke.cjs` is a separate real-Mac A/B package
check using an isolated data directory, Electron profile and a dedicated test
Keychain service. The test entry loads production main directly so the owner's
running App is not focused or controlled. Only a fake key and an intercepted
provider endpoint are used. Its receipt must be checked before claiming success;
it does not accept real-user Keychain prompts, a deleted Keychain item, a real
provider/model, a distribution certificate or another Mac.

On 2026-11-15 the A/B check passed on this Apple Silicon Mac: distinct ad-hoc
CDHashes, the same fake key reopened, exact history and private memory retained,
another intercepted reply and two pre-open snapshots. Receipts and inspected
screenshots are under `outputs/update-retention/`. Inputs were staged outside
iCloud Desktop with offline-installed locked dependencies; the script checked
source/package fingerprints against the worktree before building. Immutable
image assets came from the earlier verified local package. Initial build attempts
hit iCloud `dataless` dependencies returning empty contents.

The isolated full suite passed **5000 tests: 4283 passed, 717 platform skips,
zero failed**. Final backup/identity checks passed 15/15 after adding a refusal
for short code reads; syntax covered 951 JavaScript files. The normal-entry
arm64 candidate is `/private/tmp/agent-arcade-update-retention-20261115/mac-arm64/Agent Arcade.app`.
Its 455 source files matched the staged inputs byte-for-byte; strict codesign
verification passed, its standard bootstrap was present and test entry/proprietary
SDK were absent. It is local, ad-hoc signed, unnotarized and uninstalled.
Its production profile was not opened during these checks.

### Later owner-authorized activation — 2026-11-15

After those isolated checks, the owner explicitly requested switching the real
App. A fresh private backup covered 94 files and nine copied SQLite databases
(all integrity checks passed). The previous App was already closed. The normal
candidate opened the original profile and read its saved DeepSeek key as
`credentialState: ready` / `hasKey: true`, without re-entry or reset. No key
plaintext was read or logged and no model request was sent.

The real renderer switched between Ju, Rina and Whale while retaining DeepSeek
and the original vault bytes, then restored the original selection. The two
existing chat rows matched the backup exactly; empty personas showed no leaked
chat. A subsequent cold check retained all original rows in 12 chat/memory
tables and passed database integrity checks. The candidate was then relaunched
normally without temporary debugging flags and left running as the sole App.
Private receipts are in `work/upgrade-check/`; this is real-profile retention
and UI automation evidence, not real-model or human Keychain-dialog acceptance.

Technical sources: [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage),
[Electron 45.2.1 Keychain name setup](https://github.com/electron/electron/blob/v45.2.1/shell/browser/electron_browser_main_parts.cc),
and its [synchronous OSCrypt implementation](https://github.com/electron/electron/blob/v45.2.1/patches/chromium/revert_oscrypt_remove_sync_backend.patch).
Checked 2026-11-15 against the pinned Electron version. Migration to the async
API before a later Electron upgrade needs separate format/provider verification.
