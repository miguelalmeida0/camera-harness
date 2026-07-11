# DarkQuest v2 Visual Companion Results

Current verdict: `BLOCKED_MISSING_REAL_MODEL`

Latest gate: `npm run gate:v2:visual-companion`

Result: `46/49` checks passed.

What is verified:
- Provider contract harness exists with `health`, `load`, `observe`, `synthesize`, `cancel`, `metrics`, and `unload`.
- Observation windows are bounded, ordered, and raw-media-free at the contract layer.
- Contextual visual responses normalize required fields and reject unsafe/private claims.
- Response policy separates `narrate`, `ask`, `assist`, `uncertain`, and `silence`.
- Suggested actions cannot execute directly from model text.
- TTS has local Kokoro and browser fallback contract paths.
- Memory is text-only and clearable.
- Scenario dataset contains at least 50 symbolic cases with provenance and no media.
- Benchmark command records unavailable models instead of faking scores.

What remains disclosed:
- The visible default product now uses `Observe now`, but the result surface still uses legacy `Movement Result` language instead of the v2 `Contextual response` label.
- Scenario metrics are synthetic contract metrics until a real model produces outputs.
- Physical webcam proof is not present.

Blocked:
- At least one real open-source visual model must be evaluated and recorded in `runs/visual-model-benchmark-latest.json`.
- Physical evidence must be recorded as `runs/darkquest-v2-physical-visual-companion-latest.json`.

Required next evidence:
- Run a real local/open-source model against the scenario dataset.
- Collect the physical protocol artifact with no retained media.
- Wire or verify the actual v2 UI path once Multimodal moves the product from Movement Narrator to Visual Companion.
