Agent Arcade 0.2.0-preview.1 — experimental WeChat task bot, Windows first.

Send a message to dispatch a Claude task from WeChat; one-time permissions, questions and final replies return to the same owner. The original Electron workshop, Sprout Bot themes and independent local hook observer remain available.

**Experimental:** real WeChat pairing + paid model execution + output-file/result receipt is still pending. The official Tencent QR endpoint was reached without authentication or sending messages. A real SDK invalid-key run returned an authentication error without approved tools. These do not prove valid-key execution or chat delivery.

**Start:** open the app → WeChat tasks → choose a disposable project → save your Anthropic API key → pair using WeChat QR → Start receiving tasks. Computer must stay on. API billing is separate; Claude subscription login is not used. See docs/WECHAT.md.

Natural-language tasks, /status, /cancel, /new, one-time /allow and /deny, and single-question replies are implemented. Owner-only text, one active task and three queued, bounded inputs/turns/time/cost threshold. No group/media support, permanent tool approval or auto-resume. Approved native Windows commands are not sandboxed. Messages/results pass through Tencent and Anthropic; SDK sessions persist separately from the observer. Credentials use OS encryption. Original code/assets are MIT; SDK/runtime terms remain separate in THIRD_PARTY_NOTICES.md.

91 automated checks and a reproducible mock HTTP/model pipeline cover dispatch, dedupe, approval, cancellation, stale codes and outcome labels. Actual Electron UI checks cover English/Chinese, compact layout, OS-vault save/remove and bundled SDK startup. CI checks source/packaged observer and bot UI before releasing. “Response ended” never means verified task success.

No resource or user-benefit improvement claim. Live account compatibility, actual approval/question round trips, restart/network recovery with a paid task, physical sleep/multiple displays and resource impact remain unverified. Windows builds are unsigned; checksum and locked dependencies are attached. No automatic updater.
