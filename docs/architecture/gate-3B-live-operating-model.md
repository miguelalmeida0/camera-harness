# Gate 3B-Live Operating Model

Gate 3B-Live validates live physical suggestion traces. It does not approve auto-completion, autonomous vision, object recognition, production perception, model/VLM paths, raw media persistence, or suggestion-only quest progress.

## Roles

Multimodal Perception & Interface Researcher produces physical suggestion traces from the local camera suggestion UI. They must preserve accept/reject metadata, confirmation gating, and zero raw media/model calls.

Harness, Evaluation, Memory & Safety Researcher validates physical suggestion traces through `npm run gate:3b:live`, replay repeat checks, privacy/model scans, and precision scaffolding.

Systems Research Architect owns the boundary: Gate 3B-Live measures confirmation-bound suggestions and keeps Gate 3C locked.

## Required Artifacts

Required physical suggestion traces:

- `fixtures/replay/live/suggestions/live_suggestion_phone_moved_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_notebook_opened_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_pen_picked_up_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_writing_motion_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_typing_motion_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_reject_does_not_progress_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_uncertain_scene_001.v0.json`
- `fixtures/replay/live/suggestions/live_suggestion_full_focus_ritual_001.v0.json`

## Required Metadata

Each trace must include `suggestion_summary` with generated, accepted, rejected, suggestion type, auto-completion, model-call, VLM-call, and raw-media counts.

Required zero values:

- `auto_completed_steps: 0`
- `llm_calls: 0`
- `vlm_calls: 0`
- `raw_media_persistence: 0`

## Required Commands

- `npm run gate:3b`
- `npm run gate:3b:live`
- `npm run physical:validate`
- `npm run gate:1c`
- `npm run suggestions:report` if implemented

## Missing Trace Handling

Missing required traces produce `BLOCKED_MISSING_SUGGESTION_TRACES`.

This is not a product failure and not permission to fake fixtures. Multimodal must export real physical suggestion traces; Harness must keep the gate blocked until they exist.

## Failed Trace Handling

Failed traces must be classified by failure code:

- missing or invalid metadata;
- missing `human_correction`;
- rejected suggestion progressed quest;
- suggestion-only event completed quest;
- future-step bypass;
- raw media persistence;
- model/VLM call;
- autonomous claim.

Failures block Gate 3B-Live until fixed in trace generation, schema validation, or harness checks.

## Outcome Interpretation

Accepted suggestions mean the operator confirmed a camera suggestion and the accepted event followed the normal symbolic event path.

Rejected suggestions mean the operator declined the suggestion and no quest progress occurred.

Expired, uncertain, low-confidence, or suppressed suggestions may support precision measurement. They do not support quest progress.

## Why Gate 3C Remains Locked

Gate 3B-Live proves replayability and measurement readiness for confirmation-bound suggestions. It does not prove auto-completion safety. Gate 3C remains locked until sufficient attempts, false positives, false negatives, uncertainty behavior, and adversarial auto-completion evals exist and the user explicitly approves exploration.
