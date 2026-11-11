---
name: visual-parity
description: Visual alignment playbook — for pixel-level alignment of two implementations (prototype / old page / design), fix viewport and data, change only styles, classify differences with evidence; for UI restoration tasks.
---

# visual-parity — Visual alignment

## Trigger

Prototype → implementation, old page → new page, design → page, requiring "looks consistent".

## 0. Fix comparison conditions

Same viewport (width/height + DPR), zoom 100%, same theme, same data (seed IDs fixed). Service online and auth per `.agents/skills/verify-ui/SKILL.md` §1; technical details single source `scripts/verify/e2e/harness.mjs`.

## 1. Capture comparison

Screenshot the same region on both sides (including boundary elements), named `tmp/e2e-evidence/parity-<topic>-{before,after}.png`. Before screenshotting reset scroll position, disable animations and tooltips.

## 2. Diff classification (count item by item)

Spacing / font size and weight / color / layering and shadows / border radius / wrapping and overflow / scrollbars. Rendering noise (font antialiasing, subpixel) listed separately, not counted as to-fix.

## 3. Iterate

Change only styles and layout, not data, not backend, do not import prototype fonts. Re-screenshot the same region each round; diff items only decrease, never increase.

## 4. Criteria and evidence

To-fix items = 0 counts as aligned; do not claim "consistent" before clearing. Evidence: both sides' screenshot paths + viewport + diff table (item / before / after / status).

## Red lines

- Do not weaken the verification path (`.agents/skills/verify-ui/SKILL.md` "weakening the verification path to pass is forbidden").
- Do not substitute "it looks the same to the eye" for the diff table.
