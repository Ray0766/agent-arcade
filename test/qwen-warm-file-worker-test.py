"""Standard-library-only protocol fixtures. No model, network or audio device."""
import base64
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("warm_worker", Path(__file__).resolve().parent.parent / 'src' / 'voice' / 'qwen-warm-file-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
NONCE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
ONE = "11111111-1111-1111-1111-111111111111"
TWO = "22222222-2222-2222-2222-222222222222"


def row(job=ONE, value=1):
    return {"version": 1, "nonce": NONCE, "event": "transcribe", "id": job,
            "sampleRate": 16000, "locale": "zh-CN", "pcm": base64.b64encode(bytes([value]) * 6400).decode("ascii")}


class Runtime:
    def __init__(self, fail=False):
        self.calls = []
        self.refs = []
        self.fail = fail

    def transcribe(self, pcm, rate, locale):
        self.calls.append((pcm[0], rate, locale))
        self.refs.append(pcm)
        if self.fail:
            raise RuntimeError("private error should not escape")
        return "first" if pcm[0] == 1 else "second"


def execute(rows, runtime=None):
    runtime = runtime or Runtime()
    source = io.StringIO("".join(json.dumps(value) + "\n" for value in rows))
    output = io.StringIO()
    code = worker.run(source, output, runtime, NONCE, 3, 2)
    return code, [json.loads(line) for line in output.getvalue().splitlines()], runtime


class WorkerTests(unittest.TestCase):
    def test_two_jobs_have_no_shared_pcm_and_clear_buffers_before_clean_ack(self):
        code, events, runtime = execute([row(), row(TWO, 2)])
        self.assertEqual(code, 0)
        self.assertEqual([e["event"] for e in events], ["ready", "transcript", "job-clean", "transcript", "job-clean"])
        self.assertEqual([e["text"] for e in events if "text" in e], ["first", "second"])
        self.assertEqual(runtime.calls, [(1, 16000, "zh-CN"), (2, 16000, "zh-CN")])
        self.assertIsNot(runtime.refs[0], runtime.refs[1])
        self.assertTrue(all(not any(buffer) for buffer in runtime.refs))
        self.assertEqual(events[0]["modelLoaded"], False)
        self.assertTrue(all(e["nonce"] == NONCE and e["version"] == 1 for e in events))

    def test_invalid_nonce_or_unknown_fields_never_reach_inference(self):
        for update in ({"nonce": ONE}, {"version": 2}, {"event": "cancel"}, {"history": []}, {"sampleRate": True}, {"locale": "arbitrary"}):
            with self.subTest(update=update):
                value = row(); value.update(update)
                code, events, runtime = execute([value, row(TWO)])
                self.assertEqual(code, 1)
                self.assertEqual(runtime.calls, [])
                self.assertEqual([e["event"] for e in events], ["ready", "error"])

    def test_reused_job_id_stops_worker_instead_of_processing_later_job(self):
        code, events, runtime = execute([row(), row(), row(TWO, 2)])
        self.assertEqual(code, 1)
        self.assertEqual(len(runtime.calls), 1)
        self.assertEqual(events[-1]["code"], "invalid_response")

    def test_bad_pcm_duration_and_encoding_fail_without_inference(self):
        for pcm in ("?", base64.b64encode(b"x").decode(), base64.b64encode(b"x" * 6402).decode()):
            value = row(); value["pcm"] = pcm
            if len(pcm) > 100:
                value["sampleRate"] = 48000
            code, _events, runtime = execute([value])
            self.assertEqual(code, 1)
            self.assertEqual(runtime.calls, [])

    def test_runtime_error_clears_pcm_and_does_not_emit_private_error_or_clean(self):
        code, events, runtime = execute([row()], Runtime(fail=True))
        self.assertEqual(code, 1)
        self.assertEqual(events[-1]["code"], "asr_failed")
        self.assertNotIn("private", json.dumps(events))
        self.assertTrue(all(not any(buffer) for buffer in runtime.refs))
        self.assertNotIn("job-clean", [e["event"] for e in events])

    def test_oversized_line_and_incomplete_line_stop_without_inference(self):
        for value in ("x" * (worker.MAX_LINE + 1), json.dumps(row())):
            output = io.StringIO(); runtime = Runtime()
            self.assertEqual(worker.run(io.StringIO(value), output, runtime, NONCE, 3, 2), 1)
            self.assertEqual(runtime.calls, [])

    def test_loader_creates_one_model_without_prior_transcript_or_device_imports(self):
        calls = []
        class Model:
            @staticmethod
            def from_pretrained(*args, **kwargs):
                calls.append((args, kwargs))
                return object()
        fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True), set_num_threads=lambda _n: None, bfloat16="fake-bfloat16")
        with tempfile.TemporaryDirectory(prefix="arcade-warm-loader-") as directory:
            for name in ("config.json", "model.safetensors", "preprocessor_config.json"):
                Path(directory, name).write_text("synthetic", encoding="utf-8")
            with patch.dict(sys.modules, {"torch": fake_torch, "qwen_asr": types.SimpleNamespace(Qwen3ASRModel=Model)}), patch.object(worker.importlib.metadata, "version", side_effect=lambda name: {"qwen-asr": "0.0.6", "transformers": "4.57.6"}[name]):
                runtime = worker.ModelRuntime(directory)
                self.assertEqual(calls, [])
                runtime.load(); original = runtime.model; runtime.load()
                self.assertIs(runtime.model, original)
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0][1]["local_files_only"], True)
                self.assertEqual(calls[0][1]["trust_remote_code"], False)
                self.assertNotIn("history", calls[0][1])
        self.assertNotIn("sounddevice", sys.modules)

    def test_lifetime_job_bound_refuses_extra_request(self):
        with patch.object(worker, "MAX_JOBS", 1):
            code, events, runtime = execute([row(), row(TWO, 2)])
            self.assertEqual(code, 1)
            self.assertEqual(len(runtime.calls), 1)
            self.assertEqual(events[-1]["code"], "invalid_response")


if __name__ == "__main__":
    unittest.main()
