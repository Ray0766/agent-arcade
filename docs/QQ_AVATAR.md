# QQ avatar management

Checkpoint: 2026-11-06. The bounded avatar workflow is implemented. In the
`single-window-profile-editors-20261106` package, Whale's AI remained disconnected
while two explicit uploads changed and restored its avatar. The ordinary
owner's QQ profile card displayed both intended images. This bounded visual
acceptance is separate from the bridge acknowledgement and does not add an
automatic avatar-readback capability.

## Entry and behavior

Select a companion, then open **QQ accounts → More → QQ profile → QQ avatar**.
The account must already be verified online in the selected installation. An AI
connection is not required: this view owns a request-only management connection.
It does not consume chat messages or invoke a model.

Choose a local PNG/JPEG, review the prepared image and actual QQ account, then
confirm once. The native picker supplies the path only to the main process.
Renderer requests cannot supply a path, URL, account override or OneBot action.
The full prepared image is shown without a cosmetic circular crop. Final QQ
cropping and appearance must be checked in QQ itself.

The nickname/signature editor and avatar subview do not share a pending change.
Going back, closing or changing context discards the unsubmitted preview. A
submitted operation cannot be undone by closing the panel. There is no automatic
retry or restoration.

## Image and temporary-file handling

Preparation reuses the image-send reader: local regular PNG/JPEG files, at most
8 MiB and 16 MiPixels, with no UNC path, symbolic link or multiple hard links.
This initial workflow requires a square image; it does not silently crop one.
Decoded dimensions must match the declared image. Animated PNG is rejected.
The prepared PNG has at most a 2048-pixel edge and 4 MiB; ancillary metadata is
removed. The small preview is separately bounded. These are application limits,
not a claim about all formats QQ supports.

The prepared PNG is uploaded using a random private file under the application's
`qq-avatar-uploads` directory. The original selected file is never modified.
This avoids sending the whole image as `base64://` in an error path where the
pinned bridge may log its file argument. It does not mean the bridge or QQ
never stores the image, nor guarantee that every third-party log is private.

Unknown submissions retain their bounded local upload file rather than treating
a timeout as proof that QQ has finished reading it. The explicit cleanup action
removes only verified files owned by this upload store; it does not cancel or
undo a remote avatar change. A full store asks for cleanup instead of silently
removing unknown uploads. Original images and unrelated files are excluded.
If an interrupted local write leaves an unverified or incomplete file pair,
cleanup deliberately leaves it alone. Close the app and inspect its dedicated
upload directory before removing that residue. Such residue can block new
uploads; it is not treated as a successful cleanup.

## Acknowledgement is not visible-result verification

The fixed NapCat 4.18.42
[`set_qq_avatar` handler](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/extends/SetQQAvatar.ts)
returns `null` only after checking that its native call returned zero. Therefore
a matching successful response with explicit `data:null` can establish “Bridge
reported avatar update success.” Missing or malformed data, timeout, disconnect
or loss of acknowledgement cannot establish that result. A consumed preview is
not replayed.

No verified OneBot current-avatar readback contract was found. The application
does not substitute the local role portrait or a cached CDN image as proof.
QQ may resize, recompress or cache avatars; equal source hashes or a successful
upload acknowledgement do not establish remote appearance. The real acceptance
below adds ordinary-client observations of two specific images, not a general
freshness or synchronization guarantee.

## Verification and bounded real-account check

The avatar risk tests passed **30/30**. An adjacent group passed **125/125**,
including **10 actual-main-handler avatar IPC tests**; those counts overlap.
Local fixtures cover file identity, one-use tickets, scope changes, picker
competition, expiry during file preparation, unknown submissions and explicit
cleanup. They do not connect to a real QQ account.

In the packaged check on 2026-11-06, an explicit UI confirmation submitted an
original v1 square PNG after its **1254 × 1254 / 1831 KiB** preview. The bridge
reported success, and the ordinary owner's QQ profile card displayed v1. A
second explicit selection and confirmation restored the original v2 portrait,
shown in preview as **1254 × 1254 / 1907 KiB**. It also received the documented
acknowledgement, and the ordinary QQ profile card displayed v2 together with
the original nickname and signature. This was a manual restoration using the
original local image, not an automatic undo or a downloaded avatar backup.

After each successful upload, the application's private upload directory
contained **zero files**. Closing avatar management reduced its owned management
TCP connections from **one to zero**. These observations do not prove that QQ
or the bridge retained no image elsewhere. No chat, model call, QR login or
credential re-entry was part of this flow. Private evidence is retained in
`outputs/qq-profile-editors-packaged-ui-20261106.json`; real account identifiers
and local user paths are excluded from this document.

The package used for these uploads had the pre-correction full regression of
**2474 tests / 2473 passed / one skipped / zero failed**. A subsequent editor
validation-display correction passed **17 checks / 7 synthetic screenshots**,
with the separate signature regression at **28 checks / 10 screenshots**. Its
corrected package was subsequently opened with the original profile; the real
uploads were not repeated for that display-only change.

The implementation is original and uses the installed bridge's fixed action;
it does not copy the bridge source or add arbitrary remote operations.
