# Gate 2A Visual Truth Audit

| Visual section | Visual claim | Backing state/event/evidence | Failure mode | Can mislead user? | Result |
|---|---|---|---|---|---|
| Status bar | Camera, calibration, quest, recording, export, validation, privacy, and model state are summarized. | `topStatusForState`, `cameraReady`, `calibrationSaved`, `questState`, `recording`, `exportReady`, `exported`, `rawMediaPersistenceCount`, `llmCalls`, `vlmCalls`. | Optimistic labels not derived from state. | Yes, if labels say ready/calibrated before evidence exists. | Pass after state-backed helper check. |
| Next-step card | Operator sees the next required action. | `nextStepText`, `questState`, `recordingStarted`, `physicalConfirmed`, `exportReady`, `exported`. | Next step skips manual confirmation or export blocker. | Yes. | Pass. |
| Checklist | Ritual progress is complete/active/missing. | `ritualChecklistItems`, `completedSteps`, `questState`, `recordingStarted`, `physicalConfirmed`, `exported`. | Progress appears without completed steps. | Yes. | Pass. |
| Event timeline | Last 10 symbolic events are displayed. | `timelineHtml(state.events)`, v0 symbolic event array, event evidence. | Timeline renders decorative or fake events. | Yes. | Pass. |
| Sequence inspector | Required Focus Ritual sequence is present/missing. | `inspectEventSequence`, required event IDs, matched event IDs, confidence, payload summaries. | Sequence reports present without matched events. | Yes. | Pass. |
| Export panel | Physical export is ready only after clean sequence and operator confirmation. | `runExportPreflight`, `exportReady`, `physicalConfirmed`, required save path. | Export enabled during uncertainty/reset or without confirmation. | Yes. | Pass. |
| Validation panel | Operator can run replay/validation after export. | `VALIDATION_COMMAND_LIST`, `VALIDATION_COMMANDS`, `exported`. | Commands disappear after export or omit Gate 1C/Gate 2A. | Yes. | Pass. |
| Troubleshooting panel | Blockers are visible with concrete fixes. | `troubleshootingText`, button guards, export status, error state. | Hidden disabled-button reason. | Yes. | Pass. |
| Bug report panel | Diagnostics are symbolic-only. | `buildOperatorBugReport`, symbolic event summaries, latency/status/error fields. | Report contains raw media, OCR, audio, API keys, or model outputs. | Yes. | Pass. |

## Gate 2A Position

Minimal state-backed HUD polish is acceptable with disclosure only while these backing links remain intact. Cinematic effects, fake progress, hidden uncertainty, autonomous vision claims, and portfolio/production readiness claims remain blocked.
