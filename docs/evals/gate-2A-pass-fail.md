# Gate 2A Pass/Fail: Minimal State-Backed HUD Polish

## Claim

The UI may be visually improved only if every polished visual state remains backed by event/state/evidence, manual confirmation remains disclosed, privacy/model status remains visible, and no cinematic, fake demo, autonomous vision, model-powered perception, or production claim is introduced.

## Pass Criteria

- Gate 1C is `PASS` or `PASS_WITH_DISCLOSURE`.
- Static waiver disclosure is visible when applicable.
- Top status bar exists and is derived from state.
- Checklist is derived from quest state and completed steps.
- Event timeline is derived from symbolic events.
- Sequence inspector is derived from required event sequence inspection.
- Export UX clearly shows the required save path.
- Validation commands remain available after export and are listed for the operator.
- Manual confirmation disclosure remains visible.
- Privacy status remains visible.
- Model-call status remains visible.
- Uncertainty, reset, and low-confidence state remain visible.
- Bug report remains symbolic-only.
- Raw media persistence remains zero.
- LLM/VLM calls remain zero.
- No autonomous vision claims appear.
- No cinematic/demo claims appear.

## Fail Criteria

- Any visual progress is not backed by state/event evidence.
- Manual confirmation is hidden.
- Uncertainty is hidden.
- Low confidence is hidden.
- Model calls appear.
- Raw media is persisted.
- Export/validation UX regresses.
- App implies autonomous vision.
- App implies portfolio/demo readiness.
- Static waiver disclosure disappears.

## Evidence Required

- `npm run gate:2a` report at `runs/gate-2a-latest.json`.
- Gate 1C output showing `PASS` or `PASS_WITH_DISCLOSURE`.
- Source checks for UI state surfaces.
- Runtime checks for top status, event sequence, fixture privacy/model counts, and symbolic bug report.

## Verdict Mapping

- `BLOCKED_GATE_1C`: Gate 1C is not `PASS` or `PASS_WITH_DISCLOSURE`.
- `FAIL`: Gate 1C is acceptable but one or more Gate 2A checks fail.
- `PASS_WITH_DISCLOSURE`: Gate 2A checks pass while Gate 1C/static validation depends on accepted disclosure.
- `PASS`: Gate 2A checks pass without disclosure dependency.
