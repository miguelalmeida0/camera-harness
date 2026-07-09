# DarkQuest v1 Polish Agent Handoff

## To Harness

Enforce the v1 product freeze:

- main hierarchy stays Camera -> Describe my next movement -> Big movement result;
- no old ritual workflow in main UI;
- no trace campaign in main UI;
- no JSON fixture export in main UI;
- no Gate language in main UI;
- no Recent Events or validation checklist UX in main UI;
- mirrored preview defaults on;
- no accidental continuous calls;
- no AI call before explicit click;
- no duplicate call from double click;
- no calls while tab hidden;
- no token exposure;
- no raw media persistence.

Add or preserve checks for:

- provider busy copy;
- missing token copy;
- endpoint unavailable copy;
- frame capture error copy;
- capped provider candidate fallback;
- disabled button while capturing/analyzing;
- result sentence not truncated;
- reduced-motion-safe result reveal;
- Web Speech API speaks sentence only.

## To Multimodal

Implement only approved polish:

- mirrored camera preview by default;
- one-shot cost guard;
- provider busy retry handling;
- clearer loading states;
- clearer error states;
- result reveal animation;
- voice response polish;
- hidden developer diagnostics.

Do not:

- redesign layout;
- add main UI panels;
- enable continuous detection by default;
- auto-call AI without click;
- expose `HF_TOKEN`;
- persist raw frames;
- bring old ritual/trace UX into the product;
- change provider route without proof.

## Provider Route

Keep the proven route unless a new proof run is produced:

```text
google/gemma-4-31B-it:cerebras
```

Proof markers to preserve when live tested:

- `BARE_CONTROL_PASS`
- `MOVEMENT_PROMPT_PASS`
- `PROVIDER_HELPER_PASS`
- `LIVE_OK`

