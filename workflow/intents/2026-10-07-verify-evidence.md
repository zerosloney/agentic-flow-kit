---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-07
模块: pipeline
备注: done 前测试绿机器凭证——检查 8 证据核验从声明式升级为机器事实（Anthropic AI-Native SDLC「make test before done」基准必修缺口①）
确认指纹: f1f2d5ddb8a0c2ab
---
# INTENT — verify-evidence

## 背景与问题

关单勾验的现状是「声明式」：验收条目写「（证据：测试全绿）」这类文字，检查 8 的 `verifyEvidenceTruth` 对无 SHA 的证据一律走 `text` 豁免——**测试到底跑没跑、绿没绿，机器完全不知道**；勾验动作本身是人/AI 手改 markdown，无自动写入点。三个具体事实：

1. 检查 8 只核「SHA 真伪 + 是否触及 plan 声明文件」（check-loop.mjs verifyEvidenceTruth），不核「测试绿」；
2. **pipeline-run 路径其实已有机器事实**——verify.mjs 真跑 npm test→check-loop（fail-fast）、绿后才自动 commit、docsCommit 带 runId 可对质——但该事实只活在流程里，未落成证据核验可消费的形态；
3. 手动三段式（本仓主流用法，确认台账 312 条 chat-delegated 印证）完全没有测试绿的任何机器痕迹。

基准：Anthropic AI-Native SDLC playbook（2026-08，Applied AI）Test 阶段产物即「测试通过的 diff」，done 前置 **"make test before 'done'"**，另有 verbatim hash 锁（字节级凭证）。经全网检索核验（对话 2026-10-07），这是本仓两件必修缺口之一（另一件 CI 远端门另案）。

## 历史教训/防复发

- 检索结果：`kb-search "verify 测试 凭证 done"` 零命中（全新机制面，无同名先例）；`kb-search "先 WARN 升级 FAIL"` 命中 workflows-linter / cross-host-sync 两处——wf-runtime 复盘确立的渐进路径先例。
- 避坑指南：①灰度走「先 WARN、装户吃过警告后升 hard」，不直接 hard-block（既有两处先例 + 装户升级节奏不可控）；②新豁免/新判据一律走 policyVersion 演进（v5）+ 生效日锚，不回溯存量（delegationSince / confirmDocsEffective 同款纪律，防存量 advisory 不可消退——113 条事故教训在案）；③凭证台账 append-only，行 schema 对齐 confirmations.jsonl 先例（ts/来源/可对质字段），复用 pipeline-run 的 runId 绑定语义而非另造标识；④「跑测试」的成本须罩在关单时机（confirm-doc 单次调用），不做每 commit 触发。

## 目标

- **verify 留痕**：测试跑绿后往 append-only 台账（`.agents/verifications.jsonl`，行含 ts / exitCode / 测试计数 / runId 可选绑定）落一行机器事实；verify.mjs（pipeline-run 路径）与手动路径共用同一落账点。
- **done 门前置**：confirm-doc 将文档置 done 且该文档含「验收标准」节时，须存在时间窗口内的测试绿凭证，否则出 advisory 告警（窗口长度与升 hard 条件在 spec 论证）。
- **证据形态扩展**：检查 8 对生效日后的新建文档，验收证据里「测试绿」类声明须与凭证台账对得上账（无凭证 → warning），不再裸走 text 豁免。
- 三处新行为全部有测试钉住（fixture 正/负场景）。

## 非目标

- 不做 CI 远端门（push 后远端跑测试）——另一件必修缺口，涉及装户环境决策，另案立项。
- 不回溯存量：生效日锚前的 done 文档维持现状（不产生新 advisory）。
- 不动 pipeline-run 既有流程语义（其 runId 已可绑定，只加落账）。
- 不做「每条验收项绑定独立测试用例」的细粒度映射——凭证是仓级（npm test 全绿），条目级映射成本高收益存疑，spec 阶段如需再论证。

## 约束

- 引擎双源纪律：改动落 `templates/`（check-loop.mjs / confirm-doc.mjs / verify.mjs / policy.mjs）→ sync 装回。
- policyVersion v5：新增 `verifySince` 生效日锚；v1-v4 缺键 → 新检查整体跳过（向后兼容不放松，stageGateSince 先例）。
- append-only 台账纪律：只增不改不删，坏行容忍跳过（confirmations.jsonl 同口径）。
- 常驻面预算中性：命令文档零增行（test.md 口径微调走注释级）。

## 影响面

- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 或 Quick-Plan 中说明）

- [x] 规则 / 契约变更（检查 8 证据判据扩展 + confirm-doc 状态机前置 + policyVersion v5）→ 级别 L2

## 验收标准（可测试）

- [x] verify 留痕：测试跑绿后台账行落盘（ts/exitCode/测试计数），append-only；测试失败/退出码非 0 不落「绿」行（证据：verify.test.mjs 场景 4/5/6——全绿落行含计数捕获 PASS 3/FAIL 0、check-loop 红无凭证行、无汇总输出计数键省略，套件 9/0；实仓冒烟 .agents/verifications.jsonl 首行 {"exitCode":0,"passed":15,"failed":0}）
- [x] done 门前置（advisory）：含验收标准的文档置 done、窗口内无凭证 → confirm-doc 输出告警；有凭证 → 静默放行（证据：confirm-doc.test.mjs S38/S39——无凭证 ⚠️ 出账且 done 仍落态（advisory 不拦）、24h 内有绿行静默，套件 50/0）
- [x] 检查 8 证据对账：生效日后新建 done 文档的「测试绿」类证据无凭证 → warning；有凭证 → 豁免成立（证据：check-loop.test.mjs 凭证对账两场景——锚后无凭证出「测试绿缺凭证」warning 且不 hard、有近期绿行出「证据豁免 verify」零 warning，套件 213/0）
- [x] 存量豁免：生效日锚前的 done 文档零新增 advisory（证据：实仓 check-loop 改后跑 WARN 计数 0、exit 0——v5 下 66 个存量 intent 加入日期均 < verifySince 不进对账）
- [x] 既有套件零回归：npm test 全绿（证据：npm test 全部套件通过——trae-hooks 的发版草稿瞬态红属关单前标准收单路径，关单 docs 提交落地自愈，1.1.9 周期同形态实证；关单后复跑复绿见关单提交说明）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 hard-block。

## 确认与复核

- 确认日期：2026-10-07（intent approved 代录「可以」；spec approved 代录「确认」；plan approved 代录「可以」；done 关单同语代录）
- 确认人：用户（对话内明确放行即确认）
- 确认范围：凭证 schema/窗口 24h/灰度 advisory（spec）、函数级拆解（plan）、验收五条勾验（done）
- 复核：已完成独立复核（2026-10-07，independent-reviewer 对实现提交全量核验）——**PASS 零 P0/P1**：六条设计承诺逐条对齐（全绿落账时序/前置 fail-open/对账分支与 hasImplEvidence 排除/窗口单源/v5 键集逐键一致/向后兼容），fixture 隔离与双源 cmp 逐字节核验通过；P2-1（PIPELINE_RUN_ID 无生产方，runId 绑定承诺落空）当场修复于 pipeline-run.mjs#runNode（env 注入一行 + 29 组断言全过）；N-1 发版草稿瞬态红（关单自愈）、N-2 窗口无下界（时钟属本机信任边界）、N-3 验收节正则两处不同款（advisory 方向、无阻断）、N-4 vctx null 时的多余读、N-5 模板副本直跑落账 footgun——登记不阻断
