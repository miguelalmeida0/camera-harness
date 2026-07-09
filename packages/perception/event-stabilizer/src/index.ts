export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

export type EvidenceRef = {
  kind: "frame" | "observation" | "zone" | "metric" | "replay";
  id: string;
  timestampMs: number;
  rect?: Rect;
  score?: number;
  note?: string;
};

export type HandGestureObservation = {
  type: string;
  confidence: number;
};

export type HandObservation = {
  id: string;
  confidence: number;
  landmarks: Point[];
  handedness?: "left" | "right" | "unknown";
  bbox?: Rect;
  gesture?: HandGestureObservation;
  zoneId?: string;
};

export type ObjectObservation = {
  id: string;
  label?: string;
  confidence: number;
  bbox: Rect;
  centroid?: Point;
  zoneId?: string;
  motionScore?: number;
  occluded?: boolean;
};

export type ZoneObservation = {
  zoneId: string;
  kind: string;
  occupancy: "empty" | "occupied" | "uncertain";
  confidence: number;
  occupants: string[];
  evidenceId?: string;
  triggerEventId?: string;
};

export type SceneObservation = {
  confidence: number;
  uncertainty: number;
  occlusionScore?: number;
  cameraBumpScore?: number;
  resetScore?: number;
  fingerprintDistance?: number;
  frameId?: string;
};

export type PerceptionFrame = {
  timestampMs: number;
  hands: HandObservation[];
  objects: ObjectObservation[];
  zones: ZoneObservation[];
  scene: SceneObservation;
};

export type StableEvent = {
  type: string;
  id: string;
  timestampMs: number;
  confidence: number;
  evidence: EvidenceRef[];
  payload: Record<string, unknown>;
};

export interface EventStabilizer {
  ingest(frame: PerceptionFrame): StableEvent[];
  reset(reason: string): StableEvent[];
}

export type EventStabilizerOptions = {
  handSmoothingAlpha: number;
  gestureMinFrames: number;
  gestureCooldownMs: number;
  objectMinFrames: number;
  dwellThresholdMs: number;
  stationarySpeedThresholdPerSec: number;
  movedDistanceThreshold: number;
  placedCooldownMs: number;
  occupancyMinFrames: number;
  uncertaintySpikeThreshold: number;
  uncertaintySpikeDelta: number;
  occlusionThreshold: number;
  cameraBumpThreshold: number;
  resetThreshold: number;
  resetMinFrames: number;
};

type PartialOptions = Partial<EventStabilizerOptions>;

type SmoothedHand = {
  id: string;
  landmarks: Point[];
  confidence: number;
  firstSeenMs: number;
  lastSeenMs: number;
};

type GestureState = {
  gestureType: string;
  streak: number;
  confidenceSum: number;
  lastEmittedAtMs: number;
};

type HandZoneState = {
  candidateZoneId: string | undefined;
  candidateStreak: number;
  stableZoneId: string | undefined;
  zoneEnteredAtMs: number;
  lastPoint: Point;
};

type ObjectTrack = {
  id: string;
  label: string | undefined;
  firstSeenMs: number;
  lastSeenMs: number;
  lastCentroid: Point;
  previousStableCentroid: Point;
  zoneId: string | undefined;
  stableZoneId: string | undefined;
  zoneEnteredAtMs: number;
  movingSinceMs: number | undefined;
  wasMoving: boolean;
  emittedDwellZones: Set<string>;
  lastPlacedAtMs: number;
  lastMovedAtMs: number;
  confidence: number;
  observations: number;
};

type ZoneState = {
  occupancy: ZoneObservation["occupancy"];
  streak: number;
  lastEmittedOccupancy: ZoneObservation["occupancy"] | undefined;
};

const DEFAULT_OPTIONS: EventStabilizerOptions = {
  handSmoothingAlpha: 0.45,
  gestureMinFrames: 3,
  gestureCooldownMs: 650,
  objectMinFrames: 2,
  dwellThresholdMs: 1800,
  stationarySpeedThresholdPerSec: 0.035,
  movedDistanceThreshold: 0.06,
  placedCooldownMs: 700,
  occupancyMinFrames: 2,
  uncertaintySpikeThreshold: 0.68,
  uncertaintySpikeDelta: 0.22,
  occlusionThreshold: 0.7,
  cameraBumpThreshold: 0.72,
  resetThreshold: 0.82,
  resetMinFrames: 3
};

export function createEventStabilizer(options: PartialOptions = {}): EventStabilizer {
  return new DefaultEventStabilizer({ ...DEFAULT_OPTIONS, ...options });
}

class DefaultEventStabilizer implements EventStabilizer {
  private readonly options: EventStabilizerOptions;
  private readonly hands = new Map<string, SmoothedHand>();
  private readonly gestures = new Map<string, GestureState>();
  private readonly handZones = new Map<string, HandZoneState>();
  private readonly objects = new Map<string, ObjectTrack>();
  private readonly zones = new Map<string, ZoneState>();
  private lastUncertainty?: number;
  private resetStreak = 0;
  private lastResetAtMs = 0;

  constructor(options: EventStabilizerOptions) {
    this.options = options;
  }

  ingest(frame: PerceptionFrame): StableEvent[] {
    const events: StableEvent[] = [];

    this.smoothHands(frame);
    events.push(...this.detectHandZoneEvents(frame));
    events.push(...this.detectGestures(frame));
    events.push(...this.detectObjectEvents(frame));
    events.push(...this.detectZoneEvents(frame));
    events.push(...this.detectSceneEvents(frame));

    return events;
  }

  reset(reason: string): StableEvent[] {
    const timestampMs = Date.now();
    this.hands.clear();
    this.gestures.clear();
    this.handZones.clear();
    this.objects.clear();
    this.zones.clear();
    this.lastUncertainty = undefined;
    this.resetStreak = 0;
    this.lastResetAtMs = timestampMs;

    return [
      {
        type: "scene.reset",
        id: eventId("scene.reset", reason, timestampMs),
        timestampMs,
        confidence: 1,
        evidence: [
          {
            kind: "metric",
            id: `reset-${timestampMs}`,
            timestampMs,
            note: reason
          }
        ],
        payload: {
          reset_reason: reason,
          reset_scope: "stabilizer_state",
          previous_state_id: "unknown"
        }
      }
    ];
  }

  private smoothHands(frame: PerceptionFrame): void {
    for (const hand of frame.hands) {
      const current = this.hands.get(hand.id);

      if (!current) {
        this.hands.set(hand.id, {
          id: hand.id,
          landmarks: hand.landmarks.map((point) => ({ ...point })),
          confidence: hand.confidence,
          firstSeenMs: frame.timestampMs,
          lastSeenMs: frame.timestampMs
        });
        continue;
      }

      current.landmarks = smoothPointList(
        current.landmarks,
        hand.landmarks,
        this.options.handSmoothingAlpha
      );
      current.confidence = ema(current.confidence, hand.confidence, this.options.handSmoothingAlpha);
      current.lastSeenMs = frame.timestampMs;
    }
  }

  private detectGestures(frame: PerceptionFrame): StableEvent[] {
    const events: StableEvent[] = [];

    for (const hand of frame.hands) {
      if (!hand.gesture || hand.gesture.confidence <= 0) continue;

      const stateKey = hand.id;
      const existing = this.gestures.get(stateKey);
      const sameGesture = existing?.gestureType === hand.gesture.type;
      const nextState: GestureState = sameGesture && existing
        ? {
            gestureType: existing.gestureType,
            streak: existing.streak + 1,
            confidenceSum: existing.confidenceSum + hand.gesture.confidence,
            lastEmittedAtMs: existing.lastEmittedAtMs
          }
        : {
            gestureType: hand.gesture.type,
            streak: 1,
            confidenceSum: hand.gesture.confidence,
            lastEmittedAtMs: existing?.lastEmittedAtMs ?? Number.NEGATIVE_INFINITY
          };

      this.gestures.set(stateKey, nextState);

      const cooldownElapsed =
        frame.timestampMs - nextState.lastEmittedAtMs >= this.options.gestureCooldownMs;

      if (nextState.streak >= this.options.gestureMinFrames && cooldownElapsed) {
        const confidence = clamp01(
          (nextState.confidenceSum / nextState.streak) *
            Math.min(1, nextState.streak / this.options.gestureMinFrames)
        );

        events.push({
          type: "gesture.detected",
          id: eventId("gesture.detected", `${hand.id}-${hand.gesture.type}`, frame.timestampMs),
          timestampMs: frame.timestampMs,
          confidence,
          evidence: [
            frameEvidence(frame),
            observationEvidence("hand", hand.id, frame.timestampMs, hand.bbox, hand.gesture.confidence)
          ],
          payload: {
            gesture_id: `gst_${hand.id}_${Math.round(frame.timestampMs)}`,
            gesture_type: hand.gesture.type,
            actor_ref: hand.id,
            zone_id: hand.zoneId ?? "zone_uncertain",
            evidence_window_ms: nextState.streak * inferredFrameIntervalMs(frame),
            gesture_repetition_count: nextState.streak
          }
        });

        nextState.lastEmittedAtMs = frame.timestampMs;
      }
    }

    for (const handId of Array.from(this.gestures.keys())) {
      if (!frame.hands.some((hand) => hand.id === handId && hand.gesture)) {
        this.gestures.delete(handId);
      }
    }

    return events;
  }

  private detectHandZoneEvents(frame: PerceptionFrame): StableEvent[] {
    const events: StableEvent[] = [];

    for (const hand of frame.hands) {
      if (!hand.zoneId) continue;

      const point = handPoint(hand);
      const existing = this.handZones.get(hand.id);
      const sameCandidate = existing?.candidateZoneId === hand.zoneId;
      const state: HandZoneState = existing
        ? {
            candidateZoneId: hand.zoneId,
            candidateStreak: sameCandidate ? existing.candidateStreak + 1 : 1,
            stableZoneId: existing.stableZoneId,
            zoneEnteredAtMs: existing.zoneEnteredAtMs,
            lastPoint: point
          }
        : {
            candidateZoneId: hand.zoneId,
            candidateStreak: 1,
            stableZoneId: undefined,
            zoneEnteredAtMs: frame.timestampMs,
            lastPoint: point
          };

      this.handZones.set(hand.id, state);

      if (
        state.candidateStreak >= this.options.occupancyMinFrames &&
        state.stableZoneId !== hand.zoneId
      ) {
        if (state.stableZoneId) {
          events.push({
            type: "hand.left_zone",
            id: eventId("hand.left_zone", `${hand.id}-${state.stableZoneId}`, frame.timestampMs),
            timestampMs: frame.timestampMs,
            confidence: hand.confidence,
            evidence: [
              frameEvidence(frame),
              observationEvidence("hand", hand.id, frame.timestampMs, hand.bbox, hand.confidence)
            ],
            payload: {
              hand_id: hand.id,
              zone_id: state.stableZoneId,
              zone_label: state.stableZoneId,
              exit_point: point,
              tracking_id: hand.id,
              dwell_ms: Math.max(0, frame.timestampMs - state.zoneEnteredAtMs),
              handedness: hand.handedness ?? "unknown"
            }
          });
        }

        events.push({
          type: "hand.entered_zone",
          id: eventId("hand.entered_zone", `${hand.id}-${hand.zoneId}`, frame.timestampMs),
          timestampMs: frame.timestampMs,
          confidence: hand.confidence,
          evidence: [
            frameEvidence(frame),
            observationEvidence("hand", hand.id, frame.timestampMs, hand.bbox, hand.confidence)
          ],
          payload: {
            hand_id: hand.id,
            zone_id: hand.zoneId,
            zone_label: hand.zoneId,
            entry_point: point,
            tracking_id: hand.id,
            handedness: hand.handedness ?? "unknown"
          }
        });

        state.stableZoneId = hand.zoneId;
        state.zoneEnteredAtMs = frame.timestampMs;
      }
    }

    for (const handId of Array.from(this.handZones.keys())) {
      if (!frame.hands.some((hand) => hand.id === handId)) {
        this.handZones.delete(handId);
      }
    }

    return events;
  }

  private detectObjectEvents(frame: PerceptionFrame): StableEvent[] {
    const events: StableEvent[] = [];

    for (const object of frame.objects) {
      const centroid = object.centroid ?? rectCenter(object.bbox);
      const track = this.objects.get(object.id);

      if (!track) {
        this.objects.set(object.id, {
          id: object.id,
          label: object.label,
          firstSeenMs: frame.timestampMs,
          lastSeenMs: frame.timestampMs,
          lastCentroid: centroid,
          previousStableCentroid: centroid,
          zoneId: object.zoneId,
          stableZoneId: object.zoneId,
          zoneEnteredAtMs: frame.timestampMs,
          movingSinceMs: undefined,
          wasMoving: false,
          emittedDwellZones: new Set<string>(),
          lastPlacedAtMs: Number.NEGATIVE_INFINITY,
          lastMovedAtMs: Number.NEGATIVE_INFINITY,
          confidence: object.confidence,
          observations: 1
        });
        continue;
      }

      const elapsedSec = Math.max(0.001, (frame.timestampMs - track.lastSeenMs) / 1000);
      const distance = pointDistance(track.lastCentroid, centroid);
      const speed = distance / elapsedSec;
      const moving = (object.motionScore ?? speed) > this.options.stationarySpeedThresholdPerSec;
      const zoneChanged = object.zoneId !== undefined && object.zoneId !== track.zoneId;

      track.observations += 1;
      track.confidence = ema(track.confidence, object.confidence, 0.35);
      track.lastSeenMs = frame.timestampMs;
      track.lastCentroid = centroid;

      if (zoneChanged) {
        track.zoneId = object.zoneId;
        track.zoneEnteredAtMs = frame.timestampMs;
        track.emittedDwellZones.delete(object.zoneId);
      }

      if (moving) {
        track.wasMoving = true;
        track.movingSinceMs ??= frame.timestampMs;
      }

      if (
        track.observations >= this.options.objectMinFrames &&
        (distance >= this.options.movedDistanceThreshold || zoneChanged) &&
        frame.timestampMs - track.lastMovedAtMs >= this.options.placedCooldownMs
      ) {
        const confidence = clamp01(track.confidence * motionConfidence(distance, object.motionScore));
        events.push({
          type: "object.moved",
          id: eventId("object.moved", object.id, frame.timestampMs),
          timestampMs: frame.timestampMs,
          confidence,
          evidence: [
            frameEvidence(frame),
            observationEvidence("object", object.id, frame.timestampMs, object.bbox, object.confidence)
          ],
          payload: {
            object_id: object.id,
            object_type: object.label ?? "unknown",
            from_zone_id: track.stableZoneId ?? "zone_unknown",
            to_zone_id: object.zoneId ?? "zone_unknown",
            motion_vector: {
              dx: centroid.x - track.previousStableCentroid.x,
              dy: centroid.y - track.previousStableCentroid.y
            },
            displacement_norm: distance,
            duration_ms: Math.max(0, frame.timestampMs - (track.movingSinceMs ?? track.lastSeenMs)),
            end_bbox: object.bbox
          }
        });
        track.lastMovedAtMs = frame.timestampMs;
      }

      if (
        !moving &&
        track.wasMoving &&
        object.zoneId &&
        frame.timestampMs - track.lastPlacedAtMs >= this.options.placedCooldownMs
      ) {
        const confidence = clamp01(track.confidence * stationaryConfidence(speed));
        events.push({
          type: "object.placed",
          id: eventId("object.placed", object.id, frame.timestampMs),
          timestampMs: frame.timestampMs,
          confidence,
          evidence: [
            frameEvidence(frame),
            observationEvidence("object", object.id, frame.timestampMs, object.bbox, object.confidence)
          ],
          payload: {
            object_id: object.id,
            object_type: object.label ?? "unknown",
            zone_id: object.zoneId,
            rest_bbox: object.bbox,
            dwell_ms: 0
          }
        });

        track.wasMoving = false;
        track.movingSinceMs = undefined;
        track.lastPlacedAtMs = frame.timestampMs;
        track.previousStableCentroid = centroid;
        track.stableZoneId = object.zoneId;
      }

      const dwellZoneId = object.zoneId;
      if (
        dwellZoneId &&
        !moving &&
        !object.occluded &&
        frame.timestampMs - track.zoneEnteredAtMs >= this.options.dwellThresholdMs &&
        !track.emittedDwellZones.has(dwellZoneId)
      ) {
        const durationMs = frame.timestampMs - track.zoneEnteredAtMs;
        const confidence = clamp01(
          track.confidence *
            stationaryConfidence(speed) *
            Math.min(1, durationMs / this.options.dwellThresholdMs)
        );

        events.push({
          type: "object.placed",
          id: eventId("object.placed", `${object.id}-${dwellZoneId}-dwell`, frame.timestampMs),
          timestampMs: frame.timestampMs,
          confidence,
          evidence: [
            frameEvidence(frame),
            observationEvidence("object", object.id, frame.timestampMs, object.bbox, object.confidence),
            zoneEvidence(dwellZoneId, frame.timestampMs, confidence)
          ],
          payload: {
            object_id: object.id,
            object_type: object.label ?? "unknown",
            zone_id: dwellZoneId,
            rest_bbox: object.bbox,
            dwell_ms: durationMs
          }
        });

        track.emittedDwellZones.add(dwellZoneId);
      }
    }

    this.pruneMissingObjects(frame);
    return events;
  }

  private detectZoneEvents(frame: PerceptionFrame): StableEvent[] {
    const events: StableEvent[] = [];

    for (const zone of frame.zones) {
      const existing = this.zones.get(zone.zoneId);
      const sameOccupancy = existing?.occupancy === zone.occupancy;
      const state: ZoneState = sameOccupancy && existing
        ? {
            occupancy: zone.occupancy,
            streak: existing.streak + 1,
            lastEmittedOccupancy: existing.lastEmittedOccupancy
          }
        : {
            occupancy: zone.occupancy,
            streak: 1,
            lastEmittedOccupancy: existing?.lastEmittedOccupancy
          };

      this.zones.set(zone.zoneId, state);

      if (
        state.streak >= this.options.occupancyMinFrames &&
        state.lastEmittedOccupancy !== zone.occupancy
      ) {
        if (zone.occupancy === "occupied") {
          events.push({
            type: "zone.activated",
            id: eventId("zone.activated", zone.zoneId, frame.timestampMs),
            timestampMs: frame.timestampMs,
            confidence: zone.confidence,
            evidence: [
              frameEvidence(frame),
              {
                kind: "zone",
                id: zone.evidenceId ?? zone.zoneId,
                timestampMs: frame.timestampMs,
                score: zone.confidence
              }
            ],
            payload: {
              zone_id: zone.zoneId,
              activation_reason: "zone_occupied",
              trigger_event_id: zone.triggerEventId ?? zone.evidenceId ?? eventId("zone.activated", zone.zoneId, frame.timestampMs)
            }
          });
        }

        state.lastEmittedOccupancy = zone.occupancy;
      }
    }

    return events;
  }

  private detectSceneEvents(frame: PerceptionFrame): StableEvent[] {
    const events: StableEvent[] = [];
    const uncertainty = clamp01(frame.scene.uncertainty);
    const previousUncertainty = this.lastUncertainty ?? uncertainty;
    const uncertaintyDelta = uncertainty - previousUncertainty;

    if (
      uncertainty >= this.options.uncertaintySpikeThreshold &&
      uncertaintyDelta >= this.options.uncertaintySpikeDelta
    ) {
      events.push({
        type: "confidence.changed",
        id: eventId("confidence.changed", "scene", frame.timestampMs),
        timestampMs: frame.timestampMs,
        confidence: uncertainty,
        evidence: [
          frameEvidence(frame),
          metricEvidence("uncertainty", frame.timestampMs, uncertainty, `delta=${uncertaintyDelta.toFixed(3)}`)
        ],
        payload: {
          target_ref: "scene",
          previous_confidence: clamp01(1 - previousUncertainty),
          current_confidence: clamp01(1 - uncertainty),
          reason_code: "uncertainty_spike"
        }
      });
    }

    this.lastUncertainty = uncertainty;

    if ((frame.scene.occlusionScore ?? 0) >= this.options.occlusionThreshold) {
      events.push({
        type: "scene.uncertain",
        id: eventId("scene.uncertain", "occlusion", frame.timestampMs),
        timestampMs: frame.timestampMs,
        confidence: clamp01(frame.scene.occlusionScore ?? 0),
        evidence: [
          frameEvidence(frame),
          metricEvidence("occlusion", frame.timestampMs, frame.scene.occlusionScore ?? 0)
        ],
        payload: {
          uncertainty_kind: "occlusion",
          affected_refs: ["scene"],
          resolver_hint: "wait_for_clear_view",
          escalation_recommended: false
        }
      });
    }

    if ((frame.scene.cameraBumpScore ?? 0) >= this.options.cameraBumpThreshold) {
      events.push({
        type: "scene.uncertain",
        id: eventId("scene.uncertain", "camera_bump", frame.timestampMs),
        timestampMs: frame.timestampMs,
        confidence: clamp01(frame.scene.cameraBumpScore ?? 0),
        evidence: [
          frameEvidence(frame),
          metricEvidence("camera-bump", frame.timestampMs, frame.scene.cameraBumpScore ?? 0)
        ],
        payload: {
          uncertainty_kind: "camera_bump",
          affected_refs: ["scene", "calibration"],
          resolver_hint: "review_or_recalibrate_zones",
          escalation_recommended: false
        }
      });
    }

    const resetSignal = Math.max(frame.scene.resetScore ?? 0, frame.scene.cameraBumpScore ?? 0);
    this.resetStreak = resetSignal >= this.options.resetThreshold ? this.resetStreak + 1 : 0;

    if (this.resetStreak >= this.options.resetMinFrames && frame.timestampMs > this.lastResetAtMs) {
      events.push({
        type: "scene.uncertain",
        id: eventId("scene.uncertain", "reset_detected", frame.timestampMs),
        timestampMs: frame.timestampMs,
        confidence: clamp01(resetSignal),
        evidence: [
          frameEvidence(frame),
          metricEvidence("reset-signal", frame.timestampMs, resetSignal)
        ],
        payload: {
          uncertainty_kind: "scene_reset_detected",
          affected_refs: ["scene", "calibration"],
          resolver_hint: "request_recalibration_review",
          escalation_recommended: false
        }
      });

      this.lastResetAtMs = frame.timestampMs;
      this.clearTemporalStateAfterSceneReset();
    }

    return events;
  }

  private pruneMissingObjects(frame: PerceptionFrame): void {
    const staleAfterMs = Math.max(2000, this.options.dwellThresholdMs * 2);

    for (const [id, track] of this.objects) {
      if (frame.timestampMs - track.lastSeenMs > staleAfterMs) {
        this.objects.delete(id);
      }
    }
  }

  private clearTemporalStateAfterSceneReset(): void {
    this.hands.clear();
    this.gestures.clear();
    this.handZones.clear();
    this.objects.clear();
    this.zones.clear();
  }
}

function smoothPointList(previous: Point[], next: Point[], alpha: number): Point[] {
  const maxLength = Math.max(previous.length, next.length);
  const points: Point[] = [];

  for (let index = 0; index < maxLength; index += 1) {
    const previousPoint = previous[index];
    const nextPoint = next[index];

    if (previousPoint && nextPoint) {
      points.push({
        x: ema(previousPoint.x, nextPoint.x, alpha),
        y: ema(previousPoint.y, nextPoint.y, alpha)
      });
    } else if (nextPoint) {
      points.push({ ...nextPoint });
    } else if (previousPoint) {
      points.push({ ...previousPoint });
    }
  }

  return points;
}

function ema(previous: number, next: number, alpha: number): number {
  return previous * (1 - alpha) + next * alpha;
}

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rectCenter(rect: Rect): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

function handPoint(hand: HandObservation): Point {
  if (hand.bbox) return rectCenter(hand.bbox);
  return hand.landmarks[0] ?? { x: 0, y: 0 };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function motionConfidence(distance: number, motionScore?: number): number {
  const distanceScore = Math.min(1, distance / 0.12);
  return Math.max(distanceScore, clamp01(motionScore ?? 0));
}

function stationaryConfidence(speed: number): number {
  return clamp01(1 - speed / 0.08);
}

function inferredFrameIntervalMs(_frame: PerceptionFrame): number {
  return 83;
}

function eventId(type: string, subject: string, timestampMs: number): string {
  return `${type}:${subject}:${Math.round(timestampMs)}`;
}

function frameEvidence(frame: PerceptionFrame): EvidenceRef {
  return {
    kind: "frame",
    id: frame.scene.frameId ?? `frame-${Math.round(frame.timestampMs)}`,
    timestampMs: frame.timestampMs,
    score: frame.scene.confidence
  };
}

function observationEvidence(
  kind: "hand" | "object",
  id: string,
  timestampMs: number,
  rect?: Rect,
  score?: number
): EvidenceRef {
  const evidence: EvidenceRef = {
    kind: "observation",
    id: `${kind}-${id}-${Math.round(timestampMs)}`,
    timestampMs
  };

  if (rect) evidence.rect = rect;
  if (score !== undefined) evidence.score = score;

  return evidence;
}

function zoneEvidence(zoneId: string, timestampMs: number, score: number): EvidenceRef {
  return {
    kind: "zone",
    id: zoneId,
    timestampMs,
    score
  };
}

function metricEvidence(metricId: string, timestampMs: number, score: number, note?: string): EvidenceRef {
  const evidence: EvidenceRef = {
    kind: "metric",
    id: metricId,
    timestampMs,
    score
  };

  if (note) evidence.note = note;
  return evidence;
}
