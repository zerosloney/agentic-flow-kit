---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-01
模块: pipeline
备注: 自报制漂移加固批：判级触达面机器校验 / 探索泳道漏标记本地拦截；quote 复用检测经 incident 复盘否决（见非目标）
确认指纹: 95dcd3cf1837cb69
---
# INTENT — drift-hardening

## 背景与问题

对现行闭环做漂移评估后确认两类残余漂移面，均为「自报制」环节——机器门禁只能读到 AI 自己填的标记，标记缺失时防线整体失明：

1. **判级漂移（根因级）**：泳道选择完全建立在入口处一次 L0-L3 定级上。check-loop 的「红线判低」拦截图（check-loop.mjs:288-294）读的是 intent 正文里 AI 自勾的 `- [x]` 红线行——L2 改动被误判 L1 时不勾即绕过，整套防御道门禁（spec 确认 / 独立复核 / 同步拦截）被合法绕行。判级正确性目前无任何独立校验。
2. **探索泳道漏标记**：workflow/README「探索泳道」节明文承认诚实边界——「分支名不进 commit，漏标记的探索件不被加固门覆盖，标记靠泳道纪律写入」。pre-commit（.githooks/pre-commit:26-35）已在 experiment/* 分支识别泳道降级 advisory，但对该分支上暂存的 intent 是否带「阶段: exploring」标记零检查，漏标记件一路裸奔到 pre-push 加固门才可能暴露（未标记件加固门同样不认）。

需求来源：2026-10-01 对话内漂移评估（用户确认「做」）。

## 历史教训/防复发

- 检索结果：`workflow/incidents/2026-09-28-batch-ledger-audit.md`（quote 相等 + ts 接近反推判据方向性失效——「惩罚合规、放行伪装」，退役时占 advisory 64%）；`workflow/incidents/2026-09-25-wf-runtime.md`（引擎双源纪律）；`.githooks/pre-commit` 双源/台账门禁注释中三次真实故障先例
- 避坑指南：
  - **新判据只用一手事实**（暂存区文件清单、frontmatter 字段），不用可规避信号反推过程——这是 batch-ledger-audit 的核心判准，据此**否决**本批原提案第 3 项「代录 quote 复用检测」（见非目标）
  - 引擎改动一律改 `templates/` 包源再 `sync` 下发，`.agents/`/`.githooks/` 直改必触发 doctor 漂移与双源门禁
  - 门禁增量口径沿 `check-pairing-incremental.sh` 先例（比较口径、暂存触发、装户自然跳过）

## 目标

- 触达面判低拦截：pre-commit 时刻，暂存 diff 命中项目配置的 L2 触达面模式、且存在可关联的 draft/approved L0/L1 intent 时，hard-block 报「触达面判低」（消息含命中文件与关联 intent 及修法）；intent 声明 L2/L3 或无可关联 intent 时放行
- 探索标记拦截：experiment/* 分支上暂存的新建/修改 intent 缺「阶段: exploring」（或「状态: exploring」，口径同 check-loop 加固门）时 pre-commit 阻断并给出补标记指引；已标记或非探索分支放行
- 两项拦截的模式与关联规则可按项目配置（本仓给默认值），装户无配置时自然跳过（无感升级）

## 非目标

- **代录 quote 复用机器检测——经 incident 复盘否决不做**：2026-09-28-batch-ledger-audit 已证明 quote 相等类判据「惩罚合规、放行伪装」；机器可观测部分（逐件纪律）已由台账 batch/seq/of 一手事实覆盖，剩余纯语义层（原话真伪）维持「事后对质」定位
- Trusted 自动泳道语义调整（用户授权让渡的设计选择，不动）
- 验收证据真伪 / spec-实现一致性的机器验证（语义层，维持事后对质定位）
- pre-push 加固门（check-loop --hardening）转正判据本身的行为变化——本批只补上游「漏标记」拦截，不动转正判据
- L0 泳道 / intent 豁免规则的调整

## 约束

- 双源纪律：一律改 `templates/_githooks/`、`templates/_agents/` 后 `node bin/flow-kit.mjs sync` 下发
- 常驻面预算：优先扩展既有增量 hook / 既有脚本模式，避免新增常驻文件；确需新增须过 rule-budget 门
- 只增不松：既有门禁判据不放宽；新增检查在装户无配置时跳过，不产生新噪声（沿 batch-ledger-audit「不可消除噪声淹没真漏点」判准）
- 门禁消息格式沿既有约定（`[标签]` 前缀 + 具体修法指引）

## 影响面

- 模块：pipeline
- 数据库：无
- （无前端页面）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 或 Quick-Plan 中说明）

- [x] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）$\rightarrow$ 级别至少 L2
  - 触及面：pre-commit 门禁编排契约（新增两道拦截位）+ 新增项目级配置面（L2 触达面模式清单）——一处定义、所有装户消费

> 触及任一红线即为 L2 / L3，必须立 ../specs/YYYY-MM-DD-<主题>.md 写明如何满足，方可起草 plan。

## 验收标准（可测试）

- [ ] 暂存 diff 命中 L2 面模式且关联 draft L0/L1 intent → pre-commit 阻断，消息含命中文件与关联 intent 名（证据：fixture 测试用例名 + 本仓一次实录拦截输出）
- [ ] 同样 diff 但关联 intent 为 L2/L3 → 放行；无任何可关联 L0/L1 intent → 放行（证据：fixture 用例名）
- [ ] experiment/* 分支暂存无「阶段: exploring」的 intent → 阻断并给出补标记指引；补标记后放行；非 experiment 分支不触发本检查（证据：fixture 用例名）
- [ ] 装户无 L2 面配置时检查自然跳过，无新增告警/阻断（证据：fixture 用例名）
- [ ] `npm test` 全绿（含新增用例）；check-loop.test.mjs 既有套件不回退（证据：测试输出）
- [ ] 引擎改动经 `templates/` + sync 下发，`node bin/flow-kit.mjs doctor` 无新增漂移告警（证据：doctor 输出）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 hard-block。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：drift-hardening 批（触达面判低拦截 + 探索标记拦截；quote 复用检测否决）
- 复核：L2 不强制独立会话复核（L3 才要求）；test 阶段 check-loop + 独立复核按 L2 口径执行
