# Mirrored Camera Policy

## Decision

Camera preview is mirrored by default for user comfort.

Mirroring is visual/product behavior. It is not raw media persistence, frame storage, or a change to provider privacy rules.

## Default

- Mirror preview: on.
- Hidden/debug toggle may exist only if needed.
- Default must remain mirrored on.

## Analysis Frames

Analysis frames should match what the user sees when feasible. If implementation cannot mirror the submitted short frame window safely, the prompt must avoid body-side identity and use frame-relative language.

Preferred language:

- `left side of the frame`;
- `right side of the frame`;
- `near the camera`;
- `toward the top of the frame`;
- `closer to the camera`.

Avoid:

- claiming the user's left hand;
- claiming the user's right hand;
- body-side identity when mirroring or camera orientation could make it ambiguous.

## Privacy Boundary

- Mirroring does not permit raw frame persistence.
- Mirroring does not permit screenshots or base64 storage.
- Mirroring does not expose `HF_TOKEN`.
- Mirroring does not enable continuous calls.

## QA Checks

Harness should verify:

- preview is mirrored by default;
- mirror toggle is hidden/debug-only if present;
- provider prompt prefers frame-relative wording;
- no raw-media persistence is introduced.

