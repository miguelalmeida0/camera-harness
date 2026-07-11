import json
import os
import time
from pathlib import Path

from voice_runtime import BENCHMARK_PHRASES, SensefieldVoiceRuntime, candidate_statuses, detect_voice_hardware


def main():
    output_root = Path("runs/voice-benchmark")
    output_root.mkdir(parents=True, exist_ok=True)
    rows = []

    for candidate in candidate_statuses():
        if not candidate["practical_on_current_machine"] or candidate["id"] in {"chatterbox_turbo", "cosyvoice3"}:
            rows.append(skipped(candidate, candidate["status_reason"]))
            continue
        if not candidate["installed"]:
            rows.append(skipped(candidate, "package_not_installed"))
            continue
        rows.extend(benchmark_candidate(candidate, output_root))

    successful = [row for row in rows if row["status"] == "generated"]
    successful_ids = {row["model_id"] for row in successful}
    selected = "chatterbox_multilingual_v3" if "chatterbox_multilingual_v3" in successful_ids else "kokoro_82m" if "kokoro_82m" in successful_ids else ""
    reason = (
        "Chatterbox Multilingual V3 generated audio and has the preferred quality/license profile."
        if selected == "chatterbox_multilingual_v3"
        else "Kokoro-82M generated audio reliably while heavier candidates were skipped or failed on this runtime."
        if selected == "kokoro_82m"
        else "No local model generated audio."
    )
    report = {
        "schema_version": "sensefield.voice_benchmark.v1",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hardware": detect_voice_hardware(),
        "selected_model": selected,
        "selection_reason": reason,
        "phrases": BENCHMARK_PHRASES,
        "results": rows,
        "audio_persistence": "benchmark_samples_only",
    }
    manifest = output_root / "benchmark-latest.json"
    manifest.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {manifest}")
    if selected:
        print(f"Selected model: {selected}")
    else:
        raise SystemExit(1)


def benchmark_candidate(candidate, output_root):
    rows = []
    runtime = SensefieldVoiceRuntime(selected_model=candidate["id"], allow_fallback=False)
    for index, phrase in enumerate(BENCHMARK_PHRASES, start=1):
        started = time.time()
        try:
            result = runtime.synthesize(phrase, observation_id=f"voice_benchmark_{index}")
            sample_path = output_root / f"{candidate['id']}_{index:02d}.wav"
            sample_path.write_bytes(result.audio_bytes)
            rows.append({
                "model_id": candidate["id"],
                "model": candidate["label"],
                "license": candidate["license"],
                "device": result.device,
                "phrase_index": index,
                "status": "generated",
                "load_time_ms": result.load_time_ms,
                "time_to_first_audio_ms": result.time_to_first_audio_ms,
                "total_generation_time_ms": result.total_generation_time_ms,
                "peak_memory_mb": result.peak_memory_mb,
                "output_duration_ms": result.output_duration_ms,
                "sample_path": str(sample_path),
                "installation_reliability": "installed and generated" if index == 1 else "warm runtime generated",
                "subjective_naturalness_notes": "Generated for human review; automated run does not claim listener-rated naturalness.",
                "prosody_quality": "moderate pace profile; listen to sample for final subjective rating",
                "mispronunciations": "not detected by automated benchmark",
                "elapsed_wall_ms": int((time.time() - started) * 1000),
            })
        except Exception as error:
            rows.append({
                "model_id": candidate["id"],
                "model": candidate["label"],
                "license": candidate["license"],
                "device": detect_voice_hardware()["torch_device"],
                "phrase_index": index,
                "status": "failed",
                "safe_error": str(error)[:240],
                "installation_reliability": "failed during load or generation",
                "subjective_naturalness_notes": "No audio generated.",
                "prosody_quality": "not assessed",
                "mispronunciations": "not assessed",
                "elapsed_wall_ms": int((time.time() - started) * 1000),
            })
            break
    runtime.cancel()
    return rows


def skipped(candidate, reason):
    return {
        "model_id": candidate["id"],
        "model": candidate["label"],
        "license": candidate["license"],
        "device": detect_voice_hardware()["torch_device"],
        "status": "skipped",
        "safe_error": reason,
        "installation_reliability": "not attempted",
        "subjective_naturalness_notes": "No audio generated.",
        "prosody_quality": "not assessed",
        "mispronunciations": "not assessed",
    }


if __name__ == "__main__":
    main()
