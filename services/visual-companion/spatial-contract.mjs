export const SPATIAL_SOURCE = "local_spatial";
export const SPATIAL_CAPABILITIES = Object.freeze([
  "relative_depth",
  "object_relations",
  "hand_object_relations",
  "multi_frame_movement"
]);

export const SPATIAL_LIMITS = Object.freeze({
  maxFrames: 8,
  maxWidth: 1280,
  maxHeight: 1280,
  maxBodyBytes: 5_000_000,
  maxQueryLength: 500,
  maxPreviousSceneBytes: 128_000,
  maxObjects: 24,
  maxRelations: 64,
  maxMoments: 20
});

export const SPATIAL_RELATIONS = Object.freeze([
  "left_of", "right_of", "above", "below", "in_front_of", "behind",
  "near", "far", "overlapping", "inside", "contains", "touching", "separated_from"
]);

export const SPATIAL_DIRECTIONS = Object.freeze([
  "left", "right", "upward", "downward", "toward_camera", "away_from_camera",
  "approximately_stationary", "entered_frame", "left_frame"
]);

export const SPATIAL_INTERACTIONS = Object.freeze([
  "hand_approaching_object", "hand_moving_away_from_object", "hand_holding_object",
  "hand_releasing_object", "object_raised", "object_lowered", "object_repositioned",
  "object_removed", "object_placed", "object_entered_frame", "object_left_frame"
]);

const RAW_MEDIA_KEYS = new Set([
  "encoded_frame", "data_uri", "base64", "frame_bytes", "image", "image_data",
  "depth_map", "depth_array", "raw", "video", "audio", "blob", "screenshot"
]);

export function validateSpatialInput(input = {}, limits = SPATIAL_LIMITS) {
  const frames = Array.isArray(input.frames) ? input.frames : [];
  const timestamps = Array.isArray(input.timestamps)
    ? input.timestamps.map(Number)
    : frames.map((frame) => Number(frame?.captured_at_ms ?? frame?.timestamp_ms));
  if (!frames.length) return spatialFailure("spatial_empty_frames", "No spatial frames were supplied.");
  if (frames.length > limits.maxFrames) return spatialFailure("spatial_frame_limit_exceeded", "The spatial window is too large.");
  if (timestamps.length !== frames.length || timestamps.some((value) => !Number.isFinite(value))) {
    return spatialFailure("spatial_timestamps_invalid", "Spatial frame timestamps are invalid.");
  }
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] <= timestamps[index - 1]) return spatialFailure("spatial_timestamps_not_ordered", "Spatial frame timestamps must be ordered.");
  }
  for (const frame of frames) {
    const width = Number(frame?.width);
    const height = Number(frame?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return spatialFailure("spatial_frame_dimensions_invalid", "Spatial frame dimensions are invalid.");
    }
    if (width > limits.maxWidth || height > limits.maxHeight) {
      return spatialFailure("spatial_frame_dimensions_exceeded", "Spatial frame dimensions exceed the configured limit.");
    }
    const hasTransientMedia = typeof frame?.encoded_frame === "string" && frame.encoded_frame.length > 0;
    const hasDataUri = typeof frame?.data_uri === "string" && frame.data_uri.length > 0;
    const hasDeterministicObservations = frame?.observations && typeof frame.observations === "object";
    if (!hasTransientMedia && !hasDataUri && !hasDeterministicObservations) {
      return spatialFailure("spatial_frame_empty", "A spatial frame is empty.");
    }
  }
  if (!["conversation", "observing"].includes(String(input.mode || ""))) {
    return spatialFailure("spatial_mode_invalid", "Spatial mode must be conversation or observing.");
  }
  if (input.query != null && String(input.query).length > limits.maxQueryLength) {
    return spatialFailure("spatial_query_too_long", "The spatial question is too long.");
  }
  if (safeJsonBytes(input.previousScene) > limits.maxPreviousSceneBytes) {
    return spatialFailure("spatial_previous_scene_too_large", "The previous spatial scene is too large.");
  }
  const bodyBytes = Number(input.bodyBytes ?? input.__body_bytes ?? safeJsonBytes(input));
  if (!Number.isFinite(bodyBytes) || bodyBytes > limits.maxBodyBytes) {
    return spatialFailure("spatial_request_too_large", "The spatial request is too large.");
  }
  return {
    ok: true,
    frames,
    timestamps,
    query: input.query == null ? null : sanitizeText(input.query, limits.maxQueryLength),
    mode: String(input.mode),
    calibration: sanitizeCalibration(input.calibration),
    previousScene: sanitizeTextNumericData(input.previousScene),
    bodyBytes
  };
}

export function sanitizeSpatialResult(result = {}) {
  const clean = sanitizeTextNumericData(result);
  return {
    ...clean,
    ok: clean?.ok === true,
    source: clean?.ok === true ? SPATIAL_SOURCE : "unavailable",
    contains_raw_media: false
  };
}

export function spatialFailure(code = "spatial_model_unavailable", message = "Spatial precision is temporarily unavailable.") {
  return {
    ok: false,
    code: sanitizeIdentifier(code, "spatial_model_unavailable"),
    message: sanitizeText(message, 160) || "Spatial precision is temporarily unavailable.",
    source: "unavailable",
    contains_raw_media: false
  };
}

export function sanitizeCalibration(value) {
  if (!value || typeof value !== "object") return null;
  return sanitizeTextNumericData(value, 0, 24);
}

export function sanitizeTextNumericData(value, depth = 0, maxKeys = 64) {
  if (depth > 6 || value == null) return value == null ? null : undefined;
  if (typeof value === "string") {
    if (/^data:(?:image|video|audio)\//i.test(value) || /;base64,/i.test(value)) return undefined;
    return value.slice(0, 1000);
  }
  if (["number", "boolean"].includes(typeof value)) return Number.isFinite(value) || typeof value === "boolean" ? value : null;
  if (Array.isArray(value)) return value.slice(0, 128).map((item) => sanitizeTextNumericData(item, depth + 1, maxKeys)).filter((item) => item !== undefined);
  if (typeof value !== "object") return undefined;
  const clean = {};
  for (const [key, nested] of Object.entries(value).slice(0, maxKeys)) {
    if (RAW_MEDIA_KEYS.has(String(key).toLowerCase()) || /(token|authorization|secret|credential|model_path|filesystem)/i.test(key)) continue;
    const safe = sanitizeTextNumericData(nested, depth + 1, maxKeys);
    if (safe !== undefined) clean[key] = safe;
  }
  return clean;
}

export function containsRawMedia(value) {
  if (value == null) return false;
  if (typeof value === "string") return /^data:(?:image|video|audio)\//i.test(value) || /;base64,/i.test(value);
  if (Array.isArray(value)) return value.some(containsRawMedia);
  if (typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => RAW_MEDIA_KEYS.has(String(key).toLowerCase()) || containsRawMedia(nested));
}

export function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

export function sanitizeIdentifier(value, fallback = "") {
  const clean = String(value || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96);
  return clean || fallback;
}

export function sanitizeText(value, maxLength = 500) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeJsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return Infinity;
  }
}
