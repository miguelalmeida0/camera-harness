# Browser Frame Lifetime Policy

## Decision

Browser camera frames may exist only in browser memory during local processing. The durable DarkQuest artifact is symbolic state, not raw media.

## Allowed Frame Lifetime

Allowed:

- browser video/camera APIs hold frames during active permissioned capture;
- local extraction code reads a frame in memory to compute symbolic observations;
- temporary canvas/video buffers exist only for the current processing tick;
- a frame contributes to `LocalObservationFrame`;
- latency records count frame timing without storing frame content.

The frame must be discarded after local observation extraction. Replay, memory, and eval artifacts must never require the frame.

## Forbidden Persistence

Frames must not be:

- serialized into fixture JSON;
- logged;
- screenshotted;
- written to disk;
- stored in `localStorage`;
- stored in `sessionStorage`;
- stored in IndexedDB;
- stored in Cache Storage;
- sent to a backend;
- sent to an LLM or VLM;
- embedded as base64;
- converted into OCR or visible notebook text;
- attached to memory writes.

Backend frame transfer is forbidden unless a future ADR, schema-change note, positive fixture, adversarial fixture, and explicit privacy approval permit a narrow path.

## Evidence Rules

Evidence refs must be symbolic and replay-safe. Browser evidence should assert raw-media absence before export:

```json
{
  "id": "ev_browser_window_4100_4780",
  "kind": "observation_window",
  "description": "Symbolic object-zone observations from browser local extraction.",
  "contains_raw_media": false
}
```

When normalized into `event-schema.v0.md`, evidence may use:

```json
{
  "kind": "metric_log",
  "ref": "ev_browser_window_4100_4780"
}
```

The raw-media false assertion still belongs in the live trace or trace-origin metadata.

## Trace Export Rule

Trace exports must contain symbolic events only:

- v0 event envelope;
- v0 payload fields;
- symbolic evidence refs;
- trace origin metadata;
- latency records;
- privacy booleans;
- model/cost counters.

Trace exports must not contain raw pixels, screenshots, base64 media, video/audio paths, OCR, or private notebook text.

## Allowed Examples

Allowed symbolic event:

```json
{
  "id": "evt_browser_phone_moved_away",
  "type": "object.moved",
  "timestamp_ms": 1420,
  "producer": "perception.local",
  "confidence": 0.91,
  "payload": {
    "object_id": "obj_phone",
    "object_type": "phone",
    "from_zone_id": "zone_focus",
    "to_zone_id": "zone_away",
    "duration_ms": 620
  },
  "evidence": [
    {
      "kind": "metric_log",
      "ref": "ev_browser_phone_motion_0800_1420"
    }
  ]
}
```

Allowed latency record ref:

```json
{
  "kind": "metric_log",
  "ref": "lat_browser_trace_001.frame_capture_ms"
}
```

## Forbidden Examples

Forbidden raw frame in JSON:

```json
{
  "frame": "data:image/png;base64,..."
}
```

Forbidden screenshot path:

```json
{
  "evidence": [
    {
      "kind": "metric_log",
      "ref": "screenshots/frame_001.png"
    }
  ]
}
```

Forbidden storage:

```ts
localStorage.setItem("last_frame", canvas.toDataURL("image/png"));
```

Forbidden cloud route:

```ts
await vlm.describe(videoFrame);
```

Forbidden memory write:

```json
{
  "type": "memory.write_requested",
  "payload": {
    "memory_scope": "raw_frame_memory",
    "memory_value": "raw_frame://browser/frame_001"
  }
}
```

## Blocking Rule

Any raw frame persistence, frame upload, base64 fixture content, screenshot artifact, audio artifact, OCR/notebook text artifact, or cloud visual route blocks Gate 1B.
