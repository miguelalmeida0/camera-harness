import argparse
import asyncio
import base64
import builtins
import io
import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from PIL import Image, ImageDraw, ImageFont, ImageOps
from spatial_runtime import run_spatial_observations, spatial_runtime_health
from voice_chunking import chunk_spoken_text

logger = logging.getLogger("sensefield.voice")

try:
    from voice_runtime import SensefieldVoiceRuntime, safe_voice_error_code, safe_voice_error_message, synthesis_result_headers
except Exception as voice_import_error:  # pragma: no cover - exercised by runtime health.
    logger.exception("Neural voice runtime import failed.")
    SensefieldVoiceRuntime = None
    safe_voice_error_code = None
    safe_voice_error_message = None
    synthesis_result_headers = None
    VOICE_IMPORT_ERROR = "Neural voice runtime could not be loaded."
else:
    VOICE_IMPORT_ERROR = ""

MODEL_ID = os.getenv("VISUAL_COMPANION_MODEL", "HuggingFaceTB/SmolVLM2-2.2B-Instruct")
MODEL_REVISION = os.getenv("VISUAL_COMPANION_MODEL_REVISION", "main")
DEFAULT_MODEL_DIR = os.path.abspath(os.path.join(os.getcwd(), ".models", "visual-companion", "smolvlm2-2.2b-instruct"))
MODEL_DIR = os.getenv("VISUAL_COMPANION_MODEL_DIR", DEFAULT_MODEL_DIR)
MAX_FRAMES = int(os.getenv("VISUAL_COMPANION_MAX_FRAMES", "8"))
MAX_DIMENSION = int(os.getenv("VISUAL_COMPANION_MAX_DIMENSION", "384"))
MAX_IMAGE_BYTES = int(os.getenv("VISUAL_COMPANION_MAX_IMAGE_BYTES", str(512 * 1024)))
MAX_NEW_TOKENS = int(os.getenv("VISUAL_COMPANION_MAX_NEW_TOKENS", "24"))

app = FastAPI(title="DarkQuest Visual Companion", version="1.0")
voice_runtime = SensefieldVoiceRuntime() if SensefieldVoiceRuntime else None
runtime: Dict[str, Any] = {
    "model": None,
    "processor": None,
    "device": "unknown",
    "load_time_ms": 0,
    "safe_error": "",
}


class FrameInput(BaseModel):
    mime_type: str = "image/jpeg"
    encoded_frame: str
    captured_at_ms: int = 0
    width: int = 0
    height: int = 0


class ObserveInput(BaseModel):
    schema_version: str = "visual-observation-window.v1"
    frames: List[FrameInput] = Field(default_factory=list)
    frame_timestamps_ms: List[int] = Field(default_factory=list)
    previous_context: Dict[str, str] = Field(default_factory=dict)
    user_question: str = ""
    requested_response_mode: str = "auto"
    interaction_mode: str = "observing"
    mode_generation_id: int = 0
    allowed_suggested_actions: List[str] = Field(default_factory=list)
    client_scene_change_score: float = 0
    memory_mode: str = "session"


class SpeakInput(BaseModel):
    text: str = ""
    spoken_response: str = ""
    observation_id: str = ""
    voice: str = "sensefield_default"
    style: str = "warm_conversational"
    mute: bool = False
    contains_raw_media: bool = False
    speech_id: str = ""
    mode: str = "conversation"
    chunking: str = "sentence"


class SpatialInput(BaseModel):
    frames: List[FrameInput] = Field(default_factory=list)
    timestamps: List[int] = Field(default_factory=list)
    query: Optional[str] = None
    mode: str = "observing"
    contains_raw_media: bool = True


@app.get("/health")
def health():
    ensure_model_loaded(lazy=True)
    voice_health = voice_runtime.health(lazy=True) if voice_runtime else {
        "voice_ready": False,
        "voice_status": "not_installed",
        "voice_engine": "unavailable",
        "voice_safe_error": VOICE_IMPORT_ERROR,
        "voice_fallback_chain": [],
    }
    return {
        "ok": runtime["model"] is not None,
        "status": "ready" if runtime["model"] is not None else "model_not_installed",
        "model": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "license": "apache-2.0",
        "source": f"https://huggingface.co/{MODEL_ID}",
        "device": runtime["device"],
        "quantization": "none",
        "load_time_ms": runtime["load_time_ms"],
        "peak_memory_mb": 0,
        "safe_error": runtime["safe_error"],
        "contains_raw_media": False,
        **voice_health,
    }


@app.get("/models")
def models():
    return {
        "models": [{
            "id": MODEL_ID,
            "revision": MODEL_REVISION,
            "license": "apache-2.0",
            "source": f"https://huggingface.co/{MODEL_ID}",
            "selected": True,
        }]
    }


@app.get("/spatial-health")
def spatial_health():
    return spatial_runtime_health(runtime, MODEL_ID, MODEL_DIR)


@app.post("/spatial-observations")
def spatial_observations(payload: SpatialInput):
    if not payload.frames:
        raise HTTPException(status_code=400, detail="No spatial frames supplied.")
    if len(payload.frames) > MAX_FRAMES:
        raise HTTPException(status_code=413, detail="Too many spatial frames supplied.")
    if payload.mode not in {"conversation", "observing"}:
        raise HTTPException(status_code=400, detail="Invalid spatial mode.")
    timestamps = payload.timestamps or [frame.captured_at_ms for frame in payload.frames]
    if len(timestamps) != len(payload.frames) or any(timestamps[index] <= timestamps[index - 1] for index in range(1, len(timestamps))):
        raise HTTPException(status_code=400, detail="Spatial timestamps must be ordered.")
    images: List[Image.Image] = []
    try:
        for frame in payload.frames:
            images.append(decode_frame(frame))
        ensure_model_loaded(lazy=False)
        if runtime["model"] is None or runtime["processor"] is None:
            raise HTTPException(status_code=503, detail="Spatial model unavailable.")
        return run_spatial_observations(images, timestamps, payload.query, payload.mode, runtime)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="Spatial precision is temporarily unavailable.")
    finally:
        for image in images:
            image.close()
        images.clear()


@app.get("/voices")
def voices():
    if not voice_runtime:
        return {
            "default_voice": "",
            "profiles": [],
            "selected_model": "",
            "fallback_chain": [],
            "candidates": [],
            "safe_error": VOICE_IMPORT_ERROR,
        }
    return voice_runtime.voices()


@app.post("/observe")
def observe(payload: ObserveInput):
    started = time.time()
    if not payload.frames:
        raise HTTPException(status_code=400, detail="No frames supplied.")
    if len(payload.frames) > MAX_FRAMES:
        raise HTTPException(status_code=413, detail="Too many frames supplied.")
    images: List[Image.Image] = []
    try:
        for frame in payload.frames:
            images.append(decode_frame(frame))
        ensure_model_loaded(lazy=False)
        if runtime["model"] is None or runtime["processor"] is None:
            return uncertain_response_for_payload(payload, started, "The local visual model is not installed yet.")
        model_text = run_model(images, payload)
        return normalize_model_output(model_text, started, payload)
    except HTTPException:
        raise
    except Exception as error:
        runtime["safe_error"] = str(error)[:240]
        return uncertain_response_for_payload(payload, started, "The local visual model could not understand that window.")
    finally:
        for image in images:
            image.close()
        images.clear()


@app.post("/speak")
async def speak(request: Request):
    raw = await request.json()
    if contains_raw_media_marker(raw):
        raise HTTPException(status_code=400, detail="Voice synthesis accepts text only.")
    payload = SpeakInput.model_validate(raw)
    text = str(payload.text or payload.spoken_response or "").strip()
    if payload.mute:
        return {
            "ok": False,
            "engine": "muted",
            "code": "visual_tts_muted",
            "contains_raw_media": False,
        }
    if not text:
        return {
            "ok": False,
            "engine": "empty",
            "code": "visual_tts_empty",
            "contains_raw_media": False,
        }
    if not voice_runtime:
        return local_voice_unavailable(VOICE_IMPORT_ERROR)
    try:
        result = await asyncio.to_thread(
            voice_runtime.synthesize,
            text,
            observation_id=payload.observation_id,
            voice=payload.voice,
            style=payload.style,
        )
        return Response(
            content=result.audio_bytes,
            media_type="audio/wav",
            headers=synthesis_result_headers(result),
        )
    except Exception as error:
        return local_voice_unavailable(error)


@app.post("/warmup")
async def warmup():
    if not voice_runtime:
        return voice_warmup_unavailable()
    try:
        result = await asyncio.to_thread(voice_runtime.warmup)
        return {**result, "contains_raw_media": False}
    except Exception as error:
        code = safe_voice_error_code(error) if safe_voice_error_code else "model_initialization_failed"
        logger.exception("Neural voice warm-up failed at %s.", code)
        return voice_warmup_unavailable(error)


@app.post("/speak-stream")
async def speak_stream(request: Request):
    raw = await request.json()
    if contains_raw_media_marker(raw):
        raise HTTPException(status_code=400, detail="Voice synthesis accepts text only.")
    payload = SpeakInput.model_validate(raw)
    text = str(payload.text or payload.spoken_response or "").strip()
    if not text or not voice_runtime:
        return local_voice_unavailable(VOICE_IMPORT_ERROR if not voice_runtime else "No speakable text supplied.")
    chunks = chunk_spoken_text(text)
    if not chunks:
        return local_voice_unavailable("No speakable text supplied.")
    cancellation_generation = voice_runtime.cancellation_generation()

    async def generate():
        for index, chunk in enumerate(chunks):
            if voice_runtime.is_cancelled(cancellation_generation):
                break
            try:
                result = await asyncio.to_thread(
                    voice_runtime.synthesize,
                    chunk,
                    observation_id=payload.observation_id,
                    voice=payload.voice,
                    style=payload.style,
                )
            except Exception as error:
                yield json.dumps({
                    "type": "error",
                    "index": index,
                    "code": "local_voice_unavailable",
                    "safe_error": safe_voice_error_message(error) if safe_voice_error_message else VOICE_IMPORT_ERROR,
                    "contains_raw_media": False,
                }) + "\n"
                break
            if voice_runtime.is_cancelled(cancellation_generation):
                break
            yield json.dumps({
                "type": "audio",
                "index": index,
                "total_chunks": len(chunks),
                "mime_type": "audio/wav",
                "audio_base64": base64.b64encode(result.audio_bytes).decode("ascii"),
                "audio_bytes": len(result.audio_bytes),
                "audio_duration_ms": result.output_duration_ms,
                "generation_ms": result.total_generation_time_ms,
                "time_to_first_audio_ms": result.time_to_first_audio_ms,
                "contains_raw_media": False,
            }) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            "X-Sensefield-Voice-Mode": "progressive",
        },
    )


@app.post("/cancel")
def cancel():
    if voice_runtime:
        return voice_runtime.cancel()
    return {"ok": True, "cancelled": True}


def local_voice_unavailable(error: Any = "") -> Dict[str, Any]:
    return {
        "ok": False,
        "engine": "unavailable",
        "code": "local_voice_unavailable",
        "voice_status": "Voice unavailable",
        "safe_error": safe_voice_error_message(error) if error and safe_voice_error_message else (VOICE_IMPORT_ERROR if error else ""),
        "audio_duration_ms": 0,
        "time_to_first_audio_ms": 0,
        "contains_raw_media": False,
    }


def voice_warmup_unavailable(error: Any = "") -> JSONResponse:
    code = safe_voice_error_code(error) if error and safe_voice_error_code else "model_initialization_failed"
    return JSONResponse(status_code=503, content={
        "ok": False,
        "engine": "unavailable",
        "code": code,
        "voice_status": "Voice unavailable",
        "safe_error": safe_voice_error_message(error) if error and safe_voice_error_message else (VOICE_IMPORT_ERROR or "The neural voice model could not be initialized."),
        "voice_warmed": False,
        "contains_raw_media": False,
    })


def contains_raw_media_marker(value: Any) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if re.search(r"(encoded_frame|data_uri|frame|image|video|audio_blob|base64)", str(key), re.I):
                return True
            if contains_raw_media_marker(item):
                return True
    if isinstance(value, list):
        return any(contains_raw_media_marker(item) for item in value)
    if isinstance(value, str):
        return bool(re.search(r"data:(?:image|video|audio)/|base64,", value, re.I))
    return False


def ensure_model_loaded(lazy: bool):
    if runtime["model"] is not None:
        return
    if lazy and os.getenv("VISUAL_COMPANION_EAGER_LOAD", "0") != "1":
        if not runtime["safe_error"]:
            runtime["safe_error"] = "Model is not loaded yet."
        return
    started = time.time()
    try:
        builtins.Image = Image
        builtins.ImageDraw = ImageDraw
        builtins.ImageFont = ImageFont
        builtins.ImageOps = ImageOps
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        source = MODEL_DIR if local_model_dir_ready(MODEL_DIR) else MODEL_ID
        if torch.cuda.is_available():
            device = "cuda"
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
        processor = AutoProcessor.from_pretrained(source, revision=MODEL_REVISION if source == MODEL_ID else None)
        model = AutoModelForImageTextToText.from_pretrained(
            source,
            revision=MODEL_REVISION if source == MODEL_ID else None,
            torch_dtype=torch.float16 if device in {"cuda", "mps"} else torch.float32,
            low_cpu_mem_usage=True,
        )
        model.to(device)
        model.eval()
        runtime.update({
            "model": model,
            "processor": processor,
            "device": device,
            "load_time_ms": int((time.time() - started) * 1000),
            "safe_error": "",
        })
    except Exception as error:
        runtime["safe_error"] = str(error)[:240]


def local_model_dir_ready(path: str) -> bool:
    return bool(path and os.path.isdir(path) and os.path.exists(os.path.join(path, "config.json")))


def decode_frame(frame: FrameInput) -> Image.Image:
    raw = base64.b64decode(frame.encoded_frame, validate=True)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Frame too large.")
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    image.thumbnail((MAX_DIMENSION, MAX_DIMENSION))
    return image.copy()


def run_model(images: List[Image.Image], payload: ObserveInput) -> str:
    import torch

    prompt = visual_prompt(payload, len(images))
    content = [{"type": "text", "text": prompt}]
    for image in images:
        content.append({"type": "image", "image": image})
    messages = [{"role": "user", "content": content}]
    processor = runtime["processor"]
    model = runtime["model"]
    inputs = processor.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
    )
    inputs = {key: value.to(runtime["device"]) if hasattr(value, "to") else value for key, value in inputs.items()}
    with torch.inference_mode():
        generated = model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False)
    input_length = inputs["input_ids"].shape[-1]
    decoded = processor.batch_decode(generated[:, input_length:], skip_special_tokens=True)[0]
    return decoded


def visual_prompt(payload: ObserveInput, frame_count: int) -> str:
    frame_lines = "\n".join([f"Frame {index + 1}" for index in range(frame_count)])
    if payload.interaction_mode == "conversation":
        return f"""You are Sensefield in Conversation mode.

Frames:
{frame_lines}

Text-only conversation context:
{json.dumps(payload.previous_context, ensure_ascii=True)}

User question:
{payload.user_question or "none"}

Rules:
- Answer the user's question using the frames as supporting visual context.
- Preserve recent conversational references when useful.
- Answer directly in 1–3 concise sentences and usually 15–70 spoken words.
- Put the first useful sentence first; avoid preambles and question repetition.
- Do not proactively narrate unrelated motion.
- Do not identify the person.
- Do not infer sensitive attributes.
- Do not diagnose emotion or health.
- Return only JSON.

JSON shape:
{{
  "meaningful_change": true,
  "movement_label": "conversation_answer",
  "response_type": "assist|ask|uncertain|silent",
  "observation_summary": "...",
  "spoken_response": "...",
  "confidence": 0.0,
  "uncertainty": false,
  "question": "",
  "suggested_actions": [],
  "evidence": ["..."],
  "evidence_frames": [1],
  "no_meaningful_change": false
}}"""
    return f"""You are Sensefield in Observing mode.

Frames:
{frame_lines}

Rules:
- Compare the ordered frames and determine what visibly changed.
- Identify which visible body part moved and whether a recognizable hand gesture occurred.
- Identify whether an object was raised, lowered, picked up, placed down, or moved.
- Describe the most visible movement, object, or change in one short sentence.
- Cite the one-based frame numbers that support the conclusion.
- For uncertainty, describe partial visible evidence instead of using a generic failure sentence.
- Do not answer unasked questions.
- Do not identify the person.
- Do not infer sensitive attributes.
- Return only JSON.

JSON shape:
{{
  "meaningful_change": true,
  "movement_label": "peace_sign",
  "response_type": "narrate|uncertain",
  "observation_summary": "...",
  "spoken_response": "...",
  "confidence": 0.5,
  "uncertainty": false,
  "question": "",
  "suggested_actions": [],
  "evidence": ["..."],
  "evidence_frames": [1, 3, 5],
  "no_meaningful_change": false
}}"""


def normalize_model_output(text: str, started: float, payload: Optional[ObserveInput] = None) -> Dict[str, Any]:
    parsed = extract_json(text)
    if not parsed:
        fallback = safe_textual_model_output(text)
        if fallback:
            return {
                "schema_version": "contextual-visual-response.v1",
                "response_type": "narrate",
                "observation_summary": fallback[:500],
                "spoken_response": fallback[:500],
                "confidence": 0.58,
                "uncertainty": False,
                "question": "",
                "suggested_actions": [],
                "evidence": ["natural_language_model_output"],
                "meaningful_change": True,
                "movement_label": "visible_change",
                "evidence_frames": list(range(1, len(payload.frames) + 1)) if payload else [],
                "provider": "local_visual_companion",
                "model": MODEL_ID,
                "model_revision": MODEL_REVISION,
                "device": runtime["device"],
                "latency_ms": int((time.time() - started) * 1000),
                "time_to_first_token_ms": 0,
                "time_to_first_audio_ms": 0,
                "response_source": "local_vlm",
                "contains_raw_media": False,
            }
        return uncertain_response_for_payload(payload, started, "The visual evidence was unclear.")
    confidence = max(0.0, min(1.0, float(parsed.get("confidence", 0) or 0)))
    response_type = parsed.get("response_type") or ("uncertain" if parsed.get("uncertainty") else "narrate")
    summary = safe_textual_model_output(str(parsed.get("observation_summary") or parsed.get("summary") or ""))
    spoken = safe_textual_model_output(str(parsed.get("spoken_response") or ""))
    can_use_summary = bool(summary) and not is_uncertain_text(summary) and (
        (payload and payload.interaction_mode == "conversation" and payload.user_question)
        or (payload and payload.interaction_mode == "observing" and payload.client_scene_change_score >= 0.1)
    )
    if can_use_summary and (parsed.get("uncertainty") or response_type == "uncertain" or confidence < 0.35 or is_uncertain_text(spoken)):
        confidence = max(confidence, 0.5)
        response_type = "narrate"
        parsed["uncertainty"] = False
        parsed["spoken_response"] = spoken if spoken and not is_uncertain_text(spoken) else summary
        parsed["observation_summary"] = summary
    if payload and payload.interaction_mode == "conversation" and (
        not spoken or is_uncertain_text(spoken) or is_uncertain_text(str(parsed.get("spoken_response") or ""))
    ):
        fallback = conversation_uncertain_text(summary)
        parsed["spoken_response"] = fallback
        parsed["observation_summary"] = summary or "The current view is not clear enough for a confident answer."
        parsed["uncertainty"] = True
        response_type = "uncertain"
    return {
        "schema_version": "contextual-visual-response.v1",
        "response_type": response_type,
        "observation_summary": str(parsed.get("observation_summary") or "Visible change observed.")[:500],
        "spoken_response": str(parsed.get("spoken_response") or "I saw a visible change.")[:500],
        "confidence": confidence,
        "uncertainty": bool(parsed.get("uncertainty") or response_type == "uncertain"),
        "question": str(parsed.get("question") or "")[:240],
        "suggested_actions": parsed.get("suggested_actions") if isinstance(parsed.get("suggested_actions"), list) else [],
        "evidence": parsed.get("evidence") if isinstance(parsed.get("evidence"), list) else [],
        "meaningful_change": bool(parsed.get("meaningful_change", not parsed.get("no_meaningful_change", False))),
        "movement_label": normalize_movement_label(parsed.get("movement_label")),
        "evidence_frames": normalize_evidence_frames(parsed.get("evidence_frames"), len(payload.frames) if payload else MAX_FRAMES),
        "provider": "local_visual_companion",
        "model": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "device": runtime["device"],
        "latency_ms": int((time.time() - started) * 1000),
        "time_to_first_token_ms": 0,
        "time_to_first_audio_ms": 0,
        "response_source": "local_vlm",
        "contains_raw_media": False,
    }


def is_uncertain_text(text: str) -> bool:
    return bool(re.search(r"\b(not sure|uncertain|try again|unclear|could not)\b", str(text or ""), re.I))


def normalize_movement_label(value: Any) -> Optional[str]:
    label = re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")
    return label[:80] or None


def normalize_evidence_frames(value: Any, frame_count: int) -> List[int]:
    if not isinstance(value, list):
        return []
    result: List[int] = []
    for item in value:
        try:
            index = int(item)
        except (TypeError, ValueError):
            continue
        if 1 <= index <= frame_count and index not in result:
            result.append(index)
    return result[:MAX_FRAMES]


def uncertain_response(message: str, started: float) -> Dict[str, Any]:
    return {
        "schema_version": "contextual-visual-response.v1",
        "response_type": "uncertain",
        "observation_summary": "The visual change was unclear.",
        "spoken_response": message,
        "confidence": 0,
        "uncertainty": True,
        "question": "",
        "suggested_actions": [],
        "evidence": ["uncertain"],
        "meaningful_change": False,
        "movement_label": None,
        "evidence_frames": [],
        "provider": "local_visual_companion",
        "model": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "device": runtime["device"],
        "latency_ms": int((time.time() - started) * 1000),
        "time_to_first_token_ms": 0,
        "time_to_first_audio_ms": 0,
        "response_source": "unavailable",
        "contains_raw_media": False,
    }


def uncertain_response_for_payload(payload: ObserveInput, started: float, message: str) -> Dict[str, Any]:
    if payload.interaction_mode != "conversation":
        return uncertain_response(message, started)
    response = uncertain_response(conversation_uncertain_text(""), started)
    response.update({
        "observation_summary": "The current view is not clear enough for a confident answer.",
        "movement_label": "conversation_uncertain",
        "meaningful_change": True,
        "response_source": "local_vlm",
    })
    return response


def conversation_uncertain_text(summary: str) -> str:
    clean = safe_textual_model_output(summary)
    if clean and not is_uncertain_text(clean):
        return f"{clean} I’m not fully confident from this angle. Could you adjust the camera or ask about a specific visible area?"
    return "I can’t reliably describe the current view from this angle. Could you adjust the camera or ask about a specific visible area?"


def extract_json(text: str) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            return json.loads(text[start:end + 1])
        except Exception:
            return None


def safe_textual_model_output(text: str) -> str:
    value = re.sub(r"```(?:json)?|```", "", str(text or ""), flags=re.I)
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(r"^(assistant|sensefield)\s*:\s*", "", value, flags=re.I).strip()
    if not value:
        return ""
    if re.search(r"\b(identity|identified as|age|race|ethnicity|religion|diagnos|depressed|angry|attractive|gender)\b", value, re.I):
        return ""
    if len(value) > 500:
        value = value[:497].rstrip() + "..."
    return value if value.endswith((".", "!", "?")) else value + "."


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("VISUAL_COMPANION_HOST", "127.0.0.1"))
    parser.add_argument("--port", default=int(os.getenv("VISUAL_COMPANION_PORT", "8766")), type=int)
    args = parser.parse_args()
    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
