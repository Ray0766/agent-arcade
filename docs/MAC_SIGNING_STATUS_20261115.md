# Mac stable-signing inspection — 2026-11-15

**Later owner-authorized result:** a personal-use identity is now installed and preview.3 rebuilt. See [LOCAL_MAC_SIGNING_20261115](LOCAL_MAC_SIGNING_20261115.md). The empty-identity findings below describe the preceding inspection.

The owner requested checking installed signing identities, pinning a usable one
and rebuilding without another automated Keychain dialog. This follow-up starts
from clean `codex/integrated-macos-20261115` at
`b003c7be559f64e99a9e1571ba2241ba0628b442`, in the independent integration
worktree. Neither original input workspace is changed.

## Read-only result and current blocker

Executed against the current user's configured keychain search list:

```sh
security find-identity -v -p codesigning
# 0 valid identities found
security find-identity -p codesigning
# Matching identities: 0 identities found
# Valid identities only: 0 valid identities found
security list-keychains -d user
# login.keychain-db is the sole configured user keychain
security find-identity -v -p codesigning /Library/Keychains/System.keychain
# 0 valid identities found
```

These commands enumerate signing metadata; they do not export a private key,
unlock a keychain, read saved App API keys or start the App. No signer was
selected and no certificate, trust rule or Keychain access list was created or
changed. A certificate might exist in an unregistered keychain or external
archive; this check does not claim to have searched private files for one.

The existing preview.2 App is still ad-hoc, with designated requirement
`cdhash H"1453eadfaf45d48c257f8bd84624e8992a698fc4"`. It is unchanged; the earlier
DMG still hashes to
`dfede15513b8aed7c1accb5a2c15049ae964f2632ee954bee0f867b380ec22a6`.
No new package was built: there is no available installed identity to pin.
The prior [integration evidence](MACOS_INTEGRATION_20261115.md) keeps its original
build-source/artifact identity and is not relabelled as a signed update.

## Necessary build-tool correction

The installed electron-builder 26.18.1 implementation was inspected:
`codeSign/macCodeSign.js` reports a missing identity as a warning unless
`forceCodeSigning` is true; it also rejects full Apple certificate-name prefixes
and otherwise performs substring matching. The previous wrapper/documentation
assumed a selected missing identity always failed. That assumption was corrected.

`scripts/build-mac.cjs` now provides:

- `--check-signing`: read-only identity inventory/preflight; no builder is loaded.
- Exact installed name or certificate SHA-1 selection, resolved to one hash.
  Duplicate names, missing/expired identities, substring choices and failed
  metadata inspection stop the stable path before packaging.
- Explicit selection adds `--config.forceCodeSigning=true`, with conflicting
  identity/signing-policy CLI overrides rejected. The builder receives the
  resolved hash, so full Apple-name prefixes are not forwarded incorrectly.
- `--require-stable-signing` also refuses an unset selection. Legacy ad-hoc
  packaging remains available for its existing local/CI scope, and is explicitly
  insufficient for update-stability acceptance.
- Stable builds use the installed key only; inherited certificate-import
  environment variables are removed from that builder child. No signing key
  export/import or private credential is implemented by this wrapper.

The actual new preflight was executed on this Mac:

```sh
node scripts/build-mac.cjs --check-signing
# {"checkOnly":true,"ready":false,"identities":[],
#  "reason":"No valid installed code-signing identities found."}
# exit 1
node scripts/build-mac.cjs --require-stable-signing \
  --mac dmg:arm64 zip:arm64 --publish never
# No valid installed code-signing identities found.
# Stable packaging stopped before electron-builder.
# exit 1 (expected blocker)
```

A metadata-only consumer check ran the installed builder's actual yargs parser,
option normalization and configuration schema: exact certificate hash preserved,
`forceCodeSigning` coerced to boolean `true`, arm64-only DMG/ZIP targets and
`publish: never`. No real signing/build operation was invoked by that check.

`npm test -- test/update-identity.test.cjs test/update-backup.test.cjs`:
**19/19 passed**, zero failures/skips. This includes synthetic valid-cert
resolution, ambiguity/expired/missing/metadata failure, override rejection and
backup/identity regression. Both edited JS files passed syntax checks; diff
whitespace passed. The source/build/metadata checks do not claim a real signed
artifact or cross-update Keychain success. No full regression or App window was
needed for this build-only change. Raw logs remain local under
`outputs/mac-stable-signing-20261115/`.

## Owner prerequisite, then the bounded build

An installed, usable certificate **with its matching private key** is required.
The owner can identify an existing certificate/other keychain to use, or choose
provisioning a persistent local code-signing identity for personal use versus a
Developer ID Application identity for external distribution. Provisioning creates
signing credentials and may change trust, so it is not automatically done under
the previous prohibition on new credentials/permissions. Do not send a private
key or its password in chat or commit it.

Once an identity is available, choose the exact certificate fingerprint returned
by `security find-identity`, keep that choice for subsequent builds, then run:

```sh
export AGENT_ARCADE_MAC_SIGN_IDENTITY='REPLACE_WITH_40_HEX_CERTIFICATE_SHA1'
node scripts/build-mac.cjs --check-signing
# Continue only when ready:true and the intended certificate is displayed.
npm run dist:mac -- --require-stable-signing --mac dmg:arm64 zip:arm64 \
  -c.electronDownload.cache=/private/tmp/agent-arcade-integration-build-20261115/electron-cache \
  -c.directories.output=/private/tmp/agent-arcade-stable-signed-candidate
```

The placeholder is not an installed identity. The project entry retains
`--publish never`. After an actual build, inspect the certificate chain,
designated requirement, signature/ASAR and artifact hashes without opening an
owner profile. A first transition from ad-hoc to certificate signing may still
need owner-controlled OS authorization. Stable signing is not notarization and
is not proof of zero future dialogs.

The App name `agent-arcade`, bundle ID `io.github.agentarcade.desktop`, data
paths, vault bytes and SQLite formats were not changed by this follow-up. The
running App and real API key/chat files were not opened, copied, reset or
replaced; their private contents were not inspected. No test App or Keychain
prompt was launched. Existing data-file snapshots remain separate from the
system encryption key, as explained in [credential retention](CREDENTIAL_RETENTION.md).

References checked 2026-11-15:
[Electron safeStorage signing requirement](https://www.electronjs.org/docs/latest/api/safe-storage),
[Apple Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).
Apple's self-signed certificate guide returned HTTP 429 during this check; no
new local certificate procedure or trust change was executed.

**Outcome:** metadata inspection and strict build preparation completed;
stable-signed repackaging and Keychain update acceptance remain blocked on the
owner's signing identity decision. Saved API keys/chats were not modified.
