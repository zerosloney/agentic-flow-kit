---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-06
模块: pipeline
备注: workflow/ 模板属 owned（init 一次性复制）无下发通道——S18/S20 装户事故根因，机制改进立项
确认指纹: 0ed394f4e23b9ed4
---
# INTENT — template-downstream

## 背景与问题

本仓两态模型中 `workflow/` 文档模板（intents/specs/plans/incidents 四类 `_TEMPLATE.md`、README、delegations、papercuts、regression-checklist）全属 **owned**：init 一次性复制，sync 永不触碰（src/sync.mjs「owned 文件永不触碰」），owned 哈希只是记账不是约束。这是刻意设计——模板预期被项目改造（如 specs 模板的约束遵守映射表按项目红线填写）——但副作用是**源仓模板演进没有任何下发通道**，装户对模板陈旧零感知。

实证事故：v1.1.3 装入 Shipyard.Material 当日，装户 fill-spec.test S18/S20「引入即失败」——kit 随包测试的模板假设与装户侧陈旧模板断链，当时无任何门禁捕获（装户事后手工对齐模板）。记录见 `workflow/intents/2026-10-06-backflow-loop-audit-remediation.md` 附带发现（「下发机制改进另案」，本 intent 即该另案的立项）。

加剧因素：`templates/` 演进活跃（1.1.x 每日批次节奏均动模板/引擎面），每次演进都在静默制造陈旧装户；AGENTS.md「owned 须手动同步装副本」纯靠人的记忆，无机器提醒。

## 历史教训/防复发

- 检索结果：`kb-search "owned 台账"` 命中 6 件——shipyard-backflow-2（owned 记账策略与按盘面自愈闭环）、2026-10-02-ci-red-batch（owned 台账未随盘面刷新致漂移 WARN）、agents-md-merge / cross-host-sync / m3-sync-addons（owned 语义各闭环）；S18/S20 直接事故记录于 backflow-loop-audit-remediation intent 附带发现（装户侧 incident 在消费仓，本仓无同名 incident）。
- 避坑指南：①不动 owned 两态的所有权语义——硬覆写会踩掉装户定制，shipyard-backflow-2 的自愈策略以「owned 归项目所有」为前提；②本区域口径联动面大（renderTree / sync 三态 / doctor §4 / source-sync-check 四处联动，papercuts 2026-09-27 行「sha 记账跨机稳定」前车之鉴），spec 必须先盘清全量改动面再动手；③感知优先于强制——先让「陈旧」可见（advisory），自动合并与否留待证据充分后另案。

## 目标

- 装户对「源仓模板已有演进、本仓模板已分歧」从静默变为**有出账**：sync / doctor 输出模板感知 advisory，含分歧文件清单与源仓模板版本锚（版本锚的载体形态在 spec 论证：kit.json 字段 / 模板头注释 / renderTree 记账）。
- 感知机制有测试钉住：模拟「源仓模板演进 → 装户未更新」场景断言报告出账；「装户与源仓一致」场景断言静默零出账。
- S18 类「测试假设与模板断链」获得可见路径：装户侧测试与模板不一致时感知报告可见（机制覆盖面的取舍在 spec 论证）。

## 非目标（L1 微改动无实质内容可删本节，不硬填）

- 不改 owned 所有权语义：不硬覆写装户已定制文件，不做自动合并（是否需要合并层由本闭环 spec 论证，证据充分后可另案）。
- 不动 gate 脚本等 managed 下发面（那已经是现行下发通道）。
- 不做跨机版本锁定 / 强升级机制。

## 约束（L1 微改动无实质内容可删本节，不硬填）

- 引擎改动一律走 `templates/` → `node bin/flow-kit.mjs sync` 双源纪律；预计触达 src/{sync,doctor}.mjs、source-sync-check 口径、init/renderTree 记账——全量清单由 spec 盘点。
- owned 哈希「记账非约束」语义保持（shipyard-backflow-2 闭环结论，不得回归）。
- 常驻面预算中性：命令文档不增行，口径说明走模板注释或 wiki。

## 影响面

- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 或 Quick-Plan 中说明）

- [x] 规则 / 契约变更（sync / doctor 出账口径、kit.json 可能新增模板版本锚字段）→ 级别 L2

## 验收标准（可测试）

- [x] fixture 装户（init 产物）+ 源仓模板演进 → `flow-kit sync`（或 doctor）出「模板更新感知」advisory，含分歧文件清单（证据：src/sync.test.mjs S15①「出账含文件名」+ S15⑥「.agents/ 前缀翻译出账」+ S15⑤「doctor stale 清单同源」，套件 67 PASS / 0 FAIL）
- [x] 装户模板与源仓一致 → 感知检查静默零出账（证据：S15②「定制跟源静默」+ S15④「手工拉取静默」+ S15①「锚已刷再跑静默（单周期出账）」）
- [x] owned 语义不回归：装户手改模板后 sync 不覆写、不硬拦，既有 owned 自愈测试全绿（证据：S12「owned 文件不被触碰」/ S1 / S11 既有断言零改动全绿；npm test 除 trae-hooks 关单顺序项外全绿——trae-hooks 系发版草稿门禁对 approved 三件套的预期拦截，关单后复绿）
- [x] init 新装户全流程无回归（证据：src/fresh-init.test.mjs 8 PASS / 0 FAIL，含锚断言 3 条——AGENTS.md 带初始锚等于包源原文 sha / 生成器目标无锚 / _agents 前缀翻译带锚 + 无模板对应条目无锚）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 hard-block。

## 确认与复核

- 确认日期：2026-10-06（intent approved 代录「可用」；spec approved 代录「可用」；plan approved 代录「确认」；done 关单同语代录）
- 确认人：用户（对话内明确放行即确认）
- 确认范围：三方 sha 感知方案（spec）、函数级拆解（plan）、验收四条勾验（done）
- 复核：已完成独立复核（2026-10-06，independent-reviewer 对实现提交全量核验）——七条设计承诺全部通过、零 P0/P1；P2-1（_agents→.agents 前缀翻译缺失，5 条 owned 件漏出感知面）当场修复于 src/profiles.mjs#srcTemplatePath 单源点并补 S15⑥/fresh-init 断言钉住；P2-2（trae-hooks 因发版草稿门禁对 approved 三件套的预期拦截）关单后复绿；N-1 断言补齐，N-2/N-3/N-5 为口径/文案登记不阻断，N-4 历史遗留非本批范围
