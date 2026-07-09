# Gate 1A Debug HUD

## Purpose

The Gate 1A HUD is an operational truth panel. It exists to expose symbolic perception state, uncertainty, replay recording, privacy posture, and model-call status. It is not a cinematic demo layer.

## Required Fields

The HUD must show:

- current quest state;
- active zone;
- last 10 accepted symbolic events;
- event confidence;
- uncertainty state;
- raw media persistence status: `false`;
- cloud fallback status: `disabled`;
- replay recording status.

## Required Exposure

The HUD must expose:

- accepted `scene.uncertain` events;
- accepted `scene.reset` events;
- lost tracking diagnostics;
- low-confidence diagnostics;
- replay recording `on` or `off`;
- cloud fallback `disabled`;
- raw media persistence `false`.

## State Shape

```ts
export type Gate1ADebugHudState = {
  quest_state: string;
  active_zone_id: string | null;
  last_events: Array<{
    id: string;
    type: string;
    timestamp_ms: number;
    confidence: number;
  }>;
  confidence: {
    scene: number;
    active_event: number | null;
  };
  uncertainty: {
    state: "clear" | "low_confidence" | "lost_tracking" | "uncertain" | "reset_required";
    reason?: string;
    affected_refs: string[];
  };
  privacy: {
    raw_video_persisted: false;
    raw_frame_persisted: false;
    raw_audio_persisted: false;
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

## Must Not

- Hide uncertainty.
- Display fake progress.
- Show cinematic completion without supporting quest state.
- Imply model or VLM use when disabled.
- Mask perception failure with visual effects.
- Display thumbnails, screenshots, camera frames, notebook text, or media previews.

## Allowed Presentation

Use plain rows, status labels, compact event lists, and numeric confidence. Completion can appear only after a replay-backed quest transition or `hud.command_emitted` equivalent exists.

