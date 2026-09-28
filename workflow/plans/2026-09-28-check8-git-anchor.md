---
状态: done
级别: L2
日期: 2026-09-28
模块: pipeline
备注: 同名入口：../incidents/2026-09-28-check8-git-anchor.md；同名 spec：../specs/2026-09-28-check8-git-anchor.md。L2 四节。
确认指纹: 4a5d1baa5af41724
---
# PLAN — 检查 8 生效日锚改 git 首次加入日期

## 执行记录与验证结果

- **T1 判据换锚**：`check-loop.mjs` 新增模块级 `addedDates`（`git log --diff-filter=A --format=@%aI --name-only`，一次全量）+ `addedDateOf()`；检查 8 的 `isNew` 锚由 `base.slice(0,10)` 改为 `addedDateOf(intent)`；头注释同步。**检查 10 未动**（需求不同构）。
  - **自查**：本仓实跑 advisory **改前改后逐条零差异**（独立复核亦复现：同一工作区改前/改后**逐条一致**）；`exit 0` 无新增 hard。（口径：既有归档 8 条；工作区含本单新增 2 份文档的「模板未填」后为 10 条）
- **T2 测试**：`check-loop.test.mjs` **82/0**（改前 79/0）——新增核心回归 / 非 git 退化 / 对照 3 条；既有 4 条改造为真 git fixture（独立复核逐条比对：**调用数 / 条件运算符 / 断言文案均一致，未放宽**）。
- **T3 文档**：`workflow/README.md` 审计边界节——检查 8 移出「未收窄」清单并写明新锚；12/14 两条 advisory 与 hard 门**分档表述**。
- **T4 同步回归**：`sync` ✅ / `source-sync-check --diff` 0 差异 ✅ / `gate-checklist --diff` 0 断档 0 未登记 ✅ / `verify.mjs` 25 套件 **503 断言 0 FAIL** ✅ / `doctor` 12 PASS 0 WARN 0 FAIL ✅
- **变异自验**：锚换回 `base.slice(0,10)` → **恰 2 条变红**（核心回归 + 非 git 退化语义），与预期吻合；独立复核复现同一结果。
- **实现期偏离（据实记录）**：`workflow-board-server.test.mjs` 的双跑断言场景**不在原 spec 系统改动表内**——换锚后其非 git fixture 使「验收未对账」hard 不再产出、四类覆盖少一类，致 `verify.mjs` 红。经用户拍板**方案 A**（补 git 前置，不改断言）纳入本单，改动集由 3 文件扩为 4 文件。
- **L2 独立复核**：`verifier` 子代理，判 **0 P0**；P1×1 + P2×2 全部采纳并修复（`87bb788`）。
- **提交**：`2fe605c`（实现）+ `87bb788`（复核 P1+P2 收口）

## 任务拆解

### T1 判据换锚：`templates/_agents/scripts/check-loop.mjs`

**判据**：检查 8 内不再引用 `base.slice(0, 10)` 作为生效日锚；`isNew` 由 git 首次加入日期决定。

- T1.1 新增模块级 `addedDates` 索引（`git log --diff-filter=A --format=@%aI --name-only`，一次全量调用；非 git / 失败 → `null`）
- T1.2 新增 `addedDateOf(absDoc)`：查 Map → 取前 10 字符 → 不可判定返回 `''`
- T1.3 检查 8 内 `const filedate = ...` / `isNew` 两行替换为 `const adddate = addedDateOf(intent)` / `isNew = adddate !== '' && adddate >= accCutoff`
- T1.4 **检查 10 保持原样**（不复用 `addedDates`——它需要 commit 号与文件清单，与检查 8 需求不同构，硬合并引入耦合无收益）
- T1.5 头注释检查 8 段改写：锚 = git 首次加入日期 + 收窄理由 + 非 git 退化口径（**不改编号**）

**自查**：本仓实跑 advisory **改前改后逐条零差异**；`exit 0` 无新增 hard。（**口径**：既有归档 advisory 8 条；工作区含本单新增 2 份文档的「模板未填」后为 10 条，「8 条」指既有归档，非工作区实跑值）

### T2 测试：`templates/_agents/scripts/check-loop.test.mjs`

**判据**：新增 3 场景全绿；既有 4 条检查 8 场景改造后**意图与断言强度均不变**。

- T2.1 **核心回归**：文件名日期写早（`2026-09-01`）但 git 首次加入在 `accCutoff` 之后 + 未勾验 → **仍 hard 拦**；**必须变异自验**（锚换回文件名 → 变红）
- T2.2 **非 git 退化**：无 gitInit 的 fixture + 未勾验 → **不 hard 拦**（走存量口径，不误报）
- T2.3 **对照**：文件名日期够新 + git 加入够新 + 未勾验 → hard 拦
- T2.4 既有 4 条改造为真 git fixture（`gitInit` + `gitCommitAll`）：新建未勾验 / 缺验收标准节 / 缩进写法 / `[x]` 缺证据
- T2.5 自查：改造过程中**不得放宽任何断言**（不改 `expectHard`→`expectOk`、不删条件）

### T3 文档：`workflow/README.md`「审计边界」节

**判据**：检查 8 移出「未收窄」清单并写明新锚；12/14 **advisory** 与 hard 门**分档表述**（不得再并列成「同类面」）。

### T4 双源同步与回归

**判据**：`source-sync-check --diff` 0 差异；`doctor` 0 FAIL；`verify.mjs` 全绿。

- T4.1 `flow-kit sync`
- T4.2 `source-sync-check --diff` → 0 差异
- T4.3 `gate-checklist --diff` → 0 断档 / 0 未登记
- T4.4 `verify.mjs` → 全绿

## 风险评估

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| 换锚后本仓存量 done intent 被误 hard 拦 | 本仓文档取不到加入日期 | T1 自查硬要求 advisory **改前改后逐条零差异**（复核独立复现） |
| 既有 4 条用例改造时被「改到绿」（放宽断言） | 换锚后它们会红 | T2.5 显式禁止；T2.1 作为必须在旧锚下变红的锚点 |
| 改造后失去「非 git 环境」覆盖 | 4 条全改成 git fixture | T2.2 专门补一条非 git 退化用例 |
| 「顺手」把检查 10 一起重构 | 看到相似代码想合并 | T1.4 显式写明不动及其理由（需求不同构） |
| 回滚难度 | — | 单文件判据段 + 测试 + 一处文档；`git revert` 即回 |

## 执行顺序

1. T1 → T2（判据 + 测试同一提交）
2. T3（文档，并入同一提交）
3. T4（sync + 三项回归）
4. 变异自验（核心回归在旧锚下变红）
5. 独立复核（L2 强制，基准 = 本单首个 commit）
6. 关单：逐条勾验 + `verify.mjs` 全绿 → 逐件 `confirm-doc`

## 遗留项

- **检查 12 / 14 两条 advisory 仍以自报日期为锚**——用户拍板方案②明示不动；本次将在 README 中分档表述（不再与 hard 门并列）。若日后要统一，属独立立项
- 上一单（`confirm-gate-effective-date-anchor`）遗留面的「统一锚」这条更彻底的方案（①）已被用户明确否决，本单采②
