# API settings to App chat — 2026-11-16

This is a local repair of the owner's reported save-to-chat path, not a public
release or whole-product acceptance. Branch: `codex/api-chat-credentials-20261116`.
Build-source commit: `ad1531e4bef53943f0acea34f4a9f917636cc9c7`;
version: `0.4.0-preview.4`. Later evidence-only commits do not identify the
already-built App's source. [Sanitized receipt](evidence/api-chat-credentials-20261116.json).

## Cause and resulting behavior

AI/channel settings and App chat already use the selected companion's same vault.
Keys remain in separate provider slots; an `sk-` prefix cannot identify a provider.
Saving settings retires the old App runner, including a same-provider key update.
The channel page previously saved without completing that runner's recovery.
The first-run card could also retain a provider draft after the actual backend
changed elsewhere, and close after an unsuccessful chat-start result.

The existing channel page now names the saved provider and force-reopens a
previously selected/active App chat with the new saved scope. Channel-only
profiles keep their original choice. Save failure retains the input; start
failure retains the saved credential and offers the existing App-chat retry.
Scope changes cannot restart a different companion/backend. Old ready feedback
expires on a scope change. First-run clears an obsolete provider draft, reads
back the persisted scope, and keeps its dialog open when admission fails.
No vault format, provider slot, permission boundary or service lifecycle changed.

## Checks and reproducible commands

```sh
node scripts/api-key-chat-ui-smoke.cjs /private/tmp/arcade-api-chat-review
npm test -- test/api-key-chat-lifecycle.test.cjs
ARCADE_PROCESS_PROOF=1 npm test -- --test-concurrency=2
node scripts/check.cjs
node scripts/companion-cases.cjs --output outputs/api-chat-fixed-cases.json
npm run check:first-run
npm run check:release
```

- Full regression: **5039 total; 4322 pass, 717 skip, zero failures**, 73.903 s.
  The first sandbox run could not bind loopback fixture ports (`EPERM`); its log
  is retained separately. The same suite passed with local fixture/process access.
- Signing/credential/chat/provider directed baseline: **97/97**. New actual
  BotService/DesktopConversations/SQLite lifecycle regression: **1/1**, with fake
  vault/runners, old pending cancellation and stale-reply rejection.
- Production-renderer fixture: old source **5 failures in 10 cases**; final
  **14/14**, including scope races, deferred subscription delivery, failed save,
  failed admission, stale provider feedback and independent provider slots.
  Its three screenshots are labelled synthetic, with no OS vault/model call.
- Syntax: **963** JS files. Fixed cases: **19/19 required**; one exploratory
  synonym gap remains. Platform/native fixture skips are not accepted platforms.
- First-use/release checks passed; no workflow publication was enabled.

The owner supplied a separate DeepSeek test credential on 2026-11-16 and
explicitly authorized project API tests for the following 30 days. It is held
outside Git under `~/Library/Application Support/Agent Arcade Testing/`, directory
0700/file0600. Future authorized local API tests can use that protected test
configuration; it is not a bundled/default key. The owner's reported expiry is
2026-12-16, not a server-verified lifetime. Do not print it, add it to Git,
screenshots or exported receipts, or substitute it for an existing companion's
credentials. No test automatically runs a paid model as part of `npm test`.

A bounded production DeepSeek runner probe made **one real HTTPS request** to
the [official Chat Completions endpoint](https://api-docs.deepseek.com/api/create-chat-completion/),
model `deepseek-flash`, no tools, maximum 64 output tokens. It returned HTTP 200,
streamed deltas, and the requested synthetic connection confirmation. It sent no
original chat/profile. This proves provider connectivity and the runner, not the
App's full save-to-chat UI or all companion features; the separate native UI result follows below.

## Native candidate and activation boundary

A clean committed source was rebuilt via `npm run dist:mac`, using the existing
pinned local signing profile, `publish=never`, timestamp disabled and notarization
false. macOS 27.2.1 (26B131), Apple Silicon; Electron 45.2.1, builder 26.18.1.
All **455 packaged src files** match the inputs. Package metadata includes the
full build source and certificate pin; private credentials/signing materials
and the proprietary Claude Agent SDK are absent. Strict certificate-pinned
codesign, ZIP CRC and DMG checksum checks pass. This remains a self-signed,
unnotarized personal-use candidate; no public upload/release occurs.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `/private/tmp/agent-arcade-api-chat-build-20261116/artifacts/Agent Arcade-0.4.0-preview.4-arm64.dmg` | 155650920 | `05263193fd9227a4413ff072bb39144a29c7b360773625eeef178755486324d1` |
| `/private/tmp/agent-arcade-api-chat-build-20261116/artifacts/Agent Arcade-0.4.0-preview.4-arm64-mac.zip` | 154555019 | `6dbaa7413e3640fc81486ffa76b1ead25a5c63bd4107c5d3b04487cf9a14d5e5` |

ASAR SHA-256: `13313be7cde61e7d6607e9421e6b88f57eec6aea8855e329a302cc030c4fd282`.
Certificate SHA-1 selection pin: `61B339CA14A652471B585499FE49F8C3615CDEBD`.

Before activation, the App window was quit normally; a residual idle main process
remained and received TERM before the cold backup. This exit limitation was
recorded, not broadened into another feature repair. The fresh verified backup
contains **157 files, 24 copied database integrity checks**. The prior preview.3
bundle is retained alongside that private backup. The new App was installed from
the actual ZIP to `~/Applications/Agent Arcade.app`; no data/vault was overwritten
by the installer and no Gatekeeper/quarantine policy changed.

## Completed native API path and remaining Keychain issue

The owner confirmed **Always Allow** for the one real-update system dialog.
That first launch had an empty window; its normal menu Quit again left an idle
main process, so only that verified residual process received TERM. One recovery
reopen of the same installed App then loaded normally without another observed
prompt. This is an activation workaround, not an accepted fix for the empty
first-launch/exit limitation.

Using the normal App (no debugger, harness or provider replacement), a **new
independent test companion** saved the supplied test key through the channel page
and OS encryption. The agent entered App chat and observed real DeepSeek streamed
replies. While that chat was selected, saving the same test key again displayed
**“DeepSeek 密钥已保存，App 对话已就绪。”** The next real reply recovered the
synthetic marker from the previous conversation. There were three completed App
turns, plus the earlier separate runner probe. One initial automation keystroke
injection dropped Chinese characters; that test turn was retained, then Chinese
input was verified through paste before sending. Human native IME is not accepted.
The contextual marker proves this short conversation survived runner recovery,
not approved durable facts, seven-day memory quality or all companion features.

The two original encrypted vault files remained **byte-identical** to the fresh
pre-update backup. Both original chat/memory databases, **22 tables**, retained
all prior rows; integrity checks on copies passed. The new test companion does
not overwrite an original profile. Its default cosmetic persona can differ from
DeepSeek: persona, AI provider and companion profile are separate choices.
The existing two profiles also genuinely differ: one uses DeepSeek, the other
local Claude. A channel-page save and its chat must use the **same profile**;
creating/selecting another profile does not implicitly copy API keys. Built-in
persona switching within one profile can reuse its selected AI/credential.

The installed new and retained old App have identical designated requirements:

```text
identifier "io.github.agentarcade.desktop" and certificate root = H"61b339ca14a652471b585499fe49f8c3615cdebd"
```

**Future-update Keychain prompts remain unresolved.** A passive read of existing
securityd logs, restricted to the new App PID/CDHash, matched **one ACL partition
mismatch and one partition authorization request**. No Keychain API was called
for that diagnostic and raw messages were not retained. Apple's public
[client identity implementation](https://raw.githubusercontent.com/apple-oss-distributions/Security/main/securityd/src/clientid.cpp)
can assign other valid signed clients a CDHash partition; its separate
[partition ACL validation](https://raw.githubusercontent.com/apple-oss-distributions/Security/main/securityd/src/acls.cpp)
can prompt despite an ordinary ACL/DR match. That mechanism and this startup's
passive log evidence support the observed mismatch; a static DR match alone
was an insufficient basis for the earlier prompt-free-update expectation.
Increasing certificate trust is not established as a remedy. No broad ACL,
all-app permission, partition bypass, Gatekeeper exception or Keychain deletion
was applied. A further storage/signing architecture is not added in this repair.

Source, actual archive identity and the bounded real API-to-chat path are
verified. Other providers, real channel logins, notifications/IME, a future new
build's authorization, long-term memory quality and external adoption remain
separate acceptance. Nothing was pushed, released or uploaded.
