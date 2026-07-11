# Movement Automation Recipe v1

This schema remains valid for confirmed AI movement recipes. New and migrated dual-mode recipes use `movement-automation-recipe.v1-1`.

## Schema

```json
{
  "schema_version": "movement-automation-recipe.v1",
  "recipe_id": "recipe_...",
  "name": "Peace sign snapshot",
  "enabled": true,
  "trigger": {
    "movement_key": "peace_sign",
    "aliases": ["victory sign", "v sign"],
    "required_tags": ["two_fingers_raised"],
    "minimum_confidence": 0.70,
    "require_user_confirmation": true
  },
  "action": {
    "type": "local_snapshot_download",
    "config": {}
  },
  "risk_tier": 2,
  "execution_policy": {
    "cooldown_ms": 5000,
    "max_runs_per_session": 10,
    "require_per_run_confirmation": true,
    "retry_limit": 0
  },
  "created_at": 0,
  "updated_at": 0
}
```

## Validation Rules

- `schema_version` is exactly `movement-automation-recipe.v1`.
- `recipe_id` is immutable, unique, and matches `^recipe_[a-zA-Z0-9_-]{1,80}$`.
- `name` is text only, 1 to 80 characters.
- `trigger.movement_key` is an exact canonical key. The reserved key `any_confirmed_movement` is the only wildcard and must be chosen explicitly by the user.
- `aliases` are user-approved, normalized text aliases; maximum 20, 80 characters each.
- `required_tags` are a subset match against canonical `gesture_tags`; maximum 12.
- `minimum_confidence` is from 0 through 1.
- `require_user_confirmation` must be true in v1.2; false is invalid.
- `action.type` must resolve through the fixed adapter registry.
- `risk_tier` is an integer from 0 through 2 and must not be below the adapter-computed tier.
- `cooldown_ms` is from 0 through 86,400,000.
- `max_runs_per_session` is from 1 through 100.
- `retry_limit` cannot exceed the adapter cap; local adapters default to 0 and webhooks permit at most 1.
- Tier 2 recipes require `require_per_run_confirmation: true`.

## Deterministic Matching

The matcher receives only a confirmed canonical result and validated enabled recipes. It:

1. Rejects uncertain or unconfirmed results.
2. Matches exact `movement_key`, an explicit local alias, or the reserved `any_confirmed_movement` trigger.
3. Requires every `required_tag` to be present.
4. Requires confidence at or above `minimum_confidence`.
5. Returns candidates ordered by exact-key match, required-tag count, threshold, then `recipe_id`.
6. Sends candidates to the policy gate for consent, cooldown, rate, and risk checks.

The matcher is pure, local, replayable, and makes no model or network call.

## Storage Restrictions

Recipes are text/config only. They must never contain raw frames, screenshots, base64, audio, OCR, provider tokens, webhook secret values, arbitrary JavaScript, arbitrary shell commands, or arbitrary HTTP methods. Server destinations and secrets are referenced by approved identifiers, never embedded values.
