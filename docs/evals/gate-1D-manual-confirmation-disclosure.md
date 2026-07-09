# Gate 1D Manual Confirmation Disclosure

## Rules

- Manual confirmation is allowed for Gate 1D.
- Manual confirmation must be visible to the user.
- Manual confirmation must be included in event evidence.
- Manual confirmation must not be called automatic vision.
- Manual confirmation cannot support portfolio or demo claims.
- Manual confirmation cannot bypass Gate 1C.

## Required UI Language

If manual confirmation is used, the app must label it as one of:

- `manual confirmation`
- `operator confirmed`
- `manual local confirmation`

The app must not label manual confirmation as:

- `automatic vision`
- `AI detected`
- `vision confirmed`
- `model verified`
- `camera understood`

## Required Evidence Shape

Any manually confirmed event must include symbolic evidence indicating:

```json
{
  "source": "manual_local_confirmation",
  "operator_visible": true,
  "contains_raw_media": false
}
```

## Gate Boundary

Manual confirmation can make Gate 1D tryable. It cannot make Gate 1C pass unless a valid physical replay trace is exported and replayed. It cannot support minimal HUD polish, cinematic polish, portfolio demo claims, or production-quality claims.
