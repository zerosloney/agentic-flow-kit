---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-06
模块: infra
备注: 装户（Shipyard.Material）回流批次，用户 2026-10-05/06 对话拍板打包三件；kit 仓自身不切 v3（POLICIES[3] 供装户 kit.json 选入）；取代 2026-10-06-v114-backflow-batch（双字段对齐）
确认指纹: 5f3ad8139c6033b7
---
# INTENT — v1.1.4 回流批次（policy v3 + 记录型提交豁免 + 预算 fixture 自校准）

> 本组取代 2026-10-06-v114-backflow-batch（done 后补 risk_level 触发「确认内容漂移」，按 confirm-doc 口径走 superseded + 新档引用；内容与实现证据不变，实现提交 71439e2 / 发版 f760c42 沿用）。

## 背景与问题

装户 Shipyard.Material 侧三件引擎面改动/需求，回流 kit 源仓发版（1.1.3 → 1.1.4）：

1. **policy v3**：装户确认台账机制 09-27 上线但 10-05 才首次实际使用，存量 158 份 approved/done 无台账行，「确认未对账」hard-block 拦死 push；装户已本地先行改动 policy.mjs（managed 漂移），需正名入源。
2. **记录型提交豁免**：检查 8 证据对账中，验收证据引用 docs 系提交（冒烟报告 / approved 留痕 / 关单台账）不触 plan 声明面即硬拦——装户 ② 类误伤约 10 对，同行实现提交均在场可过检；既有 process 豁免只覆盖执行器驱动一种形态。
3. **预算 fixture 自校准**：check-loop.test.mjs 预算两场景硬编码 8000B 超限样本，装户 AGENTS.md 预算上调至 8704B 后假失败——测试与仓库真实预算值耦合应消除。

## 目标

- POLICIES 表增 v3（= v1 键集，docs/incidents 两确认锚 → 2026-10-05）；装户经 kit.json policyVersion:3 选入，kit 仓自身维持 v2 默认。
- 检查 8 两遍裁决：文档级先判「存在可过检实现提交」（sha/process 型），记录型提交（subject=docs 系）证据在实现证据在场时降级豁免告警；仅引记录型 → 维持 hard。
- 预算场景超限样本自校准；新增豁免正反场景；npm test 全绿。

## 非目标

- 装户侧「证据无关」① 类（plan 方法级表述）与 npm publish / GitHub push（另案 / 用户另令）

## 约束

- 双源纪律：templates/_agents 与 .agents 逐字节一致（source-sync-check --gate 绿）
- 豁免不得独立成立：须以「同文档存在可过检实现证据」为前提

## 影响面

- 模块：infra（引擎件 3 份 + 测试 + 发版面）；数据库：无

## 触达红线

- [x] 跨调用方契约变更（检查 8 裁决口径全局收敛）→ 级别至少 L2（risk_level 双写 L2）
- [ ] 其余不触及

## 验收标准（可测试）

- [x] POLICIES[3] 键集 = v1 键集且两锚 = 2026-10-05（证据：loadKitPolicy 断言输出「v3 keys: moduleSince,check14Since,confirmDocsEffective,confirmIncidentsEffective,bindingTs | anchors: 2026-10-05 2026-10-05」，v2 键未激活）
- [x] 检查 8：docs 证据 + 实现证据在场 → 豁免；仅 docs 证据 → 仍 hard（证据：check-loop.test.mjs 新场景「检查 8 记录型豁免」正反两例 PASS，实现提交 71439e2）
- [x] 预算场景自校准生效（证据：npm test 全绿含原两预算场景——样本改读拷入预算表上限+512）
- [x] npm test 全套件 0 fail（证据：test-full.log 865 PASS / 0 套件失败，exit=0）
- [x] 双源一致：source-sync-check --gate exit 0（证据：--gate exit=0）
