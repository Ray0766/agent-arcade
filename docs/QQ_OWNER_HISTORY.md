# QQ owner message history

The **QQ accounts → selected companion’s More → QQ message history** entrance
opens a private reading, on-demand image-preview and manual-text surface in the
existing app window. **Read recent messages** explicitly reads that companion’s conversation with its configured
owner. The companion’s QQ must be online and independently verifiable; the AI
may stay disconnected. Opening the panel does not read messages or connect AI.

This is original app presentation, not SSQQ preference migration or a full QQ
client. The existing Chats view contains the model thread; this view reads the
QQ bridge’s observed history. A QQ reply or a history row does not prove agent
task success.

The subsequent [manual-send context increment](QQ_MANUAL_SEND_CONTEXT.md)
records only explicitly submitted app-send metadata for companion replies.
It does not import history rows or the manually typed body into memory.

## Reading and scope

- Each explicit query requests at most 20 messages. **Older page** queries a
  captured position; **Newer page** visits an already-read page without a new
  request. A traversal is bounded to 10 pages. No continuation position means
  that another page was not established, not that the history is complete.
- Only the selected companion’s configured owner conversation is supported.
  The renderer cannot supply another recipient, bridge, count, action or native
  message ID. Main-frame IPC reuses the existing management capture and current
  runtime verification. Login/status and owner friendship are checked around
  each bounded read on a separate request-only connection.
- Incoming rows must identify the owner, outgoing rows the companion, and all
  rows the expected private/friend account. Groups, other senders and ambiguous
  older-page sequences are rejected. The fixed action identifies the requested
  peer; outgoing rows do not independently return their recipient. This is not
  an atomic server-side identity snapshot.
- Text remains text. Supported single-image rows offer **View image** only after
  an explicit history read; the initial read does not load image bytes. Voice,
  cards, files, quotes, forwards and unsupported image rows keep placeholders.
  Original media URLs and local paths never enter the renderer. An explicit
  image preview can return a bounded, decoded PNG data URL from main; the
  renderer does not fetch the remote source. Text is a bounded display
  projection, not a byte-exact export of the original message.
- Closing, hiding/minimizing, changing account or changing the relevant runtime
  scope aborts and clears this view. Pending reads and delayed reopen work
  cannot restore the old account. History is not written into application
  snapshots, companion memory or persistent message storage.
- **Spacing** changes this app’s reading view only. Comfortable/compact is the
  sole stored preference. Both retain the existing 17px heading, 14px message
  text and mist-pink styling.

## Fixed upstream contract

The implementation was checked against NapCat 4.18.42, commit
`9335843246e3b7a17944861f3ac8731a259732c2`:

- [GetFriendMsgHistory](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/go-cqhttp/GetFriendMsgHistory.ts)
  accepts the fixed owner, count and cursor. A missing cursor reads the latest
  list; an observed short message ID resolves through an in-memory map before
  calling native history. An empty native list can produce an action error,
  which is never converted into successful empty or complete history.
- [Message conversion](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/api/msg.ts)
  produces self/user/sender IDs, private/friend metadata and native `real_seq`.
  Normal `time` is seconds; its missing-native-time fallback uses `Date.now()`.
  This view does not guess units: an unusable seconds value shows an unknown
  time. It does not silently reinterpret it as milliseconds.
- [Native service](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-core/services/NodeIKernelMsgService.ts)
  can include the anchor itself. The projection omits the anchor and accepts
  only strictly earlier observed sequences for an older page. The two direction
  flags are true only when an anchor is present; a recent read keeps them false.
  The native signature names a boolean queryOrder but does not formally define
  both directions. Real bounded paging on the fixed installation is recorded
  below; it is not a guarantee for other versions or all history.
- [Message ID map](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-common/src/message-unique.ts)
  is bounded process memory. A cursor can become unavailable; the user must
  explicitly read recent messages again. A zero short ID can be displayed but
  cannot be a paging anchor because the fixed action treats zero as latest.

Ordinary history reads fix `disable_get_url:true`, `parse_mult_msg:false` and
`quick_reply:false`. These reduce bridge work; they do not guarantee that native
conversion performs no network/cache lookup. This is not an offline history
source. Fixed official method bodies were exercised with inert native APIs to
check field/time production and parameter forwarding; they were not installed
or executed as a QQ plugin.

## On-demand image preview — 2026-11-08

After **Read recent messages**, choose **View image** on an eligible row.
The existing drawer displays the image; **Back to messages** preserves the
already-read pages and manual text draft. QQ must remain online with the same
verifiable companion/owner binding; AI can remain disconnected. Opening the
panel, reading pages and navigating cached pages do not download image bytes.
Viewing an image does not send it to a model or add it to companion memory.

This increment supports a message containing **one image and optional text**,
with a supported PNG/JPEG source of at most 8 MiB. Multi-image messages, mixed
media and missing identity/size metadata remain placeholders. Unsupported
source formats or URLs discovered on explicit view produce an error.
Main decodes and normalizes the selected image to PNG, with each dimension at
most 2,048 pixels and output at most 4 MiB. This is a display conversion, not a
byte-exact image export. Voice playback, files, video and arbitrary attachments
are not part of this increment.

For preview access, Read results contain only random `pageId` and `imageId`
handles alongside the existing text projection. On explicit
view, main repeats a bounded history query for the **fixed owner** and captured
short message ID, with both reverse flags true and `disable_get_url:false`.
It matches the captured message ID, sequence, time, sender and image/text
metadata before taking the source URL. The private-history action supplies the
peer authority: a self-sent `get_msg` result has no recipient field, so this
implementation does not use it to infer the owner. It never falls back to the
filename-keyed `get_image` cache.

The existing fixed-source downloader enforces approved HTTPS resource shapes,
public addresses, TLS validation, byte limits, no credentials and no redirects.
After download, another fixed-owner query must still identify the same message
and resource. A missing anchor, changed resource or invalid response fails
explicitly. These reads are not an atomic server snapshot; the initial page
without a URL cannot establish immutable source bytes from an earlier time.

The three additional, main-frame-only IPC routes are:

- `qqOwnerHistoryImagePage({accountId,panelId,pageId})` selects an already-read
  page locally. A successful Read selects its returned page automatically.
- `qqOwnerHistoryImagePreview({accountId,panelId,pageId,imageId,requestId})`
  performs the explicit preview. It returns the same correlation fields plus
  verified companion/owner IDs and `preview:{mimeType,dataUrl,width,height,bytes}`.
  Only canonical `image/png` data reaches the renderer, never the source URL,
  token, local path or private descriptor.
- `qqOwnerHistoryImageClose({accountId,panelId,pageId,requestId})` cancels that
  request only; an old close cannot cancel its successor. Whole-panel closure
  still uses the existing history close route.

Main captures the selected profile, actual account, configured owner, bridge and
runtime generation. Each asynchronous boundary rechecks the current scope.
Opaque handles expire after five minutes and refresh invalidates old pages.
Back, page change, panel close and scope retirement cancel pending work; a
successor waits for the prior preview's resource cleanup before downloading.
The renderer also checks full correlation and PNG dimensions before display.
Mutable download/decoded buffers are cleared on completion or cancellation;
this is not a guarantee of physical erasure of immutable display strings.
The existing text projection, paging direction/sequence checks, composer
submission semantics and input limits remain unchanged.

Production integration passed 498 targeted and adjacent checks; the renderer
passed 12 checks/seven screenshots, with 824 tracked inputs stable. These are
component/renderer evidence, not operation of the user's main window.

A separate, read-only real component check on 2026-11-08 used the previously
observed outgoing image in the configured owner's conversation. Production
history/source code, the real CDN and Electron's native decoder returned a
**1,374 × 1,145 PNG, 300,355 bytes**; visual inspection matched the original pink
ribbon logo. The private receipt is
`outputs/history-image-component-live-20261108/receipt.json`. No message or
model request was sent, and the running main application was not operated.
Subsequently, the packaged **single-window-history-pictures-20261108** was
operated in the original home/profile. Whale's configured-owner history was
read explicitly; the image row opened the same pink ribbon logo in the existing
window. Back returned to the same page with that image row visible; closing
returned to the QQ overview. The manual composer stayed empty and no message
or model probe was sent. This was a real QQ/CDN/main-window preview, separate
from the preceding helper and synthetic renderer checks. The private delivery
receipt is `outputs/history-pictures-delivery-20261108.json`.
This one outgoing-image result does not establish all history, incoming images,
other formats, model understanding or long-term source availability. Earlier
history and composer acceptance/failure records below remain separate.

```powershell
node --test test/qq-history-image.test.cjs test/qq-owner-history.test.cjs test/main-qq-owner-history-ipc.test.cjs
node scripts/qq-history-image-ui-smoke.cjs outputs/qq-history-image-ui
```

## Validation and limits

Implemented in `src/bot/qq-owner-history*.cjs`, `src/ui/qq-owner-history.*`, and
the existing main/preload/index/runtime entrances.

```powershell
node --test test/qq-owner-history.test.cjs test/main-qq-owner-history-ipc.test.cjs
node scripts/qq-owner-history-ui-smoke.cjs outputs/qq-owner-history-ui
```

The initial production-source targeted run passed 15 checks (343.6129ms): real
loopback WebSocket with synthetic QQ rows plus actual main registrations and
lifecycle handlers in an inert Electron VM. The full production-index browser
run passed 11 checks / 8 screenshots: entrance, loading, empty/failure,
pagination, 430px layout, account switching, and delayed close followed by
account/page/visibility change. These are component and renderer evidence,
not real QQ acceptance. Earlier work-only runs are retained separately.

Two real failures remain recorded. An original-profile run of
`single-window-remote-maintenance-20261107` read 20 recent rows but its Older
request failed with generic connection-change copy; the underlying code was not
captured and no actual disconnection was established. Later predefined cursor
and sequence diagnostics retained the same refusal predicates, timeout and
request flags. Their 19 production checks and 19 renderer checks/10 screenshots
were classification evidence only. In the subsequent composer package, the real
Older failure was explicitly observed as `history_page_newer`.

The minimal follow-up changed only the two flags on an anchored request to true;
recent reads retain false. It preserved the short-ID anchor, strict earlier
sequence verification and refusal without fallback. Thirty-eight production
checks passed. On 2026-11-07 the actual original-profile
`single-window-owner-history-paging-20261107` then read **20 recent rows → 19
older rows → 16 older rows**, returned to page 2 with 19 rows, and explicitly
refreshed page 1 with 20 rows. Observed speaker direction and time projection
matched, and the panel closed to the overview. The ordinary owner's QQ also
displayed the earlier manual composer test message; that separate delivery
observation is detailed below. Old failure receipts are preserved, not replaced
by the passing run.

This accepts bounded three-page navigation on the tested fixed installation.
**Not yet accepted:** completeness of history, cursor behavior across a real
reconnect, other bridge versions, and broader multi-contact/media/browser flows.
The paging package was actually operated, but did not rerun the full regression
or isolated desktop smoke; the preceding composer package's smoke remains a
separate result. No voice-interruption or long-term account-stability requirement
is closed by these checks.

## Manual text from the companion account

The same panel has **Message owner → Send**. It sends from the selected
companion's QQ account to that companion's configured owner, even with AI
disconnected. Opening the composer only registers its local panel scope; it
does not read message history, contact a model, or open a network connection.
A first explicit Send opens the independently owned management connection and
rechecks the actual QQ identity, online status, and owner friendship.

Only plain text, up to 4,000 UTF-16 code units, is supported. Enter inserts a
newline; there is no implicit Enter/IME send shortcut. This is a manual action,
not an autonomous-social action or an inbound AI reply. The renderer cannot
choose a recipient, group, action, URL or token. All such values come from the
main process's existing selected-account binding. This uses the pinned
[SendPrivateMsg](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/msg/SendPrivateMsg.ts)
and [SendMsg](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/msg/SendMsg.ts)
contract: fixed private peer, one text segment, auto_escape:true, and a
correlated short message_id. It does not fabricate an inbound context token
or import upstream implementation code.

The result has three distinct meanings:

- **QQ accepted this submission:** a valid correlated bridge receipt was
  observed. This does not establish delivery, a read receipt, or task success.
  A later explicit history read can separately find the same message ID and
  text. Cached pages from before submission are not a new confirmation.
- **Send result unconfirmed:** the operation may have been submitted. The
  original text stays visible; same-text Send is disabled. **Check this
  submission** only queries the existing local receipt and never sends again.
  Check the owner's ordinary QQ before deciding what to do next.
- **Not submitted:** the application did not cross its conservative write
  boundary. The editable text remains. A new explicit Send has a new ID.

Each submission ID is one-use for one exact panel/account/owner/text binding;
a duplicate click or replay returns the original result, while conflicting
text is rejected. Even after a reconnect, reusing the old ID means *querying
that original attempt*, not sending again. Close, hide/minimize, account
switch and relevant configuration changes retire the admitted panel. A
delayed send from a closed panel cannot reopen it. Closing cannot recall an
already submitted message. A late known bridge receipt remains a fact, but
cannot restore a closed view or put text into another account's page.

Drafts and displayed messages remain in this view only. Main retains bounded
submission metadata and a text digest, not a plaintext message queue, in
process memory. It does not add manual text to model history, companion
memory, snapshots or localStorage. Up to 1,024 submission records are retained
without evicting unknown results. At capacity, no further write is attempted:
check outstanding messages in QQ before restarting the app. Restart loses
these local receipts and does not replay them. Receipt queries still require
the same currently verifiable account scope; there is no offline recovery
promise or durable exactly-once guarantee.

Public component checks:

```powershell
node --test test/qq-owner-composer.test.cjs test/qq-owner-history.test.cjs test/main-qq-owner-history-ipc.test.cjs
node scripts/qq-owner-composer-ui-smoke.cjs outputs/qq-owner-composer-ui
node scripts/qq-owner-history-ui-smoke.cjs outputs/qq-owner-history-ui
```

These use synthetic bridge accounts and an inert main-process VM, plus the
actual renderer in a browser. Production composer and adjacent targeted checks
passed 93/93, with 367 inputs stable; composer UI passed 13 checks/seven images
and adjacent history UI 19 checks/ten images. These are separate from real QQ.

Actual acceptance on 2026-11-07 used the composer package with Ju QQ online and
AI disconnected. Opening required no prior history read. One explicit plain-text
test message moved from pending to bridge accepted; a new explicit recent read
then found its same ID and text. The already logged-in ordinary owner's client
was subsequently observed displaying that incoming message, with its owner
identity checked. This is one real manual delivery observation, not a protocol
read receipt or a general delivery guarantee. It used no model request and does
not establish agent-task success. Original home/profile and saved keys were
retained without re-entry.

Real reconnect/unknown-result recovery and broader reliability remain separate
acceptance gates. Nothing here expands sending to other friends, groups,
autonomous activity, attachments, or new AI permissions.

