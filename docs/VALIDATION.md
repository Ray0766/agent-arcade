# Validation — 0.1.2 preview

Verified on **2026-11-03**, a Windows x64 development machine at 150% test scaling. Electron 45.2.1, host Node 24.18.0. Hardware inventory, display identifiers and raw process telemetry are excluded from public evidence. Test inputs and commands were synthetic; the CLI, hook subprocesses, inbox, reducer and Electron renderer were real. Existing user Claude hook settings were not modified by the installer.

## Automated checks

- `npm test`: **34/34 passed**. Includes official ID-less permission payloads, same-tool parallel calls, identical-input ambiguity, durable recovery, duplicate/out-of-order delivery, idle reminders, settled-batch notifications, privacy defaults, UTF-8 chunk boundaries, settings preservation and 12 concurrent observer processes sharing one HMAC key.
- `npm run check`: **22 JavaScript files** passed syntax checks; `git diff --check` passed.
- `npm run test:ui`: passed against source and `dist/win-unpacked/Agent Arcade.exe`. Covers isolated demo/live state, real observer subprocess delivery of synthetic events, response display, Chinese, both themes, quiet mode, compact navigation, keyboard Enter, focus retention, reduced motion, live detail refresh, install/remove hooks.
- `npm run dist -- --win`: built the unsigned portable **Agent Arcade 0.1.2.exe**. CI repeats source/package smoke and publishes the version only if all jobs pass. Check the actual [workflow result](https://github.com/Ray0766/agent-arcade/actions), not just this workflow's existence.

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

## Native desktop evidence

`node scripts/system-check.cjs` passed against source and the packaged executable. The [packaged receipt](evidence/system-check.json) confirms close-to-tray preserved the app, a silent native notification emitted its `show` event, the window stayed hidden during that notification, and the available display rendered without horizontal overflow at **150%** scaling.

This proves native API acceptance and application behavior, **not that a human saw a toast** under every Windows Focus Assist/notification setting. Only one display was connected. Multiple monitors, other scaling combinations, physical suspend/resume and screen-reader use remain unverified. No Windows settings were changed for the check.

## Resource budget and results

Run `node scripts/measure.cjs` for raw process measurements. Each phase warmed for 3 seconds, then sampled 12 one-second intervals. The window was visible/focused at 150% scaling with reduced motion. The second phase loaded **200 synthetic idle stations**; it is not a real Claude workload benchmark. CPU is total process cumulative CPU time divided by monotonic elapsed time, where 100% occupies one logical core. Working sets are summed and can count shared pages repeatedly.

| Phase | Budget declared before sampling | Measured | Result |
| --- | --- | --- | --- |
| Idle | Mean CPU <5% of one core; peak summed working set <300 MiB | **1.034%**, **329.164 MiB** | CPU passed; memory exceeded budget |
| 200 synthetic idle stations | Mean CPU <10%; peak summed working set <500 MiB | **4.898%**, **468.145 MiB** | Both passed; highest individual CPU interval was 12.411% |

[Public summary and methodology](evidence/resources.json) retain aggregate results, sample counts, budgets and the process-set stability verdict. Raw machine/process measurements remain local and are excluded from the repository. The measurement script defaults to gitignored `outputs/resources-private.json`; do not publish it without reviewing private telemetry. Startup, injection bursts, active animations and observer costs are excluded. Playwright's control connection and developer runtime may affect results. These numbers do not justify a low-memory claim or a platform rewrite; memory remains a preview limitation.

## Remaining boundaries

- Hooks report observations. They cannot expose the exact approval instant: a permission request can stay visible while an approved long tool is executing, until its next result event. Missing or ambiguous correlations become uncertain, never success.
- Real AskUserQuestion, user-launched subagent chains, API StopFailure, background schedules, interrupted CLI and physical crash/suspend recovery still need a dedicated live acceptance pass. Their deterministic sequences are tested; that is a different evidence level.
- No head-to-head user study establishes faster recognition, fewer switches or lower interruption cost than PeonPing/the terminal. See the comparison protocol and inspected visual references in [DECISIONS.md](DECISIONS.md).
- Unsigned Windows preview, no automatic updates; macOS/Linux desktop acceptance and a comprehensive security/accessibility audit are not claimed.
