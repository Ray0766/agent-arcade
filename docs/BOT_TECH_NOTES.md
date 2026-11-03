# WeChat task bot: execution research

Reviewed **2026-11-03**. This is an implementation contract and research record, not a live WeChat or SDK acceptance report. The original API-mode research below checked installed **Claude Code 2.1.317** without model requests, dependency installation, social-account access or messages. The [0.3 local-mode addendum](#03-local-claude-code-channels-addendum) separates the later implementation and fixture evidence.

The user has changed the scope from observation alone to an owner-operated WeChat bot that can dispatch tasks. Retain Electron, the observer, deterministic state semantics and original characters. Keep execution orchestration separate from the observer; the SDK starts the agent in its own native process. A character animation must never make an execution decision.

## Choice and baseline

Use the official TypeScript **`@anthropic-ai/claude-agent-sdk` 0.3.317**, pinned with its lockfile. The [official changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md) aligns it with CLI 2.1.317. Version 0.3.314 fixed excluded settings leaking into sessions; 0.3.317 adds fail-closed hook matchers with `onFailure: "block"`. These are relevant controls, not a reason to adopt unrelated alpha APIs.

The mature alternative is an installed CLI subprocess with `-p --input-format stream-json --output-format stream-json`. Both run the same agent loop. The SDK supplies typed approval, interruption, session and stream handling, avoiding a second implementation of the control protocol. It still starts a native process and makes paid model calls; no latency or resource improvement has been measured. Keep the current observation-only mode usable without a model account. See [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) and [streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode).

## Authentication and environment

The bot's **API/SDK execution mode** requires the owner's **Anthropic API key**. Current SDK documentation does not authorize third-party products to offer claude.ai login or subscription limits without prior approval. Do not copy existing Claude OAuth credentials into bot storage. This API-mode constraint does not mean the optional original-CLI channel must collect an API key: that mode retains the user's login in Anthropic's own binary/flow. See [SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) and the addendum below.

According to the [environment reference](https://code.claude.com/docs/en/env-vars), non-interactive runs always use `ANTHROPIC_API_KEY` when present. `options.env` **replaces**, rather than merges, the subprocess environment. Build it from a small OS-variable allowlist, then explicitly set:

```js
const sdkEnv = {
  ...permittedOsEnvironment,
  ANTHROPIC_API_KEY: configuredApiKey,
  CLAUDE_CONFIG_DIR: absolutePrivateBotConfigDirectory,
  CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
  CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
  CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-arcade',
  DISABLE_TELEMETRY: '1',
};
```

Fail before starting if the configured key is empty. Do not inherit OAuth/auth tokens, provider-selection flags, custom API endpoints, GitHub tokens, proxy secrets, `NODE_OPTIONS` or `ELECTRON_RUN_AS_NODE` into the agent process. Do not log the environment. The separate config directory keeps bot sessions/settings apart; credentials have platform-specific storage rules, so this directory alone is not proof of credential isolation. The host-managed flag prevents settings-file provider/auth environment values overriding the host's routing. Environment scrub keeps the CLI's API key for its own requests while removing it from child-tool environments; it is an additional layer, not Windows process isolation. Model calls still send task context to Anthropic and incur API charges. `maxBudgetUsd` is an estimate-based stop that can overshoot, not a hard billing cap.

## Query, session and cleanup contract

Use the stable `query` interface, not removed V2 or alpha prewarming. An illustrative options shape is:

```js
const { query } = await import('@anthropic-ai/claude-agent-sdk');
const controller = new AbortController();
const run = query({
  prompt: messageStream, // AsyncIterable<SDKUserMessage>, kept open while active
  options: {
    cwd: configuredWorkspace,
    env: sdkEnv,
    settingSources: [],
    mcpServers: {},
    strictMcpConfig: true,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    permissionMode: 'default',
    permissionPrompts: 'host',
    persistSession: true,
    resume: savedSessionId || undefined,
    abortController: controller,
    maxTurns: configuredTurnLimit,
    maxBudgetUsd: configuredBudget,
    canUseTool,
    hooks,
    pathToClaudeCodeExecutable: realNativeBinaryPath,
  },
});
```

`settingSources: []` deliberately excludes ambient project/user instructions and hooks; this should be explicit in setup. SDK hook callbacks still supply the owned task's observations. A streaming user envelope has `type: 'user'`, `message: {role: 'user', content: text}`, and `parent_tool_use_id: null`; give it a UUID to correlate results. See [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript).

Persist the actual `session_id` received on init/result, mapped to the authenticated channel conversation and local task. Use explicit `resume`, never global `continue`; session files are local and persistence must stay enabled for restart recovery. See [sessions](https://code.claude.com/docs/en/agent-sdk/sessions).

Keep the app's own bounded queue, with one active task initially. Cancellation should invalidate pending approval IDs and remove queued application work before calling `await run.interrupt()`. The streaming interrupt receipt does **not** imply all queued SDK messages were cancelled. Do not feed the entire app queue into the SDK. End the input iterator and use `run.close()` in final cleanup; close terminates the underlying process. Use `controller.abort()` for abort/timeout cleanup, and observe terminal/worker lifecycle before reporting cancellation. A timeout or lost worker is an interruption/unknown outcome, never success. These cleanup paths need a real task test.

## Approval and question contract

`canUseTool(toolName, input, context)` replaces an interactive prompt; it is not called for every tool. Auto-allow rules and permission modes can bypass it. Route `AskUserQuestion` separately from operation approval. On an exact, current owner response:

```js
// One operation only. Never return persisted updatedPermissions implicitly.
return { behavior: 'allow', updatedInput: input };
// Rejection or expired approval:
return { behavior: 'deny', message: 'Approval declined or expired' };
// Clarifying answer: retain the original questions.
return {
  behavior: 'allow',
  updatedInput: { questions: input.questions, answers: answersByQuestionText },
};
```

Each answer key is the original question text; values are selected labels or the user's free text. A question answer must not approve a shell command. Permission requests need a task-scoped unpredictable request ID, expiry and one-use binding to sender, task and exact operation. Respect the callback's `context.signal`. Old approvals become invalid after worker restart. The callback can wait indefinitely; durable cross-process approval requires the separately documented `PreToolUse` defer/resume flow and is outside the minimal in-memory bridge. See [approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input).

Hard policy belongs in an all-tools `PreToolUse` hook, before ordinary permission evaluation. A shape for a denial is:

```js
const hooks = { PreToolUse: [{
  onFailure: 'block',
  hooks: [async (input, toolUseId, { signal }) => {
    const reason = await checkConfiguredPolicy(input, signal);
    if (!reason) return {}; // Continue normal permissions, not an approval.
    return { hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    } };
  }],
}] };
```

`checkConfiguredPolicy` above is an application function to implement and test. Do not present a shell substring blacklist as containment. A hook may return `permissionDecision: 'ask'` to route an operation to approval. See [SDK hooks](https://code.claude.com/docs/en/agent-sdk/hooks); `onFailure` is newer than that page's examples and is recorded in the 0.3.317 changelog.

## Windows package and execution boundary

The SDK's Windows x64 native optional dependency exposes `@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe`. Other target architectures need their own dependency/compatibility check. Preserve npm optional dependencies. In Electron, keep the native package outside ASAR, for example with `asarUnpack: ["node_modules/@anthropic-ai/claude-agent-sdk-win32-*/**/*"]`. Resolve a real file under `resources/app.asar.unpacked/node_modules/.../claude.exe` and pass it explicitly as `pathToClaudeCodeExecutable`; verify existence/version in the packaged app. Do not silently fall back to an unrelated global executable. The exact builder pattern is a recommendation requiring a package smoke test. Electron documents that `spawn` cannot execute binaries inside ASAR: [ASAR limitations](https://www.electronjs.org/docs/latest/tutorial/asar-archives).

Native Windows shell commands are **not OS-sandboxed** by Claude Code; WSL2 can use its shell sandbox. `cwd`, file-tool path checks and approval prompts do not contain an approved arbitrary shell process. The [official sandbox guide](https://code.claude.com/docs/en/sandboxing) also distinguishes shell restrictions from file tools, MCP and hooks. For this owner-only preview, require pairing/allowlisting, a fixed workspace, disabled ambient integrations, explicit operation approval, bounded input/queue/time, and a working cancel path. Do not call this multi-user hosting or promise filesystem isolation. Stronger isolation requires a separate WSL/container/VM milestone.

## Demonstrable claim and remaining tests

The demonstrable target is one WeChat message reaching one owned task, an actual approval/question reaching that same owner, and a correlated response returning with a clear outcome. Compare against terminal switching using the same task; lower interruption and navigation cost remain hypotheses until measured.

Preserve separate facts: response ended, agent run failed, cancelled, waiting for input, background work remains, and verified task success. `result.subtype === 'success'` alone is insufficient; inspect `is_error` and diagnostic fields. Even an error-free agent turn does not prove tests passed or the requested artifact is correct. Report independently observed test/output evidence separately.

Before calling the bot complete, test real SDK execution and WeChat receipt/reply; invalid credentials without subscription fallback; denied and expired approvals; a clarifying answer; duplicate inbound messages; wrong sender/request IDs; cancellation while running and while waiting; restart with a pending approval; package-native path; and error-free response without task-success evidence. This research did not run those checks.

## 0.3 local Claude Code Channels addendum

The user requested both entry points. [Official Channels](https://code.claude.com/docs/en/channels) supports original CLI authentication through claude.ai or a Console API key. Agent Arcade adds a Node MCP channel and a loopback relay, not another Claude sign-in flow. It does not read/copy Claude credentials, set an API key, or reuse the SDK's isolated `CLAUDE_CONFIG_DIR`/API environment for the local session. Authentication/account limits belong to the user's unmodified CLI; see [credential boundaries](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).

The generated command uses installed Node.js 22.13+ and original CLI 2.1.317+ with `--permission-mode default --strict-mcp-config --mcp-config <private file> --dangerously-load-development-channels server:agent-arcade-wechat`. Custom Channels remains research preview and requires the user's interactive confirmation; `-p` and SDK runs ignore this development flag. It bypasses the channel allowlist only. No user/project settings are edited. Pin MCP SDK 1.32.2 and zod 4.6.7; a real Node stdio fixture negotiated protocol 2025-11-25. That handshake is not evidence the original CLI registered or processed a channel message.

Electron retains WeChat credentials and owns the random-port 127.0.0.1 broker. A temporary 256-bit capability is stored in a private generated MCP file, not the renderer/copied command. A separate attachment ID, bound reply IDs, expiring permission codes, bounded events and fail-closed gap/write handling prevent silent connection reuse/replay. Capability revocation is authoritative even if file cleanup fails. The Node sidecar and production dependencies are unpacked from ASAR for system Node; packaged-sidecar verification is required.

The [reference](https://code.claude.com/docs/en/channels-reference) distinguishes channel input, the `reply` tool, permission notifications and model execution. Busy input can combine; a reply is not a Stop boundary. Native permission previews are not raw complete parameters and can be normalized, masked or omitted. The app refuses unsuitable previews remotely; a verdict sent does not confirm adoption. Existing CLI read/allow rules may execute without another prompt. Native `/cancel` only pauses new relay input and sends pending denials, while actual interruption/new-session handling remains in the original terminal. Neither app exit nor relay closure guarantees the independent CLI stopped.

Original CLI registration/consent, actual WeChat task/reply, native verdict adoption and stopping/recovery are still pending. Keep API mode's tested abort/session/result contract separate; no stability, latency, resource or billing improvement is inferred from adding this research-preview route.
