# WeChat task bot — experimental Windows preview

The user-facing flow is **message → owned task → question/one-time approval → final reply**, with the existing Electron workshop alongside it. This is an owner-operated text bot, not a chat-client UI injection, group assistant, remote hosting service, or pet system. Only Claude is connected.

## Setup

1. From a clean clone, install Node.js 22.13+, run `npm ci`, then `npm start`. A Windows portable preview includes the SDK runtime. The terminal hook observer is optional for the bot.
2. On your phone, open **WeChat → Me → Settings → Plugins → ClawBot**. On the ClawBot setup page, use its scan action to bind a displayed code. If this entry is unavailable, account/client compatibility is unresolved; an ordinary friend chat is not a substitute. Tencent's [official channel guide](https://intl.cloud.tencent.com/zh/document/product/1316/84459) describes the ClawBot entry. It lists iOS 8.0.70+; [another official release record](https://cloud.tencent.com/document/product/213/130654) also lists Android QR support, so do not infer Android is unsupported. A complete current availability matrix and Windows WeChat minimum version remain unverified.
3. In Agent Arcade, open **WeChat tasks / 微信派活 → Pair WeChat**. Scan this application's QR code and confirm on the phone. Pairing is now above project/key settings. This implementation uses Tencent's text protocol directly; the OpenClaw installation command on the phone page is for OpenClaw users, and is not an Agent Arcade installation step. Independent-client service compatibility still requires real acceptance. Login requiring phone verification remains unsupported.
4. **Credential saved** means Tencent issued authorization credentials. The chat destination is the **ClawBot conversation**, not a newly created ordinary friend named Agent Arcade. The upstream [maintainer explains the bot-conversation boundary](https://github.com/Tencent/openclaw-weixin/issues/52#issuecomment-4407647606); this channel does not operate your ordinary friend chats.
5. Choose a disposable local project and save your Anthropic API key in the password field. Never paste the key into an issue, task message, screenshot, or this chat. API calls incur charges; claude.ai subscription login is not used. Then select **Start receiving tasks** and send a fresh short task in the ClawBot conversation. Keep the computer/app running. Pairing never starts execution automatically.
6. Confirm the exact tool parameters before sending `/allow CODE`. For the first real task, request a small text file in a disposable project, inspect that actual file locally, and test denial and cancellation too. A model-generated report is not independent verification.

The desktop distinguishes **credential saved**, **channel online with no inbound text**, and **inbound text received**. The outbound count means Tencent accepted a send request, not that the recipient read it. An empty successful poll cannot prove an incoming task or final reply was delivered. Confirm a real round trip and inspect the actual output before calling setup accepted.

**Windows shell tools:** this preview exposes `Bash` and file tools, so install [Git for Windows](https://gitforwindows.org/) for shell tasks. Direct Read/Write/Edit tasks do not need Git. Current Claude Code itself can [use native PowerShell without Git](https://code.claude.com/docs/en/setup#set-up-on-windows), but `PowerShell` is not yet exposed by this preview's fixed tool list. This is a project limitation, not an SDK requirement; a clean Windows machine without Git has not been accepted for shell tasks. Individual projects may also need their own tools such as npm.

## Conversation

| Message | Behavior |
| --- | --- |
| Plain text | One task; subsequent tasks resume the explicit session for this connection |
| `/status` | Current task/queue; retries the most recent failed final delivery within this connection |
| `/allow CODE` | Authorize exactly the displayed pending tool request, once |
| `/deny CODE` | Refuse that request |
| `/answer CODE text` | Answer the identified single question; a plain answer works when it is the only pending request |
| `/cancel` | Abort active work, clear the queue and invalidate outstanding permissions |
| `/new` | Start a fresh session when idle |

One task runs at a time, with up to three queued tasks. New execution waits for the previous task to actually stop. Codes contain 128 random bits, expire after five minutes and cannot survive cancellation or restart. No permanent allow rule is written. All tool actions, including reads, require confirmation; this conservative preview may need more approvals than mature alternatives. Only acknowledgements, input requests and final replies are sent to WeChat; per-tool progress stays local. Current bot messages are Chinese; the desktop connection UI supports English and Chinese.

Tasks are capped at 6,000 characters, 24 SDK turns and ten minutes. The SDK cost threshold defaults to USD 1 and can be set from USD 0.05 to 5; it is not an independently enforced billing cap, and in-flight requests may exceed a threshold. Approval parameters larger than 3,000 UTF-8 bytes or containing recognized secret patterns are refused rather than shortened. No images, voice, attachments, group messages or scheduled work are accepted. Long results are visibly shortened; inspect the actual project for full output.

## Privacy, restart and failure

- The observer stays local. The bot necessarily sends messages/results through Tencent and model input through Anthropic. No analytics are added; SDK nonessential traffic is disabled in the spawned environment.
- API key and WeChat token use Electron's OS credential encryption in `~/.agent-arcade/bot-vault.json`. The renderer receives only connection flags, never those credentials. There is no plaintext fallback. This Windows-first preview has not accepted other platform vault backends.
- Project/cost configuration is in `bot-config.json`. The bot's bounded task/chat history is memory-only and clears when the app exits or credentials are forgotten. The SDK separately persists local sessions under `~/.agent-arcade/bot-agent/`, including conversation content; the observer's result-capture switch does not control these SDK files. To remove them, quit the app and remove that specific directory. Forgetting credentials does not delete SDK sessions or project files.
- There is no auto-connect, auto-replay or auto-resume after restart. Messages older than the new connection are ignored; resend a task after reconnecting. Missing/late messages may be dropped. There is no exactly-once delivery claim or durable task queue.
- Network failures are retried with backoff, then stop the connection. Expired WeChat authorization requires pairing again. Failed sends remain visible locally; `/status` can retry within the same active connection. After disconnect/restart, inspect the project and initiate a fresh task explicitly.
- Every action is reviewed, but **native Windows execution is not an OS sandbox**. A selected `cwd` is a starting location, not filesystem containment. An approved shell command may read, change or transmit other local data. The bot does not inherit ambient OAuth, proxy secrets, GitHub tokens, project hooks, plugins or MCP configuration; this reduces accidental authority but is not isolation.

## Evidence

`npm run test:bot-flow` executes the real parser, service, dispatcher and runner against mock HTTP/model boundaries. It outputs `outputs/bot-flow.json`, explicitly marked as a fixture. `npm run test:bot-ui` launches the actual Electron UI and checks a deliberately invalid key using the real OS vault, then removes it; it never requests a paid model or authenticates WeChat.

**Still pending:** a real owner pairing, incoming text, SDK model execution, approval/question round trip, actual output-file inspection and reply receipt on a supported WeChat account. SDK binary startup, a reachable QR endpoint, synthetic event tests, packaging and screenshots do not substitute for this acceptance. Lower terminal switching and interruption versus OpenClaw/QClaw or terminal use remain hypotheses.

See [technical sources and contracts](BOT_TECH_NOTES.md), [decision record](DECISIONS.md), [architecture](ARCHITECTURE.md), and [validation](VALIDATION.md).
