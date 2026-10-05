---
状态: approved
级别: L2
模块: infra
确认指纹: fe03bd1acf628386
---
# PLAN — v1.1.4 回流批次（policy v3 + 记录型提交豁免 + 预算 fixture 自校准）

对应入口：../intents/2026-10-06-v114-backflow-batch.md
对应 spec：../specs/2026-10-06-v114-backflow-batch.md

## 步骤

1. policy.mjs 双源加 POLICIES[3]（= v1 键集、两锚 2026-10-05）→ 验证：node 断言 loadKitPolicy(policyVersion:3) 取值 + v2 键不激活
2. check-loop.mjs 双源：verifyEvidenceTruth irrelevant 分支带 recordCommit 标志 + 检查 8 两遍裁决聚合 → 验证：新增场景
3. check-loop.test.mjs 双源：预算两场景自校准 + 新增记录型豁免正反两场景 → 验证：npm test 全绿
4. 双源一致：source-sync-check --gate exit 0
5. 关单三件套 + 发版提交（package.json/CHANGELOG/.agents/kit.json → 1.1.4）

## 实现记录

<实施后回填>
