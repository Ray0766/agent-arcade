# Real DeepSeek memory / isolation / forgetting — 2026-11-16

Execution in progress on `codex/real-memory-flow-20261116`, based on
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
and history deletion succeeded. The source fix and regression check are being
prepared before packaging and final live forgetting/restart verification.

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
