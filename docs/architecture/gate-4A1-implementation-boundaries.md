# Gate 4A.1 Implementation Boundaries

## Decision

Gate 4A.1 may strengthen local perception and action inference, but it must not weaken privacy, confirmation, or the frozen UI design.

## Non-Negotiable Rules

- Detected action is a candidate only.
- Confirmation is required.
- Rejection does not progress.
- Low confidence must not dominate the UI.
- Uncertainty pauses unsafe progression.
- No raw media persistence.
- No screenshots, base64 frames, OCR, audio, or raw video storage.
- No cloud frame upload.
- No LLM/VLM hot path.
- No auto-completion.
- No UI redesign.
- Developer Tools stay hidden by default.

## Product Boundary

Allowed product behavior:

- local camera movement tracking;
- possible action suggestion;
- Confirm;
- Not this / Correct;
- progress update after confirmation.

Blocked product behavior:

- autonomous vision claims;
- object detection proof claims;
- gesture recognition proof claims;
- production/demo/portfolio readiness claims;
- trace campaign as main UX;
- blind action completion.

## Engine Boundary

Allowed engine work:

- MediaPipe hand tracking if feasible;
- local motion proxy fallback;
- hand-zone overlap;
- current-step-aware action scoring;
- confidence smoothing;
- rejection cooldowns;
- hidden diagnostics.

Blocked engine work:

- cloud/VLM frame analysis;
- raw frame export;
- persistent image buffers;
- LLM routing for camera actions;
- auto-completion from confidence alone.

## UI Boundary

The approved UI is frozen. Implementation may wire data into existing hooks but must not change:

- layout;
- spacing;
- colors;
- typography;
- card structure;
- visual hierarchy;
- responsive design;
- visible UI structure.

## QA Boundary

Trace export, suggestion trace campaign, validation logs, reports, and diagnostics are internal QA. They must remain under closed Advanced / Developer Tools.

