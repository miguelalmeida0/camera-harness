# Gate 1A Report Template

Gate 1A reports are written to:

```text
runs/gate-1a-latest.json
```

## Required Shape

```json
{
  "schema": "darkquest.gate_1a_report.v0",
  "run_id": "",
  "build_hash": "",
  "manifest_path": "fixtures/replay/gate_1a_manifest.json",
  "gate": "1A",
  "fixture_count": 0,
  "missing_fixture_count": 0,
  "required_fixture_count": 0,
  "recommended_fixture_count": 0,
  "adversarial_fixture_count": 0,
  "missing_fixtures": [],
  "schema_validation_result": {},
  "event_validation_result": {},
  "replay_result": {},
  "deterministic_repeat_result": {},
  "raw_media_check": {},
  "model_call_check": {},
  "memory_policy_check": {},
  "hud_honesty_check": {},
  "exact_failure_code_matching_result": {},
  "cost_result": {
    "observed_llm_calls": 0,
    "observed_vlm_calls": 0,
    "observed_cost_usd": 0,
    "raw_media_persistence_count": 0
  },
  "latency_result": {
    "replay_runtime_ms": 0,
    "p50_latency_ms": null,
    "p95_latency_ms": null
  },
  "deterministic_hashes": [],
  "known_limitations": [],
  "results": [],
  "final_verdict": "BLOCKED_MISSING_LIVE_TRACE"
}
```

## Per-Fixture Result

Each fixture result must include:

- fixture path
- resolved path
- category: `required`, `recommended`, or `adversarial`
- status: `evaluated`, `missing_required`, `missing_recommended`, or `missing_adversarial`
- expected result
- actual result
- expected failure codes
- actual failure codes
- exact failure-code matching result
- replay result
- deterministic hashes
- raw media check
- model-call check
- memory policy check
- HUD honesty check
- cost/latency result

## Final Verdicts

Allowed verdicts:

- `BLOCKED_MISSING_LIVE_TRACE`
- `FAIL`
- `PASS_WITH_DISCLOSURE`
- `PASS`
