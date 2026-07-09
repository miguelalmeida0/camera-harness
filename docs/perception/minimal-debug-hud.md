# Minimal Debug HUD

## Purpose

The Gate 1A debug HUD is a plain operational panel for verifying live local perception and replay safety. It shows current symbolic state and privacy status only. It must not add cinematic effects, decorative success animations, or progress claims that are not backed by accepted v0 events.

## Required Fields

The HUD must display:

- current quest state
- active zone
- last 10 v0 events
- confidence
- uncertainty state
- raw media persistence status, always shown as `false`
- cloud fallback status, always shown as `disabled`
- replay recording status

## Data Contract

```ts
type MinimalDebugHudState = {
  quest_state: string;
  active_zone_id: string | null;
  confidence: {
    scene: number;
    active_zone?: number;
    active_event?: number;
  };
  uncertainty: {
    state: "clear" | "watch" | "uncertain" | "reset_required";
    reason_code?: string;
    affected_refs: string[];
  };
  last_events: Array<{
    id: string;
    type: string;
    timestamp_ms: number;
    producer: string;
    confidence: number;
  }>;
  privacy: {
    raw_video_persisted: false;
    raw_audio_persisted: false;
    raw_frame_persisted: false;
    notebook_text_persisted: false;
  };
  model_routing: {
    cloud_fallback_enabled: false;
    llm_calls: 0;
    vlm_calls: 0;
    estimated_cost_usd: 0;
  };
  replay_recording: {
    status: "off" | "recording" | "paused" | "exporting" | "exported" | "error";
    trace_id?: string;
    event_count: number;
    latest_export_path?: string;
  };
};
```

## Layout

Keep the HUD compact and readable:

1. Quest row: `quest_state`, active step if available, and active zone.
2. Confidence row: scene confidence, active zone confidence, active event confidence.
3. Uncertainty row: `clear`, `watch`, `uncertain`, or `reset_required` plus reason.
4. Event list: last 10 accepted v0 events, newest last or newest first as long as order is labeled.
5. Privacy row: `raw_video=false`, `raw_frame=false`, `raw_audio=false`, `notebook_text=false`.
6. Routing row: `cloud_fallback=disabled`, `llm_calls=0`, `vlm_calls=0`, `cost=0`.
7. Replay row: recording status, trace ID, event count, and export action.

The event list must show only v0 event metadata and symbolic payload summaries. It must not show image thumbnails, screenshots, raw frame IDs that resolve to media, notebook text, or audio references.

## Event List Rules

The last 10 list accepts only events that passed v0 validation:

- `scene.calibrated`
- `hand.entered_zone`
- `hand.left_zone`
- `object.moved`
- `object.placed`
- `gesture.detected`
- `zone.activated`
- `confidence.changed`
- `scene.uncertain`
- `scene.reset`
- downstream v0 events, if the HUD is reading the full system bus

If a candidate event fails validation, the HUD may show a non-state diagnostic count, but it must not place that candidate in the accepted event list.

## Uncertainty Behavior

When `scene.uncertain` is accepted:

- set uncertainty state to `uncertain`;
- show the `uncertainty_kind` or `reason_code`;
- keep active zone only if it remains supported by accepted evidence;
- do not mark quest progress;
- show replay recording as still symbolic if the recorder is active.

When a camera bump requires user action:

- set uncertainty state to `reset_required`;
- keep raw media persistence booleans at `false`;
- keep cloud fallback disabled;
- show the calibration reset or confirm action.

## Replay Controls

The HUD may expose exactly these Gate 1A recorder actions:

- start symbolic recording
- pause symbolic recording
- stop symbolic recording
- export latest fixture

The export action maps to:

```sh
darkquest-trace export --latest fixtures/replay/live/live_focus_ritual_001.v0.json
```

The HUD must report export success or failure using symbolic status only. It must not attach a screenshot or media preview to the export result.

## Privacy and Routing Invariants

- `raw_video_persisted` is always `false`.
- `raw_audio_persisted` is always `false`.
- `raw_frame_persisted` is always `false`.
- `notebook_text_persisted` is always `false`.
- `cloud_fallback_enabled` is always `false`.
- `llm_calls`, `vlm_calls`, and `estimated_cost_usd` are `0` for normal Gate 1A live perception.
- Any contradictory runtime signal is a blocking failure, not a UI state to smooth over.

## No Cinematic Effects

Allowed visual treatment:

- static rows
- simple text labels
- plain confidence numbers
- small status chips
- a compact list of accepted events

Disallowed visual treatment:

- cinematic overlays
- particle or glow effects
- celebratory animations
- progress completion without quest evidence
- generated images or thumbnails from camera frames
- decorative effects that hide uncertainty or validation failure

## Acceptance Checks

- HUD displays current quest state, active zone, last 10 events, confidence, uncertainty, privacy, routing, and recorder status.
- HUD event list contains only accepted v0 events.
- HUD shows uncertainty whenever an accepted `scene.uncertain` blocks state.
- HUD never shows raw media persisted as true.
- HUD never shows cloud fallback as enabled in Gate 1A.
- HUD export action uses the live trace recorder command and produces symbolic replay data only.
