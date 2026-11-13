"""Pure protocol tests: no dependencies/model/device/network are loaded."""
import base64
import importlib.util
from pathlib import Path
import sys
import unittest

spec = importlib.util.spec_from_file_location("file_worker", Path(__file__).resolve().parent.parent / "src" / "voice" / "qwen-file-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class FixtureRuntime:
    def __init__(self):
        self.pcm = None

    def transcribe(self, pcm, rate, locale):
        self.pcm = pcm
        assert rate == 16000 and locale == "zh-CN" and len(pcm) == 8000
        return "合成协议夹具，不是真人语音"


class Tests(unittest.TestCase):
    def row(self):
        return {"id": "12345678-1234-1234-1234-123456789abc", "pcm": base64.b64encode(b"\1" * 8000).decode(), "sampleRate": 16000, "locale": "zh-CN"}

    def test_bounded_memory_and_zero_after_result(self):
        runtime = FixtureRuntime()
        result = worker.process(self.row(), runtime)
        self.assertEqual(result["event"], "transcript")
        self.assertFalse(any(runtime.pcm))

    def test_no_audio_or_model_import_on_protocol_load(self):
        for name in ("sounddevice", "webrtcvad", "torch", "qwen_asr", "numpy"):
            self.assertNotIn(name, sys.modules)

    def test_bad_shapes_formats_and_limit(self):
        for patch in ({"pcm": "%%%"}, {"pcm": ""}, {"sampleRate": 8000}, {"sampleRate": True}, {"pcm": base64.b64encode(b"\0" * (16000 * 60 + 2)).decode()}, {"path": "PRIVATE"}):
            with self.assertRaises(worker.FileVoiceError):
                worker.request_pcm({**self.row(), **patch})

    def test_zero_even_on_inference_error(self):
        class Broken(FixtureRuntime):
            def transcribe(self, pcm, rate, locale):
                self.pcm = pcm
                raise ValueError("synthetic")
        runtime = Broken()
        with self.assertRaises(ValueError):
            worker.process(self.row(), runtime)
        self.assertFalse(any(runtime.pcm))


if __name__ == "__main__":
    unittest.main()
