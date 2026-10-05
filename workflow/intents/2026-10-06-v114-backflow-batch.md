---
状态: approved
级别: L2
日期: 2026-10-06
模块: infra
备注: 装户（Shipyard.Material）回流批次，用户 2026-10-05/06 对话拍板打包三件；kit 仓自身不切 v3（无存量欠账，POLICIES[3] 供装户 kit.json 选入）
确认指纹: 5fdf0581cf611b18
---
# INTENT — v1.1.4 回流批次（policy v3 + 记录型提交豁免 + 预算 fixture 自校准）

## 背景与问题

装户 Shipyard.Material 侧三件引擎面改动/需求，回流 kit 源仓发版（1.1.3 → 1.1.4）：

1. **policy v3**：装户确认台账机制 09-27 上线但 10-05 才首次实际使用，存量 158 份 approved/done 无台账行，`--rev` 下「确认未对账」hard-block 拦死 push；装户已在本地先行改动 policy.mjs（managed 漂移），需正名入源。
2. **记录型提交豁免**：检查 8 证据对账中，验收证据引用 docs 系提交（冒烟报告 / approved 留痕 / 关单台账等记录型 commit）不触 plan 声明面即硬拦「证据无关」——装户 ② 类误伤约 10 对，且同行实现提交均在场可过检。既有 process 豁免（pipeline-run 标记）只覆盖执行器驱动一种形态。
3. **预算 fixture 自校准**：check-loop.test.mjs 预算两场景硬编码 8000B 超限样本，装户 AGENTS.md 预算上调至 8704B 后 199/2 假失败——测试对仓库真实预算值的耦合应消除。

## 目标

- POLICIES 表增 v3（= v1 键集，docs/incidents 两确认锚 → 2026-10-05），装户经 kit.json `policyVersion: 3` 选入；kit 仓自身维持 v1 默认。
- 检查 8 证据对账改两遍裁决：文档级先判「存在可过检实现提交」（sha/process 型），记录型提交（subject=docs 系 Conventional Commit）证据在实现证据在场时降级豁免告警（`warnEvidenceExempt('record')`）；仅引记录型无实现证据 → 维持 hard-block。
- check-loop.test.mjs 预算场景超限样本从拷入预算表自校准（读 AGENTS.md 上限 +512）。
- 新增豁免正反两场景钉住判据；`npm test` 全绿。

## 非目标

- 装户侧「证据无关」① 类（plan 改动面方法级表述提不出文件名 ×7 对）——装户补 plan 文件名，另案
- v2 独有键（check14Since 后移 / check17UnclosedAfter / stageGateSince / riskLevelSince）激活策略
- npm publish / GitHub push（本地发版提交，推送用户另令）

## 约束

- 双源纪律：templates/_agents 与 .agents 两份逐字节一致（source-sync-check --gate 必须绿）
- 豁免不得独立成立：记录型豁免必须以「同文档存在可过检实现证据」为前提，防「只引 docs 提交洗白代码改动」
- check-loop.test.mjs 新场景沿用既有 fixture 助手（gitCommitAll / shortSha / outOf），不引新依赖

## 影响面

- 模块：infra（引擎件 3 份 + 测试 + 发版面）
- 数据库：无

## 触达红线（对照 AGENTS.md）

- [x] 跨调用方契约变更（检查 8 裁决口径全局收敛）→ 级别至少 L2
- [ ] 其余不触及

## 验收标准（可测试）

- [ ] POLICIES[3] 键集 = v1 键集且两锚 = 2026-10-05；loadKitPolicy 在 kit.json policyVersion:3 时取值正确（证据：单测断言或 node 一行脚本输出）
- [ ] 检查 8：docs 系提交证据 + 同文档存在可过检实现提交 → exit 0 且 stderr 含「证据豁免 record」；仅 docs 提交证据 → 仍「证据无关」hard（证据：新增两场景 PASS）
- [ ] 预算场景：上调预算表后超限样本仍触发（自校准）（证据：npm test 全绿含原两场景）
- [ ] `npm test` 全套件 0 fail（证据：run 输出合计行）
- [ ] 双源一致：source-sync-check --gate exit 0（证据：命令输出）
