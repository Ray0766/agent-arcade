# Claude session observations and background prototype

Implemented against original Claude Code **2.1.317**, checked **2026-11-04**. These modules preserve the existing hook observer and interactive WeChat channel. They do not replace either execution mode or turn a reply boundary into verified success.

## Official interface and why it is used

The supported metadata interface is `claude agents --json --all --cwd <project>`. Its documented fields distinguish process activity from background-session state; missing fields remain unknown. Background lifecycle uses `--bg`, `stop <id>` and `respawn <id>`. Background work can outlive a terminal under Claude's supervisor, but needs normal authentication, workspace trust and permissions. See the [official session JSON reference](https://code.claude.com/docs/en/agent-view#list-sessions-as-json) and [shell lifecycle reference](https://code.claude.com/docs/en/agent-view#manage-sessions-from-the-shell).

The baseline was hooks plus a conservative stale indicator. This additional source can expose a stopped process or conflicting observation without parsing terminal text. Its benefit to state accuracy and attention cost has not been measured against that baseline. The CLI subprocess adds startup/resource cost; no model call is explicitly requested by the JSON query. Claude's background runtime and automatic summaries may use the owner's provider; no claim of zero background cost is made.

## Metadata observation

`src/bot/claude-sessions.cjs` exports:

```js
const monitor = new ClaudeSessionMonitor({cli: nativeDiscoveryResult});
await monitor.refresh(selectedWorkspace);
const snapshot = monitor.snapshot();
const annotatedTasks = monitor.reconcile(hookTasks);
```

- `cli` accepts a native absolute executable path or the existing `{cli, node}` discovery result. Shell wrappers are rejected; invocations use `execFile` with argument arrays, `shell: false`, an eight-second timeout and a 1 MiB output cap.
- The chosen directory is resolved and must exist. `--cwd` limits the query; an explicit output `cwd` is checked again. There are at most 200 rows. No names, summaries, transcripts or unknown fields enter a snapshot. The only accepted name-derived value is the exact UUID-shaped random `arcade-…` launch tag used by the ownership prototype.
- There is one in-flight poll. Same-directory refreshes share it; a different-directory request during a poll fails clearly. Failures keep the previous evidence explicitly unavailable, never completed. Evidence older than 30 seconds is stale.
- Reconciliation adds `sessionEvidence`, leaving every hook state and event unchanged. It correlates full session UUIDs, never project basenames. A bounded history of 1,000 observed UUIDs allows “previously seen, now missing”; a session never seen in the selected scope is unavailable, not lost. Switching directories clears this scope history. Parent-session observations cannot establish subagent state.
- `idle`, `done`, command exit and `Stop` remain separate from independently verified task success. `outcome` is always `unverified`.

## Explicit background lifecycle

`src/bot/background-sessions.cjs` exports:

```js
const background = new BackgroundSessions({root: appDataRoot, cli, enabled: false});
await background.probe();             // Version/help only
background.setEnabled(true);          // Explicit local experiment choice
await background.create({workspace, prompt: ''});
await background.refresh(workspace);
await background.stop(exactOwnedId);
await background.resume(exactOwnedId); // Original CLI respawn, only after stop/done/failure
```

`snapshot()` / `list()` return capability, busy/ownership-error state and at most 20 owned jobs. No global stop, remove/worktree deletion, credential reading, implicit work submission or existing-session adoption is provided. The manager does not create its own poll timer or automatically stop sessions on app exit.

An intent containing a random launch tag, directory and creation time is saved **before** dispatch. Prompts are not stored in this record. The native CLI command uses `--permission-mode default`; existing Claude settings, hooks and permissions still apply. A working directory is not a sandbox. A nonempty prompt can use model quota and perform any operations the original CLI authorizes.

**Observed compatibility difference:** this Windows build accepts `--session-id` with `--bg` but assigns the background conversation a different UUID. The implementation therefore does not assume a requested UUID is the real session. It binds the printed short job ID to the exact random launch tag and the actual UUID from the official JSON list. Subsequent changes require fresh matching short ID **and** UUID. An ambiguous or missing match fails closed. This protects against accidental cross-session targeting; another process running as the same Windows user can modify local records and is outside the boundary.

`background-sessions.json` is a bounded atomic ownership record. On restart, every recorded state becomes unknown until refreshed. A recognized trust refusal removes the intent because the documented CLI path did not create a session; the app never approves trust itself. Unknown command failure or timeout keeps an uncertain intent and blocks another launch until identity is recovered. Raw command errors are not surfaced or saved. Corrupt ownership records disable mutations.

There is no automatic retry, global `continue`, `respawn --all`, supervisor stop or task replay. A successful stop command is followed by a status query; an unchanged/unknown state remains unchanged/unknown. A resumed session may ask for permission in original Claude Code.

## Verification and remaining limits

- **10 targeted automated tests passed**, including metadata filtering, unsupported/malformed responses, non-overlapping polling, scoped reconciliation, stale/failure handling, persisted ownership, exact-ID commands, trust rejection, identity mismatch and uncertain-launch protection. These are protocol/command fixtures.
- **Real Windows CLI check passed:** corrected empty-prompt create → `blocked`; stop → `stopped`; respawn → `working`; final stop → `stopped`. Only the exact app-created worker was stopped. No work prompt was submitted; provider requests/cost were not instrumented. [Sanitized receipt](evidence/background-lifecycle.json).
- A separate test directory was refused as untrusted, with the expected actionable error and no bypass. The current project directory permitted the lifecycle check.
- The JSON query is an additional observation, not a process liveness guarantee or result validator. CLI availability can also depend on organizational policy or disabled agent view despite the version/help probe succeeding.
- **Background + WeChat Channels + remote permissions/reconnection has not been validated.** `channelsVerified` is false. This prototype must not be presented as “close the existing WeChat terminal and continue safely.” It is a separate background-session entry point.
- No sleep/resume, crash-under-load, cross-version, resource benchmark or provider-cost acceptance is claimed by the empty-prompt check. Native commands may leave stopped records/worktrees in original Claude; this app does not delete them.
