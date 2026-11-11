---
name: verify-ui
description: UI change verification (read-only verification, no dirty data left). First choice chrome-devtools MCP — take_snapshot to explore shape + single-step drive + screenshot evidence; harness .mjs scripts are only a fallback path for regression/unattended runs, and any fallback must record one line of reason in the verification report.
---

# verify-ui — UI verification guide

## Division of labor
- This file carries only the method (environment / selection points / evidence / cleanup); the execution contract (environment safety / no self-repair / HALT etiquette / deliverable shape) is single-sourced in `.agents/roles/ui-verifier.md`.
- Delegated subagents follow the contract; the main agent verifying itself follows this file.

## Trigger conditions
- User requests: `verify` / `UI verification` / `browser verification`.

## Tool path priority
- Interactive UI verification defaults to chrome-devtools MCP: the browser instance is reused throughout; first `take_snapshot` to explore shape, then drive single-step, retry locally.
- harness scripts are used only for: regression / anti-recurrence assets; batch assertion summary + exit-code gates (`makeRecorder`); unattended / pipeline batches.
- Degradation ladder (established 2026-11-04, revised 2026-11-11): chrome-devtools MCP is the first choice; harness probes are only a fallback path. **Host has no chrome-devtools tools (MCP not installed / not connected)**: when attended, HALT and prompt the user to install / enable chrome-devtools MCP, do not auto-degrade (probes are too slow); only unattended / overnight batches degrade directly to harness headless probes. **MCP installed but not working** (browser cannot start and still fails after handling per runtime-env §6.4 / critical steps blocked by MCP errors): degrade to harness headless probes. Every degradation must record one line of "degradation reason" in the verification report — a probe verification without a degradation reason = path violation, the report is not accepted.
- Script technical details single source = `scripts/verify/e2e/harness.mjs` (export list: `grep '^export' scripts/verify/e2e/harness.mjs`); when writing scripts import its exports, do not hand-write equivalent logic.

### Capability mapping (harness ↔ MCP)

| Goal | MCP | harness |
|---|---|---|
| Session seeding | API fetch token → `evaluate_script` write `auth_token` / `auth_user` → `navigate_page reload` | `getToken` + `seedSession` |
| Navigation / waiting | `navigate_page` + `wait_for` | `goto` / `hardGoto` / `reload` |
| Shape exploration | `take_snapshot` (a11y tree + uid) | `inventory` / one-off probe |
| Driving | `click` / `fill` / `press_key` | `clickText` / `setInput` / `pressKey` |
| Network capture | `list_network_requests` | `installNetCapture` + `apiCalls` |
| Console capture | `list_console_messages` | `installConsoleCapture` + `consoleErrors` |
| Metrics / screenshots | `evaluate_script` / `take_screenshot` | `ctx.evaluate` / `ctx.screenshot` |

### Session and capture rules (same criteria for both paths)
- Reach the FE origin before injection; same-document hash switches do not reload the document, after seeding a full-page reload is required.
- Default identity = JWT claims of the seeded token; only when testing "an identity different from the token" manually seed `auth_user` (take the login response's `jobNo` / `displayName` / `dept`).
- Synthetic JWT only applies to pages calling zero-authorization APIs: `exp = Math.floor(Date.now()/1000) + 1800`, never write far-future; after injection go through about:blank and then hard-navigate.
- If the page issues token-bearing APIs and 401 clears the session back to `/login`: for real data dependencies use account-pool login (account pool single source `.agents/notes/runtime-env.md` §6.1a).
- Exclude OPTIONS preflight from request counts; assertion counts use API responses, do not count DOM (virtual scrolling / virtual columns render only the visible window).
- Before asserting "zero console errors", filter the application's own noise (AG Grid license banner, Network Error from API not started); filter by content features, do not use `^` line-start anchors.

### MCP session differences
- MCP uses a persistent profile (localStorage retained across rounds): clear localStorage before seeding, or pass `isolatedContext` to `new_page`.
- On "The browser is already running for …chrome-profile" → kill residual processes whose command line contains `chrome-devtools-mcp` (handling recorded in runtime-env §6.4).
- `take_screenshot`'s `filePath` is limited by the MCP workspace whitelist (some hosts reject both repo paths and session directories, empirically 2026-10-31): when writing is rejected do not retry paths repeatedly, switch to **inline screenshot without `filePath`** for archiving; evidence validity is based on the `.md` report's DOM/API assertions (spec acceptance criteria never recognize image paths anyway).
- `upload_file` triggering `input[type=file]` may likewise be fully rejected by the whitelist for repo/session paths (empirically 2026-11-07): do not try paths, inject in-page instead — a temporary read-only HTTP server (e.g., `npx serve` on a random port) serves the fixture, `evaluate_script` fetches it into a File, puts it into `DataTransfer`, then `dispatchEvent(new Event('change', {bubbles:true}))` to the antd upload input; before injection record `modalCount` as 1 to prevent stale modal DOM misalignment (MTO modal residual after close previously caused PML injection misalignment; reload clears residue). Verify: the uploaded item tag/preview API receives file rows matching the fixture row count.

## Workflow

### 1. Environment preparation
- Start API / frontend per `.agents/notes/runtime-env.md`; record all started processes.
- Multiple worktrees in parallel: set `SHIPYARD_SLOT` so the three port groups API / frontend / CDP shift together (port literal single source `scripts/verify/e2e/ports.mjs`, port table in runtime-env §6.1b).
- Only harness / fallback paths start their own browser: newer Chromium kernel headless (e.g., Edge `--headless=new`); on the MCP path the browser instance is managed by MCP, do not start another manually.
- Start long-lived services as separate processes (e.g., PowerShell `Start-Process`); no pipe at the end of the start command.

### 2. Execute verification
- Select points from the feature map (`features/`); run at least one normal path and one failure/boundary path each (validation / empty state / permissions).
- Navigation: hash mode uses `goto`; deep links (Query changes) use `hardGoto` (about:blank relay).
- Data-condition assertions for paginated tables inside modals: click `.ant-pagination-item` page by page, scan all, then merge assertions; do not look only at the first screen.
- For layout assertions first probe the real DOM (snapshot / probe reading `outerHTML` + `getComputedStyle`); do not infer expected values from CSS source; when unsure use invariants decoupled from spec numbers, downgrade spec reconciliation to a NOTE.
- Evidence capture: screenshots, network payloads, console logs; record paths in the task document's "Acceptance criteria" item afterwards.

### 3. Cleanup and wrap-up
- Delete temporary data precisely by the ID returned in the POST response; fuzzy-match deletion forbidden.
- Close all processes started by this flow.
- Report by `page / step / expected vs actual / evidence`; append "feature map coverage M/N" (M = features covered this time, N = total `features/` entries) on the last line, listing uncovered items one by one.
- Record defects only; do not directly fix code.
- Write the UI verification report to `workflow/evidence/<YYYY-MM-DD>-<topic>.md`: header records environment / reproduction commands, assertion table each row carries a "corresponding acceptance An" column (shape reference `workflow/evidence/2026-10-24-purchase-contract-template-print-ui.md`). A report left in the session or `tmp/` = verification not closed out.

## Feature map (features/)
- `features/` holds one file per core feature; four sections, none may be missing when creating: reach path / drive / observable end state / Gotchas.
- Verification and close-out spot checks take coverage from the map; current coverage follows the `features/` directory.
- Create files synchronously when a new page or new main chain goes live; source waves from `frontend/src/router/index.ts` routes: route exists, map missing = to add; map exists, route missing = to delete or rewrite.
- Coverage gaps / skeleton: `node .agents/skills/verify-ui/scripts/gen-verify-feature.mjs --check` (or `--json`) lists uncovered routes; `--route <path>` writes only the four H2 sections + TODO skeleton, inventing drive steps forbidden.
- Monthly drift maintenance: ① take routes / component diffs of the recent month as source waves; ② run verification once only for touched features; ③ fix in at most one commit.
- For each failure first decide "map drift" or "code defect": the former fixes the map, the latter enters an incident; mixing them is forbidden.
- Missing prerequisites → record as a failure and write the reason into that feature's Gotchas; weakening the verification path to pass is forbidden.
- If a page / behavior does not match the map → fix the map first, then conclude.
- Run `check-regression-consistency.mjs` before close-out: `#/route` / `frontend/src/*` / `workflow/*.md` / `scripts/verify/*.mjs` referenced by the map dangling = red; dangling code symbols are only advisory.

## Technical requirements and constraints

### Shell and processes
- Protocol prefers HTTP, avoid self-signed certificate interception.
- "Partial changes take effect" → restart the dev server; single file not taking effect while others are normal → first touch that file.
- Probes must hit this worktree's dev server: if the vite port is occupied it silently shifts — after starting the service confirm the actual port and run with `E2E_FE_URL=http://localhost:<actual port>`; login-page navigation uses the same `FE` (localStorage is isolated by origin).
- Truncate output with `| tail -N`, never `| head -N` (SIGPIPE terminates the process before finally, leaving a residual browser occupying the CDP port).
- Reset the Console / Log collector before every navigation; install the toast observer before navigation actions.
- The three-piece verification script set is mandatory: `installNetCapture(ctx)`, `seedSession(token, { reload: true })`, `hardGoto(url)`.
- Wrap the probe body in `try { … } finally { await ctx.close?.() }`; before script start, kill residual processes by `--remote-debugging-port=<port>` for self-healing.
- Before using `harness.dbQuery`, confirm the database-explorer skill is available on this machine; prefer criteria that can be established without DB connection.

### Assertion summary
- Wrap the assertion body in try/catch: in catch append a failed assertion (with error message) and count it in the summary, with exit code 1 accordingly; "run halfway + print GREEN + exit code 0" is forbidden.

### DOM location and interaction
- Form location inside overlays / drawers / modals must always be scoped to the overlay root (e.g., `.pml-detail .ant-form-item`); global `querySelector` / `querySelectorAll` forbidden.
- Locate input boxes by placeholder within the target container.
- Normalize both sides of text comparisons with `.replace(/\s+/g,'')` (antd inserts spaces into two-character Chinese buttons).
- Visibility criterion uses `getClientRects().length > 0` or `getBoundingClientRect().width > 0`; `offsetParent` forbidden (always null under a `position: fixed` ancestor).
- The `a-select` clear icon renders only on hover: dispatch mouseenter / mouseover first, wait one tick, then click.
- The antd pagination size-changer dropdown cannot be opened via synthetic events (focus + dispatched keydown Enter is also unstable): the real path = click the combobox uid with the click tool; measure with the invariant "each option `scrollWidth <= clientWidth+1` and dropdown width ≥ widest option scrollWidth"; if the dropdown animation has not finished, measuring yields 0 size, wait ≥600ms before measuring (2026-11-06 PML pagination verification).
- Small controls inside modals (e.g., paginator) are squeezed out of the a11y snapshot by the large table behind (output over limit truncation makes the uid unavailable): temporarily `setAttribute('aria-hidden','e2e-hide')` on the background table container to shrink the tree, obtain the uid, perform the real click, then remove the attribute; be careful not to hide the modal's own table as well (2026-11-06 PML verification).
- If an `a-select` cannot be selected via synthetic events → use real mouse + keyboard: CDP `Input.dispatchMouseEvent` opens it, `ArrowDown` + `Enter` selects; between multiple selects press `Escape` first to close the previous dropdown; query options limited to the last visible dropdown (`.ant-select-dropdown:not(.ant-select-dropdown-hidden)`).
- Locate segmented / radio / tabs by rendered form (e.g., `.ant-radio-button-wrapper`), do not only look for `<button>`.
- Table selection state: clear leftover checkmarks by deduplicating rows by `data-row-key` and clicking row by row, and execute in two ticks separately from subsequent selection; clicking the header select-all in indeterminate / none state is "select all", not "clear".
- The first tbody row of an antd table with `:scroll={y}` is `.ant-table-measure-row` (height 0, no `ant-table-cell` class): skip it for row-height / cell measurements.
- `ctx.evaluate` already returns an object, do not wrap it again in `JSON.parse`.
- "Back"-type buttons on the detail overlay use `history.back()`: empirically clicking it goes back to the previous step or even `about:blank` (hit during 2026-11-03 purchase order detail verification) — to return to the list use refresh or direct re-navigation; never click "Back" as a close action.
- Before asserting, confirm the overlay content has rendered (header button group appears): a document created in a parallel session may fail to load detail, leaving only the "Back" button in the overlay (empirically 2026-11-03) — switch to a known sample document, do not judge a feature defect from this.

### AG Grid list page
- Cell overhead is 32px (padding 15×2 + border 2), not 16 / 24.
- Measure width with a hidden DOM span (copy `font` / `letter-spacing`), never canvas; fixed width `ceil10(max(header requirement, content p90 requirement) + 32 + 8)`, outliers delegated to `tooltipShowMode:'whenTruncated'`.
- Judge truncation directly by comparing `.ag-cell`'s `scrollWidth > clientWidth`; measure horizontal overflow with `.ag-center-cols-viewport`, not `.ag-body-viewport`.
- Under column virtualization columns outside the viewport are not in the DOM: `.ag-header-cell` count ≠ total column count.
- Nulls rendered as the literal `-` via `valueFormatter`: cell emptiness checks must explicitly exclude `'-'`.
