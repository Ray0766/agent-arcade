# Technology radar

## 2026-11-05 — companion project references

The owner broadened the reference set beyond Bothouse. This is source/document research for the existing QQ companion, not a framework migration, installation or live social-account test. Selection is based on implemented mechanisms that address a current gap, bounded adoption cost and inspectable sources; popularity and companion-marketing claims are not acceptance evidence. The [Bothouse review](DECISIONS.md#2026-11-05--bothouse-reuse-review-for-sustained-companionship) remains applicable.

### Reviewed revisions and practical reuse

| Reference and inspected revision | Verified implementation | Agent Arcade adaptation and cost |
| --- | --- | --- |
| **MaiBot**, `c6429547af711555e3d4d1b8d04b413572cb616c` | [Input batching](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/src/chat/debounce/controller.py) and its [explicit timing rules](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/src/chat/debounce/README.md) separately configure private/group streams, bound a batch to eight seconds and exclude control messages. This cap covers batching, not model response time. | **First: wait briefly for consecutive owner messages, then answer the whole thought.** Our current controller starts one reply per queued message and has no input batching. Implement a small deterministic controller with a maximum wait; stop/pause bypass it. No extra model service; actual model-call reduction and acceptable delay need measurement. Do not copy group-chat participation probabilities into private chat. |
| **Koishi**, `97d5c395750cec37b772e0b94dc63c427e3bb868` | [sendQueued/cancelQueued](https://github.com/koishijs/koishi/blob/97d5c395750cec37b772e0b94dc63c427e3bb868/packages/core/src/session.ts#L206-L231) implements sequential outgoing messages with length-based spacing and queued-send cancellation. | **First: bounded short replies that can be interrupted.** Keep a receipt for each chunk, settle cancelled callers explicitly, stop unsent chunks on a newer owner message and never replay the whole reply after partial delivery. No added model request; artificial spacing adds latency and needs a user-visible benefit. This queue is not proof that an already in-flight send was revoked. |
| **SillyTavern**, release revision `06bde939fb1e9c4c8d8641d810f0a916b5bce127` | [Character fields](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/characters.js#L513), [V2/V3 PNG parsing](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/character-card-parser.js), and [World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) provide personality, scenario, greeting, sample dialogue and keyword-activated context under a budget. | **Next: expressive, portable characters.** Add a few speaking examples and separate public background from private relationship facts; preview bounded declarative imports. No model is needed to parse cards/select keyword entries, but inserted text consumes context. From 2026-11-13 the project is AGPL-3.0 and adapts SillyTavern code with recorded provenance (`src/vendor/sillytavern/README.md`). Do not execute card scripts/extensions or treat a card's system-prompt field as account/tool authority. Third-party card/artwork licensing remains separate. |
| **Mem0**, `ed1f10fc87080f0b67f99be370817504888462ab` | [Scoped add/search](https://github.com/mem0ai/mem0/blob/ed1f10fc87080f0b67f99be370817504888462ab/mem0/memory/main.py#L760) and [update/delete/history](https://github.com/mem0ai/mem0/blob/ed1f10fc87080f0b67f99be370817504888462ab/mem0/memory/main.py#L1829) expose scope keys, updates, expiration and change history. Current add is additive extraction, not evidence of automatic general contradiction correction. | **First with Bothouse follow-ups: a correctable memory notebook.** Use current SQLite for bounded facts/commitments, source message, timestamps, replacement history and forgetting. Scope keys come from verified account/owner/character, never the model. Extraction adds model calls. Full Mem0 introduces embedding/vector-store configuration; its [OSS defaults](https://docs.mem0.ai/open-source/overview) must not silently require local-Claude users to add an OpenAI key. Test removal from history/summaries/retrieval as well as current facts. |
| **AstrBot**, `10364e85a35d2f76bfcd706e1505652817565065` | [MessageSession](https://github.com/AstrBotDevs/AstrBot/blob/10364e85a35d2f76bfcd706e1505652817565065/astrbot/core/platform/message_session.py) identifies platform instance, message type and session; [platform manager](https://github.com/AstrBotDevs/AstrBot/blob/10364e85a35d2f76bfcd706e1505652817565065/astrbot/core/platform/manager.py) owns per-instance lifecycle; [session rules](https://docs.astrbot.app/en/use/custom-rules.html) select model/persona behavior. | **After one companion is live-accepted: one window for three accounts.** Give each connection its own backend, role, owner, state, store scope and disposable listeners/timers. This is a moderate BotService/UI refactor, not a new Python service. Preserve our real QQ identity/status checks: an adapter's RUNNING flag does not prove online identity or a completed message round trip. |
| **Project AIRI**, `b6c53cd6af3e7132eacdd0a9cd16f7ea22120908` | [Voice controller](https://github.com/moeru-ai/airi/blob/b6c53cd6af3e7132eacdd0a9cd16f7ea22120908/packages/core-agent/src/voice/controller.ts) and [interruption state](https://github.com/moeru-ai/airi/blob/b6c53cd6af3e7132eacdd0a9cd16f7ea22120908/packages/core-agent/src/voice/interruption.ts) cancel generation/playback by turn; [persona memory store](https://github.com/moeru-ai/airi/blob/b6c53cd6af3e7132eacdd0a9cd16f7ea22120908/packages/stage-ui/src/stores/memory.ts) persists editable facts per persona. | **Later: voice that yields when the user speaks.** Cancel stale synthesis/playback, not just the visible audio widget. Requires ASR/TTS, with separate cloud charges or local model/download/compute costs; no measured Windows latency yet. Borrow per-character memory editing while retaining our stronger account/contact scope. Live2D/VRM is optional and does not solve text companionship. |

### What the references do not establish

- None was run against the owner's real accounts in this review. Their tests and source are upstream evidence, not our end-to-end acceptance or comparative naturalness results.
- MaiBot's full A_Memorix stack combines metadata, vectors, graph/BM25 and model-driven processing. Its [kernel](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/src/A_memorix/core/runtime/sdk_memory_kernel.py) is concrete code, but bringing in Python/FAISS/embedding for our initial bounded facts would increase dependencies without a demonstrated retrieval benefit. Begin with SQLite and lexical retrieval.
- AIRI's [Satori loop](https://github.com/moeru-ai/airi/blob/b6c53cd6af3e7132eacdd0a9cd16f7ea22120908/integrations/satori-bot/src/core/loop/scheduler.ts) skips channels with no unread events; that is not evidence of an unsolicited inactive-owner greeting. Its persona fact store is implemented, while broader Alaya work remains separately described as in progress.
- Neither character cards, generic plugins nor lifecycle cleanup supplies an operating-system sandbox, ordinary personal-WeChat/Moments access, or tested QQ Space publishing. The existing one-owner boundary is unchanged.

### Code and asset reuse boundaries

The inspected [Koishi](https://github.com/koishijs/koishi/blob/97d5c395750cec37b772e0b94dc63c427e3bb868/LICENSE) and [AIRI](https://github.com/moeru-ai/airi/blob/b6c53cd6af3e7132eacdd0a9cd16f7ea22120908/LICENSE) root licenses are MIT; [Mem0](https://github.com/mem0ai/mem0/blob/ed1f10fc87080f0b67f99be370817504888462ab/LICENSE) is Apache-2.0. Selected code reuse must retain its notices and provenance. [SillyTavern](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/LICENSE) and [AstrBot](https://github.com/AstrBotDevs/AstrBot/blob/10364e85a35d2f76bfcd706e1505652817565065/LICENSE) are AGPL-3.0. [MaiBot](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/LICENSE) is GPL-3.0 at the root, with a separate [AGPL-3.0 A_Memorix license](https://github.com/Mai-with-u/MaiBot/blob/c6429547af711555e3d4d1b8d04b413572cb616c/src/A_memorix/LICENSE). Until 2026-11-13 the project was MIT and only implemented compatible behavior independently. It is now AGPL-3.0, so AGPL-3.0 code such as SillyTavern may be adapted with notices, provenance and a record of changes; restricted-license code (NapCat) still may not be copied, and GPL-3.0 code needs its own compatibility check first. Code licenses do not automatically cover downloaded character art, voice models or model service access. No reference code or assets were copied in this research.

### Next acceptance and comparison

Keep the Bothouse-derived commitment follow-up and public character journal priorities. Add input batching, a cancellable outgoing queue and a visible correctable memory list before voice or broad platform expansion. Validate the existing real QQ reply/post path alongside this work, rather than treating more features as a substitute for it.

Compare the current build and proposed flow on the same scripted conversations, recording actual results: (1) three consecutive owner messages produce a coherent response that incorporates the final correction; (2) a new message stops all not-yet-sent obsolete chunks; (3) an old preference is corrected, survives restart correctly and can be forgotten; (4) the agreed follow-up is sent once in its window and is suppressed after cancellation; (5) multiple account/role scopes never share private memory. Record reply count, model calls, batching delay, actual delivery receipts and owner feedback on naturalness. Targets are behavioral, not invented improvement percentages. Timing can be tested with a controlled clock locally, but a real delayed QQ follow-up still needs live evidence.

A recent [MemoProAgent preprint](https://arxiv.org/abs/2610.22671v2) (October 21 revision) evaluates relevant memory and intervention timing jointly. Its egocentric-video benchmark is not a QQ-companion study; use it only as a reason to measure both relevance and timing, not as proof of emotional value or a need to add its graph/RL stack.

## Historical task-delegation radar

**Historical research baseline:** on 2026-11-04 the owner subsequently requested all six candidates. See the [current source implementation and evidence](TECHNOLOGY_IMPLEMENTATION.md); the adoption decisions below predate that implementation.

Reviewed **2026-11-04**. Research only: this document adds no dependency, execution mode, account integration, or permission grant. It preserves Electron, the original Sprout Bot, and the two Claude entry points described in [WECHAT.md](WECHAT.md).

The question is practical: which current capabilities could make WeChat delegation easier while keeping state truthful, interruptions rare, and execution authority explicit? An available protocol feature is not evidence that this application's integration works.

## Evidence and baseline

- **Upstream fact:** verified against the linked official documentation, specification, or publisher's source. Research previews and experimental APIs are identified below.
- **Local probe:** a narrow command/runtime check on the Windows development machine. It does not establish a full user flow, durability, performance, or a general compatibility guarantee.
- **Hypothesis:** an expected benefit that still needs a comparison or live acceptance test.

The baseline is the existing hook observer, bounded text bridge, quiet native receipt handling, and API SDK runner. API mode manages its own runs and cancellation using an API key; native mode forwards into the owner's original interactive Claude Code through Channels, retaining its login and permissions. Native `/cancel` currently pauses forwarding; it does not stop Claude. The basic native round trip and independently inspected artifact passed with preview.1; the later ordinary-reply permission change has a real-CLI/fixture-transport check, with phone-side acceptance and recovery/cancellation still separate. See [VALIDATION.md](VALIDATION.md).

The manifest currently pins Electron **45.2.1**, Claude Agent SDK **0.3.317**, and MCP TypeScript SDK **1.32.2**. Original CLI **2.1.317**, released 2026-11-03, is the current research target [C1]. Channels is already part of the baseline, not a new feature proposed by this radar.

## Adoption order

| Candidate | Mature baseline | Expected benefit | Decision |
| --- | --- | --- | --- |
| Official local session JSON | Hooks and conservative stale-state handling | Reconcile live process/wait state without parsing terminal text | First: a bounded, opt-in read-only experiment |
| WeChat voice text and message references | Typed messages and explicit one-time approval codes | Easier mobile input; less ambiguous follow-up context | Second: small parser/interaction experiments |
| Original CLI background lifecycle | Interactive Channels; app-managed API SDK runs | Close the terminal; address a specific native session for stop/resume | Third: highest workflow potential, but a compatibility spike before any default change |
| SQLite recovery ledger | Existing bounded local files and replay handling | Atomic cursor/message/reply bookkeeping if restart gaps justify it | Conditional; do not migrate storage just because the binding is newer |
| MCP Apps / MCP Tasks | Text/files and application-owned lifecycle | Rich artifact review / interoperable deferred results | Later; no immediate benefit to the current native WeChat text surface |
| Remote Control | WeChat Channels | Ready-made official mobile/web control | Alternative to compare, not a WeChat API to integrate |

No latency, memory, interruption, or accuracy improvement has been measured for these candidates. The resource/cost statements below describe mechanisms and risks, not benchmark results.

## 1. Official session JSON

**Upstream fact.** `claude agents --json` arrived in **2.1.145, 2026-05-19**; `waitingFor` was added in **2.1.162, 2026-06-03** [C2], [C3]. The current supported external interface is `claude agents --json --all`, optionally scoped with `--cwd`. Background rows can expose `id`, `state`, `sessionId`, `status`, and `waitingFor`; fields are conditional. The internal job files are not a stable integration interface [C4].

**Local probe.** A read-only invocation scoped to the disposable native acceptance workspace returned an array containing one interactive session. Its available fields were only `sessionId` and `status`, with `status: "idle"`. No identity, conversation content, or session UUID is published here; no model task was started. This does **not** demonstrate `waitingFor` on interactive sessions.

**Project judgment.** Use this as a second observation source beside hooks, with explicit freshness and disagreement handling. Missing fields mean unavailable evidence. `done` or `idle` must never become independently verified task success. Keep child-agent detail from hooks.

This needs no model key or extra model request for the query. Windows process startup and polling still cost resources; use one non-overlapping, bounded poll and measure it before choosing a frequency. Query only the selected workspace, discard names/content not required for state, and retain the existing unknown-state fallback when the command is absent, slow, or returns malformed output. This is lower risk than replacing the observer or scraping terminal rendering.

## 2. WeChat voice text, references, and quiet waiting

The reviewed Tencent source is commit **`874637a0dbc24050f72d1385add4fc6170a2d726` (2026-10-13)**, following plugin **2.4.10 (2026-10-10)** [W1], [W2]. Treat this as a versioned upstream implementation, not a promise that every WeChat account/client receives every field.

**Upstream facts.** Inbound voice handling uses `voice_item.text` when present, so a text-only voice route need not add a separate speech model. References use `ref_msg.svr_id`; partial quotes can use `partial_text`. Reference restoration was added in **2.4.9-beta.0, 2026-09-08** [W2], [W3]. Tencent also already exposes `getConfig`/`typing_ticket` and `sendTyping`; its message handler refreshes typing at a **5,000 ms interval** [W4], [W5]. That interval is not proof of a ticket TTL.

**Project judgment.** First consume bounded voice transcription when supplied; explain missing text instead of silently starting an audio download or ASR service. Transcription is still untrusted task input, never an approval. Windows needs no audio codec for this route. There is no additional ASR service in this proposal; Tencent availability, transcription accuracy, latency, and any service charges remain unverified.

Use a quoted message to identify a follow-up only when its exact ID belongs to the paired owner and current session. Keep IDs as strings without lossy numeric conversion. A future quoted approval prototype must also bind to one unexpired pending request and consume it once. A bare "yes", quoted display text, or a partial quote is insufficient authority.

Typing is an existing optional signal to compare against today's zero successful-forwarding ACKs, not an excuse to add more chat messages. It must stop on pause/error/cancel and fail without blocking work. We have not verified public native-WeChat buttons, cards, or callback actions; enterprise WeChat capabilities cannot be assumed here. Continue with ordinary text and, when implemented and verified, normal file delivery rather than inventing unsupported controls.

## 3. Original CLI background lifecycle

**Upstream facts.** Agent view began as a research preview in **2.1.139, 2026-05-11** [C5]. Current CLI commands include `--bg`, `attach`, `stop <id>`, and `respawn <id>` [C6]. **2.1.257, 2026-09-01** improved `--resume <UUID> --bg`: it can keep the original session ID, or explicitly report a copy [C7]. **2.1.281, 2026-09-23** enforced workspace trust before background launch; a non-interactive untrusted launch fails instead of bypassing the dialog [C8].

**Hypothesis.** Official background ownership could remove the terminal-lifetime burden and supply an actual native stop command. It is preferable to a custom PTY/stdin controller if Channels, permissions, and restart behavior survive intact. It does not make subscription credentials available to the API SDK, and must not involve reading or forwarding those credentials.

The current documentation supports Windows background operation. Sessions consume the normal account's usage; parallel sessions increase usage and local process/memory load. They can survive closing the terminal and sleep, but shutdown stops running work. Long-idle sessions may retire and restart. No latency or footprint comparison has been run [C4].

**Do not enable by default yet.** Test custom-channel confirmation, exact reply permission, MCP initialization versus actual channel registration, and reconnect after worker retirement. Existing one-client broker capabilities cannot simply be reused by an unexpected new process. Preserve local approval rules; prompt the owner where trust/consent is required.

Newly dispatched background code sessions may create a worktree and commit/push their branch; explicit git instructions take precedence [C4]. This differs materially from forwarding into an already-open project. Explain and constrain that behavior before offering it. A stop action must target only an ID bound to this app's current owner/session, verify the resulting state, and leave unrelated sessions alone. It cannot undo completed side effects or promise termination of every descendant/external job. The current native `/cancel` wording remains correct until this path is accepted.

## 4. Conditional SQLite recovery ledger

**Upstream fact.** SQLite is a mature embedded database. The newer part is Node's built-in `node:sqlite` binding: Node **24.15.0** moved it to **Stability 1.2, Release candidate**. Node 22.13 removed the experimental flag requirement, not experimental status. `DatabaseSync` operations are synchronous [S1]. Do not call the binding fully stable or describe SQLite as a new database.

**Local probes, in memory only:**

| Runtime | Reported SQLite | Result |
| --- | --- | --- |
| Host Node 24.18.0 | 3.53.1 | In-memory database probe passed |
| Electron 45.2.1 / embedded Node 24.22.1 | 3.53.4 | In-memory database probe passed |

These establish binding availability in those two runtimes, not on-disk crash recovery, packaged compatibility, throughput, or the project's minimum Node version.

**Project judgment.** Consider a small ledger for delivery cursors, deduplication, pending/replied records, and expiry only if restart tests expose a concrete gap. Compare it with the existing bounded-file approach. Transactions can make related local writes atomic; they cannot provide exactly-once execution across Tencent, Claude, and the filesystem. Keep secrets in the OS vault, bound retention, support deletion/migration, and avoid synchronous database work on the renderer or a busy main loop. No new database service or native addon is required by the built-in route, but binding maturity, worker cost, disk contention, and recovery still need testing.

## 5. Defer MCP Apps and Tasks

**MCP Apps.** The official extension launched **2026-01-26** [M1]. It lets compatible hosts render interactive resources and communicate with tools; web hosts generally use a sandboxed iframe and declared CSP [M2]. It could help review a generated artifact in a future desktop detail view. It does not supply native WeChat action buttons. Compared with text and ordinary file delivery, building a host adds lifecycle, iframe/CSP, permission, accessibility, and packaging work. Rendering need not invoke another model, but host resource use and tool/network costs remain. Defer until a real artifact-review task cannot be served well by the mature baseline.

**MCP Tasks.** Introduced with specification **2025-11-25**, this remains experimental. Both peers declare relevant task capabilities; deferred result retrieval and cancellation are protocol contracts, not automatic OS process control or independent outcome verification [M3]. Application-owned task IDs, bounded queues, and explicit cancellation remain the baseline. Adoption would require a demonstrated long-running MCP operation, host support, expiry/access control, and restart tests. No service fee is implied by the protocol; underlying execution still costs resources. Keep the pinned SDK and the currently tested **2025-11-25** handshake. Any protocol/SDK change needs a separate custom-Channel registration test before upgrading; a newer negotiated revision alone is not a benefit.

## 6. Remote Control as an alternative

**Upstream facts.** Remote Control connects the original local session to Claude's web/mobile clients; it is not an open WeChat bridge API. Current requirements include a Pro, Max, Ultra, Team, or Enterprise subscription; API keys are unsupported and organizations may require an Owner opt-in [R1]. Local execution stays on the computer, while the synchronized transcript is stored through Anthropic's service.

Server-session resume requires **2.1.200+**. **2.1.283, released 2026-09-25**, permits use with only `DISABLE_TELEMETRY`/`DO_NOT_TRACK` set, subject to Trusted Devices requirements; `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` still disables it [R1], [R2]. Do not silently change the app's privacy/environment choices to enable it.

**Project judgment.** It is a useful ready-made comparison when the real need is to continue local work from a phone. It avoids maintaining a custom chat protocol but requires the Claude client/account instead of WeChat. It does not remove the need for a live local process or permit calling undocumented endpoints. Windows integration and relevant permissions still need a target-machine test. Subscription usage, network delay, and transcript synchronization apply; no project-specific price or latency advantage is established. Offer documentation/comparison before building an integration.

## Three bounded experiments

These are proposed checks, not completed results. Use disposable projects and harmless artifacts; obtain the owner's normal live-task authorization before model or WeChat operations.

1. **Reconcile two sessions.** Compare hooks alone with hooks plus scoped session JSON through working, permission wait, recovery, response end, and process exit. Record field availability, disagreements, stale time, poll duration, CPU/memory, and notification count. Pass only if missing/contradictory data stays explicit and no idle/done row becomes a success claim. Retain only aggregate evidence and the minimum redacted metadata.
2. **Natural phone input without extra chatter.** Compare typed input with supplied voice text, then test normal, unknown, cross-session, expired, duplicate, and partial references. Prototype approval binding with fixtures before a live permission request. Count messages and required user actions; verify zero ambiguous approvals. Separately compare silent receipt with optional typing, including failed-ticket and cancellation paths. Do not claim less interruption from fixture counts alone.
3. **Interactive versus background native Channels.** On the same original CLI/version and selected workspace, test explicit first trust, custom-channel consent, a plain reply, a forced harmless permission request, exact-session stop, and resume after terminal close/worker restart. Independently inspect the artifact, CLI state, and phone reply. Pass only when reply permissions remain narrowly scoped, stale requests stay denied, messages are not replayed into new work, and unrelated sessions remain untouched. Preserve the current interactive/API fallback if any lifecycle boundary is unclear.

Keep one tool integration: Claude. These experiments do not authorize a cloud control plane, another agent platform, self-built speech recognition, automatic cross-account messaging, a theme rewrite, or a general-purpose database migration.

## Primary sources

All consulted 2026-11-04. Source dates are release/specification dates, not claims of product acceptance.

- **C1:** [Claude Code 2.1.317 release, 2026-11-03](https://github.com/anthropics/claude-code/releases/tag/v2.1.317).
- **C2:** [2.1.145 release: session JSON, 2026-05-19](https://github.com/anthropics/claude-code/releases/tag/v2.1.145).
- **C3:** [2.1.162 release: waitingFor, 2026-06-03](https://github.com/anthropics/claude-code/releases/tag/v2.1.162).
- **C4:** [Agent view: JSON contract, lifecycle, Windows notes, git behavior and limitations](https://code.claude.com/docs/en/agent-view).
- **C5:** [2.1.139 release: agent view research preview, 2026-05-11](https://github.com/anthropics/claude-code/releases/tag/v2.1.139).
- **C6:** [CLI reference: background, attach, stop, respawn and development Channels](https://code.claude.com/docs/en/cli-reference).
- **C7:** [2.1.257 release: resume behavior, 2026-09-01](https://github.com/anthropics/claude-code/releases/tag/v2.1.257).
- **C8:** [2.1.281 release: background workspace trust, 2026-09-23](https://github.com/anthropics/claude-code/releases/tag/v2.1.281).
- **W1:** [Tencent source snapshot, commit 874637a, 2026-10-13](https://github.com/Tencent/openclaw-weixin/commit/874637a0dbc24050f72d1385add4fc6170a2d726).
- **W2:** [Tencent changelog: 2.4.10 and reference restoration in 2.4.9-beta.0](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/CHANGELOG.zh_CN.md).
- **W3:** [Tencent inbound source: voice text and scoped reference restoration](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/inbound.ts).
- **W4:** [Tencent API source: getConfig and sendTyping](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts).
- **W5:** [Tencent message processing: typing lifecycle and 5-second refresh](https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/process-message.ts).
- **S1:** [Node 24 SQLite documentation: API history, stability and synchronous operations](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).
- **M1:** [MCP maintainers' official Apps announcement, 2026-01-26](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/blog/content/posts/2026-01-26-mcp-apps.md).
- **M2:** [MCP Apps overview: host, resources, iframe and CSP](https://modelcontextprotocol.io/extensions/apps/overview).
- **M3:** [MCP 2025-11-25 Tasks specification: experimental capability and lifecycle contracts](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks).
- **R1:** [Claude Code Remote Control: requirements, data flow, resume and limits](https://code.claude.com/docs/en/remote-control).
- **R2:** [2.1.283 release, 2026-09-25](https://github.com/anthropics/claude-code/releases/tag/v2.1.283).

Existing authority boundaries: [Claude Channels](https://code.claude.com/docs/en/channels), [Channels reference](https://code.claude.com/docs/en/channels-reference), and the project's [WeChat boundaries](WECHAT.md). These remain baseline requirements rather than new adoption claims.

[C1]: https://github.com/anthropics/claude-code/releases/tag/v2.1.317
[C2]: https://github.com/anthropics/claude-code/releases/tag/v2.1.145
[C3]: https://github.com/anthropics/claude-code/releases/tag/v2.1.162
[C4]: https://code.claude.com/docs/en/agent-view
[C5]: https://github.com/anthropics/claude-code/releases/tag/v2.1.139
[C6]: https://code.claude.com/docs/en/cli-reference
[C7]: https://github.com/anthropics/claude-code/releases/tag/v2.1.257
[C8]: https://github.com/anthropics/claude-code/releases/tag/v2.1.281
[W1]: https://github.com/Tencent/openclaw-weixin/commit/874637a0dbc24050f72d1385add4fc6170a2d726
[W2]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/CHANGELOG.zh_CN.md
[W3]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/inbound.ts
[W4]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/api/api.ts
[W5]: https://github.com/Tencent/openclaw-weixin/blob/874637a0dbc24050f72d1385add4fc6170a2d726/src/messaging/process-message.ts
[S1]: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
[M1]: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/blog/content/posts/2026-01-26-mcp-apps.md
[M2]: https://modelcontextprotocol.io/extensions/apps/overview
[M3]: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
[R1]: https://code.claude.com/docs/en/remote-control
[R2]: https://github.com/anthropics/claude-code/releases/tag/v2.1.283
