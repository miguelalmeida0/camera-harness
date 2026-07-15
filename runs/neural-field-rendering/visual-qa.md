# Neural Field Rendering Visual QA

Deterministic local-only fixtures were captured with explicit `sensefield-test=1`; no automatic recording, upload, or raw-media persistence was used. Depth styling represents relative depth only.
Each saved PNG passed a capture-paint guard that rejects transparent or near-black compositor tiles outside the camera stage.

## Refinement passes

1. **Composition — PASS.** Camera remains dominant; launcher/tool controls stay compact; Saved Actions and Recent Moments remain available.
2. **Trail and shader quality — PASS.** Evidence and stabilized AirScript trajectories remain distinct, bounded, depth-faded, and readable without decorative random motion.
3. **Object grounding and relations — PASS.** Lasso resolution produces a grounded mug anchor, ambiguity preserves the candidate loop, and only supported labeled relations render.
4. **Responsive polish and accessibility — PASS.** Six target viewports have no horizontal overflow; status, relation text, dismissal, label containment, and reduced motion remain available.

## Responsive containment

| Viewport | No horizontal overflow | Canvas contained | Labels contained | No vertical wrapping | Tool selector readable |
| --- | --- | --- | --- | --- | --- |
| 1728 × 1117 | PASS | PASS | PASS | PASS | PASS |
| 1440 × 900 | PASS | PASS | PASS | PASS | PASS |
| 1024 × 768 | PASS | PASS | PASS | PASS | PASS |
| 768 × 1024 | PASS | PASS | PASS | PASS | PASS |
| 412 × 915 | PASS | PASS | PASS | PASS | PASS |
| 390 × 844 | PASS | PASS | PASS | PASS | PASS |

## Renderer measurements

- Headless capture FPS: 119.17 (the separate render benchmark enforces the above-30 practical target)
- p95 render time: 1.30 ms
- Path point count: 175
- Canvas memory: 8920800 bytes
- Label layout: 0.00 ms
- Relation update: 0.00 ms

## Decoded PNG paint validation

The ratios below are computed by decoding each exact PNG before it is saved. Transparent pixels and near-black pixels outside the dark camera frame both count toward the rejected-pixel ratios.

| Capture | darkRatio | maxTileDarkRatio | Decoded samples | Result |
| --- | ---: | ---: | ---: | --- |
| `airscript-desktop.png` | 0.000000 | 0.000000 | 127822 | PASS |
| `airscript-mobile.png` | 0.000000 | 0.000000 | 20738 | PASS |
| `lasso-selected.png` | 0.000000 | 0.000000 | 91329 | PASS |
| `relation-rendering.png` | 0.000000 | 0.000000 | 91329 | PASS |
| `ambiguous-selection.png` | 0.000000 | 0.000000 | 24728 | PASS |
| `reduced-motion.png` | 0.000000 | 0.000000 | 91329 | PASS |

## Captures

- `airscript-desktop.png`
- `airscript-mobile.png`
- `lasso-selected.png`
- `relation-rendering.png`
- `ambiguous-selection.png`
- `reduced-motion.png`
