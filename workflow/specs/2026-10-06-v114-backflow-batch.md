---
状态: done
级别: L2
模块: infra
确认指纹: 7862708c25ee7574
---
# SPEC — v1.1.4 回流批次（policy v3 + 记录型提交豁免 + 预算 fixture 自校准）

对应入口：../intents/2026-10-06-v114-backflow-batch.md

## 方案

### 1. policy v3（templates/_agents/scripts/policy.mjs，双源镜像 .agents）

POLICIES 追加 `3`：键集 = v1 五键，`confirmDocsEffective: '2026-10-05'`、`confirmIncidentsEffective: '2026-10-05'`，其余不动；表头注释写明锚语义（装户台账首次实际使用日，2026-10-06-v114-backflow-batch）。**不引入 v2 独有键**——v1 是装户现役基线，最小 diff。装户经其 kit.json `policyVersion: 3` 选入；kit 仓自身 kit.json 不切（无存量欠账）。

### 2. 检查 8 记录型提交豁免（templates/_agents/scripts/check-loop.mjs，双源）

- `verifyEvidenceTruth` irrelevant 分支：`spawnGit log -1 --format=%s` 取 subject 上移，新增判据 `recordCommit = /^docs[(:]/`（docs 系 Conventional Commit——冒烟报告 / 留痕 / 关单台账均此形态）；process 分支判据不动；irrelevant 返回值带 `recordCommit` 标志。
- 调用方（检查 8）改两遍裁决：扫描期只收集逐条证据（`evidenceItems`，存量豁免声明 ex 照旧跳过）；节末聚合——`hasImplEvidence = 任一证据 ok 且 type ∈ {sha, process}`；逐条裁决时 irrelevant + recordCommit + hasImplEvidence → `warnEvidenceExempt('record', planBase)` 降级豁免，否则照旧 hard-block。
- **信任边界**：豁免前提 = 同文档存在过检实现证据，只引 docs 提交洗白代码改动的通道不成立；豁免走 stderr 出账（fail-loud 口径，与 text/external/process 同款）。

### 3. 预算 fixture 自校准（templates/_agents/scripts/check-loop.test.mjs，双源）

场景 28/29 与 rule-budget --staged 两场景：拷入 budgets.txt 后解析 `AGENTS.md` 行上限，超限样本写 `上限 + 512`（替换硬编码 8000）。新增两场景：① done intent 两条证据——一条实现提交（触及 plan 声明文件）+ 一条 docs 系提交（不触及）→ exit 0 且输出含「证据豁免 record」；② 仅 docs 系提交证据 → 「证据无关」hard-block（exit 1）。fixture 用 gitCommitAll 指定 subject 造提交、shortSha 取证。

### 4. 发版面

CHANGELOG 追加 1.1.4 条目；package.json 1.1.3 → 1.1.4；.agents/kit.json version 同步。

## 系统改动清单

- 引擎件：`templates/_agents/scripts/{policy,check-loop,check-loop.test}.mjs`（双源镜像 `.agents/scripts/` 同名文件，逐字节一致）
- 测试：check-loop.test.mjs 预算两场景改造 + 新增记录型豁免正反场景
- 发版：package.json / CHANGELOG.md / .agents/kit.json

## 边界与风险

- 装户升级 1.1.4 后 `sync --force` 收敛其本地先行改动（装户操作，非本单）；recordCommit 正则只认 subject 前缀 `docs(` / `docs:`——`feat` 提交引作证据仍走原判据
- 「证据无关」① 类（plan 方法级表述）不受本单影响，装户另行补 plan 文件名
- 双源漂移风险：两份文件逐字节一致由 source-sync-check --gate 兜底

## 约束遵守映射

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 跨调用方契约变更 → L2 | 检查 8 裁决口径单源收敛在 verifyEvidenceTruth + 聚合段两处；新增正反场景钉住；`npm test` 全绿兜底 |
