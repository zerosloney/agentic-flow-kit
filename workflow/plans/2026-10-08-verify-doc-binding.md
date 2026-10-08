---
状态: approved
级别: L2
日期: 2026-10-08
模块: pipeline
备注: 对应 spec 2026-10-08-verify-doc-binding / intent 2026-10-08-verify-doc-binding
确认指纹: 410fa619fd0544bf
---
# PLAN — verify-doc-binding

## 改动方案

### `templates/_agents/scripts/policy.mjs`（判定单源，先改它）

- `POLICIES` 增 `6`：= `POLICIES[5]` 的**全键逐个照抄** + `verifyDocSince: '2026-10-08'`（抄全键是本仓铁律——`2026-09-28` v2 漏抄 `check14Since` 曾改动其他检查生效日）。
- `hasFreshVerifyLine(lines, now, doc)`：第三参 `doc` 为空/缺省 → 逻辑与改前逐字节相同；非空 → 行须同时满足 `exitCode===0` ∧ `ts` 在窗口内 ∧ **`e.doc === doc`**（精确等值）。坏行跳过不抛的口径不变。

### `templates/_agents/scripts/verify.mjs`（落账）

- 解析 `--doc <path>`（沿 `--test-cmd` 同款取下一 argv 的写法；缺值报用法错误 exit 1，与既有 `--test-cmd` 处理对称）。
- 落账行增 `doc` 键：值 = `path.relative(ROOT, path.resolve(process.cwd(), docArg)).split(path.sep).join('/')`。**不带 `--doc` → 不写该键**（不是写 `null`）。
- 用法行：`node .agents/scripts/verify.mjs [--test-cmd "<shell 命令>"] [--doc <本单 workflow 路径>]`。
- **不动**步骤 1 跳过语义（装户无根 `package.json` → 跳过且不落账）。

### `templates/_agents/scripts/confirm-doc.mjs`（消费方 1）

- `hasFreshVerify(root, doc)` 增参 → `hasFreshVerifyLine(lines, Date.now(), doc)`。
- 前置 advisory：`doc` 仅在 `typeof loadKitPolicy(root).verifyDocSince === 'string'` 时传；否则传 `undefined`（v1–v5 走原全局行为）。
- 文案：`⚠️ ${doc} 置 done：24h 内无测试绿凭证（本单 ${rel} 须带 --doc 落账）——关单勾验的「测试绿」声明缺机器事实` / 下一行 `   跑 node .agents/scripts/verify.mjs --doc ${rel} 后重新关单；本次不拦截（advisory，灰度第一档）`。**`无测试绿凭证` 须连续、`verify.mjs` 须出现**——见 spec 场景 C/D 的文案硬约束。

### `templates/_agents/scripts/check-loop.mjs`（消费方 2）

- 台账内容仍在**循环外**读一次存为数组；把循环外的 `verifyFresh` 布尔改为循环内 `verifyFreshFor(rel)`：`typeof kitPolicy.verifyDocSince === 'string' ? hasFreshVerifyLine(vLines, Date.now(), rel) : verifyFreshGlobal`（后者即改前行为，保 v1–v5 零变化）。
- `vctx` 相应传 `hasFresh`（每 doc 现算）。
- WARN 文案：`...24h 内无 verify 凭证（verifications.jsonl；本单须带 --doc 落账）——跑 node .agents/scripts/verify.mjs --doc ${rel} 后重跑`。**`测试绿缺凭证` 须连续**。

### `templates/_agents/commands/test.md`

- verify 行追加一句关单前口径：`（关单前带 --doc workflow/intents/<本单>.md，绿行才与本单绑定）`。控制在 789B 余量内，**不调 rule-budgets**。

### 测试

- `verify.test.mjs`：① 带 `--doc` → 末行含 `doc` 且为规范化 posix 相对路径；② 不带 → 末行无 `doc` 键；③ win32 反斜杠写法与 posix 写法落同一值；④ 跳过步骤 1 时带 `--doc` 仍不落账。
- `confirm-doc.test.mjs`：v6 + 台账只有**他单**绿行 → advisory 出账；v6 + 本单绿行 → 静默；**v5 + 只有他单绿行 → 静默**（兼容反例，最关键的一条）。
- `check-loop.test.mjs`：v6 + 全仓他单绿行但本 intent 无 → WARN 出账；v6 + 本单绿行 → 豁免出账且无 WARN；**v5 + 只有他单绿行 → 无 WARN**（兼容反例）。既有 231 条断言零改动。
- `policy` 无独立 `.test.mjs`（随 verify/confirm-doc/check-loop 三套件直测覆盖）。

## 任务拆解

1. **policy 判据单源**（`POLICIES[6]` + `hasFreshVerifyLine` 第三参）
   - 判据：v1–v5 缺键路径与改前逐字节一致；doc 过滤为精确等值。
   - 风险：中（漏抄 v5 键会改动其他检查生效日）→ 逐键核对并断言。
2. **verify 落账 `--doc`**
   - 判据：四种路径写法落同一值；不带则无该键；跳过语义不回归。
   - 风险：中
3. **两个消费方按 doc 过滤 + 文案**
   - 判据：跨单绿行不认；文案锚点子串连续；v5 兼容反例绿。
   - 风险：**高**（改动既有输出面，231 断言依赖）→ 零改动既有断言作硬门。
4. **test.md + sync + sync-hosts + kit.json v6**
   - 判据：`rule-budget.sh --all` exit 0；薄适配 5 份同步；双源零 diff。
   - 风险：低
5. **实仓冒烟 + 全量验证 + 关单**
   - 判据：带/不带 `--doc` 各跑一次 verify 实仓；存量 done intent **新增告警行数 = 0**；`verify.mjs` exit 0；doctor 0 FAIL。
   - 风险：中

## 执行顺序

1 → 2 → 3 → 4 → 5。1 必须最先（两个消费方都依赖它）；4 在 3 之后（改完判据再升 policyVersion，避免中途态被门禁扫到）；5 收口。

## 验证计划

- **向后兼容（最关键）**：v5 fixture 下检查 8 与 confirm-doc 的行为断言**逐字不变**——三条「v5 + 只有他单绿行 → 不出账」的反例是本单的核心防线。
- **输出契约**：`check-loop.test.mjs` 既有 231 条断言**零改动**全绿（文案锚点子串钉死）。
- **新增判据**：跨单绿行不认本单；本单绿行认；不带 `--doc` 的绿行不给任何单背书。
- **文档同步**：5 份 `wf-test.md` 与 `test.md` 口径一致；`rule-budget.sh --all` exit 0。
- **实仓冒烟**：① `verify.mjs --doc <本单>` 全绿后末行含 `doc`；② 不带 `--doc` 跑一次确认 CI 路径不退化；③ 重跑 `check-loop` 确认存量 done intent **新增告警 0 行**（收紧的预期副作用应为「零」）。
- **静态门**：`verify.mjs`、`doctor`、双源 sha 零 diff。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：用户 2026-10-08 拍板方向 1 只切②凭证绑定；spec 定稿原话「可以——定稿 spec」
- 复核：L2 独立复核未执行（用户放行）；主智能体以「v5 兼容反例 ×3 + 既有 231 断言零改动 + 双源零 diff + 实仓冒烟」取证替代
- 偏离留痕：①（任务 5 判据）「存量 done intent 新增告警行数 = 0」被实证推翻——升 v6 实仓首跑 check-loop，4 个存量 intent 新增 8 条 `测试绿缺凭证` WARN（verify-evidence 2 / gate-roi-metrics 1 / selfmeasure-and-modularize 4 / workflow-dashboard 1），走的正是 spec 风险评估首条预判的分支（「若实证出现新增告警行 → 须逐条对质而非回退判据」）；逐条对质与「保留不补跑」的用户拍板留痕于 intent「实测发现」节——WARN 可消除（解法明确：真需要时跑 `verify --doc <该单>`）、不违反 audit-gate-hardening P3。②（改动方案）`--doc` 归一基准由 plan 写的 `path.resolve(process.cwd(), docArg)` 落地为 `path.resolve(ROOT, docArg)`——测试场景 8① 当场打红（不设 cwd 时落账成跨目录绝对路径，与两个消费方的 ROOT 基准永不匹配）；CI / 钩子 / CHECK_LOOP_ROOT 注入夹具下 cwd 常在仓库根外，落账与消费基准必须同源（返工点已记台账 delegations 行）。③（超出 spec 场景 D 授权面）confirm-doc advisory 未绑定（v1–v5）分支的 `（verifications.jsonl）` 一并改为 `（凭证未按单绑定）`——判定与豁免语义零变化、锚点子串（`无测试绿凭证` 连续 + `verify.mjs` 出现）未动（S38/S39 零改动仍绿），但「v1–v5 逐字不变」仅判定层成立、该条 advisory 文案有一处输出漂移；接受理由：新语义下旧括号误导（未绑定 ≠ 台账没有行），且不改变任何判定结果。④（规则面预算，提交时发现）常驻面**目录合计**预算硬拦（.agents/commands/ 合计 65544B > 上限 65536B）——单篇 8704B 与目录合计 65536B 是两道预算，任务 4 判据只验了 `--all` 的单篇面（当时 65536B 恰未越界前状态未显式核对目录合计）；按 intent「不调预算」约束压缩 test.md 版本括号 41B（`（policyVersion ≥6 生效，v1-v5 仍按全局绿行判）`→`（仅 v6+ 生效）`），目录合计回落 65503B，宿主薄适配经 sync-hosts 重对齐
