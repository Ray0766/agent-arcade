# Manual voice to the QQ owner

Source implementation, 2026-11-06. **Type a short sentence → generate locally →
preview → send to the configured owner**, or choose an existing local WAV.
Generation uses the separately configured GPT-SoVITS/Serena installation; it
does not read chat history, record a microphone, give the model a media tool,
process inbound audio or send to groups. Nothing generates, plays or sends
automatically.

The earlier packaged WAV picker, local preview and one explicit owner-directed
send have bounded real evidence. Direct real-model text rendering and an
in-progress cancellation have also passed. The identity-checked text-generation
package has now completed one bounded real UI flow: cancel without sending,
generate again, preview locally, then explicitly send once. On 2026-11-08, the
actual sharing package additionally generated the same short sentence twice,
completed its local preview control, and sent once from Ju to the configured
owner. The ordinary owner's QQ visibly displayed the incoming three-second
voice bubble. This accepts that generated-clip display flow; recipient playback,
human hearing and the earlier WAV-picker recipient display remain unaccepted.
A bridge receipt alone does not establish those outcomes.

## Use

1. Select a connected QQ companion and open **Share voice / 分享语音** in its
   conversation. With [local TTS configured](VOICE_LOCAL_SETUP.md#generate-a-qq-voice-clip-without-asr),
   type a short sentence and choose **Generate voice / 生成语音**. Otherwise,
   or to use an existing clip, choose **Choose WAV / 选择 WAV**. Opening the
   drawer only checks configuration; it does not load a model or open a device.
2. Review the sending character, its QQ account and the configured owner's QQ
   account. Use **Listen locally / 试听** to play the preview. Nothing plays or
   sends automatically.
3. Confirm the send once. **Accepted** means the bridge returned a matching
   message ID; it does not prove the owner displayed, played or heard the audio.
   **Unknown** means the request may have been sent. Check QQ before choosing a
   fresh clip; the old ticket cannot be resent.
4. Optionally expand **Send details / 发送详情** after acceptance to inspect the
   captured QQ identities and message ID. This displays the existing receipt;
   it does not fetch conversation history or confirm the owner listened.

Text generation supports the fixed **Mandarin Serena** voice, up to **120
Unicode code points and 240 UTF-16 units**. Blank text, unsupported control
characters and unpaired surrogates are rejected. Generated audio must fit
**0.2–30 seconds**; overly long output fails in full rather than being truncated.
A character count is not a duration guarantee. The generated result is mono
32 kHz PCM16 WAV. Editing the text invalidates the previous clip, so review the
new generation before sending. Cancel stops generation and retains the typed
text in the open drawer; closing or changing accounts clears it.

While generation is running, the same drawer reports preparation, synthesis and
final checks from the actual local provider. Protocol readiness alone is not
model readiness. Progress is bound to this account and panel; cancelling or
closing stops observation, and late replies cannot overwrite the stopping state
or a replacement panel. No percentage or completion time is estimated. Audio
remains unavailable until PCM validation and the clean request terminal are
confirmed. A successful host can remain idle for up to 30 seconds under the
exact same binding; closing/cancelling it still requires confirmed worker exit.

The 2026-11-06 progress check ran the real configured GPT-SoVITS model through
the production render gate. One short synthetic Mandarin sentence produced
144,684 bytes of mono 32 kHz PCM16 WAV; the render settled in 35.791 seconds,
and independent process inspection confirmed the owned worker absent. The
100 ms observer saw preparation, synthesis and idle; the short final-check
phase fell between samples. This is one local component run, with no microphone,
playback or QQ send, and is not a speed improvement claim. Private receipt:
`outputs/qq-voice-progress-live-20261106.json`. Separate synthetic UI checks
passed 41 cases with 19 screenshots, including single-flight observation,
late progress after cancellation, and panel replacement. Recipient hearing and
hands-free interruption remain separate, unfinished acceptance gates.

The local file input remains deliberately narrow: **mono PCM16 WAV**, 16 / 24 / 32 /
44.1 / 48 kHz, **0.2–30 seconds**, at most **4 MiB**. MP3, AAC, stereo, floating
point WAV and compressed WAV are not converted by Agent Arcade. The original
file is unchanged. Ancillary WAV metadata is removed; this does not anonymize
the sound or a person's voice.

## Short idle reuse checkpoint

The reuse policy is limited to this explicit QQ clip-generation drawer. It does
not change the approved voice, desktop microphone chat, playback, ASR, or the
separate explicit send. Runtime coherence uses local configuration plus file
identity/size/timestamp fingerprints; fixed asset hashes are still checked at
model load. It does not rehash large weights on every UI refresh or treat these
metadata fingerprints as a substitute for asset validation.

The earlier idle-only preflight deferred execution because other Python/GPU
work was present. A later bounded functional run on 2026-11-08 left that work
running and checked available GPU/system memory before both calls. The real
approved model produced two valid 3.02-second WAVs using the same three-process
identity tree; the second call created no new host. Observed renderer time was
33.205 seconds for the first call and 0.646 seconds for the next identical
sentence. These are measurements under competing load, not an isolated A/B or
a guaranteed speedup. The product began closing about 30.016 seconds after the
last render completed; independent checks confirmed all three processes absent,
without proof-assisted recovery stops. Source, approved configuration and
reference-audio hashes stayed unchanged. External process metadata stayed the
same where observable; two executable paths were unavailable.

Separate actual UI evidence covers two generations, the preview control's ended
state, one explicit send and the incoming bubble in ordinary owner QQ. Its
intermediate process observer failed, so complete same-host identity evidence
belongs only to the functional run. Private receipts are
`outputs/qq-tts-warm-functional-contended-feddb550-ed66-4ca5-a60c-077be464d617.json`
and `outputs/qq-voice-generated-owner-actual-20261108.json`. Recipient listening,
hands-free interruption and repeated long-use reliability remain unaccepted.

## Isolation and recovery

- A native main-process picker is the only source of file paths. Fixed IPC
  methods accept an account/panel ID, an opaque send/discard ticket, or the
  explicitly typed bounded text for generation. Renderer-supplied paths, URLs,
  recipients, audio bytes, model/reference options and arbitrary QQ actions are
  rejected. Text is not filled from private chats or model replies.
- One application-wide QQ render operation owns its TTS worker. It does not
  instantiate ASR, inspect/open a sound card, record or play. Completed PCM is
  checked for format, sequential frames, total samples and SHA-256 before a
  canonical WAV can become a preview. After a clean terminal, this QQ-only host
  may stay idle for at most 30 seconds and serve another explicit generation in
  the same account, owner, role, service, connection object/generation, panel and
  local runtime revision. It retains no completed task object or PCM result;
  controllable PCM buffers are zeroed and request references released. This is
  not a claim that immutable Python strings or GPU memory are securely erased.
  A previous draft is invalidated before the next generation. Idle expiry,
  cancellation, scope/configuration changes or close retire the exact host.
  If exit is unconfirmed, cleanup responsibility and the gate stay occupied;
  it does not repeatedly spawn replacement model processes. The existing WAV
  choice remains an alternative
  when TTS is unavailable, not a silent synthesis fallback.
- A ticket binds the registered service, business profile/character scope,
  actual QQ account, owner, role, client object and both service and connection
  generations. Picker, read and generation completions recheck their captured scope. A
  replaced connection cannot adopt an older preview.
- Input is bounded before allocation, read through the same open file handle,
  and checked again against its current identity. Network paths, alternate data
  streams, links and hardlinks are refused. The parser validates RIFF lengths,
  sample layout and at most 64 chunks without a native decoder.
- A preview expires after five minutes. Send consumes it before asynchronous
  work, including a send subsequently stopped by preflight. Login, online state
  and login are checked again before one fixed private `record` request. No
  reconnect, automatic retry or durable replay queue is used.
- Once submitted, timeout, disconnection, malformed receipt or cancellation is
  reported as unknown. Cancellation cannot retract a QQ request. A late valid
  accepted receipt keeps its old account/panel attribution; it cannot update a
  replacement drawer or connection's counters.
- Closing, replacing, hiding, switching accounts, expiry or sending clears the
  local preview and stops its audio element. Preview playback uses `preload=none`
  and a user click. Pending playback promises have their own epoch. Starting
  desktop microphone chat invalidates the preview; choosing a WAV or generating
  a clip closes desktop microphone chat first. Neither starts it automatically.
  Closing or changing scope also aborts owned generation; late audio cannot
  populate a replacement panel. Cancellation is confirmed only after work and
  owned-process shutdown settle. Cancelling generation does not retract a send.
- Typed text and WAV previews do not enter conversation-model context, companion memory, task-success state,
  logs or global snapshots. Snapshots contain bounded metadata, not paths,
  hashes, audio bytes or the preview data URL. Buffers are cleared when possible;
  this is not a cryptographic memory-erasure guarantee.

Agent Arcade does not save another selected WAV or generated preview in normal
use. The opt-in developer probe below explicitly saved its synthetic test WAV.
**NapCat does create temporary
media while decoding the base64 segment and converting it to SILK.** Its failure
paths may retain cache files, and QQ has its own upload/storage behavior. This is
not an end-to-end memory-only promise. The app does not scan or remove arbitrary
bridge caches. A slow upload may exceed the existing bounded request deadline
and become unknown even if QQ later accepts it.

## Official interface and implementation

The interface research uses NapCat **v4.18.42**, official commit
`9335843246e3b7a17944861f3ac8731a259732c2`. The app implementation is original;
upstream code is not included in this feature.

- [`record` schema](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/types/message.ts#L79-L112)
  and [base64 file decoding](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-common/src/file.ts#L409-L435):
  one canonical WAV is passed as `base64://` through fixed `send_private_msg`.
- [PTT construction](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/api/file.ts#L190-L231)
  and [audio conversion](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-core/helper/audio.ts#L6-L15):
  the installed bridge owns SILK conversion and upload. A stock FFmpeg binary is
  not automatically a supported substitute for this native conversion path.
- [`can_send_record`](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/system/CanSendRecord.ts#L12-L22)
  returns a constant positive value. The app does not treat it as evidence that
  the converter, upload or playback actually works.

`src/bot/qq-voice-payload.cjs` validates and canonicalizes WAV bytes;
`qq-media-file.cjs` is the bounded shared local-file reader; `qq-voice.cjs` owns
preview tickets; `QQClient.sendOwnerRecord` implements the fixed request. The
service owns one lazy controller per connection, while main/preload and
`src/ui/qq-voice.js` own picker, panel and playback isolation. The separate
`src/voice/qq-render.cjs` application gate uses `GptSovitsSpeech.render(text,
{signal})` and confirms worker exit before returning bytes. The TTS-only factory
reads three configured paths; it does not require the ASR installation or change
voice/model settings. Existing image and desktop voice routes remain separate.

## Evidence and remaining acceptance

### Text generation checkpoint

- Host rendering plus existing speech regressions: **33/33 Node tests** passed,
  with **six render and six existing playback Python tests** using synthetic
  arrays/fake models. The tests cover split/coalesced protocol frames, bounded
  counts, full-result validation, late cancellation, failed spawning and owned
  process retirement. They do not synthesize or play real speech.
- Renderer generation checks: **33 synthetic checks / 14 screenshots** in
  `outputs/qq-voice-render-final-20261106-ui.json`. They cover the text composer,
  IME input, file alternative, cancellation, stale panels and unknown sends;
  audio/model/QQ operations are simulated.
- Frozen full checkpoint: **1156 tests / 1155 passed / one skipped / zero
  failed**, **208 JavaScript syntax files**. Package
  `dist/single-window-qq-render-20261106/win-unpacked` has **119 source files**
  identity-matched. Build and identity evidence are
  `outputs/single-window-qq-render-20261106-{tests,check,build,identity}` with
  their `.txt`/`.json` extensions. This is not a published release; automated
  checks and the separate real UI evidence below have different scopes.
- One direct real-model probe generated the original sentence
  “晚上好，今天也辛苦啦。” without ASR, audio-device access, playback or QQ.
  The cold call took **30.56 seconds**, including **26.84 seconds** from host
  start to the post-load render-start event and **3.71 seconds** in the render
  phase. The result was **2.26 seconds**, mono 32 kHz PCM16, **144,684 bytes**,
  SHA-256 `456bccfd966ca9719b4a588e03b1d3a8350aa5238667659c70adcb4a4bfb9b2c`.
  Its owned worker exited and an independent process query confirmed the
  original PID/creation identity absent.
- A second real worker was warmed, then explicitly aborted about **50.5 ms**
  after render-start. The render request settled in about **53 ms total**
  (including the delay before abort), returned no audio and its
  original process identity was independently absent; a subsequent check found
  no original worker PIDs or their direct children. These are two bounded
  observations, **not latency benchmarks, hearing confirmation or a guarantee
  of general cancellation timing**. Private evidence:
  `outputs/qq-voice-render-live-20261106.json` and the explicitly saved synthetic
  `outputs/qq-voice-render-live-20261106.wav`.
- The actual **119-source-file package** completed one manual flow in its
  single main window, with the displayed Whale/owner binding. The original
  sentence was “今晚的海风很轻，慢慢休息吧。” First, generation was explicitly
  cancelled: its worker was independently confirmed absent, the text remained
  in the drawer, and bounded owner-history readback found **zero new voice
  messages**. Explicit regeneration then produced a preview displaying **3.0
  seconds / 32 kHz / 189 KiB**; that worker also exited. Local playback showed
  start and end. One explicit send received bridge acceptance, and independent
  bounded history found **one outgoing record, 7,943 encoded bytes**. Private
  receipt: `outputs/qq-render-ui-live-summary-20261106.json`, referencing seven
  screenshots, process-identity/exit records and the bounded history check.
  The UI did not expose a message ID or audio hash, so direct UI-to-history ID
  correlation and exact UI-audio byte identity are **not claimed**. Playback
  state is not human hearing or recipient playback confirmation.

### Earlier packaged WAV flow (preserved)

- Backend and affected image/QQ/service regressions: **140/140** passed,
  4.183 seconds, `outputs/qq-voice-backend-tests-20261106.txt`. Real loopback
  WebSocket frames use synthetic accounts, not real QQ recipients.
- Main/IPC and adjacent lifecycle regressions: **59/59** passed, 281.707 ms,
  `outputs/qq-voice-main-regression-20261106.txt`; includes 15 new voice IPC
  tests for paths/targets, delayed pick/read, connection generation changes,
  panel ownership, truthful outcomes and mutual desktop-voice shutdown.
- Renderer smoke after the pending-playback race fix: **20 synthetic checks / 7 screenshots**,
  `outputs/qq-voice-playbackfix-20261106-ui.json`. Wide, unknown-result and English 430 px
  screenshots were opened for inspection. The harness uses fake audio playback;
  it does not prove a real audio device or QQ playback.

- Full frozen source checkpoint: **1107 tests / 1106 passed / one skipped / zero
  failed**, **205 JavaScript syntax files**. The first full run caught an
  intermediate connection-generation patch before integration was frozen;
  both the failed and final logs are retained. The actual operated package is
  `dist/single-window-qq-voice-playbackfix-20261106/win-unpacked`, with **118
  source files** identity-matched. These automated checks are not QQ acceptance.
- Actual packaged flow selected the existing original synthetic 5.14-second
  Serena WAV, displayed the configured Whale/owner identity, then removed the
  draft. Independent last-five-message readback found no outgoing voice. A
  second selection was explicitly auditioned; the UI observed playback start
  and end. One explicit send returned bridge acceptance, and independent
  bounded history changed from zero to one outgoing voice record (14,395 encoded
  bytes). The UI did not expose its message ID, so exact UI-ID correlation is
  not claimed. Private receipt: `outputs/qq-voice-live-summary-20261106.json`;
  five screenshots and the bounded history record are referenced there.

### Later exact receipt-detail check

In `single-window-qq-actions-20261106`, the identity-checked **119-source-file**
package retained Whale's existing login and operated in one main window. A
previously generated original **2.26-second** synthetic Serena WAV was manually
selected, previewed and explicitly sent once. This was a file-send test, not
another generation or microphone test. Receipt details began collapsed; after
explicit expansion, the displayed message ID was independently matched exactly
to an outgoing voice record in that account's bounded owner-history read. One
separately confirmed image send passed the same exact-ID check. Private evidence:
`outputs/qq-actions-live-summary-20261106.json` and its referenced screenshots and
readback. Account numbers and message IDs remain private.

This adds a bounded UI-to-history receipt check for the later operations. The
earlier render and WAV checkpoints above still did not expose IDs for direct
correlation at their own test time. Exact media-byte identity, recipient display,
recipient playback and human hearing are not established by matching a receipt.

Recipient display/playback and live cross-account draft isolation remain
unaccepted. The owner client requires authentication, which remains deferred.
Browser playback state is not a human hearing confirmation. This is **not a
complete QQ voice workflow acceptance**. The text-to-audio package has the
bounded real UI result above, while recipient acceptance remains outstanding.
Automatic TTS replies/sends and microphone recording are not provided by this
manual media flow.
