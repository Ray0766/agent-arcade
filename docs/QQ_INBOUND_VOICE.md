# Optional QQ voice recognition

Source implementation, 2026-11-06. In **Connect companion → Companion / 相处方式**,
disconnect the selected companion, enable companion mode and **Understand my QQ
voice messages / 听懂我发来的 QQ 语音**, save, then reconnect. The option is off by
default. It uses the separately installed [local Qwen recognizer](VOICE_LOCAL_SETUP.md)
and replies as ordinary text through the selected Claude, GPT or DeepSeek provider.
There is no automatic voice synthesis or new model download.

This route accepts only the configured owner's private friend messages, with
one ordinary voice segment, an observed bounded cache key and source-size
metadata. Groups, other friends, mixed text/record messages, forwarded voices,
record URLs, paths and effects are not accepted. Existing text chat and explicit
outgoing [QQ voice clips](QQ_VOICE.md) retain their separate behavior.

## Processing and interruption

The existing durable message journal claims the original message once before
recognition. A separate loopback connection rechecks the QQ identity, online
status and exact original message, requests the fixed `get_record` WAV conversion,
then verifies identity again. Only base64 WAV data is read; no returned URL or
filesystem path is opened. The app accepts mono PCM16 at 16, 24, 32, 44.1 or 48 kHz,
0.2–30 seconds, no more than 3 MiB, with source metadata no more than 1 MiB.
These are app acceptance bounds, not hard bounds on upstream downloads or codec
work. The bridge may download/cache/convert the recording before replying, and
closing the connection does not cancel its conversion. Unsupported formats fail
explicitly, without bypassing the checks or silently switching to a cloud ASR.

The file recognizer does not open a microphone or sound device and keeps PCM in
bounded memory. Recognized text enters the scoped recent conversation and goes
to the selected reply model; API usage follows that provider. The local model
installation in the application-root `local-voice.json` is shared across roles;
QQ identities, cancellation, conversations and credentials are not. The ASR-only
path requires `asrPython` and `asrModel`, not TTS or a reference voice. Current
dependencies match desktop recognition: Qwen-ASR 0.0.6 and Transformers 4.57.6,
using the installed Qwen3-ASR 0.6B model and configured CUDA environment.

Only one neural recognition owner can run in the application, including desktop
microphone chat. Finish desktop voice before trying QQ recognition. A newer text
message cancels pending transcription and suppresses late output; busy voice
bursts receive one short notice rather than starting parallel workers. Worker
cancellation names its original job, and uncertain exit retains the lease until
that exact process can be confirmed stopped. Recognition has a bounded 120-second
deadline; this is not a latency promise. Failed/uncertain inputs are not replayed
on reconnection.

## Short-lived model reuse

The file recognizer now retains one clean model for **30 seconds of idle time**
after successful recognition. Only the same companion scope, actual QQ account,
owner, connection generation, client/socket, dispatcher and local runtime
configuration can reuse it. Each recording has a fresh job ID and receives no
previous audio, transcript or conversation. A matching clean-job acknowledgement
and explicit finish are required before parking the model. The existing one-shot
recognizer remains as a separate implementation and regression baseline.

Changing binding, sending typed text, disconnecting, entering desktop voice or
expiry closes the exact idle worker. An active QQ recognition is not evicted by
another account or microphone request. Windows speech remains available while
neural recognition is busy. Per-job PCM/waveform buffers are cleared; this is
not a forensic-erasure guarantee for Python or model-library internals. Runtime
metadata checks detect configuration replacement, not every in-place edit of
model weights. Do not replace the installed runtime while it is in use.

On Windows, exit checks cover the spawned interpreter, an optional venv base
interpreter and the exact system console helper. PID, birth time, executable and
parentage must match; unknown branches and reused PIDs are not killed. An
uncertain close retains ownership for retry. App shutdown also waits for that
ownership to close; if it cannot confirm exit, it keeps the main window and asks
the user to retry Quit. There is no name-based termination or automatic fallback
to another worker. Metadata queries can take up to 10 seconds each; conservative
full cleanup can take about 78 seconds. This is a bounded failure path, not a
guaranteed normal stop latency.

The independent process proof is Windows-specific. A forced app/OS crash and
cleanup by a subsequently started app have not been accepted; in-memory
ownership is not a persisted cross-restart recovery record.

## Voice is conversation, not authorization

Transcripts bypass text-command parsing. Spoken `/allow`, `/deny`, publication,
memory corrections/forgetting, reminders and short confirmations cannot trigger
those actions. The task retains an input-kind marker and the model is told it is
an unreviewed transcription. Normal typed commands retain their existing behavior.
The companion still has no file/command tools. Transcript accuracy and what the
model says remain separate from verified app actions.

## Evidence and remaining work

A real local-model probe read the previously generated original 2.26-second
Serena clip “晚上好，今天也辛苦啦。”. It returned “晚上好，今天也辛苦了。”
in **32.618 seconds cold**, then exited. The wording is not an exact match; one
sample is not an accuracy estimate. A separate startup cancellation settled in
212 ms including a deliberate 200 ms pre-abort delay, returned no transcript,
and both exact worker PIDs were independently absent. No microphone, playback,
QQ message, upload or download was used. Private receipt:
`outputs/qq-file-asr-live-20261106.json`. That earlier one-shot implementation
closed its worker after every job. This is not a spoken-interruption test.

A separate, isolated two-job experiment kept the same model weights loaded:
the first request/response took **10,624.492 ms**, the second **354.026 ms** on
that same clip. Both produced the same non-exact wording. GPU allocation was
1,580,769,792 bytes, with 1,895,825,408 bytes reserved. All owned processes exited,
with no microphone, QQ, network or provider API activity. This single ordering
is not a benchmark. It informed the bounded reuse implementation described above;
the earlier running package still uses the one-shot worker. Private experimental receipt:
`outputs/qq-file-asr-resident-live-fixed-20261106.json`.

The formal resident host later processed the original **6.64-second** Serena
reference twice through one spawned worker: **12,296.029 ms** first and
**702.916 ms** second. Both matched the authored sentence exactly and completed
their separate clean-job/finish boundaries. Exact process cleanup took
**4,300.250 ms**, with independent inspection finding no remaining owned PIDs.
This is one repeated synthetic sample, not a statistical accuracy/latency result
or a controlled comparison to the earlier different clip. No microphone,
playback, QQ, provider API or download was used; offline flags are not a network
sandbox. Private receipt: `outputs/qwen-warm-file-model-1793926686169.json`.

The separate inert native check covered ordinary Python plus console helper,
and venv redirector plus base Python plus console helper; both had independently
confirmed absence after close. Its first receipt remained unsuccessful because
the probe's independent readback script failed; that script was corrected and
the old exact PIDs were separately confirmed absent. Neither the termination
rules nor process scope were relaxed. Final private receipt:
`outputs/qwen-warm-python-inert-2026-11-06T00-55-04-346Z.json`.

Protocol, cancellation, journal and UI fixtures are separately recorded in
`WORK_LOG.md`. They use synthetic recordings, messages, account IDs or model
outputs and do not establish a real phone → QQ codec → ASR → AI → QQ conversation.
That complete flow, recipient readability and live cross-account operation
remain unaccepted. The previous hand-recorded desktop voice success and deferred
hands-free interruption are different checks in the
[companion acceptance ledger](COMPANION_ACCEPTANCE.md).

The fixed NapCat 4.18.42 implementation was checked at commit
`9335843246e3b7a17944861f3ac8731a259732c2`:
[voice-event conversion](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/api/msg.ts#L487-L537),
[GetFile](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/file/GetFile.ts#L53-L58),
[GetRecord](https://github.com/NapNeko/NapCatQQ/blob/9335843246e3b7a17944861f3ac8731a259732c2/packages/napcat-onebot/action/file/GetRecord.ts#L24-L49).
Conversion retains the original source-size metadata; it is not the converted
WAV byte length. Our bounded adapter is independently implemented around these
interfaces; it does not replace or copy the upstream codec stack.
