---
状态: approved
级别: L2
日期: 2026-09-26
模块: pipeline
备注: managed 台账收养 + 覆盖率检查契约。收养判据与既有「台账自愈」分支同源（disk sha == 新版渲染 sha）；覆盖率检查首次以 WARN 报（版本偏斜期存量装户不误挂）。
---

# SPEC — managed 台账收养 + 覆盖率检查

对应入口：../incidents/2026-09-26-managed-ledger-adopt.md

## 功能行为

### 一、sync 台账外文件收养（`src/sync.mjs`）

台账外文件（盘上存在但 `kit.managed` 无该 `rel`）的处理分支，由「一律保守跳过」细分为三态，判据与台账内文件的既有分支**同源**：

| 盘面状态 | 判据 | 行为 |
|---|---|---|
| 盘上有、无台账、内容 == 新版渲染 | `diskSha === freshFile.sha` | **收养登记**（入 `managedNew`，stdout 报 `收养登记`） |
| 盘上有、无台账、内容 != 新版 | `diskSha !== freshFile.sha` | 保持现状：`本地已改，跳过（已存在未入台账）`，永不自动覆盖 |
| 盘上无 | `!fs.existsSync(disk)` | 保持现状：安装（`新增安装`） |

- 语义边界：收养只发生「磁盘内容恰好等于包内新版渲染产物」——此时不存在任何本地独有信息可被破坏，登记后该文件即回归正常 managed 三态治理（下次包源改动可正常升级）。
- `--force` 语义不变：`--force` 下盘上有则覆盖（沿用现分支），收养判定不与之冲突。
- 收养项计入报告的新列 `收养登记`，与既有 `覆盖更新 / 恢复缺失 / 新增安装 / 本地已改，跳过 / 包内已移除 / 新增 owned 起步文档` 并列。

### 二、doctor 台账覆盖率检查（`src/doctor.mjs` §4.5）

- **应有清单**：由 `pkgRoot/templates` 枚举模板件（顶层 `_` 前缀目录映射为点目录，排除 `.agents/cache`），叠加 `kit.options.hosts` 对应的 `pkgRoot/modules/hosts/<h>/` 宿主层——与 `sync` 的 `fresh` 计算口径完全一致。
- **排除 owned 类**：`isOwned(rel)` 为真的件不入应有清单（它们归 `kit.owned` 记账，不属 managed 治理面）。
- **差集**：`应有清单 \ kit.managed`。非空即报 **WARN**（首次引入，理由见下），列出 rel（超 5 条截断）。
- **WARN 而非 FAIL 的理由**：`doctor` 的 `pkgRoot` 是**包安装目录**，装户项目可能落后于包版本——包内新增 managed 件在装户 `sync` 前必然「盘上无/未登记」，直接 FAIL 会让存量装户升级包后一跑 doctor 即挂。沿用本仓库三次先例（doctor-owned-drift / workflows-check / adapter 薄适配漂移均先 WARN），待装户吃过警告后按既有路径升 FAIL。
- **skipped 条件**：`pkgRoot/templates` 不存在，或 `kit.json` 不存在 / 解析失败 / 无 `managed` 字段 → `skipped=true`，add PASS 说明跳过。
- **镜像关系**：本检查补的是「盘上有、台账无」；「台账有、盘上无」已由 §4 既有 `gone` → FAIL 覆盖。

### 三、边界与异常

- 版本偏斜（包比装户新）：覆盖率报 WARN 后，装户跑 `flow-kit sync` 即收敛（新件走 `新增安装`，已存在件走收养）。
- 宿主目录本地化：`.zcode` 等 localOnly 宿主在 gitignore 内，但仍在台账与应有清单内，两侧一致计入，不误报。
- 生成器目标（`workflow/INDEX.md` / wiki 看板）不入台账（由生成器重跑），两侧均不涉及。

## 数据流

- **收养**：`kit.json`（台账）→ `sync` 三方比对（台账 sha / 磁盘 sha / 新版渲染 sha）→ 收养判定 → `managedNew` → 回写 `kit.json`。
- **覆盖率**：`pkgRoot/templates` + `pkgRoot/modules/hosts/<h>`（枚举 rel）→ 过滤 `isOwned` → 与 `kit.managed` 取差集 → doctor 输出行。
- 新增 render.mjs 导出 `listTree(srcRoot)`（只枚举 rel，不落盘），供 doctor 复用同一 `relOf` 映射，避免 doctor 复刻映射逻辑与 render.mjs 漂移；`sync` 仍走 `renderTree`（需内容 sha）。

## 系统改动

- `src/sync.mjs`：台账外分支加收养判定 + 报告列 `收养登记`；文件头注释补语义。
- `src/doctor.mjs`：新增 §4.5 覆盖率检查；新增导出 `checkLedgerCoverage(target, pkgRoot)` 供测试直调。
- `src/render.mjs`：新增导出 `listTree(srcRoot)`（复用 `relOf` 与 cache 排除）。
- `src/sync.test.mjs`：新增 S5 场景（收养三态）。
- `templates/_agents/scripts/doctor.test.mjs`：新增 `checkLedgerCoverage` 场景。
- 装副本 `templates/_agents/*` 双源件：仅 doctor.test.mjs 属双源；本 spec 不新增模板文件。
- 无数据库 / 无前端改动。

## 约束遵守映射

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 引擎双源纪律（本仓库特有） | 改的 `src/*.mjs` 是**包 CLI 源码，不在 `templates/_agents/` 下、无装副本**，故不触发双源同步；唯一双源件 `templates/_agents/scripts/doctor.test.mjs` 的对应装副本 `.agents/scripts/doctor.test.mjs` 由 `flow-kit sync` 一并更新（两文件当前均在同源状态） |
| 零依赖 | 新逻辑只用 `node:fs` / `node:path` / `node:crypto`（既有 import），不引新依赖 |
| 常驻面预算 | 不动 `AGENTS.md`；改动集中在 `src/` 与测试，`.agents/commands/*.md` 仅 build.md 补双源纪律一句（若触预算由 `rule-budget.sh --staged` 拦） |
| owned 文件永不触碰 | 收养分支只动 `kit.managed`（不复用 owned 自愈逻辑）；覆盖率检查显式排除 `isOwned(rel)` |
| 判定契约零回归 | 既有台账内三态分支代码路径不改（仅台账外分支细分）；`sync.test.mjs` S1 现有断言须全保留通过 |

## 风险评估

- **misadopt（把本地真改动收养覆盖）** ｜ 应对：判据严格取 `diskSha === freshFile.sha`（内容与新版逐字节相同），本地真改动必然 `diskSha !== freshSha` → 走跳过路径；S5 场景 ② 专测此边界。
- **覆盖率检查误报装户** ｜ 应对：首次 WARN 不 FAIL；`pkgRoot/templates` 缺失即 skipped；版本偏斜场景在 spec 中明示为预期 WARN（收敛靠 sync）。
- **doctor 变慢** ｜ 应对：用 `listTree`（只枚举 rel，不落盘、不算 sha），避免每次 doctor 渲染 101 份文件到临时目录。
- **`isOwned` 语义与台账实际不符** ｜ 已实测：渲染 101 = 台账 managed 62 + owned 类 24 + 缺失 15，用 `isOwned()` 过滤后差集恰好 15（与本次 incident 目标集完全一致），无多余噪音。
- **回滚** ｜ 纯 CLI 源码改动，`git revert` 即可；无 schema / 无数据迁移。

## 确认与复核

> 个人工作流：确认 = 用户在对话内一句话通过；无第二审批人，追溯靠 git（commit 记录确认时点）。

- 确认结果：approved（2026-09-26 用户对话内授权按 bootstrap 口径晋态；检查项 15 确认门 2026-09-27 起生效，本单为 bootstrap 期末日）
- 复核：L2 无独立复核要求（本仓库 L2 不强制）；实现后口径对账见 plan 验证方式节实跑结果
- 确认通过后，方可起草 ../plans/2026-09-26-managed-ledger-adopt.md
