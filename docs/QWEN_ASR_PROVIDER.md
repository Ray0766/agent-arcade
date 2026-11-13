# Optional local Qwen ASR provider

This provider adds manual **Start → Finish → review text → send** recognition and an explicitly enabled **hands-free headphone** mode while retaining the existing Windows speech provider. It is an optional module, not an automatic installer or a replacement for account/model routing. The application must explicitly select it. Continuous segmentation and interruption signaling are implemented and tested with synthetic input; this is not a claim of accepted human recognition or spoken interruption. No acoustic echo cancellation is supplied.

## Integration contract

```js
const {QwenAsr, QwenSpeech} = require('./voice/qwen-asr.cjs');
const speech = new QwenSpeech({
  asr: new QwenAsr({pythonPath: absolutePythonExecutable, modelPath: absoluteModelDirectory}),
  playback: selectedPlaybackProvider,
});
```

The injected playback provider implements the existing `speak`, `stopKind`, `interrupt`, `close`, `capabilities`, `diagnostics` and playback events. It can be WindowsSpeech or another explicitly selected provider. When it supplies `warmup({signal})`, explicit Start runs that in parallel with ASR startup; capability checks never warm models. A warmup failure stops ASR, and recognition is withheld from the conversation until warmup succeeds (only the current utterance can be buffered). Both operations share cancellation. A playback failure does not silently change voices or recognition engines. Create one instance per voice conversation/account scope and close it on panel/account replacement, as with WindowsSpeech.

`QwenSpeech` implements the current `VoiceConversation` interface. `listen({mode, locale, signal, onListening, onTranscript})` begins only on an explicit user action. `mode` defaults to `push-to-talk`; only explicit `hands-free` enables automatic turns. The existing `continuous:true` flag is not treated as authorization for hands-free mode. The caller must retain its explicit headphone confirmation. `capabilities()` reports `handsFree:true`, `manualReview:true`, `maxCaptureSeconds:60`, `maxHandsFreeSeconds:600` and `maxSegmentSeconds:20`. The ASR supports explicit hints `zh-CN` and `en-US`; composed capabilities intersect these with the selected playback provider's enabled voice locales. For the current Mandarin-only Serena playback, only `zh-CN` is offered.

Capability checks start a hidden worker and inspect local package/model availability; they do not load the GPU model or open input. They are not proof the selected microphone supports 16 kHz. On Start, the worker loads its local model, opens PortAudio's current default input at 16 kHz mono PCM16, then emits `listening`. In manual mode, Finish stops and closes the input before acknowledging `microphoneClosed:true`, draining queued frames, and transcribing. Only a final manual transcript from the current request after that closure can reach the conversation. Review remains the conversation's responsibility; no model reply or QQ message is requested before the user confirms it. In explicit hands-free mode, completed segments are forwarded automatically while the input remains open.

Hands-free capture/VAD runs independently of the one ASR inference thread. A validated onset immediately emits `speech-start`, allowing the existing controller to abort the current model/playback before the new transcript exists. An utterance ID advances at each new onset; text still computing for an older utterance and repeated results are suppressed in both worker and Node adapter. At most one segment computes and one complete segment waits; a newer onset clears the old queued segment. This favors the latest user turn over an accumulating backlog. It can discard an interrupted previous sentence; no artificial transcript is generated for the discarded speech.

Cancellation/account closure kills an active recognition worker, closes its OS input handle, and drops results from its request and process generation. This also ends an uninterruptible CUDA call rather than letting it deliver into a new identity. A normally completed recording keeps the idle model resident for the next Start; closing the conversation releases it. Cancellation can therefore make the next Start cold again.

The bundled Python source is read by Node and passed directly to Python with `spawn(..., shell:false)` semantics. This works when the source is inside `app.asar`, without extracting recorded audio, writing a temporary executable script, launching a terminal, or requiring `asarUnpack`. The configured Python interpreter/environment and model stay outside the app bundle. No host/listening socket is exposed.

## Recording, VAD and limits

- Only the explicit `listen` operation opens an input stream. Startup, capability discovery and model loading never open it. The provider does not alter Windows device defaults/privacy settings or use loopback recording.
- Manual capture is limited to **60 seconds / 1,920,000 PCM bytes**, with a separate queue of at most **100 × 640-byte frames**. Overflow, malformed frames, device errors or the duration limit discard the recording instead of submitting a partial task. Finish is required before the manual limit. Hands-free sessions end after **10 minutes**; each active/pending/computing segment is bounded below 20 seconds (640,000 PCM bytes each), with one active segment, one computing and at most one queued. Temporary float/resampled arrays are limited by the corresponding input cap; model memory is separate.
- PCM remains in worker memory and is released after finish/cancel/error. No recording/WAV is written, and the provider makes no audio upload call. Offline Hugging Face/Transformers settings, local model files and disabled remote custom code are enforced; these library settings are not an OS network sandbox or a guarantee against system paging/crash dumps.
- WebRTC VAD uses **mode 2, 20 ms frames**. Manual onset uses **3 voiced frames within 5**. Hands-free uses the stricter **6 voiced frames within 8**, approximately 120–160 ms of acoustic evidence, plus **200 ms pre-roll**; a **600 ms unvoiced tail** closes the segment. At least **200 ms classified speech** is required before sending a completed segment to Qwen. A 20-second segment is discarded and waits for 600 ms silence before rearming, so a long-speech tail is not submitted as a new truncated request. The classification comes from WebRTC's acoustic VAD; RMS drives the numeric meter only. A short segment can already have interrupted playback at onset, then be rejected as too short. Noise/speech discrimination is probabilistic: this does not identify the owner or distinguish a nearby television from a human. Actual headphone barge-in, noisy rooms and human Mandarin still need real acceptance.
- Silence with no accepted VAD onset produces `unrecognized` without invoking Qwen. Final text is capped at 2,000 characters. Cold startup/model loading, capture and finalization have separate bounded deadlines; final inference gets 30 seconds.
- Diagnostic exports contain event names/times and bounded numeric levels, not PCM or recognized text. Third-party stdout is kept away from the protocol, and raw stderr/error objects are not exported to the UI.

## Fixed local environment and sources

Keep the separate ASR environment from [the offline probe](QWEN_ASR_PROBE.md). Qwen ASR's Transformers **4.57.6** conflicts with the existing Qwen TTS pin **4.57.3**; do not install this into the TTS environment. Torch/Torchaudio **2.11.0+cu128**, Python **3.11.9**, Qwen ASR **0.0.6** and the original `Qwen/Qwen3-ASR-0.6B` revision **`5eb144179a02acc5e5ba31e748d22b0cf3e303b0`** are the locally tested baseline. The model and its complete hash manifest are documented in the probe; no model download happens inside the worker.

The additional requirements are pinned in [`src/voice/qwen-asr-requirements.txt`](../src/voice/qwen-asr-requirements.txt):

| Component | Fixed version / source | License and use |
| --- | --- | --- |
| sounddevice Python wrapper | [0.5.6 PyPI](https://pypi.org/project/sounddevice/0.5.6/), [source tag](https://github.com/spatialaudio/python-sounddevice/tree/0.5.6); released 2026-08-17 | MIT wrapper. [RawInputStream](https://python-sounddevice.readthedocs.io/en/0.5.6/api/raw-streams.html) provides bounded PCM callbacks. Windows wheels bundle PortAudio; not a newly installed system driver. |
| PortAudio binary in that official wheel | Local runtime reports **V19.7.0-devel, revision unknown**; do not invent a more precise commit | [PortAudio MIT license](https://portaudio.com/license.html). Default non-ASIO binary; no ASIO opt-in or system audio changes. Preserve the wheel's third-party notices if redistributing it. |
| webrtcvad-wheels Python/C wrapper | [2.0.14.post1 PyPI](https://pypi.org/project/webrtcvad-wheels/2.0.14.post1/), [maintainer repository](https://github.com/daanzu/py-webrtcvad-wheels); released 2026-10-02, Windows CPython 3.11 wheel | Wrapper MIT; embedded WebRTC C code has its separate BSD 3-clause notice in the [LICENSE](https://github.com/daanzu/py-webrtcvad-wheels/blob/master/LICENSE). The maintained fork supplies Windows wheels; no arbitrary RMS threshold is substituted for VAD. |
| Qwen ASR code / checkpoint | [Qwen official repository](https://github.com/QwenLM/Qwen3-ASR), [pinned model](https://huggingface.co/Qwen/Qwen3-ASR-0.6B/tree/5eb144179a02acc5e5ba31e748d22b0cf3e303b0) | Apache-2.0 code/model; supplied separately, not embedded in the Electron package. |

Compared with the Windows recognizer baseline, this gives an independently testable local Mandarin model and consistent default-input capture. The existing synthetic timing probe supports keeping a resident model and one Torch intra-op thread, with explicit SDPA support verified against the installed official source. It does not prove better human recognition or end-to-end conversational latency. The tradeoff is a separate Python/CUDA installation, a roughly 1.88 GB checkpoint download and GPU residency. Windows speech remains available without that setup.

To add only the two audio wheels to the already verified ASR environment:

```powershell
& 'work\voice-qwen-asr-baseline\.venv\Scripts\python.exe' -m pip install --retries 0 --timeout 30 --only-binary=:all: sounddevice==0.5.6 webrtcvad-wheels==2.0.14.post1
& 'work\voice-qwen-asr-baseline\.venv\Scripts\python.exe' -m pip check
```

This is an explicit development setup step, not an action performed when opening the app. Current full installed versions are retained in the private `outputs/voice-comparison/qwen-asr-provider-dependencies.txt`. Dependencies/models are not included in the public package by this change.

## Verification and remaining acceptance

```powershell
node --test test/qwen-asr.test.cjs
& 'work\voice-qwen-asr-baseline\.venv\Scripts\python.exe' -B test/qwen-asr-worker-test.py
```

The 14 Node tests exercise request framing with fake subprocesses, cancellation/startup and process/request isolation, review-before-model, duplicate/stale utterance suppression, current VoiceConversation onset-to-playback interruption, parallel playback warmup failure and replacement races, language intersection, private diagnostics and network-path rejection. The 11 Python standard-library tests use fake devices/models for manual closure, silence, bounded queues/PCM, onset/rearming, stale Finish, cancellation during inference, continuous recording while ASR is blocked, latest-segment handling, short/long segments and the session deadline. They open no microphone and are not substitutes for device acceptance.

For a separate explicit synthetic-file probe of the actual installed Qwen model, WebRTC VAD and provider state machine:

```powershell
& 'work\voice-qwen-asr-baseline\.venv\Scripts\python.exe' -B test/qwen-asr-synthetic-probe.py --model 'work\voice-qwen-asr-baseline\model' --audio 'outputs\voice-comparison\qwen3-tts-serena.wav' --output 'outputs\voice-comparison\qwen-asr-provider-synthetic.json'
```

For the hands-free path, use `--mode hands-free` and a different new receipt path. The probe adds synthetic trailing silence, waits for the actual VAD endpoint, receives the current segment transcript and then cancels the fake input. It does not send Finish in this mode.

It replaces only input capture with PCM from the original synthetic test WAV, saves a new JSON receipt and never opens a microphone. The expected sentence is not supplied to the ASR model. This probe runs only when invoked explicitly and is excluded from the normal test suite. No generated result is sent to an AI conversation or account.

The 2026-11-05 execution passed on the existing RTX 5090 setup. The original 6.640-second Serena sample produced the complete sentence “晚上好，今天过得怎么样？不着急，慢慢说，我在听。” Cold worker loading reached the simulated listening state in **7.2329 s**; **Finish to final result was 1.4348 s**. Input closure preceded transcription, and the actual WebRTC VAD emitted two onset events. Frames were fed faster than real time, so this is neither microphone latency nor an end-to-end conversation benchmark. Private receipt: `outputs/voice-comparison/qwen-asr-provider-synthetic.json`; separate actual subprocess capability/closure receipt: `outputs/voice-comparison/qwen-asr-provider-no-capture.json`. Both explicitly record `microphoneOpened:false`.

The subsequent hands-free synthetic probe also returned the exact full sentence, using one stricter onset and automatic VAD endpoint, without a Finish command. After the accelerated synthetic tail was supplied, result arrival plus cancellation took **1.1161 s**; this excludes real-time tail duration and is not microphone/conversation latency. Evidence: `outputs/voice-comparison/qwen-asr-provider-handsfree-synthetic.json`. Real WebRTC control checks on synthetic silence, one-sample full-scale impulse and one-frame full-scale transient produced no onset; these three controls are not a general noise benchmark.

The control check is reproducible without GPU/model/capture via `python -B test/qwen-asr-worker-test.py --real-vad-controls` in the ASR environment. Private receipt: `outputs/voice-comparison/qwen-asr-vad-controls.json`. The new real worker capability probe confirms `handsFree:true` without loading models or opening input: `outputs/voice-comparison/qwen-asr-provider-handsfree-no-capture.json`. Earlier manual-only receipts remain historical evidence rather than being overwritten.

Still required before calling the voice feature accepted: real user Start/Finish/Review on the chosen device, recognition of normal sentences, silence/noise/error behavior, cancellation while speaking/recognizing, account switching, correct playback, and true spoken interruption. The implementation and synthetic checks do not claim those flows passed or complete the nine-item voice acceptance on their own.
