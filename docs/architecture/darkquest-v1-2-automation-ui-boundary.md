# DarkQuest v1.2 Automation UI Boundary

## Frozen Hierarchy

The main product remains:

1. Camera
2. Describe my next movement
3. Big Movement Result

No automation surface may appear above, between, or as a replacement for those elements. Camera, result, layout, spacing, colors, typography, cards, responsiveness, and visual hierarchy remain unchanged.

## Allowed Main-Flow Additions

Only after a movement is explicitly confirmed:

- show the secondary action `Automate this movement`;
- show one compact execution status associated with the confirmed result:
  - `Automation ready`
  - `Running`
  - `Completed`
  - `Failed`

The action remains hidden for pending, rejected, corrected-but-unconfirmed, or uncertain results. Starting another movement invalidates pending consent and per-run confirmation for the prior result.

## Automation Management

`Automate this movement` opens one modal, sheet, or drawer using existing design tokens. It occupies no permanent main-page space and is closed by default.

The editor may contain only:

- Recipe name
- Trigger movement
- Minimum confidence
- Action type
- Action configuration
- Cooldown
- Enabled
- Confirmation requirements

The editor must clearly describe the side effect before consent. Tier 2 shows a separate per-run confirmation at execution time. Browser notification permission is requested only from an explicit user action.

## Receipts

The main flow shows only short status and safe success/failure copy. Detailed text-only receipts and adapter diagnostics belong in the automation drawer or hidden Developer Tools. Raw provider logs, tokens, secret references, URLs, media, stack traces, and unrestricted webhook responses never appear in the main UI.

## Forbidden Main UI

- Automation dashboard or permanent recipe card grid.
- Continuous automation mode.
- Automatic action before confirmation.
- Internal matching, policy, risk, provider, trace, fixture, gate, or evaluation terminology.
- Old ritual/object workflow, raw data, or developer diagnostics.
