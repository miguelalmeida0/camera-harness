# Gate 4A Real Local Camera Action Engine

## Decision

Gate 4A moves the product from manual trace capture toward a local camera action engine:

```text
camera frame
-> local hand/zone perception
-> local action inference
-> Detected Action card
-> user confirm/correct
-> progress update
```

The hot path remains browser-local, deterministic, privacy-safe, and confirmation-gated. JSON traces, Gate 3B-Live, reports, and validation commands are internal QA only.

## Layer 1 - Camera Input

- Use the browser camera stream as the only live image source.
- Keep frames transient in memory for local processing.
- Do not persist frames, screenshots, base64 images, audio, OCR, notebook text, or raw video.
- Do not upload frames to a backend or cloud model.
- Expose only derived symbolic observations to downstream layers.

Failure modes:
- permission denied;
- camera unavailable;
- frozen or stale stream;
- camera bump invalidates zone calibration;
- lighting changes create noisy motion.

Required artifacts:
- camera permission status;
- local processing status;
- symbolic reset or uncertainty event when the scene becomes unsafe.

## Layer 2 - Local Perception

Primary perception should use MediaPipe Tasks Web Hand Landmarker when feasible. It runs locally in the browser and produces hand landmarks, not raw-media artifacts.

Fallback and complementary perception remains local frame differencing:

- zone motion scores;
- active zone;
- dwell time;
- velocity and direction;
- hand-zone overlap when landmarks exist;
- uncertainty and scene reset detection.

The fallback must remain useful without MediaPipe. MediaPipe improves precision, but the product must not depend on cloud perception.

Failure modes:
- hand landmarks unavailable;
- hand occluded;
- object motion without visible hand;
- rapid camera movement;
- zone calibration drift;
- low light or high background motion.

Fallbacks:
- use zone motion proxy when hand landmarks are missing;
- mark uncertain when local signals conflict;
- request recalibration after camera bump or drift.

## Layer 3 - Action Inference

Action inference is a deterministic state machine plus current-step-aware scorers.

Inputs:
- current ritual step;
- hand landmarks if available;
- hand-zone overlap;
- zone motion;
- dwell;
- velocity/direction;
- cooldown history;
- uncertainty/reset state.

Outputs:
- one primary `DetectedActionCandidate`;
- optional suppressed developer-only candidates;
- uncertainty/reset candidates.

Rules:
- score only actions valid for the current step in the main UI;
- suppress future-step candidates by default;
- smooth confidence over short windows;
- debounce duplicate detections with cooldowns;
- reject low-confidence candidates from dominating the card;
- never progress the ritual from a candidate alone.

Failure modes:
- false positive from unrelated desk motion;
- false negative from subtle movement;
- repeated candidate flicker;
- stale candidate after rejection;
- current-step mismatch.

Mitigations:
- require current-step match;
- require dwell or direction evidence;
- cool down rejected candidates;
- surface uncertainty instead of forcing a guess.

## Layer 4 - Product UI

Default UI is the app:

- Camera;
- Current Step;
- Detected Action card;
- Confirm / Not this;
- Progress;
- Recent symbolic events;
- compact export/validation only when relevant.

The Detected Action card must show:

- action label;
- confidence;
- zone;
- short reason;
- confirmation disclosure;
- Confirm;
- Not this / Correct.

Allowed copy:
- `Camera suggestion - requires confirmation`;
- `Possible phone moved`;
- `Possible writing motion`.

Forbidden copy:
- autonomous vision claims;
- object detection proof;
- gesture recognition proof;
- production/demo/portfolio readiness.

## Layer 5 - Hidden Developer QA

Developer QA remains available under closed Advanced / Developer Tools:

- trace export;
- suggestion trace campaign;
- validation;
- replay reports;
- diagnostics;
- local perception tuning.

These tools must not define or crowd the product experience.

## Invariants

- Raw media persistence count is always zero.
- LLM/VLM calls in the camera hot path are always zero.
- Candidates require confirmation.
- Rejection never progresses state.
- Uncertainty pauses unsafe progression.
- Quest state changes only through the existing reducer and schema-valid symbolic events.

## Cost And Latency Impact

- Browser frame differencing cost is near zero and should stay under the existing local frame budget.
- MediaPipe adds CPU/WebGL/WebGPU work but no model-call cost.
- No cloud inference cost is introduced.
- Hot path latency budget should prioritize stable card updates over high-frequency UI churn.

## Tradeoffs

- Deterministic heuristics are less flexible than a VLM, but they are cheaper, private, debuggable, and replayable.
- MediaPipe landmarks improve hand-zone reasoning, but availability and device performance vary.
- Keeping confirmation mandatory slows flow slightly, but it prevents unsafe auto-completion and misleading perception claims.

