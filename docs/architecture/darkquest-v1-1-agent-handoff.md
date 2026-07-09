# DarkQuest v1.1 Agent Handoff

## To Multimodal

Implement v1.1 as an intelligence-layer polish pass while preserving the frozen product hierarchy:

Camera -> Describe my next movement -> Big movement result.

Priority order:

1. Fix the result-card glitch first so the big movement sentence is stable, readable, and does not jump.
2. Implement Prompt v2 with temporal frame labels and concise JSON output.
3. Add text-only movement history for the last 10 movement sentences.
4. Add the correction input after Not this / Correct: "What did you actually do?"
5. Feed recent text-only corrections into the next prompt in the same session.
6. Add Hidden Research Lab diagnostics inside Developer Tools only.
7. Preserve one-shot cost guard behavior.
8. Preserve simple hierarchy and current design.

Do not add a new dashboard, visible diagnostics, continuous detection, raw media storage, or identity claims.

## To Harness

Create checks that verify v1.1 behavior cannot regress the product freeze:

- no raw media persistence
- correction memory is text only
- Prompt v2 returns the required movement JSON shape
- main UI stays uncluttered
- research diagnostics stay hidden by default
- no continuous calls
- no provider call before the explicit user click
- no duplicate provider calls from double click
- provider retry and fallback remain bounded
- token and provider errors are safely redacted
- voice speaks the movement sentence only

Harness checks should fail if internal diagnostics, traces, raw logs, token data, or old workflow language appear in the main UI.

