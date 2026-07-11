# DarkQuest v1.2.1 Instant Automation Results

## Claim

With session-scoped Instant gestures enabled, a stable local MediaPipe `Thumb_Up` can execute an explicitly consented `speak_phrase` recipe without the Describe button, a movement result, a VLM request, or a Confirm click.

## Complete Runtime Path

Behavior coverage executes the browser path from synthetic MediaPipe worker observations through canonical label mapping, temporal stabilization, `handleLocalGestureObservationInState`, `handleStableLocalGesture`, the canonical automation public API, deterministic recipe matching, the local speech adapter, and receipt/status creation. Static strings or isolated matcher tests cannot satisfy the gate.

## No-Confirm Proof

The runtime replay begins with no movement result. It records zero Confirm callback calls, zero confirmation-count changes, and no event with `confirmed_by_user`. The first stable thumbs-up still executes successfully. A `confirmed_ai_movement` recipe is rejected from this path.

## No-VLM Or Network Proof

The runtime replay installs fail-fast fetch and provider stubs. The instant flow performs zero `/api/movement-recognition/analyze`, Hugging Face, Cerebras, provider-helper, or other network calls. `movementResultSnapshot` and the last VLM result remain `null`.

## Public Entrypoint

The browser runtime and both automation gates use `prototype/automation/index.js`; server checks use `server/automation/index.mjs`. All required browser and server exports are present. The runtime does not import lower-level automation implementation modules directly.

## Stable Event Schema

Stable events contain `gesture_event_id`, `gesture_key`, `source`, `confidence`, `first_seen_ms`, `stable_at_ms`, `held_for_ms`, `hand_count`, `requires_neutral_reset`, and `contains_raw_media: false`. Tests verify timing arithmetic, monotonic timestamps, bounded hand count, unique IDs, neutral reset, cooldown, and no retained frame or landmark history.

## Outcome Codes

The stabilizer, activation guards, recipe policy, denylist, duplicate suppression, and adapter completion paths return registered `instant_*` codes. The exact acceptance path returns `instant_action_executed`; continued hold returns `instant_gesture_duplicate`.

## Exact Thumbs-Up Acceptance

Recipe schema is `movement-automation-recipe.v1-1`, mode is `instant_local_gesture`, source is `mediapipe_gesture`, gesture is `thumbs_up`, hold is 350 ms, cooldown is 2500 ms, and the action text is exactly `Great job`. The first stable event speaks once and creates one receipt. Continued hold does not repeat. After neutral reset and cooldown, a second unique event produces one additional utterance and receipt.

## Generic Recipes And Denylist

Runtime behavior also passes `peace_sign -> speak_phrase("Nice")`, `open_palm -> start_timer`, and `closed_fist -> increment_counter`. Snapshot, webhook, external/network, AI/provider, and recursive movement-analysis attempts are denied with explicit outcome codes.

## Performance, Privacy, And UI Freeze

Worker isolation, capped inference, one-frame-in-flight handling, transient bitmap release, hidden-tab suppression, and no full app render per frame are verified. No frame, screenshot, base64, landmark history, token, or raw media is persisted. Movement Result state and animation remain unchanged, camera mirroring remains enabled, and the frozen Camera -> Describe my next movement -> Movement Result hierarchy passes.

## Validation Results

- `npm run test:movement-recognition`: pass
- `npm run test:automation-recipes`: pass
- `npm run test:instant-gestures`: pass
- `npm run gate:v1`: `PASS_WITH_DISCLOSURE` (148/148)
- `npm run gate:v1:research`: `PASS_WITH_DISCLOSURE` (133/133)
- `npm run gate:v1:automation`: `PASS_WITH_DISCLOSURE` (99/99)
- `npm run gate:v1:instant-automation`: `PASS_WITH_DISCLOSURE` (115/115)
- `npm run gate:4a`: `PASS_WITH_DISCLOSURE` (89/89)
- `npm run gate:4a:engine`: `PASS_WITH_DISCLOSURE` (67/67)
- `npm run test:adapter`: pass
- `npm run test:recorder`: pass
- `npm run typecheck`: pass

## Final Verdict

`PASS_WITH_DISCLOSURE`

The complete browser runtime path is behaviorally closed for deterministic synthetic worker sequences. Approval remains limited to the explicitly enabled, allowlisted local gesture path; open-ended AI movements and higher-risk actions still require confirmation.

## Remaining Disclosures

- This gate does not establish physical-camera recognition accuracy or latency; a controlled live MediaPipe session is still required for that claim.
- MediaPipe runtime/model assets may load from pinned external URLs, but camera frames remain local and are not uploaded.
- Instant automation remains session opt-in and limited to explicitly consented safe recipes.
