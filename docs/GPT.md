# GPT API

Source integration, checked **2026-11-04**. GPT API is a separate execution backend from [local Codex](CODEX.md). It uses an OpenAI API key entered in Agent Arcade; it does not read or reuse CLI credentials. This source revision is newer than the published preview.2 binary. Local protocol, file and UI tests are evidence of the implementation, not a successful paid API or messaging-account run.

## Set up

1. Open **Chats → Connection settings** and disconnect an existing connection.
2. Select **GPT API**, choose a project directory and save an **OpenAI API key in the app**. Do not send it through QQ or WeChat. OpenAI, Anthropic and DeepSeek keys are stored in separate fields in the OS-encrypted vault. Switching providers preserves them and clears an unsaved key from the form.
3. Choose **GPT-6.1 Sol** (`gpt-6.1-sol`, default) or **GPT-6 Astra** (`gpt-6-astra`). Access depends on the API account. Local Codex remains a separate option using its original login.
4. Select and configure [WeChat ClawBot](WECHAT.md) or the [personal QQ bridge](QQ.md), then start receiving tasks. One channel, backend and owner are active at a time.

The default character is the existing original **Dragon Girl**, shared with Codex. [DeepSeek](DEEPSEEK.md) retains Whale Girl. Portraits and optional light conversational tone never change the tools or permission rules.

## Chat and project work

Ordinary conversation returns the assistant's reply directly, without a forwarding receipt or file approval. For project work, GPT uses the same reviewed file tools as DeepSeek:

| Tool | Scope |
| --- | --- |
| Read | One UTF-8 file up to 32 KiB. |
| Write | Create a new file, up to 2,000 UTF-8 bytes; never overwrite. |
| Edit | Replace one exact, unambiguous occurrence in an existing file. |
| List | At most 100 entries in one directory. |
| AskUserQuestion | One clarification question; an answer grants no separate file permission. |

Each file action requires a correlated one-time approval. Project-relative paths, traversal/link/device checks and validation after approval are shared in `src/bot/file-tools.cjs`. These checks are not an OS sandbox against another process changing the filesystem concurrently. Approved read results are sent to the selected API provider. There is no shell, web browser, arbitrary-code or third-party messaging tool in these API adapters.

Send `同意 CODE` or `拒绝 CODE` only after reviewing the actual request. `停止` / `/cancel` cancels local processing and pending approval; it does not roll back files or confirm the provider stopped billing an already-submitted request. `/new` starts a fresh conversation. A returned model reply is `reply_ended`, never automatic verification of task success.

## Protocol, history and limits

The fixed destination is `https://api.openai.com/v1/responses`; redirects and custom proxies are not supported. The adapter uses native Node fetch, strict function schemas and sequential local execution. It requests `parallel_tool_calls: false`, `store: false` and low reasoning effort. Supported response items, including encrypted reasoning and message phase, remain in bounded in-memory history. Commentary alone cannot become a final reply, and incomplete output cannot execute partial tool calls. Reasoning is not shown in the UI or written into the SQLite journal.

- Per turn: 16 model requests, 24 tool calls, ten minutes, 8,192 output tokens per model request (including reasoning).
- Per response: 1 MiB, 32 output items, at most eight function calls.
- History: 100 items / 256 KiB. Exhaustion requires a new conversation; no silent truncation or task replay.
- Arguments: 2,600 UTF-8 bytes. The existing permission preview also rejects oversized or secret-filtered requests.
- No automatic network retry; unknown provider errors are reduced to local diagnostics, not raw response bodies.

**API billing applies; there is no dollar-cost cap.** Request/token/time limits do not guarantee a maximum charge. `store: false` controls response storage for this request; it is not a claim of zero provider retention. Disconnect/restart clears local conversation context. SQLite retains deduplication/recovery metadata, not a replayable conversation.

## Evidence and references

The runner tests use synthetic HTTPS responses and actual temporary files. Service-flow tests run the real GPT/DeepSeek adapters through the dispatcher and journal with synthetic chat transports. They verify direct chat, approved write plus independent readback, denied work, interruption, protocol failures and provider isolation. Source and packaged UI evidence and remaining acceptance are recorded in [VALIDATION](VALIDATION.md).

Live acceptance needs a key entered locally and a configured messaging account: chat; approve a small new file and inspect its bytes; deny another action; stop; reconnect and send a fresh message. No real OpenAI key or paid request was used for the current implementation.

Official references checked 2026-11-04: [function calling](https://developers.openai.com/api/docs/guides/function-calling), [reasoning and stateless continuation](https://developers.openai.com/api/docs/guides/reasoning), [conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [Sol model](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and [Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra). Responses was chosen for these models' tool interface. Sol is the cost-conscious default within this two-model selection; no project-specific quality, speed or savings comparison has been measured. DeepSeek keeps its own documented Chat Completions protocol rather than being forced through the OpenAI adapter.
