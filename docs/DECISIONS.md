# Decisions and evidence

Reviewed **2026-11-03** for the Windows preview. This record explains the retained design and the validation work; it is not a claim that live acceptance or a comparative user study has passed. See [VALIDATION.md](VALIDATION.md) for measured results and remaining checks.

## Decision: keep the current observation architecture

Keep **Electron + short-lived Node observer + bounded local inbox + deterministic reducer**. Keep Sprout Bot, Moss Workshop and Lunar Post. The user needs to find the session that needs intervention while another session keeps working. A new framework or a new character does not resolve the current accuracy risks.

| Choice and current evidence | Practical benefit over the baseline | Cost, boundary and fallback |
| --- | --- | --- |
| Official Claude Code lifecycle hooks, not screen/image classification. [Hook reference](https://code.claude.com/docs/en/hooks); [official v2.1.316 release](https://github.com/anthropics/claude-code/releases/tag/v2.1.316), checked 2026-11-03. | Explicit session/tool identities and response boundaries can be tested deterministically. No vision model, recurring inference charge or continuous screen access is needed. | Hook coverage depends on the installed Claude version. Missing events remain uncertain; terminal inspection is the fallback. Reading current docs does not prove the installed version emits every field. |
| Electron **45.2.1** is pinned in `package.json`. The [official release record](https://releases.electronjs.org/release/v45.2.1) identifies it as stable, released 2026-10-30, including Chromium fixes. | Retains the working renderer, tray, notifications and package pipeline. Compared with a browser-only page, it supports a persistent desktop window and OS integration. | Electron has a multi-process runtime and a larger binary than a minimal native shell. CPU, memory, DPI and suspend/resume need measurements. No measured bottleneck currently justifies a Tauri/native rewrite and its integration cost. |
| Local file inbox rather than a new HTTP/WebSocket service. | Hooks can leave observations while the scene is closed. Atomic files and replay IDs give a simple recovery path without a port, authentication token or server lifetime. | A one-second polling interval introduces bounded nominal UI delay; disk scheduling and process startup can add more. Latency is not yet a measured guarantee. Retain bounded input/queue/history and measure before considering a persistent transport. |
| Declarative sprites and colors rather than executable theme plugins. | Community artwork can change the scene without acquiring filesystem or command privileges. Local assets also work without an account or network connection. | Seven fixed state sprites are deliberately limited. Keep labels controlled by the app; reject scripts, remote fonts/images and oversized JSON. |

Direct development dependencies are pinned (Electron 45.2.1, electron-builder 26.18.1, Playwright 1.64.1). A resolved lockfile is required for reproducible installs; pins alone do not lock transitive dependencies. Node 22+ is the documented observer baseline. The scene and reducer need no model or cloud account; **real Claude Code tasks still use the user's existing Claude access and may incur its normal usage costs**.

The installed electron-builder 26.18.1 official schema also distinguishes `signExecutable: false` from `signAndEditExecutable: false`: the latter disables resource editing, leaving Electron's name/version/icon in the executable. Inspection of the first local package confirmed that problem. Use `signExecutable: false` to keep original app resources while producing an explicitly unsigned preview; verify the rebuilt executable metadata.

## Official semantics that constrain the product

The following are summaries of the [current hook contract](https://code.claude.com/docs/en/hooks), not task-success evidence:

- `Stop` observes the main agent finishing a response. Interruptions do not necessarily emit it; API failures use `StopFailure`. Other Stop hooks can continue the turn.
- `PostToolUseFailure` records a tool failure, which may be followed by recovery. Permission denial and pre-execution validation rejection have different coverage.
- `background_tasks` and `session_crons` can reveal work/wakeups remaining after a response. On `SubagentStop` those arrays describe the **parent** registry.
- `last_assistant_message` avoids transcript scraping but is only response text. A child using `SubagentHandback` can deliver its report earlier, so its closing text is not necessarily the report.
- A notification's type matters: idle reminders must not be treated as permission requests.
- Current command hooks support **exec form**: `command` is the Node executable and `args` contains the observer path. This avoids shell interpretation and Windows quoted-string pitfalls. Use it with a tested supported version; do not silently claim compatibility with older versions.

Product wording must expose this distinction at the station itself: **“Response ended / 回复结束”** describes the observation; “task passed” requires independent checks outside this observer. A parcel opens the saved reply when capture was enabled; it is not a validation badge. The first preview's earlier **“Ready / 已交付”** labels and completion wording were a gap to correct, even though the settings explained the limitation.

## Safety and privacy checks within this architecture

The [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security) recommends current dependencies, renderer isolation, sandboxing, CSP and sender validation. Source inspection found explicit `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`; navigation/new windows are denied; IPC checks the main frame, sender and exact local page. Preload exposes specific methods, and replies are rendered as text. These are useful controls, **not a full security audit**. Verify packaged behavior as well as source configuration.

Keep notifications opt-in and silent, with quiet mode, focus suppression, recent-event filtering and per-station cooldown. Keep result capture off by default. No prompts, tool arguments, raw errors or transcript paths belong in the inbox or screenshots. A future deep link should be an explicit validated integration, never a shell command assembled from event text. Protecting attention and local data is part of the product, not an optional theme feature.

## A demonstrable highlight, and the evidence still needed

**Demonstration:** session A needs permission; session B is still building. The user identifies A from its labeled station, responds in Claude Code, sees A resume, then observes a response boundary. A deliberately failed tool can recover; a response that says a requested check failed must still read “Response ended”, not “success”. Repeat with quiet mode and with the app focused.

The narrow differentiating hypothesis is **persistent, individually identifiable multi-session status with restrained, evidence-based feedback**. Correct event-to-state mapping is testable now. Faster recognition, fewer terminal checks and lower interruption cost remain hypotheses until a comparison is run.

| Closest alternative / baseline | What is established by its own materials | What Agent Arcade should test, without assuming superiority |
| --- | --- | --- |
| [PeonPing official repository](https://github.com/PeonPing/peon-ping), reviewed 2026-11-03 | It already provides agent sound/visual notifications, naming, packs, mute controls and focus-related options. Platform support varies; some focus features are macOS-specific. Its docs describe terminal title and multi-pane limitations. | Compare a persistent station map against event alerts for two or more concurrent sessions. Animated characters, silence controls and customization alone are not new advantages. No head-to-head run has been completed. |
| Claude Code's own terminal/session UI and official hook notifications | The source tool remains the authority for permission decisions, full context and results. | Compare the number of terminal switches needed to find the waiting session. The scene loses detail and cannot approve permissions or currently jump directly into the correct terminal. |

For a later comparison, predefine the same event sequence, two sessions, starting windows, notification settings and tasks for both conditions. Record correct session identification, time to identify/resume, terminal switches, emitted notifications and false success interpretations. Report raw observations and sample size. An event replay or an attractive screenshot cannot establish these human outcomes.

## Visual and content references actually inspected

Two official static visuals were opened at full size on 2026-11-03. They were used for analysis only, saved in a temporary directory and **not added to the repository or used as shipped assets**. No hands-on use of either app/game is claimed. Static visuals cannot verify animation timing or interaction quality.

| Specific reference and observed detail | Principle → conversion into Agent Arcade | Boundary |
| --- | --- | --- |
| [CapWords official site](https://capwords.app/), specifically its [Blueberry Yogurt flashcard image](https://framerusercontent.com/images/ygzmWxzEXOhAvGAGc06NcOX9vQ.png?height=2200&width=1626): one cutout object, a clear white outline, a large object name and quieter pronunciation line. Apple lists CapWords as the **2025 Delight and Fun app winner**, not a finalist, on its [award record](https://developer.apple.com/design/awards/2025/). | A playful object earns its place by anchoring concrete information. Convert that into one Sprout Bot + state prop + explicit response/permission label; keep event evidence in a secondary detail view. Object and language should explain the same fact. | Do not copy the photos, sticker styling, typography or sounds. No claim that its learning outcomes transfer to monitoring. The static image does not demonstrate the transition animation; the award does not establish suitability for Windows. |
| Apple's [2026 Is This Seat Taken? screenshot](https://www.apple.com/newsroom/images/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/article/Apple-WWDC26-Apple-Design-Awards-Is-This-Seat-Taken_big.jpg.large.jpg), linked from the [official winner announcement](https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/): bounded bus seats organize distinct characters; the selected character's request appears separately from the scene. It is the **2026 Delight and Fun game winner**. | Spatial grouping helps identify individual actors, while a separate explanation handles detail. Retain stable per-session stations, distinct work/attention/parcel silhouettes and a detail dialog for timestamped events. Preserve task names in compact mode. | Monitoring should not inherit puzzles, objectives, scores, waiting for animations or game-driven urgency. Do not copy characters, bus art, textures or dialogue. No player testing or causal readability result is inferred from the screenshot. |

### Project expression and scope

Two feasible directions were considered: a text-first event list with a small character icon, or the existing set of miniature workstations with a separate event view. Retain the workstations: they preserve the project's authored identity and make per-session locations the memorable element. The event list remains the accurate detail/fallback. This is a refinement, not a layout or art replacement.

- **Color:** Moss ink `#243C37`, sky `#EDF2E7`, floor `#DCE6D2`, attention amber `#EFB856`; Lunar ink `#343954`, sky `#E2E5F1`, floor `#CBD1E3`. State words and props carry meaning alongside color.
- **Type:** local system sans (`Segoe UI`, `Microsoft YaHei`, sans-serif fallback), no downloaded font. Existing hierarchy: page heading 28–32 px, section heading 14 px, task name 12 px, status/detail text 9–12 px. Small status text needs a real scaling/readability check; the declared sizes are not accessibility evidence.
- **Space/density:** keep each station's name/state above its scene and fact/age below; 18 px full-view grid gap, 10 px compact gap. Multiple stations should remain identifiable without decorative metrics expanding their footprint.
- **Motion:** work, attention, smoke and parcel correspond to observed states. Reduced-motion mode must preserve props/labels; absence of motion cannot mean absence of status. Do not add entry animations or audio to compensate for ambiguous wording.
- **Language:** action text says what happens (“Install hooks”, “Open response”, “Clear responses”), status says what was observed. Both languages must preserve “response ended ≠ independently verified success”. Use synthetic examples only where visibly marked as demo.

These references inform structure and semantics. Original Sprout Bot pixels and scene vectors remain MIT project assets; third-party reference images remain their owners' works. Current local UI screenshots, genuine event receipts, resource measurements and pending Windows acceptance belong in [VALIDATION.md](VALIDATION.md), not in marketing claims.
