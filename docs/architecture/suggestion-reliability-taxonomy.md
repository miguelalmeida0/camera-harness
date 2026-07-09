# Suggestion Reliability Taxonomy

Gate 3B-Live uses this taxonomy to log suggestion outcomes without implying autonomous vision or auto-completion readiness.

## True Positive

A suggestion matches the intended current quest action and is accepted by the operator.

Log: suggestion id, action, zone, confidence, latency, evidence refs, accept timestamp, `human_correction`, emitted symbolic event id.

## False Positive

A suggestion appears for the wrong action, wrong zone, wrong timing, noise, lighting change, camera bump, or unrelated motion.

Log: suggestion id, displayed action, observed issue, zone, confidence, rejection reason, and whether uncertainty/reset should have appeared.

## False Negative

The operator performs an intended current quest action, but no useful suggestion appears.

Log: intended action, zone, attempt timestamp, visible motion context if symbolic, confidence state if available, and missing suggestion type.

## True Negative

No suggestion appears when no relevant current-step action occurs.

Log: observation window, current quest step, zone status, and absence of suggestion.

## Uncertain

The engine cannot safely rank a suggestion because of low confidence, noisy motion, occlusion, camera bump, or ambiguous zone activity.

Log: uncertainty reason, affected zones, confidence values, reset status, and whether quest progress was blocked.

## Rejected Due To Bad Timing

The suggestion is plausible but arrives too early, too late, during cooldown, or after the operator has moved on.

Log: suggestion id, quest step, timestamp, expiry/cooldown state, and rejection reason.

## Rejected Due To Wrong Zone

The suggestion action may be plausible, but the zone is wrong for the current step.

Log: suggestion id, claimed zone, expected zone, confidence, and rejection reason.

## Rejected Due To Low Confidence

The suggestion appears but confidence is too low for the operator to accept.

Log: suggestion id, confidence, threshold, reason, and whether uncertainty should have been shown.

## Accepted With Correction

The operator accepts the general suggestion but the emitted symbolic event requires corrected payload or metadata.

Log: suggestion id, original payload, corrected payload, `human_correction`, and emitted event id.

## Accepted As-Is

The operator accepts the suggestion without correcting its symbolic payload.

Log: suggestion id, payload, confidence, `human_correction`, and emitted event id.
