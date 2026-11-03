Agent Arcade 0.1.3 Windows preview: a local desktop workshop for Claude Code sessions and subagents.

- Original Sprout Bot artwork, Moss Workshop and Lunar Post themes.
- Event-driven running, attention, error, delivery and uncertain states.
- Silent opt-in notifications, quiet mode, compact window and pinning.
- Optional local final-response parcels; no prompt or tool-argument capture.
- English / 简体中文 and an editable JSON theme format.

**Start:** install Node.js 22+, open the portable executable, then Settings & themes → Install hooks. Restart Claude Code. Use Try the demo to explore without connecting.

Questions now stay “waiting for your answer” through generic permission notifications. Older parent-close events cannot overwrite newer child observations, and pending-request overflow remains uncertain after restart. Idle snapshots are deduplicated; relative ages and uncertainty still update.

41 core/integration tests plus source/packaged Windows smoke gates cover this preview. Real Claude Code 2.1.317 question/answer, child lifecycle, unavailable-model StopFailure and cancellation flows have receipts in docs/VALIDATION.md. A cancellation emitted no terminal hook: its last running observation became uncertain after five real minutes. Immediate cancellation detection is not claimed. “Response ended” still does not establish task success.

The idle delivery comparison removed 4 repeated full snapshots per 4.2-second sample with 200 static stations. It does not prove CPU or memory savings. The prior 0.1.2 summed-working-set baseline exceeded 300 MiB; 0.1.3 has not been rebenchmarked for memory. Native notification/tray were checked on one Windows display at 150%; physical sleep, multi-monitor behavior and comparative user benefit remain unverified. Builds are unsigned; SHA256SUMS.txt and the locked dependencies are attached. No automatic updater.
