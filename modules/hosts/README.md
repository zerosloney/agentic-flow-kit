# 宿主适配层

七个宿主的薄适配层。`flow-kit init --hosts <列表>` / `flow-kit add-host <宿主>` 把对应目录铺进装户仓，
`sync` 随包升级。权威源是 `templates/_agents/{commands,roles}/*.md`，本目录是**纯转发薄层**——
换宿主不换流程。

## 约定

每个宿主目录两子层：

| 层 | 文件 | 说明 |
|---|---|---|
| `agents/` | `<角色>.md` | 角色契约薄适配（全宿主无前缀，文件名 = 权威源文件名） |
| `commands/` | `<prefix><命令>.md` | 命令层薄适配，文件名统一带宿主前缀（见下），避免裸占宿主顶层命名空间 |

`commandPrefix`（`src/profiles.mjs#HOSTS` 单源）：opencode / trae / claude / cursor / codex 用 `wf-`；
zcode / omp 无该字段——只有角色层适配，不参与 commands 权威源映射。

## 现有宿主

| 宿主 | 装户目录 | commands 层 | 宿主怎么读 |
|---|---|---|---|
| `zcode` | `.zcode/` | 无（仅角色） | `.zcode/agents/*.md` |
| `opencode` | `.opencode/` | `wf-*` | `.opencode/{agents,commands}/*.md` |
| `trae` | `.trae/` | `wf-*` | `.trae/{agents,commands}/*.md` |
| `omp` | `.omp/` | 无（仅角色） | `.omp/agents/*.md` |
| `claude` | `.claude/` | `wf-*` | `.claude/commands` + `.claude/agents` |
| `cursor` | `.cursor/` | `wf-*` | `.cursor/commands` |
| `codex` | `.codex/` | `wf-*` | 仓库根 `AGENTS.md` + `.codex/skills/`；`.codex/commands` 是同形薄转发，供显式引用 |

> codex 另有 `skills/` 子层（宿主级技能辅助），见 `modules/hosts/codex/skills/`。

七个宿主一律入库（2026-10-05 起撤销 localOnly）——换宿主不丢文件、CI 克隆面一致。zcode 的会话级
液态草稿（`.zcode/drafts/`、`.zcode/plans/`）是本机态、不该入库，init 不自动写这条规则，装户自行加进
`.gitignore`。

## 对账

权威源改一处，要同步到 N 份薄适配——人工 grep 易漏：

```bash
flow-kit sync-hosts --diff     # 权威源 vs 薄适配漂移报告（默认，不改盘面）
flow-kit sync-hosts --apply    # 单向同步：权威源 → 薄适配（不反向，避免污染权威源）
```

包源仓（含 `templates/_agents` + `modules/hosts`）与装户仓（含 `.agents`）两种布局都可用——
同一命令两处口径一致。装户侧等价体检在 `flow-kit doctor`（跨宿主薄适配正文段漂移校验）。

## 加一个新宿主

1. 在 `src/profiles.mjs#HOSTS` 注册：`dir`（装户目录名，带点）、`commandPrefix`（有命令层才填）。
2. 建 `modules/hosts/<宿主>/`：`agents/*.md` 三角色薄适配（从现有宿主拷一份改 frontmatter/调用约定）；
   有命令层再加 `commands/<prefix>*.md`。
3. 权威源（`templates/_agents/{commands,roles}/`）不动——薄适配只转发，不复刻判据。
4. 跑 `flow-kit sync-hosts --diff` 自查新增薄适配与权威源对齐；`npm test`（含 sync-hosts 套件与
   doctor 跨宿主校验回归）。
5. README「现有宿主」表与 `cli.mjs` HELP 的宿主清单随动。
