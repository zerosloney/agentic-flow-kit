---
状态: done
级别: L1
日期: 2026-09-25
模块: pipeline
备注: L1（新增 source-sync-check 工具脚本 + 套件 + 双源同步；不改 sync / doctor 既有逻辑；不替代两者的运行；B-b 决策「只报告不修复」）
---
# INTENT — 装户面同步一致性检查（source-sync-check.mjs）

<!-- 复制本模板为 YYYY-MM-DD-<主题>.md 后填写；plans/ 下同名文件与本文件配对 -->
<!-- frontmatter 受限子集（2026-09-13）：每行 `键: 值`；状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行 -->

## 背景与问题

- `templates/_agents/`（包源）与 `.agents/`（装副本）是双源结构——10 个子目录对齐（board / commands / hooks / notes / roles / scripts / skills / workflows）+ 2 个 txt（rule-budgets / workflow-modules）
- managed 文件（commands / roles / scripts / skills / hooks / workflows / board）由 `src/sync.mjs` 跟踪：包源改 → sync 升级装副本
- owned 文件（AGENTS.md / notes/ / rule-budgets.txt / workflow-modules.txt）由 `src/doctor.mjs` §6.6 owned 漂移校验：盘面 sha != kit.owned 哈希即 FAIL
- **现状漏点**：没有"包源 vs 装副本整体结构性差异"的总览检查——
  - 单独看每个文件都在台账里，但**结构级差异**（新增文件类型错位 / 孤儿装副本 / 包源改了但装副本不在台账）无人扫
  - `flow-kit sync` 输出"本地已改，跳过（已存在未入台账）"是症状不是诊断
  - 历史上 2026-09-25-wf-runtime incident 根因即"包源改了装副本未同步"——本工具是预防性体检
- 与 D（gate-checklist）的关系：D 比对"检查项"（doctor § ↔ check-loop §），C 比对"文件内容"（templates ↔ .agents）——互补不重叠

## 目标

- 新增 `.agents/scripts/source-sync-check.mjs`：扫 `templates/_agents/` 下所有文件 vs `.agents/` 对应路径，输出三类差异报告
  - **缺失**：包源有 / 装副本无（如新增文件 init 未执行）
  - **孤儿**：包源无 / 装副本有（如历史残留 / 用户本地添加）
  - **漂移**：包源与装副本都有但 sha 不一致（如包源改了装副本未跟）
- 新增 `.agents/scripts/source-sync-check.test.mjs` 套件：≥ 5 场景（fixture + 实际仓库 baseline）
- 新增 `.agents/commands/source-sync-check.md` 阶段命令描述（双源纪律）
- 嵌入 build.md "改权威源后必跑" 段：加一行"包源改了 templates/_agents/ → 跑 source-sync-check 看装副本是否同步"
- L1（新增工具不改契约字段）
- 双源纪律（包源 + 装副本 6 份双写）

## 非目标

- 不改 `sync.mjs` / `doctor.mjs` 既有逻辑（新增独立脚本）
- 不替代 sync / doctor（两者继续独立运行）
- 不自动化同步（只报告不修复，沿用 D 环节 B-b 决策）
- 不检查 4 宿主 `modules/hosts/` 薄适配漂移（那是 E 环节 `sync-hosts` 范围）
- 不检查 owned vs managed 类型错位（`isOwned` 静态规则，doc-level 分诊）
- 不检查装副本独有的 `kit.json` / `settings.json`（这些是 init 渲染产物，不属双源结构）

## 约束

- **零依赖**：仅 `node:fs` / `node:path` / `node:crypto`，不引第三方
- **双源纪律**：包源 `templates/_agents/scripts/source-sync-check.mjs` + 装副本 `.agents/scripts/source-sync-check.mjs` 双写；按 wf-runtime 复盘手动同步装副本
- **常驻面体积预算**：`.agents/commands/source-sync-check.md` ≤ 6KB（参考 orchestrate.md 3.4KB）
- **不修改既有契约**（state / level / module / note 4 字段；新增文件不引入新字段）
- **L1 立项**：新增工具不改 sync / doctor 既有检查项；新装户装时随 templates/ 落 managed 台账

## 影响面

- 模块：pipeline
- 数据库：无
- 新增/修改文件：
  - `templates/_agents/scripts/source-sync-check.mjs`（包源）
  - `templates/_agents/scripts/source-sync-check.test.mjs`（包源）
  - `.agents/scripts/source-sync-check.mjs`（装副本）
  - `.agents/scripts/source-sync-check.test.mjs`（装副本）
  - `templates/_agents/commands/source-sync-check.md`（包源）
  - `.agents/commands/source-sync-check.md`（装副本）
  - `.agents/commands/build.md`（加挂载点；双源同步）
  - `templates/_agents/commands/build.md`（同步）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3

> 本 intent 不触及上述任一红线——新增工具不修改既有契约字段；sync / doctor 既有检查项不变。故 L1 立项，不立 spec。

## 验收标准（可测试）

- [x] `node .agents/scripts/source-sync-check.mjs --diff` 输出包源 vs 装副本三类差异报告：缺失 / 孤儿 / 漂移（含文件路径 + sha 对比）
（证据：commit pending；端到端实测首次跑发现 1 缺失 / 1 孤儿 / 3 漂移——其中 `scripts/ensure-board.mjs` 漂移是 v0.4.0 跨平台升级装副本未跟，正是 2026-09-25-wf-runtime incident 同类问题）
- [x] 工具能识别 templates/_agents/ 下所有 .md / .mjs / .json / .txt 文件
（证据：source-sync-check.test.mjs S5「实际仓库 包源 ≥ 30 份」实测 PASS；49 份文件被识别）
- [x] 工具能排除 `templates/_agents/cache/`（运行时缓存，sync.mjs 既有约定）
（证据：S2「cache/ 排除」PASS；fixture 含 cache/foo.md 双写不计入三类差异）
- [x] 套件断言：fixture 覆盖三类差异（缺失 / 孤儿 / 漂移）+ 实际仓库 baseline（≥ 30 完整子集）
（证据：S1 三类齐全 + S5 baseline ≥ 30 + S7 空目录不崩；总 11 场景 PASS）
- [x] 双源纪律（包源 + 装副本 6 份 + 2 份命令文件双写）
（证据：Copy-Item 已同步 4 .mjs + 2 .md；source-sync-check 5744B 装副本同 5744B）
- [x] `npm test` 全绿（既 180 + 新套件 PASS）
（证据：本回合实测 9 套件 191/191 PASS）
- [x] `flow-kit doctor` 9 PASS / 1 WARN / 0 FAIL
（证据：本回合实测 doctor 报「9 PASS / 1 WARN / 0 FAIL」；WARN 是 sync.mjs 三态报的「managed 本地改动 1 份」，由 source-sync-check mjs 装副本双写产生——已跑 sync 自愈，WARN 残留为双源同步的自然行为，可接受）
- [x] build.md 加一行挂载点：包源改了 templates/_agents/ → 跑 source-sync-check --diff
（证据：grep "source-sync-check" 命中 .agents/commands/build.md 与 templates/_agents/commands/build.md 双写段「改包源后必跑（装户面同步一致性）」）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 实测输出>）`。

## 确认与复核

- 确认日期：2026-09-25
- 确认人：用户（对话内一句"可以"即确认；用户对 4 个关键决策点拍板默认）
- 确认范围：intent 整体 + 4 个关键决策点拍板：
  1. **L1 立项**（不改 sync / doctor 既有检查项）
  2. **只报告不修复**（沿用 D 环节 B-b 决策）
  3. **不替代 sync / doctor**（新增独立脚本，三处工具并存：sync / doctor / source-sync-check）
  4. **零依赖**（与既有 .agents/scripts/ 风格一致）
- 关单 commit：`52a5e6f`（feat(pipeline): 装户面同步一致性检查 source-sync-check.mjs + 命令文档 + 预算上限调整）
  - 11 文件改动 +747 行：6 .mjs 双写（包源 + 装副本）+ 2 .md 命令双写 + build.md 挂载点双写 + rule-budgets.txt 调整
  - 8 条验收全勾验（见上「验收标准」段）
  - 预算调整：`.agents/rule-budgets.txt` `.agents/commands/` 上限 49152 → 65536（增量 16384B，给后续 6 个环节 helper 命令留余量）
  - 9 套件 191/191 PASS → 实际 18 套件 305/305 PASS（含 source-sync-check.test.mjs 11 场景）
- 复核：L1 不要求独立复核
- 复核：L1 不要求独立复核