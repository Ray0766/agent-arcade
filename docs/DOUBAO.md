# Doubao API

Source integration checked **2026-11-06**. Agent Arcade calls the **Volcengine Ark data-plane API** with a separate key; it does not log into the consumer Doubao app or reuse a Coding Plan subscription. The default character remains the project's original Doubao portrait and light conversational style. Real API and messaging-account acceptance is **pending**.

## Use

Disconnect the companion, select **Doubao API**, and enter the Ark API key directly in the app. Open the [Ark console](https://console.volcengine.com/ark/) to enable model access and manage keys. The key is stored in the independent OS-encrypted `doubaoKey` slot; switching providers preserves the other keys, and snapshots expose only readiness.

The fixed model is **`doubao-seed-2-0-lite-260428`**, an officially listed LTS version. Custom endpoints, arbitrary model IDs and `ep-*` inference endpoints are not supported by this first adapter because their selected model/tool behavior has not been validated. This is an explicit supported-model limit, not a claim that Ark lacks these options.

QQ companionship uses no tools (`tools: []`, `tool_choice: none`) and rejects unexpected tool calls. Task mode instead reuses `Read`, `Write`, `Edit`, `List` and `AskUserQuestion`, with separate one-time approval for each file action. No shell, browser, code execution or provider-hosted external tool is enabled. The shared [file-tool scope and cancellation limits](GPT.md#chat-and-project-work) apply; approved file contents are sent to Ark. Portrait and memory choices do not grant permissions.

## Protocol and limits

Requests go only to `https://ark.cn-beijing.volces.com/api/v3/chat/completions`, with `Authorization: Bearer` and redirects refused. The adapter uses native Node fetch and explicitly disables thinking for this supported model. It requests a complete, non-streaming response with a 4,096-token limit; no Responses storage or hosted conversation is created by the app.

Per turn limits are 16 model requests, 24 approved tool calls and ten minutes. Each response is bounded to 1 MiB/eight function calls, with one complete assistant choice. History is in memory only, bounded to 100 items/256 KiB. Malformed IDs, duplicate earlier call IDs, incomplete output and unsupported tools cannot execute a file action. Provider bodies and raw network errors are not copied into diagnostics. No automatic retry occurs after a request or send becomes uncertain.

`/cancel` cancels local processing/approval, not a confirmed remote request or bill; files already changed are retained. `/new` starts new task history. Disconnect/restart clears task history without replay; separate QQ companion memory retains its existing scope. API billing applies with **no dollar-cost cap**. Account/model authorization, region and credit remain the user's Ark settings. Local limits do not imply a maximum charge or zero provider retention.

## Evidence and sources

Tests exercise the actual adapter through the service/dispatcher/journal using synthetic HTTP and chat transports, including ordinary chat, exact approved write/readback, denial, cancellation, fixed model/key routing and sanitized failure. No real Ark key, paid request or Doubao QQ delivery was used for this implementation.

Official sources checked 2026-11-06: [Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=zh), [data-plane URL and key authentication](https://docs.volcengine.com/docs/ark/base-url-and-authentication?lang=zh), [model list](https://docs.volcengine.com/docs/ark/model-list?lang=zh), [LTS policy](https://docs.volcengine.com/docs/ark/lts-mechanism?lang=zh) and [thinking/model migration support](https://docs.volcengine.com/docs/ark/model-deprecation-migration-guide?lang=zh). The LTS page currently gives this version an earliest shutdown date of 2027-04-30; it is not a perpetual availability promise. Newer models exist, and this project has not measured comparative speed, quality or cost. No additional SDK was added for this runner.
