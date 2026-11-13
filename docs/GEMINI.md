# Gemini API

Source integration checked **2026-11-06**. This backend uses an API key entered in Agent Arcade and the existing Rainbow Cat character. Google AI Studio/API access is separate from the consumer Gemini app or subscription. No Google login tokens are read or copied. Real API and messaging-account acceptance is **pending**; the checks below use synthetic HTTP responses.

## Use

Disconnect the companion, select **Gemini API** in its connection settings, and save its key in the app. [Google AI Studio](https://aistudio.google.com/apikey) is the official key entry. The encrypted vault keeps `geminiKey` separate from every other provider; a snapshot reports readiness without returning the key. The fixed model is **`gemini-3.6-flash`**. Custom endpoints, model IDs and consumer OAuth are not offered.

Choose a configured channel and a project for task mode. In QQ companion mode, select the character and enable companionship instead; it uses the existing isolated memory and an empty workspace. The model receives no tools (`tools: []`, function mode `NONE`), and an unexpected function call is rejected before any approval or operation. Changing the API backend does not grant new channel access or expand the allowed private sender.

Task mode uses the existing approved `Read`, `Write`, `Edit`, `List` and `AskUserQuestion` interface. Every file action requires its own permission; paths and exact arguments are checked before and after approval. `Write` only creates a new file of at most 2,000 UTF-8 bytes; `Read`/`Edit` work on single-link text files up to 32 KiB. There is no shell, browsing, grounding, arbitrary code execution or built-in Google tool. Approved file content is sent to Google. These checks are a restricted file interface, not an OS sandbox. See the shared [GPT file-tool boundaries](GPT.md#chat-and-project-work).

## Protocol and limits

The adapter uses native Node fetch at the fixed `generativelanguage.googleapis.com` GenerateContent endpoint, with the key in `x-goog-api-key`, never the URL. Redirects are refused. GenerateContent is documented by Google as a legacy API; it remains the selected supported interface here because it keeps conversation history app-owned without introducing a hosted interaction lifecycle. This is not a claim that it is Google's newest API.

- Default model: the explicit stable **Gemini 3.6 Flash** identifier, rather than a moving `latest` alias. Newer stable models exist; no project-specific quality or price comparison has been measured.
- `store: false`, low thinking level, no thought-summary display; the output limit includes thinking tokens. This request flag is not a guarantee of zero provider retention.
- Signed response parts stay in their original order and form in bounded in-memory history; each available function-call ID is copied into its corresponding response. No signature or reasoning text is written to the recovery journal or shown as the reply.
- One complete candidate, at most 32 parts/eight function calls, 1 MiB response. Blocked, truncated, malformed and unsupported output is rejected before tool execution.
- Per turn: 16 requests, 24 tool calls, ten minutes; 8,192 output tokens per request. History is limited to 100 items/256 KiB; no silent truncation or automatic replay.
- No automatic network retry. Provider error bodies are not shown. `/cancel` stops local processing and approvals; existing file changes remain and remote cancellation/billing is not confirmed. Disconnect clears task history; QQ companion memory remains in its separate local store.

API billing applies. There is **no dollar-cost cap**; the request limits do not guarantee a maximum bill. Model access, supported region and credit must be checked in the user's Google account.

## Evidence and sources

The provider tests cover the actual request schema, signed-part continuation, no-tool refusal, separate permissions, independent temporary-file readback, denial, cancellation, bounded malformed responses and safe errors. Service tests exercise the real dispatcher, runner and SQLite with synthetic channel/HTTP transports. Main-handler tests cover fixed official guide URLs, trusted configuration and key isolation. These do not establish paid API availability or a live QQ/WeChat/Feishu flow.

Official sources checked 2026-11-06: [model and capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), [stable model/deprecation list](https://ai.google.dev/gemini-api/docs/deprecations), [GenerateContent REST schema](https://ai.google.dev/api/generate-content), [function modes and signed history](https://ai.google.dev/gemini-api/docs/generate-content/function-calling), and [thinking/token limits](https://ai.google.dev/gemini-api/docs/generate-content/thinking). No new model SDK or remote dependency was added for this runner.
