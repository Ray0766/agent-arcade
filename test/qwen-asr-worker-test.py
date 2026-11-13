"""Standard-library fake-device tests. Never open a microphone or load a model."""
import importlib.util
import json
from pathlib import Path
import struct
import sys
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location("qwen_worker", Path(__file__).parents[1] / "src/voice/qwen-asr-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class Vad:
    def is_speech(self, frame, rate):
        return frame[0] == 1


class FakeStream:
    def __init__(self, callback):
        self.callback = callback
        self.started = self.closed = False

    def start(self):
        self.started = True

    def abort(self):
        self.started = False

    def close(self):
        self.closed = True

    def frame(self, voiced=True):
        data = (b"\x01\x00" if voiced else b"\x00\x00") * worker.FRAME_SAMPLES
        self.callback(data, worker.FRAME_SAMPLES, None, False)


class Runtime:
    def __init__(self):
        self.stream = None
        self.loads = self.transcriptions = 0
        self.inference_started = threading.Event()
        self.inference_gate = None

    def capabilities(self):
        return {"handsFree": False, "manualReview": True}

    def load(self):
        self.loads += 1

    def detector(self, hands_free=False):
        return worker.OnsetDetector(Vad(), required=6 if hands_free else 3, window=8 if hands_free else 5)

    def input_stream(self, callback):
        self.stream = FakeStream(callback)
        return self.stream

    def transcribe(self, audio, locale):
        assert self.stream.closed or getattr(self, "allow_open", False), "manual microphone must close before inference"
        self.transcriptions += 1
        self.inference_started.set()
        if self.inference_gate:
            self.inference_gate.wait(2)
        return "synthetic fixture"


class HostTests(unittest.TestCase):
    def setUp(self):
        self.runtime = Runtime()
        self.events = []
        self.host = worker.Host(self.runtime, lambda op_id, event, **fields: self.events.append({"id": op_id, "event": event, **fields}))

    def wait_event(self, event):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if any(row["event"] == event for row in self.events):
                return
            time.sleep(.002)
        self.fail("missing event " + event)

    def start(self, mode="push-to-talk"):
        self.host.dispatch({"id": "listen-a", "op": "listen", "locale": "zh-CN", "mode": mode})
        self.wait_event("listening")

    def finish(self):
        self.host.dispatch({"id": "finish-a", "op": "finish-listening", "listenId": "listen-a"})
        self.host.thread.join(2)
        self.assertFalse(self.host.thread.is_alive())

    def test_capabilities_do_not_load_or_capture(self):
        self.host.dispatch({"id": "c", "op": "capabilities"})
        self.assertIsNone(self.runtime.stream)
        self.assertEqual(self.runtime.loads, 0)

    def test_load_runs_on_dispatch_thread_before_capture_thread(self):
        dispatch_thread = threading.get_ident()
        stages = []
        original_stream = self.runtime.input_stream

        def load():
            stages.append(("load", threading.get_ident()))
            self.assertIsNone(self.runtime.stream)
            self.assertIsNone(self.host.thread)

        def input_stream(callback):
            stages.append(("input", threading.get_ident()))
            return original_stream(callback)

        self.runtime.load = load
        self.runtime.input_stream = input_stream
        self.start()
        self.assertEqual([name for name, _ in stages], ["load", "input"])
        self.assertEqual(stages[0][1], dispatch_thread)
        self.assertNotEqual(stages[1][1], dispatch_thread)
        self.host.cancel()
        self.host.thread.join(2)

    def test_load_failure_is_structured_and_does_not_leave_busy_capture(self):
        def fail():
            raise RuntimeError("private dependency details must not reach protocol")

        original_load = self.runtime.load
        self.runtime.load = fail
        self.host.dispatch({"id": "failed", "op": "listen", "locale": "zh-CN"})
        self.assertIsNone(self.runtime.stream)
        self.assertIsNone(self.host.thread)
        self.assertIsNone(self.host.current)
        self.assertFalse(self.host.running)
        self.assertEqual(self.events, [
            {"id": "failed", "event": "loading"},
            {"id": "failed", "event": "error", "code": "voice_unavailable"},
        ])
        self.runtime.load = original_load
        self.start()
        self.host.cancel()
        self.host.thread.join(2)

    def test_finish_closes_before_inference_and_clears_audio(self):
        self.start()
        capture = self.host.current
        for _ in range(5):
            self.runtime.stream.frame()
        self.finish()
        self.assertTrue(self.runtime.stream.closed)
        self.assertEqual(self.runtime.transcriptions, 1)
        self.assertEqual(len(capture.audio), 0)
        order = [row["event"] for row in self.events]
        self.assertLess(order.index("microphone-closed"), order.index("transcript"))
        self.assertTrue(next(row for row in self.events if row["event"] == "finishing")["microphoneClosed"])
        self.assertIsNone(self.host.current)

    def test_silence_does_not_call_model(self):
        self.start()
        for _ in range(5):
            self.runtime.stream.frame(False)
        self.finish()
        self.assertEqual(self.runtime.transcriptions, 0)
        self.assertIn("unrecognized", [row["event"] for row in self.events])

    def test_cancel_during_inference_suppresses_late_result(self):
        self.runtime.inference_gate = threading.Event()
        self.start()
        for _ in range(3):
            self.runtime.stream.frame()
        self.host.dispatch({"id": "f", "op": "finish-listening", "listenId": "listen-a"})
        self.assertTrue(self.runtime.inference_started.wait(2))
        self.host.cancel()
        self.runtime.inference_gate.set()
        self.host.thread.join(2)
        self.assertNotIn("transcript", [row["event"] for row in self.events])
        self.assertTrue(self.runtime.stream.closed)

    def test_stale_finish_does_not_close_active_capture(self):
        self.start()
        self.host.dispatch({"id": "f", "op": "finish-listening", "listenId": "old"})
        self.assertFalse(self.runtime.stream.closed)
        self.assertFalse(self.host.current.finishing.is_set())
        self.host.cancel()
        self.host.thread.join(2)
        self.assertTrue(self.runtime.stream.closed)

    def test_queue_and_pcm_are_bounded(self):
        capture = worker.Capture("c", "zh-CN")
        for _ in range(101):
            capture.callback(b"\0" * worker.FRAME_BYTES, worker.FRAME_SAMPLES, None, False)
        self.assertEqual(capture.frames.qsize(), 100)
        self.assertEqual(capture.failure, "voice_audio_overflow")
        capture.audio = bytearray(worker.MAX_BYTES)
        with self.assertRaisesRegex(worker.VoiceFailure, "voice_capture_limit"):
            self.host.consume(capture, worker.OnsetDetector(Vad()), b"\0" * worker.FRAME_BYTES, [0, 0, 0])
        self.assertEqual(len(capture.audio), worker.MAX_BYTES)

    def test_onset_uses_voiced_frame_quorum_and_rearms(self):
        detector = worker.OnsetDetector(Vad())
        voiced, silence = b"\1\0" * worker.FRAME_SAMPLES, b"\0\0" * worker.FRAME_SAMPLES
        # A single classified transient, or high-volume unvoiced PCM, is insufficient.
        self.assertFalse(detector.feed(voiced))
        for _ in range(5):
            self.assertFalse(detector.feed(b"\xff\x7f" * worker.FRAME_SAMPLES))
        self.assertFalse(detector.feed(voiced))
        self.assertFalse(detector.feed(voiced))
        self.assertTrue(detector.feed(voiced))
        self.assertFalse(detector.feed(voiced))
        for _ in range(15):
            self.assertFalse(detector.feed(silence))
        self.assertFalse(detector.feed(voiced))
        self.assertFalse(detector.feed(voiced))
        self.assertTrue(detector.feed(voiced))

    def test_hands_free_segments_without_closing_input(self):
        self.runtime.allow_open = True
        self.start("hands-free")
        for _ in range(10):
            self.runtime.stream.frame()
        for _ in range(30):
            self.runtime.stream.frame(False)
        self.wait_event("transcript")
        self.assertFalse(self.runtime.stream.closed)
        self.assertEqual(self.runtime.transcriptions, 1)
        self.assertEqual(next(row for row in self.events if row["event"] == "transcript")["utteranceId"], 1)
        self.host.cancel()
        self.host.thread.join(2)
        self.assertTrue(self.runtime.stream.closed)

    def test_new_onset_while_asr_busy_drops_old_result_and_bounds_queue(self):
        self.runtime.allow_open = True
        self.runtime.inference_gate = threading.Event()
        self.start("hands-free")

        def utterance():
            for _ in range(10):
                self.runtime.stream.frame()
            for _ in range(30):
                self.runtime.stream.frame(False)

        utterance()
        self.assertTrue(self.runtime.inference_started.wait(2))
        utterance()
        deadline = time.monotonic() + 2
        while self.host.current.utterance < 2 and time.monotonic() < deadline:
            time.sleep(.002)
        self.assertEqual(self.host.current.utterance, 2, "VAD must continue during ASR")
        utterance()
        deadline = time.monotonic() + 2
        while self.host.current.utterance < 3 and time.monotonic() < deadline:
            time.sleep(.002)
        self.assertEqual(self.host.current.utterance, 3)
        self.assertLessEqual(self.host.current.segments.qsize(), 1)
        self.runtime.inference_gate.set()
        self.wait_event("transcript")
        transcripts = [row for row in self.events if row["event"] == "transcript"]
        self.assertEqual([row["utteranceId"] for row in transcripts], [3])
        self.assertEqual(self.runtime.transcriptions, 2)
        self.host.cancel()
        self.host.thread.join(2)

    def test_hands_free_short_long_and_recovery_boundaries(self):
        segmenter = worker.Segmenter(worker.OnsetDetector(Vad(), required=6, window=8))
        voiced, silence = b"\1\0" * worker.FRAME_SAMPLES, b"\0\0" * worker.FRAME_SAMPLES
        self.assertEqual([segmenter.feed(voiced) for _ in range(5)], [None] * 5)
        self.assertEqual(segmenter.feed(voiced), {"kind": "onset"})
        short = [segmenter.feed(silence) for _ in range(30)][-1]
        self.assertEqual(short, {"kind": "discard", "reason": "segment-too-short"})
        events = [segmenter.feed(voiced) for _ in range(1200)]
        self.assertEqual(sum(bool(row and row.get("reason") == "segment-too-long") for row in events), 1)
        self.assertEqual(len(segmenter.audio), 0)
        self.assertTrue(segmenter.blocked, "never submit a truncated tail as a new request")
        for _ in range(30):
            segmenter.feed(silence)
        self.assertFalse(segmenter.blocked)
        self.assertEqual([segmenter.feed(voiced) for _ in range(6)][-1], {"kind": "onset"})

    def test_hands_free_session_deadline_closes_input(self):
        current = [0]
        self.host.now = lambda: current[0]
        self.runtime.allow_open = True
        self.start("hands-free")
        current[0] = 601
        self.wait_event("error")
        self.host.thread.join(2)
        self.assertTrue(self.runtime.stream.closed)
        self.assertEqual(next(row for row in self.events if row["event"] == "error")["code"], "voice_listen_timeout")


def real_vad_controls():
    """Optional installed-WebRTC check; generated PCM only, no audio device/model."""
    import webrtcvad
    results = []
    controls = [("silence", [bytes(640)] * 100),
                ("one-sample-impulse", [bytes(640)] * 20 + [struct.pack("<h", 32767) + bytes(638)] + [bytes(640)] * 80),
                ("one-frame-fullscale", [bytes(640)] * 20 + [struct.pack("<h", 32767) * 320] + [bytes(640)] * 80)]
    for name, frames in controls:
        segmenter = worker.Segmenter(worker.OnsetDetector(webrtcvad.Vad(2), required=6, window=8))
        events = []
        for index, frame in enumerate(frames):
            row = segmenter.feed(frame)
            if row:
                events.append({"frame": index, "kind": row["kind"], "reason": row.get("reason")})
        results.append({"syntheticKind": name, "events": events})
    print(json.dumps({"kind": "synthetic-vad-controls", "microphoneOpened": False, "modelLoaded": False,
                      "humanAcceptance": False, "results": results}))
    return 0 if all(not row["events"] for row in results) else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--real-vad-controls"]:
        raise SystemExit(real_vad_controls())
    unittest.main()
