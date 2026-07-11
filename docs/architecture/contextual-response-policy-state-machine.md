# Contextual Response Policy State Machine

States:
- `idle`
- `observing`
- `normalizing`
- `policy_check`
- `narrate`
- `ask`
- `assist`
- `uncertain`
- `silence`
- `blocked`

Transitions:
- Clear visible change -> `narrate`.
- Ambiguous intent -> `ask`.
- Allowlisted useful action -> `assist`, with action execution still gated separately.
- Low confidence, conflict, occlusion, or poor visibility -> `uncertain`.
- No meaningful change, repeated observation, or unsafe interpretation -> `silence`.
- Raw media persistence, private text exposure, identity/sensitive inference, or unsupported action -> `blocked`.

Non-negotiable:
The response policy may suggest but cannot execute. Action execution remains deterministic and authorization-bound.
