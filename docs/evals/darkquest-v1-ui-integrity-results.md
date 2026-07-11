# DarkQuest v1 UI Integrity Results

## Claim

DarkQuest keeps recipe identity internal, commits recipe edits transactionally, and preserves the frozen Camera -> Describe -> Result product flow across supported mobile, tablet, and desktop viewports.

## Recipe Identity

- PASS: new recipes receive a schema-valid secure UUID before validation.
- PASS: same-name recipes receive different IDs; duplicate supplied IDs are rejected.
- PASS: edits preserve identity and users never receive an editable recipe-ID field.

## Migration

- PASS: legacy recipes without IDs are assigned unique IDs without losing valid recipes.
- PASS: instant timing normalizes to `confirmation_policy: none` and `require_per_run_confirmation: false`.

## Transactional Persistence

- PASS: invalid creates and edits perform zero storage writes and preserve the in-memory list.
- PASS: storage write failure cannot commit the next in-memory document.
- PASS: modal validation preserves draft values and the existing recipe; successful retry updates the list and closes the dialog.

## Conditional Form

- PASS: phrase, notification, timer, counter, activity, snapshot, and webhook actions expose only relevant action fields.
- PASS: webhook secret-reference fields are disabled and cleared outside webhook mode.
- PASS: gesture changes clear aliases; instant mode hides and disables after-confirm policy.

## Responsive Viewports

Headless Chrome checked `390x844`, `412x915`, `768x1024`, `1024x768`, and `1440x900`.

- PASS: `scrollWidth === innerWidth` at every viewport.
- PASS: zero container escapes, text escapes, or pathological one-character wrapping.
- PASS: expected mobile/tablet stacking and desktop two-column composition.
- PASS: camera, result, buttons, dialog, Save, and Cancel remain reachable.

## Mobile Complete Flow

- PASS: mocked camera -> movement result -> Confirm -> Automate -> thumbs up -> Speak phrase -> `GREAT JOB` -> Instant -> Save -> reopen -> edit -> close.
- PASS: generated ID remained stable and absent from visible text.
- PASS: maximum horizontal overflow was `0px` throughout the flow.

## Resize State

- PASS: orientation change preserved camera state, movement result, unsaved draft, Instant gestures, and recipe count.
- PASS: receipt count and result-animation count did not change during resize.

## Desktop Freeze

- PASS: Camera -> Describe -> Result hierarchy, result-card stability, design tokens, and secondary collapsed automation placement remain unchanged.

## Privacy And Security

- PASS: no raw frames, screenshots, base64, tokens, or secrets entered recipe persistence or browser evidence.
- PASS: webhook secrets remain server references only; frontend exposes no `HF_TOKEN`.
- PASS: favicon returned HTTP 200; app runtime, console, and network error lists were empty.

## Verdict

`PASS_WITH_DISCLOSURE` (`68/68`). The responsive run uses a safe mocked camera and mocked movement-recognition response; physical camera rendering and OS-level accessibility still require device review.
