# Instant Gesture Runtime Closure

## Decision

DarkQuest has one live instant-gesture runtime:

`Camera -> MediaPipe worker -> canonical gesture mapping -> temporal stabilizer -> StableLocalGestureEvent -> runAutomationForStableLocalGesture -> policy gate -> local action -> execution receipt`

The browser runtime invokes this path directly after stable local recognition. It does not create or read an AI movement result and does not wait for user confirmation.

## Root Cause

The current code contains the right pieces but not one authoritative path:

- `local-capture.js` imports recipe, engine, matcher, adapter, and receipt implementation modules directly instead of consuming `automation/index.js`.
- `handleLocalGestureObservation` calls a lower-level engine alias while the checks exercise the canonical index, allowing synthetic behavior to diverge from browser wiring.
- Activation and status are duplicated between `state.instantGestures` and `state.automation`, creating two possible sources of truth.
- The browser index exposes engine-native signatures while `local-capture.js` contains additional compatibility validators and argument-shape adapters.
- Recipe normalization emits both schema fields, preserves caller-provided per-run confirmation for instant recipes, and omits canonical `confirmation_policy`.
- The editor maps every non-per-run recipe back to `movement_confirmation`, so an instant recipe still displays `Run after movement confirmation`.
- The read path normalizes records but does not guarantee repaired values are persisted back to storage.
- Gate v1.2 imports `local-capture.js` and movement-recognition server exports, while the instant check imports the browser/server automation indexes.
- Worker and compatibility engines publish ready after recognizer construction, before a successful inference proves frames reach stabilization.
- No complete diagnostics record distinguishes inference, mapping, hold, matching, policy, receipt, and speech failures.

These splits allow a synthetic stable event to execute successfully without proving that a real worker observation reaches the same runner in the browser.

## Canonical Browser Wiring

`local-capture.js` imports automation behavior only from:

`packages/perception/browser-local-capture/prototype/automation/index.js`

Required imports:

- `validateAutomationRecipe`
- `matchAutomationRecipes`
- `createAutomationRuntimeState`
- `transitionAutomationState`
- `automationIdempotencyKey`
- `runAutomationForConfirmedMovement`
- `runAutomationForStableLocalGesture`
- `executeLocalAutomationAction`
- `clearAutomationActivityLog`

It must not import lower-level automation modules or contain alternate validation, matching, transition, or runner implementations.

Server behavior and both checks import only:

`packages/perception/browser-local-capture/server/automation/index.mjs`

Required server exports are `validateAutomationWebhookDestination`, `buildSignedAutomationWebhookRequest`, and `executeSignedAutomationWebhook`.

## Canonical Runner Calls

The live confirmed path calls:

```ts
runAutomationForConfirmedMovement({
  snapshot,
  recipes,
  runtime,
  actionExecutor,
  requestConsent,
  context
});
```

The live instant path calls:

```ts
runAutomationForStableLocalGesture({
  gestureEvent,
  recipes,
  runtime,
  actionExecutor,
  context: {
    instantGesturesEnabled,
    cameraReady,
    documentHidden,
    engineStatus
  }
});
```

No alternate property aliases are accepted by the canonical index. The runner internally reserves `gesture_event_id + recipe_id`, enforces source/mode/action policy, executes once, and records one safe receipt.

## Explicitly Prohibited Routing

An instant gesture must never route through or depend on:

- `movementResultSnapshot`.
- Confirm button handlers or confirmation state.
- `runAutomationForConfirmedMovement`.
- `analyzeMovementInState` or the Describe control.
- Hugging Face, Cerebras, provider fallback, or movement-recognition endpoints.
- AI movement-result normalization or confirmation.

The Describe button remains present for Path B, but no click is required or synthesized for Path A.

## Runtime Ownership

Use one `instantGestureController` outside render functions to own:

- persisted `preferenceEnabled` loaded only from the dedicated local preference key;
- computed `active` state;
- engine status;
- worker lifecycle;
- stabilizer state;
- last stable event.

Use the automation runtime to own recipes, recipe consent, cooldowns, run counts, idempotency keys, in-flight guard, and receipts. UI state is a derived view only. Remove mirrored activation/status booleans from independent state branches.

`active` is true only when preference is enabled, camera is running, document is visible, and engine status is `ready`, `recognized`, or `cooling_down`. Saved preference alone never starts inference or permits execution.

## Recipe Source of Truth

`execution_mode` is authoritative. Confirmation fields are normalized projections:

| Mode | `confirmation_policy` | `trigger.require_user_confirmation` | `execution_policy.require_per_run_confirmation` |
| --- | --- | --- | --- |
| `instant_local_gesture` | `none` | false | false |
| `confirmed_ai_movement` | `movement_confirmation` or `per_run` | true | Derived from confirmed policy |

The editor, recipe card, matcher, and executor consume only `normalizeAutomationRecipe` output. Checkbox and dropdown state cannot compete with the persisted model.

On read, every record is normalized and the repaired document is persisted when its serialized form changes. Existing contradictory instant recipes are repaired automatically; the user must not edit localStorage.

## Editor Runtime Rule

When `Run instantly when recognized` is checked:

- hide or disable the confirmation selector;
- display `Confirmation: Not required for this safe local action.`;
- force all normalized instant confirmation fields;
- reject non-allowlisted actions before save.

When unchecked, show confirmed-path settings and persist `confirmed_ai_movement`. The UI must never display instant execution and movement confirmation together.

## Worker and Stable Event Boundary

The worker emits only canonical label, confidence, timestamp, and bounded `hand_count`. It closes each transferred frame. The controller maps labels, then the stabilizer emits every required `stable-local-gesture-event.v1` field. No frame, image, landmark array, base64, or provider credential reaches the automation layer.

MediaPipe package, WASM, and model assets should be bundled or fixed same-origin assets for deterministic local operation. Asset loading must never send camera frames and must never fall back to a cloud model.

## Session Activation Semantics

- First-use preference is off.
- Only the user can change the Instant gestures preference.
- The preference may be saved locally; recipe import cannot set it.
- Inference starts only while camera is running and the tab is visible.
- Hiding the tab or stopping the camera stops the worker, clears candidates, and blocks execution.
- Restoring visibility may restart the local worker when preference remains enabled, but stale observations cannot emit.
- Engine statuses are exactly `Off`, `Loading model`, `Starting inference`, `Ready`, `Ready — compatibility mode`, `Gesture candidate`, `Gesture stabilizing`, `Recognized`, `Executing`, `Cooling down`, and `Unavailable`.
- `Unavailable` never triggers VLM fallback.

## Engine-Ready Invariant

Neither worker nor compatibility mode may report ready merely because a worker, fallback object, fileset, model, or `GestureRecognizer` was constructed.

`Ready` or `Ready — compatibility mode` is valid only after all are true:

1. A real MediaPipe `GestureRecognizer` instance exists.
2. The recognition loop is running.
3. Camera video `readyState` is sufficient for frame capture.
4. At least one `recognizeForVideo` inference completed successfully, including a valid `None` result.
5. That result reached the controller and stabilizer boundary.
6. `frames_processed >= 1` and `last_frame_timestamp` reflects the completed inference.

After recognizer construction and before first inference, status is `Starting inference`. `Gesture candidate` means a mapped above-threshold key started. `Gesture stabilizing` means hold progress is active. `Recognized`, `Executing`, and `Cooling down` are event/action states, not initialization shortcuts.

If inference cannot complete, status becomes `Unavailable` with a safe error. No cloud-analysis fallback is allowed.

## Runtime Observability

Hidden Research Lab exposes the exact text-only `LocalGestureRuntimeDiagnosticsV1` fields: recognition loop, frame count/timestamp, raw label/confidence, mapped key, current/required hold, stable event ID, match outcome, execution outcome, receipt ID, and safe error.

Ownership is fixed:

- engine/controller updates loop, frame, raw label, confidence, mapped key, and safe error;
- stabilizer updates hold progress and stable event ID;
- matcher updates match outcome;
- policy/adapter updates execution outcome;
- receipt store updates receipt ID.

Render functions only display this state. Diagnostics never include raw media, landmarks, base64, credentials, or provider output.

## Canonical Outcome Codes

Return exactly one primary code for each non-executing path:

| Code | Exact condition |
| --- | --- |
| `instant_gesture_below_threshold` | Supported local gesture confidence is below the recipe threshold. |
| `instant_gesture_hold_not_met` | Above-threshold candidate has not met `hold_ms`. |
| `instant_gesture_duplicate` | Current hold already emitted or event ID is already reserved. |
| `instant_gesture_neutral_reset_missing` | A prior emission has not been followed by the required neutral interval. |
| `instant_gesture_cooldown_active` | Neutral reset passed but stabilizer or recipe cooldown remains active. |
| `instant_gesture_not_enabled` | User preference is off. |
| `instant_recipe_not_enabled` | Candidate recipe exists but `enabled` is false. |
| `instant_recipe_wrong_mode` | Candidate recipe is not `instant_local_gesture`. |
| `instant_camera_inactive` | Camera is stopped or not ready. |
| `instant_document_hidden` | Document is hidden. |
| `instant_engine_unavailable` | Local gesture engine is unavailable. |
| `instant_action_not_allowlisted` | Action is outside the instant allowlist and has no more specific code. |
| `instant_snapshot_forbidden` | Action is `local_snapshot_download` or another snapshot capture. |
| `instant_webhook_forbidden` | Action is `signed_webhook_post` or another external webhook. |
| `instant_ai_call_forbidden` | Action attempts movement analysis, LLM/VLM inference, or provider use. |
| `instant_recursive_analysis` | Automation is already in flight or an action attempts recursive automation/analysis. |

Precedence is lifecycle -> stable-event validity -> recipe state/mode -> action policy -> cooldown/rate -> idempotency -> execution. Specific snapshot, webhook, AI, and recursion codes take precedence over `instant_action_not_allowlisted`. Denials before execution create no success receipt and invoke no adapter.

## Physical Acceptance

The real physical test passes only when all are observed in one browser session:

1. Recipe is normalized as `instant_local_gesture`.
2. Confirmation policy is `none` and both confirmation booleans are false.
3. Camera is active.
4. Instant gestures is enabled.
5. Engine satisfies the ready invariant.
6. `frames_processed` increases.
7. Raw `Thumb_Up` candidate appears.
8. Candidate confidence is visible in hidden diagnostics.
9. Hold progresses to or beyond the configured threshold.
10. A complete stable event emits.
11. The instant recipe matches.
12. Speech says `GREAT JOB` exactly once.
13. Recipe Last run changes from `never`.
14. One safe execution receipt appears.
15. Confirm calls remain zero.
16. Provider/VLM calls remain zero.
17. Continued held thumb causes no repeat.
18. Neutral reset plus cooldown permits one later second run.

## Multimodal Runtime Patch Requirements

1. Force instant confirmation fields and canonical `confirmation_policy` in `normalizeAutomationRecipe`.
2. Repair and persist contradictory stored records, including already-v1.1 recipes.
3. Remove browser-index compatibility normalization that can disagree with recipe-store output.
4. Bind editor visibility and copy to normalized `execution_mode`; never save raw confirmation dropdown state for instant mode.
5. Delay worker and compatibility ready status until successful inference reaches stabilization.
6. Add one controller-owned diagnostics object and update it at engine, stabilizer, matcher, adapter, and receipt boundaries.
7. Ensure `speak_phrase` reads canonical `config.text`, speaks once, and updates Last run plus receipt state.
8. Preserve the frozen hierarchy and keep diagnostics inside closed Research Lab.

## Harness Requirements

1. Test normalization as an idempotent truth table for both modes and contradictory confirmation inputs.
2. Test repair-on-read using persisted contradictory instant data and verify normalized write-back without user action.
3. Assert the editor cannot display instant plus movement confirmation and saves only normalized fields.
4. Assert recognizer construction alone is not ready; first completed inference reaching stabilization is required.
5. Assert every diagnostics field advances at its ownership boundary and remains text-only.
6. Drive the browser runtime through all 18 physical acceptance observations with mocked counters plus a real-camera protocol.
7. Assert speech exactly once, Last run update, one receipt, zero Confirm/provider calls, continued-hold suppression, and later neutral-reset execution.
8. Preserve confirmed-AI, snapshot, webhook, privacy, and design-freeze checks.

The release check must exercise the browser runtime, not only call the instant runner synthetically. Closure requires the instant suite to reach 115/115 while the existing automation and type checks remain passing.
