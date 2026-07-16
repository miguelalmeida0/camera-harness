import io
import json
import sys
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

import app as service_app
import voice_runtime


def valid_result():
    samples = np.linspace(-0.1, 0.1, 2400, dtype=np.float32)
    audio = voice_runtime.wav_bytes(samples, 24000)
    return voice_runtime.SynthesisResult(
        audio_bytes=audio,
        sample_rate=24000,
        model_id="hexgrad/Kokoro-82M",
        model_label="Kokoro-82M",
        license="Apache-2.0",
        device="cpu",
        load_time_ms=10,
        time_to_first_audio_ms=5,
        total_generation_time_ms=20,
        peak_memory_mb=1,
        output_duration_ms=100,
    )


class FakeAdapter:
    candidate_id = "kokoro_82m"

    def __init__(self, result=None, delay=0):
        self.result = result or valid_result()
        self.delay = delay
        self.calls = 0

    def synthesize(self, _text, _profile):
        self.calls += 1
        if self.delay:
            time.sleep(self.delay)
        return self.result

    def cancel(self):
        return {"ok": True}


class FailingAdapter(FakeAdapter):
    def synthesize(self, _text, _profile):
        raise voice_runtime.VoiceRuntimeError("private runtime detail", "wav_encoding_failed")


def runtime_with(adapter):
    runtime = voice_runtime.SensefieldVoiceRuntime()
    runtime._adapter = adapter
    return runtime


class ColdRuntime(voice_runtime.SensefieldVoiceRuntime):
    def __init__(self, adapter):
        super().__init__()
        self.adapter = adapter
        self.load_calls = 0

    def _ensure_adapter(self, _candidate_id):
        if self._adapter is None:
            self.load_calls += 1
            self._adapter = self.adapter
        return self._adapter


class WarmupRuntimeTests(unittest.TestCase):
    def test_cold_initialization_loads_once(self):
        runtime = ColdRuntime(FakeAdapter())
        runtime.warmup()
        runtime.warmup()
        self.assertEqual(runtime.load_calls, 1)

    def test_warmup_is_valid_idempotent_and_not_persisted(self):
        adapter = FakeAdapter()
        runtime = runtime_with(adapter)
        with patch("builtins.open", side_effect=AssertionError("warm-up must not persist audio")):
            first = runtime.warmup()
            second = runtime.warmup()
        self.assertTrue(first["voice_warmed"])
        self.assertFalse(first["already_warm"])
        self.assertTrue(second["already_warm"])
        self.assertGreater(first["audio_bytes"], 44)
        self.assertGreater(first["audio_duration_ms"], 0)
        self.assertEqual(first["sample_rate"], 24000)
        self.assertEqual(adapter.calls, 1)

    def test_two_concurrent_warmups_share_one_synthesis(self):
        adapter = FakeAdapter(delay=0.05)
        runtime = runtime_with(adapter)
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: runtime.warmup(), range(2)))
        self.assertEqual(adapter.calls, 1)
        self.assertEqual(sorted(item["already_warm"] for item in results), [False, True])

    def test_invalid_voice_empty_audio_sample_rate_and_wav_failure(self):
        runtime = runtime_with(FakeAdapter())
        with self.assertRaisesRegex(voice_runtime.VoiceRuntimeError, "requested voice") as invalid_voice:
            runtime.synthesize("Hello.", voice="not_a_voice")
        self.assertEqual(invalid_voice.exception.code, "voice_not_found")

        empty = valid_result()
        empty.audio_bytes = b""
        empty.output_duration_ms = 0
        with self.assertRaises(voice_runtime.VoiceRuntimeError) as empty_error:
            runtime_with(FakeAdapter(empty)).warmup()
        self.assertEqual(empty_error.exception.code, "synthesis_empty")

        invalid_rate = valid_result()
        invalid_rate.sample_rate = 0
        with self.assertRaises(voice_runtime.VoiceRuntimeError) as rate_error:
            runtime_with(FakeAdapter(invalid_rate)).warmup()
        self.assertEqual(rate_error.exception.code, "invalid_sample_rate")

        with patch.object(voice_runtime.sf, "write", side_effect=OSError("encoder unavailable")):
            with self.assertRaises(voice_runtime.VoiceRuntimeError) as wav_error:
                voice_runtime.wav_bytes(np.ones(100, dtype=np.float32), 24000)
        self.assertEqual(wav_error.exception.code, "wav_encoding_failed")

    def test_speak_and_stream_remain_available_after_warmup(self):
        runtime = runtime_with(FakeAdapter())
        with patch.object(service_app, "voice_runtime", runtime):
            with TestClient(service_app.app) as client:
                warmup = client.post("/warmup")
                speak = client.post("/speak", json={"text": "Sensefield response.", "voice": "sensefield_default"})
                stream = client.post("/speak-stream", json={"text": "First sentence. Second sentence.", "voice": "sensefield_default"})
        self.assertEqual(warmup.status_code, 200)
        self.assertTrue(warmup.json()["voice_warmed"])
        self.assertEqual(speak.status_code, 200)
        self.assertTrue(speak.headers["content-type"].startswith("audio/wav"))
        self.assertGreater(len(speak.content), 44)
        events = [json.loads(line) for line in stream.text.splitlines() if line]
        self.assertTrue(events)
        self.assertTrue(all(event["type"] == "audio" for event in events))

    def test_warmup_failure_returns_safe_actionable_stage(self):
        runtime = runtime_with(FailingAdapter())
        with patch.object(service_app, "voice_runtime", runtime), patch.object(service_app.logger, "exception") as logged:
            with TestClient(service_app.app) as client:
                response = client.post("/warmup")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "wav_encoding_failed")
        self.assertEqual(response.json()["safe_error"], "Neural voice synthesis could not encode WAV audio.")
        self.assertNotIn("private runtime detail", response.text)
        logged.assert_called_once()


class DirectKokoroTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = voice_runtime.KokoroAdapter().load()
        cls.result = cls.adapter.synthesize("Sensefield is ready.", voice_runtime.VOICE_PROFILE)

    def test_configured_voice_exists(self):
        self.assertIn(voice_runtime.VOICE_PROFILE["voice"], self.adapter.pipeline.voices)

    def test_direct_synthesis_is_finite_nonempty_valid_wav(self):
        self.assertEqual(self.result.sample_rate, 24000)
        self.assertGreater(self.result.output_duration_ms, 0)
        self.assertGreater(len(self.result.audio_bytes), 44)
        self.assertEqual(self.result.audio_bytes[:4], b"RIFF")
        self.assertEqual(self.result.audio_bytes[8:12], b"WAVE")
        samples, sample_rate = sf.read(io.BytesIO(self.result.audio_bytes), dtype="float32")
        self.assertEqual(sample_rate, 24000)
        self.assertGreater(samples.size, 0)
        self.assertTrue(np.isfinite(samples).all())


if __name__ == "__main__":
    unittest.main(verbosity=2)
