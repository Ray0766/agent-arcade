# Persistent local Mac signing — 2026-11-15

The owner explicitly authorized creating the signing credentials and necessary
trust configuration for personal use on this Mac, then rebuilding and checking
an update without more Safe Storage test dialogs. Nothing is published. This
follow-up starts from `7de0766189b6cf3cf4c5d1637628d9c51d281d02` on the independent
`codex/integrated-macos-20261115` worktree.

## Installed identity and boundaries

- Name: **Agent Arcade Local Signing**; RSA 3072, SHA-256 certificate signature.
- Certificate SHA-1 selection fingerprint:
  **`61B339CA14A652471B585499FE49F8C3615CDEBD`**.
- Valid 2026-11-15 11:47:48 UTC through **2036-11-12 11:47:48 UTC**.
- Self-signed non-CA leaf, digital signature key usage and **only code-signing
  EKU**. This is not an Apple Developer ID or a publicly trusted distribution.
- Private key imported non-extractable into a separate signing Keychain. Its
  application ACL allows `/usr/bin/codesign`; it does not use `-A` or grant all
  apps access. Standard Apple signing-tool partition IDs are scoped only to this
  new key. Existing login/Safe Storage entries are not modified.
- User trust changes contain only this new certificate's **CodeSigning** policy;
  the three pre-existing entries are unchanged. No TLS/system-wide trust is added.
  The default/user search list remains the original login Keychain; the builder
  explicitly selects the dedicated signing Keychain.

The certificate, encrypted PKCS12 recovery copy, generated password and profile
are local only under the owner's `Library/Application Support/Agent Arcade Signing`
private directory (0700; credential/profile files 0600). The dedicated Keychain
is `Library/Keychains/agent-arcade-local-signing.keychain-db`. Private materials,
passwords and full trust exports are never committed or uploaded. Keep the
protected directory and Keychain together for future updates; do not regenerate
or replace the certificate on each build. The setup refuses to overwrite an
existing signing installation. This file records public certificate identity,
not its private key or password.

## Access prompt encountered and corrected

Initial private-key signing access prompted for the **new signing Keychain's
random password**, not the Mac login password or an API key. That request was
stopped; the owner was told not to keep approving it. Inspection showed the
codesign application ACL was correct, but the initial key partition list lacked
`apple:`. It was corrected to the standard `apple-tool:,apple:` on this one new
signing key. Subsequent actual codesign completed in about 0.13 seconds without
interaction; no Safe Storage call was made.

The first user CodeSigning trust command timed out at the CLI. Later trust
export comparison showed it had completed: exactly the new certificate was
added, with only the CodeSigning policy and no original-entry changes. No
repeated trust authorization was run. Self-signed identities are suitable for
Keychain's designated-requirement tracking; they do not need to become a broad
system/TLS root. [Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)
was checked for that distinction, not treated as a current distribution guide.

## Persistent build profile

`scripts/build-mac.cjs` automatically loads the private local profile on Darwin.
The pin is not a Git secret or a temporary environment variable. It validates
ownership/permissions, exact fingerprint, self-signature, non-CA status, sole
code-signing EKU and expiry. A mismatched override, unsafe file, absent key or
wrong identity stops the build. Only this verified local pin may accept the
exact `CSSMERR_TP_NOT_TRUSTED` metadata suffix; expired and other failures remain
rejected. Static `codesign` verification separately checks the actual artifact.

`--check-signing` reads metadata/public certificate only, never the password.
Actual builds unlock only the dedicated signing Keychain using the protected
local configuration; errors are sanitized. The child gets that Keychain,
required signing, no timestamp service, no notarization and `publish=never`.
The npm entry and profile flags are normalized to one literal `publish=never`;
a real builder-parser test prevents duplicate flags becoming an array.
Inherited signing-import and Apple service credentials are excluded. Invalid
profiles cannot silently become ad-hoc builds.

Actual preflight returned `ready:true`, the exact fingerprint above and
`localOnly:true`. Directed identity/backup tests passed **32/32**, with zero
failures/skips; the profile tests use fixtures and never read the real password.
Two different harmless binary copies were signed but never executed. Their
CDHashes differ, but both have exactly:

```text
designated => identifier "io.github.agentarcade.desktop" and certificate root = H"61b339ca14a652471b585499fe49f8c3615cdebd"
```

Both pass strict validation against that pinned requirement. This removes the
ad-hoc requirement's dependence on a per-build CDHash. It does not retroactively
change the access policy of an item created by an older ad-hoc App.

## New candidate and verification

The new local candidate is **0.4.0-preview.3**, unpublished. Build source,
archive identities, static package checks and no-OS-vault synthetic results
are appended after the clean-source build. Previous preview.2 artifacts and
[their evidence](MACOS_INTEGRATION_20261115.md) keep their original identities.
The existing App/installation, real API key, encrypted vault, conversations and
memory are not opened or replaced. No real Safe Storage or model test is planned.
A first owner-controlled transition from the old ad-hoc App can still need one
OS authorization; this run will not manufacture or loop that dialog.

## Final cold build and artifacts

**Build-source commit:** `a50ab993dddeb6faa11e2ab0313cbbcf86265c00`.
The worktree was clean before the build. Evidence-only documentation is committed
later and identified separately at delivery. Version is `0.4.0-preview.3`.

The dedicated signing Keychain was explicitly locked first. A native read-only
status check recorded `signingKeychainUnlocked:false`, flags **2**. The normal
project build then automatically unlocked it **before identity inventory**,
signed with the pinned certificate and exited **0**. Post-build status was
`signingKeychainUnlocked:true`, flags **7**. No owner password was requested by
that cold build. Only the new signing Keychain was locked/unlocked; login and
Safe Storage were not touched.

```sh
# Uses the persistent local profile; no exported password/identity needed.
npm run dist:mac -- --require-stable-signing --mac dmg:arm64 zip:arm64 \
  -c.electronDownload.cache=/private/tmp/agent-arcade-integration-build-20261115/electron-cache \
  -c.directories.output=/private/tmp/agent-arcade-local-signed-build-20261115/artifacts-cold \
  -c.extraMetadata.buildSourceCommit=a50ab993dddeb6faa11e2ab0313cbbcf86265c00 \
  -c.extraMetadata.localSigningCertificate=61B339CA14A652471B585499FE49F8C3615CDEBD
```

Build environment: macOS **27.2.1 (26B131)** / arm64, Node **24.21.0**, npm
**11.19.0**, Electron **45.2.1**, electron-builder **26.18.1**. The wrapper forces
one `publish=never` value, `mac.notarize=false` and `mac.timestamp=none`. Only
arm64 DMG/ZIP were targeted, using the private/tmp caches and source worktree.

| Final cold-build file | Bytes | SHA-256 |
| --- | ---: | --- |
| `/private/tmp/agent-arcade-local-signed-build-20261115/artifacts-cold/Agent Arcade-0.4.0-preview.3-arm64.dmg` | 155650969 | `3a5c7197af200250f5d54b921018c3a2c20bd030308731ba6f164f44164d36ac` |
| `/private/tmp/agent-arcade-local-signed-build-20261115/artifacts-cold/Agent Arcade-0.4.0-preview.3-arm64-mac.zip` | 154554271 | `f688a40617ab5b77e70279beae9546a17a13fd4c18f875a96576d69ffdb520f1` |

Both contain production ASAR
`1894e6654151fae00c5769767443017fc240bfbc9a60dc525d09361a49b61df5`, standard
`src/bootstrap.cjs`, version preview.3 and the full embedded source/certificate
identities above. All **455 src files** match build inputs; **415 code/config
files** retain tree hash
`35cabe89d278abbafbd77157319e9356f662b3b3c9864daf4828dc1109f6e41e`.
All **85** modules loaded by this source's fixed cases also match the new ASAR.
Private signing configuration/password/PKCS12 and the excluded proprietary
Claude Agent SDK are absent. No production `src` behavior was changed.

DMG verification and ZIP CRC checks passed. Both archives are extracted/mounted
read-only for the synthetic check. Production `codesign --verify --deep --strict`
with the explicit identifier/certificate-root requirement passes. Authority is
**Agent Arcade Local Signing**, not ad-hoc and not Apple Developer ID. The
preview.2 validation copy, initial warm preview.3 build and final cold preview.3
have different contents/CDHashes and the same designated requirement, anchoring
updates to the fixed certificate rather than the per-build CDHash. Original old
packages are unchanged; validation copies were never executed for signature proof.

The initial warm signed build used source `54dd11b` and remains under the sibling
`artifacts/` directory. Its earlier SHA/receipt is not relabelled as the final
cold build. The cold-inventory correction and the following test-fixture fixes
were committed independently before this final rebuild.

## Verification and actual limits

Final clean-source command:

```sh
ARCADE_PROCESS_PROOF=1 npm test -- --test-concurrency=2
node scripts/companion-cases.cjs --output outputs/local-mac-signing-20261115/delivery-fixed-cases.json
```

- **5038** root tests: **4321 pass, 717 skip, zero failures**, 72.929 seconds.
  Skips retain their Windows/Linux owned-IPC, Windows-native and missing-offline-
  fixture reasons; they are not passes or other-platform acceptance.
- **32/32** directed signing/backup tests; the signing tests include the actual
  builder parser, locked → unlock → inventory → build order, metadata-only
  non-access, certificate pinning, wrong identity/expiry/unsafe permissions,
  policy overrides and secret-free errors.
- **19/19 required** fixed cases, zero errors/unexpected fetch. M09 lexical
  synonym selection remains **one exploratory gap**, not a required pass.
- **961** JS files passed the final syntax check. Final first-use checking passed
  **286 local links / 32 anchors / four pinned command sets**; release checking
  confirms one read-only verification workflow with no publication steps.

Prior failures are retained in the local logs, rather than replaced by the final
green count. The first and a later run exposed an original process fixture's
500 ms exit-confirmation override; it now uses the existing **production 2000 ms**
budget while retaining real group/PID/unrelated-process assertions. A later run
exposed a separate fixture race: it closed after request submission plus one
microtask instead of waiting for the named accepted receipt. It now uses an
explicit receipt latch. **Only test code changed** for those issues: production
process/QQ behavior and its truthful unknown-outcome handling remain unchanged;
QQ was not expanded. The fixture fixes were verified and included in the final
full regression above.

The final actual archive run uses only `synthetic-no-os`, local provider
stand-ins, a separate temporary App identity/guard/profile and an unchanged
production ASAR. Test copies change Info.plist identity and receive ad-hoc test
signatures; those signatures are not used as production-certificate proof.
The certificate/DR evidence comes from the unmodified final production App.
No native safeStorage getter, real model, original CLI credential or real owner
profile is accessed by the synthetic run. Its final receipt/screenshot summary
is recorded with [the sanitized evidence](evidence/local-mac-signing-20261115.json).

A static Gatekeeper assessment of this self-signed/unnotarized candidate returns
**rejected** (exit 3); stapler reports **no ticket** (exit 65). No Gatekeeper rule,
quarantine or system policy was disabled or bypassed. This is a local personal
signer, not an externally distributable/notarized release. Human installation
and first authorization remain separate from signature integrity.

The original App and real API key/chat/memory paths were not opened or replaced.
The App name, bundle ID, encrypted vault formats and data paths remain unchanged.
Existing data-file backup/recovery safeguards remain in place. A first transition
from an ad-hoc App can still require **one real owner authorization** for the old
Safe Storage item; this run deliberately does not trigger it or modify its ACL.
The random signing-Keychain password is handled by the protected build profile,
not an input the owner must repeatedly type. Actual real-key retention/model
quality and other system dialogs are not marked passed by the synthetic check.

Local raw evidence: `outputs/local-mac-signing-20261115/` in the integration
worktree; warm and cold build logs are under
`/private/tmp/agent-arcade-local-signed-build-20261115/`. Private signing materials
and trust exports remain outside Git. No installer upload, push or Release was
performed. The dedicated persistent signing setup survives replacing the App
or this temporary worktree; keep its private directory and Keychain protected.

Final cold-archive synthetic result: **11 checks / 11 labelled screenshots /
15 loopback stand-in requests / zero renderer errors**, all fake-key and tool-free.
The production bootstrap/code is unchanged. Same-build restart, preview.2 →
preview.3 pre-store backup, three SQLite integrity checks and complete manual
restore passed: **10 files**, original mapped root, retained chat/facts/fixture
vault bytes and a preserved newer-data directory. This normal-exit backup had
**0 WAL / 0 SHM files**; nonzero WAL/SHM coverage comes from the directed tests.
All five final test App processes exited. The lead inspected the final restored
UI screenshot, visibly marked `SCRIPTED / SYNTHETIC · NO OS VAULT · LOCAL PROVIDER`.
This is not acceptance of the real API key or OS Keychain's first transition.

Local commits in this follow-up are `661c6e8` (persistent signer/preview.3),
`54dd11b` (single publish policy), `f259c6c` (cold unlock ordering), `286fd8a`
(production-budget fixture), `a50ab99` (receipt latch / final build source) and
the later evidence-only commit containing this report. Previous reports and warm
artifacts retain their original source identities.

**Completed:** persistent personal signer, repeat/cold signing, fresh final
arm64 installers and independent static/synthetic validation. Existing real
credentials/chats and running App remain untouched. No external publishing.
