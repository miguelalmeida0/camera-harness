# DarkQuest v1.3 Custom Movement Skills

## Decision

DarkQuest v1.3 lets users teach local movement skills from demonstrations. It extends the existing instant local automation path; it does not replace the canned MediaPipe recognizer or the one-shot VLM narrator.

The frozen product hierarchy remains:

`Camera -> Describe my next movement -> Big result`

Custom-skill controls remain secondary inside the existing automation area.

## Skill Classes

| Skill class | Recognition path | Automation boundary | v1.3 status |
| --- | --- | --- | --- |
| `custom_hand_pose` | Static one-hand or two-hand landmark template, local and instant | Safe local instant-action allowlist | Phase 1 release requirement |
| `custom_hand_motion` | Short time-normalized landmark-feature sequence, local where physically reliable | Safe local instant-action allowlist | Phase 2; inactive in Phase 1 |
| `custom_semantic_action` | Existing one-shot VLM narration | Confirmation required before automation | Existing path, unchanged |

Phase 1 must support physically reliable custom static one-hand and two-hand poses. `Heart shape` is the required two-hand acceptance case.

## Phase 1 Runtime

`Camera frame -> MediaPipe hand landmarks -> local feature extractor -> custom template classifier -> custom skill candidate -> temporal stabilizer -> stable custom skill event -> deterministic recipe matcher -> existing risk gate -> local action -> receipt`

The custom classifier performs no LLM/VLM, provider, training-service, or network request. It never routes through Describe, movement-result confirmation, or the canned-gesture label allowlist.

## Component Boundaries

- `custom-skill-store.js`: versioned local skill persistence, migration, atomic save/delete, and generated IDs.
- `hand-pose-feature-extractor.js`: deterministic validation and `hand_pose_embedding.v1` feature generation.
- `custom-pose-trainer.js`: example quality checks, prototype aggregation, threshold proposal, and test-session state.
- `custom-skill-classifier.js`: deterministic positive/negative prototype scoring and conflict resolution.
- `custom-skill-controller.js`: camera/visibility lifecycle, training capture, active classification, and symbolic diagnostics.
- Existing `gesture-stabilizer.js`: source-aware hold, one-event emission, neutral reset, and cooldown.
- Existing automation matcher/policy/adapters/receipts: source-discriminated custom-skill recipe execution.

Feature extraction and classification should run in the existing local perception worker. The main thread receives normalized feature vectors during explicit training and symbolic candidate/event data during recognition. It receives no image buffer or landmark history for persistence.

## Deterministic Feature Pipeline

`MediaPipe hand landmarks -> hand validation -> stable hand ordering -> translation normalization -> scale normalization -> rotation normalization -> optional mirror normalization -> derived features -> fixed-length vector -> local prototype classifier`

### Hand validation

- Require exactly the skill's configured `hand_count`.
- Reject missing, duplicated, low-presence, severely cropped, or implausible landmark sets.
- Reject examples with excessive landmark jitter during the stable hold.
- Require sufficient hand scale and fingertip visibility for the configured pose.
- Emit only a bounded rejection code and safe guidance; do not retain the rejected frame or landmarks.

### Stable hand ordering

- Convert preview coordinates into one canonical analysis coordinate system exactly once.
- Prefer reliable MediaPipe handedness for ordering.
- When handedness is unavailable or unstable, order by palm-center x-coordinate in canonical unmirrored coordinates.
- Hold ordering stable within one example window; do not swap vector halves frame to frame.

### Normalization

- Translation: express each hand relative to its wrist/palm center and express the two-hand system relative to the midpoint of both palm centers.
- Scale: normalize local hand geometry by palm scale. Normalize inter-hand geometry by mean palm scale so distance remains meaningful.
- Rotation: align each hand's wrist-to-middle-MCP axis for local finger geometry. Normalize common camera roll for the two-hand relation while preserving relative hand orientation.
- Mirror: when `mirror_invariant` is true, compare the canonical vector and its deterministic mirrored/hand-swapped equivalent; use the better score. Never apply preview mirroring twice.

### Fixed-length features

`hand_pose_embedding.v1` concatenates:

- normalized x/y/z coordinates for 21 landmarks per required hand;
- finger curl and joint-angle features;
- normalized fingertip and thumb-index distances;
- palm orientation features;
- for two hands, palm-center displacement, relative orientation, inter-hand distance, and cross-hand fingertip relationships.

For heart shape, the two-hand feature block must preserve thumb-tip and index-tip distances/orientations across hands. `feature_dimensions` is fixed by feature version and hand count; active skills cannot contain zero-length or mixed-dimension vectors.

## Training Protocol

### Positive examples

- Minimum 5 accepted examples.
- Each pose is held stably for approximately 500-700 ms.
- Each accepted example aggregates consecutive normalized vectors into one robust prototype using a deterministic medoid or coordinate-wise median.
- Missing hands, excessive jitter, poor visibility, wrong hand count, and inconsistent ordering reject the example.

### Negative examples

- Optional by default and recommended whenever nearby poses may confuse the classifier.
- Minimum 3 when used.
- Heart-shape recommendations: open hands, prayer hands, and thumbs touching without the heart relationship.

### Calibration

- Store several positive prototype vectors, not camera samples.
- Compute centroid/spread and leave-one-example-out positive similarity.
- When negatives exist, compute the highest negative similarity.
- Propose a threshold between the positive floor and negative ceiling, clamped to the supported sensitivity range. If separation is insufficient, enter `needs_retraining` instead of lowering safety silently.
- Without negatives, propose a conservative threshold from positive consistency and require a successful live test.
- No model fine-tuning and no network request occur.

## Classifier Policy

The Phase 1 classifier is deterministic nearest-prototype or k-nearest-neighbor matching using a feature-versioned combination of weighted Euclidean distance and cosine similarity.

For each active skill:

1. Validate hand count and feature version.
2. Score the current vector against positive prototypes.
3. Apply negative-prototype separation when available.
4. Reject below `minimum_match_score`.
5. Rank eligible skills by effective score.

The highest valid score wins only when it exceeds the second-best score by the system minimum margin. The initial margin target is 0.08 and must be benchmarked, not presented as an accuracy claim. If the margin is not met, emit `custom_skill_ambiguous` and execute nothing. Never execute two conflicting skills automatically.

The winning candidate still requires consecutive-frame stabilization, neutral reset, and recipe cooldown. Matching makes zero AI calls.

## Skill Lifecycle

Allowed states:

`draft -> collecting_examples -> example_accepted | example_rejected -> calibrating -> ready_to_test -> testing -> active`

Additional transitions:

- `ready_to_test | testing -> needs_retraining` after failed separation or live test.
- `active -> needs_retraining` after feature-version migration or repeated explicit rejection.
- `active <-> disabled` by user action.
- Any non-deleted state -> `deleted` after explicit deletion.
- `deleted` is terminal.

A skill cannot become `active` until minimum examples, calibration, and a live recognition test pass. Deletion removes all local vectors and disables recipes that reference the deleted skill.

## Recipe and Runtime Integration

Custom recipes use `execution_mode: instant_local_gesture` and a source-discriminated trigger:

```json
{
  "source": "custom_local_skill",
  "custom_skill_id": "skill_...",
  "skill_name": "Heart shape"
}
```

Matching uses immutable `custom_skill_id`; `skill_name` is display metadata only. The recipe engine dispatches by trigger source and must not require the ID to appear in a hardcoded gesture-key list.

An active custom skill may automatically execute only the existing safe local allowlist: speech, counter, timer, and text activity log. Notification permission and all snapshot, webhook, external, media, and paid actions retain existing confirmation/risk policy and cannot be silently promoted to instant execution.

## Privacy and Memory Boundary

- Camera frames remain ephemeral and are closed after local inference.
- Store no images, screenshots, video, audio, base64, object URLs, or raw frame bytes.
- Store no provider token and perform no cloud training or upload.
- Persist only versioned normalized feature/prototype vectors, calibration statistics, skill metadata, and text-only receipts.
- Templates are local by default, clearable, and excluded from provider prompts and movement history.
- Deleting a skill atomically removes every local template and calibration artifact for that skill.
- Diagnostics expose counts, scores, margins, IDs, rejection codes, and latency only; they never expose full vectors or landmark histories.

Normalized hand geometry is not guaranteed anonymous or risk-free. Custom templates are sensitive local interaction data and must be handled with the same care as other user-trained local signals.

## User Freedom and Safety

Users may choose skill name, demonstrated pose, supported sensitivity, hold, cooldown, and an allowed action configuration. The broader automation editor may still configure notifications and approved webhooks under their existing permission and confirmation policies.

Users cannot define arbitrary JavaScript, shell commands, unrestricted URLs, hidden capture, cloud upload, raw-media storage, or recursive Analyze Movement calls.

## Failure Modes

- Insufficient or inconsistent examples: remain in collection or enter `needs_retraining`.
- Missing required hands or unstable ordering: reject the example with safe guidance.
- Feature-version mismatch: disable recognition until local migration/retraining.
- Close classifier scores: emit ambiguous/no-match and execute nothing.
- Deleted or disabled skill: recipe cannot match.
- Hidden tab, stopped camera, or unavailable local engine: no classification or action.
- Storage failure: keep the previous skill atomically and show scoped recovery copy.

## Physical Acceptance: Heart Shape

1. User creates `Heart shape` as a two-hand custom pose.
2. Five valid stable examples are accepted.
3. No raw image or video is stored.
4. Calibration completes and the live test passes.
5. User attaches `speak_phrase` with `Heart detected`.
6. User saves/enables the skill and enables Instant gestures.
7. A future heart pose matches above threshold and conflict margin.
8. `Heart detected` is spoken exactly once.
9. Continued hold does not repeat.
10. Neutral reset and cooldown permit one later execution.
11. Open-palm and prayer-hand negatives do not trigger the skill.
12. One text-only receipt identifies the custom skill and contains no raw media.
