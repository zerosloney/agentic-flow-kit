# Project-Level Gate Configuration Index

> The engine and gate mechanisms ship with the package; **rules and switches belong to the project**. This page is the single entry point for project-level configuration: locate the file in the summary table, then read its section.
> General semantics: a missing config means that capability is not enabled (each gate SKIPs and blocks no one); a file that exists but is malformed is **fail-closed** — the consuming script reports an error and exits with its own code, and must not be treated as "not configured". Exact exit codes follow each script's header comment.
> Self-check: the gate coverage section of `flow-kit doctor` reports each item as "configured / not configured (SKIP) / invalid config", and uses `git ls-files` to count tracked files matched by the faces trigger surface (0 matches raises a warning).

## Summary

| File | Purpose | When it runs | Unconfigured semantics | Invalid config |
|---|---|---|---|---|
| `.agents/config/project-faces.json` | Single source for product-face (ui/code/tests/data) path prefixes | check-confirm-order on commit; verify / verify-scope on closeout/CI | Conservative: every change counts as a product face | exit 2 |
| `.agents/hooks/commit-check.config.json` | Conditional builds / fast checks / pre-push tests | pre-commit (builds/checks); pre-push `--range` (pushTests) | The corresponding segments are SKIP | Unreadable/bad JSON is treated as absent (this script does not fail closed) |
| `.agents/config/product-gates*.json` | Stack product gates beyond the base table | verify (local closeout / CI) | No project product gates | exit 2 |
| `.agents/hooks/architecture-redlines.json` | Architecture redlines (forbidden / navigation properties / catch constraints) | pre-commit static gates; host pre-write interception | SKIP exit 0 | exit 2 |
| `.agents/hooks/delete-guard.json` | Deletion-call scan and allowlist | pre-commit static gates; host pre-write interception | SKIP exit 0 | exit 2 |
| `.agents/hooks/audit-fields.json` | Audit fields must not be written by hand | pre-commit static gate (staged added lines) | SKIP exit 0 | exit 2 |
| `.agents/hooks/notify-guard.json` | Notify guard: target dirs / extensions / hit pattern / allowlist files | pre-commit static gate (full scan of target dirs) | Built-in defaults (frontend/src + .vue/.ts + message.error/warning/info + utils/notify.ts exemption) | exit 2 |
| `.agents/config/test-impact-map.json` | Impact-based test selection mapping | pre-push selection; CI heavy mode `--full` | Skeleton state SKIP exit 0 (a missing file is a precondition failure, exit 1) | Read/validation failure exits 1 |
| `.agents/config/local-gates.json` | Required local environment variables (dedicated test DB) | `flow-kit run check-local-gates.mjs`, doctor `--deep` | SKIP (blocks nothing) | Parse failure counts as a missing item, exit 1 |
| `.agents/config/lane-surfaces.txt` | L2 touch-surface ERE list | verify `lane-surface-ci` (closeout / CI diff surface) | Missing or empty = no check | Invalid ERE → blocked |
| `.agents/config/workflow-modules.txt` | Workflow module vocabulary | task creation / triage / index / search | Empty = `模块:` values are not validated | Values outside the vocabulary are rejected by triage |

## .agents/config/project-faces.json

- **Purpose**: Declares this project's product-face path prefixes, the single source for "which changes count as product contract surface"; four faces `ui` / `code` / `tests` / `data`.
- **When it runs**: `check-confirm-order` in pre-commit (confirm before changing product paths); `verify.mjs` on closeout/CI (dirty-path filtering, `--face` face-scoped gates) and `verify-scope.mjs`; `flow-kit run faces.mjs` for shell-side self-checks.
- **Unconfigured semantics**: Missing file or all four keys empty = not configured → **conservative full trigger** (every change is treated as a product face); this is the safe default and never silently allows a bypass.
- **Invalid config**: Parse failure / wrong shape = fail-closed exit 2 (same contract in `faces.mjs`, `check-confirm-order.mjs`, `verify.mjs`).
- **Minimal example**:

```json
{
  "ui": ["frontend/src/"],
  "code": ["backend/"],
  "tests": ["tests/"],
  "data": ["wiki/data-maintenance/"]
}
```

- **Fields**: Each key is an array of repository-relative path prefixes (forward slashes; directories end with `/`; absolute paths and globs are not accepted). A file belongs to a face when it matches any prefix; unlisted paths (docs / tooling / engine surface) do not trigger product gates.

## .agents/hooks/commit-check.config.json

- **Purpose**: Three executors on the commit/push path — `builds` conditional builds, `checks` fast deterministic checks, `pushTests` pre-push tests.
- **When it runs**: pre-commit runs `builds` (skipped for regular commits with `--no-build`; merge commits use `--full`) and `checks`; pre-push runs `builds` and `pushTests` with `--range <old> <new>`.
- **Unconfigured semantics**: Missing file or an empty array → that segment is SKIP (`pushTests` produces no output at all) and blocks no one.
- **Invalid config**: Unreadable / bad JSON is treated as "no config" and the segment is skipped (this script does not fail closed); `flow-kit doctor` flags such files in red as a reminder.
- **Minimal example**:

```json
{
  "builds": [
    { "name": "backend", "command": "dotnet build", "ext": [".cs", ".sln", ".csproj"] }
  ],
  "checks": [
    { "name": "typecheck", "command": "npx tsc --noEmit", "ext": [".ts", ".tsx"], "when": ["tsconfig.json"] }
  ],
  "pushTests": [
    { "name": "backend-tests", "command": "npm test", "prefix": ["backend/", "tests/"], "when": ["package.json"], "whenEnv": "RUN_PUSH_TESTS=1", "timeoutMs": 600000 }
  ]
}
```

- **Fields**:
  - `builds` / `checks` entries: `name` and `command` required; `ext` (extensions) or `prefix` (path prefixes, string or array) trigger when either matches; `cwd` sets the working directory; `when` is described below; optional `lockPattern` / `lockHint` surface file-lock failures separately. `builds` ignores changes under `.agents/` and `.githooks/`; `checks` ignores only `.githooks/`.
  - `pushTests` entries: run only in `--range` mode (pre-push); `{old}` / `{new}` in `command` are replaced with the validated SHAs; `prefix` may be a string array; `whenEnv` is an environment switch (for example `RUN_PUSH_TESTS=1`; when unmet, nothing runs and nothing prints); `timeoutMs` caps a single command's wall clock.
  - `when`: enabled when any entry is satisfied — a path exists / a trailing `*` single-level wildcard (such as `*.sln`) / `pkg:<dotted.path>` (reads `package.json` under that entry's `cwd` and requires a non-empty string). No `when` means always enabled.

## .agents/config/product-gates*.json

- **Purpose**: Moves stack product gates (build / unit tests / lint / E2E, etc.) out of the engine base table and into project config; `verify.mjs` inserts them after `wiki-consistency` and before the auto-detected stack gates.
- **When it runs**: `verify.mjs` (local closeout / CI). Gate order = filename sort (`product-gates.json`, `product-gates.<name>.json`) × array order inside a file.
- **Unconfigured semantics**: No `product-gates*.json` under the directory = no project product gates; no error, no output.
- **Invalid config**: Bad JSON / missing required fields / an `id` that duplicates a built-in or another gate / `deps` pointing at a nonexistent gate → error on stderr, exit 2 (it must not be treated as "not configured").
- **Minimal example**:

```json
{
  "gates": [
    { "id": "backend-build", "name": "Backend build", "cmd": "dotnet build", "folder": ".", "when": ["*.sln"] }
  ]
}
```

- **Fields**: `id` / `name` / `cmd` required; `folder` defaults to `.`; optional `deps` (preceding gate ids), `when`, `env`; `type` defaults to `shell`. `when` has the same semantics as in `commit-check.config.json` (path exists / trailing `*` single-level wildcard / `pkg:<dotted.path>`); unmet gates stay out of the execution list, print a SKIP line, and do not count as failures.

## .agents/hooks/architecture-redlines.json

- **Purpose**: Architecture redlines with externalized rules — `forbidden` (forbidden content), `noNavigationProperties` (no navigation properties on entities), `catchRequires` (a catch block must contain given symbols). The script implements only the "read rules → scan targets → report violations" mechanism.
- **When it runs**: pre-commit static gate (`check-architecture.mjs`); host pre-write interception (`pre-write-check.cjs` reuses the same script for target files).
- **Unconfigured semantics**: Missing file, or all three arrays empty = SKIP exit 0 (the project has no redline contract, so nobody should be blocked).
- **Invalid config**: Unreadable / bad JSON / top level not an object / unknown top-level key / missing required field / invalid regex / duplicate or malformed `id` → exit 2.
- **Minimal example**:

```json
{
  "forbidden": [
    { "id": "no-dbcontext-in-controller", "targets": ["backend/Controllers/"], "matches": "DbContext", "message": "Controllers must not hold a DbContext directly" }
  ]
}
```

- **Fields**: `forbidden[]` requires `id` / `targets` / `message`, with at least one of `contains` (literal substring) or `matches` (regex); `unless` exempts matching lines; `exclude` globs exempt whole files; `optional: true` allows a literal target to be absent; `once: true` reports only the first hit. `noNavigationProperties[]` requires `id` / `dir` / `message`, plus `extraTypeNames` for extra type names. `catchRequires[]` requires `id` / `files` / `catch` / `require` / `message`.

## .agents/hooks/delete-guard.json

- **Purpose**: Deletion calls inside declared directories must be registered in `delete-guard-allowlist.txt` and paired with a regression test; the script only performs the trigger review "new deletion paths must be explicitly registered".
- **When it runs**: pre-commit static gate (`check-delete-guard.mjs`); host pre-write interception (`pre-write-check.cjs`).
- **Unconfigured semantics**: Missing file = SKIP exit 0 (projects that do not declare it are skipped automatically and are never blocked by mistake).
- **Invalid config**: Bad JSON / top level not an object / unknown key / missing or empty `scan` / missing `dir` / invalid regex → exit 2; a declared directory that does not exist is handled as a fail-closed violation.
- **Minimal example**:

```json
{
  "scan": [
    { "dir": "backend/Services", "ext": [".cs"], "call": "\\.(Remove|RemoveRange)\\(", "ignore": "_cache\\.Remove\\(" }
  ]
}
```

- **Fields**: Each `scan[]` entry accepts only `dir` (required, relative to the project root), `ext` (defaults to `[".cs"]`), `call` (regex matching deletion calls), and `ignore` (exemption regex). Counts are aggregated per file, so line-number drift does not cause false positives.

## .agents/hooks/audit-fields.json

- **Purpose**: Protected audit fields (such as `CreatedBy` / `UpdatedBy`) must not be written by hand in business code; they must go through the project's unified write path.
- **When it runs**: pre-commit static gate (`check-audit-fields.mjs`, scanning added lines in the staging area by default; `--range` scans a given range, so existing violations are not blocked).
- **Unconfigured semantics**: Missing file = SKIP exit 0 (the project has no audit-field guard, so nobody should be blocked).
- **Invalid config**: Unreadable / bad JSON / top level not an object / unknown top-level key / missing or empty `fields` / a field name that is not a valid identifier → exit 2.
- **Minimal example**:

```json
{
  "fields": ["CreatedBy", "UpdatedBy"],
  "ext": [".cs"],
  "allowFiles": ["SeedData.cs"],
  "allowLines": ["SetAudit("]
}
```

- **Fields**: `fields` is required and non-empty (each entry must be a valid identifier); `ext` defaults to `[".cs"]`; `allowFiles` exempts a whole file when its path contains the substring; `allowLines` exempts a line containing the substring. Violation rule: an added line assigns "field name followed by `??=` or `=` (not `==`)" and is not a same-name copy.

## .agents/config/test-impact-map.json

- **Purpose**: The single mapping for impact-based test selection — derives the test classes to run from changed paths, preventing "a new test class is unregistered and gets silently skipped on push".
- **When it runs**: pre-push selection (`test-impact-lib.mjs`, falling back to a full run whenever it cannot decide); CI heavy mode `--full` runs `check-test-impact-map.mjs` as a hard check.
- **Unconfigured semantics**: Skeleton state (`namespace` / `areas` / `paths` all empty) = explicit SKIP exit 0, no validation; a missing file is a precondition failure, exit 1 (keep the skeleton file that ships with the install).
- **Invalid config**: Read / parse / validation failure of the mapping → exit 1 (fail-closed, never silently skipped).
- **Minimal example**:

```json
{
  "version": 1,
  "namespace": "MyApp.IntegrationTests",
  "dirs": { "test": "tests/Integration", "unit": "tests/Unit", "fullchain": "tests/FullChain" },
  "faces": { "code": ["backend/"], "sql": ["db/"] },
  "areas": { "order": ["OrderTests"] },
  "always": ["SmokeTests"],
  "paths": [{ "glob": "backend/Order/**", "areas": ["order"] }]
}
```

- **Fields**: `namespace` is the test namespace (builds the vstest filter); `dirs` holds directory faces `test` / `unit` / `fullchain` (undeclared = cannot decide, fall back to full); `faces` holds code faces `code` / `sql` (undeclared = unknown paths fall back to full); `areas` maps a business area to its test classes (a class may span areas); `always` lists infrastructure/smoke classes that must run in every integration subset (they must already be registered in `areas`); `paths` maps a production-file glob to business areas, first match in order, and an unmatched path or `areas` containing `*` falls back to full.

## .agents/config/local-gates.json

- **Purpose**: Declares environment variables that must be set after cloning, typically the "dedicated test database connection" guard (never run integration tests against production/shared databases).
- **When it runs**: manually via `flow-kit run check-local-gates.mjs` (post-clone gate check), `doctor --deep`; once `testDb` is declared, the environment variable value is checked.
- **Unconfigured semantics**: Missing file, or no `testDb` declaration = SKIP (the project has no dedicated-test-database constraint; no silence, no false blocking).
- **Invalid config**: A JSON parse failure records that check as missing and exits 1 (fail-loud).
- **Minimal example**:

```json
{
  "testDb": {
    "env": "TEST_DB_CONNECTION",
    "forbiddenDatabases": ["Production", "Master"]
  }
}
```

- **Fields**: `testDb.env` is the environment variable name; `testDb.forbiddenDatabases` lists forbidden database names (case-insensitive). The check passes only when the variable exists, a `Database` / `Initial Catalog` can be parsed, and it does not point at a forbidden database.

## .agents/config/lane-surfaces.txt

- **Purpose**: L2 touch-surface ERE list — a match means the change touches "defined once, consumed many times" contract / schema surface.
- **When it runs**: verify's `lane-surface-ci` gate (closeout / CI diff surface); `## engine` / `## product` sections switch categories, and EREs before any marker default to engine.
- **Unconfigured semantics**: Missing file or an empty list (comments only) = the check is skipped (installs are unaffected).
- **Invalid config**: An invalid ERE line blocks fail-closed (preventing silent holes); fix the config and retry.

## .agents/config/workflow-modules.txt

- **Purpose**: Single source of the workflow document module vocabulary (the `模块:` frontmatter value), shared by task creation, triage, index generation, and search scripts.
- **Unconfigured semantics**: An empty vocabulary means the project has not registered module enums and `模块:` values are not validated; once filled, values outside the vocabulary are rejected by triage.

## .agents/hooks/notify-guard.json

- **Purpose**: Scan surface and hit rules for the notify guard — target dirs, extensions, hit pattern, allowlisted files.
- **When it runs**: pre-commit static gate on code-face commits; projected into the rule model as `notify.message-guard` (face=ui).
- **Unconfigured semantics**: Built-in defaults (`frontend/src`, `.vue|.ts`, `message.error|warning|warn|info(`, `frontend/src/utils/notify.ts` exemption) — identical to historical behavior; a missing target dir is skipped silently.
- **Invalid config**: Not an object / wrong field types / invalid regex → exit 2 (misconfiguration must never pass as absent).
- **Minimal example**:
  ```json
  {
    "targets": ["frontend/src"],
    "ext": [".vue", ".ts"],
    "pattern": "message\\.(error|warning|warn|info)\\s*\\(",
    "allowFiles": ["frontend/src/utils/notify.ts"]
  }
  ```
