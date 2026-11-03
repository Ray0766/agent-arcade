# Validation

## 0.3.0-preview.1 — API and local CLI entry points

Current implementation adds local mode while preserving the API runner. **Real original Claude Code channel registration and WeChat + actual agent acceptance are pending.** No native model session, social message or credential transfer was performed by the fixture checks below.

- `npm test`: **118 passed, 0 failed**. Native fixtures cover loopback/capability/attachment checks, event paging/gaps, bound reply IDs, cancelled/expired/omitted permission previews, MCP write failure, stale configuration cleanup, native preparation without an API key and mode switching without deleting the saved API key. Historical counts below describe their own releases.
- Real Node child + stdio MCP + local HTTP fixtures negotiated protocol **2025-11-25**, declared channel/reply/permission capabilities and exercised message/reply/verdict paths. These use a test client, not an original Claude Code model session. MCP initialization does not prove the CLI registered this custom channel.
- Source API bot UI smoke and the original observer smoke passed. Isolated native UI fixtures checked English/Chinese conditions, persisted selection, retained encrypted fixture key, copied-command IPC routing, paused/failure wording and compact layout. Native screenshots are visibly synthetic.
- Source `npm run test:native` passed real Electron mode/key-retention checks and a system-Node stdio MCP/local-HTTP permission round trip, including app-side revocation/private-config cleanup. Runtime discovery found system Node and original CLI 2.1.317 using version checks only. These do not register a channel in the original CLI or call a model. `npm run check`: **41 JavaScript files**. [Source fixture receipt](evidence/native-source.json).
- The local `dist/win-unpacked/Agent Arcade.exe` passed native sidecar, API bot UI and observer UI gates. The sidecar check actually launched system Node against the package's unpacked script/dependencies and exercised stdio/reply/permission/cleanup; it was not a source-path substitute. [Packaged fixture receipt](evidence/native-packaged.json). Final release CI reruns these gates against its own build, including the final version-label and wording refinements.
- `npm audit --omit=dev`: **0 known production dependency vulnerabilities** at this check, not a security audit. No resource/performance improvement has been measured.
- CI exposed graceful-detach timing: the fixture waits for a present authenticated client poll (the initial waiter is `undefined`, not just `null`), and the channel sends its detach before aborting the active HTTP poll. The broker lease remains the fallback when graceful notification cannot complete. Packaged PowerShell gates stop on each failed command so a later pass cannot mask an earlier failure.

**Pending live checks:** user confirmation of the custom development channel in original CLI 2.1.317+, inbound WeChat text, actual task/output, a reply received on the phone, native permission adoption/local-first race, Ctrl+C behavior and reconnect recovery. API's turn/time/cost/abort guarantees do not apply to the independent CLI. Native `/cancel` only pauses forwarding and sends denials; a CLI process may keep running after app exit. All actual execution and task-success claims need separate evidence.

## 0.2.0-preview.2 — onboarding and connection evidence

The setup previously omitted the phone's ClawBot entry and placed QR pairing after project/API settings. Pairing now appears first with explicit ClawBot instructions in both languages. Authorization credentials, a successful empty long poll, a filtered inbound text and an accepted send are separate facts. Outbound acceptance is not read receipt or task verification. No ordinary friend chat is treated as the bot channel.

`npm test`: **92 passed, 0 failed**. The additional service fixture proves an empty successful poll leaves inbound count at zero and a failed send does not increase accepted-send count. The mock dispatch/approval/cancellation flow still passes with two task turns/ten outgoing messages. Real WeChat/paid-model round trip remains pending. The user's phone screenshot was used only to understand onboarding and is not shipped.

Desktop smoke scripts now isolate both Agent Arcade's data and Electron's user-data profile; tests can coexist with an owner's running desktop instance. This does not change the product's single-instance behavior within one profile. Source/packaged UI evidence for this revision is tracked separately from the preserved preview.1 evidence below.

## 0.2.0-preview.1 — experimental WeChat bot

Checked 2026-11-03 on the same Windows/Node/Electron environment below. Existing user hooks and social-account credentials were not modified. No valid paid model credential was used.

- `npm test`: **91 passed, 0 failed**, including all 41 previous observer checks. New checks cover parser bounds/owner/replay/cursor, serialized work, single-use/expired/cancelled approvals, single questions, send failure, login/forget races, OS-vault refusal and SDK result/abort semantics. These new model/transport tests use fixtures.
- `npm run test:bot-flow`: real service/parser/dispatcher/runner, mocked HTTP and SDK query boundaries. **2 task turns, 6 inbound, 10 outbound**, one reply boundary and one cancellation. Used/cancelled approval codes rejected; a late success-shaped result remains cancelled. [Public fixture output](evidence/bot-flow.json) explicitly reports zero network/model/shell executions. This is not live acceptance.
- `npm run test:bot-ui`: actual Electron English/Chinese setup, narrow view, reduced-motion rendering, a deliberately invalid key saved using the Windows OS vault then removed, and native SDK **2.1.317** startup. Source screenshots are local `outputs/bot-{setup,zh,compact}.png`; messages in the Chinese full screenshot are visibly synthetic. No WeChat authentication or model task is performed by this check.
- `npm run test:ui`: existing actual observer subprocess/UI flow still passed. `npm run check`: **34 JavaScript files**. `npm audit --omit=dev`: **0 known production vulnerabilities** at this check; this is not a security audit. Existing development dependencies still report moderate advisories.
- Real Tencent QR endpoint returned a code and local-encoding content. Not authenticated, no messages sent; QR data is not published.
- Actual SDK/native subprocess with an intentionally invalid synthetic API key returned an authentication-error result and `error` outcome, zero approved tools. [Redacted receipt](evidence/sdk-auth-check.json). This verifies failure handling/no observed subscription fallback, not valid-key model operation.
- Final `dist/win-unpacked/Agent Arcade.exe`: both observer and bot UI checks passed, including OS-vault save/remove and the unpacked native SDK binary's actual version. The local final portable also extracted, launched and rendered four isolated demo stations; this is packaging/startup evidence, not live bot acceptance.
- [Published preview](https://github.com/Ray0766/agent-arcade/releases/tag/v0.2.0-preview.1), code commit `4cf05c9fc4ae7897064dc2ee52760cac13bcf3f7`: [CI 41609850123](https://github.com/Ray0766/agent-arcade/actions/runs/41609850123) passed Linux/Windows core, source/packaged observer+bot UI, mock flow and release. Actual downloaded `Agent.Arcade.0.2.0-preview.1.exe` (220,986,667 bytes) SHA-256 `e691557ef7f3e693be09bdf650bf607e81d63ffe24011c7b0f41dccde5a45c51` matched both the published checksum and asset digest. The downloaded binary was not launched over the owner's active setup session; local portable startup and CI packaged checks are the separate evidence.

**Not accepted:** actual owner pairing, incoming WeChat task, valid-key model execution, real approval/question round trips, output-file inspection and final reply receipt. UI screenshots, QR reachability, binary startup and fixtures cannot establish these. Login requiring phone verification, groups and media are unsupported. Native Windows is not a sandbox; no latency/resource/user-benefit improvement has been measured. New runtime increases dependency/package size. Historical observer measurements below do not describe the bot.

## 0.1.3 observer preview — preserved prior evidence

Verified on **2026-11-03**, a Windows x64 development machine at 150% test scaling. Electron 45.2.1, host Node 24.18.0. Hardware inventory, display identifiers and raw process telemetry are excluded from public evidence. Test inputs and commands were synthetic; the CLI, hook subprocesses, inbox, reducer and Electron renderer were real. Existing user Claude hook settings were not modified by the installer.

## Automated checks

- `npm test`: **41/41 passed**. Includes official ID-less permission payloads, same-tool parallel calls, identical-input ambiguity, durable recovery, duplicate/out-of-order delivery, idle reminders, settled-batch notifications, privacy defaults, UTF-8 chunk boundaries, settings preservation and 12 concurrent observer processes sharing one HMAC key. Seven new sequences cover question semantics, parent-close ordering/attention and bounded pending requests across restart.
- `npm run check`: **23 JavaScript files** passed syntax checks; `git diff --check` passed.
- `npm run test:ui`: passed against source and `dist/win-unpacked/Agent Arcade.exe`. Covers isolated demo/live state, real observer subprocess delivery of synthetic events, response display, Chinese, both themes, quiet mode, compact navigation, keyboard Enter, focus retention, reduced motion, live detail refresh, install/remove hooks.
- `npm run dist -- --win`: builds the unsigned portable **Agent Arcade 0.1.3.exe**. CI repeats source/package smoke and publishes the version only if all jobs pass. Check the actual [workflow result](https://github.com/Ray0766/agent-arcade/actions), not just this workflow's existence.

Tests initially failed in the sandbox's protected temporary directory (`EPERM` during atomic rename). They passed with a workspace test directory or normal Windows execution. A desktop smoke timeout was a fixture language assumption, not a DPI click failure: the host defaults to Chinese, so the disposable fixture now explicitly starts in English. Native Playwright clicks passed at 150% scaling.

## Real Claude Code acceptance

The first installed CLI was 2.1.277. Its real payload exposed a bug hidden by the original synthetic fixtures: `PermissionRequest` omits `tool_use_id`, leaving the station waiting after a tool completed. The fix uses a keyed correlation digest, preserves ambiguity, and was reinstalled into a new isolated home. Final runs used **2.1.317**, which the CLI's own updater had installed. No claim that every historical version was tested is made.

| Observed flow | Evidence | Result |
| --- | --- | --- |
| Session A requests permission; B continues working | [Screenshot](evidence/live-waiting-running.png), [snapshot](evidence/live-waiting-running.json) | Two independently identified real sessions; demo false |
| A's approved tool finishes and activity resumes | [Screenshot](evidence/live-resumed.png), [snapshot](evidence/live-resumed.json) | `PostToolUse` clears A's uniquely correlated wait and records running |
| A emits Stop while B is still active | [Detail screenshot](evidence/live-response-ended.png), [snapshot](evidence/live-response-ended.json) | “回复结束”, explicit outcome-unverified explanation; B remains running |
| Deliberate exit-code-7 tool failure, then separate successful print command | [Actual observer receipts and state](evidence/live-tool-recovery.json) | `PostToolUseFailure → error → PreToolUse → running → PostToolUse → Stop → SessionEnd`; no task-success assertion |

The harmless commands only print numbers, wait, or return exit code 7. A minimal real reply also exercised SessionStart, UserPromptSubmit, Stop and SessionEnd. Result capture stayed off in these live runs. Capturing/clearing result text is covered by subprocess/UI tests rather than a claim of live conversation capture.

To reproduce manually: use a disposable `AGENT_ARCADE_HOME`, set the same variable for the app and Claude process, install hooks into a disposable settings file, and pass it with `claude --settings <file> --setting-sources ''`. In manual permission mode request `node -e "setTimeout(()=>console.log(13579),8000)"`; keep another session running the same type of wait. Respond in Claude Code. Observe event history as well as the scene. A subscription/account and normal Claude usage are needed for this optional live check; the demo and automated tests need none.

## Additional 0.1.3 live acceptance

All new flows used real Claude Code **2.1.317** with isolated hooks and harmless synthetic inputs. Main sessions are distinguished from Claude's internal child agents when selecting evidence. New screenshots were inspected locally and retained in ignored outputs; public evidence uses event/state records instead of publishing those images.

| Flow | Evidence | Result and boundary |
| --- | --- | --- |
| AskUserQuestion, generic permission notification, answer, response boundary | [Waiting state](evidence/live-question-waiting.json), [answered state](evidence/live-question-answered.json) | The parent retains `waiting/question`; answering produces PostToolUse/running, then Stop/response ended. The notification no longer mislabels a question as an operation approval. |
| Custom child agent then parent response | [Actual receipts and reducer trace](evidence/live-subagent-lifecycle.json) | At SubagentStop the child is response-ended and the parent still running. Parent ends only at its own Stop. No tools/files were accessed by the child. |
| Deliberately unavailable synthetic model | [Actual StopFailure receipts](evidence/live-turn-failure.json) | CLI reports api_error/404 and emits StopFailure/error before SessionEnd. This does not simulate a service outage or prove behavior for every API error. |
| Esc during a harmless long-running tool | [Displayed state](evidence/live-interrupted.json), [cancellation/exit record](evidence/live-interruption-boundary.json) | No cancellation hook arrived. After five actual minutes the last running observation displayed uncertain; explicit CLI exit subsequently emitted SessionEnd. Immediate cancellation detection is **not supported by this observed hook flow**. |

## Native desktop evidence (0.1.2 baseline)

`node scripts/system-check.cjs` passed against source and the packaged executable. The [packaged receipt](evidence/system-check.json) confirms close-to-tray preserved the app, a silent native notification emitted its `show` event, the window stayed hidden during that notification, and the available display rendered without horizontal overflow at **150%** scaling.

This proves native API acceptance and application behavior, **not that a human saw a toast** under every Windows Focus Assist/notification setting. Only one display was connected. Multiple monitors, other scaling combinations, physical suspend/resume and screen-reader use remain unverified. No Windows settings were changed for the check.

## Resource budget and results

The CPU/memory numbers below are the **0.1.2 baseline**, not a fresh measurement of 0.1.3. The transmission change is verified separately; no memory-reduction percentage is claimed.

Run `node scripts/measure.cjs` for raw process measurements. Each phase warmed for 3 seconds, then sampled 12 one-second intervals. The window was visible/focused at 150% scaling with reduced motion. The second phase loaded **200 synthetic idle stations**; it is not a real Claude workload benchmark. CPU is total process cumulative CPU time divided by monotonic elapsed time, where 100% occupies one logical core. Working sets are summed and can count shared pages repeatedly.

| Phase | Budget declared before sampling | Measured | Result |
| --- | --- | --- | --- |
| Idle | Mean CPU <5% of one core; peak summed working set <300 MiB | **1.034%**, **329.164 MiB** | CPU passed; memory exceeded budget |
| 200 synthetic idle stations | Mean CPU <10%; peak summed working set <500 MiB | **4.898%**, **468.145 MiB** | Both passed; highest individual CPU interval was 12.411% |

[Public summary and methodology](evidence/resources.json) retain aggregate results, sample counts, budgets and the process-set stability verdict. Raw machine/process measurements remain local and are excluded from the repository. The measurement script defaults to gitignored `outputs/resources-private.json`; do not publish it without reviewing private telemetry. Startup, injection bursts, active animations and observer costs are excluded. Playwright's control connection and developer runtime may affect results. These numbers do not justify a low-memory claim or a platform rewrite; memory remains a preview limitation.

## Idle delivery comparison

`node scripts/snapshot-probe.cjs --baseline-ref b4b9d89` compares only the old/new main/UI delivery behavior while sharing the current reducer. In one 4.2-second sample per view with 200 synthetic idle stations and reduced motion:

| View | Baseline full snapshots / measured structure mutations | 0.1.3 |
| --- | --- | --- |
| Scene | 4 / 4 | 0 / 0 |
| Activity | 4 / 8 | 0 / 0 |

[Aggregate result and limits](evidence/snapshot-probe.json). Structural mutations count the stats/activity containers, excluding relative ages. Both variants updated ages, displayed new events, and changed to uncertain across an isolated test-clock boundary. This establishes less redundant delivery/rendering, not CPU/RSS savings, physical sleep recovery or comparative user benefit.

## Remaining boundaries

- Hooks report observations. They cannot expose the exact approval instant: a permission request can stay visible while an approved long tool is executing, until its next result event. Missing or ambiguous correlations become uncertain, never success.
- Real ExitPlanMode, multi-level/background subagent chains, background schedules, service/network outages and physical crash/suspend recovery still need a dedicated live acceptance pass. A single child, unavailable-model StopFailure and one CLI cancellation flow were exercised above; they do not establish every variant.
- No head-to-head user study establishes faster recognition, fewer switches or lower interruption cost than PeonPing/the terminal. See the comparison protocol and inspected visual references in [DECISIONS.md](DECISIONS.md).
- Unsigned Windows preview, no automatic updates; macOS/Linux desktop acceptance and a comprehensive security/accessibility audit are not claimed.
