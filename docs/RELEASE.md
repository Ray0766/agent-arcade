First Windows preview of Agent Arcade: a local desktop workshop for Claude Code sessions and subagents.

- Original Sprout Bot artwork, Moss Workshop and Lunar Post themes.
- Event-driven running, attention, error, delivery and uncertain states.
- Silent opt-in notifications, quiet mode, compact window and pinning.
- Optional local final-response parcels; no prompt or tool-argument capture.
- English / 简体中文 and an editable JSON theme format.

**Start:** install Node.js 22+, open the portable executable, then Settings & themes → Install hooks. Restart Claude Code. Use Try the demo to explore without connecting.

0.1.2 fixes real ID-less permission correlation, ignores post-response idle reminders, and coalesces notification batches. It labels Stop as “Response ended / 回复结束”, preserves keyboard focus, and keeps settings reachable in mini view.

Real Claude Code 2.1.317 permission/recovery and tool-failure sequences have screenshots and receipts in docs/VALIDATION.md. This prerelease is additionally gated by Windows/Linux core tests and source/packaged Windows Electron smoke tests. “Response ended” does not mean the work passed verification. Approval changes appear at the next hook event; identical concurrent tool inputs remain uncertain. Native notification show/close-to-tray were checked on one Windows display at 150% scaling. Physical sleep/multi-monitor behavior and comparative user benefit remain unverified.

The idle summed working set exceeded a 300 MiB preview budget (329 MiB in the development probe). This preview is not advertised as low-memory. Builds are unsigned; SHA256SUMS.txt and the locked dependencies are attached. No automatic updater.
