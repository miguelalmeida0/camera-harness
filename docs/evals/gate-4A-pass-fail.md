# Gate 4A Pass/Fail Contract

## Claim

The app can run local camera perception, produce current-step-aware detected action candidates, show them in the main UI, let the user confirm/correct, and preserve privacy/no-model/no-raw-media guarantees.

This gate does not approve autonomous vision, blind auto-completion, object-detection claims, production perception, or production action recognition.

## Pass Criteria

- Local perception loop exists.
- Camera frames are processed transiently only.
- No raw media is persisted.
- No frame upload or cloud path exists.
- No LLM/VLM calls exist.
- Detected action candidate object exists.
- Current-step-aware prioritization exists.
- Detected Action card exists in the main UI.
- Confirm action emits a symbolic event with `local_signal` and `human_correction`.
- Not this / reject does not progress the ritual.
- Uncertainty state is visible.
- Confidence is visible.
- Trace campaign is hidden from the main UI.
- Developer tools are closed by default.
- Forbidden autonomous/product-readiness claims are absent.

## Fail Criteria

- Detected action progresses without user confirmation.
- Rejected action progresses.
- Raw frames are persisted.
- Model calls occur.
- Trace campaign appears in the main UI.
- UI claims autonomous vision.
- Uncertainty is hidden.
- Confidence is hidden.

## Verdicts

- `BLOCKED_MISSING_PERCEPTION`: local camera perception loop or core motion markers are absent.
- `FAIL`: local perception exists, but a required safety/product check fails.
- `PASS_WITH_DISCLOSURE`: required behavior exists with manual-confirmation and local-motion-proxy disclosure.
- `PASS`: reserved for a future stricter gate with no disclosure caveats.
