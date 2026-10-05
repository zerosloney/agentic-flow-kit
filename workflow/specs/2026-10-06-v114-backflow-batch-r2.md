---
状态: done
级别: L2
risk_level: L2
模块: infra
确认指纹: 5144cdc865871b01
---
# SPEC — v1.1.4 回流批次（policy v3 + 记录型提交豁免 + 预算 fixture 自校准）

> 本组取代 2026-10-06-v114-backflow-batch（done 后补 risk_level 触发「确认内容漂移」，按 confirm-doc 口径走 superseded + 新档引用；内容与实现证据不变，实现提交 71439e2 / 发版 f760c42 沿用）。

对应入口：../intents/2026-10-06-v114-backflow-batch-r2.md

## 方案

### 1. policy v3（templates/_agents/scripts/policy.mjs，双源镜像 .agents）

POLICIES 追加 `3`：键集 = v1 五键，confirmDocsEffective / confirmIncidentsEffective = 2026-10-05，其余不动；不引入 v2 独有键（最小 diff，装户现役基线为 v1）。装户经 kit.json policyVersion:3 选入；kit 仓自身维持 v2。

### 2. 检查 8 记录型提交豁免（check-loop.mjs，双源）

- verifyEvidenceTruth irrelevant 分支：subject 判 `recordCommit = /^docs[(:]/`；process 分支判据不动；irrelevant 返回值带 recordCommit 标志。
- 调用方改两遍裁决：扫描期收集逐条证据（ex 存量豁免照旧跳过）；节末聚合 hasImplEvidence（sha/process 型任一 ok）→ irrelevant + recordCommit + hasImplEvidence → warnEvidenceExempt('record') 降级，否则照旧 hard。
- 信任边界：豁免前提 = 同文档存在过检实现证据，只引 docs 提交洗白代码改动不成立；豁免 stderr 出账（fail-loud）。

### 3. 预算 fixture 自校准（check-loop.test.mjs，双源）

预算两场景与 --staged 场景：拷入 budgets.txt 后解析 AGENTS.md 行上限，超限样本写上限 +512（替换硬编码 8000）。新增两场景：docs 证据 + 实现证据 → exit 0 且「证据豁免 record」；仅 docs 证据 → 「证据无关」hard（gitCommitAll 指定 subject 造提交、shortSha 取证）。

### 4. 发版面

CHANGELOG 追加 1.1.4；package.json / .agents/kit.json → 1.1.4。

## 系统改动清单

- 引擎件：templates/_agents/scripts/{policy,check-loop,check-loop.test}.mjs（双源镜像 .agents/scripts/）
- 发版：package.json / CHANGELOG.md / .agents/kit.json

## 边界与风险

- recordCommit 只认 subject 前缀 docs( / docs:——feat 提交引作证据仍走原判据
- 装户「证据无关」① 类（plan 方法级表述）不受影响，装户另行补 plan 文件名

## 约束遵守映射

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 跨调用方契约变更 → L2 | 裁决口径单源收敛在 verifyEvidenceTruth + 聚合段两处；正反场景钉住；npm test 全绿兜底 |
