# Gate 3B Suggestion Precision Measurement Plan

## Purpose

This plan prepares Gate 3C discussion by measuring suggestion quality. It is not required for Gate 3B-Live pass unless Harness chooses to enforce it.

Gate 3B-Live may validate physical suggestion traces before this measurement set is complete.

## Metrics

Measure:

- suggestions generated;
- suggestions accepted;
- suggestions rejected;
- false positives;
- false negatives;
- suggestion latency;
- confidence calibration;
- zone-specific reliability;
- per-action reliability.

## Definitions

- Suggestion generated: a camera suggestion shown or recorded from local motion proxy.
- Suggestion accepted: user accepts the suggestion and it emits a symbolic event through the normal path.
- Suggestion rejected: user rejects the suggestion and no quest progress occurs.
- False positive: suggestion appears for the wrong action, wrong zone, wrong step, or noisy motion.
- False negative: expected suggestion does not appear during an intended action attempt.
- Suggestion latency: time between local motion evidence and visible/recorded suggestion.
- Confidence calibration: relationship between confidence value and accept/reject/false-positive outcomes.
- Zone-specific reliability: quality by calibrated zone.
- Per-action reliability: quality by ritual step/action.

## Minimum Sample Plan

Collect at least:

- 5 phone moved attempts;
- 5 notebook opened attempts;
- 5 pen picked up attempts;
- 5 writing motion attempts;
- 5 typing motion attempts.

Each attempt should record whether a suggestion was generated, accepted, rejected, missed, uncertain, or suppressed.

## Reporting

Report:

- total attempts;
- suggestions generated;
- accepted/rejected counts;
- false-positive count and rate;
- false-negative observations;
- median suggestion latency;
- low-confidence/uncertainty behavior;
- per-zone reliability notes;
- per-action reliability notes.

## Boundary

This plan does not approve auto-completion. Any Gate 3C discussion still requires explicit user approval and a separate auto-completion adversarial eval.
