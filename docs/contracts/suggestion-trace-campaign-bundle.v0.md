# Suggestion Trace Campaign Bundle v0

Campaign bundles are optional. Individual files remain canonical for Gate 3B-Live.

## Shape

```json
{
  "schema": "darkquest.suggestion_trace_campaign_bundle.v0",
  "created_by": "browser-local-capture",
  "physical_capture": true,
  "operator_confirmed_physical_session": true,
  "raw_media_persisted": false,
  "llm_calls": 0,
  "vlm_calls": 0,
  "auto_completed_steps": 0,
  "traces": {
    "live_suggestion_phone_moved_001.v0.json": {},
    "live_suggestion_notebook_opened_001.v0.json": {}
  },
  "campaign_summary": {}
}
```

## Rules

- Bundle is optional.
- Individual files are canonical for Gate 3B-Live.
- Bundle cannot bypass safety checks.
- Dev dry-runs cannot satisfy physical traces.
- Raw media/model calls reject bundle.
- `physical_capture` and operator confirmation are required before splitting.

## Required Safety Values

- `created_by: "browser-local-capture"`
- `physical_capture: true`
- `operator_confirmed_physical_session: true`
- `raw_media_persisted: false`
- `llm_calls: 0`
- `vlm_calls: 0`
- `auto_completed_steps: 0`

## Trace Requirements

Each bundled trace must satisfy `docs/contracts/physical-suggestion-trace-artifact.v0.md`.

Accepted suggestions must include confirmation evidence. Rejected suggestions must not progress quest. Suggestion-only records must not complete quest.

## Splitting Requirements

Bundle splitting, if implemented, must validate the bundle before writing individual trace files.

Split output must preserve trace content exactly enough for replay-compatible validation. Splitting cannot create, infer, repair, or synthesize missing physical evidence.
