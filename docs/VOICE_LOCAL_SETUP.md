# Optional local neural voice on Windows

The same application-root ASR installation also supports optional
[QQ owner voice recognition](QQ_INBOUND_VOICE.md), with text replies. That route
needs only ASR and does not open a microphone, require TTS or generate a voice
reply. It is explicitly enabled per companion and shares one recognition lease
with desktop neural voice. Account credentials and conversation data remain
separate. No additional package/model download runs when the toggle changes.

This is a developer setup for the existing Electron voice panel, using **Qwen3-ASR 0.6B → the selected character's text AI → GPT-SoVITS v2ProPlus**. The same optional TTS installation also supports explicitly typed [QQ voice clips](QQ_VOICE.md), without ASR or microphone use. Windows speech remains an explicit fallback for desktop voice chat; QQ clip generation does not silently select it. Installing these optional models does not change Claude/OpenAI/DeepSeek credentials, QQ routing, character permissions or stored conversations.

The tested machine used Windows, Python **3.11.9**, an RTX 5090 and official PyTorch/Torchaudio **2.11.0+cu128** wheels. A compatible NVIDIA driver is required. This is not a CPU-only route, a bundled installer or proof of compatibility with every CUDA GPU. A clean-machine installation has not yet been repeated from this guide. The commands below use configurable local paths rather than the developer's drive layout.

## Before downloading

- Use two separate Python environments: ASR requires Transformers **4.57.6**, while this TTS baseline uses **4.57.3**. Do not merge them or install into the application's Python/system environment.
- If only generating typed QQ clips, install the **TTS** environment, source and fixed reference/assets below. Skip ASR environment creation, installation and download commands (`$asrRoot`, `$asrPython`, `$asrModel`); the QQ renderer does not require those fields or instantiate ASR. The two-environment instructions remain necessary for desktop microphone chat.
- Model downloads alone are approximately **1.876 GB ASR + 1.892 GB TTS assets**, before CUDA wheels, environments and upstream source. Downloading is an explicit setup action; opening Agent Arcade does not install packages or fetch models.
- The ASR code/model declares Apache-2.0. GPT-SoVITS source and the selected weight cards declare MIT; G2PW and other dependencies carry their own notices. These are external optional dependencies, not a completed redistribution audit. See [ASR provider](QWEN_ASR_PROVIDER.md) and [voice research](VOICE_RESEARCH.md).
- **Reference asset requirement:** the current TTS worker accepts only the exact project-generated [Serena reference WAV](../src/assets/voice/serena-reference.wav): 318,764-byte mono 24 kHz WAV, SHA-256 `20a9b9c687db1dc2e9c5783c3e915c9694e49118fff9e72dad56b1c32a37d179`. Its text is “晚上好，今天过得怎么样？不着急，慢慢说，我在听。” This is synthetic preset speech, not a person's recording. The source tree now contains the exact asset and its [provenance/rights notes](../src/assets/voice/README.md); this does not claim a GitHub release has been published. Regenerating with the same seed is not guaranteed to reproduce the required bytes. Do not substitute an arbitrary recording or remove the integrity check.

## Create the two environments

Run these commands from the Agent Arcade repository after installing Python 3.11 and Git. The example location is outside the repository. Choose another local directory if needed; UNC/network paths are rejected.

```powershell
$voiceRoot = Join-Path $env:LOCALAPPDATA 'AgentArcadeVoice'
$asrRoot = Join-Path $voiceRoot 'qwen-asr'
$ttsRoot = Join-Path $voiceRoot 'gpt-sovits'
$asrPython = Join-Path $asrRoot '.venv\Scripts\python.exe'
$ttsPython = Join-Path $ttsRoot '.venv\Scripts\python.exe'
$asrModel = Join-Path $asrRoot 'model'
$ttsRepo = Join-Path $ttsRoot 'upstream'
$voiceReference = Join-Path $voiceRoot 'serena-reference.wav'

py -3.11 -m venv (Join-Path $asrRoot '.venv')
py -3.11 -m venv (Join-Path $ttsRoot '.venv')
Copy-Item -LiteralPath 'src/assets/voice/serena-reference.wav' -Destination $voiceReference
& $asrPython -m pip install --index-url https://download.pytorch.org/whl/cu128 torch==2.11.0+cu128 torchaudio==2.11.0+cu128
& $ttsPython -m pip install --index-url https://download.pytorch.org/whl/cu128 torch==2.11.0+cu128 torchaudio==2.11.0+cu128
& $asrPython -m pip install -r docs/voice/qwen-asr-windows-py311.txt
& $ttsPython -m pip install -r docs/voice/gpt-sovits-windows-py311.txt
& $asrPython -m pip check
& $ttsPython -m pip check
```

Stop if any command exits unsuccessfully. The two requirements files preserve the observed installed package versions, including transitive packages; neither contains local paths or credential-bearing URLs. `jieba-fast` built locally in the tested TTS setup. If its required native build tooling is absent, resolve that installation error separately; the app does not install compilers or drivers. The [ASR probe](QWEN_ASR_PROBE.md) describes the package choice and native-Transformers alternative, which is **not** interchangeable with this pinned model/API.

## Obtain the fixed source and model revisions

The original Qwen package needs `Qwen/Qwen3-ASR-0.6B`, not the separate `-hf` checkpoint:

```powershell
& $asrPython -c "from huggingface_hub import snapshot_download; import sys; snapshot_download('Qwen/Qwen3-ASR-0.6B', revision='5eb144179a02acc5e5ba31e748d22b0cf3e303b0', local_dir=sys.argv[1], allow_patterns=['*.json','*.safetensors','*.txt','*.model','LICENSE*'])" $asrModel
$asrHash = (Get-FileHash -LiteralPath (Join-Path $asrModel 'model.safetensors') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($asrHash -ne '79d6cbd4c98c7bbffe9db2edac07f56cd6637d0d5944b27f6c2b8353840323ea') { throw 'ASR checkpoint hash mismatch' }
```

Fetch the tested GPT-SoVITS source into a fresh directory. The full training/WebUI requirements are not needed by this adapter; the pinned inference environment above includes its actual eager import dependencies.

```powershell
git init $ttsRepo
git -C $ttsRepo remote add origin https://github.com/RVC-Boss/GPT-SoVITS.git
git -C $ttsRepo fetch --depth 1 origin 04a44eb977586645f33594b72af13a035a2056c6
git -C $ttsRepo checkout --detach FETCH_HEAD

$ttsModels = Join-Path $ttsRepo 'GPT_SoVITS\pretrained_models'
& $ttsPython -c "from huggingface_hub import snapshot_download; import sys; snapshot_download('lj1995/GPT-SoVITS', revision='8f8857563c040d542de108a2c18b0425abd6c9c5', local_dir=sys.argv[1], allow_patterns=['chinese-hubert-base/*','chinese-roberta-wwm-ext-large/*','s1v3.ckpt','v2Pro/s2Gv2ProPlus.pth','sv/pretrained_eres2netv2w24s4ep4.ckpt','README.md'])" $ttsModels

$auxRoot = Join-Path $ttsRoot 'auxiliary'
& $ttsPython -c "from huggingface_hub import hf_hub_download; import sys; hf_hub_download('XXXXRT/GPT-SoVITS-Pretrained', filename='G2PWModel.zip', revision='0c47645e02a7bc3688d7b263b0042c81e3cd82cd', local_dir=sys.argv[1])" $auxRoot
$g2pwZip = Join-Path $auxRoot 'G2PWModel.zip'
$g2pwHash = (Get-FileHash -LiteralPath $g2pwZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($g2pwHash -ne '46292be0374a49308069233cd5c147ae4c41806558e4781a2467a31a4d8099da') { throw 'G2PW archive hash mismatch' }
Expand-Archive -LiteralPath $g2pwZip -DestinationPath (Join-Path $ttsRepo 'GPT_SoVITS\text')
```

The resulting auxiliary file must be `GPT_SoVITS\text\G2PWModel\g2pW.onnx`. The worker verifies SHA-256 values of the five main checkpoint files, G2PW ONNX and the reference before loading. A missing or different asset fails; it does not trigger a download or choose another voice. A rerun against existing source/archive destinations may need an explicit fresh directory; do not delete a working installation to resolve a setup error.

Official pinned sources: [Qwen model](https://huggingface.co/Qwen/Qwen3-ASR-0.6B/tree/5eb144179a02acc5e5ba31e748d22b0cf3e303b0), [GPT-SoVITS source](https://github.com/RVC-Boss/GPT-SoVITS/tree/04a44eb977586645f33594b72af13a035a2056c6), [TTS weights](https://huggingface.co/lj1995/GPT-SoVITS/tree/8f8857563c040d542de108a2c18b0425abd6c9c5), [G2PW source](https://huggingface.co/XXXXRT/GPT-SoVITS-Pretrained/tree/0c47645e02a7bc3688d7b263b0042c81e3cd82cd). The local implementation follows the ordinary synthesis path, not an unverified semantic-streaming flag or optional CUDA Graph acceleration.

## Connect the optional installation to Agent Arcade

First place the exact reference asset described above at `$voiceReference` and verify its SHA-256. The application reads `local-voice.json` from its **application data root**, normally `%USERPROFILE%\.agent-arcade`, or the explicit `AGENT_ARCADE_HOME` directory if launched with that setting. It does not read this file from an individual QQ account profile.

For a new config only:

```powershell
$arcadeData = if ($env:AGENT_ARCADE_HOME) { $env:AGENT_ARCADE_HOME } else { Join-Path $env:USERPROFILE '.agent-arcade' }
$localVoiceFile = Join-Path $arcadeData 'local-voice.json'
if (Test-Path -LiteralPath $localVoiceFile) { throw 'An existing local voice config is present; review it instead of overwriting it.' }
if ((Get-FileHash -LiteralPath $voiceReference -Algorithm SHA256).Hash.ToLowerInvariant() -ne '20a9b9c687db1dc2e9c5783c3e915c9694e49118fff9e72dad56b1c32a37d179') { throw 'Reference voice hash mismatch' }
$voiceConfig = [ordered]@{
  version = 1
  asrPython = $asrPython
  asrModel = $asrModel
  ttsPython = $ttsPython
  ttsRepository = $ttsRepo
  referenceAudio = $voiceReference
}
[System.IO.Directory]::CreateDirectory($arcadeData) | Out-Null
[System.IO.File]::WriteAllText($localVoiceFile, ($voiceConfig | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
```

Use absolute local paths and UTF-8 without a BOM. The file is limited to 8 KiB; executable/reference paths must be files and model/repository paths must be directories. It contains paths only, never an API key. With a valid optional installation, **橘 / `claude-ju` defaults to the local gentle voice**. Other characters default to Windows; they may explicitly choose the same local voice in the panel. This is not a distinct trained voice for every character. When the optional file is absent, Windows remains the default. A broken optional installation produces an error; selecting **Windows 语音（备用）** explicitly remains possible and bypasses that optional config.

## Use and verify

For independent App voice, select the companion, choose **App 对话 / App conversation**, start the App conversation, then choose **语音聊天 / Voice chat**. QQ need not be configured, running or logged in. The selected AI still needs its existing supported credentials/login. For channel-backed voice, use the connected companion's channel conversation. Expand **识别设置与诊断** to select/check the existing provider. Both routes keep voice initially collapsed: entering a conversation starts no voice-panel device check. Opening it explicitly performs the existing capability check. Checking capabilities starts temporary hidden processes to inspect dependencies/assets; it does not open a microphone or load the GPU models. It cannot prove microphone quality or audibility. The currently operated package is tracked separately in [the active scope](ACTIVE_GOAL.md).

**收起语音 / Hide voice** ends the panel's own voice work and waits for its pending device check and provider cleanup before hiding the panel and returning focus to the voice entry. During shutdown, recording and submission controls are disabled. An unconfirmed shutdown leaves the panel visible with a retry; another account's closed receipt does not count as confirmation. Existing voice receipts can be exported from the conversation header without reopening a speech provider. Windows helper shutdown now waits for its actual owned process exit, while neural providers retain their separate cleanup contracts. These source changes have isolated lifecycle/renderer evidence and a real Windows capability-only exit check; live recording, audibility and spoken interruption remain separate acceptance.

Manual mode is **开始说话 → 说完了 → edit the transcript → 发送**. Recording is limited to 60 seconds for this ASR; end it before the limit. Hands-free mode is separately enabled with headphone confirmation, sends recognized turns automatically, uses a 600 ms VAD tail, limits a segment to 20 seconds and a session to 10 minutes, and has no acoustic echo cancellation. New speech invalidates obsolete recognition/model/playback output. Turning off voice, changing account/source or leaving the panel closes/pauses the bound voice session. On the channel-backed route, a received QQ message can also interrupt that shared conversation.

The first Start loads ASR and TTS in parallel. Individual synthetic probes observed about 7.23 seconds ASR cold loading and 10.49 seconds TTS silent warmup; these are separate measurements, not a combined startup guarantee. Normal successive recordings in the same account/panel/provider reuse the voice host and its idle models. A provider/account/scope change or explicit close replaces it. Interrupting an active subprocess can release the model and make the next Start cold again. The app emits playback-start only after PCM is accepted by its output stream; actual hearing and stop-to-silence must still be checked by a person.

The voice workers keep captured/generated audio in bounded memory and do not upload or retain recordings. The recognized/edited **text** is sent to the selected AI backend and enters the selected conversation: independent App history stays separate from QQ; channel-backed desktop voice shares that character's channel context. App voice replies are not sent to QQ. Independent App voice transcripts do not execute memory, publication, follow-up or permission commands. Manual transcript confirmation approves the words, not those actions; type explicit local memory commands in the App text composer. This does not make a cloud Claude/GPT/DeepSeek conversation offline. Dependency downloads are separate; library offline settings are not an operating-system network sandbox.

### App voice increment (2026-11-08)

The operated local preview `single-window-app-local-voice-20261108` adds the
independent App voice entry described above. Current production checks passed
**184 targeted tests with no failures and 840 stable inputs**, **six syntax
checks**, and **21 renderer checks with 12 screenshots and 84 stable inputs**.
These cover local source/character/generation isolation, pending and failed
cleanup, transcript review, and voice commands remaining conversation. They
are bounded component/renderer evidence; no new green full regression is
claimed, and earlier failed full-run records remain preserved.

The original-profile Ju App voice panel opened before any managed QQ launcher
was running. Automatic and explicit capability checks returned the existing
neural provider and zh-CN; the microphone remained closed. Hide voice removed
the panel. Ju/Whale then recovered QQ and AI using their saved configurations;
four encrypted vault hashes remained unchanged and no scan or key entry was
needed. The desktop entry now targets this package. Evidence:
outputs/app-local-voice-delivery-20261108.json. These checks do not establish a new
microphone recording, model reply, audible playback or hands-free spoken
interruption. The earlier accepted manual neural voice flow remains separate;
the original human interruption gate is still unaccepted.

Installation and synthetic checks are not voice acceptance. The previous Windows pipeline produced a response, but the owner rejected its transcription accuracy and robotic sound. The corrected neural package subsequently passed one bounded manual recording → editable transcript → reply/playback flow: the owner confirmed accurate text and an audible gentle female reply, supported by an independently checked diagnostic sequence. This does not establish statistical transcription accuracy or long-session stability. Genuine hands-free spoken interruption, stale-audio suppression and a new spoken turn remain unaccepted and are deferred at the owner's request. Follow the current [nine-feature ledger](COMPANION_ACCEPTANCE.md) and [voice/card guide](VOICE_AND_CHARACTER_CARDS.md); do not infer broader acceptance from this setup file.

## Generate a QQ voice clip without ASR

Open a connected QQ companion's **Share voice / 分享语音** drawer. Type an
original short sentence and choose **Generate voice / 生成语音**. Generation
creates a preview only. **Listen locally / 试听** and **Send to owner /
发送给主人** are separate explicit actions. **Choose WAV / 选择 WAV** remains
available when local generation is not configured. This flow neither reads
chats nor lets a conversation model automatically generate/send media.

The main-process factory reads only `version: 1`, `ttsPython`, `ttsRepository`
and `referenceAudio` from the same application-root `local-voice.json`. For a
new TTS-only file, use the guarded config creation above with these three path
fields and omit `asrPython`/`asrModel`. Preserve an existing complete config;
do not strip its ASR settings. A TTS-only config is not a working neural
microphone-chat installation; select Windows explicitly for that separate flow
or complete ASR setup first.

The drawer's availability check verifies the configured paths only. It does
not load/checkpoint-verify a model, create ASR, open/query a sound card, download
assets or start playback. Fixed model/reference hashes are checked during real
loading. A missing or changed asset fails explicitly; there is no cloud or
Windows synthesis fallback. Actual preview playback naturally needs an output
device, but rendering itself does not.

The current clip voice is fixed Mandarin **Serena**. Input is limited to **120
Unicode code points and 240 UTF-16 units**, with unsupported controls and
unpaired surrogates rejected. Output must be **0.2–30 seconds**, mono 32 kHz
PCM16. An excessive duration fails as a whole; the app does not truncate it to
fit. A short character count cannot guarantee audio duration.

Only one QQ render operation runs per application. It consumes bounded PCM
frames in memory and validates the entire result. After the worker reports a
clean request terminal, the exact same account/owner/role/connection/panel and
runtime revision may reuse the idle model for up to 30 seconds. The idle owner
does not retain the completed request or PCM result. Controllable PCM buffers
are zeroed and Python request references are released; this is not secure
erasure of immutable strings or GPU memory. An expired, cancelled, changed or
failed host must confirm exit before a replacement starts. Unknown exit keeps
the render gate occupied. Closing the drawer or starting desktop voice chat
closes this QQ-only host; no worker is shared with desktop voice chat or ASR.
The first clip and a clip after idle expiry can still need a cold model load.
Actual cold-versus-warm timing for this new path remains unmeasured; do not use
the earlier component timings below as a measured speedup. Typed text/audio are
not saved to companion memory or diagnostics. Generation does not upload audio;
the later explicit QQ send has the separate NapCat cache/upload boundaries in
[the QQ voice guide](QQ_VOICE.md#isolation-and-recovery).

On the tested Windows/RTX 5090 machine, a direct real-model call generated
“晚上好，今天也辛苦啦。” as a **2.26-second** clip. The cold call took **30.56
seconds**, including **26.84 seconds** to the model-ready render-start event
and **3.71 seconds** of rendering. A separate warmed worker was cancelled about
50.5 ms after render-start; its request settled in about **53 ms total**,
including that pre-abort delay, returning no audio.
Both owned process identities were independently confirmed absent afterward.
These single observations are not a performance benchmark, a listening test
or a general stop-latency promise. The explicit developer probe saved an
original synthetic WAV; ordinary app generation does not save one.

The text-generation source/direct-model checks have passed, and
`single-window-qq-render-20261106` is built and identity-checked (119 source
files; 1156 tests with 1155 passed/one skipped; 208 syntax files). The actual
package has now completed one bounded single-window UI flow with the original
sentence “今晚的海风很轻，慢慢休息吧。”: cancel generation and confirm worker
exit with no new voice message, generate again with another confirmed worker
exit, preview locally, then explicitly send once. The preview displayed 3.0
seconds / 32 kHz / 189 KiB. Bridge acceptance and one independently observed
outgoing voice record were recorded; direct UI-to-history message-ID matching
and exact UI-audio byte identity were not established.

The earlier packaged **selected-WAV** preview/send receipt remains a separate
result. Neither flow establishes recipient display/playback or human hearing;
cross-account live draft isolation also remains unaccepted. See
[QQ evidence](QQ_VOICE.md#text-generation-checkpoint) and
`outputs/qq-render-ui-live-summary-20261106.json` for the exact records and
remaining acceptance.
