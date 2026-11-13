# Manual QQ client in the same window

Open **QQ accounts → Local components → Manual QQ client** for a signed-in,
app-managed local QQ account. The local development build embeds the fixed SSQQ
browser client inside the existing Agent Arcade window. It does not install or
enable the SSQQ plugin, start QQ, or connect an AI automatically. Bounded real
contacts, owner-text delivery and preference reopening have passed; see the
verification scope below.

## Prepare and open

1. Obtain `napcat-plugin-ssqq.zip` from the official
   [SSQQ v3.5.2 release](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/releases/tag/v3.5.2).
2. Choose that ZIP in the client entrance. Preparation checks the exact archive
   and static file identities; a different release or modified archive is refused.
3. Select **Open client** beside the prepared files. Preparation alone does not
   connect the client. The package manifest displays `3.5.2-3`, which belongs to
   release tag `v3.5.2`.
4. Use the client within the reserved area below Arcade's header. **Close** or
   Escape closes this client, not the QQ account. A confirmed native close clears
   the old selection; refresh the prepared-file list before opening again.

The fixed archive is 6,118,730 bytes, SHA-256
`82b9ef50f7e4ddb92a07149d763f7ce98502d24ac73ce8039499b24b25df1c04`.
The app accepts a local selection rather than silently downloading or executing
the plugin entry point. Existing SSQQ browser data is not imported.

## Account authority and data

This is a **manual account client**, not a read-only view or an owner-only inbox.
Its upstream controls can act on the selected QQ account, including other
contacts and groups. Initial loading also requests account data such as friends,
groups, cookies and recent/Qzone information. Open it only when that manual
account access is intended.

The embedded page's responses are not supplied to the AI or copied into Arcade
snapshots. Its actions do not expand AI permissions or change the configured
owner. An already running AI connection remains a separate consumer of its own
authorized account events; opening this page does not suspend that connection.

SSQQ uses a separate persistent local browser profile for the selected app
profile, QQ identity, installation and connection. Browser preferences such as
language remain there; they are not App/QQ companion memory. The OneBot
credential stays in the main process and is attached only to the captured local
socket. It is not exposed as a page password or URL parameter.

## Appearance and limits

The surrounding Arcade controls retain the original fonts, sizes and mist-pink
appearance. SSQQ uses its own native pink preset and follows Arcade's day,
night or system selection; its original interface and language setting remain.

The operated media package adds bounded static avatars and message pictures to the
verified frontend assets and selected owned OneBot WebSocket. It accepts only
known image URL shapes on `q1.qlogo.cn`, `p.qlogo.cn`, `gchat.qpic.cn` and
`multimedia.nt.qq.com.cn`. Only the current view's image requests can obtain a
short-lived one-use read; scripts and fetch requests cannot use it as a general
network proxy. Main checks public DNS, TLS/peer identity, dimensions and the
8 MiB limit, without browser cookies or QQ/AI credentials. Requests have a
15-second bound and at most four active downloads.

Static PNG/JPEG display does not add GIF/video support, uploads, file downloads,
maps or unrestricted remote resources. Old message links can expire. New windows,
downloads and browser permission requests remain blocked. Closing cancels owned
image work and waits for its socket closure; failed cleanup remains explicit.
Already decoded browser pictures can be reused in that view; no complete
Chromium/GPU memory-erasure claim is made. See the active scope for whether this
capability has reached a particular operated package and acceptance scope.

“Page loaded” confirms frontend loading, not QQ connectivity or a message's
delivery. Switching account, leaving the QQ page, hiding the app or invalidating
the account connection retires the client. If cleanup is unconfirmed, the shell
keeps an explicit close retry instead of claiming closure or opening a replacement.
It does not automatically retry a manual QQ action.

## Verification and license boundary

The media source increment passed 12 checks with the original fixed frontend in
real Electron and synthetic OneBot/TLS peers, plus a bounded settled-night
capture. Two real Tencent avatar reads separately returned JPEG/PNG and closed
their owned connections. Those component results remain separate from real QQ acceptance.

In `single-window-ssqq-media-20261108`, actual same-window use displayed the
owner and Ju avatars, a previously received original character picture and its
enlarged preview. Closing returned to the account overview, with both Ju/Whale
QQ and AI still connected and independently online/good. No new message/model,
upload or group action was used. This does not accept all upstream media, other
accounts, expired image links or long-term stability. The package still contains
an obsolete blocked-picture footer. The later QCE-adapter package includes the
correction, verified in its actual entrance; this copy check does not repeat
the earlier media workflow.
Private receipt: `outputs/ssqq-media-delivery-20261108.json`.

The earlier text/language result below remains at its own execution point.

Separate checks cover the Session with temporary files and loopback sockets
(39 passed), the native View (seven passed), original frontend loading in isolated
Electron (16 checks/three screenshots), and the integrated Arcade shell with
synthetic IPC (11 checks/four screenshots). The native check exercised
light → dark → light, retained language and Escape closure. These are distinct
execution points, not a combined real-account result.

In `single-window-ssqq-client-20261108`, nine actual checks and 17 screenshots
(one previous-package baseline) cover Ju's real contacts/history, one manual text
visibly received in ordinary owner QQ, language retained across explicit view
reopening, restoration to Simplified Chinese, and native Escape/explicit Close.
Independent established sockets returned from three to the original one while
the existing AI connection remained; Whale stayed at one. Four encrypted vault
hashes were unchanged. This required no new scan, key entry or model request.
External avatars/images visibly failed under the stated restriction. Media,
file and group operations, other accounts, repeated reliability and preference
survival after a full app/OS restart are not accepted by that check. The actual
window stayed in system-dark; light/dark transitions belong to isolated evidence.
Private receipts: `outputs/ssqq-client-delivery-20261108.json` and
`outputs/ssqq-client-actual-ui-20261108/receipt.json`.

The fixed [SSQQ frontend source](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/tree/v3.5.2)
is AGPL-3.0-only; its small NapCat wrapper has a separate MIT license. Arcade
hosts the selected original frontend separately and preserves its notices and
source provenance. No upstream frontend source is relabelled as Arcade MIT
code. This separation is not a claim that downstream redistribution has no
license obligations. See [integration scope](QQ_INTEGRATION.md) and
[current acceptance boundaries](ACTIVE_GOAL.md).
