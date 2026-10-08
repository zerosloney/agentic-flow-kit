---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-08
模块: pipeline
备注: 2026-10-08 AI SDLC 演进缺口判断的第二刀——测试绿凭证与被证明对象零绑定（用户 2026-10-08 拍板方向 1 只切②凭证绑定）
确认指纹: c4a972afa907b49c
---
# INTENT — verify-doc-binding

## 背景与问题

2026-10-08 的 AI SDLC 演进方向评审把「自证式验证」列为方向 1 的核心问题；本单按用户拍板**只切其中最严重的切口②：测试绿凭证与被证明对象零绑定**。

`2026-10-07-verify-evidence` 把「关单勾验的测试绿」从声明式升级为机器事实（凭证机制），但**凭证本身没有指明它是为哪一单落的**。实测本仓 `.agents/verifications.jsonl` 全部 8 行：

```
{"ts":"...","exitCode":0,"suite":"npm test","passed":15,"failed":0}
```

**没有一行带 `doc` 字段**。而两个消费方都只问「全仓任意一份 24h 内的绿行」：

- `check-loop.mjs:765` 检查 8：`verifyFresh` 在**循环外算一次**，对每个 done intent 一律用同一个布尔值；
- `confirm-doc.mjs:47` 置 done 前置：`hasFreshVerify(root)` 同样只看全局。

后果可精确表述：**跑一次 `verify.mjs`，全仓所有 done intent 的「测试绿」声明同时获得背书**——凭证证明的是「某个东西在某时刻绿过」，却被当作「这一条验收标准为真」。这是教科书式的自证：证据与被证明的对象之间没有绑定，任何一份绿行可以给任意一单作证。

方向 1 的另外三个切口（①豁免即默认致激励反向、③判据只验形态不验内容、④pre-push 已逐个 `--rev` 扫每棵树却从不比较其结果）**本单不做**，用户已明确只切②。

## 历史教训/防复发

- `2026-10-07-verify-evidence`：凭证机制本身的设计失误——落账时**没有任何字段能承载「为哪一单」**，且当时未预见「凭证会被多单共用」。本单的教训是：**新增凭证字段时必须同时确认两个消费方是否按该字段过滤**，否则新字段只是记录、无人消费。
- `2026-09-27-audit-gate-hardening` P3：「无判定依据的行不产出不可消除噪声」。本单若把收紧后的判据无条件应用到存量装户，会让存量 done intent 集体失去背书并稳定出账 → 必须走 policyVersion 缺键豁免（同 `2026-10-06-loop-audit-remediation` 的 `delegationSince` 补锚先例）。
- `2026-10-05-check8-digit-sha-misfire`：「文本启发式须可被实证兜底，禁以字符形态抢先分类」。本单的 doc 匹配必须是**精确等值**，不得退回「模糊命中即认」。
- `papercuts` 2026-10-04 isMain 行：改 verify.mjs 时注意 import 即执行的边界（它是纯 CLI，isMain 守卫现状不动）。
- `papercuts` 2026-10-07 装户回流批：装户仓无根 `package.json` 时 verify 显式跳过步骤 1 且**不落凭证**（防假绿）——本单不得破坏该语义：跳过时即便带 `--doc` 也不落行。

## 目标

- G1 `verify.mjs` 支持 `--doc <path>`，落账行携带规范化后的 `doc` 字段（`workflow/intents/xxx.md` 形态，win32/posix 分隔符归一）；不带 `--doc` 时仍落行但 `doc` 缺省（CI 场景照常记录事实，不为任何单背书）。
- G2 `policy.hasFreshVerifyLine(lines, now, doc)` 增第三参：`doc` 非空时**只认 `e.doc === doc` 的绿行**；`doc` 为空维持原行为（v1–v5 装户零变化）。
- G3 两个消费方改为按文档过滤：检查 8 的 `verifyFresh` 从「循环外算一次」改为「按本 doc 查」；`confirm-doc` 置 done 前置传本 doc。
- G4 policyVersion 升 **v6**，新增键 `verifyDocSince`；缺键（v1–v5）维持 v5 行为，存量装户零新增告警。
- G5 修复命令与提示文案全部带 `--doc`（检查 8 的 WARN、confirm-doc 的 advisory、`test.md` 与 5 份宿主薄适配）。

## 非目标

- 不改检查 8 的豁免结构（`text` / `external` / `record` / `no-plan` / `process` 五类豁免一律不动）——那是切口①③，另单。
- 不做门禁输出差分（切口④）——pre-push 的多树 `--rev` 结果消费是独立设计，另单。
- 不回填存量 8 行凭证的 `doc`：无从判定它们为哪一单而跑，无据补数即造数。
- 不把 `--doc` 设为必填：CI（`kit-ci.yml`）无单次上下文，强制必填会直接打断远端门。
- 不改 `PIPELINE_RUN_ID` → `runId` 的既有绑定（pipeline-run 已有 runId 通道，本单不合并两条绑定线）。

## 约束

- **向后兼容不放松**：v1–v5 装户行为逐字不变（新键缺省即跳过）。收紧只对本仓自身升 v6 后生效。
- **台账 append-only**：只 append 新行，既有 8 行零改写。
- **零额外运行成本**：doc 过滤在内存里做（verifications.jsonl 全量读一次循环外，行内匹配），不新增任何子进程调用。
- **双源纪律**：只改 `templates/_agents/scripts/`，随后 `node bin/flow-kit.mjs sync`；命令文档改 `templates/_agents/commands/test.md`，随后 `node bin/flow-kit.mjs sync-hosts --apply`。
- **规则面预算**：`.agents/commands/test.md` 单篇余量 789B（实测 7915 / 预算 8704），新增文案须控制在此内，**不调预算**（调预算即门禁噪声，2026-10-07 adopter-ci-github 已吃过一次）。
- 宿主薄适配（`modules/hosts/*/commands/wf-test.md`）走 `sync-hosts`，**不手改**。

## 影响面

- 模块：pipeline
- 数据库：无（`.agents/verifications.jsonl` 为 append-only 文本台账，无 schema）
- 改动面：`templates/_agents/scripts/{verify.mjs, policy.mjs, confirm-doc.mjs, check-loop.mjs}` + `templates/_agents/commands/test.md` + `.agents/kit.json`（policyVersion）→ sync + sync-hosts

## 触达红线（对照 AGENTS.md）

- [x] 规则 / 契约变更（新增 CLI flag `--doc` + 凭证 schema 增字段 + 两处判据语义收紧）→ 级别至少 L2
  - 证据：v6 防御道三道门齐备——intent / spec / plan 逐份 `confirm-doc` 代录置 approved（台账 `source: chat-delegated`，原话「可以——按此定稿 intent」「可以——定稿 spec」「可以——定稿 plan，开始实现」），关单逐份置 done。
- [x] 无 schema / 迁移 SQL / DI 链改动 → 不构成 L3（台账为 append-only 文本，非结构化 schema）
  - 证据：改动面全为 `templates/_agents/scripts/*.mjs` + `templates/_agents/commands/test.md` + `.agents/kit.json` 的单个整数键；`.agents/verifications.jsonl` 为 append-only 文本台账，**存量 8 行零回填**（无从判定它们为哪单而跑，无据补数即造数）。

> 触及红线即为 L2，必须立 `../specs/2026-10-08-verify-doc-binding.md` 写明如何满足，方可起草 plan。

## 验收标准（可测试）

- [x] G1：`node .agents/scripts/verify.mjs --doc workflow/intents/x.md` 全绿后，`verifications.jsonl` 末行含 `doc` 字段且值等于规范化后的相对路径（win32 下 `.\workflow\intents\x.md` 与 posix 形态落同一值）
  - 证据：`verify.test.mjs` 场景 8①（`entry.doc === 'workflow/intents/2026-10-08-demo.md'` 且 stdout 含「绑定本单」）与场景 8③（反斜杠 / posix / 绝对路径三种写法落同一 `doc` 值），本套件 **12 → 17/0**。
- [x] G1：不带 `--doc` 跑 verify 仍落行（CI 场景不退化），但该行不带 `doc` 键
  - 证据：场景 8② —— `eB.exitCode === 0 && !('doc' in eB) && eB.suite === 'npm test'`；断言的是**键不存在**，不是值为 null。
- [x] G2：`hasFreshVerifyLine(lines, now, doc)` 在有「别的 doc 的绿行」但无本 doc 绿行时返回 false；doc 缺省参数时行为与改前逐字节一致
  - 证据：`confirm-doc.test.mjs` S40①（v6 + 他单绿行 → advisory 出账）、S40②（v6 + 本单绿行 → 静默）、S40④（v6 + 无 `doc` 键的绿行 → 出账）；`check-loop.test.mjs` 新增三条（v6 他单 → WARN / v6 本单 → 豁免 / **v5 他单 → 无 WARN**）。缺省路径的兼容性由既有 S38/S39（policyVersion 5）**零改动仍绿**保证，两套件合计 **54/0** 与 **231→234/0**。
- [x] G3：检查 8 对一个 done intent 判定「测试绿」时，只认 `e.doc` 等于该 intent 相对路径的绿行；全仓有他单绿行但无本单绿行 → 出 `WARN 测试绿缺凭证`
  - 证据：`check-loop.test.mjs`「检查8 凭证绑定:v6 + 只有**他单**绿行 → 仍出 WARN」——同时断言 `!outOf(r).includes('证据豁免 verify')`，即**不只是多一行，而是豁免确实没生效**。
  - 证据：**实仓**——本仓升 v6 后立即实仓跑 check-loop，4 个存量 intent 新增 8 条 `测试绿缺凭证` WARN（verify-evidence 2 / gate-roi-metrics 1 / selfmeasure-and-modularize 4 / workflow-dashboard 1）——漏洞在存量真实存在的直接证据，逐条对质见上方「实测发现」节。
- [x] G3：`confirm-doc` 置 done 前置同样按本 doc 过滤，无本单绿行时出 advisory 且文案含 `--doc`
  - 证据：S40① 断言 `/--doc/.test(r.stderr)`；实仓本次走 `verify.mjs --doc workflow/intents/2026-10-08-verify-doc-binding.md`，落行带 `"doc":"workflow/intents/2026-10-08-verify-doc-binding.md"` —— 本单关单时前置凭**绑定到本单**的绿行放行，是该机制的首次真实使用。
  - 文案锚点未被破坏：`无测试绿凭证` 六字连续 + `verify.mjs` 出现——既有 S38/S39 **零改动仍绿**（`confirm-doc.test.mjs` 54/0）。
- [x] G4：kit.json `policyVersion: 6`；v1–v5 fixture（无 `verifyDocSince` 键）行为与改前一致，零新增告警
  - 证据：`POLICIES[6] = POLICIES[5] 全键 + verifyDocSince`（逐键照抄，v2 漏抄 `check14Since` 的前车之鉴）；三条兼容反例全绿：`confirm-doc` S40③（v5 + 他单绿行 → 静默）、`check-loop`「v5 + 只有他单绿行 → 无 WARN」、既有 S38/S39（v5）零改动。`kit.json` 实测 `"policyVersion": 6`，`doctor` **14 PASS / 0 WARN / 0 FAIL**。
- [x] G5：`test.md` 与 5 份宿主 `wf-test.md` 均含 `--doc` 用法说明，且 `rule-budget.sh --all` exit 0（不超预算）
  - 证据：`node bin/flow-kit.mjs sync-hosts --apply` 后 codex / cursor / opencode / trae / claude 五份 `wf-test.md` 各自 `--doc` 命中 1 处；`test.md` 7915 → **8138B** / 单篇预算 8704B，**未调 rule-budgets**——提交时被常驻面**目录合计**预算硬拦（65544 > 65536，单篇与目录合计是两道预算，会话前期只验了单篇），按本单「不调预算」约束压缩版本括号（41B，`（policyVersion ≥6 生效，v1-v5 仍按全局绿行判）`→`（仅 v6+ 生效）`，v1-v5 语义细节以 spec/CHANGELOG 为准），目录合计回落 65503B，`sh .agents/scripts/rule-budget.sh --all` exit 0。
- [x] 静态门：`verify.mjs` exit 0、`doctor` 0 FAIL、双源零 diff、`gen-workflow-index/dashboard/metrics` 无漂移
  - 证据：**实仓冒烟 2026-10-08（任务 5）**——带 `--doc` 与不带各跑一次均 exit 0：前者台账末行 `"doc":"workflow/intents/2026-10-08-verify-doc-binding.md"`（归一 posix 值）且 stdout 含「绑定本单」，后者末行无 `doc` 键且 stdout 含「未带 --doc：不给任何单背书」（CI 路径不退化）；两轮各含 npm test 全量（15 PASS / 0 FAIL）+ check-loop（EXIT=0，仅既有 8 条 `测试绿缺凭证` advisory 与索引漂移/三件套两条已知 advisory）。双源 7 件 `diff` 零差异（policy / verify / confirm-doc / check-loop / verify.test / confirm-doc.test / check-loop.test）；偏离留痕与补留痕件落盘后 `flow-kit sync` 重生成三件生成物并刷 owned 台账，`doctor` 14 PASS / 0 WARN / 0 FAIL（policyVersion 6 下）。
- [x] 回归网：`check-loop.test.mjs` 既有 231 条断言**零改动**全绿（输出契约钉子）
  - 证据：**234/0**（231 既有 + 新增 3），既有断言除**追加**新场景外零改动；文案改动的两条既有锚点（`测试绿缺凭证` / `无测试绿凭证`+`verify.mjs`）按 spec 场景 C/D 的「只追加不插入锚点内部」约束实现——若插入锚点，S38/S39 与 check-loop.test.mjs:2743 会当场转红。

## 实测发现：漏洞在存量里真实存在（2026-10-08 冒烟）

本仓升 v6 后立即实仓跑 check-loop，**预测中的副作用真的发生了**——这是本单价值的直接证据，也是 spec 风险表里「存量 done intent 失去测试绿背书」那条的实证：

| intent | 新增 WARN 条数 |
|---|---|
| 2026-10-07-verify-evidence | 2 |
| 2026-10-08-gate-roi-metrics | 1 |
| 2026-10-08-selfmeasure-and-modularize | 4 |
| 2026-10-08-workflow-dashboard | 1 |

**逐条对质结论（spec 要求「须逐条对质而非回退判据」）**：这 4 个 intent 关单时**确实各自跑过 `verify.mjs` 且全绿**（本会话几次关单均有实跑记录），但凭证从未指名是为哪一单落的 —— 门禁当时**在原理上无法区分**「本单的绿」与「别的单的绿」。因此这 8 条**不是造假告警，是「无法验证」的诚实判定**：声明本身大概率为真，但门禁拿不出证明它为真的机器事实。

**为什么不用「补跑一次 `--doc` 绑回来」消掉它们**：补跑只能证明「**当下**全绿」，**回溯不了「关单当时全绿」**——补跑是事后追认，与本单要消灭的自证式验证同构。故本单选择**保留这 8 条 WARN** 并如实留痕：它们是**可消除**的（有明确解法：真需要时可跑 `verify --doc <该单>`），不违反 audit-gate-hardening P3「无判定依据的行不产出不可消除噪声」——此处判定依据充分（声明 + 台账俱在），且解法明确。

## 确认与复核

- 确认日期：2026-10-08（对话内代录，approved/done 原话见台账）
- 确认人：用户（对话内明确放行即确认）
- 确认范围：用户 2026-10-08 拍板「方向 1 启动」+ 就切口范围选「只做②凭证绑定」
- 复核：L2 独立复核未执行（用户放行）；主智能体以「v1–v5 兼容 fixture 对账 + 既有 231 断言零改动 + 双源零 diff + 实仓冒烟」取证替代
