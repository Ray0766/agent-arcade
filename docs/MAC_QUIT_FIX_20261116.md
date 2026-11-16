# macOS normal Quit repair — preview.7, 2026-11-16

The owner requested repairing the main process left after Quit, rebuilding and
verifying complete exit/reopen while preserving saved keys/history and avoiding
Keychain dialogs. This repair follows [preview.6 real-chat evidence](REAL_CHAT_PREVIEW6_20261116.md).
QQ scope, credential permissions and the fixed native helper were not expanded.

## Root cause and minimal change

The same isolated production source exited normally when a timer called
`app.quit()`, but a real macOS **Quit** menu action completed every cleanup,
closed the window and remained alive. Its trace ended at the second
`before-quit` and `window-all-closed`, without `will-quit`/`quit`. Empty data,
blocked network and a stub vault reproduced this without touching owner data or
Keychain. The single-instance listener was a remaining resource, not the cause.

Electron 45.2.1 [assigns its quitting flag after HandleBeforeQuit returns](https://github.com/electron/electron/blob/v45.2.1/shell/browser/browser.cc#L112).
A native callback can drain the resolved cleanup Promise continuations while
that cancelled outer call is still on the stack. Immediately calling Quit again
starts closing windows, then the outer cancellation overwrites the quitting
flag. That reentrancy explanation matches the native-only failure trace and the
fixed result; it is an inference from the source and observed lifecycle, not a
claim to have instrumented Electron's private C++ flag.

`src/main.cjs` now awaits one full `setImmediate` turn **after all existing
cleanup confirmations** and before setting `cleanedUp`/resuming `app.quit()`.
The pending shutdown task includes that barrier, so repeated Quit requests share
it. No force-exit, process kill, cleanup deadline bypass or suppressed cleanup
failure was added. Voice/local/remote/component cleanup failures still retain
ownership and allow retry. The fixed credential helper was neither rebuilt nor
re-signed/replaced.

## Verification

- New production-handler regression fails on old source and passes on the fix:
  an outstanding native callback's microtasks cannot resume Quit; repeated Quit
  shares the pending operation. Other cleanup/failure/retry tests remain intact.
- Targeted lifecycle/menu/single-instance tests: **38 passed, one platform skip**.
  A default-sandbox attempt could not open test sockets; the permitted local
  runner passes without product workarounds.
- Full regression: **5065 total, 4348 passed, 717 platform skips, zero failed**.
  Syntax: 976 JS files; initial docs 291 links/32 anchors/four command sets;
  release safety: one read-only workflow, no publication.
- The repaired source's actual native menu action reaches `will-quit`, `quit`
  and process exit **0**. The old failure trace is retained separately.
- Fresh ZIP extracted to an isolated empty profile: real package native Quit
  returns **0**, with no remaining App processes. No source patch, inspector or
  fake quit implementation is used in this package test.
- Installed normal-owner-profile App, **two complete native menu Quit cycles**:
  both main exit codes **0**, all observed descendants gone (14 and 11 observed
  processes), no forced termination. Recorded launch-to-exit durations include
  the manual UI/chat steps and are not Quit-latency measurements.
- First normal exit: all three encrypted vault files and all 33 chat/memory
  tables match the cold backup exactly.
- Second launch: the existing separate DeepSeek test key obtains the real reply
  `退出重开后连接正常`. Second normal Quit/reopen preserves that exchange and
  all old rows. Only two test message rows are added (12 → 14); unrelated
  profiles stay at four and three messages, other tables unchanged, zero facts
  added. All copied SQLite integrity checks pass.
- No key re-entry, reset, plaintext key export, Keychain authorization command,
  ACL/trust change or interactive retry. Normal reads continue to forbid system
  interaction. Final native screenshot was inspected in this conversation; the
  App is left normally running and ready in the original test profile/persona.

The old preview.6 process needed a targeted TERM after reproducing its known
failure to permit a cold backup. **That applies only to the old bundle**;
new-package/native exit acceptance above used no TERM/KILL/app.exit fallback.

## Source, artifacts and recovery

- Branch: `codex/mac-quit-lifecycle-20261116`.
- Worktree: `/private/tmp/agent-arcade-stable-vault-20261116`.
- **Build source**: `ec5d79a15de1dac0f20dba94b7a823cf8c724c0a`.
- Later evidence/docs commit is separate; no runtime code changed after build.
- Version: `0.4.0-preview.7`; macOS 27.2.1 (26B131), Apple Silicon arm64.
- Node 24.21.0, npm 11.19.0, Electron 45.2.1, electron-builder 26.18.1,
  Xcode 27.2 (27B52).
- App CDHash: `a85243031bcc165063db623e8a32dfce6422c9cd`.
- App ASAR SHA-256: `6b84afff3d95287a636b9268fef4b73806938b54cad65039a9fa49e45644b3c6`.
- Fixed helper SHA-256: `7a0a7b8d5ca19afeecd790d687846abe0b94c5949b082ebfeed4cb2de71b5ecc`;
  its signed pin is unchanged in the new package.

| Local artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `/private/tmp/agent-arcade-quit-20261116/artifacts/Agent Arcade-0.4.0-preview.7-arm64.dmg` | 155695409 | `d3387c8cfee8be25819cb53dbbe1498f54d7e4435ec03a953e8dd8d4bd894cb9` |
| `/private/tmp/agent-arcade-quit-20261116/artifacts/Agent Arcade-0.4.0-preview.7-arm64-mac.zip` | 154571388 | `26a09879f873430e6dcb5399a68cb61e35b7ebc38bf817945fe8ee14963ed301` |

Strict deep signature verification, ZIP CRC and DMG checksum pass. All 462
packaged source/assets match the build commit or the three declared generated
brand icons. The pinned personal certificate is unchanged; hardened runtime,
ASAR integrity/ASAR-only and restricted interpreter/inspector fuses remain.
This is **self-signed for this Mac, unnotarized, unpublished**, not a Developer ID
release or acceptance of another platform/architecture.

Cold backup before replacement:
`/Users/ray/Desktop/Study/vibe-coding/Agent Arcade/work/backups/pre-quit-fix-20261116-140914`.
It contains 361 data files / 16,366,623 bytes, 93 copied SQLite integrity checks,
verified source/copy inventories, and the old preview.6 App under `previous-app/`.
Replacing the bundle did not reset data or the system Keychain item. For rollback,
quit preview.7 and restore the saved old bundle, retaining current data; this
repair does not change the database/vault format. The old Quit defect returns
with that old bundle. A full data rollback, if necessary, uses the complete
manifest-mapped snapshot including matching WAL/SHM, not one database file.

Private traces, process receipts, consistent DB copies and commands are under
`/private/tmp/agent-arcade-quit-private-20261116/` and
`/private/tmp/agent-arcade-quit-20261116/`; suite logs are in
`outputs/quit-20261116/`. None contains a committed API key or private chat export.
Original dirty source paths were not modified; no push, release, upload or
outbound message occurred.

## Reproducible commands and remaining boundary

```sh
node --test test/voice-asr-quit-ipc.test.cjs test/single-instance.test.cjs test/app-menu.test.cjs
npm test
npm run check
npm run check:first-run
npm run check:release
npm run dist:mac -- --require-stable-signing --mac dmg:arm64 zip:arm64 \
  -c.electronDownload.cache=/private/tmp/agent-arcade-integration-build-20261115/electron-cache \
  -c.directories.output=/private/tmp/agent-arcade-quit-20261116/artifacts \
  -c.extraMetadata.buildSourceCommit=ec5d79a15de1dac0f20dba94b7a823cf8c724c0a
```

Build used the existing local npm/Electron/builder caches and the wrapper's
mandatory publication prohibition. Actual UI actions used CUA; the monitor and
retention scripts recorded real process exit and private database comparisons.
No mechanical repeat of the full suite after documentation-only changes.

This accepts normal native-menu Quit/reopen on this Mac with an idle/settled App
conversation and one completed real API exchange. Active local tool/speech/
remote cleanup failure cases are unit-tested, not newly accepted with real
external processes. Notifications, IME, all other backends/platforms, extended
human use and external adoption remain separate gates.
