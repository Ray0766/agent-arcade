# DeepSeek API

Local/source integration, checked against official documentation on **2026-11-04**. This adapter is newer than the published `0.3.0-preview.2` package. The local Windows build passed real **DeepSeek Flash** chat and an approved file write with independent byte verification on the same date. This exercised the packaged runner, Dispatcher and file tools with a **simulated local messaging transport**, not a real QQ/WeChat round trip. [GPT API](GPT.md) is also selectable; each provider retains its own protocol, key and history. The two API runners share the same approved file-tool implementation.

## Set up

1. Open **Chats → Connection settings**, disconnect an active connection, and choose **DeepSeek API** as the AI backend.
2. Choose an existing project directory. Select a messaging channel separately and complete its setup: [WeChat](WECHAT.md), or a configured local QQ bridge where available.
3. Enter the **DeepSeek API key in the app**, then save it. Do not send a key in a chat. DeepSeek, OpenAI and Anthropic keys are stored separately using the OS-backed vault; switching providers preserves each key without sending it to the other provider.
4. Select **DeepSeek Flash** (`deepseek-flash`, default) or **DeepSeek V4 Pro** (`deepseek-v4-pro`). Connect the channel and send a message from its configured owner account.

The default original character is **Whale Girl**. Its optional light conversational style does not change the model, tools, permissions or evidence requirements. Appearance and conversational tone can be changed while disconnected.

## What it can do

Ordinary chat requires no file-tool approval and replies without a fixed diagnostic prefix. For project tasks, the adapter offers a small set of tools; each file action requires an explicit, one-time approval through the existing `同意 CODE` / `拒绝 CODE` flow.

| Tool | Implemented behavior |
| --- | --- |
| `Read` | Read one UTF-8 text file, at most 32 KiB. Binary and multi-link files are rejected. |
| `Write` | Create a **new** UTF-8 file in an existing directory, at most 2,000 UTF-8 bytes. It refuses to overwrite an existing path. |
| `Edit` | Replace exactly one occurrence of supplied text in an existing UTF-8 file; resulting file must remain within 32 KiB. Missing or ambiguous matches fail without editing. |
| `List` | List up to 100 entries in one directory, without recursion or following links. |
| `AskUserQuestion` | Ask one clarification question. Its answer grants no authority for a separate file action. |

Paths must be relative to the selected project. Known symlinks, junctions, traversal, Windows device names and alternate data streams are rejected; paths are checked again after approval. Edit also checks the opened file's identity and metadata. These application checks are **not an OS sandbox** and do not guarantee containment against another local process concurrently replacing directories or modifying files. Use a project whose contents you control. Approved file contents are sent to DeepSeek as tool results.

There is no Bash/shell, arbitrary code execution, web browsing or third-party messaging tool in this adapter. It cannot claim to have run tests or commands. A created file is an observed tool outcome; a model reply ending remains `reply_ended`, never automatic proof of task success.

## Conversation, cancellation and limits

- One in-memory conversation is retained per connection, with exact local session IDs. `/new` starts fresh. Disconnecting or restarting the app clears this context; SQLite recovery metadata does not reconstruct or replay it.
- `停止` / `/cancel` aborts the active request and pending approval; late approvals cannot execute files. Existing changes are not rolled back. No network request or failed file operation is automatically retried.
- Execution is sequential: at most 16 model requests and 24 tool calls per turn, 8 calls in one model response, and a 10-minute turn timeout. Each model request caps output at 4,096 tokens.
- Local request history is capped at 100 messages / 256 KiB before another request. Responses are capped at 1 MiB. Exhausted context requires `/new`; the adapter does not silently truncate required tool history or reasoning.
- Tool argument JSON is capped at 2,600 UTF-8 bytes. The shared permission review also rejects oversized or secret-filtered displays rather than approving an altered preview.

**DeepSeek bills API usage. There is no dollar-cost cap in this adapter.** Request/token/time bounds are not a spending guarantee, and the Claude API budget setting does not apply. Check your DeepSeek balance and current pricing separately. The fixed destination is `https://api.deepseek.com/chat/completions`; custom proxies and redirect destinations are not supported.

Non-thinking mode is used by the UI for conversational latency. The execution adapter also supports an explicit `thinking: true` option for development. When enabled, all returned `reasoning_content` is retained privately in the bounded protocol history, including across later ordinary turns, as required when the `tools` parameter is present. It is not shown in the chat or exported as evidence. No latest-model quality or latency advantage has been measured here.

## Evidence and remaining acceptance

`node --test test/deepseek-runner.test.cjs` passed **18 tests**. Fixtures exercise actual temporary-directory create/read/edit/list operations, denied writes, late approval after cancellation, interrupted-batch resume without replay, malformed/unknown tools, traversal/link rejection, overwrite refusal, context bounds, provider failures, API-key non-disclosure and connection cleanup. Network/model replies are synthetic; these tests do not establish provider availability or real task quality.

The **2026-11-04 real API acceptance** used the owner's locally saved key, `deepseek-flash` and the packaged runner/Dispatcher/file tools. Three requests to the fixed official HTTPS endpoint returned HTTP 200. Ordinary chat produced one reply and zero tool requests. A second turn continued the same session and requested exactly one `Write`; the file was absent before approval. Within the user-authorized test, the harness matched the exact file path/content and submitted the actual one-time Dispatcher confirmation code. This was automated test approval, not a human click or a general permission bypass. Independent readback verified `deepseek-proof.txt` contained exactly `ARCADE_DEEPSEEK_LIVE_OK`, **23 bytes without a newline**, SHA-256 `b94fbec174da1c1406d1f70e1445c575eb587af5c98d56abe4c1fad1cc1af0ef`. The model turn remained `reply_ended`; the separate readback establishes this file result. [Sanitized receipt](evidence/deepseek-live-20261104.json).

Real QQ/WeChat delivery, live refusal, cancellation and reconnect remain unverified for this backend. The local simulated transport does not establish account setup or phone-side usability. No dollar cost, quality advantage or general reliability is inferred from these three requests. No account key or private conversation is included in the repository; this local acceptance did not publish a new package.

## Official references and choice

- [Models and pricing](https://api-docs.deepseek.com/quick_start/pricing/): at the check date, `deepseek-flash` maps to DeepSeek-V4.1-Flash-1017 and `deepseek-v4-pro` to DeepSeek-V4-Pro-0813. Both are configurable; alias updates and prices remain provider-controlled.
- [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/): the fixed HTTPS endpoint and bounded function-tool exchange use native Node `fetch`, avoiding an additional SDK or another local CLI installation.
- [Tool calls](https://api-docs.deepseek.com/guides/tool_calls/): functions are executed by the application, so model-generated arguments undergo local validation and owner approval. The preview uses the normal endpoint, not beta strict-mode claims.
- [Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/): its current tool-history requirement informs reasoning retention. The default non-thinking choice is a product tradeoff for ordinary conversation, not a demonstrated performance result.
