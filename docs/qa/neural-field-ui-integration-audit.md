# Neural Field UI integration audit

Root cause: `localhost:4177` previously served the older source worktree on `checkpoint/sensefield-stable-single-voice-2026-07-11` at `5beec367`. That checkout does not contain the Neural Field primary UI. The correct integrated implementation is on `feature/sensefield-neural-field-pro` in `/Users/malmeida/Documents/Development/camera-harness-neural-field-integration`; this was a worktree/branch mismatch, not stale browser cache.

| Feature | Production implementation | Mounted | Visible | Functional | Blocker |
|---|---|---:|---:|---:|---|
| Neural Field entry | First-class Ask / Watch / Neural Field selector backed by the canonical lifecycle | Yes | Yes | Yes | None |
| AirScript | Hand geometry → pinch → trajectory → classifier → renderer event flow | Yes | Yes | Yes | Physical real-hand acceptance remains manual |
| Spatial Lasso | Closed-lasso validation → fresh scene commit → grounding event flow | Yes | Yes | Yes | Fresh spatial-service evidence is required |
| Hand worker | One lifecycle-owned local gesture worker | Yes | Status shown | Yes | None; duplicate presentation worker is disabled |
| Stroke renderer | Visible canvas renderer driven by sanitized perception events | Yes | Yes | Yes | None |
| Shape classification | Production trajectory classifier for supported shapes and uncertain freeform | Yes | Yes | Yes | Conservative confidence thresholds are intentional |
| Lasso renderer | Production lasso path, closure validation and uncertainty states | Yes | Yes | Yes | None |
| Object grounding | `groundSpatialLasso` over fresh scene evidence | Yes | Yes | Yes | Missing or ambiguous evidence cannot produce a grounded claim |
| Relation grounding | Production relation contract and connector renderer | Yes | Yes | Yes | Requires two grounded objects and a supported relation |
| Manual confirmation | Grounded labels and relations remain candidates pending user confirmation | Yes | Yes | Yes | Autonomous-action claims remain blocked |
| Tracking-loss UI | Explicit tracking refresh, loss state and renderer grace cleanup | Yes | Yes | Yes | No continuous cloud polling |
| Replay consent | Bounded, local sanitized-event replay with explicit consent and save/discard | Yes | Yes | Yes | Raw camera, microphone and landmark payloads are excluded |
| Exit to Ask | Canonical teardown followed by the Ask surface | Yes | Yes | Yes | None |
| Exit to Watch | Canonical teardown followed by the Watch surface | Yes | Yes | Yes | None |

Deterministic browser proof uses an explicit localhost-only test bridge to supply safe synthetic video pixels, landmarks and scene inputs. Those inputs traverse the production geometry, pinch, trajectory, renderer, grounding and relation paths; they do not inject final UI success. No fixture controls or final-state shortcuts were added to the ordinary production UI. This automated proof is not a substitute for the manual physical camera and real-hand protocol.
