# Gate 4A.1 Real Local Engine Implementation Plan

## Decision

Implement a local camera action engine behind the frozen UI. Do not change layout, spacing, colors, typography, card structure, or visual hierarchy.

Target pipeline:

```text
browser camera frame
-> MediaPipe hand engine if available
-> motion proxy fallback
-> zone overlap engine
-> local action scorer
-> confidence smoother
-> Detected Action UI adapter
-> user confirm/correct
```

## Target Module Boundaries

Preferred structure:

```text
packages/perception/browser-local-capture/prototype/perception/mediapipe-hand-engine.js
packages/perception/browser-local-capture/prototype/perception/zone-motion-engine.js
packages/perception/browser-local-capture/prototype/perception/zone-overlap-engine.js
packages/perception/browser-local-capture/prototype/perception/local-action-scorer.js
packages/perception/browser-local-capture/prototype/perception/action-confidence.js
packages/perception/browser-local-capture/prototype/perception/action-cooldowns.js
packages/perception/browser-local-capture/prototype/perception/detected-action-adapter.js
packages/perception/browser-local-capture/prototype/perception/hidden-diagnostics-adapter.js
```

If the prototype is not ready for new modules, the smallest safe alternative is to add these as internal sections in `local-capture.js` first, using the same function names, then extract modules after tests pass.

## MediaPipe Hand Engine

File:

```text
packages/perception/browser-local-capture/prototype/perception/mediapipe-hand-engine.js
```

Functions:

```ts
async function createMediaPipeHandEngine(options): Promise<MediaPipeHandEngine>;
async function loadHandLandmarker(engine): Promise<void>;
function canUseHandLandmarker(runtime): boolean;
async function detectHands(engine, video, timestampMs): Promise<HandLandmarkObservation[]>;
function summarizeHands(landmarks, zones): HandSummary;
function disposeHandEngine(engine): void;
```

Responsibilities:

- initialize `@mediapipe/tasks-vision` Hand Landmarker if feasible;
- run local hand landmark detection against transient video frames;
- return symbolic landmark summaries;
- never persist raw frames;
- fail closed to motion proxy fallback.

Failure modes:

- package unavailable;
- browser lacks required runtime;
- initialization slow;
- no hands detected;
- landmarks unstable.

Fallback:

- mark hand engine unavailable;
- continue with zone motion engine.

## Motion Proxy Fallback

File:

```text
packages/perception/browser-local-capture/prototype/perception/zone-motion-engine.js
```

Functions:

```ts
function createZoneMotionEngine(sampleConfig): ZoneMotionEngine;
function readDownsampledGrayFrame(video, canvas, context): Uint8Array;
function computeZoneMotion(previous, current, zoneGeometry, timestampMs, threshold): ZoneMotionObservation[];
function updateMotionHistory(history, observation, timestampMs): MotionHistory;
function computeMotionBurst(history, zoneId): MotionBurst;
function computeZoneDwell(history, zoneId): ZoneDwell;
function computeDirectionalChange(history, fromZoneId): DirectionalChange;
```

Responsibilities:

- preserve existing browser-local frame differencing behavior;
- produce zone motion scores, dwell, burst, and direction;
- remain the fallback when hand landmarks are unavailable.

## Zone Overlap Engine

File:

```text
packages/perception/browser-local-capture/prototype/perception/zone-overlap-engine.js
```

Functions:

```ts
function normalizeHandLandmarks(landmarks, videoSize): NormalizedHand[];
function computeHandZoneOverlap(hands, zoneGeometry): HandZoneOverlapObservation[];
function computeHandVelocity(previousHands, currentHands, timestampMs): HandVelocityObservation[];
function dominantHandZone(overlaps): string | null;
function handMovedBetweenZones(previousOverlaps, currentOverlaps): ZoneTransition[];
```

Responsibilities:

- map local hand landmarks to calibrated desk zones;
- detect hand-zone overlap;
- derive velocity and zone transitions;
- provide symbolic evidence for action scoring.

## Action Scorer

File:

```text
packages/perception/browser-local-capture/prototype/perception/local-action-scorer.js
```

Functions:

```ts
function buildLocalPerceptionFrame(input): LocalPerceptionFrame;
function scoreCurrentStepAction(frame, questState, history): DetectedActionCandidate | null;
function scorePhoneMoved(frame, history): ActionScore;
function scoreNotebookOpened(frame, history): ActionScore;
function scorePenPickedUp(frame, history): ActionScore;
function scoreWritingMotion(frame, history): ActionScore;
function scoreTypingMotion(frame, history): ActionScore;
function scoreUncertain(frame, history): ActionScore | null;
function suppressFutureStepCandidates(candidates, questState): DetectedActionCandidate[];
```

Responsibilities:

- use current quest step as the primary gate;
- combine hand-zone overlap with motion proxy evidence;
- produce at most one product-facing candidate;
- keep suppressed candidates developer-only;
- never progress the quest.

## Confidence Smoother

File:

```text
packages/perception/browser-local-capture/prototype/perception/action-confidence.js
```

Functions:

```ts
function createConfidenceWindow(config): ConfidenceWindow;
function smoothActionConfidence(window, candidate): DetectedActionCandidate | null;
function shouldPromoteCandidate(candidate, window): boolean;
function shouldShowUncertain(window): boolean;
function resetConfidenceWindow(window, reason): void;
```

Responsibilities:

- prevent one-frame false positives;
- smooth confidence across short windows;
- prevent low-confidence dominance;
- surface uncertainty when evidence conflicts.

## Rejection Cooldown Manager

File:

```text
packages/perception/browser-local-capture/prototype/perception/action-cooldowns.js
```

Functions:

```ts
function createActionCooldowns(config): ActionCooldowns;
function candidateKey(candidate): string;
function isCandidateCoolingDown(cooldowns, candidate, timestampMs): boolean;
function rejectCandidate(cooldowns, candidate, timestampMs): ActionCooldowns;
function expireCooldowns(cooldowns, timestampMs): ActionCooldowns;
```

Responsibilities:

- suppress repeated rejected suggestions;
- prevent UI flicker after Not this / Correct;
- keep rejection from progressing state.

## Detected Action UI Adapter

File:

```text
packages/perception/browser-local-capture/prototype/perception/detected-action-adapter.js
```

Functions:

```ts
function candidateToSuggestion(candidate): PerceptionSuggestion;
function renderDetectedActionState(candidate, uiState): DetectedActionViewModel;
function shouldUpdateDetectedAction(previous, next, timestampMs): boolean;
function bindDetectedActionControls(handlers): void;
```

Responsibilities:

- adapt `DetectedActionCandidate` into the existing Detected Action card;
- keep Confirm / Not this behavior;
- throttle visible updates;
- preserve frozen UI structure.

## Hidden Diagnostics Adapter

File:

```text
packages/perception/browser-local-capture/prototype/perception/hidden-diagnostics-adapter.js
```

Functions:

```ts
function buildHiddenPerceptionDiagnostics(frame, candidate, engineStatus): HiddenDiagnostics;
function sanitizeDiagnostics(diagnostics): HiddenDiagnostics;
function renderHiddenDiagnostics(diagnostics, dom): void;
```

Responsibilities:

- expose symbolic diagnostics only inside Advanced / Developer Tools;
- include engine status, confidence, active zones, and fallback reason;
- exclude raw media, screenshots, OCR, audio, and frame data.

## Engine Choice

Primary:

- `@mediapipe/tasks-vision` Hand Landmarker if feasible in the current app setup;
- local frame differencing / zone motion as fallback and complementary signal;
- deterministic action scorer.

Later:

- ONNX Runtime Web plus WebGPU only after Gate 4A.1 works;
- LangGraph only for summaries/coaching, not camera hot path;
- Cerebras/Groq/Gemini/OpenAI only for optional summaries/coaching, not camera frames.

Rejected for hot path:

- cloud/VLM frame analysis;
- LLM-based action routing;
- trace campaign as main UX;
- auto-completion.

## Action Logic Specification

### phone_moved

Required:

- current step is phone;
- hand enters `phone_zone` if landmarks exist;
- motion burst in `phone_zone`;
- hand or motion exits toward `off_desk_zone`.

Evidence:

- `hand_zone_overlap: phone_zone`;
- `zone_motion: phone_zone`;
- `direction: phone_zone -> off_desk_zone`.

Fallback:

- use motion burst plus off-desk direction proxy when hand landmarks are unavailable.

### notebook_opened

Required:

- current step is notebook;
- hand activity in `notebook_zone`;
- dwell/motion pattern consistent with opening.

Evidence:

- hand overlap or motion dwell in `notebook_zone`;
- burst followed by short stabilization.

### pen_picked_up

Required:

- current step is pen;
- hand enters `pen_zone`;
- hand leaves `pen_zone` toward `notebook_zone`.

Evidence:

- `hand_zone_overlap: pen_zone`;
- transition from `pen_zone` to `notebook_zone`;
- motion burst in pen zone.

Fallback:

- pen-zone burst plus nearby notebook/neutral motion.

### writing_motion

Required:

- current step is writing;
- hand in `notebook_zone`;
- repeated small lateral motion.

Evidence:

- hand velocity in notebook zone;
- repeated low-amplitude motion;
- dwell in notebook zone.

### typing_motion

Required:

- current step is typing;
- one or two hands in `keyboard_zone`;
- repeated small high-frequency motion.

Evidence:

- hand overlap in keyboard zone;
- repeated burst pattern;
- dwell in keyboard zone.

### uncertain

Triggers:

- low confidence;
- excessive scene motion;
- camera occlusion;
- scene reset risk;
- conflicting hand and motion evidence.

Behavior:

- show uncertainty instead of a forced action;
- pause unsafe progression;
- require confirmation, correction, reset, or recalibration.

## Implementation Order

1. Extract or wrap existing motion proxy into `zone-motion-engine`.
2. Add `LocalPerceptionFrame` builder.
3. Add action scorer with current-step gating.
4. Add confidence smoother and cooldown manager.
5. Add MediaPipe hand engine behind capability check.
6. Add zone overlap engine.
7. Wire Detected Action card through adapter without UI redesign.
8. Add hidden diagnostics adapter.
9. Add synthetic scorer tests.
10. Add physical benchmark protocol.

## Cost And Latency Guardrails

- No model/VLM calls in hot path.
- No cloud frame upload.
- No raw media persistence.
- MediaPipe runs locally only.
- UI updates remain throttled and stable.

