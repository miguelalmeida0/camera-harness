# Instant Recipe Migration Policy

## Decision

Every existing recipe remains `confirmed_ai_movement` unless the user explicitly converts an eligible safe local recipe. Migration never grants instant consent implicitly.

## Canonical Schema

All normalized v1.1 recipes use:

```json
{
  "schema": "darkquest.movement_automation_recipe.v1-1"
}
```

The recipe store may read legacy v1 and transitional `schema_version` forms only at its migration boundary. Normalized output, storage, matcher input, runtime fixtures, and checks use the canonical `schema` field exclusively.

## Default Migration

Legacy recipes become:

- `execution_mode: confirmed_ai_movement`.
- Existing movement trigger and confirmation requirements preserved.
- Existing enabled state preserved only for confirmed execution.
- No `consent.run_instantly` grant.
- Existing `speak_phrase.config.phrase` normalized to canonical `action.config.text`.

Unknown, malformed, media-bearing, or secret-bearing recipes remain disabled and require repair; they never become instant.

## Explicit Instant Conversion

Only recipes using `speak_phrase`, `increment_counter`, `start_timer`, or `append_activity_log` are eligible. The UI asks exactly:

`This recipe currently runs after confirmation. Run it instantly when the local gesture is recognized?`

Acceptance creates a new revision with:

```json
{
  "schema": "darkquest.movement_automation_recipe.v1-1",
  "execution_mode": "instant_local_gesture",
  "trigger": {
    "source": "mediapipe_gesture",
    "gesture_key": "thumbs_up",
    "minimum_confidence": 0.85,
    "hold_ms": 350,
    "neutral_reset_required": true
  }
}
```

It also records versioned instant consent bound to trigger, action, and configuration. Rejecting or dismissing the prompt leaves the recipe unchanged.

## Forbidden Conversion

`local_snapshot_download`, `signed_webhook_post`, external actions, media capture, AI/provider calls, and recursive analysis cannot be converted. They remain confirmed and per-run gated according to risk policy.

Material edits to gesture key, threshold, hold, action type, or action configuration invalidate instant consent and require the prompt again. Import/export may carry recipe configuration but cannot activate the global Instant gestures preference.
