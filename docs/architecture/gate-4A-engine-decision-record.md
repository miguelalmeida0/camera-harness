# Gate 4A Engine Decision Record

## Decision

Gate 4A uses a local-first perception and inference stack:

- Primary: MediaPipe Tasks Web Hand Landmarker, if feasible.
- Fallback and complementary signal: local browser frame differencing.
- Action inference: deterministic current-step-aware state machine and scorers.
- Product output: one confirmation-gated `DetectedActionCandidate`.

## Why This Engine

The real-time camera loop must be local because the product handles live user workspace imagery. The engine must preserve privacy, keep cost near zero, minimize latency, and remain debuggable through symbolic observations.

MediaPipe Tasks Web is appropriate because it can produce hand landmarks in-browser. Frame differencing remains necessary because it is already available, cheap, and useful when landmarks are unavailable or incomplete.

The deterministic state machine is safer than LLM routing for action detection because it:

- respects current ritual step order;
- is replayable;
- has clear failure modes;
- avoids hidden reasoning;
- does not introduce cloud cost;
- cannot invent perception claims.

## Chosen Engines

Primary:

- MediaPipe Tasks Web / Hand Landmarker for local hand landmarks if feasible.
- Browser-local frame differencing for zone motion, dwell, direction, and fallback operation.
- Deterministic action inference state machine.

Secondary or later:

- ONNX Runtime Web plus WebGPU for small local classifiers.
- Optional local classifiers only after Gate 4A heuristics are measured.

Explicitly excluded from the camera hot path:

- LangChain;
- LangGraph;
- Cerebras;
- Groq;
- Gemini;
- OpenAI;
- any VLM or cloud model call.

## Optional Cloud Later

Cloud or LLM use may be considered only outside real-time perception:

- post-session summary;
- coaching;
- explanation;
- non-camera planning.

Cloud later must not receive raw frames, screenshots, audio, OCR, or raw video. It must not drive real-time action detection.

## Failure Modes

- MediaPipe unsupported or too slow on device.
- Landmarks unstable under occlusion or poor lighting.
- Motion proxy fires on background movement.
- Current-step scorer suppresses a valid but early action.
- Confidence flicker causes UI churn.

Mitigations:

- keep motion proxy fallback;
- smooth confidence and dwell windows;
- use cooldowns after rejection;
- surface uncertainty;
- preserve manual correction.

## Cost And Latency

- Cloud model cost remains zero in the hot path.
- MediaPipe adds local compute but no API cost.
- Frame differencing remains near-zero cost.
- UI updates should be throttled to keep click targets stable.

## Rejected Alternatives

Cloud VLM hot path:
- rejected for privacy, cost, latency, and non-determinism.

LLM/agent action router:
- rejected because action detection is a sparse local perception problem, not a language-planning problem.

Trace campaign as product workflow:
- rejected because it is QA tooling, not the user experience.

Auto-completion:
- blocked until Gate 4B requirements are met.

