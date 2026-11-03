# WeChat task bot — experimental Windows preview

Choose an **API agent** or your **local Claude Code CLI** after pairing one WeChat owner and selecting a project. API mode manages discrete tasks; local mode forwards messages into an original interactive CLI session. Both keep the existing Electron workshop and Sprout Bot. This is an owner-operated text bridge, not a group assistant or remote hosting service. Only Claude is connected.

## Setup

1. From a clean clone, install Node.js 22.13+, run `npm ci`, then `npm start`. A Windows portable includes the API SDK runtime; **local mode still requires system Node.js 22.13+ and a separately installed Claude Code 2.1.317+**. The terminal hook observer is optional for the bridge.
2. On your phone, open **WeChat → Me → Settings → Plugins → ClawBot**. On the ClawBot setup page, use its scan action to bind a displayed code. If this entry is unavailable, account/client compatibility is unresolved; an ordinary friend chat is not a substitute. Tencent's [official channel guide](https://intl.cloud.tencent.com/zh/document/product/1316/84459) describes the ClawBot entry. It lists iOS 8.0.70+; [another official release record](https://cloud.tencent.com/document/product/213/130654) also lists Android QR support, so do not infer Android is unsupported. A complete current availability matrix and Windows WeChat minimum version remain unverified.
3. In Agent Arcade, open **WeChat tasks / 微信派活 → Pair WeChat**. Scan this application's QR code and confirm on the phone. Pairing is now above project/key settings. This implementation uses Tencent's text protocol directly; the OpenClaw installation command on the phone page is for OpenClaw users, and is not an Agent Arcade installation step. Independent-client service compatibility still requires real acceptance. Login requiring phone verification remains unsupported.
4. **Credential saved** means Tencent issued authorization credentials. The chat destination is the **ClawBot conversation**, not a newly created ordinary friend named Agent Arcade. The upstream [maintainer explains the bot-conversation boundary](https://github.com/Tencent/openclaw-weixin/issues/52#issuecomment-4407647606); this channel does not operate your ordinary friend chats.
5. Choose a disposable project and select **Execution method / 执行方式**. Follow the API or local instructions below. Pairing alone never starts execution. Keep the computer/app running and send a fresh task after starting the selected connection.
6. For first acceptance, request a small text file in that disposable project, inspect the actual file locally, and check the WeChat reply. Also test refusal and the selected mode's stopping behavior. A model-generated report is not independent verification.

The desktop distinguishes **credential saved**, **channel online with no inbound text**, and **inbound text received**. The outbound count means Tencent accepted a send request, not that the recipient read it. An empty successful poll cannot prove an incoming task or final reply was delivered. Confirm a real round trip and inspect the actual output before calling setup accepted.

## API agent

This is the default and retains the app-managed SDK workflow. Save your own Anthropic API key in the password field, then select **Start receiving tasks**. Never paste a key into an issue, task message, screenshot or chat. API calls incur charges; this mode does not use claude.ai subscription login.

One task runs at a time, with three queued tasks. Later prompts use this connection's explicit SDK session ID. Every tool action, including reads, requires a five-minute, single-use `/allow CODE` or `/deny CODE`; no permanent allow rule is written. `/cancel` aborts the run and clears the queue; execution must settle before a replacement starts. `/new` starts fresh when idle. A single question accepts `/answer CODE text`, or a plain answer when it is the only pending request. `/status` can retry the latest failed final delivery within the same connection.

Tasks are capped at 6,000 characters, 24 SDK turns and ten minutes. The SDK cost threshold defaults to USD 1 and can be set from USD 0.05 to 5; it is not a hard billing cap and in-flight calls may exceed it. Parameters larger than 3,000 UTF-8 bytes or containing recognized secret patterns are refused rather than shortened. Inspect the project for full output if a reply is visibly shortened.

**Windows shell tools:** API mode exposes `Bash` and file tools, so install [Git for Windows](https://gitforwindows.org/) for shell tasks. Direct Read/Write/Edit tasks do not need Git. Current Claude Code itself can [use native PowerShell without Git](https://code.claude.com/docs/en/setup#set-up-on-windows), but `PowerShell` is not in this mode's fixed tool list. Local mode uses the installed CLI's own tool set. Project-specific tools such as npm remain separate prerequisites.

## Local Claude Code CLI

Local mode uses [official Claude Code Channels](https://code.claude.com/docs/en/channels) with your own unmodified interactive CLI. Agent Arcade does not read, collect or copy Claude login credentials, and does not set an API key for this mode. Authentication, account limits and billing follow the original CLI. Log in there through Anthropic's own flow first; do not paste its credentials into Agent Arcade.

1. Install system Node.js 22.13+ and Claude Code 2.1.317+, select **Local Claude Code CLI**, then start receiving tasks. No Agent Arcade API key is needed; a previously saved key remains stored for later API use.
2. Copy the generated launch command into **PowerShell on Windows**. It changes to the selected project and runs the discovered original CLI with `--permission-mode default --strict-mcp-config --mcp-config <private file> --dangerously-load-development-channels server:agent-arcade-wechat`. It does not modify your user/project MCP settings.
3. Personally review the CLI's custom development-channel and project/MCP trust prompts. Channels is a **research preview**; this WeChat channel is not on the default approved allowlist. The development flag enables this local test entry; it does not skip tool permissions. It is interactive only: `-p` or the Agent SDK cannot silently load this development channel. See the [official startup contract](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview).
4. Keep that terminal and Agent Arcade open, then send a fresh message in ClawBot. MCP initialization only proves a local process connected. Confirm a real reply before treating the route as usable.

Messages can be combined while the CLI is busy; one WeChat message is not guaranteed to be a separate task or response boundary. The `reply` tool must name a current forwarded message ID, but a reply does not mean the whole CLI turn ended or the work passed tests. The original hook observer can separately display real session events.

Local mode follows the CLI's own permissions: reads or previously allowed operations may run without a new prompt. A permission requiring approval can be relayed as a **CLI parameter preview** with a one-time `/allow CODE` or `/deny CODE`. It belongs to the CLI session, not necessarily one WeChat message. The upstream preview may be normalized or masked; app-detected omitted, redacted, unserializable or oversized previews are denied remotely and should be checked locally. A sent verdict does not prove it won the race with a local decision or was applied. See [permission relay semantics](https://code.claude.com/docs/en/channels-reference#relay-permission-prompts).

## Conversation

| Message | API agent | Local Claude Code CLI |
| --- | --- | --- |
| Plain text | One queued SDK task | Forwarded session input; may be combined with other messages |
| `/status` | Task/queue; can retry latest failed final send | Relay facts only; no model-state or delivery guarantee |
| `/allow CODE`, `/deny CODE` | Decide one pending SDK action | Send one verdict for a current relayed CLI request; adoption unconfirmed |
| `/answer CODE text` | Answer the identified single question | Unsupported; use normal conversation or the original CLI |
| `/cancel` | Abort run, clear queue, invalidate approvals | Pause new forwarding and send pending denials; **does not guarantee stopping Claude** |
| `/new` | Fresh app-managed session when idle | Handle a new session in the original CLI |

For local mode, reliably stop execution with **Ctrl+C in the original terminal** and exit that session when finished. Disconnecting or quitting Agent Arcade revokes its relay and pending remote codes; an already running CLI/tool may continue. Stop it locally before switching execution modes or reconnecting. There is no automatic model-session resume or replay.

Only one selected execution mode consumes this app's WeChat connection. Switch while disconnected; the API key is retained. Codes contain 128 random bits and expire after five minutes. Bot messages are currently Chinese; the desktop setup supports English and Chinese. Neither mode accepts images, voice, attachments or group tasks. Local `/cancel` does not withdraw messages already passed to Claude or enforce the API mode's turn/time/cost limits.

## Privacy, restart and failure

- The observer stays local. The bot sends messages/results through Tencent and model input through the selected Claude execution route. No app analytics are added; API-mode SDK nonessential traffic is disabled. Local mode retains the original CLI's own configuration and data policies.
- API key and WeChat token use Electron's OS credential encryption in `~/.agent-arcade/bot-vault.json`. The renderer receives only connection flags, never those credentials. There is no plaintext fallback. This Windows-first preview has not accepted other platform vault backends.
- Execution mode/project/cost configuration is in `bot-config.json`. Bot history is bounded and memory-only. API mode separately persists SDK sessions under `~/.agent-arcade/bot-agent/`; local mode retains the original CLI's normal session storage. The observer's result-capture switch does not control either. Forgetting credentials does not delete model sessions or project files.
- Local mode opens a random-port **127.0.0.1-only HTTP broker** with a temporary 256-bit capability, a per-attachment ID and bounded events. Its private `~/.agent-arcade/native-launch/<random ID>/mcp.json` contains the loopback address/capability so the CLI can spawn the Node channel. This temporary capability is not OS-encrypted; it is not a Claude or WeChat credential, is never shown in the copied command, and is revoked when the relay closes. The app attempts to remove the file on disconnect. Old commands/files cannot reconnect a revoked broker. Another process running as your local user is outside this security boundary.
- Packaged Node channel code and production dependencies are unpacked from ASAR so system Node can load them. Keep the app open while using its generated command; portable extraction paths may disappear after exit. Regenerate the command on every new connection instead of saving it as a permanent launcher.
- There is no auto-connect, auto-replay or auto-resume after restart. Messages older than the new connection are ignored; resend a task after reconnecting. Missing/late messages may be dropped. There is no exactly-once delivery claim or durable task queue.
- Network failures use bounded retries. Expired WeChat authorization requires pairing again. API `/status` can retry a failed final send within the same connection; local mode does not promise that retry behavior. A stream gap, uncertain MCP write or revoked capability closes the native relay rather than silently replaying input. A normal channel exit attempts detach; a killed/crashed process may only be detected by the broker's 90-second lease. An unstarted native connection expires after five minutes. Do not infer immediate revocation merely from closing a CLI window. After disconnect/restart, inspect the project and stop any remaining local CLI before retrying.
- **Native Windows execution is not an OS sandbox.** A selected `cwd` is a starting location, not filesystem containment. Approved commands may read, change or transmit other data. API mode excludes ambient OAuth/project hooks/plugins/MCP from its SDK environment. Local mode uses your original CLI's login and user/project behavior, with MCP servers restricted to the generated config; it does not copy the API-mode isolated environment onto your native session.

## Evidence

`npm run test:bot-flow` executes the API parser/service/dispatcher/runner with mock HTTP/model boundaries. `npm run test:bot-ui` launches the real UI and uses an invalid fixture key with the OS vault. Native channel tests use real Node stdio MCP and loopback HTTP fixtures, not a Claude model or social account. A negotiated MCP handshake is not proof the original CLI registered the channel.

**Still pending for both modes:** real owner pairing, incoming WeChat text, actual agent execution, permission/question round trip, output-file inspection and reply receipt. Local mode additionally needs original CLI channel registration/consent, real native verdict adoption and stopping/recovery acceptance. SDK startup, QR reachability, MCP fixtures, packaging and screenshots cannot substitute. Lower terminal switching/interruption remains a hypothesis.

See [technical sources and contracts](BOT_TECH_NOTES.md), [decision record](DECISIONS.md), [architecture](ARCHITECTURE.md), and [validation](VALIDATION.md).
