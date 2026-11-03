# Architecture and accuracy

## Optional WeChat execution: API and local CLI (0.3 experimental preview)

Both modes use the same paired-owner WeChat text client, project selection, encrypted WeChat credential and isolated renderer. `bot-config.json` selects `api` (default) or `native`; switching requires disconnection and retains the saved API key. Only the selected mode consumes this app's connection. Neither mode is an OS sandbox.

**Local mode:** WeChat long poll → owner-filtered text → Electron's authenticated loopback broker → Node stdio MCP Channel → the user's original interactive Claude Code CLI. Replies return through a bound `reply(id, text)` tool; native permission prompts use the official channel relay. Claude owns its login, configuration and execution. Agent Arcade neither reads/copies Claude credentials nor sets an API key for the native session.

The broker binds only `127.0.0.1` on a random port. A per-connection 256-bit capability is written to a private MCP launch file, not to the renderer or copied command. Attachment returns a separate client ID; later requests bind to it. One long poll, bounded event batches/history, explicit sequence-gap failure and close-time revocation prevent silent cross-connection reuse. A current message ID is required for replies. MCP write failures close the relay rather than automatically replaying possibly delivered input. Another process running as the same OS user is outside this boundary.

The generated command starts the installed Node.js 22.13+ channel through original Claude Code 2.1.317+ with manual permissions, a private strict MCP config and the custom development-channel flag. The user must personally confirm the research preview/project/MCP prompts and keep the CLI session open. Runtime files/dependencies are unpacked from ASAR for system Node. No user/project CLI settings are edited. The launch capability is revoked and its file is removed on disconnect where possible; a leftover file cannot authenticate to the closed broker.

Native input can be combined in one CLI turn; delivery into MCP, a reply-tool call and a response boundary are distinct. `attached` means MCP initialized, not that Claude registered or executed a message. Permission previews may already be normalized/redacted/omitted upstream; unsuitable previews are refused remotely. Codes bind one native request and expire after five minutes, but sending a verdict cannot prove the CLI adopted it before a local decision. Native mode follows existing CLI permission rules; it does not force every read or previously allowed action to prompt.

Native `/cancel` pauses new forwarding, removes unforwarded messages and sends denials for pending remote requests. It cannot withdraw input already in Claude or stop an active tool. App disconnect/quit closes this relay, not necessarily the independent CLI. Actual interruption is **Ctrl+C in the original terminal**. New sessions are handled there too; the API queue/turn/time/cost limits below do not apply to native execution.

## API agent

WeChat iLink HTTPS long poll → owner-only timestamped text → bounded serial Dispatcher → official Claude Agent SDK/native subprocess → correlated one-time permission/question → same owner's reply. Electron main orchestrates `src/bot` asynchronously; the SDK executes in a separate native process. This is independent of the observer below and does not install user hooks.

Connections never start automatically. One owner/project/connection has one explicit SDK session ID; subsequent prompts use `resume`, never global `continue`. One active task plus three queued tasks, 24 turns, ten minutes, bounded history and an SDK cost threshold limit work. Task state and send failure are separate. Disconnect and quit abort execution, invalidate permissions and wait for the old runner to settle before a new connection. No durable replay is attempted.

Every known tool is forced through a fail-closed `PreToolUse` ask rule, then a callback bound to a 128-bit, five-minute, single-use request. Unknown tools are denied. Tool/task cancellation, expiry and disconnect invalidate permissions. Oversized or secret-filtered parameters cannot be authorized from an altered display. This is authorization, not OS containment: approved Windows commands can affect the whole local account.

OS-encrypted API/WeChat credentials never enter renderer snapshots. In API mode, ambient user/project settings, OAuth, hooks, plugins and MCP are excluded. SDK sessions persist locally; the bounded bot UI transcript is memory-only. Tencent and Anthropic receive data needed for the flow. See [WeChat setup/limits](WECHAT.md), [source review](BOT_TECH_NOTES.md), and [third-party terms](../THIRD_PARTY_NOTICES.md). Real WeChat + actual agent acceptance is pending for both modes.

## Existing local observer

Claude Code command hook → allowlisted metadata → atomic local inbox file → Electron main-process reducer → isolated renderer.

The short-lived Node observer reads stdin, caps input at 2 MiB, writes one uniquely named JSON file, produces no output, and exits 0 even if observation fails. It times out after 1.5 seconds. It does not parse transcripts, approve commands, call a server, or keep a process alive. Claude's configured hook timeout is 2 seconds.

The main process polls once per second, sorts received events by observation time, rejects invalid payloads and duplicate IDs, and ignores events older than a station's latest timestamp. It persists state atomically before deleting consumed inbox files, so a crash replay is idempotent. A single-instance lock prevents competing consumers. Processing is bounded at 500 files per tick and 200 stations. Event history is capped at 30 entries per station. Full renderer snapshots are sent only when their contents change; relative ages update locally, while the poll still checks the five-minute uncertainty boundary.

Station keys are tuples of session ID and agent ID, not project folder names. Existing stations keep their positions as events arrive; new stations appear first. Tool failures are recoverable, API failures are separate, and closed parent sessions do not imply child success. The UI marks active observations older than five minutes as uncertain without changing the stored observation.

`PermissionRequest` does not include `tool_use_id`. The observer computes an HMAC of canonical tool input, session, agent and tool using a random local 32-byte `observer-key`. Only the opaque digest is stored, never the input. The reducer matches a permission to a unique pending `PreToolUse` digest and its tool ID. A completion for a different tool cannot clear that permission. Missing input or identical concurrent inputs cannot be resolved reliably: after activity the station becomes uncertain instead of guessing. This also applies to old inbox events without correlation metadata.

Pending approvals and questions are bounded to 100 entries. Overflow retains an unresolved marker across restarts; completing the retained entries cannot make discarded approvals look resolved. AskUserQuestion and ExitPlanMode keep their input-request meaning through generic permission notifications. Older parent-close events cannot rewind newer child observations; a newly uncertain child becomes visible for attention again.

## Limits of observation

- Hook events are observations, not a comprehensive process supervisor. A crash, interrupted CLI, lost event, or very long tool may produce an uncertain station.
- Ordering uses local hook-receipt timestamps. Parallel processes and OS scheduling can reorder observations. Completed tool IDs suppress late permission/pre-tool events within a turn; arbitrary distributed-clock reconciliation is not provided.
- `Stop` is emitted during hook processing; another Stop hook may continue the turn. “Response ended” means a response boundary was observed. Subsequent activity returns the character to work. No success status exists.
- `background_tasks` prevents showing done while known background work remains. `session_crons` displays idle for scheduled wakeups. Older versions may omit those fields.
- `SubagentStop` has the parent's background registry, so those arrays are intentionally ignored for child completion. Internal Claude agents can also produce subagent events.
- AskUserQuestion is identified from `PreToolUse`; approval and relevant notifications identify other waiting states. This app cannot guarantee detection of every UI prompt in every Claude version.
- Hooks do not expose the instant a person approves a tool. The last observed permission request remains visible until the next tool/result event, potentially for the duration of a long-running approved tool. The scene is an observation record, not a continuous execution monitor.
- `idle_prompt` is a reminder after a response, not evidence of a pending approval, and is ignored. Events within one poll are coalesced per station before notification; a wait that already recovered does not trigger an obsolete attention alert.
- Quiet notifications use a 15-second per-station cooldown, suppress focus and old backlog, and never contain reply text. A rapid second transition can intentionally be suppressed; the current scene remains authoritative.
- Demo state is separate from real state and never generates desktop notifications.

## Storage

Default directory: `~/.agent-arcade/`. `config.json` holds preferences; `state.json` holds stations/history; `inbox/` holds queued metadata; `bin/` holds installed observer copies; `theme.json` holds one custom theme; `observer-key` salts private tool correlation. Do not publish this key with support reports. App UI data is not hosted. `AGENT_ARCADE_HOME` and `AGENT_ARCADE_CLAUDE_SETTINGS` isolate integration tests; set the home variable in both app and hook environments when overriding it.

## Upstream references

- [Claude Code hook reference](https://code.claude.com/docs/en/hooks), consulted 2026-11-03.
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), consulted 2026-11-03.

Supported hook registrations: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, SubagentStart, SubagentStop, Stop, StopFailure, SessionEnd. If an older Claude version rejects a hook, upgrade before installing; the app does not modify hook settings silently to hide unsupported features.
