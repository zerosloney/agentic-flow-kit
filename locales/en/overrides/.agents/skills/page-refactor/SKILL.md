---
name: page-refactor
description: Business feature page refactoring executor — refactor any business page/module following the pattern distilled from the purchase order (PO) template — shape inventory → target shape and table selection → build per references/templates.md (list page + create/view/edit entire module, supporting Drawer → overlay detail transition) → full assertion verification. Use when the user asks to "refactor a page / align with the purchase order page / refactor an entire module UI / refactor a list page / refactor a detail page".
---

# page-refactor — Business module refactoring (PO template pattern)

## Positioning

- **Refactoring scope = the entire feature module**: list page + create + view + edit refactored together, not just layout tweaks. Target shape = what PO / supplier pages look like now; when the current shape is far from target (e.g., Drawer-edit style), follow the "shape transition" path to close the gap.
- **Construction authority is** `references/templates.md` (S1–S12). This file keeps only inventory, red lines, and acceptance; read templates when entering the construction step, do not load the entire document during inventory. Replace class names (`xx-detail`/`xx-list`) per target page, replace fields/buttons/action set per target page business, keep layout skeleton and mechanisms verbatim.
- **Fit the target project's current state**: table technology, shared components, and infrastructure are selected according to the target project's actual situation (see "Table technology selection" and "Infrastructure dependencies and degradation table"); do not force new dependencies.
- **Provenance**: templates distilled from this repository's purchaseOrder and supplier page refactors (2026-10, from commit `e6f33915` onward in a series of iterations), verified through multiple rounds of L1 plan full assertion verification in that series.
- **Template reference (optional)**: if the target branch has already-refactored template pages (`frontend/src/views/purchase/purchaseOrder/index.vue`, `detail.vue`, `shared.ts` (list/detail shared constants), `frontend/src/views/baseData/supplier/detail.vue`), you may consult them; **when the template does not exist or conflicts with the templates, `references/templates.md` prevails and report the difference to the user** — never overturn the templates with an old template version.
- **Backfill obligation (anti-drift)**: when this repository's template pages evolve later, backfill the corresponding fragment in `references/templates.md`; if drift is found, first record one line in `workflow/papercuts.md`, do not fix it opportunistically on the spot.
- **Cross-branch/cross-repo carry**: copy both this file and `references/templates.md`. Copying only this file gives no construction templates. **Authoritative source = these two in this repository**; carried copies do not flow back and drift is the carrier's responsibility. **This repository exception**: host adaptation directories (`.trae/`, `.opencode/`, `.codebuddy/`) hold only pointer shells per repository discipline; full-text copies are forbidden.
- This skill is a **refactoring pattern knowledge + hard-constraint layer**: when used in this repository it still follows the project workflow (L1 plan → confirmation gate → build → UI verification → close-out); other repositories follow the "Infrastructure dependencies and degradation table".

## Step 0: Shape inventory (mandatory; skipping is a violation)

1. Read the target page `index.vue` / `detail.vue` (if any) / Drawer components (if any), inventory:
   - **Target shape** (look at business structure, not current implementation): entity has detail lines/related documents → **A master-detail**; entity is pure form without details → **B pure form**; read-only with no edit and no detail → **D pure query**.
   - **Current shape**: already has overlay detail component → layout-rearrangement path; Drawer editing (create/edit/view inside a Drawer) → **shape transition path** (see "Shape transition construction flow").
   - **Table technology status**: whether the target project already uses AG Grid (check package.json / existing page imports); if not → list it as an **S12 one-time integration item** (done along with this refactor, not an optional decision).
   - **Infrastructure status**: probe item by item against the "Infrastructure dependencies and degradation table".
2. Produce **refactor item list + selection/degradation decisions + open questions** (e.g., whether this page has no batch operations, whether the detail table deserves tabbing) → AskUserQuestion for the user to confirm scope.
3. Only after user confirmation, create the plan and enter construction. **Skipping inventory and applying templates directly is forbidden.**

### Shape adaptation matrix (target shape × current shape)

| Target shape | Business characteristic | Currently already overlay detail | Currently Drawer-typed (transition) |
|---|---|---|---|
| **A master-detail** (PO type) | Entity has detail lines (± related documents) | Apply the full D-1~D-7 set directly | Follow "shape transition construction flow" → new detail.vue (A skeleton) + Drawer business migration and decommission |
| **B pure form** (supplier type) | Entity is pure form without details | Apply D-1 + D-8 directly; **do not apply upper/lower half tabs / height model** (no detail table; applying them will fail) | Follow "shape transition construction flow" → new detail.vue (B skeleton) + Drawer business migration and decommission |
| **D pure query** | Read-only list, no edit and no detail | N/A | N/A — only list page refactoring |

> **Mixed shape** (view = overlay, edit/create = Drawer, e.g., the purchase order page at baseline 4d363c4): judge by the "currently Drawer-typed" column — follow the transition path; existing view-state overlay content is also moved into the new detail.vue's view state (carried by the D-2 read-only grid), and old view-state code is decommissioned in the same batch as the original Drawer — dual detail entries for the same entity must not coexist.

## Table technology (list page, unified AG Grid)

**Effect criteria (assertion gate verifies against this)**:
1. Column order = definition order (checkbox → sequence number → document number…), zero visual order confusion
2. Column width adapts: primary text columns take remaining width, zero `...` truncation in headers; narrow columns fixed width
3. Row-action hover overlay replaces the fixed action column (saves an action column width on the order of 280px)
4. Row scrolling contained inside the table body, zero outer scrollbars; pagination footer pinned to bottom

**Selection rules**:
- Target project **already uses AG Grid** → build directly per S5-S8.
- Target project **does not use AG Grid** → **integrate directly as one-time S12** (dependencies + license injection + global visuals + Chinese locale + page-level component template, full set), then build per S5-S8. **Using a-table to simulate equivalent effect is forbidden** — the effect is unreachable and introduces a second table convention, which is a wrong path.

## List page refactoring patterns (4 patterns)

| # | Pattern | Key points |
|---|---|---|
| L-1 | Toolbar left/right grouping | Left group document-level (create/export); right group batch buttons linked to checkboxes, `margin-left:auto` to the right + vertical separator; batch eligibility same-source in three places (inline buttons/batch set/checkbox selectable, same guard criteria) |
| L-2 | Column order and width adaptation | Effect criteria see "Table technology"; implementation see S7 (contiguous leading columns may be pinned left, others not pinned; primary columns flex, narrow columns fixed width) |
| L-3 | Row-action hover overlay | Remove fixed action column; actions that do not meet eligibility are not rendered, zero-action rows do not pop out; overlay follows the hovered row's inner right edge; DOM event delegation (S6) + action set (S12); confirm with centered Modal.confirm |
| L-4 | Height chain and pagination footer | Root container pinned to content area + table card `flex:1` takes remainder + footer pinned to bottom; row scrolling contained inside grid, no outer scrollbar (S8) |

## Detail page refactoring patterns (8 patterns; target shape A full set / target shape B only patterns 1 and 8)

| # | Pattern | Key points |
|---|---|---|
| D-1 | Top row merged | `DetailPageHeader`: back button + `#meta` (document number/status tag) + `#extra` (action buttons) on the same row; standalone action row forbidden |
| D-2 | Upper half basic info tab | View state `a-descriptions` → `a-form` read-only grid (`info-grid`), unified with edit state: 4 columns (`lg:6`) / label left-right 106px / compact spacing / long text span 24 |
| D-3 | Lower half multiple tabs | Detail table + related documents each one tab (`v-model:activeKey`); original title block removed (tab name carries it) |
| D-4 | Height model | Upper half pure content height (`flex: 0 0 auto`); lower half `min-height: calc(var(--layer-h)/2)` + `grow` to fill; `--layer-h` injected by ResizeObserver (CSS percentages fail in stretchable containers); overflow beyond one screen is taken over by outer `.detail-layer` scrolling |
| D-5 | Toolbar merged into tab row | Detail action buttons placed in `#rightExtra`'s `.tab-extra-row` (self-contained flex container) + maximize button; saves an entire row |
| D-6 | Lower half maximized | `is-maximized` (lower half `height:auto` fills) + upper half `is-hidden-by-max` (display:none); toggle shared by both states, closing detail auto-resets |
| D-7 | In-table scrolling | No outer scrollbar; flex chain `min-height:0` at every layer down to `.ant-table-content` (`overflow-y:auto !important`) |
| D-8 | Pure form pinned bottom | Target shape B: `.detail-layer` white background (`--bg-container`) + detail root `min-height:100%; flex column` + card `flex:1` + footer `sticky bottom:0` white opaque |

## Shape transition construction flow (Drawer-typed → overlay detail; create/view/edit entire module moved onto overlay)

Transition trigger: target page is currently Drawer-edit typed, and the user's requested refactoring scope includes create/view/edit (full-module refactoring includes them by default).

1. **Read the Drawer's current state thoroughly**: form field bindings, validation rules, save flow (API calls and post-success behavior), view-state content source — transition is **moving, not rewriting**; migrate business logic verbatim. In mixed shape, "view-state content source" = the existing overlay view-state code in index.vue (it is the moving source for view state; likewise read it thoroughly and move it).
2. **Create `detail.vue`**: target shape A uses the S1-S4 skeleton (upper/lower half tabs), target shape B uses the S9 skeleton (form card + sticky footer) + S11 header component; three-state entry `props.mode: 'create' | 'edit' | 'view'`:
   - Edit/create state: field bindings, rules, save handler, API imports **moved verbatim** from the Drawer (no opportunistic semantic changes); submission payload field-by-field identical to the original Drawer.
   - View state: read-only grid (D-2) carries the original view content; action buttons go into `#extra`.
3. **Mount overlay on list page**: `.detail-layer` + Transition (S8 CSS); all original "create / edit / view" entries changed to open the overlay (`detailState = { mode, id }`).
4. **Decommission and delete the original Drawer**: editing capability for the same entity **must not have dual entries** — leftover Drawer causes future drift of two submission payloads (reconciliation blind spot); after confirming no other references, delete the whole block. In mixed shape, the existing view-state overlay code is decommissioned in the same batch (view capability has been merged into the new detail.vue; dual detail entries forbidden).
5. **Reconciliation red line**: transition does not change contracts — API contract, query parameters, submission payload unchanged field by field; post-save list refresh and close behavior aligned with existing convention; eligibility criteria remain same-source in three places.

## Infrastructure dependencies and degradation table (probe before starting; trim refactor items by availability)

| Refactoring capability | Dependency | Degradation when missing in target repo |
|---|---|---|
| D-1~D-7 detail page layout | No external dependency (antd suffices) | No degradation needed, fully applicable |
| D-8 pure form pinned bottom | No external dependency | No degradation needed |
| DetailPageHeader shared header | Component exists | If missing, create directly from the full S11 text (69 lines, required props + slot contract) |
| L-1 toolbar grouping / L-4 height chain | No external dependency | No degradation needed |
| L-2/L-3 table effects (AG Grid) | `ag-grid-community` + `ag-grid-vue3` + `ag-grid-enterprise` (this repo ^35.3.1); Chinese locale module; license key (runtime injection) | **Integrate directly, no degradation**: full S12 migration (dependencies / main.ts registration / license injection mechanism / global visual CSS / locale / component template); once installed and configured, it matches the template's effect |
| Row action button group | Page-level RowActions-like component | Build the button group per target page action set (the "action eligibility criteria same-source" principle unchanged) |
| Full assertion verification | This repo `scripts/verify/e2e/harness.mjs` (technical single source) | If missing, write a minimal node CDP probe per the S10 skeleton — the assertion checklist loses no item |
| Workflow (plan/confirmation gate/close-out) | This repo `AGENTS.md` + `workflow/` | Baseline clauses cover it: refactor plan confirmed by user before starting + full assertion verification + evidence screenshots archived |
| Notification guard / URL state / other conventions | This repo `utils/notify.ts` / `utils/listUrlQuery.ts` etc. | Follow the target repo's existing convention; this repo's conventions (G-3/LP-1/BC-1/BC-2/BC-4) are mandatory only when the corresponding infrastructure is present |

**AG Grid integration** (when target project does not use it): full integration steps and all configuration templates are in S12 — the three dependencies, main.ts module registration, license key runtime injection mechanism (plaintext key not in repository), global visual CSS, Chinese locale acquisition, CustomTooltip / empty state / document-number link / row-action-set component templates; once installed and configured, it matches the template's effect.

## Trigger conditions

- The user asks to refactor a business feature page/module (list page, create/view/edit, layout rearrangement), or "make it look like the purchase order page".

## Construction templates

S1–S12 are in `references/templates.md`. Read them when entering the construction step; do not load the whole document during inventory.
Inventory, hard red lines, and verification gates follow this file. When the templates conflict with the template page source, the templates prevail; first record in `workflow/papercuts.md`, do not change the templates on the spot.

## antd pitfall list (must-read before construction; each empirically verified)

| # | Pitfall | Solution (see S snippet) |
|---|---|---|
| T1 | a-spin root is actually `.ant-spin-nested-loading`, the custom class on the component **does not land on the root** — class-based selection fails across the chain and the whole area collapses to 0 | Select by antd structural classes (S1) |
| T2 | `.ant-tabs-extra-content` is not flex by default; a block-level button group pushes the maximize button to the second row | `#rightExtra` contains its own `.tab-extra-row` flex container (S1/S4) |
| T3 | tabs content area is not flex by default; one broken layer collapses the whole area to 0 | `.ant-tabs / content-holder / content / tabpane-active` each layer `min-height:0` (S1) |
| T4 | When container height is indeterminate (stretchable), child percentage min-height/height resolution fails | ResizeObserver injects `--layer-h` variable, absolute pixel calculation (S2) |
| T5 | a-table has another spin layer inside (wrapper > spin > container > table); missing one `.ant-table` flex:1 breaks it and the table body compresses to 0 height | In-table scroll chain includes `.ant-table-wrapper` and both spin layers (S1) |
| T6 | antd pure horizontal scrolling inlines `overflow-y:hidden`, so table body vertical scroll fails | `overflow-y:auto !important` on `.ant-table-content` (S1) |
| T7 | `a-row :gutter` negative margins (-4px per side) push out horizontal panel whitespace | Upper-half container explicit `overflow:hidden` (S1) |
| T8 | antd small screen (<576px) makes label fill the whole row, becoming vertical | Force horizontal label convention `width/flex/padding !important` (S1) |
| T9 | a-tag pill is filled across the whole column by "baseline zeroed and stretched", becoming a full-column color block | Stretch selector excludes with `:not(.ant-tag)` (S1) |
| T10 | AG Grid `rowMouseEnter` callback empirically does not fire (neither real nor synthetic mouse) | DOM event delegation mouseover/mouseout (S6) |
| T11 | AG Grid pinned-left container renders first; pinning middle or action columns left disrupts the "checkbox→sequence→document number" visual order | Only pin a contiguous leading run in definition order; multi-select column uses selectionColumnDef; others not pinned (S7) |
| T12 | Chrome re-dispatches mouseover on the row revealed after the overlay leaves the DOM; after entering detail the overlay rebuilds and blocks | Toggle overlay display entry to a fuse that opens when detail layer opens (S6) |
| T13 | Overlay not in scroll viewport, card overflow:hidden, wheel falls through | Overlay manually forwards wheel to `.ag-body-viewport` (S6) |
| T14 | Global style `.ant-card-body` has `!important` padding, footer pinning fails | High-specificity `padding:0 !important` override (S8) |
| T15 | Vue reactive Proxy interferes with AG Grid internal state | gridOptions uses a plain object (S7) |
| T16 | Detail page detail a-table without `:scroll.y` does not vertically scroll the table body by default; "in-table scrolling" silently fails | CSS force chain `.ant-table-content { overflow-y:auto !important }` (S1) |

## Hard red lines (change-forbidden list; violation = rework)

1. **Do not touch the overlay mechanism**: `.detail-layer`'s `position:absolute; inset:0; overflow-y:auto` and the "list instance stays alive" convention preserved verbatim.
2. **Zero contract change**: API contract, query parameters, submission payload unchanged field by field (shape transition = moving, not rewriting; submission payload reconciled field by field before and after migration); inline buttons/batch eligibility/checkbox selectable same-source in three places; backend error messages displayed as-is.
3. **No dual editing entries**: after the transition completes, the original Drawer must be decommissioned and deleted — dual entries for the same entity's editing capability cause future submission payload drift (reconciliation blind spot).
4. **Both states on the same chain must be tested**: when view state and edit/create state share the height chain, **both states must be verified**; testing only one does not pass.
5. **Minimal change**: only touch target module files + shared component slot-level increments; no opportunistic refactoring, no formatting unrelated code, no fixing unrelated Lint warnings; when moving templates, handlers stay verbatim.
6. **Keep mechanism comments in sync**: layout changes must synchronize existing mechanism comments in the file (height model/chain comments) to prevent comments and code diverging; mechanism comments within snippets in this document are preserved verbatim when implemented.
7. **Notifications and list state**: if the target repo has unified notification guards / URL state management infrastructure, always use the infrastructure (e.g., this repo's `utils/notify.ts` / `utils/listUrlQuery.ts`); never bypass.

## Verification gate (full assertion verification; missing items do not pass)

Static gate: `cd frontend && npm run build` (or the target repo's equivalent strict type build gate).

UI verification: headless Chrome CDP probe — this repo's technical details import the single source `scripts/verify/e2e/harness.mjs` (do not hand-write equivalent logic); if the target repo lacks this infrastructure, write your own per the S10 skeleton. One-off probes go in the **git-ignored area outside the repo** (this repo `tmp/e2e/`), screenshot evidence archived; read-only probes leave no dirty data (data produced by the transition save-flow test is deleted precisely by response ID); close all self-started processes at the end. Check the corresponding assertion group per refactor item:

**Detail page (target shape A, when D-1~D-7 are all changed)**
- [ ] Height chain: upper half pure content height (tall viewport `topH < half`, `clientH == scrollH`); lower half `≥ half`; `top+bottom == layerH` (whole page filled, no bottom whitespace)
- [ ] No outer scrollbar: `.detail-layer` `scrollHeight == clientHeight` (regular viewport)
- [ ] In-table scrolling takeover: table body `overflowY == auto`; compressed viewport (e.g., 1440×520) reverse branch — upper half pure content expands, lower half locks to half screen, outer scrolling takes over
- [ ] Maximized state: upper half `display:none`, `bottomH == layerH` fills, model restores after restore
- [ ] Toolbar merge: button group centerline aligned with tab nav centerline, tab row not taller, buttons left of the maximize button and inside `.ant-tabs-extra-content`
- [ ] Two-state regression: view state + edit/create state each run once under the same criteria; edit-state action button functionality does not regress (handler binding unchanged)
- [ ] Tab switching: each tab header present, switching does not cross-contaminate data

**Detail page (target shape B, D-1/D-8)**
- [ ] White background fills (including list shorter than one screen); buttons pinned to bottom (shorter than one screen) + sticky pinned to bottom (scrolling beyond one screen, footer.bottom constant at two positions, opaque)

**Shape transition special (Drawer → overlay)**
- [ ] Three states reachable: list "create" → create-state overlay, "edit" → edit state, "view" → view state, rendered correctly
- [ ] Save flow does not regress: create/edit save submission payload field-by-field identical to the original Drawer (network payload comparison); after save, list refresh and close behavior aligned with existing convention
- [ ] Original Drawer decommissioned: no residual Drawer mount on the page, old entry buttons do not trigger old interactions
- [ ] Form validation does not regress: required-field validation, backend 400 messages displayed as-is per original convention

**List page (L-1~L-4)**
- [ ] Column order: checkbox → sequence → document number… visual order equals definition order (left pinning only on this contiguous leading run), no `...` truncation in headers
- [ ] Toolbar: left group/right group each on its side, batch button disabled linked to selection, count correct
- [ ] hover overlay: rows with available actions pop out on hover and are vertically centered on the row, zero-action rows do not pop out, refresh on row change, delayed hide on leave, overlay does not disappear when hovering itself, overlay wheel scrolls the table, overlay not rebuilt after entering detail layer (real mouse path)
- [ ] Row scrolling contained inside grid, no outer or page scrollbar; pagination footer pinned to bottom

**General**
- [ ] Console exceptions cleared (if AG Grid license key is injected there is no trial banner; when not injected the banner is known noise, excluded)
- [ ] List state restored after closing detail layer (scroll position/filter not lost — overlay mechanism verification)

The probe produces an `N PASS / M FAIL` summary and evidence screenshot paths; backfill task acceptance criteria, then run the close-out flow (this repo `.agents/commands/stages.md` Test chapter).

## Execution flow overview

```
Trigger this skill
  → Step 0: read target page inventory (target shape A/B/D × current shape) + AG Grid integration probe + infrastructure degradation probe
  → produce refactor item list + degradation/open-question decisions → user confirms scope (AskUserQuestion)
  → create plan (this repo L1; when transition includes new components, the change list is itemized per file) → approach confirmation gate
  → before construction read references/templates.md (S1–S12)
  → construction:
      table infrastructure: target project does not use AG Grid → first integrate one-time per S12 (dependencies/license/visuals/locale/component templates)
      list page: S5-S8 (toolbar grouping / column order and width / hover overlay / height chain footer)
      detail page: already overlay → S1-S4 rearrangement; Drawer-typed → "shape transition construction flow" + S1-S4/S9 skeleton creation
      → self-check the pitfall list T1-T16 item by item
  → verification gate: build static gate + full assertion verification (including transition specials) → PASS/FAIL summary + screenshot evidence
  → close-out (backfill acceptance evidence); template/skill drift recorded in papercuts (this repo)
```
