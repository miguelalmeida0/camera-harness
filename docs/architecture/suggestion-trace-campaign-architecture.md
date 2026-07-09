# Suggestion Trace Campaign Architecture

Campaign mode is a capture workflow only. It does not approve auto-completion or autonomous vision.

## Purpose

Suggestion Trace Campaign Mode helps an operator capture the eight physical suggestion traces required by Gate 3B-Live.

It exists to make trace capture orderly, repeatable, and harder to mis-save. It does not change the suggestion lifecycle, quest reducer, privacy model, or confirmation boundary.

## Relationship To Gate 3B-Live

Gate 3B-Live remains `BLOCKED_MISSING_SUGGESTION_TRACES` until the required physical suggestion traces exist and validate.

Campaign mode can produce those artifacts. Gate 3B-Live validates them.

## Individual Trace Export Path

Individual files are canonical for Gate 3B-Live:

- `fixtures/replay/live/suggestions/live_suggestion_phone_moved_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_notebook_opened_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_pen_picked_up_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_writing_motion_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_typing_motion_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_reject_does_not_progress_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_uncertain_scene_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_full_focus_ritual_001.v0.json`

## Optional Campaign Bundle Path

An optional campaign bundle may group captured traces for transport or operator convenience.

The bundle is not canonical. It cannot bypass individual trace validation, replay, privacy checks, model-call checks, or confirmation gating.

## Bundle Validation

Bundle validation must reject:

- non-physical capture;
- missing operator physical-session confirmation;
- raw media persistence;
- LLM/VLM calls;
- auto-completed steps;
- missing trace metadata;
- traces that are not replay-compatible.

## Bundle Splitting

If bundle splitting is implemented, the splitter may write individual files to the canonical paths only after bundle validation confirms physical capture, operator confirmation, zero raw media, zero model calls, and zero auto-completed steps.

## Operator Responsibilities

- Use the physical camera workflow.
- Select Suggestion Trace Campaign mode.
- Capture each required trace.
- Accept only matching suggestions.
- Reject mismatched suggestions.
- Preserve manual confirmation and accept/reject metadata.
- Save individual files to the canonical paths.
- Do not fake traces.

## Harness Responsibilities

- Validate individual traces.
- Validate bundles if implemented.
- Split bundles only after safety checks if implemented.
- Produce clear missing-trace reports.
- Keep Gate 3C locked.

## Success

Success means all eight required physical suggestion traces exist, replay deterministically, preserve accept/reject evidence, keep `auto_completed_steps: 0`, keep raw media persistence at `0`, and keep LLM/VLM calls at `0`.

## Still Blocked

- Gate 3C.
- Auto-completion.
- Autonomous vision claims.
- Object detection claims.
- Production perception.
- Cinematic demo work.
- Model/VLM paths.
- Raw media persistence.
