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

1. policy.mjs 双源加 v3 ✓（node 断言：v3 五键、两锚 2026-10-05、kit 仓自身 kit.json 维持 policyVersion:2 不受影响）
2. check-loop.mjs 双源：verifyEvidenceTruth irrelevant 带 recordCommit 标志（subject 前缀 ^docs[(:]）+ 检查 8 两遍裁决（evidenceItems 收集 → hasImplEvidence = sha/process 型在场 → record 豁免降级）✓（node --check 通过、双源逐字节一致）
3. check-loop.test.mjs 双源：预算两场景自校准（读拷入预算表 AGENTS.md 上限 +512，含 --staged 场景的作用域修正——首版漏加 agLimit 计算被套件当场抓出）+ 新增记录型豁免正反场景 ✓
4. 双源门 --gate exit 0 ✓（孤儿 trust-mode.json 系装户渲染产物，报告不拦）
5. 关单 + 发版：package.json/CHANGELOG/.agents/kit.json → 1.1.4（本笔后另发）

偏离与教训：① 引擎件编辑后必须 self-sync（bin/flow-kit.mjs sync --dir .）再测——trae-hooks 套件的 git commit 用例探测本仓门禁健康度，managed 漂移会 fail-closed 致 4 例假红；② fixture w() 不建父目录，src/impl.txt 需先 mkdir（ENOENT 被套件当场抓出）；③ 装户侧同款 fixture 修复曾因环境无 sh 走 SKIP 分支掩盖 --staged 作用域问题，kit 环境补齐了该覆盖
