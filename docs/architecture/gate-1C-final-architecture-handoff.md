# Gate 1C Final Architecture Handoff

Current status: `BLOCKED_MISSING_PHYSICAL_TRACE`.

## Missing Artifact

Required fixture:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

This artifact must come from an operator-confirmed physical browser webcam Focus Ritual session. Browser-origin synthetic traces do not satisfy Gate 1C.

## Operator Path

```sh
npm run physical:capture
npm run physical:validate
npm run gate:1c
```

The operator must save the downloaded replay fixture to:

```text
fixtures/replay/live/live_physical_focus_ritual_001.v0.json
```

## Anti-Fraud Requirements

The physical fixture must include:

```json
{
  "source": "browser.local_camera",
  "generated_by": "browser-local-capture",
  "capture_mode": "physical_webcam_manual_calibration",
  "physical_capture": true,
  "operator_confirmed_physical_session": true,
  "manual_fixture": false,
  "raw_media_persisted": false,
  "cloud_calls_enabled": false,
  "browser_latency_recorded": true
}
```

The harness must reject missing provenance, wrong generator, wrong capture mode, manual fixtures, missing latency records, raw media persistence, model calls, and browser-origin synthetic substitution.

## Validation Commands

```sh
node --check packages/evals/bin/darkquest-eval.mjs
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/focus_ritual_happy_path.v0.json
node packages/evals/bin/darkquest-eval.mjs gate-0b fixtures/replay/gate_0b_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1a fixtures/replay/gate_1a_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1b fixtures/replay/gate_1b_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1c fixtures/replay/gate_1c_manifest.json
npm run typecheck
```

Expected current Gate 1C result:

```text
BLOCKED_MISSING_PHYSICAL_TRACE
```

## Gate 2 Lock

Gate 2 minimal HUD polish is blocked until:

- physical trace exists;
- physical trace replays deterministically;
- Gate 1C returns `PASS` or accepted `PASS_WITH_DISCLOSURE`;
- privacy, model, memory, latency, and HUD honesty checks pass;
- raw media persistence count is `0`;
- LLM/VLM calls are `0`;
- static validation passes or waiver is explicitly accepted.

Cinematic HUD polish remains blocked.

## Handoff To Multimodal Perception & Interface Researcher

Produce the physical symbolic observation trace using the local browser capture flow. Do not persist raw media. Do not use cloud or model calls. Do not hand-author or rename a browser-origin fixture.

## Handoff To Harness, Evaluation, Memory & Safety Researcher

Validate the physical fixture, replay it 3 times, run Gate 1C, verify adversarial exact failure codes, inspect memory/privacy/model/HUD results, and confirm whether static validation passes or requires an accepted waiver.
