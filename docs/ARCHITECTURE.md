# Architecture and accuracy

Claude Code command hook → allowlisted metadata → atomic local inbox file → Electron main-process reducer → isolated renderer.

The short-lived Node observer reads stdin, caps input at 2 MiB, writes one uniquely named JSON file, produces no output, and exits 0 even if observation fails. It times out after 1.5 seconds. It does not parse transcripts, approve commands, call a server, or keep a process alive. Claude's configured hook timeout is 2 seconds.

The main process polls once per second, sorts received events by observation time, rejects invalid payloads and duplicate IDs, and ignores events older than a station's latest timestamp. It persists state atomically before deleting consumed inbox files, so a crash replay is idempotent. A single-instance lock prevents competing consumers. Processing is bounded at 500 files per tick and 200 stations. Event history is capped at 30 entries per station.

Station keys are tuples of session ID and agent ID, not project folder names. Pending tool permissions are tracked by tool-use ID; a parallel unrelated completion does not dismiss a permission request. Tool failures are recoverable, API failures are separate, and closed parent sessions do not imply child success. The UI marks active observations older than five minutes as uncertain without changing the stored observation.

## Limits of observation

- Hook events are observations, not a comprehensive process supervisor. A crash, interrupted CLI, lost event, or very long tool may produce an uncertain station.
- Ordering uses local hook-receipt timestamps. Parallel processes and OS scheduling can reorder observations. Completed tool IDs suppress late permission/pre-tool events within a turn; arbitrary distributed-clock reconciliation is not provided.
- `Stop` is emitted during hook processing; another Stop hook may continue the turn. Ready means a response boundary was observed. Subsequent activity returns the character to work.
- `background_tasks` prevents showing done while known background work remains. `session_crons` displays idle for scheduled wakeups. Older versions may omit those fields.
- `SubagentStop` has the parent's background registry, so those arrays are intentionally ignored for child completion. Internal Claude agents can also produce subagent events.
- AskUserQuestion is identified from `PreToolUse`; approval and relevant notifications identify other waiting states. This app cannot guarantee detection of every UI prompt in every Claude version.
- Quiet notifications use a 15-second per-station cooldown, suppress focus and old backlog, and never contain reply text. A rapid second transition can intentionally be suppressed; the current scene remains authoritative.
- Demo state is separate from real state and never generates desktop notifications.

## Storage

Default directory: `~/.agent-arcade/`. `config.json` holds preferences; `state.json` holds stations/history; `inbox/` holds queued metadata; `bin/` holds installed observer copies; `theme.json` holds one custom theme. App UI data is not hosted. `AGENT_ARCADE_HOME` and `AGENT_ARCADE_CLAUDE_SETTINGS` isolate integration tests; set the home variable in both app and hook environments when overriding it.

## Upstream references

- [Claude Code hook reference](https://code.claude.com/docs/en/hooks), consulted 2026-11-03.
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), consulted 2026-11-03.

Supported hook registrations: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification, SubagentStart, SubagentStop, Stop, StopFailure, SessionEnd. If an older Claude version rejects a hook, upgrade before installing; the app does not modify hook settings silently to hide unsupported features.
