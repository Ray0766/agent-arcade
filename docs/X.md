# X standard Direct Messages

The source integration connects one explicitly identified X account to one configured private owner through the **standard DM API**. Open **Connections → X standard DMs · experimental**, save both numeric account IDs and a separate user token, choose a project/backend, then explicitly connect. Saving does not make any request. It receives plain owner text through the existing task Dispatcher, with approved tools; QQ autonomous companionship is not enabled for X. It does not implement encrypted X Chat, group conversations, public posts, arbitrary contacts, browser automation or a public webhook. Source and local integration checks are separate from platform approval and real account acceptance, which remain pending.

## Credentials and prerequisites

Use a developer Project/App with the required access and a **pre-authorized OAuth 2.0 user access token** for the intended account. The required scopes are `users.read`, `tweet.read`, `dm.read` and `dm.write`. An App-only Bearer Token, an OAuth 1.0 token/secret pair, a password or a browser cookie is not a substitute for this adapter's user-token field. The official [DM quickstart](https://docs.x.com/x-api/direct-messages/manage/quickstart) uses the user token in the Bearer header; [X's OAuth instructions](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token) explain that distinction.

Configuration uses `xAccountId` for the expected signed-in account and `xOwnerId` for its one permitted correspondent. Both are exact numeric strings, not display names or `@handles`; the first message never assigns an owner. `xAccessToken` belongs in the dedicated encrypted vault entry, never in public settings or diagnostics. Saving configuration must not connect, send a message or invoke a model.

This version does **not** perform OAuth login, exchange authorization codes or refresh tokens. X documents a default two-hour access-token lifetime and a separate refresh-token flow. An expired or revoked token requires explicit reauthorization and replacement; saving a token is not proof it is valid. [Token lifetime and refresh](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code).

`GET /2/users/me` must return the configured account ID before the client becomes ready. This verifies the authenticated user, not the originating App, every DM permission, account billing or platform approval. The first DM read can still fail. The [official SDK's user lookup contract](https://github.com/xdevplatform/xdk-typescript/blob/main/src/users/client.ts) requires user-context authorization for this endpoint. There is no fallback to another account or token type.

## Receiving, sending and limits

Normal polling starts at most once every **75 seconds**. Each transaction rechecks identity before and after the fixed owner's conversation; each send checks identity again and immediately rechecks its connection context before POST. Closing aborts pending requests and invalidates the context. The adapter has no automatic reconnect or write-retry loop.

Only new `MessageCreate` events from the exact owner in the expected one-to-one conversation are admitted. Self echoes and events older than the admission watermark are skipped. This deliberately does not replay historical commands, even though X's [lookup API](https://docs.x.com/x-api/direct-messages/lookup/introduction) can return recent history. Attachments, mixed content and unfamiliar event shapes cannot become commands. Referenced content is not fetched; quoted approval/control text is rejected by the existing Dispatcher input rules. File tools retain their normal explicit approval requirement.

| Boundary | Implemented limit |
| --- | --- |
| Identity requests | 75 per 15 minutes. |
| DM reads | 15 page requests per 15 minutes; at most 3 pages of 100 rows and 200 admitted messages in one transaction. |
| Writes | 15 attempts per 15 minutes and 1,440 per day; one active send per client. |
| HTTP and text | 15-second default request deadline including body reads; 1 MiB response; 6,000 UTF-16 text units, at most 24,000 UTF-8 bytes. |
| Local deduplication | 10,000 seen event IDs and 1,000 attempted send IDs per client; full capacity fails closed. Durable service deduplication must additionally use actual account, owner and event ID. |

The request windows follow the current [X rate table](https://docs.x.com/x-api/fundamentals/rate-limits). The app shares one token-free `XRateBudget` per expected self across profiles and service recreation; close and token replacement do not clear it. At most 64 different self identities are admitted per application process. Bounded response reset hints can impose a longer wait. A poll limit waits until that time and remains explicitly disconnectable; a limit during initial connection leaves it disconnected for manual retry. A write refused before submission is not sent or automatically retried, while reception may continue. These local guards do not account for other applications or survive process restart, and do not guarantee a spending cap. Pagination that cannot reach a known boundary within its limit fails without delivering a partial command batch.

A validated send response is API acceptance, not proof that the owner saw it. Once POST was invoked, a timeout, cancellation, malformed receipt or error response becomes `send_unknown`; the consumed local client ID cannot be reused. That ID is not an X idempotency key. Unknown sends must remain unknown and must not be automatically replayed after reconnect or restart. A late valid acceptance remains bound to its original account/owner/context and cannot update a new session.

For X, an unknown send stops the connection, pending permissions and queued tasks. This also prevents the generic Dispatcher's `/status` recovery path from resending an uncertain final reply. The same rule covers approval prompts, cancellation replies and quoted/attachment rejection notices. New connections do not restore old tasks. Durable delivery metadata stores only hashed scope/attempt identity and `attempted`, `accepted`, `unknown` or `not_submitted`; it contains no text, token or API response body. `attempted` means the app began a send including preflight, not proof a POST occurred. An unfinished attempt becomes `unknown` after reopening. Retention is bounded to 10,000 records and 30 days, with failure rather than silent overflow.

## Stop and locally re-enable

The configured owner can send standalone **`/unsubscribe`**; surrounding whitespace is ignored, but added words are not accepted as that command. Quoted or attachment-wrapped text cannot trigger it. The app stops reception and pending replies without sending a confirmation DM, and persists the nonsecret `xOptedOut` flag. Restart, token replacement and changing either account ID do not silently clear it. In the disconnected X settings, **Re-enable X receiving** clears that local flag; it does not connect or send. Choose **Connect** separately when ready. There is no automatic OAuth renewal, charge approval or platform approval implied by this action.

Authorization/permission/credit failures, changed identity and unverifiable protocol/backlog results stop reception with fixed local errors. Do not paste tokens or raw response bodies into reports. If saving the local opt-out fails, the current session still stops and reports the storage failure; repair storage before reconnecting.

## Cost and live-use boundary

As checked on 2026-11-06, X lists DM-event reads at **US$0.010 per returned resource**, DM creation at **US$0.015 per request**, and user reads at **US$0.010 per resource**. Polling and identity checks are not promised free. X describes same-UTC-day resource deduplication; actual eligibility, credits and charges remain governed by its Developer Console. AI-provider costs are separate. [Current pricing](https://docs.x.com/x-api/getting-started/pricing).

Before real automated use, the owner must have requested this interaction and have a working opt-out that stops pending replies before model dispatch. X's [automation rules](https://help.x.com/en/rules-and-policies/x-automation) apply independently of local configuration; their AI-reply approval requirements must be resolved for the intended deployment. This implementation neither obtains nor proves such approval. No live developer credentials, account permissions, paid API request, incoming owner DM or owner-visible reply has been verified for this channel.

## Reproducible local checks

```powershell
node --test test/x-dm.test.cjs test/x-transport.test.cjs test/x-dispatcher.test.cjs test/bot-service-x.test.cjs test/x-channel-ipc.test.cjs test/x-channel-journal.test.cjs
```

These fixtures use synthetic identities and a local ephemeral HTTP server, with no authenticated X traffic. They exercise identity changes, pagination, quota sharing, abort/late responses, unknown writes, response bounds, the production service/Dispatcher/SQLite journal and actual trusted main IPC handlers. Fixtures approve an exact file tool, independently read its temporary output, reject a quoted approval, deny another write, cancel pending approval through opt-out and preserve unknown sends across reopening. These are local implementation checks, not a live X or published-release claim.
