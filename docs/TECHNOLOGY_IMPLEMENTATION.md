# Technology implementation — local/source revision

Reviewed and implemented **2026-11-04**. This source revision follows the published `0.3.0-preview.2` binary; a new public installer has not been published. It preserves Electron, the two existing Claude execution modes and the light chat interface. No runtime dependency was added.

| Capability | What this build does | Boundary |
| --- | --- | --- |
| Official Claude session JSON | **Work & results → Choose project → Refresh sessions**, with optional 15-second non-overlapping checks. Correlates exact session IDs with hooks and displays disagreement, missing or stale evidence. | Does not overwrite hook events or infer task success. A session never observed in the chosen project is outside this check's scope. |
| WeChat voice text and quotes | Both execution modes accept upstream `voice_item.text` and bounded quoted context. Missing transcription gets an actionable response. uint64 message/reference IDs are preserved. | No ASR/audio download. Quoted and transcribed slash commands do not grant permission. Phone delivery of the fields remains unverified. |
| Claude background lifecycle | Explicit experimental entry to create, stop and restart app-owned native sessions. Launch identity is recorded before dispatch and reconciled with official JSON. | Separate from WeChat Channels. Uses CLI login/quota and original permissions; trust is never bypassed. Closing Agent Arcade leaves these independent sessions running. |
| Node built-in SQLite | Receipt is committed before dispatch. Hashed message IDs and bounded state records survive restarts; old permissions expire and interrupted work becomes unknown. | No automatic replay, model resume or approval recovery. No message body, context token or key in this ledger. Unavailable storage stops new dispatch explicitly. |
| MCP Apps | A bundled sandboxed result viewer displays actual selected UTF-8 text, bytes, lines, SHA-256 and a JSON-format toggle, through `ui/initialize` and tool-result messages. | Restricted built-in App host, not arbitrary third-party HTML hosting or WeChat-native buttons. File content is rendered as text. |
| MCP Tasks | Real SDK protocol supports create/get/list/result/cancel for bounded artifact inspections, also available through a stdio server. Cancellation interrupts the actual chunked inspection. | Experimental protocol. These tasks do not manage Claude processes. Results expire after 60 seconds; this in-memory protocol store is separate from the durable WeChat receipt ledger. |

## First successful flow without an account

Run `npm start`, open **Work & results**, then **Try local sample** or **Choose text file**. A task reads the supplied UTF-8 data and produces an interactive result. For a selected file the decoder rejects invalid UTF-8 and preserves the BOM; the SHA-256 matches the bytes read from the file. This is a concrete artifact check, not proof that an AI fulfilled its task.

Text input is bounded at **256 KiB / 65,536 characters**; preview text is bounded at 32,768 characters. The file is read only after an explicit native file-picker selection. The fixed viewer cannot open links, send chat messages, call other tools or access its parent's DOM. An unavailable model does not affect this local flow.

For the optional protocol example, run `npm run mcp:artifacts` from an MCP host using Node 22.13+; this is a stdio server, not an interactive terminal program. See [MCP implementation](MCP_EXTENSIONS.md).

## Decisions relative to the baseline

- **Hooks remain primary event evidence.** Official JSON adds a second, scoped observation source without terminal scraping, transcript parsing or model calls. The UI exposes disagreement instead of guessing. A 15-second interval is a conservative initial setting, not a measured performance improvement.
- **Use supplied transcription.** Compared with adding an ASR service this needs no additional model/provider setup. Actual transcription accuracy, availability and latency depend on Tencent and have not been measured here.
- **Use SQLite for a demonstrated restart gap.** The old in-memory duplicate set and permission/task bookkeeping were lost on restart. A transaction before dispatch closes the duplicate-dispatch gap at the cost of deliberately requiring manual review if the app crashes after receipt but before dispatch. Exactly-once external execution is not claimed.
- **Keep background control separate until proven with Channels.** Official CLI lifecycle avoids inventing a terminal supervisor. The added prototype owns only its exact recorded sessions. Original CLI 2.1.317 did not preserve the requested UUID during `--bg`; the implementation now binds a random launch tag, returned short ID and observed actual UUID. This was discovered by the real lifecycle probe.
- **Use the already pinned MCP SDK.** Apps/Tasks provide a concrete portable protocol example rather than a second UI stack. A simple text viewer remains the baseline; cross-host portability and comparative usability have not yet been demonstrated.

No claim of lower latency, lower memory use, fewer interruptions or competitive superiority is made. The demonstrable highlight is **independent evidence**: a CLI status remains an observation, while a chosen artifact can be checked against its actual bytes. Its practical usability benefit is still a hypothesis pending real-task comparison.

## Evidence and sources

- [Session/background implementation and official sources](CLAUDE_SESSIONS.md)
- [WeChat parsing/recovery and pinned Tencent source](WECHAT_RECOVERY.md)
- [MCP specification, implementation and host limits](MCP_EXTENSIONS.md)
- [Validation record](VALIDATION.md)

Node's v24 documentation labels the built-in SQLite binding **release candidate**, not fully stable: [official SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html). The existing runtime pins are Electron **45.2.1**, Agent SDK **0.3.317**, and MCP SDK **1.32.2**. SQLite was exercised in Electron's embedded Node **24.22.1** and system Node **24.18.0**; unsupported runtimes report storage unavailable rather than silently dropping durability.
