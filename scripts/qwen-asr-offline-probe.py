"""Bounded local-file Qwen3-ASR probe. No microphone, server, or audio upload.

Use a dedicated environment, not the Qwen TTS environment. See QWEN_ASR_PROBE.md.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time

# Apply before importing any model library. Missing files fail locally instead
# of turning an offline test into a model/tokenizer download.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["DO_NOT_TRACK"] = "1"
sys.dont_write_bytecode = True
for console in (sys.stdout, sys.stderr):
    if hasattr(console, "reconfigure"):
        console.reconfigure(encoding="utf-8", errors="replace")

MODEL_REPOSITORY = "Qwen/Qwen3-ASR-0.6B"
MODEL_REVISION = "5eb144179a02acc5e5ba31e748d22b0cf3e303b0"
PACKAGES = ("qwen-asr", "transformers", "accelerate", "torch", "torchaudio", "soundfile", "librosa")


def versions():
    values = {}
    for package in PACKAGES:
        try:
            values[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            values[package] = None
    return values


def local_path(value, directory=False):
    if "://" in value or value.startswith(("\\\\", "//")):
        raise ValueError("Use a local disk path, not a URL or network share.")
    result = Path(value).resolve(strict=True)
    if (directory and not result.is_dir()) or (not directory and not result.is_file()):
        raise ValueError("Input path has the wrong type.")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-environment", action="store_true", help="Print package versions only; load no model/audio.")
    parser.add_argument("--model", help="Complete local official 0.6B model directory.")
    parser.add_argument("--audio", help="Owner-approved local WAV, at most 60 seconds.")
    parser.add_argument("--input-kind", choices=("synthetic", "human-file"), help="Synthetic speech is never human ASR acceptance.")
    parser.add_argument("--output", help="New private JSON receipt; existing files are never overwritten.")
    parser.add_argument("--device", choices=("cuda:0", "cpu"), default="cuda:0")
    parser.add_argument("--language", choices=("Chinese", "auto"), default="Chinese")
    args = parser.parse_args()
    environment = {"python": sys.version.split()[0], "packages": versions()}
    if args.check_environment:
        print(json.dumps(environment, ensure_ascii=False, indent=2))
        return
    if not all((args.model, args.audio, args.input_kind, args.output)):
        parser.error("--model, --audio, --input-kind and --output are required for inference.")
    if environment["packages"]["qwen-asr"] != "0.0.6" or environment["packages"]["transformers"] != "4.57.6":
        raise ValueError("Use the dedicated qwen-asr 0.0.6 / transformers 4.57.6 environment.")

    model_dir = local_path(args.model, directory=True)
    audio_path = local_path(args.audio)
    if audio_path.suffix.lower() != ".wav" or audio_path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("Choose a WAV smaller than 32 MiB.")
    config = json.loads((model_dir / "config.json").read_text(encoding="utf-8"))
    if config.get("model_type") != "qwen3_asr" or not (model_dir / "model.safetensors").is_file():
        raise ValueError("Expected the original Qwen3-ASR safetensors checkpoint, not the native -hf variant.")
    output = Path(args.output).resolve()
    if output.exists():
        raise FileExistsError("Choose a new receipt path.")
    if not output.parent.is_dir():
        raise ValueError("Create the private output directory before running the probe.")

    import numpy as np
    import soundfile as sf
    import torch
    from qwen_asr import Qwen3ASRModel

    info = sf.info(str(audio_path))
    if info.frames <= 0 or not 0 < info.duration <= 60 or info.channels not in (1, 2) or not 8000 <= info.samplerate <= 48000:
        raise ValueError("Expected nonempty mono/stereo WAV, at most 60 seconds, 8-48 kHz.")
    samples, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=True)
    samples = samples.mean(axis=1)
    if not np.isfinite(samples).all():
        raise ValueError("Audio contains invalid samples.")
    use_cuda = args.device.startswith("cuda")
    if use_cuda and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable; no silent device fallback.")
    dtype = torch.bfloat16 if use_cuda else torch.float32
    if use_cuda:
        torch.cuda.reset_peak_memory_stats()
    started = time.perf_counter()
    model = Qwen3ASRModel.from_pretrained(
        str(model_dir), dtype=dtype, device_map=args.device,
        attn_implementation="eager", local_files_only=True,
        trust_remote_code=False, use_safetensors=True,
        max_inference_batch_size=1, max_new_tokens=256,
    )
    if use_cuda:
        torch.cuda.synchronize()
    loaded = time.perf_counter()
    attention_configurations = {}
    for module in model.model.modules():
        if module.__class__.__name__.endswith("Attention"):
            implementation = getattr(getattr(module, "config", None), "_attn_implementation", None)
            key = f"{module.__class__.__name__}:{implementation}"
            attention_configurations[key] = attention_configurations.get(key, 0) + 1
    with torch.inference_mode():
        results = model.transcribe(audio=(samples, sample_rate), language=None if args.language == "auto" else args.language)
    if use_cuda:
        torch.cuda.synchronize()
    finished = time.perf_counter()
    if len(results) != 1:
        raise RuntimeError("Expected exactly one local-file transcription.")
    result = results[0]
    receipt = {
        "kind": "private-offline-qwen-asr-probe", "private": True,
        "modelRepository": MODEL_REPOSITORY, "intendedModelRevision": MODEL_REVISION,
        "modelRevisionVerification": "Use the separate fixed-revision download/hash receipt; this probe does not rehash all weights.",
        "inputKind": args.input_kind, "humanRecognitionAccepted": False,
        "microphoneOpened": False, "listeningServerStarted": False, "audioUploaded": False,
        "automaticModelDownloadsDisabled": True, "environment": environment,
        "device": args.device, "gpuName": torch.cuda.get_device_name(0) if use_cuda else None,
        "attentionRequested": "eager", "attentionModuleConfigurations": attention_configurations,
        "audioSha256": hashlib.sha256(audio_path.read_bytes()).hexdigest(),
        "audioSeconds": info.duration, "sampleRate": sample_rate, "originalChannels": info.channels,
        "loadSeconds": round(loaded - started, 4), "inferenceSeconds": round(finished - loaded, 4),
        "realTimeFactor": round((finished - loaded) / info.duration, 4),
        "peakCudaAllocatedBytes": torch.cuda.max_memory_allocated() if use_cuda else None,
        "language": result.language, "transcript": result.text,
        "limits": ["One file, no microphone or conversation integration.",
                   "Synthetic speech cannot establish human ASR accuracy or robustness.",
                   "Cold model loading and inference measured separately; not streaming or first-audible latency.",
                   "Offline library settings are not an OS-level network sandbox."]}
    with output.open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({"receipt": str(output), "inputKind": args.input_kind,
                      "loadSeconds": receipt["loadSeconds"], "inferenceSeconds": receipt["inferenceSeconds"],
                      "language": result.language, "transcript": result.text}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"failed": True, "errorType": type(error).__name__, "message": str(error)[:400]}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
