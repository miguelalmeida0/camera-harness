# Gate 1F Acceptance Criteria

Gate 1F is the final operational control layer for "user can test now."

No new gates after Gate 1F.

## Gate 1F Passes If

- Gate 1D passes.
- Gate 1E passes.
- App has operator guidance.
- Troubleshooting exists.
- Save-path assistant exists.
- Bug report export exists.
- Event-sequence inspector exists.
- Dry-run/physical separation exists.
- Validation command UX exists.
- `physical:validate` gives useful missing-file guidance.
- Gate 2 remains locked.
- Physical trace remains required.

## Required App Evidence

The app must expose:

- `Next Step` or equivalent operator guidance;
- `Troubleshooting Panel`;
- `Save Path` guidance for `fixtures/replay/live/live_physical_focus_ritual_001.v0.json`;
- `Export Bug Report`;
- `Event Sequence Inspector`;
- `Dry-Run / Physical Separation`;
- `Copy Validation Commands`;
- explicit raw media/model status.

## Required Harness Evidence

The harness must show:

- `npm run gate:1d` passes;
- `npm run gate:1e` passes;
- `npm run gate:1f` passes source readiness;
- dev dry-run cannot satisfy physical trace validation;
- `npm run physical:validate` blocks while the physical fixture is missing;
- Gate 1C remains strict.

## Gate 1F Does Not Approve

- HUD polish;
- cinematic polish;
- portfolio claims;
- autonomous CV claims;
- model integration;
- memory features;
- RAG;
- narration;
- agentic embellishments.
