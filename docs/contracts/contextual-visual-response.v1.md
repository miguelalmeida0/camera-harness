# contextual-visual-response.v1

`contextual-visual-response.v1` is the structured response returned by the local visual companion.

Required fields:
- `schema_version`: `contextual-visual-response.v1`
- `response_type`: `narrate`, `ask`, `assist`, `uncertain`, or `silent`
- `observation_summary`: text-only summary
- `spoken_response`: the only text eligible for speech
- `confidence`: `0..1`
- `uncertainty`: boolean
- `question`: optional clarifying question
- `suggested_actions`: allowlisted, confirmation-required actions
- `evidence`: short text-only evidence strings
- `policy_decision`: final deterministic frontend/server policy result
- `provider`: `local_visual_companion`
- `model`
- `model_revision`
- `device`
- `latency_ms`
- `time_to_first_token_ms`
- `time_to_first_audio_ms`
- `contains_raw_media`: always `false`

Malformed model output normalizes to an uncertain response:
`I'm not sure what changed. Try showing me again.`
