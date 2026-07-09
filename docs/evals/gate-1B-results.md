# Gate 1B Results

## 1. Claim Being Tested

Real browser-local camera observation frames can produce symbolic-only Focus Ritual traces that replay deterministically through the DarkQuest harness, including occlusion recovery and camera bump reset, with zero raw media persistence, zero LLM/VLM calls, honest HUD state, exact adversarial failure codes, and browser-local latency records.

## 2. Test Or Benchmark Design

Commands executed:

```sh
node --check packages/evals/bin/darkquest-eval.mjs
node packages/evals/bin/darkquest-eval.mjs replay --repeat 3 fixtures/replay/focus_ritual_happy_path.v0.json
node packages/evals/bin/darkquest-eval.mjs gate-0b fixtures/replay/gate_0b_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1a fixtures/replay/gate_1a_manifest.json
node packages/evals/bin/darkquest-eval.mjs gate-1b fixtures/replay/gate_1b_manifest.json
```

Gate 1B uses `fixtures/replay/gate_1b_manifest.json` and writes `runs/gate-1b-latest.json`.

## 3. Pass/Fail Criteria

Gate 1B requires:

- `fixtures/replay/live/live_browser_focus_ritual_001.v0.json`
- `fixtures/replay/live/live_occlusion_recovery_001.v0.json`
- `fixtures/replay/live/live_camera_bump_reset_001.v0.json`
- top-level `trace_origin.source == "browser.local_camera"`
- top-level `trace_origin.raw_media_persisted == false`
- top-level `trace_origin.cloud_calls_enabled == false`
- top-level `trace_origin.manual_fixture == false`
- browser latency records present and within p50/p95/max thresholds
- adversarial fixtures fail with exact expected codes
- zero raw media persistence and zero LLM/VLM calls

## 4. Evidence Required

Evidence artifacts:

- `runs/latest.json`
- `runs/gate-0b-latest.json`
- `runs/gate-1a-latest.json`
- `runs/gate-1b-latest.json`
- `fixtures/replay/gate_1b_manifest.json`
- `fixtures/replay/live/live_browser_focus_ritual_001.v0.json`
- `fixtures/replay/live/live_occlusion_recovery_001.v0.json`
- `fixtures/replay/live/live_camera_bump_reset_001.v0.json`
- Gate 1B adversarial fixtures under `fixtures/replay/live/adversarial/`

## 5. Cost/Latency Metrics

Evaluated acceptance fixtures report:

- LLM calls: `0`
- VLM calls: `0`
- estimated model cost: `$0`
- raw media persistence count: `0`

Browser latency observed for `live_browser_focus_ritual_001`:

- p50: `45ms`
- p95: `51ms`
- max: `51ms`
- sample count: `13`
- dropped frames: `0`

Static validation status:

- `node --check packages/evals/bin/darkquest-eval.mjs`: PASS
- TypeScript compile: disclosed, not executed because local TypeScript runtimes are not installed in the package directories.

## 6. Memory/Security Implications

No evaluated passing fixture persists raw video, raw frames, screenshots, audio, OCR, notebook text, or cloud-derived evidence.

Gate 1B still carries a static-validation disclosure: replay proves symbolic behavior, but package-local TypeScript builds have not been executed in this workspace.

## 7. Result

Current verdict: `PASS_WITH_DISCLOSURE`.

Latest command results:

- Happy replay: PASS
- Gate 0B: PASS
- Gate 1A: PASS
- Gate 1B: `PASS_WITH_DISCLOSURE`

Gate 1B evaluated 19 manifest entries:

- 3 required fixtures passed
- 1 recommended fixture passed
- 15 adversarial fixtures failed with exact expected codes
- 0 missing fixtures

The only remaining Gate 1B disclosure is static validation: TypeScript compile was not executed because local TypeScript runtime dependencies are absent.

## 8. Required Fix Or Approval Gate

Gate 1B replay, privacy, model-call, recovery, and browser-latency checks are accepted.

Full `PASS` requires either:

1. install package-local dependencies and run TypeScript builds for the live perception, browser capture, trace recorder, and stabilizer packages; or
2. explicitly accept `PASS_WITH_DISCLOSURE` as sufficient for the next non-production demo step.

No release-safe or portfolio-grade demo claim should omit the TypeScript/static-validation disclosure.

## Handoff To Multimodal Perception And Interface Researcher

```json
{
  "schema": "darkquest.agent_handoff.v1",
  "from_agent": "GAUNTLET",
  "to_agent": "Multimodal Perception & Interface Researcher",
  "decision": "Gate 1B replay and browser-latency checks pass with static-validation disclosure.",
  "evidence": [
    "runs/gate-1b-latest.json",
    "fixtures/replay/live/live_browser_focus_ritual_001.v0.json",
    "fixtures/replay/live/live_occlusion_recovery_001.v0.json",
    "fixtures/replay/live/live_camera_bump_reset_001.v0.json",
    "docs/evals/gate-1B-browser-latency-thresholds.md"
  ],
  "open_risks": [
    "TypeScript builds have not run because local TypeScript runtimes are not installed.",
    "Any cinematic HUD work must remain state-backed and must not hide uncertainty or imply cloud fallback.",
    "Future browser trace exports must preserve top-level trace_origin and symbolic-only evidence."
  ],
  "required_ecc_skills": [
    "autonomous-agent-harness",
    "agent-eval",
    "security-review",
    "cost-tracking"
  ],
  "acceptance_gate": {
    "metric": "Gate 1B final_verdict",
    "threshold": "PASS, or PASS_WITH_DISCLOSURE only if TypeScript compile disclosure is explicitly accepted",
    "judge": "replay"
  },
  "next_action": "Proceed only with HUD/debug work that consumes replay-backed symbolic state and keep TypeScript disclosure visible until builds run."
}
```

## Handoff To Systems Research Architect

```json
{
  "schema": "darkquest.agent_handoff.v1",
  "from_agent": "GAUNTLET",
  "to_agent": "Systems Research Architect",
  "decision": "Replay-first Gate 1B architecture is functioning, but package static validation remains disclosed.",
  "evidence": [
    "runs/gate-1b-latest.json",
    "docs/architecture/gate-1B-agent-handoff.md",
    "docs/architecture/gate-1B-package-boundaries.md",
    "packages/evals/bin/darkquest-eval.mjs"
  ],
  "open_risks": [
    "Package-local TypeScript compile is disclosed but not executed.",
    "Browser capture and perception package boundaries need build-backed validation before full demo-safe approval.",
    "Future HUD work must consume replay/state outputs only and must not mutate quest truth."
  ],
  "required_ecc_skills": [
    "agent-architecture-audit",
    "ai-regression-testing",
    "security-review",
    "recursive-decision-ledger"
  ],
  "acceptance_gate": {
    "metric": "Static validation disclosure",
    "threshold": "TypeScript builds pass, or disclosure is accepted in an ADR before demo claims",
    "judge": "test"
  },
  "next_action": "Install package dependencies or document the TypeScript compile disclosure as an accepted Gate 1B limitation."
}
```
