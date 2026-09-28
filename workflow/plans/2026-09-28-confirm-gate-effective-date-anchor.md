---
状态: approved
级别: L2
日期: 2026-09-28
模块: pipeline
备注: 同名入口：../incidents/2026-09-28-confirm-gate-effective-date-anchor.md；同名 spec：../specs/2026-09-28-confirm-gate-effective-date-anchor.md。L2 四节。
确认指纹: 1c8116ed2b9d92ab
---
# PLAN — 确认门生效日锚改台账 ts

## 任务拆解

### T1 判据改动：`templates/_agents/scripts/check-loop.mjs`

**判据（验收锚）**：检查 15 内不再有「自报日期 vs 生效日常量」的比较；受管准入由「台账里有无该 doc 的合法跳转行」决定。

- T1.1 读该文档在台账中的合法跳转行（stage ∈ approved/done/fixed/closed/superseded/cancelled），有则取**末次 ts** 作为该文档的确认事实
- T1.2 移除生效日判定段：`const eff = sub === 'incidents' ? '2026-09-28' : EFFECTIVE` 与紧随的 `if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < eff) continue`；`d` 的取法（`日期`/`发现`/文件名兜底）在该段一并退役
- T1.3 准入改为：**无合法跳转行 → continue（豁免）**；有 → 纳入既有配对判定
- T1.4 **不动**内容绑定段的生效锚（`entry.ts >= '2026-09-28'`）——它是另一个量
- T1.5 头注释检查项 15 段同步口径：写明「生效日锚 = 台账 ts；存量豁免 = 台账无行；自报日期不参与判定」

**自查**：改完在**本仓实跑** `check-loop.mjs`，advisory 条数与改前**逐条对齐**（当前 23 条），不新增、不减少。

### T2 测试：`templates/_agents/scripts/check-loop.test.mjs`

**判据**：新增 ≥4 场景全绿，且**既有「生效日前豁免」场景逐条复核后仍通过**。

- T2.1 新增：自报日期早于生效日（如 `日期: 2026-09-20`）**但台账 ts 晚于生效日** → **hard 拦**（本 incident 的触发条件）
- T2.2 新增：自报日期早于生效日 **且台账无行** → **不拦**（存量豁免按台账缺席判定）
- T2.3 新增：同一 doc+stage 台账**多行** → 取末次 ts 判锚（不能因首行早于锚而误豁免）
- T2.4 新增：`revert-open` / `revert-draft` 类**非合法跳转行**不参与判定、不影响锚
- T2.5 复核既有豁免场景：确认构造的均是「日期早 + 无台账」，换锚后**仍应通过**；逐条改写注释说明「豁免理由现在是无台账行」（**不放宽断言、不删场景**）
- T2.6 反向锁定：终态文档篡改仍须 hard 拦（内容绑定未被误伤）

### T3 文档：`workflow/README.md`「审计边界」节

**判据**：「生效日判定信任自报日期」一条改写为「生效日以台账 ts 为准；自报日期不参与门禁判定，仅作排序/展示」，且不再把「不可机器防」与「门不生效」并列陈述。

### T4 双向同步与回归

**判据**：`source-sync-check --diff` 0 差异；`doctor` 0 FAIL；`verify.mjs` 全绿。

- T4.1 `node bin/flow-kit.mjs sync`（刷装副本 + kit.json 台账 sha）
- T4.2 `node .agents/scripts/source-sync-check.mjs --diff` → 0 差异
- T4.3 `node .agents/scripts/gate-checklist.mjs --diff` → 登记表无需改（id 不变），0 断档 / 0 未登记
- T4.4 `node .agents/scripts/verify.mjs` → 全绿

## 风险评估

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| 改判据时误伤内容绑定锚 | 改动范围蔓延到 T1.4 之外 | 「不动内容绑定锚」写成 T1.4 显式任务；T2.6 用例反向锁定 |
| 既有豁免场景被顺手删/放宽（「测试红了就改测试」） | 换锚后语义虽同、注释已过时 | T2.5 显式要求「不改断言、只改注释」；复核 diff 重点看断言是否被削弱 |
| 本仓 advisory 条数变化（换锚后原被自动豁免的文档大面积纳入受管） | 本仓存在台账无行的已确认态文档 | T1 自查要求改前改后**逐条对齐**；实测基准 = 23 条，任何增加须逐条解释 |
| incidents 生效日常量退役后装户侧出现「半新半旧」 | sync 未跑或单边提交 | T4.1/T4.2 强制成对；pre-commit 双源门禁本身会拦单边 |

## 执行顺序

1. **T1 → T2**（判据 + 测试同提交；测试是判据的验收锚）
2. **T3**（文档，可并入 T1/T2 同一提交）
3. **T4**（sync + 三项回归）
4. 独立复核（L2 强制，`independent-reviewer` 独立上下文，基准 = 本单首个 commit）→ 意见交用户定性
5. 关单：逐条勾验 + `verify.mjs` 全绿 → 逐件 `confirm-doc`

## 遗留项

- **同类面 3 处**（检查 8 / 12 / 14 的自报日期锚）登记为后续可立项面，本单不碰（spec 已声明）
- **`workflow/INDEX.md` 陈旧**（HEAD 里档案数 110 vs 磁盘 115）与本单无关，属架构审查发现的独立问题，不夹带
- 本单自身即新锚的首个验证样本（incident/spec 已有台账行 → 受管）
