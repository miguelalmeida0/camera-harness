# State-Backed HUD Contract v0

Every visual component must map to one or more allowed input states:

- quest state;
- stable event;
- HUD command;
- event evidence;
- confidence value;
- latency metric;
- privacy status;
- model-call status;
- export status;
- validation status;
- waiver/disclosure status.

If no allowed input supports the display, the component must show an unavailable, uncertain, blocked, or disclosure state.

| Component | Allowed input state | Displayed claim | Forbidden claim | Failure behavior | Test expectation |
| --- | --- | --- | --- | --- | --- |
| Top status bar | quest state, validation status, privacy status, model-call status, waiver/disclosure status | Current run status, privacy/model status, disclosure status | Production readiness, autonomous vision, cinematic readiness | Show blocked/disclosed state and preserve privacy/model visibility | State changes are reproducible from replay or current validation output |
| Next-step card | quest state, HUD command, validation status | Next operator action | That the app independently perceived an action unless a stable event supports it | Show the blocking reason or required manual confirmation | Next action matches reducer/HUD command state |
| Ritual checklist | quest state, stable event, HUD command, confidence value | Which ritual steps are pending, confirmed, or complete | Completion without supporting event or manual confirmation | Keep item pending or uncertain | Checklist completion requires matching stable event or explicit confirmation |
| Event timeline | stable event, event evidence, confidence value, latency metric | Symbolic event order, confidence, evidence summary | Raw camera understanding, hidden uncertainty, solved gesture recognition | Show missing/uncertain event and do not reorder | Timeline rows match event IDs and timestamps |
| Sequence inspector | stable event, event evidence, validation status | Required sequence presence, missing steps, matched event IDs | Broad/vague success without exact support | Show missing, out-of-order, or invalid sequence | Inspector catches missing or mismatched required events |
| Export panel | export status, validation status, privacy status | Download/save status and target path | Export equals Gate 1C pass | Show save path, validation command, or blocked state | Exported artifact path and command are visible |
| Validation panel | validation status, latency metric, waiver/disclosure status | Physical validation, replay, and gate result | Gate pass without validation support | Show failure code, missing file, or disclosure | `physical:validate` and Gate 1C outputs are represented accurately |
| Troubleshooting panel | quest state, HUD command, validation status, privacy status, model-call status | What is blocking the operator | Hidden manual confirmation, hidden privacy/model failure | Show actionable reason and preserve disclosure | Common blocked states have visible next fix |
| Bug report panel | export status, validation status, privacy status, model-call status, waiver/disclosure status | Symbolic diagnostic export is available | That bug report includes raw frames, screenshots, OCR, audio, API keys, model responses, or cloud evidence | Disable or warn if allowed symbolic fields are unavailable | Bug report contains only allowed symbolic/debug fields |
| Disclosure banner | waiver/disclosure status, privacy status, model-call status, validation status | Static waiver, manual confirmation, zero raw media, zero LLM/VLM calls | Autonomous CV proof, model/VLM use, production readiness | Stay visible in dev/debug mode until waiver no longer applies | Banner text includes all required disclosures |

## Contract Invariants

- UI cannot mutate quest state directly.
- Visual completion requires reducer state, stable event, HUD command, or accepted manual confirmation.
- Hidden uncertainty is a failure.
- Hidden low confidence is a failure.
- Hidden manual confirmation is a failure.
- Hidden model-call or privacy state is a failure.
- Decorative polish must not create new claims.
