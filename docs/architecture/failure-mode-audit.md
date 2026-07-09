# Failure-Mode Audit

## Severity Scale

- Critical: Can leak privacy, corrupt state truth, or make replay/eval invalid.
- High: Can break the demo or cause wrong quest completion.
- Medium: Degrades UX but has visible recovery.
- Low: Minor polish or recoverable confusion.

## Audit Table

| Failure mode | Detection signal | Mitigation | Test fixture needed | Owner agent | Release-blocking severity |
| --- | --- | --- | --- | --- | --- |
| Low light | Scene brightness confidence drops; `confidence.changed` reason `low_light` | Show lighting recovery HUD; hold state; avoid guessing | Low-light event trace plus optional consented clip | PARALLAX | High |
| Motion blur | Track velocity spikes, object confidence instability | Increase stabilization window; suppress state transition | Fast hand/object movement fixture | PARALLAX | Medium |
| Hand/object overlap | Hand and object tracks intersect with object confidence drop | Keep prior object state stale-limited; emit `scene.uncertain` if active guard blocked | Pen covered by hand fixture | PARALLAX | High |
| Reflective surfaces | Object bbox flicker, duplicate highlights, low classifier confidence | Require dwell and corroborating motion; no single-frame completion | Reflective phone/notebook fixture | PARALLAX | Medium |
| Camera bump | Global scene transform shift, zone anchors invalid | Emit `scene.reset` with `requires_recalibration`; block quest state | Camera bump event trace | PARALLAX | High |
| Zone drift | Hand/object zone assignment changes without corresponding motion | Recalibrate zone anchors; decay confidence; visible warning | Slow drift calibration fixture | PARALLAX | High |
| False gesture activation | Gesture detected without dwell, expected object, or active step | Require active-state guard and evidence window; reject gesture outside context | Random hand wave fixture | PARALLAX | High |
| Stale state after occlusion | Entity track missing beyond TTL while state remains dependent | Emit `confidence.changed`; hold or recover active step | Object leaves frame then returns fixture | PARALLAX | High |
| LLM over-triggering | Route logs exceed calls/min or cost budget | CostRouter denial; human correction fallback; visible retry cap | Route spam fixture with repeated uncertainty | AXIOM | Critical |
| Memory pollution | Memory write lacks evidence, TTL, or repeats unsupported inference | MemoryGate rejection; replay validation before promotion | Bad alias and hallucinated summary fixtures | AXIOM | Critical |
| Hidden retry loop | Node retry count increases without visible event or log | Retry policy caps; explicit `agent.escalation_requested` or failure event | Malformed model response fixture | AXIOM | Critical |
| Tool response ambiguity | Node returns missing status, summary, next_actions, or artifacts | Schema validation failure; block downstream nodes | Invalid node response fixture | AXIOM | High |
| Cloud fallback privacy leak | Tier 4 route uses full frame or missing privacy scope | Deny route; require object crop and user-visible escalation | Forbidden full-frame route fixture | GAUNTLET | Critical |
| HUD masking failure | HUD shows cinematic success while state is uncertain or failed | HUD command must reference evidence ids and state confidence | State failed plus success animation fixture | PARALLAX | Critical |
| Replay cannot reproduce bug | Event sequence gap, missing schema version, non-deterministic model output | Fail replay; require fixture completion before release | Sequence gap and mocked model fixture | GAUNTLET | Critical |

## Release Gate

No release candidate may pass if any critical failure lacks a replay fixture and deterministic expected outcome. High failures require fixture coverage or an explicit signed exception.

