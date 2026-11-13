# Feishu application bot

Agent Arcade's Feishu channel connects one **enterprise self-built application bot** to one explicitly configured owner. It is not an ordinary personal Feishu account or a group webhook. Private text enters the existing Dispatcher and its one-use tool-approval flow. Group messages and other senders never enter the model queue.

The source implementation and local integration checks are complete for this boundary. A real enterprise application's credentials, permissions, event delivery and phone-side replies have **not** been accepted yet. A saved configuration, synthetic UI or loopback test does not establish a live Feishu connection.

## Set up the channel

1. In the [Feishu developer console](https://open.feishu.cn/app), create or use an enterprise self-built application, enable its bot capability, and obtain its App ID and App Secret. Publish the application with the required availability and administrator approval. This is distinct from a custom group webhook. See the [official bot overview](https://open.feishu.cn/document/client-docs/bot-v3/bot-overview).
2. Enable private-message receipt (`im:message.p2p_msg:readonly`) and sending as the application (`im:message:send_as_bot`). Subscribe to `im.message.receive_v1` using **long connection** delivery. No public callback server is required. Follow the developer console's permission and event-subscription prerequisites; the app does not publish or grant permissions automatically. [Official SDK connection instructions](https://github.com/larksuite/node-sdk), [receive-message API](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive), [send-message API](https://open.feishu.cn/document/server-docs/im-v1/message/create).
3. Obtain the owner's `open_id` **for this application**, using the developer console's authorized API tools or event diagnostics. Enter the `ou_...` identifier, not a nickname, `user_id`, `union_id`, or another application's identifier. The first person who sends a message is never automatically made the owner. Open IDs are scoped to an application. [Official identity documentation](https://open.feishu.cn/document/tools-and-resources/open-api-log-query).
4. In Agent Arcade, select the intended companion and open **Connections → Feishu app bot → Set up Feishu**, or the conversation's channel settings. Save App ID, App Secret and owner open ID. The secret field remains blank on readback; leave it blank to retain the stored secret. Changing the App ID requires that application's secret again. Keys use the existing OS-encrypted vault.
5. Choose an available program/API backend and project directory, then explicitly connect the companion. Saving settings does not connect or call a model. The legacy Claude Channels backend is unavailable for Feishu. After the application reports connected, send a fresh private text message from the configured owner's account.

If Feishu requires a live long connection before saving the subscription, start the configured connection first, finish the developer-console subscription, then send a new message. Do not run another receiver for the same application while testing: the official long-connection service distributes events among connected clients rather than broadcasting them to all clients. A different application is required for each independently operated bot identity.

## Identity, delivery and recovery

`feishu.cjs` verifies `bot.open_id` through the [fixed bot-info API](https://open.feishu.cn/document/client-docs/bot-v3/obtain-bot-info) before opening the connection and again after the handshake. Missing identity fails closed. Reconnect requires the same actual bot. Account ownership is keyed by application plus verified bot; durable inbound deduplication additionally includes the configured owner. Neither the display name nor a renderer-supplied recipient authorizes delivery.

Only schema-2 message events for that application, the exact owner's `open_id`, a user sender and a private chat are eligible. Events received before identity confirmation, outside the current reception window or from other contexts are discarded. Reconnection clears queued messages and invalidates old reply contexts. There is **no historical catch-up**, automatic replay after app restart, or recovery of an old tool approval. Send a new request after reconnecting.

Messages are deduplicated by `message_id`, including across service recreation through SQLite. The in-memory queue is limited to 200 and the seen-message set to 10,000. Overflow closes reception with an explicit problem instead of silently dropping a middle task. Text is bounded before the existing Dispatcher applies its stricter input limit. Quoted approval/control commands and unsupported attachments do not authorize tools; unsupported content produces a fixed explanation to the owner without model execution.

Replies use one fixed private-text operation addressed to the configured owner's open ID. The SDK's asynchronous token acquisition is followed by a final synchronous check of the original connection and reply context. A valid message-ID receipt counts as accepted by the API, not as proof the person read it. A timeout or failure after submission is **unknown**, and no automatic retry occurs. Check the Feishu conversation and local task result before sending another request.

Disconnect aborts pending requests, closes the official SDK connection with reconnection disabled, revokes waiting approvals and discards volatile context. SDK transport retries can restore a current connection; they do not resend failed messages or replay model tasks. Repeated connection failures, changed bot identity and invalid identity responses end the service connection.

## Implementation and limits

The runtime dependency is the official MIT-licensed `@larksuiteoapi/node-sdk` **1.76.0**, pinned with its resolved dependencies in `package-lock.json`. Its downloaded package was approximately 1.71 MB compressed and 30.26 MB unpacked, excluding dependencies. The integration uses the SDK's Client, EventDispatcher and WSClient, with an independent credential cache per companion and raw SDK logging disabled. Dependency license boundaries are recorded in [third-party notices](../THIRD_PARTY_NOTICES.md).

HTTP destinations are fixed to `open.feishu.cn` and four required API paths; redirects are disabled. HTTP response bodies are limited to 1 MiB and request bodies to 64 KiB. Application event content and queues are separately bounded. The SDK owns WebSocket framing/reassembly; the HTTP limit is **not** a claim of a 1 MiB WebSocket-frame bound.

This version does not provide Lark international/custom hosts, marketplace applications, first-sender pairing, group chat, contact management, cards, image/file/voice tasks, proactive Feishu companion activity, or QQ-space features. Messages pass through Feishu and the selected AI service. No real app secret is bundled, and platform/application permissions and API charges remain separate from the open-source app.

## Reproducible checks

From the source checkout, after `npm ci`:

```powershell
node --test test/feishu.test.cjs test/bot-service-feishu.test.cjs test/bot-service.test.cjs test/dispatcher.test.cjs test/journal.test.cjs
```

The 2026-11-06 checkpoint passed **93/93** checks. It includes the official SDK decoding and acknowledging a protobuf event from a real loopback WebSocket server, SDK reconnect/close, fixed HTTP operations, and production service/Dispatcher/SQLite integration. The latter independently reads a temporary file written only after the owner's exact approval; denial and quoted authorization cannot create it. App/bot/owner scope separation, duplicate suppression, identity-fatal disconnection and unknown send handling are covered. Model execution and Feishu HTTP responses are synthetic, and no enterprise account was contacted.

Real acceptance still requires an owner's enterprise application: verified connection, a new owner message and reply, exact tool approval/denial, explicit disconnect/reconnect, and independent confirmation that other senders/groups cannot dispatch. These checks must retain their own account-specific evidence; the local test result is not a substitute.
