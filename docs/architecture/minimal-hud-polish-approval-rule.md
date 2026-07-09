# Minimal HUD Polish Approval Rule

## Decision

Cinematic HUD polish remains blocked. Minimal HUD polish may begin only after replay-safe browser-local traces prove the visual layer is not hiding state or privacy failures.

## Required Gates Before Polish

Minimal polish can begin only when all are true:

- Gate 0B is `PASS`;
- Gate 1A is `PASS` or `PASS_WITH_DISCLOSURE`;
- Gate 1B is `PASS` or `PASS_WITH_DISCLOSURE`;
- browser-generated Focus Ritual trace passes replay;
- occlusion recovery and camera bump reset are passing or explicitly disclosed;
- raw media persistence count is `0`;
- LLM/VLM calls are `0`;
- HUD honesty checks pass.

`PASS_WITH_DISCLOSURE` allows only scoped polish that does not depend on the disclosed missing capability.

## Allowed After Gate 1B

Allowed minimal polish:

- visual layout polish;
- color and typography;
- event timeline presentation;
- confidence bands;
- recovery panel styling;
- quest progress animation backed by accepted quest state only;
- clearer privacy/model status indicators;
- better spacing and responsive behavior.

## Still Forbidden

Still forbidden:

- fake progress;
- cinematic completion without state;
- hiding uncertainty;
- hiding low confidence;
- implying cloud/VLM intelligence;
- storing raw camera frames in artifacts;
- showing screenshots or raw frames in replay reports;
- triggering model calls for animation or narration;
- direct HUD mutation of quest state.

## Evidence Rule

Any progress animation must cite state-backed HUD commands and accepted evidence IDs. If the replay report cannot reproduce the progress, the UI must not show it as completion.

## Recovery Rule

If occlusion or camera bump occurs, the HUD must prefer honest recovery UI over celebratory or cinematic presentation. Recovery panel styling is allowed only after the symbolic recovery path replays.
