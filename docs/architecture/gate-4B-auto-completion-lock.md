# Gate 4B Auto-Completion Lock

## Decision

Gate 4B, confidence-based auto-completion, remains blocked.

Gate 4A may improve local perception and action suggestions, but it may not allow a detected action to complete a ritual step without explicit user confirmation.

## Gate 4B Unlock Requirements

Gate 4B cannot begin until all are true:

- Gate 4A passes.
- False-positive rate is measured.
- False-negative rate is documented.
- At least 25 physical action attempts are logged.
- Confirmation acceptance/rejection data exists.
- User explicitly approves auto-completion exploration.
- A separate adversarial eval exists.

## Still Blocked

- blind auto-completion;
- quest progress from detection alone;
- hidden confirmation;
- future-step bypass;
- autonomous vision claims;
- production perception claims;
- cloud/VLM hot path;
- object detection proof claims;
- gesture recognition proof claims.

## Decision Rule

If a quest step can complete without explicit user confirmation, it is outside Gate 4A and blocked by Gate 4B.

