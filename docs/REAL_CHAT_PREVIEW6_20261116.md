# Installed preview.6 — bounded real DeepSeek chat check

2026-11-16, Australia/Sydney. The owner explicitly requested using their existing
DeepSeek test key to exercise the installed new version, companion switching and
quit/reopen retention, without Keychain authorization tests. This is a follow-up
to [the fixed-client repair](MAC_CREDENTIAL_BROKER_20261116.md), not a new build.

## Exact tested installation

- Installed App: `/Users/ray/Applications/Agent Arcade.app`, `0.4.0-preview.6`.
- Build source: `00e7b31b79f353ed7b28637fa043ef4e21d32619`.
- ASAR SHA-256: `8607ee21d965bc7649b20286af17c0865f0de9852572d1a51db6fdfe46035206`.
- Fixed helper SHA-256: `7a0a7b8d5ca19afeecd790d687846abe0b94c5949b082ebfeed4cb2de71b5ecc`.
- App/helper bytes were checked before/after and remain unchanged. No runtime
  repair, rebuild, installation, publication or credential re-entry was needed.

The native installed UI was operated through CUA, without debugger flags or a
provider stand-in. Requests used the existing separate DeepSeek test profile;
UI service/model labels were **DeepSeek API / DeepSeek Flash**. Persona switching
kept this provider and saved test key. Original non-test profiles were only
viewed/compared; no request was sent from them.

## Actual results

| Step | Observed result |
| --- | --- |
| First real request as the test profile's default Ju persona | Reply: `新版本连接正常，海盐7319。` |
| Switch the same test profile to Whale | Empty separate persona history; the same saved API remained usable. Second real reply: `鲸鱼娘连接正常，月贝2846。` plus a note declining long-term storage. |
| Switch to the original saved profile and back | Original history visible without test messages; returning to the test profile restored Whale's new exchange. |
| Cold restart the installed App | Whale selection/history returned, ready status was shown, and API settings displayed “已保存，无需重复填写”. No key was entered or returned to the renderer. |
| Switch back to the original default Ju persona after restart | Ju's earlier history returned without Whale's messages. A third real request asked for this run's earlier marker without supplying its value; DeepSeek replied `海盐7319`. |

These are three real requests with synthetic test prompts, **not** a mock
response or proof of durable long-term memory. No new facts were stored. Native
screenshots of both initial replies and the post-restart reply were inspected
and retained in this conversation. The App is left normally running in the
original test profile/default persona, ready to chat.

## Retention and commands

Before the first message, read-only SQLite connections produced private consistent
copies for all three profiles; copied databases passed `PRAGMA quick_check`.
Encrypted vault SHA-256 and full row hashes were captured without printing keys
or original conversations. The after-run comparison used new consistent copies:

- Three vault files: exact bytes unchanged; no key reset/re-save.
- All pre-existing rows retained unchanged across all 33 tables.
- Two unrelated profiles: all tables unchanged; message counts remain 4 and 3.
- Test profile: messages 6 → 12, exactly three user/assistant pairs; one new
  persona scope. Ju and Whale markers occur in disjoint scopes.
- All other test tables unchanged, zero facts added; all database integrity
  checks pass.
- Zero authorization commands, Keychain ACL changes or interactive test retries.
  Ordinary fixed-helper reads retain their prohibition on system interaction.

Private evidence, including consistent database copies, hash baselines and receipt:
`/private/tmp/agent-arcade-real-chat-20261116/` (not committed/uploaded).
Actual local commands were:

```sh
python3 /private/tmp/agent-arcade-real-chat-20261116/snapshot.py
python3 /private/tmp/agent-arcade-real-chat-20261116/verify.py
```

UI requests/switches/quit/reopen were executed through the native CUA controls;
the private `receipt.json` records the comparison results. This document is the
tracked non-secret summary, not a public link to private test data.

## Remaining issue and acceptance limit

**Normal Quit did not fully exit:** Command-Q closed the window but left the
already known idle main process. The test recorded its exact own executable,
UID and PID, sent only that residual main a TERM, then reopened the installed
App. Thus cold-reopen key/history/real-request retention passes, while ordinary
full-process Quit remains an open product defect. No unrelated process was
terminated and no data reset was used.

This accepts the bounded real DeepSeek path on this Mac/arm64, two personas and
one cold restart. It does not accept every backend, another Mac/platform,
notification/IME/permission behavior, seven-day use or external user adoption.
Only documentation/evidence changes follow this check; the installed build
source remains the hash above.
