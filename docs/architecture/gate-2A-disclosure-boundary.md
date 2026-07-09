# Gate 2A Disclosure Boundary

Gate 1C passed with disclosure. Gate 2A must keep that disclosure visible in dev/debug mode.

## Required Visible Disclosures

The app must visibly disclose:

- package-local static validation is waived;
- minimal HUD polish is allowed with disclosure;
- manual confirmations are not autonomous vision;
- no LLM/VLM calls are used;
- no raw media is persisted.

## Placement

The disclosure may live in a compact banner, status bar, debug panel, or validation panel, but it must be visible without inspecting source code or replay files.

## Behavior

The disclosure must not be hidden by success states, export states, checklist completion, or timeline completion.

If validation status is unavailable, the UI must show an unknown or blocked state rather than a clean pass.

If manual confirmation contributed to progress, the UI must say so.

## Not Approved

Disclosure does not approve:

- autonomous vision claims;
- production claims;
- cinematic presentation;
- portfolio/demo claims;
- model or VLM integration.
