# Security and privacy

Agent Arcade has two distinct modes. The **local hook observer** never approves a command or reads full transcripts. The optional **WeChat task bot** deliberately starts a Claude agent and relays the paired owner's single-use permission decisions. Neither mode opens result URLs or executes reply text as an application command. The bot's SDK can execute approved tools; do not confuse these two authority boundaries.

Bot credentials use Electron OS encryption without plaintext fallback. Connections and execution are opt-in; no startup replay/resume. Only the paired owner's complete, fresh private text is accepted. A bounded serial queue and expiring, task-bound approval codes prevent old decisions from authorizing new tools. Cancellation invalidates requests before waiting for execution to settle. Every tool is routed through a fail-closed hook and host callback. These controls are not an OS sandbox: approved native Windows commands may affect other local files or the network. Use a disposable project for acceptance; do not expose this as a multi-user service.

The SDK gets an API key and a small OS-environment allowlist, isolated configuration, disabled ambient hooks/plugins/MCP, and subprocess credential scrubbing. No local subscription credentials are copied. Tencent/Anthropic data flow and separate local SDK session retention are documented in [WECHAT.md](docs/WECHAT.md). There is no exactly-once delivery or durable task queue claim. A heuristic redactor is not a general secret detector; inspect data before allowing its use.

Renderer isolation: context isolation and sandbox enabled, Node integration disabled, navigation/new windows denied, permission requests denied, narrow validated IPC, no remote assets. Themes are validated palette/grid data, not SVG imports, HTML, or scripts. Response text is rendered using `textContent`.

The local inbox is not a security boundary against another process running as your user. Files use owner-only POSIX modes where supported and inherit user-directory ACLs on Windows. Stored results are not encrypted. The installer refuses malformed settings and keeps a backup before every change. It installs only observational command hooks. Tool inputs are transiently hashed using a random local HMAC key for permission correlation, then discarded. Do not include `observer-key`, real settings, or captured replies in public support reports.

For a vulnerability, use GitHub's private vulnerability reporting if enabled. If unavailable, open an issue asking for a private reporting channel without including exploit details or sensitive data. Do not post credentials or real transcripts in public issues.

Preview builds are unsigned. Verify the release source, build status and SHA-256 hashes, or build from source. No automatic updater is included.
