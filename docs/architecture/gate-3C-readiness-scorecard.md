# Gate 3C Readiness Scorecard

Current score: `RED` — waiting on Gate 3B-Live physical suggestion traces.

Gate 3C remains locked. This scorecard decides whether Gate 3C can be discussed, not approved.

## Required Conditions

Gate 3C cannot be discussed until all are true:

- Gate 3B-Live passes;
- at least 20 suggestion attempts are logged;
- at least 5 phone moved attempts are measured;
- at least 5 notebook opened attempts are measured;
- at least 5 pen picked up attempts are measured;
- at least 5 writing motion attempts are measured;
- at least 5 typing motion attempts are measured;
- accept/reject outcomes are recorded;
- false positives are measured;
- false negatives are documented;
- uncertainty behavior is stable;
- no raw media/model regressions exist;
- user explicitly approves exploring auto-completion;
- separate auto-completion adversarial eval exists.

## Scoring

`RED`: locked. Required traces, measurements, approvals, or adversarial evals are missing.

`YELLOW`: measurement in progress. Gate 3B-Live passes and suggestion attempts are being gathered, but readiness is incomplete.

`GREEN`: ready to discuss Gate 3C, not approve it. All readiness conditions are satisfied and user approval exists to explore auto-completion.

## Current Expected State

`RED`: Gate 3B-Live is `BLOCKED_MISSING_SUGGESTION_TRACES`, precision measurements are incomplete, and Gate 3C remains locked.

Even if Gate 3B-Live passes, Gate 3C only moves to measurement discussion, not implementation, unless the user explicitly approves auto-completion exploration.
