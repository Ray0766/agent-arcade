# Messenger Page channel (experimental)

The source implementation connects a **Facebook Page** to one explicitly configured owner through a separate HTTPS webhook relay. It is not a personal Facebook-account login. Real Meta permission approval, production relay deployment and a Page-to-owner round trip are still unverified. Local tests use synthetic identities and no live Graph calls.

## Requirements and configuration

You need a Meta application, a Facebook Page, a Page access token, the intended owner's Page-scoped ID, and a private HTTPS relay under your control. The token must have the relevant `pages_messaging` permission and Page task. Meta's own [Messenger collection](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api) describes these prerequisites, ordinary `RESPONSE` messages and the 24-hour response window. App review/access and subscription requirements depend on the intended deployment; entering credentials is not proof of approval.

In **Connect companion**, select **Messenger Page (experimental)** and open **Configure Messenger**. Enter the App ID, Page ID, owner PSID and HTTPS relay origin, then save the Page access token and the separate relay token. Tokens use dedicated encrypted vault fields. Saving configuration does not connect, deploy a relay, subscribe a Page or call a model. Connect only after the external relay and Meta configuration are ready. The connection verifies the expected Page ID and exact App/Page/owner relay binding; `/me?fields=id` does not independently certify token provenance or App access approval.

The relay's App secret and webhook verification token stay on the relay. They are not entered into the desktop. See the [standalone deployment template](../deploy/messenger-relay/README.md) for the loopback-only Node server, optional Linux service and HTTPS reverse-proxy configuration. The app does not install or enable these templates. Hosting, TLS, secret distribution, operating costs and data retention remain deployment responsibilities.

## Message and permission boundary

Only new, direct text events from the fixed owner for this Page are admitted after the connection's final identity check. A signed event must match both the Page entry and recipient. Other senders, Pages, echoes and non-message events are ignored. Attachments and mixed/unknown wrappers are rejected; URLs are never fetched. A quoted message carries only an empty reference marker, and quoted control/approval commands cannot authorize tools.

Ordinary replies use only the fixed Page `/messages` endpoint, fixed owner recipient and `messaging_type: RESPONSE`. The response window is derived from the admitted, HMAC-authenticated owner's event timestamp. Pulling, acknowledging, reconnecting or changing the clock metadata does not renew it. The window and Page identity are checked again before submission. No message tags, promotional sends, Human Agent exceptions, other recipients or group messaging are implemented.

The service uses the normal Dispatcher and explicit tool approvals. Channel identity is claimed by the verified Page, and journal records are isolated by App/Page/owner. Before any model or command dispatch, the complete batch is durably claimed, then acknowledged to the relay. Only newly claimed messages may run. A missing acknowledgement stops the connection with no automatic dispatch or replay. An inbound ID is hashed before entering the internal task namespace; the original opaque MID is used only for exact relay acknowledgement.

Every outgoing result, approval prompt and cancellation notice is journaled before transport preflight. An accepted API receipt is not proof the owner saw the message. Once a POST is invoked, a timeout, cancellation, malformed response or lost receipt is **unknown**; the app stops that connection and queue rather than automatically repeating it. Local delivery IDs do not provide Meta idempotency. Old unknown sends are not retried after restart or through `/status`.

A newly claimed direct, unquoted `/unsubscribe` from the configured owner immediately stops this channel and pending work, without a reply or waiting for a relay ACK. This is the single exception to ACK-before-dispatch: it only stops local activity, so a slow network cannot allow an older model reply to continue. The unacknowledged batch remains subject to relay expiry and durable deduplication. It cannot cancel a message already submitted before the opt-out was observed.

The stopped state is saved independently of other channels. If that save fails, the current connection still stops and the UI explicitly says restart persistence is unconfirmed; fix local storage before reconnecting. Explicit local resume changes the stopped setting only and does not connect automatically. Quoted text cannot unsubscribe or resume the channel.

## Relay limits and privacy

The relay checks `X-Hub-Signature-256` against the exact raw body with the App secret before JSON parsing. Desktop polling uses a separate bearer secret over HTTPS. A compromised relay can read or falsify content: HMAC does not remove the need to trust and protect that server.

- Incoming HTTP body: 256 KiB and a five-second absolute read deadline; 16 concurrent handler requests.
- Queue: 100 pending projected events and a bounded byte budget; five-minute delivery TTL.
- Deduplication: 10,000 MID fingerprints, retained 26 hours; signed events older than 24 hours are rejected.
- Pull: at most 50 events, no more than one poll per five seconds, one-use 30-second batch tickets.
- Storage: a private SQLite database bound to exactly one App/Page/owner. A relay restart invalidates old tickets but retains queued messages and deduplication.
- Plaintext: removed on acknowledgement or pruning. The standalone entry prunes every 30 seconds while running; stopped processes and external backups require an operator retention policy.

Queue overflow rejects the new transaction instead of evicting unprocessed messages. No raw webhook, Page send token, attachment, quote body or model history is stored on the relay. Verification query strings, bearer headers and message bodies must also be excluded from proxy/hosting logs. The relay is a separate plaintext processor, not an encrypted chat backup service.

## Source and verification status

The candidate Graph pin is `v26.0`, matching the [Meta-maintained Business SDK](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/api.js) inspected on 2026-11-06. This is not a claim that Messenger compatibility or the latest Graph release has been independently certified. Direct Meta changelog, current Messenger overview/webhook and permissions pages returned HTTP 429 during research. The intended App must still verify version compatibility, current access level, review/business requirements and Page subscription permissions before real activation. No OAuth acquisition, token refresh or automated subscription flow is implemented.

Primary contract references are Meta's [official webhook envelope sample](https://github.com/fbsamples/messenger-platform-samples/blob/main/quick-start/app.js), [raw HMAC sample](https://github.com/fbsamples/messenger-platform-samples/blob/main/messenger-api/messenger-api-and-webhooks/app.py), and [HTTPS server guidance](https://github.com/fbsamples/messenger-platform-samples/blob/main/node/README.md). These support individual contracts; the implementation does not copy their source or use old example versions as a current-version claim.

Run local core checks with:

```powershell
node --test test/messenger-relay.test.cjs test/messenger-client.test.cjs test/messenger-relay-entry.test.cjs
```

They exercise actual temporary SQLite files and loopback HTTP: signed webhook → fixed-owner projection → durable claim → exact ACK → synthetic Graph receipt. They also cover restart/replay, quotes, mixed content, signature and identity mismatch, window expiry, late cancellation, lost send/ACK results, slow request bodies, concurrent-request bounds and explicit relay shutdown. The Graph and relay HTTPS URLs are mapped to local fixture servers, with no real Page or public listener. Service and UI integration checks are separate from these core tests. No live Messenger acceptance is claimed.

The core checkpoint passed 32 tests. The final UI fixture passed 13 checks with six inspected screenshots, including both languages, narrow windows and failed opt-out persistence; it uses synthetic state. Existing-room checks and eight fixed IPC/main/service checks also passed. These results do not establish real Meta authorization, a deployed HTTPS certificate, Page receipt, message visibility or a successful model call through Messenger.

The integrated adjacent regression passed 186 tests, covering the real client/service/Dispatcher/journal and existing channel boundaries; a later focused opt-out storage-failure check also passed. The exact local opt-out/held-model case proves that a blocked ACK cannot delay stopping an already running task. Run the service checks with `node --test test/bot-service-messenger.test.cjs` and the synthetic UI fixture with `node scripts/messenger-ui-smoke.cjs`. No production account is required for these checks.
