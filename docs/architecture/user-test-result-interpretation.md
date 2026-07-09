# User Test Result Interpretation

Use this table to triage the next user report. Gate 2 remains blocked in every case until Gate 1C passes or receives accepted disclosure.

| Result | Meaning | Likely owner | Next fix | Gate 2 |
| --- | --- | --- | --- | --- |
| 1. App does not open | Local server, URL, port, or browser access is broken. | Multimodal Perception & Interface Researcher | Fix launcher, port fallback, URL instructions, or static serving. | Blocked |
| 2. Camera does not start | Browser permission, HTTPS/local camera policy, device availability, or camera code is failing. | Multimodal Perception & Interface Researcher | Fix camera permission guidance and error display; verify video-only request. | Blocked |
| 3. Calibration does not save | Calibration form, object assignment, or state transition is broken. | Multimodal Perception & Interface Researcher | Fix `Save Calibration`, state update, and calibration event emission. | Blocked |
| 4. Buttons are disabled | Guard logic or operator guidance is unclear or wrong. | Multimodal Perception & Interface Researcher | Fix button guards, disabled reasons, next-step card, and troubleshooting text. | Blocked |
| 5. Quest does not progress | Manual confirmation events or reducer transition is broken. | Multimodal Perception & Interface Researcher | Fix event emission, event ordering, reducer state update, and timeline render. | Blocked |
| 6. Export is disabled | Preflight detects incomplete ritual, missing confirmation, unresolved uncertainty, reset, or missing events. | Multimodal Perception & Interface Researcher | Use Export Preflight and Event Sequence Inspector to fix the first blocked condition. | Blocked |
| 7. Export downloads but validate says file missing | Download was not saved at the required repo path. | User with Harness support | Move file to `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`; improve save-path assistant if unclear. | Blocked |
| 8. `physical:validate` fails provenance | Fixture is missing required physical provenance or is a dev dry-run/manual fake. | Harness, Evaluation, Memory & Safety Researcher | Inspect `trace_origin`; fix export provenance only if real physical session was used. | Blocked |
| 9. `physical:validate` passes but Gate 1C fails | Trace exists but replay, expectations, privacy, model, HUD honesty, latency, static, or adversarial checks fail. | Harness, Evaluation, Memory & Safety Researcher | Use `runs/gate-1c-latest.json` to fix the exact failing check. | Blocked |
| 10. Gate 1C passes | Physical trace evidence is accepted. | Systems Research Architect | Discuss minimal state-backed HUD work only; keep autonomous CV claims limited if manual confirmation was used. | May be discussed |
| 11. Gate 1C passes with disclosure | Physical trace passes but accepted disclosure remains, likely static validation. | Systems Research Architect | Record disclosure scope and expiration before any minimal HUD discussion. | May be discussed with disclosure |

## Rule

Camera-only is failure. A source dry-run is not a physical trace. Manual confirmation is not autonomous vision.
