# DarkQuest v1.1 Research Layer Results

## Verified
- Result rendering uses a stable movement result snapshot separate from live camera state.
- Main UI remains Camera -> Describe my next movement -> Movement Result.
- `npm run gate:v1:research` verifies implementation behavior, not documentation-only proof.
- Movement history is session-only, stores movement text only, is capped at 10 entries, and is clearable.
- Correction loop supports Not this / Correct, stores original and corrected movement text with no raw media/biometric identity flags, is session-only, and is clearable.
- Prompt v2 requires temporal movement across ordered Frame 1-4 inputs, injects recent correction context as text only, forbids identity/sensitive attributes, and allows uncertainty.
- One-shot cost guards remain: no duplicate request while busy, no continuous upload, capped frames, capped provider candidates.
- Voice uses browser speech synthesis for the movement sentence only.

Current gate result: `PASS_WITH_DISCLOSURE` after local source and behavior checks.

## Disclosed
- Gate v1, Gate 4A, and Gate 4A.1 remain PASS_WITH_DISCLOSURE rather than production approval.
- Live narrator is disabled by default.
- Research Lab, if visible, is secondary under Advanced / Developer Tools.

## Blocked
- Autonomous vision claims.
- Production/demo/portfolio readiness claims.
- Persistent correction memory.
- Raw media, screenshots, audio, OCR, notebook text, or base64 media in history or correction memory.

## Requires Live Local Test
- `npm run test:movement-recognition:live` requires local `HF_TOKEN` and was not run unless that token is available in the environment.
