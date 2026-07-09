# Model Routing Policy

## Budget Rule

A 10-minute Focus Ritual session should target less than `$0.01` in LLM cost under normal demo use. Normal demo use means calibration succeeds, perception confidence remains stable, and no visual ambiguity requires Tier 4.

## Gate 1A Zero-Model-Call Decision

Gate 1A is a zero-model-call gate.

Rules:

- default LLM calls: `0`;
- default VLM calls: `0`;
- narration is disabled or mocked;
- cloud fallback is disabled;
- VLM fallback is disabled unless a future explicit uncertainty fixture allows it;
- any provider call must produce a model-call record;
- any unexpected provider call is release-blocking;
- any future cloud call must be visibly marked in the HUD;
- no model call may occur from `packages/perception/live-perception-adapter`;
- no model call may occur from `packages/quest-engine`;
- no model call may occur from `packages/replay/live-trace-recorder`;
- model routing must remain outside the local hot path.

For Gate 1A live traces, the replay fixture must set `privacy.cloud_calls_expected=false`, `metrics.max_llm_calls=0`, `metrics.max_vlm_calls=0`, and `metrics.max_cost_usd=0`.

## Gate 1B Browser-Local Zero-Model-Call Decision

Gate 1B remains a zero-model-call gate.

Rules:

- no LLM calls from browser capture;
- no VLM calls from browser capture;
- no LLM/VLM calls from `packages/perception/live-perception-adapter`;
- no LLM/VLM calls from `packages/quest-engine`;
- no LLM/VLM calls from `packages/hud`;
- no LLM/VLM calls from `packages/replay/live-trace-recorder`;
- no cloud fallback for occlusion;
- no cloud fallback for camera bump/reset;
- uncertainty is handled by `scene.uncertain`, `scene.reset`, HUD recovery, and recalibration;
- model routing remains outside the browser local hot path;
- any model call in Gate 1B is release-blocking.

Gate 1B browser-generated fixtures must set `privacy.cloud_calls_expected=false`, `metrics.max_llm_calls=0`, `metrics.max_vlm_calls=0`, and `metrics.max_cost_usd=0`. Browser trace origin metadata must also set `cloud_calls_enabled=false`.

## Gate 1C Physical Webcam Zero-Model-Call Decision

Gate 1C remains a zero-model-call gate.

Rules:

- zero LLM calls;
- zero VLM calls;
- no cloud fallback;
- no model route from browser capture;
- no model route from `packages/perception/browser-local-capture`;
- no model route from `packages/perception/live-perception-adapter`;
- no model route from `packages/replay/live-trace-recorder`;
- no model route from `packages/quest-engine`;
- no model route from minimal HUD polish;
- no model route for physical provenance;
- no model route for occlusion or camera bump recovery;
- any model call in Gate 1C is release-blocking.

Future model usage must be introduced only after a separate gate, a specific model route contract, explicit HUD marking, privacy review, cost budget, and replay fixtures that prove the route cannot mutate quest truth without evidence.

Gate 1C physical fixtures must set `privacy.cloud_calls_expected=false`, `metrics.max_llm_calls=0`, `metrics.max_vlm_calls=0`, and `metrics.max_cost_usd=0`. Physical trace provenance must set `cloud_calls_enabled=false`.

## Routing Tiers

| Tier | Name | Allowed triggers | Forbidden triggers | Max calls/min | Max cost/session | Expected latency | Fallback behavior | Logging required |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| 0 | No model, deterministic local rules | Quest transitions, HUD commands, confidence thresholds, replay diffs | Any natural-language interpretation, visual ambiguity resolution | Unlimited | `$0.00` | `0-10ms` | Fail visibly or escalate to Tier 1/2 by policy | Rule id, guard, latency, status |
| 1 | Local small model or simple classifier | Local gesture/object classifier, lightweight scene quality check | Cloud calls, narration, session summary | Local only | `$0.00` | `5-50ms` | Emit `scene.uncertain` or keep state unchanged | Classifier id, confidence, frame window |
| 2 | Cheap fast text LLM | Narration, concise planning from symbolic events, memory summary from event logs | Raw frame analysis, state truth, repeated recovery loop | `2` | `$0.004` | `300-1200ms` | Deterministic copy or human correction | Prompt class, token estimate, cost, latency |
| 3 | Stronger reasoning model | Session summary, stuck recovery after deterministic failure, architecture/debug explanation | Hot path, frame-level decisions, routine narration | `0.2` | `$0.004` | `1-5s` | Human correction or fail visible | Reason code, evidence ids, cost, result |
| 4 | VLM fallback | Rare visual ambiguity for active required object after local uncertainty | Continuous video, broad scene inspection, idle curiosity, private documents | `0.1` | `$0.002` | `1-8s` | Ask human correction; do not block HUD | Privacy scope, redaction, source crop id, cost |

## Allowed Escalation Triggers

- `scene.uncertain` blocks an active quest transition.
- `confidence.changed` drops a required object, zone, or scene below threshold.
- `quest.step_failed` is recoverable and deterministic recovery has not exceeded retry policy.
- `HumanCorrectionHandler` asks for summary or alias persistence.
- `quest_complete` requests optional session summary within budget.

## Forbidden Escalation Triggers

- Raw webcam frames on a timer.
- Idle scene monitoring with no active blocked transition.
- Repeated retries after one visible retry failed.
- HUD animation or visual polish.
- State mutation without deterministic guard or human correction.
- Memory write without evidence event ids and policy approval.

## Model Route Decision Schema

```json
{
  "route_id": "route_001",
  "session_id": "ses_focus_001",
  "requested_tier": 2,
  "approved_tier": 2,
  "trigger_event_ids": ["evt_step_failed_001"],
  "reason_code": "recoverable_step_failure",
  "input_class": "symbolic_events_only",
  "max_latency_ms": 1200,
  "max_cost_usd": 0.001,
  "estimated_cost_usd": 0.0004,
  "privacy_scope": "no_visual_input",
  "status": "approved",
  "fallback_action": "deterministic_recovery_prompt"
}
```

## Pseudocode

```ts
function routeModel(request, budget, recentRoutes, activeState) {
  if (request.canUseDeterministicRule) {
    return approveTier(0, "deterministic_rule");
  }

  if (request.requiresHotPathDecision) {
    return deny("models_forbidden_on_hot_path", "hold_state_or_emit_uncertain");
  }

  if (budget.spentUsd >= budget.sessionCapUsd) {
    return deny("session_budget_exceeded", "ask_human_correction");
  }

  if (recentRoutes.visibleRetryCountFor(request.reasonCode) > 0) {
    return deny("retry_limit_exceeded", "ask_human_correction");
  }

  if (request.inputClass === "symbolic_events_only" && request.intent === "narration") {
    return approveIfWithinBudget(2, request, budget);
  }

  if (request.inputClass === "symbolic_events_only" && request.intent === "stuck_recovery") {
    return approveIfWithinBudget(3, request, budget);
  }

  if (request.inputClass === "redacted_visual_crop" &&
      request.intent === "required_object_disambiguation" &&
      activeState.isBlocked &&
      request.privacyScope !== "full_frame") {
    return approveIfWithinBudget(4, request, budget);
  }

  return deny("no_allowed_route", "fail_visible_or_human_correction");
}
```

## Normal Demo Cost Plan

- Tier 0 handles all state transitions and HUD commands.
- Tier 1 handles local object/gesture classification with no cloud cost.
- Tier 2 may be used once at completion for concise narration or summary.
- Tier 3 is not expected during normal demo use.
- Tier 4 is not expected during normal demo use.
