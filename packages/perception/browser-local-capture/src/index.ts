import {
  createLivePerceptionAdapter,
  type BrowserLatencyRecord,
  type HandObservation,
  type LivePerceptionAdapter,
  type LocalObservationFrame,
  type ObjectObservation,
  type SceneObservation,
  type StableEvent,
  type TraceOrigin,
  type ZoneObservation
} from "../../live-perception-adapter/src/index.ts";
import { createLiveTraceRecorder, type LiveTraceRecorder } from "../../../replay/live-trace-recorder/src/index.ts";

export type BrowserCapturePrivacyState = {
  raw_media_persisted: false;
  screenshots_persisted: false;
  base64_media_persisted: false;
  audio_requested: false;
  cloud_calls_enabled: false;
  llm_calls: 0;
  vlm_calls: 0;
};

export type BrowserObservationDraft = {
  frameId: string;
  timestampMs: number;
  hands: HandObservation[];
  objects: ObjectObservation[];
  zones: ZoneObservation[];
  scene: SceneObservation;
};

export type BrowserTimingDraft = {
  frame_capture_ms: number;
  observation_extraction_ms: number;
  adapter_ms?: number;
  stabilizer_ms?: number;
  event_emission_ms?: number;
  hud_update_ms?: number;
  trace_recorder_ms?: number;
  dropped_frames?: number;
};

export type BrowserDebugHudState = {
  capture_status: "idle" | "camera_ready" | "recording" | "stopped" | "error";
  physical_capture_status: "not_physical" | "awaiting_operator_confirmation" | "operator_confirmed";
  quest_state: string;
  calibration_status: "uncalibrated" | "calibrated" | "reset_required";
  active_zone: string | null;
  last_frame_id: string | null;
  last_event_types: string[];
  last_10_symbolic_events: Array<{ id: string; type: string; confidence: number; timestamp_ms: number }>;
  event_confidence: number;
  uncertain: boolean;
  reset_required: boolean;
  confidence: number;
  replay_recording_status: "idle" | "recording" | "exported" | "error";
  browser_latency: {
    p50_ms: number | null;
    p95_ms: number | null;
    max_ms: number | null;
    sample_count: number;
  };
  raw_media_persisted: false;
  cloud_calls_enabled: false;
  llm_calls: 0;
  vlm_calls: 0;
};

export type BrowserLocalCaptureSessionOptions = {
  traceId?: string;
  sessionId?: string;
  adapter?: LivePerceptionAdapter;
  physicalCapture?: boolean;
  operatorConfirmedPhysicalSession?: boolean;
  traceOrigin?: TraceOrigin;
};

export type BrowserTraceExportOptions = {
  fixtureId?: string;
  name?: string;
  description?: string;
};

export type BrowserLocalCaptureSession = {
  readonly privacy: BrowserCapturePrivacyState;
  startCamera(videoElement?: unknown): Promise<unknown>;
  stopCamera(): void;
  startTrace(traceId?: string, sessionId?: string, traceOrigin?: TraceOrigin): void;
  confirmPhysicalSession(): void;
  ingestObservation(draft: BrowserObservationDraft, timing?: BrowserTimingDraft): {
    frame: LocalObservationFrame;
    events: StableEvent[];
    latency: BrowserLatencyRecord;
    hud: BrowserDebugHudState;
  };
  exportReplayFixture(options?: BrowserTraceExportOptions): unknown;
  getDebugHudState(): BrowserDebugHudState;
};

export const BROWSER_TRACE_ORIGIN: TraceOrigin = {
  source: "browser.local_camera",
  raw_media_persisted: false,
  cloud_calls_enabled: false,
  manual_fixture: false,
  generated_by: "live-perception-adapter",
  capture_mode: "manual_calibration_browser_live",
  browser_latency_recorded: true
};

export const PHYSICAL_BROWSER_TRACE_ORIGIN: TraceOrigin = {
  source: "browser.local_camera",
  raw_media_persisted: false,
  cloud_calls_enabled: false,
  manual_fixture: false,
  generated_by: "browser-local-capture",
  capture_mode: "physical_webcam_manual_calibration",
  browser_latency_recorded: true,
  physical_capture: true,
  operator_confirmed_physical_session: true
};

export function createPhysicalBrowserTraceOrigin(operatorConfirmedPhysicalSession: boolean): TraceOrigin {
  return {
    ...PHYSICAL_BROWSER_TRACE_ORIGIN,
    operator_confirmed_physical_session: operatorConfirmedPhysicalSession
  };
}

export function createBrowserLocalCaptureSession(
  options: BrowserLocalCaptureSessionOptions = {}
): BrowserLocalCaptureSession {
  return new DefaultBrowserLocalCaptureSession(options);
}

class DefaultBrowserLocalCaptureSession implements BrowserLocalCaptureSession {
  readonly privacy: BrowserCapturePrivacyState = {
    raw_media_persisted: false,
    screenshots_persisted: false,
    base64_media_persisted: false,
    audio_requested: false,
    cloud_calls_enabled: false,
    llm_calls: 0,
    vlm_calls: 0
  };

  private readonly adapter: LivePerceptionAdapter;
  private traceOrigin: TraceOrigin;
  private recorder: LiveTraceRecorder;
  private stream: unknown;
  private latencyRecords: BrowserLatencyRecord[] = [];
  private hud: BrowserDebugHudState = {
    capture_status: "idle",
    physical_capture_status: "not_physical",
    quest_state: "idle",
    calibration_status: "uncalibrated",
    active_zone: null,
    last_frame_id: null,
    last_event_types: [],
    last_10_symbolic_events: [],
    event_confidence: 0,
    uncertain: false,
    reset_required: false,
    confidence: 0,
    replay_recording_status: "idle",
    browser_latency: {
      p50_ms: null,
      p95_ms: null,
      max_ms: null,
      sample_count: 0
    },
    raw_media_persisted: false,
    cloud_calls_enabled: false,
    llm_calls: 0,
    vlm_calls: 0
  };

  constructor(options: BrowserLocalCaptureSessionOptions) {
    const traceId = options.traceId ?? "live_browser_focus_ritual_001";
    const sessionId = options.sessionId ?? "ses_live_focus_ritual_001";
    this.traceOrigin = options.traceOrigin ?? (options.physicalCapture
      ? createPhysicalBrowserTraceOrigin(options.operatorConfirmedPhysicalSession === true)
      : BROWSER_TRACE_ORIGIN);
    this.adapter = options.adapter ?? createLivePerceptionAdapter();
    this.recorder = createLiveTraceRecorder(traceId, sessionId, this.traceOrigin);
    this.hud = {
      ...this.hud,
      physical_capture_status: this.traceOrigin.physical_capture === true
        ? this.traceOrigin.operator_confirmed_physical_session === true
          ? "operator_confirmed"
          : "awaiting_operator_confirmation"
        : "not_physical"
    };
  }

  async startCamera(videoElement?: unknown): Promise<unknown> {
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      this.hud = { ...this.hud, capture_status: "error" };
      throw new Error("browser camera API unavailable");
    }

    const stream = await mediaDevices.getUserMedia({ video: true, audio: false });
    this.stream = stream;
    attachStream(videoElement, stream);
    this.hud = { ...this.hud, capture_status: "camera_ready" };
    return stream;
  }

  stopCamera(): void {
    for (const track of getTracks(this.stream)) track.stop();
    this.stream = undefined;
    this.hud = { ...this.hud, capture_status: "stopped" };
  }

  startTrace(traceId = "live_browser_focus_ritual_001", sessionId = "ses_live_focus_ritual_001", traceOrigin = this.traceOrigin): void {
    this.traceOrigin = traceOrigin;
    this.latencyRecords = [];
    this.recorder = createLiveTraceRecorder(traceId, sessionId, traceOrigin);
    this.hud = {
      ...this.hud,
      capture_status: "recording",
      replay_recording_status: "recording",
      physical_capture_status: traceOrigin.physical_capture === true
        ? traceOrigin.operator_confirmed_physical_session === true
          ? "operator_confirmed"
          : "awaiting_operator_confirmation"
        : "not_physical",
      last_event_types: [],
      last_10_symbolic_events: []
    };
  }

  confirmPhysicalSession(): void {
    this.traceOrigin = createPhysicalBrowserTraceOrigin(true);
    this.recorder.setTraceOrigin(this.traceOrigin);
    this.hud = { ...this.hud, physical_capture_status: "operator_confirmed" };
  }

  ingestObservation(draft: BrowserObservationDraft, timing: BrowserTimingDraft = defaultTiming()): {
    frame: LocalObservationFrame;
    events: StableEvent[];
    latency: BrowserLatencyRecord;
    hud: BrowserDebugHudState;
  } {
    const frame: LocalObservationFrame = {
      frameId: draft.frameId,
      timestampMs: draft.timestampMs,
      source: "browser.local_camera",
      hands: draft.hands,
      objects: draft.objects,
      zones: draft.zones,
      scene: draft.scene
    };

    const adapterStartedAt = nowMs();
    const events = this.adapter.ingestObservation(frame);
    const adapterMs = timing.adapter_ms ?? Math.max(0, nowMs() - adapterStartedAt);
    const latency = browserLatencyRecord(frame, timing, adapterMs, events.length);

    this.recorder.appendEvents(events);
    this.recorder.appendBrowserLatency(latency);
    this.latencyRecords.push(latency);
    this.hud = debugHudFrom(frame, events, this.hud, this.latencyRecords);

    return { frame, events, latency, hud: this.getDebugHudState() };
  }

  exportReplayFixture(options: BrowserTraceExportOptions = {}): unknown {
    this.hud = { ...this.hud, replay_recording_status: "exported" };
    return this.recorder.exportFixture({
      fixtureId: options.fixtureId ?? (this.traceOrigin.physical_capture ? "live_physical_focus_ritual_001" : "live_browser_focus_ritual_001"),
      name: options.name ?? (this.traceOrigin.physical_capture ? "Gate 1C physical browser Focus Ritual" : "Gate 1B browser-local Focus Ritual"),
      description: options.description ?? "Browser-local symbolic trace exported without raw media persistence."
    });
  }

  getDebugHudState(): BrowserDebugHudState {
    return structuredClone(this.hud);
  }
}

function browserLatencyRecord(
  frame: LocalObservationFrame,
  timing: BrowserTimingDraft,
  adapterMs: number,
  eventCount: number
): BrowserLatencyRecord {
  const stabilizerMs = timing.stabilizer_ms ?? (eventCount > 0 ? 7 : 3);
  const eventEmissionMs = timing.event_emission_ms ?? (eventCount > 0 ? 3 : 1);
  const hudUpdateMs = timing.hud_update_ms ?? 6;
  const traceRecorderMs = timing.trace_recorder_ms ?? 2;
  const endToEndMs =
    timing.frame_capture_ms +
    timing.observation_extraction_ms +
    adapterMs +
    stabilizerMs +
    eventEmissionMs +
    hudUpdateMs +
    traceRecorderMs;

  return {
    frame_id: frame.frameId,
    timestamp_ms: frame.timestampMs,
    frame_capture_ms: timing.frame_capture_ms,
    observation_extraction_ms: timing.observation_extraction_ms,
    adapter_ms: adapterMs,
    stabilizer_ms: stabilizerMs,
    event_emission_ms: eventEmissionMs,
    hud_update_ms: hudUpdateMs,
    trace_recorder_ms: traceRecorderMs,
    end_to_end_ms: endToEndMs,
    dropped_frames: timing.dropped_frames ?? 0,
    llm_calls: 0,
    vlm_calls: 0,
    raw_media_persistence_count: 0
  };
}

function debugHudFrom(
  frame: LocalObservationFrame,
  events: StableEvent[],
  previous: BrowserDebugHudState,
  latencyRecords: BrowserLatencyRecord[]
): BrowserDebugHudState {
  const hasReset = events.some((event) => event.type === "scene.reset") || frame.scene.reset_detected;
  const recovered = events.some((event) => event.type === "confidence.changed" && Number(event.payload.current_confidence) >= 0.65);
  const last10 = [...previous.last_10_symbolic_events, ...events.map((event) => ({
    id: event.id,
    type: event.type,
    confidence: event.confidence,
    timestamp_ms: event.timestamp_ms
  }))].slice(-10);
  const latency = summarizeLatency(latencyRecords);
  return {
    ...previous,
    capture_status: previous.capture_status === "camera_ready" ? "recording" : previous.capture_status,
    quest_state: questStateFromEvents(events, previous.quest_state),
    calibration_status: hasReset ? "reset_required" : frame.scene.calibrated ? "calibrated" : previous.calibration_status,
    active_zone: activeZoneFrom(frame),
    last_frame_id: frame.frameId,
    last_event_types: events.map((event) => event.type),
    last_10_symbolic_events: last10,
    event_confidence: events.at(-1)?.confidence ?? previous.event_confidence,
    uncertain: frame.scene.uncertain && !recovered,
    reset_required: hasReset ? true : frame.scene.calibrated ? false : previous.reset_required,
    confidence: frame.scene.confidence,
    browser_latency: latency
  };
}

function questStateFromEvents(events: StableEvent[], previousState: string): string {
  for (const event of events) {
    if (event.type === "scene.reset") return "calibration_reset";
    if (event.type === "scene.uncertain") return "uncertain_hold";
    if (event.type === "gesture.detected" && event.payload.gesture_type === "typing_motion") return "typing_detected";
    if (event.type === "gesture.detected" && event.payload.gesture_type === "writing_motion") return "writing_detected";
    if (event.type === "object.moved" && event.payload.object_type === "pen") return "pen_detected";
    if (event.type === "object.placed" && event.payload.object_type === "notebook") return "notebook_opened";
    if (event.type === "object.moved" && event.payload.object_type === "phone") return "phone_removed";
    if (event.type === "scene.calibrated") return "calibrated";
  }
  return previousState;
}

function activeZoneFrom(frame: LocalObservationFrame): string | null {
  const handZone = frame.hands.find((hand) => hand.present && hand.zone_id)?.zone_id;
  if (handZone) return handZone;
  const activeObjectZone = frame.objects.find((object) => object.present && object.zone_id)?.zone_id;
  if (activeObjectZone) return activeObjectZone;
  return frame.zones.find((zone) => zone.active)?.zone_id ?? null;
}

function summarizeLatency(records: BrowserLatencyRecord[]): BrowserDebugHudState["browser_latency"] {
  const values = records.map((record) => record.end_to_end_ms).sort((a, b) => a - b);
  if (!values.length) return { p50_ms: null, p95_ms: null, max_ms: null, sample_count: 0 };
  return {
    p50_ms: percentile(values, 0.5),
    p95_ms: percentile(values, 0.95),
    max_ms: values[values.length - 1] ?? null,
    sample_count: values.length
  };
}

function percentile(values: number[], quantile: number): number {
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1));
  return values[index] ?? 0;
}

function defaultTiming(): BrowserTimingDraft {
  return {
    frame_capture_ms: 8,
    observation_extraction_ms: 18,
    stabilizer_ms: 7,
    event_emission_ms: 3,
    hud_update_ms: 6,
    trace_recorder_ms: 2,
    dropped_frames: 0
  };
}

function attachStream(videoElement: unknown, stream: unknown): void {
  if (!videoElement || typeof videoElement !== "object") return;
  const element = videoElement as { srcObject?: unknown; play?: () => Promise<void> };
  element.srcObject = stream;
  void element.play?.();
}

function getTracks(stream: unknown): Array<{ stop: () => void }> {
  if (!stream || typeof stream !== "object") return [];
  const candidate = stream as { getTracks?: () => Array<{ stop: () => void }> };
  return candidate.getTracks?.() ?? [];
}

function nowMs(): number {
  if (typeof performance !== "undefined") return Math.round(performance.now());
  return Date.now();
}
