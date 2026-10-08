---
状态: approved
级别: L2
日期: 2026-10-08
模块: pipeline
备注: 对应 intent 2026-10-08-verify-doc-binding（L2 防御道，用户 2026-10-08 拍板方向 1 只切②凭证绑定）
确认指纹: 91cade07419d4202
---
# SPEC — verify-doc-binding

对应入口：../intents/2026-10-08-verify-doc-binding.md

## 功能行为

**场景 A · 凭证落账增 `doc` 字段**：`verify.mjs` 增 `--doc <path>`。两步全绿后 append 的行在原有键之外增 `doc`：`{ts, exitCode, suite, passed?, failed?, runId?, doc?}`。`doc` 取**相对仓库根的 posix 形态路径**（`workflow/intents/2026-10-08-x.md`）——传入值先经 `path.resolve` + `path.relative(ROOT, …)` + 分隔符归一，故 `.\workflow\intents\x.md`、`workflow\intents/x.md`、绝对路径三种写法落同一值。**不带 `--doc` 时仍落行且不带 `doc` 键**（CI 场景不退化）。

**场景 B · 判定单源增第三参**：`policy.hasFreshVerifyLine(lines, now, doc)`。`doc` 非空 → **只认 `e.doc === doc` 的绿行**（精确等值，不做模糊/前缀匹配，沿 `2026-10-05-check8-digit-sha-misfire` 的「禁以形态抢先分类」纪律）；`doc` 缺省或空串 → 维持改前行为（全量行扫描）逐字节不变。两个消费方共用同一函数，窗口字面量仍单源。

**场景 C · 检查 8 按本 doc 对账**：`verifyFresh` 由「循环外算一次全局布尔」改为「循环内按本 intent 的相对路径查」（文件内容仍在循环外读一次并缓存，行内匹配）。判定为 false 时 WARN 文案改为指名修复命令：`跑 node .agents/scripts/verify.mjs --doc <rel> 后重跑`。**WARN 的出现条件收紧**（全局绿行不再对本单生效），这正是本单的目的。

**场景 D · confirm-doc 前置按本 doc**：`hasFreshVerify(root, doc)` 增参，置 done 前置传本 doc 的规范化相对路径；advisory 文案改为指名修复命令。

**场景 C/D 的文案硬约束（既有断言锚点，231 断言零改动的前提）**：既有测试锚定的是**子串**，改文案只能**追加、不得替换或插入锚点内部**——

| 消费方 | 既有断言锚定子串 | 文案约束 |
|---|---|---|
| 检查 8 WARN | `测试绿缺凭证` | 该四字须**连续出现**；doc 与 `--doc` 命令追加在其后 |
| confirm-doc advisory | `无测试绿凭证` **且** `verify.mjs` | `无` 与 `测试绿凭证` 之间**不得插入任何内容**；doc 与命令追加在整句之后 |

反例（**禁止**）：`24h 内无**本单**（x.md）的测试绿凭证` —— 插入内容会直接打破 confirm-doc 的两条断言。正确形态：`24h 内无测试绿凭证（本单 x.md 须带 --doc 落账）`。

**场景 E · policyVersion v6**：`POLICIES[6] = POLICIES[5] 全键 + verifyDocSince: '2026-10-08'`。**两个消费方仅当 `typeof policy.verifyDocSince === 'string'` 时才按 doc 过滤**，缺键（v1–v5）维持原全局行为 → 存量装户与存量 fixture 零变化、零新增告警。`.agents/kit.json` 本仓升 `policyVersion: 6`（managed 台账同步由 `flow-kit sync` 负责）。

**场景 F · 命令文档**：`templates/_agents/commands/test.md` 的 verify 行补 `--doc` 用法（关单前 `node .agents/scripts/verify.mjs --doc workflow/intents/<本单>.md`）；随后 `sync-hosts --apply` 把薄适配同步到 5 份 `wf-test.md`。**不调 rule-budgets**（实测 `test.md` 7915B / 预算 8704B，余量 789B 足够）。

**边界与异常**：`--doc` 指向的文件不存在 → **照常落行并如实记该路径**（凭证记录的是「跑了什么」不是「文件是否有效」，校验存在性属裁决、越界）；doc 值为空串 → 等同未传；台账 IO 失败 → 只出账不阻断（沿现状）；装户仓跳过步骤 1 时**即便带 `--doc` 也不落行**（防假绿，`papercuts` 2026-10-07 语义不得破坏）。

## 数据流

- 落账：`verify.mjs --doc X` → 两步全绿 → `{ts, exitCode:0, suite, passed?, failed?, runId?, doc: normalize(X)}` append 到 `.agents/verifications.jsonl`。
- 消费（检查 8）：读台账全量行（循环外一次）→ 对每个 done intent `hasFreshVerifyLine(lines, now, rel)` → 命中则 verify 型豁免、未命中则 WARN（文案含 `--doc <rel>`）。
- 消费（confirm-doc）：置 done 时 `hasFreshVerifyLine(lines, now, normalize(doc))` → 无命中出 advisory（fail-open，不拦退出码，现状不变）。

## 系统改动清单

1. **修改** `templates/_agents/scripts/verify.mjs`：新增 `--doc` 解析与落账字段；用法行同步。
2. **修改** `templates/_agents/scripts/policy.mjs`：`POLICIES` 增 v6；`hasFreshVerifyLine` 增第三参 `doc`。
3. **修改** `templates/_agents/scripts/confirm-doc.mjs`：`hasFreshVerify` 增 doc 参；前置 advisory 文案带 doc 与修复命令；仅 v6+ 按 doc 过滤。
4. **修改** `templates/_agents/scripts/check-loop.mjs`：检查 8 的 `verifyFresh` 改按本 doc 查（行缓存留在循环外）；WARN 文案带 `--doc <rel>`；仅 v6+ 按 doc 过滤。
5. **修改** `templates/_agents/commands/test.md`：补 `--doc` 用法（1 行，控制字节）。
6. **修改** `.agents/kit.json`：`policyVersion: 5 → 6`（由 `flow-kit sync` 落）。
7. **测试**：`policy` 新增 doc 过滤正反例；`verify.test.mjs` 增 `--doc` 落账三态（带 doc / 不带 doc / 跳过不落账）；`confirm-doc.test.mjs` 增「他单绿行不认本单」；`check-loop.test.mjs` 增「全仓他单绿行但本单无 → WARN」。
8. 实现后 `node bin/flow-kit.mjs sync` + `node bin/flow-kit.mjs sync-hosts --apply`。

无删除、无新依赖。

## 约束遵守映射（对照 AGENTS.md 触达红线）

| 红线 | 本 spec 如何满足 |
|---|---|
| 装户向后兼容不放松 | v6 新键；缺键即维持 v5 全局行为，v1–v5 fixture 断言零变化 |
| 防不可消除噪声 | 收紧只对本仓 v6 生效；存量装户不会因本单新增任何告警行 |
| 门禁稳定输出契约 | 检查 8 的 WARN 文案变更属**既有输出面**（非新增段）；既有 231 条断言零改动作钉子，若文案变更波及既有断言须在 spec 内显式登记 |
| 台账 append-only | 只 append 新行；存量 8 行零改写 |
| 不臆造数据 | 存量行不回填 `doc`（无从判定为哪单而跑） |
| 规则面预算 | `test.md` 余量 789B，新增控制在余量内，不调预算 |
| 引擎双源纪律 | 改 `templates/` → sync；命令文档 → sync-hosts |
| 新脚本测试覆盖（检查 20） | 无新增脚本；四个改动件的测试同步扩 |

## 风险评估

- **存量 done intent 失去「测试绿」背书** → 预期效果（那正是漏洞）。因存量 intent 的证据多走 `text`/`external`/`record` 豁免、不命中「测试绿」关键词，实际新增告警为零；若实证出现新增告警行 → 说明存在靠全局绿行背书的存量单，须逐条对质而非回退判据。
- **WARN 文案变更波及既有断言**｜中｜`check-loop.test.mjs` 231 条断言零改动是硬约束；若某条断言锚定旧文案，改文案前先看该断言，改不动则**保留旧文案 + 追加新提示**而非替换。
- **`--doc` 路径形态不一致致误判**｜中|win32/posix/相对/绝对四种写法必须落同一值；测试覆盖至少 win32 反斜杠 + posix 两种。
- **policyVersion 升版影响面**｜中|升 v6 = 同时接受 v5 的全部早期锚（本仓 v5 以 v2 为基线，与现状一致）；装户升 v6 前 doctor 会提示锚变化，属既有机制。
- **未带 `--doc` 的关单流程出 advisory**｜低|advisory 层不拦关单，且文案已给出正确命令；`test.md` 与 confirm-doc advisory 双处引导。
- **门禁成本增加**｜低|doc 过滤纯内存行匹配，无新增子进程。

## 确认与复核

- 确认日期：2026-10-08（对话内代录，approved/done 原话见台账）
- 复核：L2 独立复核未执行（用户 2026-10-08 放行）。主智能体以「v1–v5 fixture 对账 + 既有 231 断言零改动 + 双源零 diff + 实仓冒烟（带 `--doc` 与不带 `--doc` 各一次）」取证替代；重点核对向后兼容与输出契约。
