# Security and privacy

Agent Arcade is a local observer, not an approval agent. It never returns a decision to Claude Code, opens untrusted result URLs, executes result text, or reads full transcripts.

Renderer isolation: context isolation and sandbox enabled, Node integration disabled, navigation/new windows denied, permission requests denied, narrow validated IPC, no remote assets. Themes are validated palette/grid data, not SVG imports, HTML, or scripts. Response text is rendered using `textContent`.

The local inbox is not a security boundary against another process running as your user. Files use owner-only POSIX modes where supported and inherit user-directory ACLs on Windows. Stored results are not encrypted. The installer refuses malformed settings and keeps a backup before every change. It installs only observational command hooks. Tool inputs are transiently hashed using a random local HMAC key for permission correlation, then discarded. Do not include `observer-key`, real settings, or captured replies in public support reports.

For a vulnerability, use GitHub's private vulnerability reporting if enabled. If unavailable, open an issue asking for a private reporting channel without including exploit details or sensitive data. Do not post credentials or real transcripts in public issues.

Preview builds are unsigned. Verify the release source, build status and SHA-256 hashes, or build from source. No automatic updater is included.
