import io
import os
import platform
import re
import threading
import time
from dataclasses import dataclass
from importlib import util as importlib_util
from typing import Any, Dict, List, Optional

import numpy as np
import soundfile as sf


BENCHMARK_PHRASES = [
    "You formed a heart shape with your hands.",
    "You picked the object back up. Would you like me to start a timer?",
    "I’m not completely sure what changed. Try showing me again.",
]

VOICE_PROFILE = {
    "id": "sensefield_default",
    "style": "warm_conversational",
    "delivery": "warm neutral, moderate pace, clear, lightly expressive",
    "voice": "af_heart",
    "pace": 0.95,
    "clone_or_imitation": False,
}

VOICE_CANDIDATES = [
    {
        "id": "chatterbox_multilingual_v3",
        "label": "Chatterbox Multilingual V3",
        "license": "MIT",
        "model": "ResembleAI/chatterbox",
        "priority": 1,
        "package": "chatterbox",
        "heavy": True,
    },
    {
        "id": "chatterbox_turbo",
        "label": "Chatterbox Turbo",
        "license": "MIT",
        "model": "chatterbox-turbo",
        "priority": 2,
        "package": "chatterbox",
        "heavy": True,
    },
    {
        "id": "cosyvoice3",
        "label": "CosyVoice 3",
        "license": "Apache-2.0",
        "model": "FunAudioLLM/CosyVoice3",
        "priority": 3,
        "package": "cosyvoice",
        "heavy": True,
    },
    {
        "id": "kokoro_82m",
        "label": "Kokoro-82M",
        "license": "Apache-2.0",
        "model": "hexgrad/Kokoro-82M",
        "priority": 4,
        "package": "kokoro",
        "heavy": False,
    },
]


class VoiceRuntimeError(RuntimeError):
    pass


@dataclass
class SynthesisResult:
    audio_bytes: bytes
    sample_rate: int
    model_id: str
    model_label: str
    license: str
    device: str
    load_time_ms: int
    time_to_first_audio_ms: int
    total_generation_time_ms: int
    peak_memory_mb: int
    output_duration_ms: int


class SensefieldVoiceRuntime:
    def __init__(self, selected_model: Optional[str] = None, allow_fallback: bool = False):
        self.selected_model = selected_model or os.getenv("SENSEFIELD_VOICE_MODEL", "kokoro_82m")
        self.allow_fallback = allow_fallback
        self.profile = dict(VOICE_PROFILE)
        self._adapter = None
        self._load_error = ""
        self._cancelled_at = 0.0
        self._cancel_generation = 0
        self._warmed = False
        self._warmup_lock = threading.Lock()

    def health(self, lazy: bool = True) -> Dict[str, Any]:
        candidate = candidate_by_id(self.selected_model) or candidate_by_id("kokoro_82m")
        installed = candidate_package_installed(candidate)
        loaded = self._adapter is not None
        status = "ready" if loaded else "configured" if installed else "not_installed"
        return {
            "voice_ready": installed or loaded,
            "voice_status": status,
            "voice_warmed": self._warmed,
            "voice_engine": candidate["id"],
            "voice_model": candidate["model"],
            "voice_license": candidate["license"],
            "voice_profile": self.profile,
            "voice_safe_error": self._load_error[:240],
            "voice_fallback_chain": self.fallback_chain(),
            "hardware": detect_voice_hardware(),
        }

    def voices(self) -> Dict[str, Any]:
        return {
            "default_voice": self.profile["id"],
            "profiles": [self.profile],
            "selected_model": self.selected_model,
            "fallback_chain": self.fallback_chain(),
            "candidates": candidate_statuses(),
        }

    def fallback_chain(self) -> List[str]:
        return [self.selected_model]

    def cancel(self) -> Dict[str, Any]:
        self._cancelled_at = time.time()
        self._cancel_generation += 1
        adapter = self._adapter
        if adapter and hasattr(adapter, "cancel"):
            adapter.cancel()
        return {"ok": True, "cancelled": True}

    def cancellation_generation(self) -> int:
        return self._cancel_generation

    def is_cancelled(self, generation: int) -> bool:
        return generation != self._cancel_generation

    def warmup(self) -> Dict[str, Any]:
        with self._warmup_lock:
            if self._warmed:
                return {"ok": True, "voice_warmed": True, "already_warm": True}
            started = time.time()
            result = self.synthesize("Sensefield is ready.")
            self._warmed = True
            return {
                "ok": True,
                "voice_warmed": True,
                "already_warm": False,
                "warmup_ms": int((time.time() - started) * 1000),
                "audio_duration_ms": result.output_duration_ms,
            }

    def synthesize(self, text: str, observation_id: str = "", voice: str = "sensefield_default", style: str = "warm_conversational") -> SynthesisResult:
        clean_text = prepare_spoken_text(text)
        if not clean_text:
            raise VoiceRuntimeError("No speakable text supplied.")
        try:
            adapter = self._ensure_adapter(self.selected_model)
            result = adapter.synthesize(clean_text, self.profile)
            self._warmed = True
            return result
        except Exception as error:
            self._load_error = f"{self.selected_model}: {error}"
            self._adapter = None
            raise VoiceRuntimeError(str(error)) from error

    def _ensure_adapter(self, candidate_id: str):
        if self._adapter and self._adapter.candidate_id == candidate_id:
            return self._adapter
        if candidate_id == "kokoro_82m":
            self._adapter = KokoroAdapter().load()
            return self._adapter
        if candidate_id.startswith("chatterbox"):
            self._adapter = ChatterboxAdapter(candidate_id).load()
            return self._adapter
        if candidate_id == "cosyvoice3":
            raise VoiceRuntimeError("CosyVoice 3 is not installed in this local runtime.")
        raise VoiceRuntimeError(f"Unsupported voice model: {candidate_id}")


class KokoroAdapter:
    candidate_id = "kokoro_82m"

    def __init__(self):
        self.pipeline = None
        self.load_time_ms = 0
        self.device = os.getenv("SENSEFIELD_VOICE_DEVICE", "cpu")
        self.sample_rate = 24000

    def load(self):
        started = time.time()
        from kokoro import KPipeline

        self.pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device=self.device)
        self.load_time_ms = int((time.time() - started) * 1000)
        return self

    def synthesize(self, text: str, profile: Dict[str, Any]) -> SynthesisResult:
        if self.pipeline is None:
            self.load()
        started = time.time()
        first_audio_ms = 0
        chunks = []
        for _graphemes, _phonemes, audio in self.pipeline(text, voice=profile["voice"], speed=profile["pace"]):
            if not first_audio_ms:
                first_audio_ms = int((time.time() - started) * 1000)
            chunks.append(np.asarray(audio, dtype=np.float32))
        if not chunks:
            raise VoiceRuntimeError("Kokoro did not return audio.")
        waveform = np.concatenate(chunks)
        wav = wav_bytes(waveform, self.sample_rate)
        duration_ms = int((len(waveform) / self.sample_rate) * 1000)
        return SynthesisResult(
            audio_bytes=wav,
            sample_rate=self.sample_rate,
            model_id="hexgrad/Kokoro-82M",
            model_label="Kokoro-82M",
            license="Apache-2.0",
            device=self.device,
            load_time_ms=self.load_time_ms,
            time_to_first_audio_ms=first_audio_ms,
            total_generation_time_ms=int((time.time() - started) * 1000),
            peak_memory_mb=current_rss_mb(),
            output_duration_ms=duration_ms,
        )

    def cancel(self):
        return {"ok": True}


class ChatterboxAdapter:
    def __init__(self, candidate_id: str):
        self.candidate_id = candidate_id
        self.model = None
        self.load_time_ms = 0
        self.device = preferred_torch_device()

    def load(self):
        started = time.time()
        from chatterbox.tts import ChatterboxTTS

        self.model = ChatterboxTTS.from_pretrained(device=self.device)
        self.load_time_ms = int((time.time() - started) * 1000)
        return self

    def synthesize(self, text: str, profile: Dict[str, Any]) -> SynthesisResult:
        import torch

        if self.model is None:
            self.load()
        started = time.time()
        wav = self.model.generate(text)
        first_audio_ms = int((time.time() - started) * 1000)
        if hasattr(wav, "detach"):
            wav = wav.detach().cpu()
        if len(getattr(wav, "shape", [])) == 1:
            wav = wav.unsqueeze(0) if hasattr(wav, "unsqueeze") else np.expand_dims(wav, 0)
        arr = wav.squeeze().numpy() if hasattr(wav, "numpy") else np.asarray(wav).squeeze()
        wav_data = wav_bytes(arr.astype(np.float32), int(self.model.sr))
        return SynthesisResult(
            audio_bytes=wav_data,
            sample_rate=int(self.model.sr),
            model_id="ResembleAI/chatterbox",
            model_label="Chatterbox Multilingual V3",
            license="MIT",
            device=self.device,
            load_time_ms=self.load_time_ms,
            time_to_first_audio_ms=first_audio_ms,
            total_generation_time_ms=int((time.time() - started) * 1000),
            peak_memory_mb=current_rss_mb(),
            output_duration_ms=int((len(arr) / int(self.model.sr)) * 1000),
        )

    def cancel(self):
        return {"ok": True}


def prepare_spoken_text(text: str) -> str:
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    return value[:500]


def wav_bytes(waveform: np.ndarray, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, waveform, sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def candidate_by_id(candidate_id: str) -> Optional[Dict[str, Any]]:
    for candidate in VOICE_CANDIDATES:
        if candidate["id"] == candidate_id:
            return candidate
    return None


def candidate_package_installed(candidate: Optional[Dict[str, Any]]) -> bool:
    if not candidate:
        return False
    return importlib_util.find_spec(candidate["package"]) is not None


def candidate_statuses() -> List[Dict[str, Any]]:
    hardware = detect_voice_hardware()
    statuses = []
    for candidate in VOICE_CANDIDATES:
        installed = candidate_package_installed(candidate)
        practical = True
        reason = "installed" if installed else "package_not_installed"
        if candidate["id"] == "cosyvoice3" and hardware["ram_gb"] < 24:
            practical = False
            reason = "requires heavier setup than this 16GB Apple Silicon pass"
        if candidate["id"] == "chatterbox_turbo":
            practical = False
            reason = "no reliable local Turbo runtime detected"
        statuses.append({
            **candidate,
            "installed": installed,
            "practical_on_current_machine": practical,
            "status_reason": reason,
        })
    return statuses


def preferred_torch_device() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def detect_voice_hardware() -> Dict[str, Any]:
    total = 0
    try:
        import psutil

        total = int(psutil.virtual_memory().total)
    except Exception:
        total = 0
    return {
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "apple_silicon": platform.system() == "Darwin" and platform.machine() == "arm64",
        "cpu": platform.processor() or platform.machine(),
        "ram_bytes": total,
        "ram_gb": round(total / (1024 ** 3), 2) if total else 0,
        "torch_device": preferred_torch_device(),
        "cuda_available": preferred_torch_device() == "cuda",
        "mps_available": preferred_torch_device() == "mps",
        "cuda_vram_mb": 0,
    }


def current_rss_mb() -> int:
    try:
        import psutil

        return int(psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024))
    except Exception:
        return 0


def synthesis_result_headers(result: SynthesisResult) -> Dict[str, str]:
    return {
        "X-Sensefield-Voice-Engine": result.model_label,
        "X-Sensefield-Voice-Model": result.model_id,
        "X-Sensefield-Voice-License": result.license,
        "X-Sensefield-Voice-Device": result.device,
        "X-Sensefield-Load-Time-Ms": str(result.load_time_ms),
        "X-Sensefield-Time-To-First-Audio-Ms": str(result.time_to_first_audio_ms),
        "X-Sensefield-Generation-Time-Ms": str(result.total_generation_time_ms),
        "X-Sensefield-Audio-Duration-Ms": str(result.output_duration_ms),
        "X-Sensefield-Peak-Memory-Mb": str(result.peak_memory_mb),
        "Cache-Control": "no-store",
    }
