# Movement Result Animation And Voice Policy

## Decision

The movement result should feel delightful without changing the frozen layout or creating distraction.

## Result Animation

Rules:

- movement sentence reveals smoothly;
- no layout jump;
- no text truncation;
- respects reduced motion;
- no distracting loops;
- result appears as hero;
- animation does not change hierarchy;
- animation does not hide loading/error states.

Allowed:

- opacity/translate reveal;
- subtle emphasis on first result paint;
- reduced-motion fallback to instant reveal.

Forbidden:

- looping animation;
- large layout shift;
- clipped movement sentence;
- animation that moves Confirm/Try/Speak buttons under the cursor;
- animation that looks like autonomous certainty.

## Voice

Use browser Web Speech API only.

Rules:

- speak movement sentence only;
- no confidence/provider/evidence speech;
- auto-speak off by default;
- do not auto-speak uncertain result;
- prevent repeated speech on rerender;
- stop/cancel previous speech before new result;
- voice status remains secondary;
- no remote speech provider.

## Speech State

Recommended states:

```text
muted
ready
speaking
error
```

## UX Copy

Allowed:

- `Speak result`
- `Auto-speak off`
- `Auto-speak on`

Forbidden:

- voice reading provider/model details;
- voice reading evidence/debug details;
- voice presenting uncertain movement as fact.

