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
`localOnly:true`. Directed identity/backup tests passed **30/30**, with zero
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
