import json
import importlib.util
import os
import re
from typing import Any, Dict, List


def spatial_runtime_health(runtime: Dict[str, Any], model_id: str, model_dir: str = "") -> Dict[str, Any]:
    cache_name = f"models--{model_id.replace('/', '--')}"
    cached_model = os.path.isdir(model_dir) or os.path.isdir(os.path.join(os.path.expanduser("~/.cache/huggingface/hub"), cache_name))
    dependencies_ready = importlib.util.find_spec("torch") is not None and importlib.util.find_spec("transformers") is not None
    return {
        "ready": runtime.get("model") is not None or bool(cached_model and dependencies_ready),
        "source": "local_spatial",
        "capabilities": [
            "relative_depth",
            "object_relations",
            "hand_object_relations",
            "multi_frame_movement",
        ],
        "metric_scale_available": False,
        "contains_raw_media": False,
    }


def run_spatial_observations(images, timestamps, query, mode, runtime) -> Dict[str, Any]:
    import torch

    messages = [{"role": "user", "content": _spatial_content(images, timestamps, query, mode)}]
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
        generated = model.generate(**inputs, max_new_tokens=512, do_sample=False)
    input_length = inputs["input_ids"].shape[-1]
    decoded = processor.batch_decode(generated[:, input_length:], skip_special_tokens=True)[0]
    parsed = _extract_json(decoded)
    observations = _normalize_frame_observations(parsed, len(images))
    if not observations:
        raise RuntimeError("Spatial model did not return usable bounded observations.")
    return {
        "ok": True,
        "source": "local_spatial",
        "frame_observations": observations,
        "metric_scale_available": False,
        "contains_raw_media": False,
    }


def _spatial_content(images, timestamps, query, mode):
    prompt = f"""You are the local Sensefield spatial observation model.
Analyze these {len(images)} ordered frames for reusable geometry, not a generic caption.
Mode: {mode}. Spatial question: {query or 'none'}.

For each frame return visible objects and hands. Bounding boxes are normalized [x1,y1,x2,y2].
relative_depth is 0 for nearest and 1 for farthest, and is comparative only.
Use the same track_hint for the same object across frames.
Never identify a person. Never estimate centimetres or metres. Never include image data.
For uncertain objects, describe visible appearance and list missing_evidence.
Return JSON only with this shape:
{{"frames":[{{"frame_index":0,"objects":[{{"track_hint":"mug_1","label":"mug","bbox":[0.1,0.2,0.3,0.5],"relative_depth":0.4,"confidence":0.8,"appearance":"ceramic cup","missing_evidence":[]}}],"hands":[{{"handedness":"right","bbox":[0.6,0.3,0.8,0.7],"relative_depth":0.3,"confidence":0.8}}]}}]}}
Timestamps: {json.dumps(timestamps)}"""
    content = [{"type": "text", "text": prompt}]
    for image in images:
        content.append({"type": "image", "image": image})
    return content


def _extract_json(text: str) -> Dict[str, Any]:
    match = re.search(r"\{[\s\S]*\}", str(text or ""))
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _normalize_frame_observations(parsed: Dict[str, Any], frame_count: int) -> List[Dict[str, Any]]:
    frames = parsed.get("frames") if isinstance(parsed.get("frames"), list) else []
    by_index = {}
    for raw_frame in frames[:frame_count]:
        if not isinstance(raw_frame, dict):
            continue
        index = int(raw_frame.get("frame_index", len(by_index)))
        if index < 0 or index >= frame_count:
            continue
        by_index[index] = {
            "objects": _normalize_entities(raw_frame.get("objects"), "object"),
            "hands": _normalize_entities(raw_frame.get("hands"), "hand"),
        }
    return [by_index.get(index, {"objects": [], "hands": []}) for index in range(frame_count)]


def _normalize_entities(values, kind: str) -> List[Dict[str, Any]]:
    if not isinstance(values, list):
        return []
    entities = []
    for value in values[:24 if kind == "object" else 4]:
        if not isinstance(value, dict):
            continue
        bbox = value.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue
        try:
            normalized_bbox = [max(0.0, min(1.0, float(item))) for item in bbox]
            confidence = max(0.0, min(1.0, float(value.get("confidence", 0))))
            relative_depth = max(0.0, min(1.0, float(value.get("relative_depth", 0.5))))
        except (TypeError, ValueError):
            continue
        if normalized_bbox[2] <= normalized_bbox[0] or normalized_bbox[3] <= normalized_bbox[1]:
            continue
        entity = {
            "bbox": normalized_bbox,
            "relative_depth": relative_depth,
            "confidence": confidence,
        }
        if kind == "object":
            entity.update({
                "track_hint": _safe_identifier(value.get("track_hint")),
                "label": _safe_text(value.get("label") or "unknown object", 80),
                "appearance": _safe_text(value.get("appearance"), 180),
                "missing_evidence": [_safe_identifier(item) for item in value.get("missing_evidence", [])[:6]],
            })
        else:
            entity["handedness"] = _safe_identifier(value.get("handedness") or "unknown")
        entities.append(entity)
    return entities


def _safe_identifier(value) -> str:
    return re.sub(r"[^a-z0-9_-]+", "_", str(value or "").lower()).strip("_")[:96]


def _safe_text(value, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]
