# Agent Handoffs

Gate 1A handoff details are frozen in `docs/architecture/gate-1A-agent-handoff.md`. Gate 1B browser-local handoff details are frozen in `docs/architecture/gate-1B-agent-handoff.md`. The sections below remain the broader project handoff, but Gate 1A and Gate 1B implementation must follow the v0 replay-first boundary.

## Handoff to PARALLAX

### Exact Event Contracts to Implement

Implement local perception and stabilization for:

- `hand.entered_zone`
- `hand.left_zone`
- `gesture.detected`
- `object.moved`
- `object.placed`
- `zone.activated` when activation is directly caused by local perception
- `confidence.changed`
- `scene.uncertain`
- `scene.reset` for camera bump or calibration failure

For Gate 1A, use `docs/contracts/event-schema.v0.md` exactly for every state-bearing event. Do not emit v1 envelope fields into replay input, quest state, HUD progress, memory, or model routing. `docs/contracts/event-schema.v1.md` may remain reference material only until a schema-change note, positive fixture, adversarial fixture, and runner update promote it.

Do not add untyped fields. If a new state-bearing field is needed, propose it under `docs/architecture/schema-changes/` and keep it out of the live state path until GAUNTLET accepts the fixture-backed change.

### State Transitions That Need Visual Evidence

- `phone_removal_pending -> phone_removed`: `object.moved` where `object_type == "phone"` and phone leaves `zone_focus`.
- `notebook_pending -> notebook_opened`: `object.placed` where `object_type == "notebook"` and dwell is at least `500ms`.
- `pen_pending -> pen_detected`: `object.placed` where `object_type == "pen"` and confidence is at least `0.86`.
- `writing_pending -> writing_detected`: `gesture.detected` with `gesture_type == "writing_motion"` in `zone_notebook`.
- `typing_pending -> typing_detected`: `gesture.detected` with `gesture_type == "typing_motion"` in keyboard or laptop zone.

### Latency Budget

- Camera capture to frame signal: `16-33ms`.
- Frame signal to stabilized event: `100-300ms` depending on window.
- Stabilized event to HUD command: `16-50ms`.
- Hot-path model calls: forbidden.
- Tier 4 VLM fallback: async only, never blocks HUD state display.

### HUD Command Contract

HUD must consume `hud.command_emitted` events and render state truth plainly:

- `show_phone_removal_objective`
- `mark_phone_removed`
- `show_notebook_objective`
- `mark_notebook_ready`
- `show_pen_objective`
- `mark_pen_detected`
- `show_writing_objective`
- `mark_writing_detected`
- `show_typing_objective`
- `mark_typing_detected`
- `show_uncertain_state`
- `show_recovery_state`
- `show_failed_state`
- `quest_complete`

Each command must reference evidence event ids when it implies progress.

### Perception Uncertainty Rules

Emit `scene.uncertain` when:

- required active-step evidence is below threshold for more than `500ms`;
- camera bump invalidates calibrated zones;
- object type is ambiguous for a required object;
- track confidence decays below `0.65`;
- hand/object overlap blocks the active guard;
- low light or blur makes false completion likely.

Do not call cloud models from perception. Emit uncertainty and let `CostRouter` decide.

## Handoff to GAUNTLET

### Claims to Test

- Normal 10-minute Focus Ritual path costs less than `$0.01`.
- Normal path uses zero Tier 4 VLM calls.
- Quest state is reproducible from event replay without camera frames.
- LLM never owns state truth.
- Raw frames and video are not persisted by default.
- HUD never shows completion without accepted evidence ids.
- Memory writes without evidence, TTL, or scope are rejected.

### Benchmark Thresholds

- Local frame processing p95: `<= 33ms`.
- Event stabilization p95: `<= 300ms`.
- Event-to-HUD command p95: `<= 50ms`.
- Replay of a 10-minute session: `<= 2s` locally.
- Normal session model cost: `< $0.01`.
- Tier 2 narration p95 when used: `<= 1200ms`.
- Tier 4 VLM fallback p95 when used: `<= 8000ms`, async and non-blocking.

### Replay Artifacts Required

- Happy path full ritual.
- Low light uncertainty.
- Motion blur suppressed transition.
- Hand/object overlap.
- Reflective phone.
- Camera bump recalibration.
- Zone drift.
- False gesture activation.
- Stale object after occlusion.
- LLM over-triggering denial.
- Memory pollution rejection.
- Cloud fallback privacy denial.
- HUD masking failure prevention.
- Replay sequence gap failure.

### Security/Privacy Audit Scope

- No raw video persistence in normal operation.
- Tier 4 routes require privacy scope and redaction strategy.
- Full-frame cloud VLM routes are denied by default.
- Event logs exclude private raw visual content.
- Memory writes are scoped, evidence-backed, TTL-bound, and deletable.

### Memory-Pollution Tests

- Reject alias without user correction or repeated evidence.
- Reject summary containing facts not present in event logs.
- Reject global instinct promotion from one project session.
- Confirm expired memory is not retrieved.
- Confirm deleted object alias no longer influences routing.
