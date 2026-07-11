# Custom Movement Skill v1

## Stored Schema

```json
{
  "skill_id": "skill_...",
  "schema_version": "custom-movement-skill.v1",
  "name": "Heart shape",
  "skill_type": "custom_hand_pose",
  "enabled": true,
  "lifecycle_state": "active",
  "recognition": {
    "engine": "local_landmark_template",
    "hand_count": 2,
    "mirror_invariant": true,
    "minimum_match_score": 0.78,
    "minimum_score_margin": 0.08,
    "hold_ms": 400,
    "neutral_reset_required": true,
    "cooldown_ms": 2500
  },
  "template": {
    "feature_version": "hand_pose_embedding.v1",
    "prototype_vectors": [],
    "negative_prototype_vectors": [],
    "feature_dimensions": 0
  },
  "privacy": {
    "contains_raw_media": false,
    "contains_images": false,
    "contains_video": false,
    "local_only": true,
    "clearable": true
  },
  "created_at": 0,
  "updated_at": 0
}
```

The empty vectors and zero dimension above represent a draft. A `ready_to_test` or `active` pose skill requires at least five finite positive prototype vectors with identical non-zero dimensions.

## Identity

- `skill_id` is generated internally by `createCustomMovementSkill(draft)` and matches `^skill_[a-zA-Z0-9_-]{1,80}$`.
- UI never shows an editable internal ID.
- `skill_id` is immutable after creation.
- Legacy missing IDs are generated during migration before persistence.

## Field Rules

- `schema_version`: exactly `custom-movement-skill.v1`.
- `name`: user-defined display text, 1-80 characters.
- `skill_type`: `custom_hand_pose`, `custom_hand_motion`, or `custom_semantic_action`.
- `enabled`: true only when lifecycle is `active`; disabled skills do not classify.
- `lifecycle_state`: one of the defined lifecycle states.
- `recognition.engine`: `local_landmark_template` for Phase 1 poses.
- `hand_count`: 1 or 2 and fixed after accepted examples exist.
- `minimum_match_score`: finite value from 0 through 1.
- `minimum_score_margin`: finite value from 0 through 1; defaults to the system-calibrated margin.
- `hold_ms`: bounded integer from 250 through 1500.
- `neutral_reset_required`: true for active Phase 1 skills.
- `cooldown_ms`: bounded integer from 0 through 86,400,000.

## Template Rules

- `feature_version` fixes extraction order, normalization, weights, and dimensions.
- Every vector is an array of finite bounded numbers with exactly `feature_dimensions` entries.
- Positive prototypes contain at least five vectors before live test.
- Negative prototypes are optional; when present they contain at least three vectors.
- Mixed feature versions or dimensions are invalid.
- Full vectors are never copied into events, receipts, logs, diagnostics, or UI.
- Changing feature version places the skill in `needs_retraining` unless a deterministic local migration is defined.

## Training Metadata

Implementations may store bounded text/numeric calibration metadata such as accepted/rejected counts, centroid, spread, proposed threshold, negative separation, and last successful test timestamp. It must contain no frame, landmark history, or user identity field.

## Privacy Rules

- `contains_raw_media`, `contains_images`, and `contains_video` are always false.
- No raw frames, screenshots, video, audio, base64, object URLs, OCR, or provider tokens.
- No cloud training, remote classifier, or template upload.
- Templates remain local by default and are excluded from AI prompts.
- Deletion atomically removes skill metadata, positive/negative vectors, calibration data, and pending training samples.
- Referencing recipes are disabled with a safe missing-skill reason.

Normalized hand geometry may retain user-specific interaction characteristics. It is sensitive local interaction data, not guaranteed anonymous or non-biometric.

## Stable Custom Skill Event

An active classifier emits only this symbolic event after match, conflict, and hold requirements pass:

```json
{
  "schema_version": "stable-custom-skill-event.v1",
  "skill_event_id": "skill_event_...",
  "source": "custom_local_skill",
  "custom_skill_id": "skill_...",
  "skill_name": "Heart shape",
  "skill_type": "custom_hand_pose",
  "match_score": 0.86,
  "second_best_score": 0.64,
  "score_margin": 0.22,
  "first_seen_ms": 0,
  "stable_at_ms": 420,
  "held_for_ms": 420,
  "hand_count": 2,
  "requires_neutral_reset": true,
  "contains_raw_media": false
}
```

The event contains no vector, landmarks, frame reference, image, or identity. Its idempotency key is `skill_event_id + recipe_id`.

## Lifecycle Transitions

- `draft -> collecting_examples`.
- `collecting_examples -> example_accepted | example_rejected` and back to collection.
- Minimum examples -> `calibrating`.
- Successful calibration -> `ready_to_test`.
- `ready_to_test -> testing`.
- Successful live test -> `active`; failed test -> `needs_retraining`.
- `active -> disabled | needs_retraining`.
- `disabled -> active` only when templates remain valid and testing previously passed.
- Any non-deleted state -> `deleted`; deletion is terminal.

All saves are normalized, validated, and transactional. Failed validation preserves the previous stored skill.
