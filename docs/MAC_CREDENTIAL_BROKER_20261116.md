# Fixed local macOS credential component — 2026-11-16

Work in progress on `codex/stable-credential-broker-20261116`, based on
`38f82de20bb833b0a2b2fc749c6b93cddcbc2e94`. The owner's request is to implement
and verify a local update-safe solution, preserve existing credentials/history,
and avoid repeated authorization exercises. No push, publication or new account.

The previous fixed self-signed App certificate did not prevent a separate
Keychain partition mismatch when the App CDHash changed. This repair moves only
the macOS vault cryptographic client into a fixed, separately installed native
executable. Ordinary App updates neither recompile, re-sign nor replace it.
The original Keychain item and v10 encrypted files are retained in place.

## Decision and boundaries

- Fixed helper reads only `agent-arcade Safe Storage` / `agent-arcade` from login
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

## Verification checkpoint

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

Pending: complete source regression, build the hardened actual App, verify
production peer admission without prompting, authorize the fixed helper once if
needed, compare distinct final App builds, activate normally and verify original
vault bytes/chat rows. Final evidence will replace this checkpoint before delivery.
