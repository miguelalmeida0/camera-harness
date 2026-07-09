# LangGraph Node Contracts

## Hard Rule

The LLM must not own state truth. State truth comes from typed events, user correction, replay fixtures, and deterministic transition rules.

## Shared Node Response

Every node returns:

```json
{
  "status": "success",
  "summary": "Short result.",
  "next_actions": ["next_node_name"],
  "artifacts": ["event_id:evt_001"]
}
```

Valid `status` values: `success`, `partial`, `failed`, `skipped`.

## Shared Logging Requirements

Every node logs `session_id`, `run_id`, `node_name`, `input_event_ids`, `state_read_keys`, `state_write_keys`, `latency_ms`, `retry_count`, `route_tier`, `estimated_cost_usd`, `status`, and `failure_reason`.

## Node Catalog

### `PerceptionEventIngestor`

- Input schema: `{ "events": ["PerceptionEvent"], "session_id": "string" }`
- Output schema: `{ "accepted_events": ["PerceptionEvent"], "rejected_events": ["RejectedEvent"] }`
- State read permissions: session config, schema registry.
- State write permissions: append-only event buffer.
- Side effects allowed: schema validation logs.
- LLM allowed: No.
- Retries allowed: No; invalid events are rejected visibly.
- Stop conditions: no events, schema mismatch, session closed.
- Logging requirements: validation outcome per event.
- Failure behavior: return `failed` with rejected event ids and reasons.

### `EventStabilizer`

- Input schema: `{ "frame_signals": ["FrameSignal"], "prior_tracks": ["TrackState"], "active_zones": ["DeskZone"] }`
- Output schema: `{ "stable_events": ["PerceptionEvent"], "track_updates": ["TrackState"] }`
- State read permissions: recent frame-signal ring buffer, calibration zones.
- State write permissions: track state, stabilized event stream.
- Side effects allowed: local metrics only.
- LLM allowed: No.
- Retries allowed: No hidden retries; stabilization windows are explicit.
- Stop conditions: camera unavailable, calibration missing, signal confidence below floor.
- Logging requirements: window size, confidence, rejected candidates.
- Failure behavior: emit `scene.uncertain` when uncertainty blocks active quest state.

### `QuestStateTracker`

- Input schema: `{ "events": ["PerceptionEvent"], "current_state": "QuestState" }`
- Output schema: `{ "state": "QuestState", "transition_events": ["PerceptionEvent"], "blocked_guard": "string | null" }`
- State read permissions: quest state, event history, active step.
- State write permissions: quest state, transition trace.
- Side effects allowed: emit quest and zone events.
- LLM allowed: No.
- Retries allowed: No.
- Stop conditions: no applicable transition, invalid sequence, terminal state.
- Logging requirements: from state, to state, guard, threshold, evidence ids.
- Failure behavior: hold state, emit `scene.uncertain` or `quest.step_failed`.

### `Planner`

- Input schema: `{ "quest_state": "QuestState", "recent_events": ["PerceptionEvent"], "budget": "ModelBudget" }`
- Output schema: `{ "instructions": ["AgentInstruction"], "model_route_request": "ModelRouteRequest | null" }`
- State read permissions: current quest state, recent event summaries, budget state.
- State write permissions: planner instruction log only.
- Side effects allowed: request model route through `CostRouter`.
- LLM allowed: Yes, Tier 2 or Tier 3 only.
- Retries allowed: One visible retry only on transport failure.
- Stop conditions: deterministic next action exists, budget exceeded, terminal state.
- Logging requirements: route tier, prompt class, token estimate, cost estimate.
- Failure behavior: return deterministic fallback instruction or ask human correction.

### `Narrator`

- Input schema: `{ "quest_state": "QuestState", "instruction": "AgentInstruction", "tone_constraints": ["string"] }`
- Output schema: `{ "narration": "NarrationText", "instruction_event": "PerceptionEvent | null" }`
- State read permissions: current state and latest accepted transition only.
- State write permissions: narration log.
- Side effects allowed: none except log.
- LLM allowed: Yes, Tier 2 only.
- Retries allowed: One visible retry on invalid style or schema output.
- Stop conditions: HUD can use deterministic copy, cost budget near cap.
- Logging requirements: model route, token count, latency, schema validation result.
- Failure behavior: return deterministic copy from quest state.

### `HUDCommandEmitter`

- Input schema: `{ "quest_state": "QuestState", "events": ["PerceptionEvent"], "instructions": ["AgentInstruction"] }`
- Output schema: `{ "hud_commands": ["HUDCommand"], "emitted_events": ["hud.command_emitted"] }`
- State read permissions: quest state, confidence state, active HUD command registry.
- State write permissions: HUD command stream.
- Side effects allowed: emit HUD command events.
- LLM allowed: No.
- Retries allowed: No.
- Stop conditions: command conflict, expired instruction, hidden failure risk.
- Logging requirements: command id, priority, evidence ids, expiration.
- Failure behavior: suppress conflicting command and emit `failed` with conflict id.

### `MemoryGate`

- Input schema: `{ "candidate": "MemoryWriteCandidate", "evidence_events": ["PerceptionEvent"], "session_policy": "MemoryPolicy" }`
- Output schema: `{ "approved_writes": ["memory.write_requested"], "rejected_writes": ["RejectedMemoryWrite"] }`
- State read permissions: memory policy, existing scoped memories, replay evidence.
- State write permissions: memory write requests only.
- Side effects allowed: local memory write after approval.
- LLM allowed: Tier 2 allowed only for summarizing event histories; never for raw frames.
- Retries allowed: No hidden retries.
- Stop conditions: missing evidence, forbidden scope, low confidence, TTL missing.
- Logging requirements: scope, confidence, evidence ids, rejection reason.
- Failure behavior: reject write and keep replay event only.

### `UncertaintyResolver`

- Input schema: `{ "uncertainty_event": "scene.uncertain", "budget": "ModelBudget", "privacy_scope": "PrivacyScope" }`
- Output schema: `{ "resolution": "UncertaintyResolution", "events": ["PerceptionEvent"] }`
- State read permissions: recent symbolic events, redacted visual crop reference if allowed.
- State write permissions: confidence updates, escalation result log.
- Side effects allowed: approved model calls through `CostRouter`.
- LLM allowed: Yes, Tier 2, Tier 3, or Tier 4 according to policy.
- Retries allowed: One visible retry only if the model response is malformed.
- Stop conditions: budget exceeded, privacy scope invalid, human correction required.
- Logging requirements: route tier, redaction strategy, cost, latency, decision.
- Failure behavior: return `partial` and ask `HumanCorrectionHandler`.

### `CostRouter`

- Input schema: `{ "route_request": "ModelRouteRequest", "session_budget": "ModelBudget", "recent_routes": ["ModelRouteLog"] }`
- Output schema: `{ "route_decision": "ModelRouteDecision", "escalation_event": "agent.escalation_requested | null" }`
- State read permissions: budget ledger, route policy, active step.
- State write permissions: route ledger.
- Side effects allowed: none.
- LLM allowed: No.
- Retries allowed: No.
- Stop conditions: deterministic route available, budget exhausted, forbidden trigger.
- Logging requirements: trigger, tier, allowed/denied, remaining budget.
- Failure behavior: deny route and provide deterministic fallback reason.

### `HumanCorrectionHandler`

- Input schema: `{ "correction": "HumanCorrection", "current_state": "QuestState", "related_event_ids": ["string"] }`
- Output schema: `{ "accepted_correction": "AcceptedCorrection | null", "events": ["PerceptionEvent"] }`
- State read permissions: current state, event history, memory policy.
- State write permissions: correction log, confidence updates, memory candidates.
- Side effects allowed: emit `confidence.changed` and memory write candidate.
- LLM allowed: No.
- Retries allowed: No.
- Stop conditions: correction conflicts with replay evidence or is out of scope.
- Logging requirements: correction type, affected refs, confidence, memory candidate.
- Failure behavior: reject correction with reason and leave state unchanged.

### `ReplayRecorder`

- Input schema: `{ "events": ["PerceptionEvent"], "node_responses": ["NodeResponse"], "model_routes": ["ModelRouteLog"] }`
- Output schema: `{ "artifact_refs": ["ReplayArtifactRef"], "write_status": "string" }`
- State read permissions: current session trace.
- State write permissions: append-only replay artifacts.
- Side effects allowed: local artifact write.
- LLM allowed: No.
- Retries allowed: One visible file-write retry.
- Stop conditions: storage unavailable, event sequence gap, schema mismatch.
- Logging requirements: artifact path, event count, checksum, sequence range.
- Failure behavior: fail closed; do not continue demo without warning HUD command.

