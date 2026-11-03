# Validation

## Local verification

- Node.js 24 on Windows: 19 core/integration tests passed.
- Actual observer subprocesses tested with synthetic official-shape payloads, including 12 concurrent processes and installed script copies.
- Settings merge/reinstall/uninstall, invalid settings preservation, privacy defaults, duplicate/out-of-order events, parallel permissions, recovery, subagent isolation, stale status, result revocation and theme validation covered.
- JavaScript syntax checked across source, scripts and tests.

## Automated desktop gate

The `Verify and build` GitHub workflow runs core tests on Windows and Linux, launches the Electron app on Windows, checks demo/live separation, result display, Chinese localization, theme change, quiet/compact modes, and install/remove hooks in a temporary home. It sends a real hook subprocess event to verify the displayed live station. It then builds the Windows package and repeats the smoke test on the packaged executable. Screenshots are retained as CI artifacts.

The first `v0.1.0` GitHub prerelease is created **only after** both core jobs and the Windows desktop/package job pass. Check the repository's actual Actions status; the existence of this workflow file is not evidence it ran successfully.

## Remaining acceptance work

- A person must exercise real installed Claude Code: concurrent sessions, tool permission dialog, AskUserQuestion, failed tool followed by recovery, subagent lifecycle, StopFailure, background task and interrupted CLI.
- Verify OS desktop notification delivery and tray behavior on the target Windows installation.
- macOS/Linux desktop and packaging are configured but not part of this Windows preview's acceptance claim.
- Code signing and automatic updates are not included.

The development sandbox could not access npm and did not provide an approved browser window, so local Electron installation and visual QA were not claimed. CI provides independent desktop evidence when it completes.
