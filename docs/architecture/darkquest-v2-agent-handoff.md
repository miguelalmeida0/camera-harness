# DarkQuest v2 Agent Handoff

## Multimodal Ownership

- Implement hardware detection before model selection.
- Build the local/self-hosted visual provider registry.
- Implement at least one real open-model visual provider.
- Keep paid inference APIs out of the production path.
- Build the one-shot `Observe now` frontend flow.
- Capture 4-8 transient frames over 2-4 seconds.
- Enforce frame deletion after inference, cancellation, timeout, and error.
- Implement local/open TTS with Kokoro first and browser speech fallback.
- Surface runtime telemetry without raw media or token leakage.
- Preserve the frozen visual design while changing the product flow.

## Harness Ownership

- Add schema tests for `visual-observation-window.v1`.
- Add schema tests for `contextual-visual-response.v1`.
- Add provider contract tests for `visual-companion-provider.v1`.
- Add privacy verification: no raw frames in memory records, receipts, logs, analytics, or automation payloads.
- Add cost verification: no paid hosted inference route in production path.
- Add scenario evaluation set: object shown, object moved, exercise-prep scene, ambiguous scene, no meaningful change, sensitive inference trap, unsafe action suggestion.
- Add local model benchmark with hardware, latency, load time, failure rate, and response validity.
- Add UI boundary checks: no raw JSON, prompts, tokens, frames, old gate language, or gesture grid as default experience.

## Systems Ownership

- Keep contracts consistent across visual observation, response policy, provider interface, memory, and automation bridge.
- Maintain model/runtime decision records as hardware evidence arrives.
- Review release candidate for design boundary, safety policy, cost policy, and privacy lifecycle.
- Approve no production claims until Harness has real model evidence and privacy/cost gates pass.

## Milestones

1. Contract and policy freeze.
2. Mock provider with deterministic scenario fixtures.
3. Local SmolVLM2 or Gemma 3n provider prototype.
4. Kokoro TTS prototype with browser speech fallback.
5. Privacy lifecycle proof with frame cleanup assertions.
6. Scenario benchmark and safety traps.
7. Integration with automation bridge for suggested actions only.
8. Final Systems review.
