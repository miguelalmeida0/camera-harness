# Gate 4A Agent Handoff

## To Multimodal

Implement the local perception/action engine:

- use MediaPipe Tasks Web Hand Landmarker if feasible;
- keep motion proxy fallback;
- emit `LocalPerceptionFrame`;
- infer `DetectedActionCandidate`;
- keep candidates current-step-aware;
- add or preserve the Detected Action card;
- keep Confirm / Not this visible;
- hide trace campaign from main UX;
- preserve zero cloud/model/raw-media behavior.

Do not:

- add cloud frame upload;
- add VLM/LLM calls to the camera hot path;
- persist raw media;
- auto-complete steps;
- claim autonomous vision.

## To Harness

Create Gate 4A evals that validate:

- local perception contract shape;
- detected action candidate contract shape;
- no raw media persistence;
- no model/VLM calls;
- current-step suggestion filtering;
- confirmation required before progress;
- rejection does not progress;
- uncertainty pauses unsafe progression;
- default UI hides developer trace campaign.

Gate 3B-Live remains internal QA. It must not be treated as the product workflow.

## Shared Invariants

- Camera frames are transient.
- Symbolic observations are replayable.
- Quest reducer remains the progress authority.
- Detected actions require confirmation.
- Export/validation remains hidden or compact, not the main experience.

