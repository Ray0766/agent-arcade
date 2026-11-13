# Manual QQ friend requests

Source checkpoint: 2026-11-06. The connection inbox, fixed OneBot decision,
same-window panel and directory entrance are implemented. The first-owner path
is now integrated across the production UI, temporary management controller and
main-process IPC. The `single-window-owner-friend-20261106` candidate matches
153 source files and passes 1,983 of 1,984 tests (one skipped), with 292 JavaScript
syntax files checked. It has been packaged but not launched; the owner's newer
login-design request is being implemented first. **Real QQ request
delivery, acceptance and decline have not been accepted**. A build or an empty
list does not establish those outcomes. This is not a new published release.

## Use the existing QQ account view

1. Select the intended companion and save its exact QQ account and fixed owner
   binding. Start and sign into that QQ from **QQ accounts**. **The AI connection
   is not required** to receive the owner's first friend request. A historical
   login ID or last-linked avatar is not proof of the current account.
2. Open **QQ accounts → Friends and groups → Friend requests** for that QQ. The
   directory closes and the requests drawer opens in the same window. Opening
   the drawer starts verification and temporary listening directly; there is no
   second Start confirmation. A mismatched account or missing owner binding
   cannot start this session. A failure offers an explicit retry, not automatic
   reconnection.
3. Check the exact account, applicant number and plain-text verification message.
   Choose **Accept** or **Decline** for that one request. Opening or refreshing
   the drawer never decides a request.
4. Read the result. An accepted response means the bridge completed the decision
   call; it is not an independent QQ-side membership observation. If the outcome
   is unknown, check QQ directly. The consumed request is not retried here.
5. Close the drawer when finished. After acceptance, connect AI separately when
   ready. The decision does not start AI or send a greeting.

### Before the first AI connection

The temporary session listens **only for new incoming requests from the saved
owner** after verifying the actual QQ and online status. Other applicants are
filtered before entering its inbox. It does not receive ordinary chat into a
message queue, invoke a model, need an AI key, or automatically accept requests.
There is no offline-history fetch. **Refresh requests** reads the current
in-memory events, so the owner should send the request after listening begins.

Closing or hiding the drawer, changing views, selecting another companion,
changing its configured identity or installation, or beginning an AI connection
ends this temporary management session. Its private rows and receipts are
cleared; old asynchronous replies cannot appear in a new panel. Losing the
connection does not trigger a background reconnect. This first-owner path does
not broaden the fixed-owner chat/task scope.

### With AI already connected

The same entrance continues using the existing verified connection inbox rather
than opening a second temporary listener. It can show the current connection's
friend requests; this does not grant applicants chat or task access.

Only events received while the QQ connection and companion are verified are
collected. The list is explicitly incomplete: it does not fetch offline history,
events emitted before the identity/online handshake, or events during companion
connection setup. **Refresh requests** reads this in-memory inbox; it does not
query a complete remote pending-request list. Closing the drawer clears its
displayed data while the connected service continues collecting eligible events.
Disconnecting, replacing the connection/scope or restarting the app invalidates
the inbox; that does not reject pending requests on QQ.

Accepting a friend does **not** change the configured owner, grant chat/task
access, send a welcome message or let the model decide actions. Outbound friend
requests, bulk decisions, group invitations, deleting/blocking contacts and
general group management are outside this feature.

## Bounds and outcomes

| Boundary | Implemented behavior |
| --- | --- |
| Event scope | Current ready client/socket/generation, exact self QQ, `request.friend`, no group or response envelope. Events never enter the ordinary message queue or models |
| First-owner session | AI remains disconnected; the saved expected QQ and fixed owner must be valid and distinct. Only that owner's new requests enter the temporary inbox. No arbitrary applicant or target is selected by the renderer |
| Freshness | Event time must be no earlier than verified connection time minus one second (whole-second event precision), within five minutes of observation, and no more than 60 seconds ahead. This is a filter, not proof of remote completeness |
| Local decision lifetime | Five minutes from observation, enforced with a monotonic clock; refreshing or duplicate events do not extend it |
| Pending entries | At most 100 per connection; the drawer reports overflow rather than presenting a complete list |
| Duplicate history | At most 256 flag hashes per connection. Hashes are retained instead of evicted to admit replay; conflicting applicants for one flag invalidate it |
| Text/flag | Raw verification text over 2,048 UTF-16 units is rejected. Display text removes controls and is bounded to 500 units. Opaque flags are nonempty, at most 512 units and remain main-only |
| Submission | One decision at a time. A request is consumed before the first await. The fixed call contains only its stored flag and a literal Boolean; no remark, target override or arbitrary action |
| Before write | Changed identity/scope/socket, cancellation, expiry or failed online verification gives `not_submitted` |
| After write invocation | Timeout, disconnect, cancellation, malformed response or a failed action gives `unknown`; no transparent reconnect or replay |
| Accepted response | Matching echo, `status:ok`, numeric zero retcode and null or omitted data. A later panel change does not rewrite a genuine acceptance as failure |

At a pending-list limit, excess events are omitted and overflow is shown; no
historical entries are fetched later. Once the duplicate-history bound is
reached, new flags cannot enter until a new verified connection. The local
five-minute lifetime is not a claim about QQ's own request-expiry policy.

## Private data and lifecycle

The raw frame and opaque flag do not enter global application snapshots,
diagnostic exports, durable journals, companion memory or model prompts. The
renderer receives only a bounded applicant/comment/time projection through the
explicit panel read. It submits a registered profile ID, panel ID, local request
ID and Boolean decision; it never supplies the upstream flag or a friend target.
Neither request text nor flags are persisted by this feature. The upstream QQ
bridge may have its own records; this does not erase or control them.

The connected panel captures the service, role scope, actual QQ/owner,
connection generation, socket and runtime/installation epoch. The first-owner
controller additionally binds the saved expected QQ, fixed owner and temporary
client to the selected profile and freshly verified runtime endpoint. These
identities are checked again before the fixed write. Closing, hiding, switching
views or selecting another companion clears the renderer's rows and receipts
and invalidates the panel guard. Late replies
cannot populate a new panel. An already submitted external action cannot be
undone by closing its drawer, and unknown outcomes remain unknown.

The upstream handler resolves an opaque flag against its native request list.
There is no atomic remote applicant/flag comparison or standard independent
decline readback. Local collision checks do not establish a stronger guarantee.

## Reproduce the automated checks

From the repository root after `npm ci`:

```powershell
node --test test/qq-friend-request-client.test.cjs test/qq-friend-requests.test.cjs test/qq-friend-requests-panel.test.cjs
node scripts/qq-friend-requests-ui-smoke.cjs
node scripts/qq-owner-friend-ui-smoke.cjs
```

The UI commands require the development Playwright Chromium browser. If it is
not installed, `npx playwright install chromium` is a separate browser download.
The fixture uses the production renderer and styles, synthetic IPC responses,
and intercepted local-page requests; it does not open the real app, connect a
QQ account, invoke a model or submit a real decision.

The client contributes 13 actual-loopback transport scenarios. Its adjacent
QQ/social/media/remark/service checkpoint passed **171/171** tests. The formal
UI smoke passed **14 checks / six screenshots**, covering the directory entry,
wrong or unconfigured disconnected accounts, duplicate clicks, replayed rows, unknown outcomes,
late results after close/view changes, expiry, overflow, keyboard focus and
Chinese 430px / English 286 CSS px layouts. Production global CSS is included;
header separation and primary-button text contrast are checked. The six final
screenshots were opened and inspected. This is a scoped check, not a complete
accessibility audit.

The new first-owner production UI smoke passed **19 checks / eight screenshots**.
It covers opening directly into eligibility/temporary listening, fixed expected
QQ and owner matching, no automatic decision, explicit retry after offline
failure, foreign-applicant rejection, one-use accepted/unknown outcomes,
close/new-panel and installation/endpoint/owner/AI-state invalidation, and the
existing connected-mode route. All eight screenshots were opened and inspected,
including Chinese/English 430 px and English 286 CSS px (the layout equivalent
of 150% at a 430 px viewport, not a native Windows zoom test). Close and the
footer remain visible while the contents scroll. The existing connected UI was
also rerun and passed its **14 checks**. These are synthetic IPC/renderer checks,
not actual QQ request delivery or acceptance.

Local, ignored evidence:

- `outputs/qq-friend-request-client-red-20261106.txt`
- `outputs/qq-friend-request-client-regression-20261106.txt`
- `outputs/qq-friend-requests-formal-20261106-ui.json`
- `outputs/qq-friend-requests-formal-20261106-*-wide.png`,
  `-zh-narrow.png` and `-en-286css.png`
- `outputs/qq-owner-friend-formal-20261106-ui.json`
- `outputs/qq-owner-friend-formal-20261106-*-wide.png`,
  `-zh-430.png`, `-en-430.png` and `-en-150pct-equivalent.png`

Real acceptance remains separate: with QQ signed in and AI disconnected, open
the first-owner drawer, observe a new request from the configured owner,
explicitly decide it once and independently check the QQ-side result. Verify
that closing ends the management session and acceptance alone does not start
AI; any later AI connection remains an explicit action and must still reject
non-owner chat/task access. The existing connected-account flow, decline and
reconnect/lost-response behavior also need real evidence. Deferred human
checks stay in the [test stage](COMPANION_TEST_STAGE.md).

## Official contract checked on 2026-11-06

- [OneBot 11 request events](https://github.com/botuniverse/onebot-11/blob/master/event/request.md)
  separates friend and group requests and defines the reported flag.
- [OneBot 11 public API](https://github.com/botuniverse/onebot-11/blob/master/api/public.md#set_friend_add_request-处理加好友请求)
  defines the fixed friend decision; it does not provide a complete pending
  friend-request history endpoint.
- NapCat **4.18.42**, commit
  `9335843246e3b7a17944861f3ac8731a259732c2`:
  [SetFriendAddRequest](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/user/SetFriendAddRequest.ts)
  resolves the reported flag and applies the decision. Agent Arcade always
  supplies an explicit Boolean and omits its optional remark capability.
  [OneBotAction response handling](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/OneBotAction.ts)
  explains why a successful void handler can omit `data`; this does not relax
  the matching echo/status/retcode checks.

The adapter and UI are original implementation around these documented
interfaces, not copied upstream frontend or request-handler source.
