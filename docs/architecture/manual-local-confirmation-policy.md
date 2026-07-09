# Manual Local Confirmation Policy

Manual local confirmation is allowed only for Gate 1D tryability. It is a local operator input that emits replayable symbolic evidence when automatic perception is not ready.

It must be visible, typed, replayable, and disclosed.

## Allowed Use

Manual local confirmation may be used for:

- confirming desk zone calibration;
- confirming phone moved away;
- confirming notebook opened;
- confirming pen picked up;
- confirming writing motion;
- confirming typing motion;
- confirming uncertainty or camera reset.

## Required Behavior

Manual local confirmation must:

- be clearly labeled in the UI;
- emit valid symbolic events;
- use `evidence.kind` as `human_correction` or `local_signal`;
- set `contains_raw_media` to `false`;
- avoid LLM/VLM calls;
- avoid raw media persistence;
- be replayable through the existing harness;
- be disclosed in trace metadata when used;
- keep privacy and model status visible to the user.

## Required Disclosure

If manual confirmation was used, the trace metadata should disclose it with a symbolic field such as:

```json
{
  "trace_origin": {
    "manual_local_confirmation_used": true,
    "manual_local_confirmation_scope": [
      "zone_calibration",
      "focus_ritual_step_confirmation"
    ]
  }
}
```

This disclosure does not make the trace fake. It makes the trace honest.

## Forbidden Behavior

Manual local confirmation must not:

- fake physical provenance;
- bypass Gate 1C;
- claim autonomous visual recognition;
- create portfolio demo claims;
- hide from the user;
- write raw video, raw frames, screenshots, audio, OCR, notebook text, or base64 media;
- call an LLM or VLM;
- mark a synthetic browser trace as physical;
- silently complete the quest without supporting symbolic events.

## Evidence Rules

Manual confirmation events must carry symbolic evidence only:

```json
{
  "kind": "human_correction",
  "ref": "manual_confirm_phone_away",
  "contains_raw_media": false
}
```

or:

```json
{
  "kind": "local_signal",
  "ref": "local_button_confirm_phone_away",
  "contains_raw_media": false
}
```

## Gate Boundary

Manual local confirmation can make Gate 1D tryable.

Manual local confirmation cannot make autonomous vision claims. Gate 1C must still validate physical provenance, replay determinism, privacy, model calls, memory policy, HUD honesty, latency, and exact adversarial failures.

## Gate 1E Truth Boundary

Manual confirmation is acceptable for Gate 1E user testing because it proves:

- app flow;
- event schema;
- reducer;
- HUD/timeline;
- recording;
- trace export;
- validation.

Manual confirmation does not prove:

- autonomous vision;
- object detection accuracy;
- gesture recognition accuracy;
- portfolio demo readiness;
- production readiness.
