# Gate 4A Results

## Local Perception Checks

- Local camera path must use local video only.
- Per-frame processing must stay transient.
- Motion/hand/zone markers must be source-visible.

## Detected Action UI Checks

- Main UI must show a Detected Action card.
- Candidate must show confidence, zone, and reason.
- UI must disclose camera suggestion and manual confirmation.

## Confirmation/Correction Checks

- Confirm must emit symbolic evidence with `local_signal` and `human_correction`.
- Rejected suggestions must not progress quest state.
- Future-step suggestions must not bypass current-step order.

## Privacy/Model Checks

- Raw media persistence hooks are forbidden.
- Frame upload/cloud hooks are forbidden.
- LLM/VLM hooks are forbidden.
- Model and raw-media counters must remain zero by default.

## Hidden Trace Campaign Checks

- Suggestion Trace Campaign must stay inside Advanced / Developer Tools.
- Developer Tools must be closed by default.
- Main UI must not expose Gate 3B-Live, trace filenames, campaign bundle, raw JSON, raw preflight logs, or blocked-button wall.

## Forbidden Claim Checks

- No autonomous vision claim.
- No object detection proof claim.
- No gesture recognition proof claim.
- No production perception or production action recognition claim.
- No cloud/VLM-powered claim.

## Final Verdict

Latest command:

```bash
npm run gate:4a
```

Latest result:

```text
PASS_WITH_DISCLOSURE
checks: 89/89
runs/gate-4a-latest.json
```
