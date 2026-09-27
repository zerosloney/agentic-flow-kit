---
状态: approved
级别: L2
日期: 2026-09-27
模块: pipeline
备注: 同名 intent：../intents/2026-09-27-gate-coverage.md（机器门覆盖面补齐——incidents 确认门 + CI 服务端门 + quotepatch）
确认指纹: 0c0c136ee82a9334
---
# SPEC — gate-coverage

## 功能行为

### P1 incidents 确认门（confirm-doc + check-loop 15 扩覆盖）

**confirm-doc.mjs**：
- `DOC_RE` 收 `workflow/incidents/<文件>.md`；
- `nextStage()` 增两跳：`open → fixed`（修复落地确认）、`fixed → closed`（关单确认）；`closed` 无前向（与 done 同为终态）；不支持 `open → closed` 单跳——强制经 fixed，两跳各自留指纹与台账；
- TTY / `--delegated` 两形态语义不变（逐份过目、source/quote 如实记账）。

**check-loop.mjs 检查 15**（编号不动，覆盖面扩到 incidents）：
- 配对判定：incident `状态: fixed` 或 `状态: closed`（生效日起，判据同现有日期门）须有确认指纹 + 台账 stage=fixed/closed 配对行，缺 → hard「确认未对账」；`open` 态不受影响（起草态，maintain.md 创建即对话确认的既有口径）；
- 内容绑定：`closed` 与 `done` 同口径（台账行 ts ≥ 2026-09-28 锚 + prev 复原保分隔符重算比对；缺 prev 降级 warning）；`fixed` 不绑定（fixed→closed 之间要回填复盘三件套与修复 commit SHA，属合法编辑期）；
- 生效日：docs 侧维持 2026-09-27（配对）/ ts 锚 2026-09-28（绑定）不变；incidents 侧配对与绑定均自 2026-09-28 起（存量 11 份无台账全豁免，不回填）。

**文案同步**：AGENTS.md 确认门条款、maintain.md「确认后」节（incident 状态 → fixed / closed 两跳口径）、test.md 关单 bullet（修复分支补确认门一句）。

### P2 CI 服务端兜底门（.github/workflows/ci.yml）

test 步骤后新增「机器门（服务端兜底）」步骤，四道全跑、任一非零即红：
`node .agents/scripts/check-loop.mjs`（hard-block exit 1）→ `node bin/flow-kit.mjs doctor`（FAIL exit 1）→ `node .agents/scripts/source-sync-check.mjs --gate`（缺失/漂移 exit 1）→ `node .agents/scripts/workflows-check.mjs`（error exit 1）。

边界：矩阵（ubuntu/windows × node 18/22）四组合均跑；四脚本均秒级无构建，不拖慢 CI；本仓自有件，不进 templates 分发面（装户按需自建）。

### P3 check-pairing quotepatch（templates/_agents/hooks/check-pairing-incremental.sh）

`git diff --cached --name-only` 管道加 `-c core.quotepath=off`，对齐 check-wiki-ledger 同款修法（其注释已记录：quotepath 默认 true 时非 ASCII 路径被引号转义，前缀匹配失配 → 门禁静默跳过）。

## 数据流

- P1：confirm-doc 写 incident frontmatter（状态 + 确认指纹）并追加台账行；check-loop 15 读台账与文档复原比对——与 docs 侧完全同构，仅状态集不同（fixed/closed vs approved/done）。
- P2：CI runner checkout 后本地直跑四脚本（读仓库现状），无状态、无网络依赖。
- P3：git 钩子读暂存区路径列表，行为不变仅转义口径修正。

## 系统改动

| 件 | 改动 |
|---|---|
| `templates/_agents/scripts/confirm-doc.mjs` | DOC_RE 收 incidents；nextStage 增 open→fixed / fixed→closed；用法文案 |
| `templates/_agents/scripts/confirm-doc.test.mjs` | nextStage 新跳断言 + 台账 stage 场景 |
| `templates/_agents/scripts/check-loop.mjs` | 15 扩 incidents（配对 fixed/closed + closed 绑定）；头注释口径 |
| `templates/_agents/scripts/check-loop.test.mjs` | incidents 场景 ≥4（closed 无台账拦 / 配对过 / closed 篡改拦 / open 不受影响） |
| `.github/workflows/ci.yml` | 机器门步骤（四道） |
| `templates/_agents/hooks/check-pairing-incremental.sh` | quotepath=off 一行 + 注释 |
| `AGENTS.md`（owned）+ `templates/_agents/commands/{maintain,test}.md` | 确认门条款补 incidents 口径（预算内） |
| 装副本 / 薄适配 | 经 sync + sync-hosts --apply 下发 |

## 约束遵守映射

- **检查项编号不增删改号**：15 仅扩覆盖面（循环 sub 集加 incidents + 状态集分档），编号与 gate-checklist PAIRS 不动。
- **双源纪律**：引擎件全走 templates/ → sync；AGENTS.md owned 手改装副本即权威。
- **确认门既有语义不动**：docs 两跳、delegated 如实记账、ts 锚、保分隔符复原均不变——本批只加 incidents 维度。
- **常驻面预算**：AGENTS.md 7109/7680 余量内小改；maintain/test 两命令文件等量替换。
- **CI 秒级约束**：四脚本均只读仓库，无 npm install 追加依赖。

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| incident 关单多一道确认摩擦（fixed + closed 两次跑 confirm-doc） | 中 | 与 docs 双跳对称；delegated 形态免 TTY；生效日 2026-09-28 起存量零影响 |
| CI 四道门在装户 fork 上误红（无 templates/ 时 source-sync-check fail） | 低 | ci.yml 为本仓自有件不分发；source-sync-check 对缺包源本就 fail-fast 属预期（本仓恒有包源） |
| 15 扩面后存量 incidents 误拦 | 低 | 生效日 2026-09-28 门住：存量 11 份（无台账）全豁免；本单自身 incident 若今日关单（ts 09-27）亦豁免 |
| quotepath=off 对含空格路径的行为变化 | 低 | `-z` 未用、word splitting 语义不变（空格路径本就另有问题且规则 9 禁非英文名）；与 check-wiki-ledger 实测同款 |

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核（independent-reviewer，diff 固定后）
