# WeChat voice, references and restart records

Implemented in source on 2026-11-04. These additions use the existing API and local Claude Code routes; they do not add a new messaging provider or speech-recognition service.

## Voice and quoted context

Tencent's pinned [inbound implementation](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/inbound.ts) and [protocol types](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/types.ts) were checked on 2026-11-04. A voice item is type `3`; supplied `voice_item.text` can be used directly. The app labels this text as a transcription that may contain recognition errors. If transcription is absent, it asks for text and dispatches no task. It never downloads audio or sends audio to another service.

Inline `ref_msg` is handled separately from the current request. The reference identifier is preserved without rounding numeric uint64 values. The optional title, text and selected-span markers are bounded; nested references and media are not fetched. Quote text is limited to 1,800 characters, title to 400, and selection markers to 200 each. The combined model input remains limited to 6,000 characters. Truncated references are marked. ID-only references have no reconstructed body: no transcript cache is searched, and partial-span positions/digests are not treated as verified text.

Only a direct typed, unquoted body can become a control command. This includes `同意 CODE`, `拒绝 CODE`, `状态`, `停止`, `恢复会话` and their slash equivalents. A voice or quoted control command is rejected with an actionable explanation; it is not passed to a model as an authorization workaround. Quoted material is serialized as context data and explicitly marked unverified, not a fresh instruction or permission. Ordinary assent such as “好的” does not satisfy an operation permission. API questions may still accept ordinary text as an answer under the existing question-only rule.

Input rejections remain visible in the desktop conversation's alert until another valid message or reconnect. If the explanation cannot be sent back to WeChat, the local alert says so; empty polls do not erase this notice. The original message is not dispatched as a task or repeatedly retried.

The actual owner account's delivery of transcription/reference fields still requires phone verification. Protocol fixtures establish parsing and dispatch behavior, not account availability or recognition quality.

## Why SQLite is used

Previously, message identifiers and pending requests existed only in memory. Restarting removed the receipt trail, even though the app deliberately did not auto-replay old messages. The new journal commits a receipt before a message can reach either execution route. If the process stops between receipt and dispatch, that record becomes uncertain and cannot be silently retried. This is an at-most-once dispatch safeguard within the retained receipt window, not an exactly-once delivery promise.

The app uses built-in `node:sqlite`, with no extra native dependency. The current [Node 24 documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) labels this API **release candidate** (since 24.15.0), not fully stable. The required subset is `DatabaseSync`, prepared statements and short transactions. System Node 24.18.0 and Electron 45.2.1's Node 24.22.1 both passed the actual temporary-database restart probe. No resource or latency improvement against JSON has been measured.

`bot-recovery.sqlite` stores hashes of `(owner ID, provider message ID)`, execution mode, local task identifier, enumerated state and timestamps, plus a count of pending requests. It does **not** store message bodies, quotes, audio, context tokens, poll cursors, API keys, tool arguments or approval codes. Hashes distinguish receipts; they are not encryption or an anonymity guarantee. The app's data directory keeps the operating system's usual user-access controls.

- A duplicate is suppressed across reconnect, app restart and API/native mode switches.
- Incomplete API work and native forwarding records become `interrupted_unknown` on restart. Native forwarding remains unverified because the channel has no trustworthy task-to-result completion mapping.
- Pending request counts are reported as expired. No approval code or decision is restored, and no task, message or answer is automatically replayed.
- `reply_ended` stays “reply ended”; it is never converted to task success. Result content is not persisted.
- There are at most 10,000 receipts. Records older than 30 days may be pruned when receiving a new message. At the limit, or when SQLite is unavailable/corrupt/unwritable, new dispatch fails closed with a visible storage error. The database is not silently deleted or replaced.
- Transactions close their database handles immediately, including on failure. Normal disconnect records final available states and clears pending counts. “Forget connection” removes stored receipt metadata when the journal is available; it cannot repair a corrupt/unavailable database.

Restored records are diagnostics, not executable work or a restored conversation. This does not guarantee recovery of an interrupted model process, remote reply delivery or owner acceptance.

## Local channel recovery and explicit session resume

The current source tolerates temporary failure of the local HTTP event poll for up to 30 seconds after the first failure. It keeps the initialized stdio MCP connection and the last committed cursor, with delays of 250 ms, 500 ms, 1 second and then at most 2 seconds. A recovering request also uses the remaining deadline. A successful valid poll resets this window; explicit close interrupts waiting. There is no automatic reattachment or outbound-message retry. Access denial, event gaps, malformed responses and uncertain MCP writes close the relay immediately. These bounds are not an end-to-end WeChat network guarantee.

`状态` resends a still-pending request with its existing code and five-minute expiry; it neither renews permission nor invents a new request. Six-character aliases are owner/connection scoped and single use, with a full random nonce retained for compatibility and short-code lockout recovery. A bare current code while a request is pending produces a format reminder and resends the request; an explicit `同意`/`拒绝` action is still required. The SQLite ledger never stores or restores either code. A local-first CLI permission decision can still win the race with a later WeChat response.

On Windows, **Open Claude** starts an original interactive CLI owned by this app instance. The separate `native-process/<workspace hash>.json` record stores the project/session UUID and captured PID, UTC start time and executable path. Stop verifies that identity before force-terminating the exact process tree and reading back main-process exit. This is not graceful cancellation, rollback or confirmation that independent jobs stopped. Manually launched or previous-app-instance processes are not adopted for stopping.

While connected, the app checks its owned process about every five seconds. A confirmed early exit pauses the channel and exposes recovery instead of continuing to show it as running. Process checks and launch/stop operations are serialized; a rejected resume must preserve a CLI that is still waiting for its startup confirmation. **Open new session** is an explicit alternative when the retained transcript is unavailable; it never silently substitutes a new UUID for a requested resume.

After the previous main process is confirmed gone, the owner can send `恢复会话`/`/resume` or select **Resume last session**. The launch uses the recorded exact `--resume <UUID>`, a new private MCP configuration and a fresh channel attachment. It does not use `--continue`, replay offline messages, repeat pending operations or restore approvals. Claude's retained transcript must still exist and any original-CLI confirmation must be completed. An empty or unavailable transcript can prevent resume; an app process record is not a conversation backup. If the user independently backgrounds the session, an attach client's exit does not prove the background agent stopped.

An app restart retains the UUID for explicit recovery but does not recover live-process ownership or automatically reconnect. A missing/corrupt identity or unresolved launch blocks managed duplicate startup. Check the original terminal and actual files before retrying uncertain work. [Setup and stopping boundaries](WECHAT.md), [official CLI session flags](https://code.claude.com/docs/en/cli-reference).

**Controlled live check, 2026-11-04:** after the observed Claude/foreground Node process tree was stopped, the app was disconnected/recreated/restarted with its saved pairing. A WeChat `恢复会话` request opened the same UUID under a new PID. After the user completed confirmation in the original CLI, the channel attached and a fresh message received `重连后可以继续聊天`. The prior artifact's modification time/hash and the stop-task start record were unchanged. This is evidence of one successful same-session recovery without observed old-work replay. It does not establish unattended recovery, the cause of the CLI confirmation, network-loss/sleep recovery or behavior for independent background jobs. [Bounded live evidence](VALIDATION.md#wechat-control-and-recovery--localsource-2026-11-04).

## Reproduction

Run `node --test test/weixin.test.cjs test/journal.test.cjs test/bot-service.test.cjs` and `node scripts/sqlite-probe.cjs` in the normal Windows environment. These use temporary directories, synthetic message transports and injected executors. They cover missing transcription, bounded/ID-only references, uint64 identity, both execution routes, permission non-escalation, durable duplicate suppression, the commit-to-dispatch crash gap, incomplete-state recovery, corrupt storage and missing built-in support. No real WeChat send, Claude call or account configuration is performed.

For the current process/transport additions, run `node --test test/native-process.test.cjs test/native-launch.test.cjs test/native-channel.test.cjs`. The real Windows process-tree check is opt-in: set `ARCADE_NATIVE_PROCESS_LIVE=1` for this test command. It opens and stops only its own harmless Node parent/child fixture, verifies real stdin/stdout terminal handles and checks literal argument preservation; it never launches Claude. That fixture and the separately observed live flow above establish different evidence. Current aggregate results and remaining checks are in [VALIDATION.md](VALIDATION.md).
