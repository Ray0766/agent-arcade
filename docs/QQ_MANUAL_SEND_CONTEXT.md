# Manual QQ sends in companion conversation

The implementation gives the selected companion limited context
about text, pictures and voice clips explicitly sent through Agent Arcade.
The currently operated package and real acceptance are recorded in
[the active scope](ACTIVE_GOAL.md). A real image send → owner QQ display →
quoted follow-up → DeepSeek reply confirms recognition of the exact quoted send
without claiming to see its contents in the operated chat-refinement package.
The prior reply failed that recognition despite a matching stored ID and remains
recorded. The latest reply still repeats lengthy technical explanations, so
natural conversational wording remains unfinished. Source route checks establish
that the match flag can reach the model boundary; they do not capture the older
live request or establish general model compliance.

Use the existing **Share image**, **Share voice**, or **QQ message history**
manual-text controls. There is no extra switch or model tool. When you later
ask about a send, the companion can receive its media type, time and bounded
submission result. A matching quote prioritizes the receipt from the same
account, owner and character. It does not fetch the quoted message or its media.

The intended benefit is a more coherent reply after an app-operated send. The
model should distinguish “the app submitted a picture” from “I saw the picture.”
Natural wording and broader reliability still require further acceptance.

## What is retained

- At most 40 records per account/owner/character scope, for seven days. Expired
  records are removed when that scope is accessed; no cleanup runs with the app
  closed. These records do not consume the proactive-contact allowance.
- Stored metadata includes a local submission identifier, media type, time,
  result and an accepted bridge message ID. It does not copy the manual text,
  image, audio, TTS input or local file path into companion memory.
- The model receives at most six projected records, within an 800-character
  serialized budget. Account identifiers and bridge message IDs are excluded.
  Quoted IDs are local lookup hints only.
- Forgetting the scoped conversation removes this context from subsequent
  model prompts. Minimal action receipts remain for duplicate/uncertain-send
  bookkeeping; forgetting is not a request to resend or retract a QQ message.

## What a result means

**Accepted** means the bridge accepted the submission. It does not establish
recipient viewing, reading or hearing. **Unknown** stays unknown and is not
automatically replayed. **Not submitted** means the app did not call the send
operation for that attempt. No result grants the model additional permissions.

Missing records do not prove a send never happened: sends outside the app,
expired or forgotten records, failed local persistence and a crash between
submission and recording can leave no context. A recording failure preserves
the actual send result and does not trigger a retry. Replies must not invent
media content from this metadata.

## Verification boundary

Source tests cover bounded retention, scope/quote projection, forgetting,
late receipts, idempotency, persistence failures and manual-text/media
integration. The post-integration targeted run passed 493 checks after two
test-fixture corrections; the earlier failures remain recorded. Temporary
SQLite and loopback client evidence is separate from real QQ delivery and
model conversation. Existing image/voice delivery evidence does not accept
the new follow-up behavior.
