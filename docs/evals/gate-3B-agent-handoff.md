# Gate 3B Agent Handoff

```json
{
  "schema": "darkquest.agent_handoff.v1",
  "from_agent": "GAUNTLET",
  "to_agent": "Multimodal Perception & Interface Researcher",
  "decision": "Gate 3B evaluates motion-proxy camera suggestions only. Suggestions must require confirmation and must not auto-complete quest steps.",
  "evidence": [
    "packages/evals/bin/gate-3b-check.mjs",
    "docs/evals/gate-3B-pass-fail.md",
    "docs/evals/gate-3B-results.md",
    "docs/evals/gate-3B-suggestion-truth-audit.md",
    "packages/perception/browser-local-capture/test/prototype-flow.test.mjs"
  ],
  "open_risks": [
    "Future UI copy could imply automatic action recognition.",
    "New suggestion types could bypass current-step gating.",
    "Accepted suggestions must keep both local_signal and human_correction evidence.",
    "Low-confidence suggestions must stay visible and non-progressing until accepted.",
    "Privacy/model status must remain zero raw media persistence and zero LLM/VLM calls."
  ],
  "required_ecc_skills": [
    "agent-eval",
    "security-review",
    "ai-regression-testing"
  ],
  "acceptance_gate": {
    "metric": "Gate 3B action suggestion checks",
    "threshold": "PASS_WITH_DISCLOSURE or PASS",
    "judge": "test"
  },
  "next_action": "If Gate 3B passes, improve clarity of the suggestion panel only; do not add autonomous recognition claims or auto-completion."
}
```

```json
{
  "schema": "darkquest.agent_handoff.v1",
  "from_agent": "GAUNTLET",
  "to_agent": "Systems Research Architect",
  "decision": "Gate 3B does not change architecture boundaries. It remains local perception to symbolic suggestion to manual confirmation.",
  "evidence": [
    "packages/evals/bin/gate-3b-check.mjs",
    "docs/evals/gate-3B-pass-fail.md",
    "docs/evals/gate-3B-results.md",
    "docs/evals/gate-3B-suggestion-truth-audit.md"
  ],
  "open_risks": [
    "Auto-completion remains blocked.",
    "Object detection and production action-recognition claims remain blocked.",
    "Gate 3C can be planned later only if it keeps replay, privacy, confirmation, and claim controls explicit."
  ],
  "required_ecc_skills": [
    "agent-architecture-audit",
    "benchmark-methodology",
    "recursive-decision-ledger"
  ],
  "acceptance_gate": {
    "metric": "Architecture boundary preservation",
    "threshold": "No cloud/model calls, no raw media persistence, no autonomous completion",
    "judge": "human review"
  },
  "next_action": "Plan Gate 3C only as a separate eval contract; do not infer approval from Gate 3B."
}
```
