# Local Codex

The local Codex backend uses the original CLI's **app-server over stdio**. It does not read, copy or export Codex credentials and does not ask for another OpenAI API key. Sign in through the original Codex CLI first. Model use consumes that account's existing entitlement or configured billing; it is not an offline model.

## Setup

1. Install and sign in to Codex. This implementation was checked with **codex-cli 0.166.0-alpha.6 on Windows**; older protocol versions have not been accepted.
2. In Agent Arcade, disconnect the current connection, choose **Local Codex**, and select an existing project directory.
3. Configure the messaging channel separately, then connect and send a short message. The default interface character is Dragon Girl; changing appearance or disabling conversational style does not change execution permission.

On Windows the app searches for `codex.exe` on PATH, then the Codex desktop installation's versioned `LocalAppData/OpenAI/Codex/bin` directory. On other platforms it invokes `codex` on PATH. It does not run a shell to interpret the launch command. A missing CLI, unavailable login, incompatible protocol or rejected sandbox configuration fails the run; it never falls back to a more permissive execution mode.

## Execution and permissions

Each turn starts an owned app-server process. Initialization is followed by a protocol login-state check, an explicit new thread or exact `thread/resume`, and `turn/start`. Subsequent messages in the current connection resume only the returned thread ID. `/new` starts a different conversation. The current backend does **not** restore a Codex thread automatically after app restart or messaging reconnection.

The integration explicitly requests **workspace-write**, **on-request**, the **user** approval reviewer and disabled sandbox network access. This is Codex's native permission model: ordinary permitted workspace actions can run without a separate chat approval. The CLI still loads applicable user configuration and project instructions. This backend is not a clean configuration directory and does not claim that every preconfigured plugin/MCP capability is disabled. Availability and enforcement of the OS sandbox depend on the installed CLI/platform.

When Codex asks the client for a command or file-change approval, Agent Arcade presents the complete bounded operation using its existing one-use confirmation flow. File approvals require the actual pending diff. No session-wide command rule or file `grantRoot` is accepted. Oversized or redacted previews fail closed in the dispatcher. Structured questions are handled one at a time; secret-answer requests, unsupported tool requests, general permission-extension requests and MCP elicitation requests are declined by this client. Original CLI permissions and existing allowed operations are not represented as new approvals from the character.

`停止` / `/cancel` sends `turn/interrupt` for the exact current thread and turn, then waits for completion. A ten-minute limit also requests interruption. Transport failures and a missing interruption receipt cause bounded cleanup rather than an invented successful result. Interruption is not rollback and does not prove independent or detached work stopped. Disconnect joins the current run and disposes its owned app-server process. `turn/completed` with status `completed` becomes **reply ended**, never verified task success.

## Evidence, 2026-11-04

- The installed original CLI accepted `initialize` and `account/read`; authenticated ChatGPT login was confirmed without outputting an email, credential or thread ID. This probe made no model call.
- A direct real adapter call returned the exact ordinary-chat test marker with no tool approval.
- A subsequent exact-thread resume created a disposable `native-codex-proof.txt`. Independent inspection found **22 bytes**, exactly `ARCADE_CODEX_LOCAL_OK` followed by one LF newline; SHA-256 `9fae34bb03dd3becbf0948e7749febf1922e2326e30b395062b4c8478b824083`. The allowed workspace write did not require an approval request.
- A separate bounded, text-only generation test observed real `turn/started`, sent `turn/interrupt`, and observed real `turn/completed` with `status: interrupted`. No tool was approved.
- Contract tests cover exact resume, scoped events, one-use permission decisions, actual diff requirements, stale request invalidation, questions, cancellation, timeout and malformed/closed transport.

These are **direct adapter** results, not proof of Codex message delivery through QQ or WeChat. Real remote approval, longer workloads, Windows sleep/network loss, other accounts/platforms and detached-job stopping remain unaccepted. Private local receipts are `work/codex-live-acceptance.json` and `work/codex-interrupt-acceptance.json`; public evidence excludes account identifiers and credentials.

## Sources and choice

The official [Codex App Server protocol](https://learn.chatgpt.com/docs/app-server) documents structured thread/turn lifecycle, server requests and interruption. It was checked against JSON schemas generated by the installed CLI on 2026-11-04. The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) describes native configuration and MCP behavior.

Compared with parsing terminal output or starting `codex exec` without a host approval interface, app-server supplies correlated thread/turn IDs, explicit approval requests and an actual interruption response. This avoids inventing state from rendered text. It adds protocol/lifecycle maintenance and is tied to the CLI's evolving app-server interface; no broad performance or usability improvement is claimed from the bounded tests above.

## Companion-mode gate, reviewed 2026-11-05

Local Codex remains a task backend. It is **not enabled for autonomous companion mode**, whose current contract requires no model-accessible tools. A read-only filesystem sandbox, declining host approval requests, or asking the model not to use tools cannot establish that contract: permitted reads and some other tools can run without such an approval.

The installed `codex-cli 0.166.0-alpha.6` generated a fresh experimental JSON schema bundle using `codex app-server generate-json-schema --experimental`. Neither `ThreadStartParams` nor `TurnStartParams` exposes a global `tool_choice`, `toolChoice`, or an all-tools allowlist. `dynamicTools` adds client-provided tools; passing an empty list does not establish removal of built-in tools. The generated `environments` description says an empty array disables environment access, which is narrower than disabling all tools. The generated `ToolsV2` configuration contains web-search configuration only.

The current official [App Server documentation](https://learn.chatgpt.com/docs/app-server) documents dynamic tools as an experimental addition. The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents separate shell, local-image, app and MCP controls; it does not establish a single no-tools invocation for this integration. The [ChatGPT-plan App Server limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) explicitly distinguish App Server RPC inputs from arbitrary Responses API parameters. A no-tools Responses API request is a different backend/authentication route, not permission to extract or reuse original CLI credentials.

This is a bounded documentation/schema finding, **not a claim that no future or differently configured Codex can support this**. No model call, tool action, QQ message or account change was performed for this audit. The runner's existing fail-closed `conversationOnly` guard remains unchanged. A future implementation needs a documented enforceable control, version/capability checking, and direct negative tests before real-channel acceptance. Audit receipt: [Codex no-tools review](evidence/codex-no-tools-20261105.json).
