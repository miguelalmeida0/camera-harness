# DarkQuest v1.3 Custom Skills Results

## Current verdict

`PASS_WITH_DISCLOSURE`

Deterministic implementation proof passes. Physical webcam evidence has not been collected, so this gate cannot return `PASS`.

## Schema

The executable suite verifies internal unique IDs, the v1 schema shape, bounded name/type/hand-count fields, duplicate rejection, finite consistent template dimensions, raw-media rejection, secret rejection, unsafe-code/URL rejection, and atomic template deletion.

## Trainer

Five positive examples are required. Wrong hand count, unstable hold, jitter, incomplete landmarks, short hold, duplicate examples, and inconsistent examples are rejected. Optional negative examples and deterministic threshold calibration pass.

## Privacy

Stored training data contains normalized finite numerical templates and bounded metadata only. The suite and source gate find no frame/image/video/base64 persistence, provider token, VLM call, or network path in training/classification. `contains_raw_media` remains false.

## Classifier

Positive Heart matching, open-hand rejection, prayer-hand rejection, one-hand partial rejection, below-threshold rejection, ambiguity, disabled skills, stopped camera, hidden tab, and mirrored Heart behavior pass.

## Two-hand Heart

Deterministic two-hand Heart examples train and classify. Open, prayer, random, partial, and mirrored fixtures exercise the same local normalizer and classifier used by the browser runtime.

## Runtime automation

The shared stabilizer emits one custom-skill event per held pose. Continued hold does not duplicate. Neutral reset plus cooldown permits a second unique event. The canonical instant automation runner speaks `Heart detected` exactly twice across two armed poses, with zero Confirm, provider, VLM, or network calls and one receipt per execution.

## UI

The six-step custom gesture wizard exposes name, one/two-hand selection, five-example progress, rejection status, live test, action selection, save, retrain, disable, and delete. A deterministic state-flow opens the real editor, advances through the two-hand Heart path, and commits one skill plus one linked recipe transactionally. It remains secondary inside the existing automation panel and preserves the frozen Camera -> Describe -> Movement Result hierarchy. Responsive containment markers are present.

## Physical evidence

Not run. Follow `docs/evals/darkquest-v1-3-custom-skill-physical-protocol.md` without recording video. A valid symbolic artifact at `runs/custom-skills-physical-latest.json` is required for `PASS`.

## Gate result

- Behavior checks: `43/43`
- Total gate checks: `66/67`
- Only disclosure item: `physical_heart_protocol`
- Final verdict: `PASS_WITH_DISCLOSURE`
