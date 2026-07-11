# Movement Automation Recipe v1.1

## Purpose

Extend `movement-automation-recipe.v1` with two explicit execution modes while preserving deterministic matching, text/config-only storage, and the existing confirmation boundary for AI movement results.

## Identity and Creation

- Stored recipes require an immutable `recipe_id` matching `^recipe_[a-zA-Z0-9_-]{1,80}$`.
- UI forms never expose `recipe_id` as an editable field or ask the user to provide one.
- A creation API may accept `AutomationRecipeDraft` without an ID only by passing it immediately to the canonical `createAutomationRecipe(draft)` factory.
- The factory assigns a collision-resistant ID before normalization, validation, or persistence and returns a complete stored recipe.
- Edit APIs require the existing ID and preserve it across validation failure, retry, and successful save.
- Migration generates and persists an ID for legacy records that lack one. Once generated, that ID is stable.
- Missing internal IDs are repaired by system code; `Automation recipe requires a valid id` is never primary user-facing copy.

## Instant Local Gesture Example

```json
{
  "schema": "movement-automation-recipe.v1-1",
  "recipe_id": "recipe_thumbs_up_speech",
  "name": "Thumbs up encouragement",
  "enabled": true,
  "execution_mode": "instant_local_gesture",
  "confirmation_policy": "none",
  "trigger": {
    "source": "mediapipe_gesture",
    "gesture_key": "thumbs_up",
    "minimum_confidence": 0.85,
    "hold_ms": 350,
    "neutral_reset_required": true
  },
  "action": {
    "type": "speak_phrase",
    "config": {
      "text": "Great job"
    }
  },
  "risk_tier": 0,
  "execution_policy": {
    "cooldown_ms": 2500,
    "max_runs_per_session": 20,
    "require_per_run_confirmation": false,
    "retry_limit": 0
  },
  "consent": {
    "run_instantly": true,
    "consent_version": 1,
    "consented_at": 0
  },
  "created_at": 0,
  "updated_at": 0
}
```

## Execution Modes

`schema` is the canonical discriminator at runtime and in storage. The exact value is `movement-automation-recipe.v1-1`. Transitional `schema_version` values may be read by the migration boundary for compatibility.

`execution_mode` is the only authority for execution timing. `confirmation_policy`, `trigger.require_user_confirmation`, and `execution_policy.require_per_run_confirmation` are derived normalized fields, never independent user choices.

### `confirmed_ai_movement`

- Uses the v1 movement trigger fields: `movement_key`, `aliases`, `required_tags`, `minimum_confidence`, and `require_user_confirmation: true`.
- Accepts only a confirmed, non-uncertain canonical movement result.
- Preserves existing risk-tier and per-run confirmation behavior.
- May use all registered v1.2 adapters subject to policy.
- Normalized `confirmation_policy` is `movement_confirmation` or `per_run` according to the confirmed-path policy.

### `instant_local_gesture`

- Requires `trigger.source: mediapipe_gesture`.
- `gesture_key` must be one of `thumbs_up`, `thumbs_down`, `peace_sign`, `open_palm`, `closed_fist`, `pointing_up`, or `i_love_you`.
- `minimum_confidence` is 0 through 1; the initial recommended default is 0.85.
- `hold_ms` is an integer from 250 through 1000; the initial default is 350.
- `neutral_reset_required` must be true in v1.2.1.
- `consent.run_instantly` must be true, with a consent version matching the current trigger and action configuration.
- `require_per_run_confirmation` may be false only for the instant action allowlist.
- Matching accepts only `stable-local-gesture-event.v1`, never provider text.

New editor-created instant recipes default to `minimum_confidence: 0.70`; an existing explicit threshold is preserved. Instant normalization always sets `confirmation_policy: none` and `execution_policy.require_per_run_confirmation: false`, even when migrated or contradictory input requests confirmation.
- Normalization always writes `confirmation_policy: none`, `trigger.require_user_confirmation: false`, and `execution_policy.require_per_run_confirmation: false`.

## Action Restrictions

Instant automatic execution permits only `speak_phrase`, `increment_counter`, `start_timer`, and `append_activity_log`.

`browser_notification`, `local_snapshot_download`, `signed_webhook_post`, any media capture, external effect, paid API, arbitrary command, or movement-analysis request is invalid with `instant_local_gesture`. Those actions must use `confirmed_ai_movement` and the existing confirmation policy.

## Normalization Invariant

The one canonical function is `normalizeAutomationRecipe(recipe)`. It is idempotent: normalizing an already normalized recipe produces the same policy-bearing value except for explicitly managed timestamps.

For an allowlisted `instant_local_gesture` recipe, normalization forces:

```json
{
  "execution_mode": "instant_local_gesture",
  "confirmation_policy": "none",
  "trigger": {
    "require_user_confirmation": false
  },
  "execution_policy": {
    "require_per_run_confirmation": false
  }
}
```

Contradictory input values are overwritten, not preserved and not shown. An instant recipe with a non-allowlisted action is rejected before persistence.

For `confirmed_ai_movement`, normalization preserves the confirmed path and derives confirmation settings from its confirmed policy. A recipe with no valid `execution_mode` defaults to `confirmed_ai_movement`; it never silently becomes instant.

## Repair on Read

Every stored recipe passes through `normalizeAutomationRecipe` on read, including records already labeled v1.1. The store compares the normalized document with the loaded document and persists the normalized document once when they differ.

Repair must:

- convert contradictory instant confirmation fields to `none` and `false`;
- preserve explicit instant consent only for an allowlisted action;
- keep legacy or ambiguous recipes confirmed;
- canonicalize `speak_phrase.config.phrase` to `config.text`;
- reject prohibited instant actions rather than downgrading their risk;
- require no manual localStorage editing.

Store create, update, import, preset creation, UI save, runtime matching, and tests all consume this normalized result. No compatibility validator may emit a second recipe shape.

Normalization and validation complete before storage mutation. Create and update commit one normalized record atomically. A failed create writes nothing; a failed edit leaves the existing stored recipe unchanged.

## Migration from v1

- Every v1 recipe migrates to `execution_mode: confirmed_ai_movement`.
- `movement-automation-recipe.v1`, `darkquest.movement_automation_recipe.v1`, and transitional v1.1 inputs normalize to `schema: movement-automation-recipe.v1-1`.
- Existing confirmation requirements remain true.
- Existing `speak_phrase.config.phrase` is normalized to canonical v1.1 `config.text`; readers may accept `phrase` during migration only.
- Existing recipe consent does not become instant consent.
- A user must explicitly select `Run instantly` to convert or create an instant recipe.
- Material changes to gesture, threshold, hold, action type, or action config invalidate instant consent.

## Editor Projection

When `execution_mode` is `instant_local_gesture`, the editor checks `Run instantly when recognized`, hides or disables the confirmation selector, and displays `Confirmation: Not required for this safe local action.` Saving persists only normalized instant values.

When the instant checkbox is unchecked, the editor sets `execution_mode: confirmed_ai_movement` and may expose confirmed-path settings. The UI must never render `Run instantly` and `Run after movement confirmation` for the same normalized recipe.

## Trigger Source Union

Instant recipes use a discriminated trigger. The engine dispatches by `trigger.source`; it must not require every trigger identity to appear in a hardcoded canned-gesture list.

```ts
type InstantAutomationTriggerV11 =
  | {
      source: "mediapipe_gesture";
      gesture_key: string;
      minimum_confidence: number;
      hold_ms: number;
      neutral_reset_required: true;
    }
  | {
      source: "custom_local_skill";
      custom_skill_id: string;
      skill_name: string;
    };
```

Custom skill example:

```json
{
  "source": "custom_local_skill",
  "custom_skill_id": "skill_...",
  "skill_name": "Heart shape"
}
```

`custom_skill_id` is immutable matching identity. `skill_name` is bounded display metadata and cannot authorize a match by itself. The referenced skill must exist, be enabled, be `active`, and emit a valid `stable-custom-skill-event.v1` with the same ID.

Custom local skill events reuse `execution_mode: instant_local_gesture`, instant consent, idempotency, neutral reset, cooldown, and the safe local action allowlist. Snapshot, webhook, media, external, paid, and recursive analysis actions retain existing confirmation/risk rules and cannot autoexecute from a custom event.

## Discriminated Action Configuration

`action.type` is the discriminator. Normalization accepts and emits only the configuration fields for that exact action:

```ts
type AutomationActionV11 =
  | { type: "speak_phrase"; config: { text: string } }
  | { type: "increment_counter"; config: { counter_name: string } }
  | { type: "start_timer"; config: { duration_seconds: number } }
  | { type: "append_activity_log"; config: { category: string } }
  | { type: "browser_notification"; config: { title: string; body: string } }
  | { type: "local_snapshot_download"; config: { filename_prefix: string } }
  | { type: "signed_webhook_post"; config: { destination_id: string; secret_ref?: string; payload_label?: string } };
```

Unknown or cross-action configuration fields are rejected or removed during normalization and are never rendered as editable controls. Changing `action.type` replaces the prior configuration with the selected action's defaults; stale hidden values cannot survive the save.

## Shared Restrictions

Recipes remain versioned text/config only. Raw frames, landmarks, screenshots, base64, audio, provider tokens, webhook secret values, arbitrary JavaScript, shell commands, arbitrary URLs, and arbitrary HTTP methods are forbidden.
