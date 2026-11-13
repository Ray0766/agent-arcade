# Qwen3-ASR local-file probe — 2026-11-05

This is an isolated file-input experiment. The later optional [manual microphone provider](QWEN_ASR_PROVIDER.md) has a separate lifecycle and acceptance boundary. This probe keeps Electron, account routing and Claude/GPT/DeepSeek unchanged. No listening service or microphone capture is started, and no audio is sent to a hosted provider. A synthetic TTS file can establish loading and transcription compatibility, but cannot accept human Mandarin recognition, background-noise handling or conversation interruption.

## Dependency decision

Use the official **`qwen-asr==0.0.6` Transformers backend**, with the original **`Qwen/Qwen3-ASR-0.6B`** checkpoint. The [official package metadata](https://github.com/QwenLM/Qwen3-ASR/blob/main/pyproject.toml) allows Python >=3.9 and explicitly lists 3.11; the [README](https://github.com/QwenLM/Qwen3-ASR#environment-setup) recommends a fresh Python 3.12 environment. Therefore Python 3.11 is allowed by the package declaration, while this Windows combination still needs actual execution.

The package pins `transformers==4.57.6`, `accelerate==1.12.0`, `nagisa==0.2.11` and `soynlp==0.0.493`; it also declares `qwen-omni-utils`, `librosa`, `soundfile`, `sox`, `gradio`, `flask` and `pytz`. That is the maintainer's minimum installation, not a bare ASR-only dependency set. Installing the package does not require running its web demos. Do not strip imports or patch third-party dependencies merely to reduce this first probe.

The existing Qwen TTS environment requires **Transformers 4.57.3**, so installing ASR there would violate its dependency pin. Use `work/voice-qwen-asr-baseline/.venv`, separate from `work/voice-qwen-baseline/.venv`. The [PyTorch version table](https://pytorch.org/get-started/previous-versions/#v2110) explicitly provides Windows/Linux CUDA 12.8 wheels for Torch 2.11.0 and matching Torchaudio. Reuse pip's existing wheel/HTTP cache; do not alter global Python, the GPU driver or the working TTS environment.

Initial fixed constraints:

```text
torch==2.11.0+cu128
torchaudio==2.11.0+cu128
qwen-asr==0.0.6
transformers==4.57.6
accelerate==1.12.0
```

The first probe uses batch size one, requests eager attention, and adds no forced aligner, FlashAttention, vLLM or compilation. Later inspection found that this wrapper still configures its internal attention modules as SDPA despite the eager request; the requested label must not be treated as proof of the active implementation. The script now records both the request and actual module configurations. No minimum VRAM or Windows latency is inferred from the nominal 0.6B name.

There is a newer [native Transformers `Qwen3-ASR-0.6B-hf` route](https://huggingface.co/Qwen/Qwen3-ASR-0.6B-hf), announced in June 2026 and requiring Transformers >=5.13.0. It can avoid the separate `qwen-asr` wrapper, but uses a different checkpoint/API and conflicts even more clearly with the current TTS environment. It is an alternative to evaluate separately, not an interchangeable model directory for this script.

## Pinned model and setup

Official repository: `Qwen/Qwen3-ASR-0.6B`, revision **`5eb144179a02acc5e5ba31e748d22b0cf3e303b0`**, Apache-2.0. The fixed [revision metadata](https://huggingface.co/api/models/Qwen/Qwen3-ASR-0.6B/revision/5eb144179a02acc5e5ba31e748d22b0cf3e303b0?blobs=true) lists `model.safetensors` as **1,876,091,704 bytes**, LFS SHA-256 **`79d6cbd4c98c7bbffe9db2edac07f56cd6637d0d5944b27f6c2b8353840323ea`**. This is download size, not peak GPU memory.

The authorized local downloader retains the complete metadata in `work/voice-qwen-asr-baseline/model-manifest.json`, verifies LFS files against SHA-256 and ordinary files against Git blob SHA-1, and records an additional SHA-256 for every downloaded file. It refuses overwrite, uses zero automatic retries and bounded reads/deadlines. Model files are stored under its `model` directory; `download-receipt.json` must say `completed:true` before using them. Files are downloaded before inference, never automatically during it.

For a fresh environment after explicit installation/download authorization:

```powershell
py -3.11 -m venv 'work\voice-qwen-asr-baseline\.venv'
& 'work\voice-qwen-asr-baseline\.venv\Scripts\python.exe' -m pip install --retries 0 --timeout 30 --index-url https://download.pytorch.org/whl/cu128 torch==2.11.0+cu128 torchaudio==2.11.0+cu128
& 'work\voice-qwen-asr-baseline\.venv\Scripts\python.exe' -m pip install --retries 0 --timeout 30 -c 'work\voice-qwen-asr-baseline\constraints.txt' qwen-asr==0.0.6
& 'work\voice-qwen-asr-baseline\.venv\Scripts\python.exe' -m pip check
```

These are setup commands, not something the application runs on launch. The local constraints and downloader are experiment artifacts, not a public installer. Preserve a full dependency freeze and the download/hash receipt with each test result.

## Run an existing local audio file

The probe accepts only a local WAV, no longer than 60 seconds, with one or two channels and an 8–48 kHz sample rate. It passes an in-memory waveform to the official wrapper, allowing the wrapper's normal resampling. It accepts no URL or network-share input. Missing local model files fail with Hugging Face/Transformers offline mode enabled; no remote custom model code is enabled. These library settings are not an operating-system network sandbox.

Version inspection does not load a model or audio:

```powershell
& 'work\voice-qwen-asr-baseline\.venv\Scripts\python.exe' scripts/qwen-asr-offline-probe.py --check-environment
```

After the independently generated original TTS sample exists:

```powershell
& 'work\voice-qwen-asr-baseline\.venv\Scripts\python.exe' scripts/qwen-asr-offline-probe.py --model 'work\voice-qwen-asr-baseline\model' --audio 'outputs\voice-comparison\qwen3-tts-serena.wav' --input-kind synthetic --output 'outputs\voice-comparison\qwen3-asr-serena-synthetic.json'
```

The output path must not already exist. The receipt contains the transcript, input hash, package versions, audio duration, separately measured cold loading/inference time and peak Torch CUDA allocation. It remains private. A matched synthetic sentence is a pipeline check, not a human accuracy score. The probe does not supply the expected sentence as ASR context. A later owner-authorized recording should use `--input-kind human-file`, an independently written reference transcript and an explicit review step; neither option sends recognized text to a chat account or long-term memory.

## Current verification boundary

The authorized Windows experiment completed with Python **3.11.9**, Torch/Torchaudio **2.11.0+cu128**, qwen-asr **0.0.6**, Transformers **4.57.6** and Accelerate **1.12.0**. `pip check` reported no broken requirements. Torch installation reused cached wheels. All nine checkpoint files (1,880,618,159 bytes total) passed their manifest hashes; the bounded download took 99.937 seconds with zero automatic retries. Full installed versions are in the ignored `outputs/voice-comparison/qwen-asr-dependencies.txt`.

The original **Serena synthetic TTS** sample was 6.640 seconds, 24 kHz mono. The GPU reported **NVIDIA GeForce RTX 5090**. The first process measured **1.8325 seconds model loading**, **11.2433 seconds first transcription**, and **1,876,073,984 bytes peak Torch CUDA allocation**. The allocation counter is not total GPU residency or a minimum memory requirement. It requested eager attention without instrumenting the internal implementation; the later finding below corrects that label without changing the original receipt. The transcript exactly matched the controlled source: “晚上好，今天过得怎么样？不着急，慢慢说，我在听。” This is one successful synthetic file, not a human accuracy score or proof of real-time performance. Private result: `outputs/voice-comparison/qwen3-asr-serena-synthetic.json`; source audio hash matches the independent TTS output.

The probe's argument/environment path also runs without loading models or opening audio. No replacement ASR is connected to the application by adding this document or script. Human pronunciation, proper names, mixed-language speech, silence/noise handling and interruption remain real acceptance work.

## Bounded resident-model timing check

A subsequent experiment reused the same installed versions, checkpoint and exact synthetic WAV. The TTS agent had explicitly finished its GPU work before ASR started. Default Torch intra-op and inter-op thread counts were both **24**. The same resident model performed the first four rows below; only the intra-op count changed via [`torch.set_num_threads(1)`](https://docs.pytorch.org/docs/2.11/generated/torch.set_num_threads.html). No new dependency, microphone, upload, service or app integration was involved.

| Request / process state | Intra-op threads | Complete transcription | Audio normalization within that total |
| --- | --- | --- | --- |
| Request eager; first call in this process | 24 | 2.8925 s | 1.5784 s |
| Same resident model, repeat | 24 | 0.6430 s | 0.0010 s |
| Same resident model after thread change | 1 | 0.4711 s | 0.0008 s |
| Same resident model, repeat | 1 | 0.4743 s | 0.0008 s |
| Separately loaded model, explicit SDPA request, one call | 1 | 0.4600 s | 0.0012 s |

All five transcriptions exactly matched the original text. This supports using a resident worker and investigating a one-thread setting; the initial 11.2433-second observation is not representative of warmed transcription here. It does **not** establish that all of the initial delay came from any single cause. Only one sentence and a fixed test order were used, so warming and thread-count effects are not fully separated. For an eventual worker, set thread policy before model/eager execution as recommended by PyTorch; this experiment changed it mid-process only for the requested bounded comparison. No broad benchmark or production latency guarantee follows.

Before the explicit SDPA attempt, the installed official `qwen-asr 0.0.6` source was checked: its model classes declare `_supports_sdpa=True`, and audio/text attention dispatch through `ALL_ATTENTION_FUNCTIONS`. Runtime inspection then found **18 audio and 28 text attention modules all configured as SDPA**, including when the top-level argument requested eager. Each of the five runs invoked PyTorch's real [`scaled_dot_product_attention`](https://docs.pytorch.org/docs/2.11/generated/torch.nn.functional.scaled_dot_product_attention.html) **494 times**. Thus explicit SDPA works without an eager fallback in this probe, but these rows are **not an eager-versus-SDPA comparison**, nor proof of a specific fused CUDA kernel. The original strict eager-configuration check stopped before inference; its failed receipt remains intact rather than being relabeled successful.

Private reproducible experiment: `work/voice-qwen-asr-baseline/resident_probe.py`. Completed result: `outputs/voice-comparison/qwen3-asr-resident-synthetic-v2.json`; initial pre-inference configuration mismatch: `outputs/voice-comparison/qwen3-asr-resident-synthetic.json`. The successful process exited and released GPU resources. Human ASR quality and complete conversational latency remain unaccepted.
