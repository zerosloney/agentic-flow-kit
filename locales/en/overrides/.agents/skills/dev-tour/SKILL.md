---
name: dev-tour
description: Turn spec/plan steps and changed files into an interactive development tour (overview/timeline/data flow/flow diagrams + file tree + change notes on the right). Used for the AI-Native development gap where "the document explains it but you cannot see which files change".
---

# Development tour (Dev Tour)

## Goal
Turn "steps × changed files" in workflow documents into a clickable map: left file tree (added/modified/planned badges), center overview/timeline/data-flow/flow diagrams, right per-step change notes and diff. Solves the gap "spec/plan reads fine but you do not know which file the AI is changing".

## Trigger conditions
- After drafting/confirming a plan (`## 任务拆解` or `## 步骤` + `## 改动方案` persisted) → run `auto-tour.mjs` to auto-start the dashboard and produce a live link.
- Refresh once after each batch / task completed in Build stage.
- Before close-out, do scope reconciliation: "actual changes outside the document" appearing in the map must first be explained or backfilled into the plan.
- User says "can't see which files are changed" "show me the timeline/flow/overview".

## Data contract (write documents this way)
The generator does not create a separate ledger; it reads documents + git directly:

1. **Steps** (priority high to low)
   - `## 步骤`: `1. **T1 title**: one-sentence description`
   - `## 任务拆解`: `- [ ] 1. title` + indented `- 文件：path` / `- 判据：…` / `- 留痕：…`; or `### T1 · title` subheadings (body detail lines close with the step). **Each implementation step has at least one file; pure verification steps state `验证步骤` in the title**
   - `### 批次 0a：…` headings under `## 改动面` / `## 改动方案`
   - If none: group by the architecture layer the file belongs to (**layer fallback = parse failure signal**; generator prints a "parse hits" line and the page top shows a warning bar; normalize headings then regenerate; `--strict` rejects production with exit 1)
2. **Per-step files**
   - In `## 改动方案` align with step numbers using `- **T1**：` or `### T1`, write backticked paths inside the block.
   - L1 single-file plans may write `- \`backend/.../Foo.cs\`：what to do` directly in `## 改动方案`; each top-level file entry automatically becomes one station.
   - Write full paths when possible; only writing `detail.vue` / `MaterialCodePushService.cs` also resolves by same-named repo file and step context, but full paths are most reliable. With multiple same-name candidates the generator scores by step context and guesses one: that file entry carries a `pathGuess` flag (page shows a "guess?" uncertainty badge), hit line counts "path guesses Z"; a unique basename hit is deterministic and not counted as a guess.
   - Non-backticked mid-path tokens with code extensions and resolvable paths are also collected: bare tokens like `pml/index.vue` in step titles/body/table rows (containing `/` + a known code extension + resolvable to a real repo file) enter the model and are assigned to their step; mixed tokens (`if/else` etc.) are always rejected. When unbound files are assigned by body fallback (basename or layer-word arm) they all get `pathGuess`; the layer-word arm binds only when exactly one step body contains that layer word; ambiguous ones stay unbound and visible as "unassigned".
   - Table row paths are also collected: `| \`path\` | description |` rows in `## 改动方案` are assigned to the current block/batch anchor (including tables inside `### 批次` subsections); without an anchor they go to "change surface (unassigned)". Task row labels support union-style `1. S1+S2：title` (block anchor matched by member intersection; parenthetical `（**S3**）` also anchors); resolution never fabricates — directory back-inference/anchor splicing must land on real repo files; unresolved paths remain as visibly unresolved.
3. **Test files**: write in `## 验证计划` or the corresponding step; test steps close automatically.
4. **Dependencies** (optional, side-arc data source for the flow diagram)
   - Clause lines in `## 执行顺序` like `依赖：3 依赖 1；4/5 依赖 2 与 3；8 依赖 4~7；10 依赖全部` (arrow chain lines `1 → 2 → 3` are expressed by the main chain itself and do not produce duplicate edges).
   - Or in task lines `- 依赖：T1、T2`.
   - Numbers normalized by step sequence / `Tn` / label id; unresolvable references counted into `deps.unresolved` and warned.
5. **Actual changes**: `git diff --base` automatically fills status, line counts, and diff; files not registered in the document go to "actual changes outside the document" and are not silently dropped.

## Generation / refresh
```bash
# static snapshot (default .agents/cache/tours/<type>-<name>.html)
node .agents/scripts/gen-dev-tour.mjs workflow/plans/<name>.md

# compare the entire committed task (default HEAD = current uncommitted working tree)
node .agents/scripts/gen-dev-tour.mjs workflow/plans/<name>.md --base origin/main

# model only (debug parsing)
node .agents/scripts/gen-dev-tour.mjs workflow/plans/<name>.md --json

# gate mode: reject production on layer fallback/no steps/implementation step without files (exit 1; pure verification steps exempt by title)
node .agents/scripts/gen-dev-tour.mjs workflow/plans/<name>.md --strict
```

Each generation prints a "parse hits: direct X/Y steps … · path guesses Z" line — if the direct-hit rate <100%, first check whether headings broke the contract, then decide whether to accept fallback grouping; after the hit line it prints "⚠ line N: <title>: <reason>" line by line, locating contract breaches to lines (step has no aligned file block / file block anchor aligns with no step / dependency reference unresolved / layer fallback triggered, corresponding to `parseHealth.issues` `{line,title,kind}` in the model; `pathGuess` and issues are advisory and never participate in `--strict` production rejection). The page-top warning bar consumes the same issues: merged by `kind` into "file block unaligned / step missing files / dependency unresolved" classes, expanded line by line within groups; entries in `step-no-files` whose title contains "验证步骤/单测/UI 实测/静态门" are listed separately as "verification steps" and not counted as to-fix.

Live version (recommended to keep open during Build):
```bash
# auto-start dashboard + print this plan's live link (idempotent reuse, no browser popup; failure only warns, does not block)
node .agents/scripts/auto-tour.mjs workflow/plans/<name>.md
# → http://127.0.0.1:8933/tour?file=workflow/plans/<name>.md

# start dashboard only, no document specified
node .agents/scripts/ensure-board.mjs
```
The live page pulls `/api/tour` every 5s; document save / working-tree changes redraw automatically, preserving the currently selected step and view.

## Views
- **Overview**: default grid (one large card per station, read by number); top-right "Layout" switches to a horizontal timeline; "Focus overview" hides left/right columns, 6 stations usually fit in two rows.
- **Timeline**: arrows connect per-step files by architecture layer (frontend → API → application → domain → infrastructure → DB); test steps add dashed verification arrows.
- **Data flow**: statically identify cross-file data objects (Dto/entity/table) from diff added lines and document body, show layers and files the object flows through by architecture-layer swimlanes, and list "definition step → usage step" transfer edges; clicking an object links steps/files (data from model dataflow, schema 2; view hidden when no recognized result).
- **Flow**: plan → steps → verification gate → close-out; verification gate reads `## 验证计划`. When model `deps.edges` is non-empty, the main chain's left thin rail draws side arcs for declared dependencies (transitively reduced; adjacent main-chain edges not drawn twice; pointing to a prior row = anomalous reverse dashed line); hovering a step highlights its upstream/downstream arcs and counterpart steps.
- **Requirements**: follow "corresponding entry/spec：…" links to read upstream documents (one level, no recursion, at most 3 documents), render this document's goal + upstream intent/spec/incident goals and behavior/acceptance points (model `doc.upstream`); view hidden when no upstream docs, requirement narrative then only this document's purpose.
- **Verification**: left plan checklist (`## 验证计划`), right actual evidence — local `.agents/verifications.jsonl` preferred, repo `workflow/verify-evidence.md` fallback merged (dedup by ts+head), take the latest 10 within the document date time window (model `evidence`). The association semantics is "verification evidence within the task time window", not per-item binding; the flow verification gate also shows the latest evidence within the window; view hidden when none.
- **Interlink**: clicking a station/file/step card/timeline message syncs the left tree and right notes; `←/→` switch steps, `Esc` clears; "Follow the flow" auto-plays.

## Applicable scale (verified 2026-11-11)
Reproduction: `node .agents/tests/tools/gen-synthetic-plan.mjs --bench` (synthetic plan lands in `.agents/cache/tour-perf/`; build timing uses `buildTour({git})` injecting 300 modified files, max of 3 rounds; HTML generated by `gen-dev-tour.mjs --no-diff`, git side is the real working tree at that moment, size dominated by the document side).

| Tier | buildTour (300 diff files injected) | Static HTML size |
| --- | --- | --- |
| 10 steps | 317–332 ms | ~100 KB |
| 30 steps | 348–350 ms | ~131 KB |
| 60 steps | 474–483 ms | ~178 KB |

Boundary statement: verification covers ≤60 steps / 300 diff files, and within this range build time has no knee (far below 5s); beyond this range unverified, do not conclude by linear extrapolation. Browser-side verification (Chrome, file:// static page, 60-step tier): 1868 DOM nodes per page, 289ms load, six-view switching 14–22ms each — no virtualization needed at this magnitude.

## Boundaries
- The document is the plan side, git is the actual side; on conflict the map shows split columns (plan / outside document).
- Does not replace the plan's acceptance criteria and `check-scope.mjs`; it only visualizes the same facts, adding no new source of truth.
- Generated artifacts default to `.agents/cache/tours/`, not committed; to archive use `--out wiki/...` or screenshots, do not stuff HTML into workflow/.
- View usage data (`/api/tour/usage`) lands only locally in `.agents/cache/tour-usage.jsonl`, not committed or sent out; after one iteration trim the least-used views by usage rate (data-flow view is the primary observation target), do not build a query aggregation page, use node directly for stats.
- Engine surface (`.agents/`) changes still go through `check-scripts-syntax` and other gates; this skill waives no gate.

## Acceptance
- [ ] Document has ≥1 step; each step has at least one file, or is explicitly `验证步骤`.
- [ ] "Parse hits" has no layer fallback (no page warning bar); fallback = heading contract breach, fix the document first.
- [ ] "Actual changes outside the document" in the map is empty, or explained/backfilled.
- [ ] The four views switch without blanks; clicking a file locates the step and diff.
- [ ] The live page shows "live" next to the title, falls back to "polling" when disconnected.
