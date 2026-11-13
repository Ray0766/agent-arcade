"""Explicit local-file integration probe; replaces the microphone with synthetic PCM.

Not collected by the normal test suite. No capture, upload, model download or WAV output.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import threading
import time
import wave


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mode", choices=("push-to-talk", "hands-free"), default="push-to-talk")
    args = parser.parse_args()
    audio_path, output_path = Path(args.audio).resolve(), Path(args.output).resolve()
    if output_path.exists() or str(audio_path).startswith("\\\\") or audio_path.suffix.lower() != ".wav":
        raise ValueError("Use a local WAV and a new receipt path.")
    with wave.open(str(audio_path), "rb") as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or not 8000 <= wav.getframerate() <= 48000:
            raise ValueError("Expected mono PCM16 WAV at 8-48 kHz.")
        rate, frames = wav.getframerate(), wav.getnframes()
        if not 0 < frames <= rate * 60:
            raise ValueError("Audio must be at most 60 seconds.")
        pcm = wav.readframes(frames)
    # These imports handle a pre-existing test file only.
    import numpy as np
    import librosa
    signal = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    signal = librosa.resample(signal, orig_sr=rate, target_sr=16000)
    pcm = (np.clip(signal, -1, 1) * 32767).astype("<i2").tobytes()
    spec = importlib.util.spec_from_file_location("qwen_worker", Path(__file__).parents[1] / "src/voice/qwen-asr-worker.py")
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    rows, condition = [], threading.Condition()
    started = time.perf_counter()

    def emit(op_id, event, **fields):
        with condition:
            rows.append({"id": op_id, "event": event, "elapsed": round(time.perf_counter() - started, 4), **fields})
            condition.notify_all()

    class SyntheticInput:
        def __init__(self, callback):
            self.callback, self.closed = callback, False

        def start(self):
            pass

        def abort(self):
            pass

        def close(self):
            self.closed = True

    runtime = worker.Runtime(Path(args.model).resolve())
    streams = []

    def fake_input(callback):
        stream = SyntheticInput(callback)
        streams.append(stream)
        return stream

    runtime.input_stream = fake_input
    host = worker.Host(runtime, emit)
    host.dispatch({"id": "synthetic-listen", "op": "listen", "locale": "zh-CN", "mode": args.mode})
    with condition:
        if not condition.wait_for(lambda: any(row["event"] in ("listening", "error") for row in rows), timeout=90):
            raise RuntimeError("Worker did not become ready within 90 seconds.")
    if any(row["event"] == "error" for row in rows):
        raise RuntimeError("Worker failed before synthetic input.")
    for offset in range(0, len(pcm), worker.FRAME_BYTES):
        frame = pcm[offset:offset + worker.FRAME_BYTES].ljust(worker.FRAME_BYTES, b"\0")
        streams[0].callback(frame, worker.FRAME_SAMPLES, None, False)
        # Exercise the bounded real-time queue without overflowing it artificially.
        time.sleep(.002)
    if args.mode == "hands-free":
        # Synthetic trailing silence triggers the real VAD endpoint; no Finish command.
        for _ in range(45):
            streams[0].callback(bytes(worker.FRAME_BYTES), worker.FRAME_SAMPLES, None, False)
            time.sleep(.002)
    finish_requested = time.perf_counter()
    if args.mode == "push-to-talk":
        host.dispatch({"id": "synthetic-finish", "op": "finish-listening", "listenId": "synthetic-listen"})
    else:
        with condition:
            condition.wait_for(lambda: any(row["event"] in ("transcript", "error") for row in rows), timeout=30)
        host.cancel()
    host.thread.join(30)
    if host.thread.is_alive():
        host.cancel()
        raise RuntimeError("Transcription exceeded 30 seconds.")
    receipt = {"kind": "synthetic-file-through-real-provider", "humanAcceptance": False,
               "microphoneOpened": False, "uploaded": False, "audioSavedByProbe": False,
               "sourceSha256": hashlib.sha256(audio_path.read_bytes()).hexdigest(),
               "sourceSeconds": frames / rate, "mode": args.mode,
               "inputBoundaryToResultSeconds": round(time.perf_counter() - finish_requested, 4),
               "fakeInputClosed": all(stream.closed for stream in streams), "capabilities": runtime.capabilities(),
               "events": [row for row in rows if row["event"] != "audio-level"]}
    with output_path.open("x", encoding="utf-8") as out:
        json.dump(receipt, out, ensure_ascii=False, indent=2)
        out.write("\n")
    print(json.dumps(receipt, ensure_ascii=False))
    return 0 if any(row["event"] == "transcript" for row in rows) and not any(row["event"] == "error" for row in rows) else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
