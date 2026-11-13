# Manual images to the QQ owner

Local packaged implementation, with one ordinary-owner image-display flow accepted
on 2026-11-08. The QQ conversation view has a manually operated image-sharing path. It is separate from model tools, autonomous contact and
inbound image understanding. Packaged UI, bridge acceptance and recipient display
are separate evidence; neither synthetic tests nor a bridge receipt establish that
the owner saw the picture.

## Intended flow

1. Select a connected QQ companion and choose **Share image / 分享图片**.
2. Pick one local PNG or JPEG. Review the displayed image, sending character/QQ
   account and configured owner's QQ account.
3. Confirm Send once. An accepted receipt means the local bridge accepted that
   request. An unknown result means it may have been sent: check QQ before
   choosing the file again. The application never retries the old ticket.
4. After acceptance, optionally expand **Send details / 发送详情** to see the
   captured sending QQ, owner and message ID. This only displays the existing
   receipt; it does not query chat history or establish recipient viewing.

The preview is a resized, re-encoded PNG. This is image sharing, not exact-file
transfer. Cancel, changing the selected account or character, disconnecting,
changing saved connection settings, and forgetting credentials invalidate pending
previews. There are no arbitrary recipients, group targets or automatic sends.
The existing inbound text-only policy remains: an incoming attachment is rejected
as a whole and its remaining text is not silently executed.

## Why this first

Explicit image sharing provides a small useful result-sharing flow with the
existing Electron decoder and QQ connection. Compared with manually opening the
QQ account, it keeps recipient selection and the send result inside the same app.
This benefit is a workflow hypothesis until the packaged flow is measured.

[Manual QQ voice](QQ_VOICE.md), including optional local text generation, is a
separate flow with audio handling, Silk conversion and duration checks. Nothing in this image feature
uploads microphone recordings or gives a model a media-send tool.

## Boundaries

- A subsequent source increment adds [bounded manual-send context](QQ_MANUAL_SEND_CONTEXT.md)
  for companion replies. It records submission metadata, not picture content;
  its real quoted follow-up conversation remains unaccepted.
- The native file picker is the only source of local paths. Renderer requests
  contain an action and opaque ticket, not a path, URL, file bytes, destination,
  group ID or arbitrary OneBot action. Picker completion checks the originally
  selected account/service/connection again.
- Input is limited to **8 MiB**, **8192 px per edge**, **16,777,216 pixels** and
  PNG/JPEG. Header dimensions are checked before native decoding. Animated PNG,
  malformed input, network paths, alternate data streams and linked files are
  refused. The opened file's identity is rechecked and the source is not changed.
- Images are decoded, fitted within **2048 px**, and re-encoded to PNG with only
  pixel/palette/transparency chunks. Original text, EXIF and time metadata are
  excluded. Output is at most **4 MiB**; the preview is at most **480 px / 512 KiB**.
  The native decoder is not a security sandbox.
- One in-memory preview lasts five minutes. Its ticket binds the business
  profile, stable character identity, displayed role, actual QQ account, owner,
  service generation, client object and client generation. It is consumed before
  asynchronous sending, even if preflight subsequently prevents submission.
- A fixed `sendOwnerImage` method rechecks actual login, online status and login
  again before submitting one `image` segment to the configured owner. It reuses
  the current socket; it never reconnects to replay this request.
- A matching accepted receipt remains accepted after a later UI change. Timeout,
  disconnect, malformed receipt or cancellation after submission is **unknown**.
  Old results cannot update the replacement connection's counters or preview.
- Images and source filenames/paths are not added to model context, task success,
  conversation memory, logs or the public snapshot. The ordinary snapshot carries
  bounded draft/outcome metadata, not the preview data URL or internal client.
  Preview pixels exist in the UI only for the current explicit review.

Our controller does not save the picture to disk, but NapCat's base64 handler
creates a temporary file and QQ uploads/stores the media. This is not an end-to-end
memory-only promise. The current send deadline is at most 15 seconds; a slow
upload can therefore be unknown. This path has no durable cross-restart manual
image receipt and no automatic retries after an app restart.

## Implementation

`src/bot/qq-media.cjs` owns file validation, canonical preview and single-use
tickets. `QQClient.sendOwnerImage` in `src/bot/qq.cjs` owns the fixed protocol
operation and distinguishes pre-submission failure from uncertain submission.
`BotService` lazily creates one controller per connection using a main-process
`imageFactory`; ordinary Node tests do not import Electron. Service resets abort
and await the old controller before allowing a new one, while leaving the shared
QQ socket under its normal lifecycle owner.

`imageBinding()` is a **main-process-only** read method containing the client and
internal scope. It must never be returned over IPC. The public API uses
`selectImage`, `sendImage`, `discardImage`, `resetImages`, and the metadata-only
`imageSnapshot`. An image receipt increments accepted-send count, not task
completion or verified delivery.

## Official contracts checked

Checked 2026-11-06 against deployed NapCat **v4.18.42** and installed Electron
**45.2.1**. These are interface references; this feature is original code, with no
copied NapCat implementation. It is not a clean-room claim.

- [Private send](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-onebot/action/msg/SendPrivateMsg.ts)
  uses a fixed private context; the inherited
  [send schema](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-onebot/action/msg/SendMsg.ts)
  accepts segments and returns `message_id`.
- [Message types](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-onebot/types/message.ts)
  include file-backed `image` and `record`. This feature exposes only the former.
- [File URI handling](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-common/src/file.ts)
  accepts `base64://` and creates a bridge temporary file. No URL fetching or local
  source path is passed by this feature.
- [Voice conversion](https://github.com/NapNeko/NapCatQQ/blob/v4.18.42/packages/napcat-onebot/api/file.ts)
  performs Silk conversion before voice upload; it remains outside this image flow.
- [Electron nativeImage](https://www.electronjs.org/docs/latest/api/native-image)
  supports PNG/JPEG buffer decoding and PNG output. Its real decoder was checked
  with generated PNG/JPEG images without creating a desktop window.

## Acceptance boundary

`test/qq-media.test.cjs` uses generated pictures, a real loopback WebSocket server
and the production QQClient, with a deterministic image decoder fixture.
`test/bot-service-media.test.cjs` covers lazy initialization, privacy, profile/role
binding, accepted/unknown counts, reset/disconnect/reconfiguration, and stale
completion. The media and adjacent QQ/service regression passed **87 / 87** in
**2,715.8324 ms** (`outputs/qq-media-backend-tests-20261106.txt`, private work
receipt). These do not use an actual QQ account.

A separate local native-image probe verifies real PNG/JPEG decoding, metadata
exclusion, preview resizing and invalid-input rejection with Electron 45.2.1.
All **five checks** passed against the formal module, with no BrowserWindow or
external message (`outputs/qq-media-native-probe-20261106.json`).

The connected QQ conversation exposes **Share image / 分享图片**: select a local
file, inspect its canonical preview and the explicit owner recipient, then
confirm sending. The production IPC and existing voice lifecycle checks passed
**21 / 21** (`outputs/qq-media-main-regression-20261106.txt`). The synthetic UI
smoke passed **14 checks**, with **seven screenshots** covering preview, unknown
outcome, narrow Chinese/English layouts and keyboard access
(`outputs/qq-media-20261106-ui.json`). These are application-flow checks, not
evidence that a real QQ recipient has received an image.

The actual `single-window-media-recovery-20261106` package selected the project's
original Whale portrait through its OS picker, displayed the correct Whale QQ
and configured owner, then sent once after explicit confirmation. The UI received
accepted and consumed the preview. A separate bounded read-only history request
returned one recent outgoing image in that owner's private conversation, with
1,952,730 bytes. No raw history, URL, image payload or credential was stored by
that observer. Private evidence: `outputs/qq-media-live-preview-20261106.png`,
`outputs/qq-media-live-accepted-20261106.png`, and
`outputs/qq-media-live-history-20261106.json`.

At that historical checkpoint, the owner's ordinary QQ client was at its scan-login
screen, so recipient display was **not verified then**; authentication was not
repeated or requested. The later bounded owner-display result is recorded below. Unknown-send non-replay is
covered by loopback/UI tests, not a deliberately induced ambiguous real send.
No incoming image/voice understanding is claimed; outgoing manual voice has its
own evidence in [QQ voice](QQ_VOICE.md).

### Later exact receipt-detail check

The actual `single-window-qq-actions-20261106` package (**119 source files**,
identity checked) retained Whale's existing login, connected its AI through the
account card and opened the conversation only after a separate explicit action,
all in one main window. It sent one image after manual preview/confirmation.
The receipt details were initially collapsed and then explicitly opened. The
displayed message ID was **independently matched exactly** to an outgoing image
in that same account's bounded owner-history read. A separately confirmed voice
send passed the same ID check. Private receipt:
`outputs/qq-actions-live-summary-20261106.json`, with screenshots and the bounded
readback referenced there. No account numbers or message IDs are published here.

This later check establishes UI receipt attribution for these two operations;
it does not retroactively add an exact-ID check to the earlier image flow.
At that checkpoint recipient display/hearing, live cross-account draft isolation
and a deliberately ambiguous real send were unaccepted. The later image-display
result below does not accept voice hearing or those failure/race cases. This was
a local package, not a public release or another model-conversation test.

### Actual owner image display — 2026-11-08

The original-profile `single-window-owner-history-paging-20261107` package was
used with Whale QQ and AI connected. The existing original pink ribbon logo
was selected through the native picker. The first attempt included an unavailable
UI element, fresh observation and a coordinate-based Open click, after which the
image drawer disappeared. No preview or send receipt was observed and no explicit
Send occurred. The exact click target and closing event were not recorded, so
the cause remains unknown; it is not diagnosed as a visibility defect.

The second attempt used Alt+N, entered the same file, inspected the filename and
pressed Return. The same drawer displayed a **1374×1145 / 293 KiB** prepared image,
the correct Whale account and configured owner, and an enabled Send button. One
explicit Send produced bridge acceptance; Send details exposed the correlated
message ID. After closing the drawer, the ordinary owner's existing QQ session
showed the incoming pink ribbon image in Whale's conversation. Its appearance
was visually matched to the original project logo. No private UI screenshot or
conversation body was retained in the summary.

This accepts one actual pick→preview→explicit send→owner-display flow. The
previous failed/uncertain selection is preserved. It does not prove remote image
bytes match the source, a platform read receipt, general media reliability,
real unknown-send recovery, live account-switch races or incoming image analysis.
No new model request or product behavior change was involved. Private receipt:
`outputs/qq-owner-image-actual-20261108.json`.
