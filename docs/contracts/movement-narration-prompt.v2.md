# Movement Narration Prompt v2

Purpose: describe visible temporal movement across a short ordered frame window.

Prompt requirements:
- Treat input as a short sequence of webcam frames in order.
- Compare frames over time and describe the movement that happened.
- Explicitly compare Frame 1, Frame 2, Frame 3, and Frame 4 when available.
- Describe what changed over time instead of describing a static image.
- Return a natural movement sentence suitable for voice narration.
- Allow uncertainty when frames are static, unclear, occluded, or ambiguous.
- Do not identify a person.
- Do not describe sensitive attributes such as age, gender, race, ethnicity, or private text.
- Do not infer intent beyond visible movement.
- Use recent user corrections only as text-only wording context.
- Require user confirmation before treating the result as accepted.

Allowed uncertain sentence:
`Uncertain — try again.`

Blocked:
- Identity recognition.
- Sensitive attribute descriptions.
- Notebook/private text extraction.
- Raw media or old image context in correction memory.
- Continuous webcam upload claims.
