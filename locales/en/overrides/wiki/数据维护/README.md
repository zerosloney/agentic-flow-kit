# Data Maintenance Ledger

This directory records all project data-maintenance SQL and execution status, grouped by phase:

| Directory | Purpose |
|---|---|
| `schema变更/` | Schema changes (DDL); one `date-topic/` subdirectory per batch |
| `数据修复/` | Existing-data fixes (DML); state affected row counts and rollback |
| `数据导入/` | External data import scripts and mapping notes |
| `查询/` | Read-only diagnostic SQL |
| `备份/` | Backup and restore scripts |

## Hard Constraints

- Every new SQL must record its execution status and authorization source.
- Never run a full-table `DELETE` / `UPDATE` without a `WHERE` clause.
- Executing production SQL is irreversible and requires explicit user authorization; follow the project data-maintenance ledger and DB verification rules.
- Script and ledger examples live in `_TEMPLATE.md` (if present).

## Generated Artifacts

`README.md` follows this directory protocol; the batch inventory is the subdirectories plus git history.
