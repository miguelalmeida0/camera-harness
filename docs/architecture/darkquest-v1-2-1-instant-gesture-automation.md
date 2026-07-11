# DarkQuest v1.2.1 Instant Gesture Automation

## Decision

DarkQuest uses two independent recognition paths with a shared deterministic recipe, policy, adapter, idempotency, and receipt layer.

| Path | Recognition | Trigger | Confirmation | Allowed automation |
| --- | --- | --- | --- | --- |
| A: `instant_local_gesture` | Continuous browser-local MediaPipe Gesture Recognizer | Stable known gesture event | Recipe opt-in plus session activation; no per-event confirmation for allowed Tier 0 actions | Instant allowlist only |
| B: `confirmed_ai_movement` | Existing one-shot Hugging Face/Cerebras VLM | Confirmed canonical movement result | Explicit confirmation for every result | Existing risk-tier policy |

Path A never calls Hugging Face, Cerebras, an LLM/VLM endpoint, or any movement-analysis route. Path B remains one-shot and confirmation-gated.

## Instant Flow

`Camera video -> local MediaPipe Gesture Recognizer -> temporal stabilizer -> stable-local-gesture-event.v1 -> deterministic instant recipe matcher -> safety/risk gate -> local action -> compact receipt`

## Canonical Gesture Mapping

| MediaPipe label | Canonical `gesture_key` |
| --- | --- |
| `Thumb_Up` | `thumbs_up` |
| `Thumb_Down` | `thumbs_down` |
| `Victory` | `peace_sign` |
| `Open_Palm` | `open_palm` |
| `Closed_Fist` | `closed_fist` |
| `Pointing_Up` | `pointing_up` |
| `ILoveYou` | `i_love_you` |

All other labels, `None`, malformed output, and scores below the active recipe threshold are neutral or unsupported. No freeform label may become an executable key.

## Runtime Boundaries

- `mediapipe-gesture-worker.js`: owns Gesture Recognizer initialization and inference. MediaPipe WASM/model assets are packaged with the app or served as fixed same-origin assets; inference sends no network request.
- `local-gesture-controller.js`: samples the latest camera frame, transfers it to the worker, drops work while the worker is busy, and closes transferred frame resources immediately.
- `gesture-stabilizer.js`: converts noisy classifications into one stable event with hold, neutral reset, and lifecycle guards.
- `automation/index.js`: exposes the canonical recipe/runtime entrypoint used by the application and harness.
- Existing matcher, policy, local adapters, and receipt store are reused through source-specific runners.

Use `requestVideoFrameCallback` when available and cap inference near 12-15 frames per second. Keep at most one frame in flight. A transferred `ImageBitmap` or equivalent ephemeral frame is closed after inference and is never stored, logged, serialized, uploaded, or added to history.

## Instant Lifecycle

1. First app load starts with Instant gestures off.
2. User explicitly enables Instant gestures. The preference may be saved locally, but an imported recipe cannot enable it.
3. The worker loads fixed local assets and reports `Loading`, then `Ready`.
4. The controller samples only while camera is active, tab visible, toggle enabled, and worker ready.
5. The stabilizer emits one canonical event after threshold and hold requirements pass.
6. `runAutomationForStableLocalGesture` matches only instant recipes and authorizes only instant-allowed actions.
7. The adapter executes once and writes a compact text-only receipt.
8. The same gesture cannot rearm until neutral reset and recipe cooldown are both satisfied.

Camera stop, permission loss, worker failure, page lifecycle teardown, or hidden tab immediately clears candidates and disables emission. A saved preference does not override those runtime guards. Returning to a visible tab does not emit from stale observations.

## Invariants

1. Instant recognition is off by default and requires explicit session activation.
2. Only the seven canonical keys above are executable in v1.2.1.
3. No image or landmark array crosses into recipes, receipts, history, logs, or storage.
4. No cloud call is reachable from the instant runner.
5. A stable event can execute only recipes with `execution_mode: instant_local_gesture` and prior instant consent.
6. Snapshot, webhook, media, paid API, arbitrary command, and movement-analysis actions fail validation in instant mode.
7. `gesture_event_id + recipe_id` is reserved before adapter execution.
8. UI rerenders never own worker, stabilizer, cooldown, or idempotency state.

## Latency and Cost Targets

- Local inference network calls: 0.
- Stabilization target: approximately 250-500 ms after a clear supported gesture begins.
- Safe action dispatch: immediately after stable-event authorization, excluding adapter-specific browser latency.
- Speech: one utterance per authorized event; cancel or suppress duplicate dispatch, not the existing AI result narration state.
- Main-thread work: bounded so camera controls and the result card remain responsive and stationary.
- Model/provider cost for Path A: $0.

These are engineering targets, not gesture-accuracy or production-readiness claims.

## Failure Modes

- MediaPipe unavailable or asset load failure: show `Unavailable`; do not fall back to VLM automatically.
- Low/oscillating confidence: remain neutral; emit no receipt or action.
- Excess frame backlog: drop stale frames; never queue an inference burst.
- Hidden tab or stopped camera: disarm and require fresh observations after reactivation.
- Unsupported action or recipe mode mismatch: deny before adapter execution and create a safe text-only diagnostic receipt.
- Speech API unavailable: emit one failed receipt; do not retry in a loop.
