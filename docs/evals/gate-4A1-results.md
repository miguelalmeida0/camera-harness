# Gate 4A.1 Results

## Scope

Gate 4A.1 evaluates the engine-level local action inference path, not cinematic polish and not trace-campaign UX.

## Checks

- Local perception frame contract.
- Action scorer behavior on synthetic symbolic sequences.
- Current-step filtering.
- Confidence smoothing.
- Rejection cooldowns.
- Confirmation boundary.
- Raw media/model/cloud safety boundary.
- Hidden developer tools and trace campaign.
- Frozen UI preservation markers.

## Latest Command

```bash
npm run gate:4a:engine
```

## Latest Result

```text
PASS_WITH_DISCLOSURE
checks: 67/67
report: runs/gate-4a-engine-latest.json
```

## Approval Boundary

This gate does not approve autonomous vision, auto-completion, production action recognition, raw media persistence, or LLM/VLM hot-path use.
