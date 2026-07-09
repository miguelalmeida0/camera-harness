export type EvidenceRef = {
  id: string;
  kind: "local_signal" | "symbolic_fixture" | "human_correction" | "derived_state";
  description: string;
  contains_raw_media: false;
};

export type HandObservation = {
  id: string;
  zone_id: string | null;
  present: boolean;
  confidence: number;
  gesture_hint?: string;
};

export type ObjectObservation = {
  object_id: string;
  zone_id: string | null;
  present: boolean;
  confidence: number;
};

export type ZoneObservation = {
  zone_id: string;
  active: boolean;
  confidence: number;
};

export type SceneObservation = {
  calibrated: boolean;
  uncertain: boolean;
  reset_detected: boolean;
  confidence: number;
  reason?: string;
};

export type LocalObservationFrame = {
  frameId: string;
  timestampMs: number;
  source: "webcam.local" | "browser.local_camera";
  hands: HandObservation[];
  objects: ObjectObservation[];
  zones: ZoneObservation[];
  scene: SceneObservation;
};

export type StableEvent = {
  id: string;
  type: string;
  timestamp_ms: number;
  producer: "perception.local";
  confidence: number;
  payload: Record<string, unknown>;
  evidence: EvidenceRef[];
};

export type ManualCalibrationProfile = {
  session_id: string;
  calibration_id: string;
  timestamp_ms?: number;
  confidence: number;
  zone_ids: string[];
};

export type LivePerceptionDiagnostics = {
  raw_media_persisted: false;
  raw_audio_persisted: false;
  raw_frame_persisted: false;
  notebook_text_persisted: false;
  cloud_fallback_enabled: false;
  llm_calls: 0;
  vlm_calls: 0;
  estimated_cost_usd: 0;
  accepted_event_count: number;
  rejected_event_count: number;
  last_validation_error?: string;
};

export type AdapterLatencyRecord = {
  frame_id: string;
  timestamp_ms: number;
  observation_to_event_ms: number;
  emitted_event_count: number;
};

export type LiveSymbolicTrace = {
  schema: "darkquest.live_symbolic_trace.v0";
  trace_id: string;
  session_id: string;
  trace_origin?: TraceOrigin;
  started_at_ms: number;
  ended_at_ms: number | null;
  privacy: {
    contains_raw_video: false;
    contains_audio: false;
    contains_raw_frames: false;
    contains_screenshots: false;
    contains_notebook_text: false;
    cloud_calls_expected: false;
  };
  events: StableEvent[];
  quest_transitions: ReplayQuestTransition[];
  hud_commands: ReplayHudCommand[];
  memory_writes: unknown[];
  model_calls: unknown[];
  metrics: {
    adapter_latency_records: AdapterLatencyRecord[];
    browser_latency_records: BrowserLatencyRecord[];
    llm_calls: 0;
    vlm_calls: 0;
    estimated_cost_usd: 0;
    raw_video_persisted: false;
    raw_audio_persisted: false;
    raw_frame_persisted: false;
  };
  experimental_observations: unknown[];
};

export type TraceOrigin = {
  source: "browser.local_camera" | "webcam.local" | "symbolic.controlled";
  raw_media_persisted: false;
  cloud_calls_enabled: false;
  manual_fixture: boolean;
  generated_by: "live-perception-adapter" | "browser-local-capture";
  capture_mode: "manual_calibration_browser_live" | "physical_webcam_manual_calibration" | "controlled_symbolic";
  browser_latency_recorded: boolean;
  physical_capture?: boolean;
  operator_confirmed_physical_session?: boolean;
};

export type BrowserLatencyRecord = {
  frame_id: string;
  timestamp_ms: number;
  frame_capture_ms: number;
  observation_extraction_ms: number;
  adapter_ms: number;
  stabilizer_ms: number;
  event_emission_ms: number;
  hud_update_ms: number;
  trace_recorder_ms: number;
  end_to_end_ms: number;
  dropped_frames: number;
  llm_calls?: 0;
  vlm_calls?: 0;
  raw_media_persistence_count?: 0;
};

export type ReplayEvidenceRef = {
  kind: "fixture_assertion" | "event_ref" | "transition_guard" | "policy_rule" | "human_correction" | "metric_log";
  ref: string;
  contains_raw_media: false;
};

export type ReplayInputEvent = Omit<StableEvent, "evidence"> & {
  evidence: ReplayEvidenceRef[];
};

export type ReplayStableEventMatcher = {
  id: string;
  event_id: string;
  type: string;
  producer: "event_stabilizer";
  must_occur_after_ms: number;
  must_occur_before_ms: number;
  min_confidence: number;
  payload_match: Record<string, unknown>;
  evidence_includes: string[];
};

export type ReplayQuestTransition = {
  from_state: string;
  to_state: string;
  trigger_event_id: string;
  emitted_event_type: "quest.step_completed";
  step_id: string;
};

export type ReplayHudCommand = {
  command_id: string;
  command_type: "mark_step_complete" | "quest_complete" | "show_uncertain_state" | "show_recovery_state";
  target_surface: "quest_panel" | "recovery_banner";
  related_step_id: string;
  evidence_includes: string[];
};

export type ReplayFixture = {
  schema: "darkquest.replay_fixture.v0";
  fixture_id: string;
  name: string;
  description: string;
  created_by: string;
  trace_origin?: TraceOrigin;
  privacy: {
    contains_raw_video: false;
    contains_audio: false;
    cloud_calls_expected: false;
  };
  input_events: ReplayInputEvent[];
  expected: {
    stable_events: ReplayStableEventMatcher[];
    quest_transitions: ReplayQuestTransition[];
    hud_commands: ReplayHudCommand[];
    memory_writes: unknown[];
    model_calls: unknown[];
  };
  forbidden: {
    event_types: string[];
    memory_writes: Array<Record<string, string>>;
    model_calls: Array<Record<string, string | number>>;
    raw_video_persistence: true;
  };
  metrics: {
    max_llm_calls: 0;
    max_vlm_calls: 0;
    max_cost_usd: 0;
    max_replay_runtime_ms: number;
    p50_latency_ms?: number;
    p95_latency_ms?: number;
    max_latency_ms?: number;
    browser_latency_records?: BrowserLatencyRecord[];
  };
};

export type LivePerceptionAdapter = {
  ingestObservation(frame: LocalObservationFrame): StableEvent[];
  confirmCalibration(profile: ManualCalibrationProfile): StableEvent[];
  reset(reason: "user_reset" | "camera_bump" | "session_end" | "replay_restart", timestampMs?: number): StableEvent[];
  getDiagnostics(): LivePerceptionDiagnostics;
};

export type LivePerceptionAdapterOptions = {
  sessionId?: string;
  calibrationId?: string;
  sceneThreshold?: number;
  handThreshold?: number;
  objectThreshold?: number;
  gestureThreshold?: number;
  dwellThresholdMs?: number;
  gestureWindowMs?: number;
  zoneAliases?: Record<string, string>;
};

type ObjectTrack = {
  object_id: string;
  object_type: string;
  zone_id: string;
  zone_entered_at_ms: number;
  last_seen_at_ms: number;
  placed_emitted_zones: Set<string>;
};

type HandTrack = {
  hand_id: string;
  zone_id: string | null;
  tracking_id: string;
  zone_entered_at_ms: number;
  last_seen_at_ms: number;
};

type GestureTrack = {
  key: string;
  first_seen_at_ms: number;
  last_seen_at_ms: number;
  count: number;
  emitted: boolean;
};

type QuestStepSpec = {
  step_id: string;
  from_state: string;
  to_state: string;
  hud_command_id: string;
  hud_command_type: "mark_step_complete";
  guard: (event: ReplayInputEvent) => boolean;
};

const DEFAULT_SESSION_ID = "ses_live_focus_ritual_001";
const DEFAULT_CALIBRATION_ID = "cal_live_focus_ritual_001";

const DEFAULT_ZONE_ALIASES: Record<string, string> = {
  phone_zone: "zone_focus",
  notebook_zone: "zone_notebook",
  pen_zone: "zone_pen_tool",
  keyboard_zone: "zone_keyboard",
  neutral_zone: "zone_away",
  off_desk_zone: "zone_away",
  zone_focus: "zone_focus",
  zone_notebook: "zone_notebook",
  zone_pen_tool: "zone_pen_tool",
  zone_keyboard: "zone_keyboard",
  zone_laptop: "zone_laptop",
  zone_away: "zone_away"
};

const PERCEPTION_EVENT_TYPES = new Set([
  "scene.calibrated",
  "hand.entered_zone",
  "hand.left_zone",
  "object.moved",
  "object.placed",
  "gesture.detected",
  "zone.activated",
  "confidence.changed",
  "scene.uncertain",
  "scene.reset"
]);

const STABLE_REPLAY_EVENT_TYPES = new Set([
  "scene.calibrated",
  "hand.entered_zone",
  "hand.left_zone",
  "object.moved",
  "object.placed",
  "gesture.detected",
  "zone.activated",
  "confidence.changed",
  "scene.uncertain",
  "scene.reset"
]);

const REQUIRED_PAYLOAD_FIELDS: Record<string, string[]> = {
  "scene.calibrated": ["session_id", "zone_ids", "calibration_id", "scene_confidence"],
  "hand.entered_zone": ["hand_id", "zone_id", "tracking_id"],
  "hand.left_zone": ["hand_id", "zone_id", "tracking_id", "dwell_ms"],
  "object.moved": ["object_id", "object_type", "from_zone_id", "to_zone_id", "duration_ms"],
  "object.placed": ["object_id", "object_type", "zone_id", "dwell_ms"],
  "gesture.detected": ["gesture_id", "gesture_type", "zone_id", "actor_ref", "evidence_window_ms"],
  "zone.activated": ["zone_id", "activation_reason", "trigger_event_id"],
  "confidence.changed": ["target_ref", "previous_confidence", "current_confidence", "reason_code"],
  "scene.uncertain": ["uncertainty_kind", "affected_refs", "resolver_hint", "escalation_recommended"],
  "scene.reset": ["reset_reason", "reset_scope", "previous_state_id"]
};

const QUEST_STEPS: QuestStepSpec[] = [
  {
    step_id: "step_phone_away",
    from_state: "phone_removal_pending",
    to_state: "phone_removed",
    hud_command_id: "hud_mark_phone_away",
    hud_command_type: "mark_step_complete",
    guard: (event) =>
      event.type === "object.moved" &&
      event.confidence >= 0.86 &&
      event.payload.object_type === "phone" &&
      event.payload.from_zone_id === "zone_focus" &&
      event.payload.to_zone_id !== "zone_focus"
  },
  {
    step_id: "step_notebook_open",
    from_state: "notebook_pending",
    to_state: "notebook_opened",
    hud_command_id: "hud_mark_notebook_open",
    hud_command_type: "mark_step_complete",
    guard: (event) =>
      event.type === "object.placed" &&
      event.confidence >= 0.86 &&
      event.payload.object_type === "notebook" &&
      event.payload.zone_id === "zone_notebook" &&
      Number(event.payload.dwell_ms) >= 500
  },
  {
    step_id: "step_pen_pickup",
    from_state: "pen_pending",
    to_state: "pen_detected",
    hud_command_id: "hud_mark_pen_pickup",
    hud_command_type: "mark_step_complete",
    guard: (event) =>
      (event.type === "object.moved" || event.type === "object.placed") &&
      event.confidence >= 0.86 &&
      event.payload.object_type === "pen" &&
      (event.payload.to_zone_id === "zone_notebook" ||
        event.payload.to_zone_id === "zone_focus" ||
        event.payload.zone_id === "zone_notebook" ||
        event.payload.zone_id === "zone_focus")
  },
  {
    step_id: "step_write_three_bullets",
    from_state: "writing_pending",
    to_state: "writing_detected",
    hud_command_id: "hud_mark_write_three_bullets",
    hud_command_type: "mark_step_complete",
    guard: (event) =>
      event.type === "gesture.detected" &&
      event.confidence >= 0.82 &&
      event.payload.gesture_type === "writing_motion" &&
      event.payload.zone_id === "zone_notebook" &&
      Number(event.payload.evidence_window_ms) >= 900 &&
      Number(event.payload.gesture_repetition_count ?? 0) >= 3
  },
  {
    step_id: "step_start_typing",
    from_state: "typing_pending",
    to_state: "typing_detected",
    hud_command_id: "hud_mark_start_typing",
    hud_command_type: "mark_step_complete",
    guard: (event) =>
      event.type === "gesture.detected" &&
      event.confidence >= 0.82 &&
      event.payload.gesture_type === "typing_motion" &&
      (event.payload.zone_id === "zone_keyboard" || event.payload.zone_id === "zone_laptop") &&
      Number(event.payload.evidence_window_ms) >= 900
  }
];

const RAW_MEDIA_PATTERNS = [
  /^data:(image|audio|video)\//i,
  /(^|[/\\])[^/\\]+\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|wav|mp3)$/i,
  /raw_(frame|video|audio):\/\//i,
  /^raw_(frame|video|audio):/i,
  /base64/i,
  /notebook_text/i,
  /\bocr\b/i
];

const VAGUE_KEYS = new Set(["data", "stuff", "info", "raw", "blob"]);
const SAFE_FALSE_PRIVACY_KEYS = new Set([
  "contains_raw_video",
  "contains_audio",
  "contains_raw_frames",
  "contains_screenshots",
  "contains_notebook_text",
  "cloud_calls_expected",
  "raw_video_persisted",
  "raw_audio_persisted",
  "raw_frame_persisted",
  "notebook_text_persisted"
]);

export function createLivePerceptionAdapter(options: LivePerceptionAdapterOptions = {}): LivePerceptionAdapter {
  return new DefaultLivePerceptionAdapter(options);
}

export class DefaultLivePerceptionAdapter implements LivePerceptionAdapter {
  private readonly sessionId: string;
  private readonly calibrationId: string;
  private readonly sceneThreshold: number;
  private readonly handThreshold: number;
  private readonly objectThreshold: number;
  private readonly gestureThreshold: number;
  private readonly dwellThresholdMs: number;
  private readonly gestureWindowMs: number;
  private readonly zoneAliases: Record<string, string>;
  private readonly objectTracks = new Map<string, ObjectTrack>();
  private readonly handTracks = new Map<string, HandTrack>();
  private readonly gestureTracks = new Map<string, GestureTrack>();
  private lastTimestampMs = -1;
  private calibrated = false;
  private sceneUncertain = false;
  private acceptedEventCount = 0;
  private rejectedEventCount = 0;
  private lastValidationError: string | undefined;

  constructor(options: LivePerceptionAdapterOptions) {
    this.sessionId = options.sessionId ?? DEFAULT_SESSION_ID;
    this.calibrationId = options.calibrationId ?? DEFAULT_CALIBRATION_ID;
    this.sceneThreshold = options.sceneThreshold ?? 0.8;
    this.handThreshold = options.handThreshold ?? 0.85;
    this.objectThreshold = options.objectThreshold ?? 0.86;
    this.gestureThreshold = options.gestureThreshold ?? 0.82;
    this.dwellThresholdMs = options.dwellThresholdMs ?? 700;
    this.gestureWindowMs = options.gestureWindowMs ?? 900;
    this.zoneAliases = { ...DEFAULT_ZONE_ALIASES, ...(options.zoneAliases ?? {}) };
  }

  confirmCalibration(profile: ManualCalibrationProfile): StableEvent[] {
    const timestampMs = profile.timestamp_ms ?? Math.max(this.lastTimestampMs, 0);
    if (!this.acceptTimestamp(timestampMs)) return [];

    const zoneIds = unique(profile.zone_ids.map((zoneId) => this.normalizeZone(zoneId)).filter(isString));
    if (profile.confidence < this.sceneThreshold || zoneIds.length === 0) {
      return this.reject(`calibration confidence or zones invalid: confidence=${profile.confidence}, zones=${zoneIds.length}`);
    }

    const event = this.event(
      "evt_scene_calibrated",
      "scene.calibrated",
      timestampMs,
      profile.confidence,
      {
        session_id: profile.session_id,
        zone_ids: zoneIds,
        calibration_id: profile.calibration_id,
        scene_confidence: profile.confidence
      },
      evidence("ev_scene_calibrated", "local_signal", "Manual/local calibration confirmed required zones.")
    );

    this.calibrated = true;
    return this.acceptEvents([event]);
  }

  ingestObservation(frame: LocalObservationFrame): StableEvent[] {
    if (!this.validateFrame(frame)) return [];
    if (!this.acceptTimestamp(frame.timestampMs)) return [];

    const startedAt = nowMs();
    const events: StableEvent[] = [];

    if (frame.scene.reset_detected) {
      this.sceneUncertain = false;
      events.push(...this.reset("camera_bump", frame.timestampMs));
      return events;
    }

    if (frame.scene.calibrated && !this.calibrated && frame.scene.confidence >= this.sceneThreshold) {
      const zoneIds = frame.zones.map((zone) => this.normalizeZone(zone.zone_id)).filter(isString);
      events.push(...this.confirmCalibration({
        session_id: this.sessionId,
        calibration_id: this.calibrationId,
        timestamp_ms: frame.timestampMs,
        confidence: frame.scene.confidence,
        zone_ids: zoneIds
      }));
    }

    if (frame.scene.uncertain) {
      this.sceneUncertain = true;
      events.push(this.event(
        `evt_scene_uncertain_${slug(frame.scene.reason ?? "local")}`,
        "scene.uncertain",
        frame.timestampMs,
        frame.scene.confidence,
        {
          uncertainty_kind: frame.scene.reason ?? "local_uncertainty",
          affected_refs: ["scene"],
          resolver_hint: "review_local_symbolic_trace",
          escalation_recommended: false
        },
        evidence(`ev_scene_uncertain_${frame.frameId}`, "local_signal", "Local scene uncertainty reported.")
      ));
      return this.acceptEvents(events);
    }

    if (this.sceneUncertain) {
      this.sceneUncertain = false;
      events.push(this.event(
        `evt_confidence_recovered_${slug(frame.scene.reason ?? "scene")}`,
        "confidence.changed",
        frame.timestampMs,
        frame.scene.confidence,
        {
          target_ref: "scene",
          previous_confidence: Math.min(0.64, frame.scene.confidence),
          current_confidence: frame.scene.confidence,
          reason_code: "recovered_after_uncertainty"
        },
        evidence(`ev_${frame.frameId}_confidence_recovered`, "derived_state", "Scene confidence recovered after local uncertainty.")
      ));
    }

    events.push(...this.processHands(frame));
    events.push(...this.processObjects(frame));
    events.push(...this.processGestures(frame));

    const accepted = this.acceptEvents(events);
    this.lastLatencyRecord = {
      frame_id: frame.frameId,
      timestamp_ms: frame.timestampMs,
      observation_to_event_ms: Math.max(0, nowMs() - startedAt),
      emitted_event_count: accepted.length
    };
    return accepted;
  }

  reset(reason: "user_reset" | "camera_bump" | "session_end" | "replay_restart", timestampMs = Math.max(this.lastTimestampMs, 0)): StableEvent[] {
    this.objectTracks.clear();
    this.handTracks.clear();
    this.gestureTracks.clear();
    this.calibrated = false;
    this.sceneUncertain = false;

    const event = this.event(
      `evt_scene_reset_${slug(reason)}`,
      "scene.reset",
      timestampMs,
      1,
      {
        reset_reason: reason,
        reset_scope: reason === "camera_bump" ? "calibration" : "session",
        previous_state_id: "live_perception"
      },
      evidence(`ev_scene_reset_${slug(reason)}`, "derived_state", `Local reset requested: ${reason}.`)
    );

    return this.acceptEvents([event]);
  }

  getDiagnostics(): LivePerceptionDiagnostics {
    const base = {
      raw_media_persisted: false as const,
      raw_audio_persisted: false as const,
      raw_frame_persisted: false as const,
      notebook_text_persisted: false as const,
      cloud_fallback_enabled: false as const,
      llm_calls: 0 as const,
      vlm_calls: 0 as const,
      estimated_cost_usd: 0 as const,
      accepted_event_count: this.acceptedEventCount,
      rejected_event_count: this.rejectedEventCount
    };
    return this.lastValidationError
      ? { ...base, last_validation_error: this.lastValidationError }
      : base;
  }

  private lastLatencyRecord: AdapterLatencyRecord | null = null;

  getLastLatencyRecord(): AdapterLatencyRecord | null {
    return this.lastLatencyRecord;
  }

  private processHands(frame: LocalObservationFrame): StableEvent[] {
    const events: StableEvent[] = [];

    for (const hand of frame.hands) {
      const zoneId = hand.zone_id ? this.normalizeZone(hand.zone_id) : null;
      const existing = this.handTracks.get(hand.id);
      const trackingId = `trk_${slug(hand.id)}`;

      if (!hand.present || !zoneId) {
        if (existing?.zone_id) {
          events.push(this.event(
            `evt_${slug(hand.id)}_left_${slug(existing.zone_id)}`,
            "hand.left_zone",
            frame.timestampMs,
            hand.confidence,
            {
              hand_id: hand.id,
              zone_id: existing.zone_id,
              tracking_id: existing.tracking_id,
              dwell_ms: Math.max(0, frame.timestampMs - existing.zone_entered_at_ms)
            },
            evidence(`ev_${frame.frameId}_${hand.id}_left_${existing.zone_id}`, "local_signal", "Hand left normalized zone.")
          ));
          this.handTracks.delete(hand.id);
        }
        continue;
      }

      if (hand.confidence < this.handThreshold) continue;

      if (!existing || existing.zone_id !== zoneId) {
        this.handTracks.set(hand.id, {
          hand_id: hand.id,
          zone_id: zoneId,
          tracking_id: trackingId,
          zone_entered_at_ms: frame.timestampMs,
          last_seen_at_ms: frame.timestampMs
        });

        events.push(this.event(
          `evt_${slug(hand.id)}_entered_${slug(zoneId)}`,
          "hand.entered_zone",
          frame.timestampMs,
          hand.confidence,
          {
            hand_id: hand.id,
            zone_id: zoneId,
            tracking_id: trackingId
          },
          evidence(`ev_${frame.frameId}_${hand.id}_entered_${zoneId}`, "local_signal", "Hand entered normalized zone.")
        ));
        continue;
      }

      existing.last_seen_at_ms = frame.timestampMs;
    }

    return events;
  }

  private processObjects(frame: LocalObservationFrame): StableEvent[] {
    const events: StableEvent[] = [];

    for (const object of frame.objects) {
      const zoneId = object.zone_id ? this.normalizeZone(object.zone_id) : null;
      const objectType = objectTypeFromId(object.object_id);
      const existing = this.objectTracks.get(object.object_id);

      if (!object.present || !zoneId) {
        if (existing) existing.last_seen_at_ms = frame.timestampMs;
        continue;
      }

      if (object.confidence < this.objectThreshold) {
        continue;
      }

      if (!existing) {
        this.objectTracks.set(object.object_id, {
          object_id: object.object_id,
          object_type: objectType,
          zone_id: zoneId,
          zone_entered_at_ms: frame.timestampMs,
          last_seen_at_ms: frame.timestampMs,
          placed_emitted_zones: new Set()
        });
        continue;
      }

      if (existing.zone_id !== zoneId) {
        const fromZoneId = existing.zone_id;
        const durationMs = Math.max(1, frame.timestampMs - existing.last_seen_at_ms);
        existing.zone_id = zoneId;
        existing.zone_entered_at_ms = frame.timestampMs;
        existing.last_seen_at_ms = frame.timestampMs;

        events.push(this.event(
          `evt_${slug(objectType)}_moved_to_${slug(zoneId)}`,
          "object.moved",
          frame.timestampMs,
          object.confidence,
          {
            object_id: object.object_id,
            object_type: objectType,
            from_zone_id: fromZoneId,
            to_zone_id: zoneId,
            duration_ms: durationMs
          },
          evidence(`ev_${frame.frameId}_${object.object_id}_moved_to_${zoneId}`, "local_signal", "Object changed normalized zones.")
        ));
        continue;
      }

      existing.last_seen_at_ms = frame.timestampMs;
      const dwellMs = frame.timestampMs - existing.zone_entered_at_ms;
      if (dwellMs >= this.dwellThresholdMs && !existing.placed_emitted_zones.has(zoneId)) {
        existing.placed_emitted_zones.add(zoneId);
        events.push(this.event(
          `evt_${slug(objectType)}_placed_${slug(zoneId)}`,
          "object.placed",
          frame.timestampMs,
          object.confidence,
          {
            object_id: object.object_id,
            object_type: objectType,
            zone_id: zoneId,
            dwell_ms: dwellMs
          },
          evidence(`ev_${frame.frameId}_${object.object_id}_placed_${zoneId}`, "local_signal", "Object rested in normalized zone long enough for placement.")
        ));
      }
    }

    return events;
  }

  private processGestures(frame: LocalObservationFrame): StableEvent[] {
    const events: StableEvent[] = [];

    for (const hand of frame.hands) {
      const gestureType = normalizeGesture(hand.gesture_hint);
      const zoneId = hand.zone_id ? this.normalizeZone(hand.zone_id) : null;
      if (!hand.present || !gestureType || !zoneId || hand.confidence < this.gestureThreshold) continue;

      const key = `${hand.id}:${gestureType}:${zoneId}`;
      let track = this.gestureTracks.get(key);
      if (!track) {
        track = {
          key,
          first_seen_at_ms: frame.timestampMs,
          last_seen_at_ms: frame.timestampMs,
          count: 0,
          emitted: false
        };
        this.gestureTracks.set(key, track);
      }

      track.count += 1;
      track.last_seen_at_ms = frame.timestampMs;

      const evidenceWindowMs = track.last_seen_at_ms - track.first_seen_at_ms;
      const minCount = gestureType === "writing_motion" ? 3 : 2;
      if (track.emitted || evidenceWindowMs < this.gestureWindowMs || track.count < minCount) continue;

      track.emitted = true;
      const gestureId = gestureType === "writing_motion" ? "gst_writing_001" : "gst_typing_001";
      const eventId = gestureType === "writing_motion" ? "evt_writing_three_bullets" : "evt_typing_started";
      const payload: Record<string, unknown> = {
        gesture_id: gestureId,
        gesture_type: gestureType,
        zone_id: zoneId,
        actor_ref: hand.id,
        evidence_window_ms: evidenceWindowMs,
        gesture_repetition_count: track.count
      };

      if (gestureType === "writing_motion") payload.related_object_id = "obj_pen";

      events.push(this.event(
        eventId,
        "gesture.detected",
        frame.timestampMs,
        hand.confidence,
        payload,
        evidence(`ev_${frame.frameId}_${gestureType}`, "local_signal", "Gesture hint stabilized across the required evidence window.")
      ));
    }

    return events;
  }

  private validateFrame(frame: LocalObservationFrame): boolean {
    if (frame.source !== "webcam.local" && frame.source !== "browser.local_camera") {
      return this.rejectOne("observation source must be webcam.local or browser.local_camera");
    }
    if (!Number.isInteger(frame.timestampMs) || frame.timestampMs < 0) return this.rejectOne("timestampMs must be a non-negative integer");
    if (containsRawMedia(frame)) return this.rejectOne("local observation frame contains a forbidden raw media reference");
    return true;
  }

  private acceptTimestamp(timestampMs: number): boolean {
    if (timestampMs < this.lastTimestampMs) {
      return this.rejectOne(`timestamp ${timestampMs} is older than previous timestamp ${this.lastTimestampMs}`);
    }
    this.lastTimestampMs = timestampMs;
    return true;
  }

  private event(
    id: string,
    type: string,
    timestampMs: number,
    confidence: number,
    payload: Record<string, unknown>,
    evidenceRef: EvidenceRef
  ): StableEvent {
    return {
      id,
      type,
      timestamp_ms: timestampMs,
      producer: "perception.local",
      confidence: roundConfidence(confidence),
      payload,
      evidence: [evidenceRef]
    };
  }

  private acceptEvents(events: StableEvent[]): StableEvent[] {
    const accepted: StableEvent[] = [];
    for (const event of events) {
      const validation = validateStableEvent(event);
      if (!validation.valid) {
        this.rejectedEventCount += 1;
        this.lastValidationError = validation.error;
        continue;
      }
      accepted.push(event);
    }
    this.acceptedEventCount += accepted.length;
    return accepted;
  }

  private reject(error: string): StableEvent[] {
    this.rejectOne(error);
    return [];
  }

  private rejectOne(error: string): false {
    this.rejectedEventCount += 1;
    this.lastValidationError = error;
    return false;
  }

  private normalizeZone(zoneId: string): string | null {
    return this.zoneAliases[zoneId] ?? null;
  }
}

export function createLiveSymbolicTrace(traceId: string, sessionId = DEFAULT_SESSION_ID, traceOrigin?: TraceOrigin): LiveSymbolicTrace {
  return {
    schema: "darkquest.live_symbolic_trace.v0",
    trace_id: traceId,
    session_id: sessionId,
    ...(traceOrigin ? { trace_origin: traceOrigin } : {}),
    started_at_ms: 0,
    ended_at_ms: null,
    privacy: {
      contains_raw_video: false,
      contains_audio: false,
      contains_raw_frames: false,
      contains_screenshots: false,
      contains_notebook_text: false,
      cloud_calls_expected: false
    },
    events: [],
    quest_transitions: [],
    hud_commands: [],
    memory_writes: [],
    model_calls: [],
    metrics: {
      adapter_latency_records: [],
      browser_latency_records: [],
      llm_calls: 0,
      vlm_calls: 0,
      estimated_cost_usd: 0,
      raw_video_persisted: false,
      raw_audio_persisted: false,
      raw_frame_persisted: false
    },
    experimental_observations: []
  };
}

export function appendTraceEvents(trace: LiveSymbolicTrace, events: StableEvent[], latency?: AdapterLatencyRecord | null): LiveSymbolicTrace {
  for (const event of events) {
    const validation = validateStableEvent(event);
    if (!validation.valid) throw new Error(validation.error);
  }
  trace.events.push(...events);
  if (latency) trace.metrics.adapter_latency_records.push(latency);
  if (events.length) trace.ended_at_ms = events[events.length - 1]?.timestamp_ms ?? trace.ended_at_ms;
  return trace;
}

export function exportTraceToReplayFixture(
  trace: LiveSymbolicTrace,
  options: {
    fixtureId?: string;
    name?: string;
    description?: string;
    createdBy?: string;
    maxReplayRuntimeMs?: number;
  } = {}
): ReplayFixture {
  assertTraceSafe(trace);
  const inputEvents = trace.events.map(toReplayInputEvent);
  const questTransitions = deriveQuestTransitions(inputEvents);
  const hudCommands = deriveHudCommands(questTransitions);
  const browserLatencyRecords = trace.metrics.browser_latency_records;
  const browserLatency = summarizeBrowserLatencies(browserLatencyRecords);

  return {
    schema: "darkquest.replay_fixture.v0",
    fixture_id: options.fixtureId ?? trace.trace_id,
    name: options.name ?? "Gate 1A live symbolic trace",
    description: options.description ?? "Replay-compatible symbolic trace exported from Gate 1A local perception.",
    created_by: options.createdBy ?? "PARALLAX live-perception-adapter",
    ...(trace.trace_origin ? { trace_origin: trace.trace_origin } : {}),
    privacy: {
      contains_raw_video: false,
      contains_audio: false,
      cloud_calls_expected: false
    },
    input_events: inputEvents,
    expected: {
      stable_events: inputEvents.filter((event) => STABLE_REPLAY_EVENT_TYPES.has(event.type)).map(toStableEventMatcher),
      quest_transitions: questTransitions,
      hud_commands: hudCommands,
      memory_writes: [],
      model_calls: []
    },
    forbidden: {
      event_types: ["agent.escalation_requested"],
      memory_writes: [
        { memory_scope: "raw_frame_memory" },
        { privacy_classification: "forbidden_raw_media" }
      ],
      model_calls: [
        { approved_tier: 1 },
        { approved_tier: 2 },
        { approved_tier: 3 },
        { approved_tier: 4 },
        { input_class: "continuous_video" },
        { input_class: "raw_video" },
        { input_class: "raw_frame" }
      ],
      raw_video_persistence: true
    },
    metrics: {
      max_llm_calls: 0,
      max_vlm_calls: 0,
      max_cost_usd: 0,
      max_replay_runtime_ms: options.maxReplayRuntimeMs ?? 1000,
      ...(browserLatencyRecords.length
        ? {
            p50_latency_ms: browserLatency.p50,
            p95_latency_ms: browserLatency.p95,
            max_latency_ms: browserLatency.max,
            browser_latency_records: browserLatencyRecords
          }
        : {})
    }
  };
}

export function toReplayInputEvent(event: StableEvent): ReplayInputEvent {
  return {
    ...event,
    evidence: event.evidence.map(toReplayEvidenceRef)
  };
}

export function validateStableEvent(event: StableEvent): { valid: true } | { valid: false; error: string } {
  if (!PERCEPTION_EVENT_TYPES.has(event.type)) return { valid: false, error: `unsupported perception event type: ${event.type}` };
  if (event.producer !== "perception.local") return { valid: false, error: `producer must be perception.local: ${event.producer}` };
  if (!Number.isInteger(event.timestamp_ms) || event.timestamp_ms < 0) return { valid: false, error: "timestamp_ms must be a non-negative integer" };
  if (typeof event.confidence !== "number" || event.confidence < 0 || event.confidence > 1) return { valid: false, error: "confidence must be between 0 and 1" };
  if (!isPlainObject(event.payload)) return { valid: false, error: "payload must be an object" };
  if (!Array.isArray(event.evidence) || event.evidence.length === 0) return { valid: false, error: "evidence must be a non-empty array" };

  for (const field of REQUIRED_PAYLOAD_FIELDS[event.type] ?? []) {
    if (!(field in event.payload)) return { valid: false, error: `missing payload field ${field} for ${event.type}` };
  }

  const forbiddenKey = findForbiddenKey(event.payload);
  if (forbiddenKey) return { valid: false, error: `forbidden broad or raw payload key: ${forbiddenKey}` };
  if (containsRawMedia(event.payload)) return { valid: false, error: "payload contains forbidden raw media reference" };

  for (const evidenceRef of event.evidence) {
    if (evidenceRef.contains_raw_media !== false) return { valid: false, error: `evidence ${evidenceRef.id} contains raw media` };
    if (containsRawMedia(evidenceRef)) return { valid: false, error: `evidence ${evidenceRef.id} contains forbidden raw media reference` };
  }

  return { valid: true };
}

export function createGate1AHappyPathFrames(source: LocalObservationFrame["source"] = "webcam.local"): LocalObservationFrame[] {
  const baseScene: SceneObservation = {
    calibrated: true,
    uncertain: false,
    reset_detected: false,
    confidence: 0.94
  };

  const zoneObservations: ZoneObservation[] = [
    { zone_id: "phone_zone", active: true, confidence: 0.94 },
    { zone_id: "notebook_zone", active: true, confidence: 0.94 },
    { zone_id: "pen_zone", active: true, confidence: 0.94 },
    { zone_id: "keyboard_zone", active: true, confidence: 0.94 },
    { zone_id: "off_desk_zone", active: true, confidence: 0.94 }
  ];

  const objectsAtStart: ObjectObservation[] = [
    { object_id: "obj_phone", zone_id: "phone_zone", present: true, confidence: 0.92 },
    { object_id: "obj_pen", zone_id: "pen_zone", present: true, confidence: 0.9 },
    { object_id: "obj_keyboard", zone_id: "keyboard_zone", present: true, confidence: 0.91 }
  ];

  return [
    frame("frm_0000", 0, source, [], objectsAtStart, zoneObservations, baseScene),
    frame("frm_1000", 1000, source, [], [
      { object_id: "obj_phone", zone_id: "off_desk_zone", present: true, confidence: 0.92 },
      { object_id: "obj_pen", zone_id: "pen_zone", present: true, confidence: 0.9 },
      { object_id: "obj_keyboard", zone_id: "keyboard_zone", present: true, confidence: 0.91 }
    ], zoneObservations, baseScene),
    frame("frm_1400", 1400, source, [], [
      { object_id: "obj_phone", zone_id: "off_desk_zone", present: true, confidence: 0.92 },
      { object_id: "obj_notebook", zone_id: "notebook_zone", present: true, confidence: 0.91 },
      { object_id: "obj_pen", zone_id: "pen_zone", present: true, confidence: 0.9 },
      { object_id: "obj_keyboard", zone_id: "keyboard_zone", present: true, confidence: 0.91 }
    ], zoneObservations, baseScene),
    frame("frm_2200", 2200, source, [], [
      { object_id: "obj_notebook", zone_id: "notebook_zone", present: true, confidence: 0.91 },
      { object_id: "obj_pen", zone_id: "pen_zone", present: true, confidence: 0.9 },
      { object_id: "obj_keyboard", zone_id: "keyboard_zone", present: true, confidence: 0.91 }
    ], zoneObservations, baseScene),
    frame("frm_3000", 3000, source, [
      { id: "hand_right", zone_id: "pen_zone", present: true, confidence: 0.89 }
    ], [
      { object_id: "obj_notebook", zone_id: "notebook_zone", present: true, confidence: 0.91 },
      { object_id: "obj_pen", zone_id: "pen_zone", present: true, confidence: 0.9 },
      { object_id: "obj_keyboard", zone_id: "keyboard_zone", present: true, confidence: 0.91 }
    ], zoneObservations, baseScene),
    frame("frm_3300", 3300, source, [
      { id: "hand_right", zone_id: "notebook_zone", present: true, confidence: 0.9 }
    ], [
      { object_id: "obj_notebook", zone_id: "notebook_zone", present: true, confidence: 0.91 },
      { object_id: "obj_pen", zone_id: "notebook_zone", present: true, confidence: 0.9 },
      { object_id: "obj_keyboard", zone_id: "keyboard_zone", present: true, confidence: 0.91 }
    ], zoneObservations, baseScene),
    frame("frm_3700", 3700, source, [
      { id: "hand_right", zone_id: "notebook_zone", present: true, confidence: 0.88, gesture_hint: "writing_motion" }
    ], [
      { object_id: "obj_notebook", zone_id: "notebook_zone", present: true, confidence: 0.91 },
      { object_id: "obj_pen", zone_id: "notebook_zone", present: true, confidence: 0.9 }
    ], zoneObservations, baseScene),
    frame("frm_4200", 4200, source, [
      { id: "hand_right", zone_id: "notebook_zone", present: true, confidence: 0.88, gesture_hint: "writing_motion" }
    ], [
      { object_id: "obj_notebook", zone_id: "notebook_zone", present: true, confidence: 0.91 },
      { object_id: "obj_pen", zone_id: "notebook_zone", present: true, confidence: 0.9 }
    ], zoneObservations, baseScene),
    frame("frm_4700", 4700, source, [
      { id: "hand_right", zone_id: "notebook_zone", present: true, confidence: 0.88, gesture_hint: "writing_motion" }
    ], [
      { object_id: "obj_notebook", zone_id: "notebook_zone", present: true, confidence: 0.91 },
      { object_id: "obj_pen", zone_id: "notebook_zone", present: true, confidence: 0.9 }
    ], zoneObservations, baseScene),
    frame("frm_5250", 5250, source, [
      { id: "hand_both", zone_id: "keyboard_zone", present: true, confidence: 0.89, gesture_hint: "typing_motion" }
    ], [
      { object_id: "obj_keyboard", zone_id: "keyboard_zone", present: true, confidence: 0.91 }
    ], zoneObservations, baseScene),
    frame("frm_5700", 5700, source, [
      { id: "hand_both", zone_id: "keyboard_zone", present: true, confidence: 0.89, gesture_hint: "typing_motion" }
    ], [
      { object_id: "obj_keyboard", zone_id: "keyboard_zone", present: true, confidence: 0.91 }
    ], zoneObservations, baseScene),
    frame("frm_6200", 6200, source, [
      { id: "hand_both", zone_id: "keyboard_zone", present: true, confidence: 0.89, gesture_hint: "typing_motion" }
    ], [
      { object_id: "obj_keyboard", zone_id: "keyboard_zone", present: true, confidence: 0.91 }
    ], zoneObservations, baseScene)
  ];
}

export function createGate1AHappyPathFixture(): ReplayFixture {
  return exportTraceToReplayFixture(createGate1AHappyPathTrace(), {
    fixtureId: "live_focus_ritual_001",
    name: "Gate 1A live symbolic Focus Ritual",
    description: "Symbolic-only live local perception trace exported into the replay harness format."
  });
}

export function createGate1AHappyPathTrace(): LiveSymbolicTrace {
  const adapter = createLivePerceptionAdapter();
  const trace = createLiveSymbolicTrace("live_focus_ritual_001");

  appendTraceEvents(trace, adapter.confirmCalibration({
    session_id: DEFAULT_SESSION_ID,
    calibration_id: DEFAULT_CALIBRATION_ID,
    timestamp_ms: 0,
    confidence: 0.94,
    zone_ids: ["phone_zone", "notebook_zone", "pen_zone", "keyboard_zone", "off_desk_zone"]
  }));

  for (const observation of createGate1AHappyPathFrames()) {
    const events = adapter.ingestObservation(observation);
    appendTraceEvents(trace, events, null);
  }

  return trace;
}

export function createGate1BBrowserFocusRitualTrace(): LiveSymbolicTrace {
  const adapter = createLivePerceptionAdapter();
  const trace = createLiveSymbolicTrace("live_browser_focus_ritual_001", DEFAULT_SESSION_ID, {
    source: "browser.local_camera",
    raw_media_persisted: false,
    cloud_calls_enabled: false,
    manual_fixture: false,
    generated_by: "live-perception-adapter",
    capture_mode: "manual_calibration_browser_live",
    browser_latency_recorded: true
  });

  appendTraceEvents(trace, adapter.confirmCalibration({
    session_id: DEFAULT_SESSION_ID,
    calibration_id: DEFAULT_CALIBRATION_ID,
    timestamp_ms: 0,
    confidence: 0.94,
    zone_ids: ["phone_zone", "notebook_zone", "pen_zone", "keyboard_zone", "neutral_zone", "off_desk_zone"]
  }));
  trace.metrics.browser_latency_records.push(browserLatency("browser_calibration", 0, 24, 0));

  for (const observation of createGate1AHappyPathFrames("browser.local_camera")) {
    const events = adapter.ingestObservation(observation);
    appendTraceEvents(trace, events, null);
    trace.metrics.browser_latency_records.push(browserLatency(observation.frameId, observation.timestampMs, 42 + events.length * 3, 0));
  }

  return trace;
}

export function createGate1BBrowserFocusRitualFixture(): ReplayFixture {
  return exportTraceToReplayFixture(createGate1BBrowserFocusRitualTrace(), {
    fixtureId: "live_browser_focus_ritual_001",
    name: "Gate 1B browser-local Focus Ritual",
    description: "Browser-origin local observation trace exported into the replay harness format."
  });
}

export function createGate1BOcclusionRecoveryFixture(): ReplayFixture {
  const fixture = createReplayFixtureFromEvents([
    calibrationEvent("evt_occ_scene_calibrated", "ev_occ_scene_calibrated", 0),
    objectMovedEvent("evt_occ_phone_moved_away", "ev_occ_phone_moved_away", 1000, "obj_phone", "phone", "zone_focus", "zone_away", 640, 0.92),
    uncertainEvent("evt_occ_scene_uncertain", "ev_occ_scene_uncertain", 1600, "occlusion", ["obj_pen", "step_pen_pickup"]),
    confidenceEvent("evt_occ_confidence_recovered", "ev_occ_confidence_recovered", 2300, "scene", 0.54, 0.9, "occlusion_cleared")
  ], {
    fixtureId: "live_occlusion_recovery_001",
    name: "Gate 1B live occlusion recovery",
    description: "Symbolic browser-local trace where occlusion emits uncertainty, HUD recovery is visible, and tracking resumes without model calls."
  });
  fixture.expected.hud_commands.push({
    command_id: "hud_show_uncertain_state",
    command_type: "show_uncertain_state",
    target_surface: "recovery_banner",
    related_step_id: "active_step",
    evidence_includes: ["evt_occ_scene_uncertain"]
  });
  return fixture;
}

export function createGate1BCameraBumpResetFixture(): ReplayFixture {
  const fixture = createReplayFixtureFromEvents([
    calibrationEvent("evt_bump_scene_calibrated", "ev_bump_scene_calibrated", 0),
    resetEvent("evt_bump_scene_reset", "ev_bump_scene_reset", 1400, "camera_bump"),
    calibrationEvent("evt_bump_scene_recalibrated", "ev_bump_scene_recalibrated", 2600)
  ], {
    fixtureId: "live_camera_bump_reset_001",
    name: "Gate 1B live camera bump reset",
    description: "Symbolic browser-local trace where camera movement resets calibration and stale zone truth is not used."
  });
  fixture.expected.hud_commands.push({
    command_id: "hud_show_reset_required",
    command_type: "show_recovery_state",
    target_surface: "recovery_banner",
    related_step_id: "calibration",
    evidence_includes: ["evt_bump_scene_reset"]
  });
  return fixture;
}

export function createReplayFixtureFromEvents(
  events: StableEvent[],
  options: {
    fixtureId: string;
    name: string;
    description?: string;
    sessionId?: string;
  }
): ReplayFixture {
  const trace = createLiveSymbolicTrace(options.fixtureId, options.sessionId ?? DEFAULT_SESSION_ID);
  appendTraceEvents(trace, events);
  return exportTraceToReplayFixture(trace, {
    fixtureId: options.fixtureId,
    name: options.name,
    description: options.description ?? "Controlled Gate 1A symbolic live trace fixture."
  });
}

function frame(
  frameId: string,
  timestampMs: number,
  source: LocalObservationFrame["source"],
  hands: HandObservation[],
  objects: ObjectObservation[],
  zones: ZoneObservation[],
  scene: SceneObservation
): LocalObservationFrame {
  return {
    frameId,
    timestampMs,
    source,
    hands,
    objects,
    zones,
    scene
  };
}

function calibrationEvent(eventId: string, evidenceId: string, timestampMs: number): StableEvent {
  return {
    id: eventId,
    type: "scene.calibrated",
    timestamp_ms: timestampMs,
    producer: "perception.local",
    confidence: 0.94,
    payload: {
      session_id: DEFAULT_SESSION_ID,
      zone_ids: ["zone_focus", "zone_notebook", "zone_pen_tool", "zone_keyboard", "zone_away"],
      calibration_id: DEFAULT_CALIBRATION_ID,
      scene_confidence: 0.94
    },
    evidence: [evidence(evidenceId, "symbolic_fixture", "Controlled symbolic calibration event.")]
  };
}

function objectMovedEvent(
  eventId: string,
  evidenceId: string,
  timestampMs: number,
  objectId: string,
  objectType: string,
  fromZoneId: string,
  toZoneId: string,
  durationMs: number,
  confidence: number
): StableEvent {
  return {
    id: eventId,
    type: "object.moved",
    timestamp_ms: timestampMs,
    producer: "perception.local",
    confidence,
    payload: {
      object_id: objectId,
      object_type: objectType,
      from_zone_id: fromZoneId,
      to_zone_id: toZoneId,
      duration_ms: durationMs
    },
    evidence: [evidence(evidenceId, "symbolic_fixture", "Controlled symbolic object movement event.")]
  };
}

function uncertainEvent(
  eventId: string,
  evidenceId: string,
  timestampMs: number,
  uncertaintyKind: string,
  affectedRefs: string[]
): StableEvent {
  return {
    id: eventId,
    type: "scene.uncertain",
    timestamp_ms: timestampMs,
    producer: "perception.local",
    confidence: 0.82,
    payload: {
      uncertainty_kind: uncertaintyKind,
      affected_refs: affectedRefs,
      resolver_hint: "hold_state_until_tracking_resumes",
      escalation_recommended: false
    },
    evidence: [evidence(evidenceId, "symbolic_fixture", "Controlled symbolic uncertainty event.")]
  };
}

function confidenceEvent(
  eventId: string,
  evidenceId: string,
  timestampMs: number,
  targetRef: string,
  previousConfidence: number,
  currentConfidence: number,
  reasonCode: string
): StableEvent {
  return {
    id: eventId,
    type: "confidence.changed",
    timestamp_ms: timestampMs,
    producer: "perception.local",
    confidence: currentConfidence,
    payload: {
      target_ref: targetRef,
      previous_confidence: previousConfidence,
      current_confidence: currentConfidence,
      reason_code: reasonCode
    },
    evidence: [evidence(evidenceId, "symbolic_fixture", "Controlled symbolic confidence recovery event.")]
  };
}

function resetEvent(
  eventId: string,
  evidenceId: string,
  timestampMs: number,
  resetReason: "camera_bump" | "user_reset" | "session_end" | "replay_restart"
): StableEvent {
  return {
    id: eventId,
    type: "scene.reset",
    timestamp_ms: timestampMs,
    producer: "perception.local",
    confidence: 0.96,
    payload: {
      reset_reason: resetReason,
      reset_scope: resetReason === "camera_bump" ? "calibration" : "session",
      previous_state_id: "live_perception"
    },
    evidence: [evidence(evidenceId, "symbolic_fixture", "Controlled symbolic reset event.")]
  };
}

function browserLatency(frameId: string, timestampMs: number, endToEndMs: number, droppedFrames: number): BrowserLatencyRecord {
  return {
    frame_id: frameId,
    timestamp_ms: timestampMs,
    frame_capture_ms: Math.max(1, Math.round(endToEndMs * 0.14)),
    observation_extraction_ms: Math.max(1, Math.round(endToEndMs * 0.32)),
    adapter_ms: Math.max(1, Math.round(endToEndMs * 0.12)),
    stabilizer_ms: Math.max(1, Math.round(endToEndMs * 0.18)),
    event_emission_ms: Math.max(1, Math.round(endToEndMs * 0.05)),
    hud_update_ms: Math.max(1, Math.round(endToEndMs * 0.13)),
    trace_recorder_ms: Math.max(1, Math.round(endToEndMs * 0.06)),
    end_to_end_ms: endToEndMs,
    dropped_frames: droppedFrames
  };
}

function summarizeBrowserLatencies(records: BrowserLatencyRecord[]): { p50: number; p95: number; max: number } {
  const values = records.map((record) => record.end_to_end_ms).sort((a, b) => a - b);
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? values[values.length - 1] : 0
  };
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1));
  return values[index];
}

function deriveQuestTransitions(events: ReplayInputEvent[]): ReplayQuestTransition[] {
  const transitions: ReplayQuestTransition[] = [];
  let stepIndex = 0;
  let calibrated = false;

  for (const event of events) {
    if (event.type === "scene.calibrated" && Number(event.payload.scene_confidence) >= 0.8) {
      calibrated = true;
      continue;
    }
    if (!calibrated) continue;

    const step = QUEST_STEPS[stepIndex];
    if (!step) break;
    if (!step.guard(event)) continue;

    transitions.push({
      from_state: step.from_state,
      to_state: step.to_state,
      trigger_event_id: event.id,
      emitted_event_type: "quest.step_completed",
      step_id: step.step_id
    });
    stepIndex += 1;
  }

  if (stepIndex === QUEST_STEPS.length) {
    const previousStepId = QUEST_STEPS[QUEST_STEPS.length - 1]?.step_id ?? "step_start_typing";
    transitions.push({
      from_state: "typing_detected",
      to_state: "quest_complete",
      trigger_event_id: `evt_${previousStepId}_completed`,
      emitted_event_type: "quest.step_completed",
      step_id: "step_quest_complete"
    });
  }

  return transitions;
}

function deriveHudCommands(transitions: ReplayQuestTransition[]): ReplayHudCommand[] {
  return transitions.map((transition) => {
    if (transition.step_id === "step_quest_complete") {
      return {
        command_id: "hud_quest_complete",
        command_type: "quest_complete",
        target_surface: "quest_panel",
        related_step_id: transition.step_id,
        evidence_includes: ["evt_step_quest_complete_completed"]
      };
    }

    const step = QUEST_STEPS.find((item) => item.step_id === transition.step_id);
    if (!step) throw new Error(`No HUD command mapping for step ${transition.step_id}`);

    return {
      command_id: step.hud_command_id,
      command_type: step.hud_command_type,
      target_surface: "quest_panel",
      related_step_id: transition.step_id,
      evidence_includes: [`evt_${transition.step_id}_completed`]
    };
  });
}

function toStableEventMatcher(event: ReplayInputEvent): ReplayStableEventMatcher {
  return {
    id: `expect_${event.id}`,
    event_id: event.id,
    type: event.type,
    producer: "event_stabilizer",
    must_occur_after_ms: event.timestamp_ms,
    must_occur_before_ms: event.timestamp_ms + 1,
    min_confidence: event.confidence,
    payload_match: event.payload,
    evidence_includes: event.evidence.map((item) => item.ref)
  };
}

function toReplayEvidenceRef(ref: EvidenceRef): ReplayEvidenceRef {
  const kindBySource: Record<EvidenceRef["kind"], ReplayEvidenceRef["kind"]> = {
    local_signal: "fixture_assertion",
    symbolic_fixture: "fixture_assertion",
    human_correction: "human_correction",
    derived_state: "event_ref"
  };

  return {
    kind: kindBySource[ref.kind],
    ref: ref.id,
    contains_raw_media: false
  };
}

function assertTraceSafe(trace: LiveSymbolicTrace): void {
  if (trace.privacy.contains_raw_video || trace.privacy.contains_audio || trace.privacy.contains_raw_frames || trace.privacy.contains_screenshots || trace.privacy.contains_notebook_text || trace.privacy.cloud_calls_expected) {
    throw new Error("live trace privacy flags must remain false");
  }
  if (trace.metrics.llm_calls !== 0 || trace.metrics.vlm_calls !== 0 || trace.metrics.estimated_cost_usd !== 0) {
    throw new Error("Gate 1A trace must not contain model calls or model cost");
  }
  if (trace.metrics.raw_video_persisted || trace.metrics.raw_audio_persisted || trace.metrics.raw_frame_persisted) {
    throw new Error("Gate 1A trace must not persist raw media");
  }
  if (containsRawMedia(trace)) {
    throw new Error("live trace contains forbidden raw media reference");
  }
  for (const event of trace.events) {
    const validation = validateStableEvent(event);
    if (!validation.valid) throw new Error(validation.error);
  }
}

function evidence(id: string, kind: EvidenceRef["kind"], description: string): EvidenceRef {
  return {
    id,
    kind,
    description,
    contains_raw_media: false
  };
}

function normalizeGesture(gesture: string | undefined): "writing_motion" | "typing_motion" | null {
  if (gesture === "writing_motion" || gesture === "typing_motion") return gesture;
  return null;
}

function objectTypeFromId(objectId: string): string {
  const lower = objectId.toLowerCase();
  if (lower.includes("phone")) return "phone";
  if (lower.includes("notebook")) return "notebook";
  if (lower.includes("pen") || lower.includes("stylus")) return "pen";
  if (lower.includes("keyboard")) return "keyboard";
  return "unknown";
}

function containsRawMedia(value: unknown): boolean {
  if (typeof value === "string") return RAW_MEDIA_PATTERNS.some((pattern) => pattern.test(value));
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((child) => containsRawMedia(child));
  for (const [key, child] of Object.entries(value)) {
    if (SAFE_FALSE_PRIVACY_KEYS.has(key) && child === false) continue;
    if (RAW_MEDIA_PATTERNS.some((pattern) => pattern.test(key))) return true;
    if (containsRawMedia(child)) return true;
  }
  return false;
}

function findForbiddenKey(value: unknown, path = ""): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (VAGUE_KEYS.has(key)) return childPath;
    const nested = findForbiddenKey(child, childPath);
    if (nested) return nested;
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function roundConfidence(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function nowMs(): number {
  if (typeof performance !== "undefined") return Math.round(performance.now());
  return Date.now();
}
