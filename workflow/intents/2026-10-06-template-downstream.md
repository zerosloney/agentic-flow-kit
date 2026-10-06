---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-06
模块: pipeline
备注: workflow/ 模板属 owned（init 一次性复制）无下发通道——S18/S20 装户事故根因，机制改进立项
确认指纹: 62a19c2cbfb51536
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

- [ ] fixture 装户（init 产物）+ 源仓模板演进 → `flow-kit sync`（或 doctor）出「模板更新感知」advisory，含分歧文件清单（证据：测试用例）
- [ ] 装户模板与源仓一致 → 感知检查静默零出账（证据：测试用例）
- [ ] owned 语义不回归：装户手改模板后 sync 不覆写、不硬拦，既有 owned 自愈测试全绿（证据：npm test）
- [ ] init 新装户全流程无回归（证据：init.test.mjs 全绿）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 hard-block。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：
- 复核：L2 须独立复核（.agents/commands/review.md 横切入口，实现完成后）
