# Suggestion Trace Metadata v0

Gate 3B-Live physical suggestion traces may include summary metadata for replay and later precision measurement.

## Shape

```json
{
  "suggestion_summary": {
    "suggestions_generated": 0,
    "suggestions_accepted": 0,
    "suggestions_rejected": 0,
    "suggestion_types": [],
    "auto_completed_steps": 0,
    "llm_calls": 0,
    "vlm_calls": 0,
    "raw_media_persistence": 0
  }
}
```

## Required Fields

- `suggestions_generated`
- `suggestions_accepted`
- `suggestions_rejected`
- `suggestion_types`
- `auto_completed_steps`
- `llm_calls`
- `vlm_calls`
- `raw_media_persistence`

## Allowed Values

- `suggestions_generated`: integer `>= 0`
- `suggestions_accepted`: integer `>= 0`
- `suggestions_rejected`: integer `>= 0`
- `suggestion_types`: array of symbolic suggestion type strings
- `auto_completed_steps`: integer `0`
- `llm_calls`: integer `0`
- `vlm_calls`: integer `0`
- `raw_media_persistence`: integer `0`

Allowed `suggestion_types` should describe symbolic suggestions, such as:

- `phone_moved_suggestion`
- `notebook_opened_suggestion`
- `pen_picked_up_suggestion`
- `writing_motion_suggestion`
- `typing_motion_suggestion`
- `uncertainty_suggestion`
- `reset_suggestion`

## Forbidden Values

- negative counts;
- non-integer counts;
- `suggestions_accepted` greater than `suggestions_generated`;
- `suggestions_rejected` greater than `suggestions_generated`;
- `auto_completed_steps` greater than `0`;
- `llm_calls` greater than `0`;
- `vlm_calls` greater than `0`;
- `raw_media_persistence` greater than `0`;
- suggestion types that claim object recognition, autonomous vision, cloud vision, or production perception.

## Evidence Requirements

Each accepted suggestion must be traceable to:

- local motion-proxy evidence;
- camera suggestion evidence;
- user acceptance evidence;
- `human_correction` evidence.

Each rejected suggestion must be traceable to:

- local motion-proxy evidence;
- camera suggestion evidence;
- user rejection evidence.

Suggestion-only records must not be treated as quest-progressing evidence.

## Privacy Requirements

Suggestion traces and metadata must not include:

- raw webcam frames;
- screenshots;
- base64 images;
- raw audio;
- OCR/notebook text;
- API keys;
- model responses;
- cloud evidence.

## Replay Expectations

Replay must verify:

- metadata fields exist and use allowed values;
- accepted and rejected counts match replayed suggestion records where available;
- accepted suggestions require `human_correction` evidence before symbolic event emission;
- rejected suggestions do not progress quest;
- suggestion-only records do not complete quest;
- `auto_completed_steps`, `llm_calls`, `vlm_calls`, and `raw_media_persistence` remain `0`.
