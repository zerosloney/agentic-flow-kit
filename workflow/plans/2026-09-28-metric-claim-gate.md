---
状态: draft
级别: L2
日期: 2026-09-28
模块: pipeline
备注: 同名 spec：../specs/2026-09-28-metric-claim-gate.md。承接 2026-09-28-claim-exceeds-fix（该单把纪律立为条目、未机器化）。L2 四节：任务拆解 + 风险评估 + 执行顺序 + 验证方式。
---
# PLAN — 量化断言指标签名机器门

对应入口：（无独立 incident——本单是 `2026-09-28-claim-exceeds-fix` 的直接续作：该单复盘三件套 §3 把「量化断言单源」立为纪律条目并**据实声明「首版靠人工遵守、尚未机器化」**，本单即把该声明落实）
对应 spec：../specs/2026-09-28-metric-claim-gate.md

## 任务拆解

### T1 登记表单源：`.agents/metric-claims.txt` + `templates/_agents/metric-claims.txt`

**判据**：8 个指标（`ledger.lines` / `ledger.linesWithBatch` / `ledger.linesWithoutBatch` / `docs.count.{intents,specs,plans,incidents,all}`）在册；文件头写明用法、格式、取数表达式闭集，以及**为什么只查显式签名**（附本仓 65 处数字断言的实测依据）。

- T1.1 两处同步落盘（包源 + 装副本），`source-sync-check --diff` 0 差异
- T1.2 文件内**只出现小写点分形态**（`{{指标名}}`）——写 `{{全大写}}` 会被 `doctor` §5 判占位符残留

### T2 检查 16 实现：`templates/_agents/scripts/check-loop.mjs`

**判据**：登记表存在时对账签名；缺失时静默跳过；4 类出账齐（未登记 / 待回填 / 无取数器 / 登记行非法）。

- T2.1 解析登记表 → `declared` 集合；非法行与「名 ≠ 取数表达式」出账
- T2.2 签名匹配收窄为 `/\{\{([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)\}\}/g`（**小写点分**，排除装户模板占位符）
- T2.3 扫活跃态文档（四子目录 draft/approved/open + `workflow/` 根级 `*.md`）+ `derivers` 实时取数
- T2.4 头注释清单加第 16 项，**行首须为 `// 16. 标题 [warning]`**（`gate-checklist` 解析格式）
- T2.5 **不动**既有 1-15 任何判据（尤其不碰检查 15 段与台账锚）

**自查**：本仓实跑 **advisory 零新增**（改前改后逐条一致）；`exit 0`

### T3 测试：`templates/_agents/scripts/check-loop.test.mjs`

**判据**：新增 10 场景全绿（79 → 89）；两条**假阳性用例**为红线。

- T3.1 留签名未回填 → WARN 含实时值（核心回归）
- T3.2 **无签名 → 零告警**（假阳性恒 0 · 核心）
- T3.3 **装户模板占位符全大写 → 不误报**（假阳性恒 0 · 边界，实测不收窄会误报本仓 11 处）
- T3.4 未登记指标 → fail-loud；T3.5 无取数器 → fail-loud；T3.6 登记表缺失 → 静默跳过
- T3.7 终态文档不扫；T3.8 取数正确性；**T3.9 转义不报**；**T3.10 可加载守卫（假绿比红危险）**（`docs.count.plans` 排除 `_TEMPLATE`、含终态）

### T4 口径登记：`templates/_agents/scripts/gate-checklist.mjs`

**判据**：`PAIRS` 加 `{ doctor: '7', cl: '16' }`；`gate-checklist --diff` **0 断档 / 0 未登记**。

> 实测踩坑：`gate-checklist` 读的是**装副本** `.agents/scripts/check-loop.mjs`——未 sync 时报「#16 已不存在」，须先 sync 再验。

### T5 文档：`workflow/README.md` + `workflow/regression-checklist.md`

**判据**：README 纪律节 §1 由「尚未机器化」改为**已机器化**并写明签名用法 + 边界（可选强化、非强制）；回归清单该条落点同步更新，并为本单追加一行。

> **实现期发现（两处，均为本检查在自己身上抓到的）**：
> 1. **转义需求**：实现后本仓**立刻报 5 处告警**，全来自本 spec 与 README 自身——它们在「讲语法」却被判「没回填」。已定转义约定 `\{{…}}`，并追加 T3.9 用例。
> 2. **占位符残留**：测试/注释里字面写全大写 `{{X}}` 会被 `doctor` §5 判残留并**改写包源副本**——导致 T3.3 在包源侧退化为测「`<填写>` 不误报」（仍绿但丧失证明力）。改为**运行时拼装** `'{{' + n + '}}'`，两侧语义一致、断言强度不退。

### T6 双源同步与回归

**判据**：`source-sync-check --diff` 0 差异；`doctor` **0 WARN / 0 FAIL**（含占位符残留 §5）；`gate-checklist --diff` 0 断档；`check-loop` exit 0；`check-loop.test.mjs` **89/1**（该 1 项为 `sh` 环境预存失败，与基线同）。

- T6.1 `flow-kit sync`；T6.2 三项回归；T6.3 变异自验

## 风险评估

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **扩到全文数字扫描 → 不可消退噪声**（违 P3 红线） | 「顺手」把裸数字也纳入 | T2.2 形态收窄写死在判据里；T3.2/T3.3 两条假阳性用例钉死；复核须独立扫本仓确认零误报 |
| 头注释格式不符致 `gate-checklist` 报断档 | 行首多空格 / 括号占 severity 位 | T2.4 写明格式；实现期**已实测踩中一次**（首版行首多一空格 + `(2026-09-28…)` 写在 severity 位 → 解析不到），T4 验收含 `--diff` |
| 检查自身注释含 `{{全大写}}` 被 `doctor` §5 判残留 | 注释举例写了具体占位符名 | 实现期**已实测踩中**（注释写「`{{BUILD_CMD}}` 类」被报残留）→ 改述为文字（构建命令 / 看板端口 / 项目名）；T6 验收含 `doctor` 0 WARN |
| 取数器与登记表不同步 | 加了指标忘实现 | T2.1 + T3.5 fail-loud 出账「无对应取数器」 |
| 覆盖面被误读为「已全覆盖」 | README 措辞过强 | T5 强制写「可选强化、非强制」+ 边界说明；本 plan/spec **不宣称**覆盖全部量化断言 |
| 误伤存量 | 本仓已有 65 处裸数字 | T3.2 钉死：无签名零告警；T2 自查要求 advisory **改前改后逐条一致**（实测：改前 10 / 改后 10） |
| **语法错致门禁静默失效（假绿）** | 判据段写错 JS 语法 | **实现期实际发生**：`continue` 误用在 `forEach` 回调内 → `SyntaxError` → check-loop 崩溃，而「指标告警 0 条」**看起来像通过**。已修（改 `return`）+ 增设 T3.10 守卫用例；变异自验证实注入该错 → **全 90 用例齐红**（失效必可见）。**假绿比红危险** |
| 回滚难度 | — | 单文件新增检查段 + 新登记表 + 测试 + 两处文档；`git revert` 即回；无 schema / 数据迁移 |

## 执行顺序

1. T1 → T2（登记表 + 判据，同一提交）
2. T3（测试，与 T2 同提交）
3. T4（`gate-checklist` 登记）→ **先 sync 再验**（工具读装副本）
4. T5（README + 回归清单）
5. T6（sync + 三项回归 + 变异自验）
6. L2 独立复核（`independent-reviewer`，基准 = 本单首个 commit）
7. 关单：逐条勾验 → 逐件 `confirm-doc`

## 验证方式

- 静态门：`npm test`（纯 JS，无构建 / 无类型检查）——`check-loop.test.mjs` **89/1**（基线 79/1，该 1 项为 `sh` 环境预存失败）
- 门禁：`check-loop` exit 0 ｜ `doctor` 12 PASS / 0 WARN / 0 FAIL ｜ `gate-checklist --diff` 0 断档 / 0 未登记 ｜ `source-sync-check --diff` 0 差异
- **变异自验**：去掉签名形态收窄（改回 `[A-Za-z][\w.]*`）→ **恰 1 条变红**（「全大写不误报」用例），其余不动；还原后回 87/1
- **存量零误伤**：本仓实跑 advisory 数改前改后**逐条一致**（无签名即不报，理论保证 + 实测确认）
- **L2 追加**：口径对账——检查项编号 1-15 未动、检查 15 段逐字节未动、台账未改
- L2 独立复核：`independent-reviewer` 独立上下文（须独立复现：本仓零假阳性 / 变异自验 / advisory 零差异 / 既有检查未动）

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 `draft → approved` 并回填本节，`done` 只在关单出现。

- 确认结果：<待填>
- 确认门记录：spec 草稿全文过目 + plan 草稿全文过目（两道门，逐次，不合并）
