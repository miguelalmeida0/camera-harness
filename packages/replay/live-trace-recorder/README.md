# @darkquest/live-trace-recorder

Gate 1A package spec for recording symbolic live traces and exporting replay-compatible fixtures.

The recorder subscribes to validated v0 events and downstream symbolic outputs. It must not store raw frames, screenshots, audio, notebook text, base64 images, raw media paths, or cloud-derived evidence.

## Recorded Inputs

The recorder may append:

- validated v0 perception events from `@darkquest/live-perception-adapter`
- validated quest transition events from the quest engine
- HUD command records or `hud.command_emitted` events
- memory write requests after memory gate policy
- model route records, which should be empty for Gate 1A
- latency and cost metrics
- privacy assertions

The recorder must reject:

- raw camera frames
- screenshots
- video files or paths
- audio files or paths
- base64 image data
- notebook OCR or private notebook text
- experimental observations inside replay `input_events`

## Live Trace Shape

The append-only live trace can be held as a symbolic session artifact:

```json
{
  "schema": "darkquest.live_symbolic_trace.v0",
  "trace_id": "trace_live_focus_ritual_001",
  "session_id": "ses_live_focus_001",
  "started_at_ms": 0,
  "ended_at_ms": 0,
  "privacy": {
    "contains_raw_video": false,
    "contains_audio": false,
    "contains_raw_frames": false,
    "contains_screenshots": false,
    "contains_notebook_text": false,
    "cloud_calls_expected": false
  },
  "events": [],
  "quest_transitions": [],
  "hud_commands": [],
  "memory_writes": [],
  "model_calls": [],
  "metrics": {
    "llm_calls": 0,
    "vlm_calls": 0,
    "estimated_cost_usd": 0,
    "raw_video_persisted": false,
    "raw_audio_persisted": false,
    "raw_frame_persisted": false
  }
}
```

`events` must contain only events valid under `docs/contracts/event-schema.v0.md`.

## Export Command

The required command/UI action is:

```sh
darkquest-trace export --latest fixtures/replay/live/live_focus_ritual_001.v0.json
```

Behavior:

1. Load the latest symbolic live trace.
2. Validate all trace events against `event-schema.v0.md`.
3. Verify all privacy booleans are false for raw video, raw audio, raw frames, screenshots, notebook text, and cloud calls.
4. Convert the trace to `darkquest.replay_fixture.v0`.
5. Write the fixture to the requested path.
6. Refuse export if any forbidden raw media, base64 image, notebook text, or cloud-derived evidence is detected.

The same behavior should be available from the minimal debug HUD as `export latest fixture`.

## Replay Fixture Export

The exported file must use the replay fixture schema:

```json
{
  "schema": "darkquest.replay_fixture.v0",
  "fixture_id": "live_focus_ritual_001",
  "name": "Live Focus Ritual 001",
  "description": "Symbolic live trace exported from Gate 1A local perception.",
  "created_by": "PARALLAX live-trace-recorder",
  "privacy": {
    "contains_raw_video": false,
    "contains_audio": false,
    "cloud_calls_expected": false
  },
  "input_events": [],
  "expected": {
    "stable_events": [],
    "quest_transitions": [],
    "hud_commands": [],
    "memory_writes": [],
    "model_calls": []
  },
  "forbidden": {
    "event_types": ["agent.escalation_requested"],
    "memory_writes": [
      {
        "memory_scope": "raw_frame_memory"
      },
      {
        "privacy_classification": "forbidden_raw_media"
      }
    ],
    "model_calls": [
      {
        "approved_tier": 4
      },
      {
        "input_class": "continuous_video"
      }
    ],
    "raw_video_persistence": true
  },
  "metrics": {
    "max_llm_calls": 0,
    "max_vlm_calls": 0,
    "max_cost_usd": 0,
    "max_replay_runtime_ms": 1000
  }
}
```

Population rules:

- `input_events` is the validated v0 event stream.
- `expected.stable_events` is generated from validated stable event IDs and payload subsets, or left empty only for a raw capture that is not being used as an acceptance fixture.
- `expected.quest_transitions` is generated from captured quest transition records when present.
- `expected.hud_commands` is generated from captured HUD command records when present.
- `expected.memory_writes` is empty for normal Gate 1A unless a fixture explicitly tests an allowed symbolic write.
- `expected.model_calls` is empty for normal Gate 1A.
- `forbidden.raw_video_persistence` is always `true`.

## Privacy Scanner

Before writing any export, scan all string values and keys for forbidden indicators:

- `base64`
- `data:image`
- `raw_frame`
- `raw_video`
- `raw_audio`
- `.png`
- `.jpg`
- `.jpeg`
- `.webp`
- `.mp4`
- `.mov`
- `.webm`
- `.wav`
- `.mp3`
- `ocr`
- `notebook_text`

Any match blocks export unless it is the name of an explicit false privacy assertion such as `raw_video_persisted: false`.

## CLI Results

Successful export should print symbolic metadata only:

```text
exported fixtures/replay/live/live_focus_ritual_001.v0.json
events=0 quest_transitions=0 hud_commands=0
raw_video_persisted=false raw_frame_persisted=false raw_audio_persisted=false cloud_calls=0
```

Failure should report a deterministic reason and the JSON path of the blocked value. It must not print raw media or private text.

## Acceptance Gate

- The command writes a valid `darkquest.replay_fixture.v0` object.
- All `input_events` validate against `docs/contracts/event-schema.v0.md`.
- The exported fixture sets `privacy.contains_raw_video=false`, `privacy.contains_audio=false`, and `privacy.cloud_calls_expected=false`.
- The exported fixture forbids raw video persistence.
- No raw frames, screenshots, audio, notebook text, base64 images, or cloud-derived evidence are present.
- The exported fixture can be passed to the Gate 0 replay harness after GAUNTLET supplies or accepts expected matchers.
