# QQ self-profile

Checkpoint: 2026-11-06. The private controller, request-only management session,
fixed IPC and same-window editor are implemented. With Whale's AI disconnected,
the `single-window-profile-editors-20261106` package passed a bounded nickname
change and explicit restoration, plus an avatar upload and explicit restoration.
The ordinary owner's QQ profile card displayed both temporary and restored
nicknames and avatars. Independent nickname hashes also matched. These are
specific observations, not a guarantee of synchronization latency or all-field
freshness. Earlier signature acceptance and local protocol/UI fixtures remain
separate evidence.

This feature concerns the signed-in QQ account. It does not edit the companion's
local name, portrait, character card, memory or model configuration. The current
source provides separate nickname preview/confirmation and an avatar subview.
Their packaged acceptance is recorded below, separately from the earlier
signature flow. [Avatar handling](QQ_AVATAR.md) has its own limits.

## Same-window flow

1. Select the companion whose saved QQ binding matches the intended account,
   then open **QQ accounts → More → QQ profile**. QQ must be running and verified
   online. Check the displayed account before proceeding. Opening does not
   modify its profile or change the selected companion.
2. Choose **Read QQ profile**. Nickname and signature are observations from the
   verified bridge and may include cached data. Unsupported values are withheld;
   they are not shortened or cleaned into writable originals.
3. Choose nickname or signature editing, then preview the change. Spaces are
   preserved. An empty signature deliberately clears it and has its own
   confirmation wording; a blank nickname is rejected. Nickname confirmation
   explains that QQ also saves the other profile fields read by the bridge.
4. Review the account and exact before/after values, then explicitly confirm
   once. Typing and previewing do not write to QQ.
5. Read the bridge acknowledgement and the separate observation. An uncertain
   outcome has no automatic retry. Read again before deciding on a new change.

Reading establishes a separate request-only management socket, whether the AI
connection is disconnected or already connected. It does not collect ordinary
chat or invoke a model. Closing the view closes only its own socket; it does not
stop QQ, log out, disconnect a companion or undo an already submitted change.
Hiding the window, changing the selected companion, installation or verified
connection also invalidates the panel. There is no automatic reconnect.

## What the result means

| Result | Meaning |
| --- | --- |
| Bridge action acknowledged (signature) | The fixed action received a matching outer OneBot success response. This does not establish a native profile-success result or remote persistence |
| Bridge reported success (nickname) | The fixed action returned native `result:0` inside a matching outer response. It does not prove another client has displayed the nickname |
| Bridge reported rejection (nickname) | A valid native result was nonzero. The request was submitted, so it is not labelled “not submitted” |
| Observed match | One subsequent bounded read returned the proposed field. The observation may contain cached data and does not prove all clients have synchronized |
| Observed different | The read returned another value. It is shown separately from the action acknowledgement |
| Readback unavailable | No usable observation was obtained; this does not erase a known bridge acknowledgement |
| Not submitted | Checks failed before the mutation was invoked |
| Outcome unconfirmed | The action may have reached QQ but its result is not known. The consumed ticket is not replayed |

Internally, a signature acceptance requires `acknowledgement:'bridge-action-only'`;
a nickname acceptance requires `acknowledgement:'bridge-reported-success'`.
UI and integrations preserve those qualifications. An absent/malformed nickname
native result remains unknown, even if the outer response succeeded. Raw native
response data is not exposed. There is no automatic restoration.

## Limits and isolation

- Signature input is limited by this application to 120 Unicode code points and
  240 UTF-16 units. Controls, formatting characters and isolated surrogates are
  rejected. These are local safeguards, not verified QQ platform limits.
- Read and write capabilities are independent. Nicknames have a local
  60-code-point/120-unit bound. Editing requires a supported nickname and a
  supported observed signature; a missing original is not silently replaced.
- A preview ticket lasts five minutes, enforced using a monotonic clock, and is
  consumed before asynchronous submission. Editing discards the old preview;
  closing or changing context also discards the private baseline.
- The controller binds the actual QQ account, runtime and installation,
  endpoint, profile/panel generation and exact client/socket generation. A
  nickname, character portrait or historical association is not identity proof.
- Before writing, the transport checks actual login/status and the observed
  original field (and the signature for nickname changes), then performs a final synchronous scope check. This is
  **not atomic server-side compare-and-set**; another client can change the
  signature between the observation and mutation.
- Timeout, disconnect, cancellation or malformed responses after invocation
  remain uncertain. Later replies cannot appear in a replacement account panel.
  Cancellation is not a remote rollback.
- Profile strings, originals, tickets and native responses do not belong in
  global snapshots, diagnostic exports, persistent journals, model prompts or
  companion memory. The renderer cannot choose a target QQ, URL, token, file
  path or arbitrary OneBot action.

## Nickname is a coupled profile save

The pinned [`set_qq_profile` handler](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/go-cqhttp/SetQQProfile.ts)
requires a nickname but also sends previously read signature, sex and birthday
fields to the native service. Omitting these fields does not turn it into an
atomic nickname-only operation. The application sends only `{nickname}` and
discloses that coupled save in the preview. It does not reconstruct sex from the
public `unknown` label: that label conflates native unknown and private values.
Signature, sex and birthday instead come from the handler's internal read.

The observed signature gate detects missing/changed values in the public read;
it cannot bind the handler's separate internal read. In particular, a missing
internal signature falls back to an empty string. Missing sex/date members
usually throw before native invocation, while present malformed values need not.
There is no proof of atomic preservation of the other fields. The bounded real
check below includes before/after observations; it does not establish the exact
private native sex value from the public projection.

## Avatar is a separate operation

The pinned [`set_qq_avatar` handler](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/extends/SetQQAvatar.ts)
has an upload operation, but no corresponding verified OneBot image-readback
contract was found. Its flexible file input may create bridge temporary files.
The new avatar subview uses the existing safe image reader and a private local
PNG upload. The app's local character portrait is not presented as the account's
current QQ avatar. See [avatar handling](QQ_AVATAR.md) for acknowledgement,
temporary-file and visible-result boundaries.

## Pinned contract and verification

The source review used NapCat **4.18.42**, commit
`9335843246e3b7a17944861f3ac8731a259732c2`, and checked the matching fixed actions
in the previously verified official Node archive without executing it.

[`set_self_longnick`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/extends/SetLongNick.ts)
changes only the signature through a `longNick` string. Its native result is
typed as unknown and forwarded by the action, so an outer acknowledgement is
kept separate from any claim about native success.
[`get_stranger_info`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/go-cqhttp/GetStrangerInfo.ts)
mixes two detail lookups and prefers fields from the first; `no_cache:true` does
not guarantee that every returned field is fresh. Only nickname and signature
are projected, not the broader demographic/native payload.

The earlier signature-only backend and adjacent regression passed **250/250** checks, including
19 controller/transport cases and 14 actual-main-handler IPC cases. The transport
fixtures use the production QQClient over a real loopback WebSocket with
synthetic accounts. Main-process tests use the production panel/controller and
inert runtime/client dependencies. Cases include exact identity, fixed actions,
stale originals, one-use tickets, expiry, cancellation, unknown responses,
cache observations, AI-connected/disconnected sessions and close/late results.

The earlier signature-only production renderer fixture passed **28 checks / 10 synthetic screenshots**,
including the real panel/controller response envelope, edit/re-preview,
signature acknowledgement/readback, account/installation changes, unknown
results, IME, keyboard focus and narrow Chinese/English layouts. The screenshots
also include three first-load QQ-management states. This does not establish a
packaged real-account flow. No real signature was read or modified by these
fixtures, and no model was invoked.

From the repository root after `npm ci`:

```powershell
node --test test/qq-self-profile.test.cjs test/qq-self-profile-client.test.cjs test/qq-self-profile-ipc.test.cjs
node scripts/qq-self-profile-ui-smoke.cjs
```

The UI fixture needs Playwright Chromium. If absent,
`npx playwright install chromium` is a separate development-browser download.
It loads production UI files with synthetic dependencies; it does not control
the real application window or connect to an account.

## Bounded real-account check — 2026-11-06

The local `single-window-self-profile-20261106` package matched **180 source
files** at identity verification, passed **347 syntax checks**, and had a full
regression of **2350 tests / 2349 passed / one skipped / zero failed**. It is a
local package checkpoint, not a new public-release claim.

With Whale's AI disconnected, the actual editor read nickname/signature, edited
only a local draft, previewed, returned with Back, previewed again, and closed.
Independent observations showed the management TCP connection count go from
**one to zero**, with both original profile hashes unchanged. Closing this view
did not require an AI connection or a profile write.

A new read and explicit confirmation then submitted one controlled test
signature. The UI reported **bridge-action-only** and **observed_match**;
an independent read matched the exact target hash while nickname remained
unchanged. A further new read, preview and explicit confirmation restored the
original signature. The UI again separated acknowledgement from the matching
observation, and independent readback matched the baseline. The observed
signature lengths were **3 → 10 → 3 code points**; real values and account
identifiers are excluded from this public document.

Private evidence is retained in `outputs/qq-self-profile-live-readback-20261106.json`
and the separate open/closed socket receipts. The independent readback helper
performed no writes; the two mutations came from explicit UI confirmations.
No messages or model calls were part of this acceptance. This does not prove
cross-client synchronization, freshness of every returned field, native
acknowledgement semantics beyond the documented bridge response, all-account AI
connectivity, or long-term stability. That historical package did not support
nickname/avatar writes; their later acceptance is recorded separately below.

A later read in the ordinary owner's QQ client displayed Whale's original
signature after restoration. This adds one other-client observation of the
restored value only; the intermediate controlled test value was not viewed
there, and synchronization latency or all-field freshness remains unmeasured.

## Bounded nickname and avatar check — 2026-11-06

The `single-window-profile-editors-20261106` package was used for all four real
writes in this check: two nickname submissions and two avatar uploads. With
Whale's AI disconnected, an initial profile read, nickname draft and close made
no submission; independent hashes stayed unchanged.

A new read, preview and explicit confirmation submitted one controlled test
nickname. The UI reported native `result:0` as **bridge-reported-success**,
separately from **observed_match**. The ordinary owner's QQ profile card then
displayed that nickname. A further new read, preview and explicit confirmation
restored the original nickname; independent hashes and the ordinary QQ profile
card both matched the original. Signature and observed sex/birthday hashes
remained unchanged throughout. Those public observations do not prove the exact
private native sex value or atomic preservation by the bridge's internal read.

Two separate avatar confirmations uploaded an original v1 portrait and restored
the original v2 portrait. Each received the documented bridge acknowledgement,
and the ordinary QQ profile card displayed each intended image. The final card
also showed the original nickname and signature. See [QQ avatar management](QQ_AVATAR.md)
for dimensions, temporary-file checks and the limits of that visual observation.
There was no chat, model request, QR login or credential re-entry in this flow.
The private packaged receipt is
`outputs/qq-profile-editors-packaged-ui-20261106.json`; real profile values and
account identifiers are not published here.

The nickname checks passed **44 tests**, avatar risks **30**, and an adjacent
group **125**, including **10 actual-main-handler avatar IPC tests**. These
groups overlap and must not be added. Before the later UI correction, the full
regression was **2474 tests / 2473 passed / one skipped / zero failed**.

After this real flow, a display-only fix removed the erroneous red validation
border on the empty editor after a successful submission. It passed **17 UI
checks / 7 synthetic screenshots**; the separate signature regression passed
**28 checks / 10 synthetic screenshots**. The corrected package
`single-window-profile-editors-fixed-20261106` was subsequently opened with the
original profile. The four real writes above belong to the earlier package;
they were not repeated for the display-only correction. No platform,
group-management or remaining nine-item acceptance gate is completed by these
checks.

The adapter is original application code; upstream implementation was not copied.
NapCat's [restricted license](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/LICENSE)
remains separate from this repository's license. See the
[QQ integration inventory](QQ_INTEGRATION.md) for the wider scope and unfinished
capabilities.
