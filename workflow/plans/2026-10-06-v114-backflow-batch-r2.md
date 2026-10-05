---
状态: done
级别: L2
risk_level: L2
模块: infra
确认指纹: 414ee315faf1d68f
---
# PLAN — v1.1.4 回流批次（policy v3 + 记录型提交豁免 + 预算 fixture 自校准）

> 本组取代 2026-10-06-v114-backflow-batch（done 后补 risk_level 触发「确认内容漂移」，按 confirm-doc 口径走 superseded + 新档引用；内容与实现证据不变，实现提交 71439e2 / 发版 f760c42 沿用）。

对应入口：../intents/2026-10-06-v114-backflow-batch-r2.md
对应 spec：../specs/2026-10-06-v114-backflow-batch-r2.md

## 步骤

1. policy.mjs 双源加 POLICIES[3] → 验证：loadKitPolicy 断言
2. check-loop.mjs 双源：recordCommit 标志 + 检查 8 两遍裁决 → 验证：新场景
3. check-loop.test.mjs 双源：预算自校准 + 豁免正反场景 → 验证：npm test 全绿
4. 双源 --gate exit 0
5. 关单 + 发版（package.json/CHANGELOG/.agents/kit.json → 1.1.4）

## 实现记录

实现已随前组三件套落账（实现提交 71439e2、发版 f760c42），本组为双字段对齐的文档面取代，实现与验证证据沿用：npm test 865 PASS / 0 fail（test-full.log）、双源 --gate exit 0、loadKitPolicy v3 断言输出、新场景「检查 8 记录型豁免」正反两例 PASS。