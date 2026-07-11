export const VISUAL_OBSERVATION_WINDOW_SCHEMA = "darkquest.visual_observation_window.v1";

export const DEFAULT_OBSERVATION_LIMITS = Object.freeze({
  maxFrames: 4,
  maxWidth: 1280,
  maxHeight: 720,
  maxRequestBytes: 1_250_000
});

const RAW_MEDIA_KEYS = [
  "data_uri",
  "base64",
  "encoded_frame",
  "frame_bytes",
  "image",
  "image_data",
  "screenshot",
  "video",
  "audio",
  "blob",
  "raw"
];

export function createVisualObservationWindow(input = {}) {
  const limits = { ...DEFAULT_OBSERVATION_LIMITS, ...(input.limits || {}) };
  if (input.cameraActive === false) {
    return blockedWindow("visual_camera_off_blocked", "camera is not active");
  }
  if (input.documentVisible === false) {
    return blockedWindow("visual_hidden_tab_blocked", "document is hidden");
  }
  if (input.requestInFlight === true) {
    return blockedWindow("visual_one_request_in_flight", "observation request already in flight");
  }

  const sourceFrames = Array.isArray(input.frames) ? input.frames : [];
  const frames = sourceFrames.slice(0, limits.maxFrames).map((frame, index) => sanitizeFrameDescriptor(frame, index, limits));
  const requestSizeBytes = frames.reduce((sum, frame) => sum + frame.byte_length, 0);
  return {
    schema: VISUAL_OBSERVATION_WINDOW_SCHEMA,
    observation_window_id: input.observation_window_id || `visual_window_${Date.now()}`,
    created_at_ms: finiteNumber(input.created_at_ms, Date.now()),
    camera_active: true,
    document_visible: true,
    frame_count: frames.length,
    frames_ordered: true,
    contains_raw_media: false,
    request_size_bytes: requestSizeBytes,
    limits,
    frames,
    blocked: false,
    blocked_reason: "",
    cleared_after_request: false
  };
}

export function validateVisualObservationWindow(window = {}) {
  const failures = [];
  if (window.schema !== VISUAL_OBSERVATION_WINDOW_SCHEMA) failures.push("visual_observation_schema_invalid");
  if (window.blocked) return { ok: false, failures: [window.blocked_reason || "visual_observation_blocked"] };
  if (!Array.isArray(window.frames)) failures.push("visual_observation_frames_missing");
  const frames = Array.isArray(window.frames) ? window.frames : [];
  if (frames.length > Number(window.limits?.maxFrames || DEFAULT_OBSERVATION_LIMITS.maxFrames)) failures.push("visual_observation_frame_count_exceeded");
  if (Number(window.request_size_bytes || 0) > Number(window.limits?.maxRequestBytes || DEFAULT_OBSERVATION_LIMITS.maxRequestBytes)) failures.push("visual_observation_request_too_large");

  let previousTimestamp = -Infinity;
  for (const frame of frames) {
    if (Number(frame.timestamp_ms) < previousTimestamp) failures.push("visual_observation_timestamp_not_monotonic");
    previousTimestamp = Number(frame.timestamp_ms);
    if (Number(frame.width) > Number(window.limits?.maxWidth || DEFAULT_OBSERVATION_LIMITS.maxWidth)) failures.push("visual_observation_width_exceeded");
    if (Number(frame.height) > Number(window.limits?.maxHeight || DEFAULT_OBSERVATION_LIMITS.maxHeight)) failures.push("visual_observation_height_exceeded");
  }
  if (containsRawMedia(window)) failures.push("visual_raw_media_persisted");
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

export async function withObservationFrameCleanup(frameBuffer, run) {
  try {
    return await run(frameBuffer);
  } finally {
    if (Array.isArray(frameBuffer)) frameBuffer.length = 0;
  }
}

export function containsRawMedia(value) {
  if (value == null) return false;
  if (typeof value === "string") {
    return /^data:image\/|^data:video\/|^data:audio\/|base64,/i.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsRawMedia(item));
  if (typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => RAW_MEDIA_KEYS.includes(key.toLowerCase()) || containsRawMedia(nested));
}

function sanitizeFrameDescriptor(frame = {}, index, limits) {
  const timestampMs = finiteNumber(frame.timestamp_ms, index);
  return {
    frame_id: String(frame.frame_id || `frame_${index + 1}`),
    timestamp_ms: timestampMs,
    width: Math.min(finiteNumber(frame.width, 640), limits.maxWidth),
    height: Math.min(finiteNumber(frame.height, 480), limits.maxHeight),
    byte_length: Math.max(0, Math.min(finiteNumber(frame.byte_length, 0), limits.maxRequestBytes)),
    descriptor: String(frame.descriptor || "symbolic frame descriptor").slice(0, 240)
  };
}

function blockedWindow(reason, detail) {
  return {
    schema: VISUAL_OBSERVATION_WINDOW_SCHEMA,
    observation_window_id: `visual_window_blocked_${Date.now()}`,
    frame_count: 0,
    frames: [],
    contains_raw_media: false,
    request_size_bytes: 0,
    blocked: true,
    blocked_reason: reason,
    detail
  };
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
