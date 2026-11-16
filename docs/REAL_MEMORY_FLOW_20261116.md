# Real DeepSeek memory / isolation / forgetting — 2026-11-16

Completed on `codex/real-memory-flow-20261116`, based on
`10179f838a49be4bb17abe883f84576d893b2d8e`. The owner requested real memory,
companion isolation, forgetting and restart checks using their saved DeepSeek
test key, preservation of existing data and no Keychain authorization tests.

## Protected baseline and test design

The installed starting App is preview.7, build source
`ec5d79a15de1dac0f20dba94b7a823cf8c724c0a`. A normal Quit preceded a complete
verified cold snapshot: 388 files / 17,183,331 bytes, 102 copied SQLite integrity
checks. Its private path is
`/Users/ray/Desktop/Study/vibe-coding/Agent Arcade/work/backups/pre-memory-flow-20261116-144200`.

Only the pre-existing separate DeepSeek test profile is used for model calls.
Its two existing Ju/Whale scopes were positively matched to the persisted scope
IDs, with 12 and two saved messages. Dragon and Rainbow Cat had no messages,
facts, notes, world-info state or other scoped records. Forgetting those newly
created test scopes therefore cannot clear old conversations. Other original
profiles are only checked read-only, without model calls.

Scope auditing uses both production `scopeFor(profileRoot, personaId)` and the
store's second SHA-256 transformation. The positive Ju/Whale match prevents an
empty query against the wrong raw hash from being accepted as isolation.

Both synthetic facts are entered through the actual **Together → App memory**
editor, not chat. They describe the same attribute with distinct values:
Dragon `雾杉4927`, Rainbow Cat `星砂6853`. Before any model request:

- Each scope has exactly one revision-1 fact with empty source IDs.
- Both chat histories and notes remain empty.
- Each marker occurs once in facts, nowhere in messages/actions/notes/follow-ups/
  journals/source notices.
- Full normal Quit/reopen leaves the facts, revisions and row hashes unchanged.

The same answer-free question is sent to each persona:
`我给你的私人物件编号是什么？只回答编号；没有记录就说不知道。`
The actual installed native UI receives `星砂6853` from Rainbow Cat and
`雾杉4927` from Dragon. Each marker is absent from the other's scope. These are
real DeepSeek requests with synthetic inputs, not provider stand-ins or a claim
about cross-month retention/large memory sets.

## Defect found during actual forgetting

The owner-authorized UI Forget action removes Dragon's synthetic fact and both
related message rows. Read-only queries confirm zero old-marker occurrences and
unchanged Rainbow/Ju/Whale row hashes. However, returning to the empty Dragon
chat still exposes `雾杉4927` in the native accessibility tree: the hidden
`#desktop-stream-live` announcement retained the prior completed reply.

This is a renderer retention/isolation defect, even though the underlying fact
and history deletion succeeded. The renderer now binds the live announcement to the selected account, source,
persona/context/history and exact stored assistant message. It removes stale
announcements when the row changes/disappears, the conversation changes or the
Chat page is left. Pending streams are also bound to that context; an old
completion cannot adopt the new conversation's last row. Valid completion is
still announced once, not on every snapshot.

The regression reproduced the old defect and passes after the fix: eight stream/
announcement checks and the complete 19-check memory UI flow, including Chromium
accessibility inspection. Five synthetic screenshots were inspected, 108 input
hashes stable, no page errors/external requests. An outdated heading-font assertion
was aligned with the already existing layout CSS; product typography was not
changed to accommodate a test.

## Evidence minimization

Cold backups are private recovery data and are not committed/uploaded. Runtime
checkpoints save only counts, row hashes, fact IDs/revisions/source IDs and
synthetic-marker hit counts. They do not export original chat/fact bodies.
Automatic approval rejected an initial proposal for an additional full-message
JSON export as excessive; that operation was not executed. The smaller read-only
checks were approved and completed instead, with no user permission request.

Private scripts/checkpoints are under
`/private/tmp/agent-arcade-memory-private-20261116/`. This tracked document is the
non-secret summary. The API key is neither printed/re-entered nor added to Git;
the fixed credential helper/ACL is not changed and no authorization test runs.

## Final installed preview.8 real-model results

The repaired actual ZIP was strictly verified and installed, retaining the old
preview.7 bundle and data. Four additional real DeepSeek requests ran in this
installed preview.8, after the two initial preview.7 requests: **six total**.
No test stand-in, inspector or real non-test account is used.

| Final scenario | Actual result |
| --- | --- |
| Add Dragon's synthetic fact again via App memory; normal Quit/reopen; confirm zero Dragon chat rows before the first query | Fact revision/source IDs/row hash persist exactly; DeepSeek answers `雾杉4927` to the answer-free question. This repeat is fact-only evidence on the final installation. |
| Switch to Rainbow Cat after that completion | Cat's own history appears; Dragon's old number is absent from the native AX tree. |
| Forget Dragon through App memory, return to empty Chat | Fact/messages/notes cleared, all old-marker logical row counts zero; positive Dragon/empty-view AX check passes with `forgottenMarkerPresent: false`. The original hidden-live-region defect is no longer present. |
| Ask immediately in the same process | Real reply: `不知道。我这边没有关于私人物件编号的记录。` No deleted marker is reintroduced. |
| Normal menu Quit, verify no App processes, reopen and repeat the same query | The same negative real answer; deletion/history state remains persisted. No force termination or key re-entry. |
| Switch to Rainbow Cat and repeat the same query | Real reply `星砂6853`; its fact ID/revision/hash remains unchanged across Dragon's forgetting and both restarts. This checks retained independent memory, not another fact-only first query for Cat on preview.8. |

The final native UI and screenshots were inspected through CUA. Its same-process
forget, role switch and post-restart output are separate from the synthetic
renderer regression. Both normal preview.8 Quit cycles completed with no App
processes remaining. No Keychain authorization command or permission change was
used anywhere in this execution; the fixed helper was neither rebuilt nor
replaced.

## Cleanup and preservation

After capturing the retained-Cat result, its **newly created synthetic fact** was
forgotten through the same UI. It and its four test chat rows were removed; this
scope was positively empty before the run. Original Ju/Whale rows are unchanged.
Both synthetic markers are now absent from active facts, messages, notes,
actions, follow-ups, journals and source notices. The four negative-answer test
messages remain only in the previously unused Dragon scope for review. Original
profile/default Ju selection and its existing history are restored; App ready.

Final read-only comparison against the initial cold snapshot verifies:

- All three encrypted vault files byte-identical; no reset or re-save.
- All pre-existing rows across 33 tables/three databases retained unchanged.
- Unrelated profiles completely unchanged; initial Ju 12 and Whale two messages
  unchanged in the test profile.
- Test database only adds two scope rows and four negative-answer messages;
  zero net facts/notes/actions/follow-ups/other records added.
- All database integrity checks pass; no original chat/fact plaintext is
  exported into additional verification JSON.

An automatic approval review rejected an initial proposal for an extra JSON
export containing full message/fact bodies, because counts/hashes/marker hits
suffice. That command did not execute. The successful replacement reads coherent
SQLite snapshots in read-only transactions and records only counts, hashes,
fact IDs/revisions/source IDs and synthetic-marker hit counts. Nothing remains
blocked by that review; no expanded data-export permission was requested.

## Source, package identity and checks

- Branch: `codex/real-memory-flow-20261116`.
- Worktree: `/private/tmp/agent-arcade-stable-vault-20261116`.
- **Build source**: `8dd258c401554b51d89a8e6923586e8095783515`.
- Later evidence/docs commit is separate; installed runtime bytes are unchanged.
- Installed version: `0.4.0-preview.8`, macOS 27.2.1 (26B131), arm64.
- Node 24.21.0, npm 11.19.0, Electron 45.2.1, builder 26.18.1, Xcode 27.2 (27B52).
- ASAR SHA-256: `d782f7d8c53214e17199217c3acbd9f92051e5c947d4a1ddfa8338c397dec6a4`.
- App CDHash: `9fa3007a1ad7d9851264d1c374b28ea3a92e6ea9`.
- Fixed helper SHA-256 remains `7a0a7b8d5ca19afeecd790d687846abe0b94c5949b082ebfeed4cb2de71b5ecc`.

| New local artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `/private/tmp/agent-arcade-memory-20261116/artifacts/Agent Arcade-0.4.0-preview.8-arm64.dmg` | 155692222 | `d5a14b97b89de2bb5f782e4aaf2ee96cffc3d9658f2b98c4688792b842110f0a` |
| `/private/tmp/agent-arcade-memory-20261116/artifacts/Agent Arcade-0.4.0-preview.8-arm64-mac.zip` | 154571262 | `025bb7ab3b5ae38d7a85cb3badbb21fc1001b8c651cdecb7a22037c65cd13459` |

Strict deep signature/ZIP CRC/DMG checksum pass; all 462 packaged source/assets
match the build commit or the three declared generated icons. Same pinned
personal certificate/hardened runtime/fuses; **self-signed, unnotarized, local
only**. No push, release, upload or external user adoption is claimed.

Final source checks: **5065 total, 4348 passed, 717 platform skips, zero failed**;
976 JS syntax checks; first-run/release checks pass. The full suite was not
mechanically repeated after documentation-only changes.

A second verified cold snapshot before replacing the bundle retains the interim
test state: 388 files / 17,184,030 bytes, 102 copied SQLite checks, under
`/Users/ray/Desktop/Study/vibe-coding/Agent Arcade/work/backups/pre-memory-ui-fix-20261116-145257`.
Its `previous-app/Agent Arcade.app` is the intact preview.7 bundle. This repair
changes no vault/database format. Rollback can retain current data and restore
that bundle after normal Quit, but would restore the old announcement defect.
Only use a complete manifest-mapped data snapshot with its matching WAL/SHM if
an explicit data restore is needed; do not restore one SQLite main file alone.

Private minimal receipts and scripts:
`/private/tmp/agent-arcade-memory-private-20261116/`.
Build/identity receipt: `/private/tmp/agent-arcade-memory-20261116/`.
Synthetic renderer receipts and suite logs: `outputs/real-memory-20261116/`.
They are not public links or committed private evidence.

```sh
node scripts/app-local-memory-ui-smoke.cjs outputs/real-memory-20261116/full-ui
node scripts/app-local-memory-ui-smoke.cjs outputs/real-memory-20261116/stream-ui --stream-only
npm test
npm run check
npm run check:first-run
npm run check:release
npm run dist:mac -- --require-stable-signing --mac dmg:arm64 zip:arm64 \
  -c.electronDownload.cache=/private/tmp/agent-arcade-integration-build-20261115/electron-cache \
  -c.directories.output=/private/tmp/agent-arcade-memory-20261116/artifacts \
  -c.extraMetadata.buildSourceCommit=8dd258c401554b51d89a8e6923586e8095783515
```

The recorded build uses existing local caches and mandatory no-publication
settings. Native CUA supplies the actual UI actions; `checkpoint-minimal.py`
and `verify-retention-minimal.py` provide the read-only data comparisons. The
renderer smoke used the existing permitted local headless browser override.

## Precise acceptance boundary

This accepts manual App-memory writing, facts-only recall after App restart,
two personas sharing the same DeepSeek backend, explicit forgetting in the same
process and after restart, retained independent memory, and repaired stale AX
announcement behavior on this Mac/arm64. It does not prove automatic extraction
from arbitrary prose, all providers/accounts, cross-month behavior, large memory
sets, OS reboots, or human/external-adoption acceptance.

The current builtin path stores up to 100 facts but supplies only its bounded
recent-fact/context budget per turn; this small controlled case is not a memory
retrieval benchmark. App forgetting removes active local scoped facts and
related records, not private backups, copies deliberately stored in other
scopes/Wiki, or data already sent to the provider. No forensic wipe or provider
retention claim is made. No new retrieval system or management UI was added.
