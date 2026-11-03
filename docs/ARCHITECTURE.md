# Architecture and accuracy

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
