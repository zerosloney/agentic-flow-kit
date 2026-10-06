---
状态: done
级别: L2
risk_level: L2
模块: infra
确认指纹: 7051700a7f9e27b3
---

# PLAN — 闭环引擎审查修复回流批次

对应入口：../intents/2026-10-06-backflow-loop-audit-remediation.md
对应 spec：../specs/2026-10-06-backflow-loop-audit-remediation.md

## 改动面

| # | 源仓目标（双侧成对） | 来源（装仓 E:\Git\Shipyard.Material） |
|---|------|------|
| 1 | `templates/_agents/scripts/policy.mjs` + `.agents/scripts/policy.mjs` | `.agents/scripts/policy.mjs`（含 v4） |
| 2 | `templates/_agents/scripts/check-loop.mjs` + `.agents/scripts/check-loop.mjs` | `.agents/scripts/check-loop.mjs` |
| 3 | `templates/_agents/scripts/check-loop.test.mjs` + `.agents/scripts/check-loop.test.mjs` | `.agents/scripts/check-loop.test.mjs` |
| 4 | `templates/_agents/commands/{build,test,review,gate-checklist,sync-hosts,source-sync-check}.md` + `.agents/commands/` 同 6 份 | `.agents/commands/` 同 6 份（含装户边界标注） |
| 5 | `templates/_githooks/pre-push` + `.githooks/pre-push` | `.githooks/pre-push`（两段式注释） |
| 6 | `package.json`（1.1.5）+ `CHANGELOG.md` | 本仓新增 |

## 执行顺序

1. 立档三件套 → confirm-doc 代录 approved → docs 提交留痕
2. 复制 9+1 份（上表 1-5，cp 保字节）→ rule-budget 体积核对
3. 验证：`node src/run-tests.mjs` 全绿 + `source-sync-check --gate` 绿 + `sync-hosts --diff` 无漂移 + 装仓↔源仓 9 份零 diff 复核
4. version bump + CHANGELOG → feat 提交（代码与关单留痕分离，沿三段式）
5. 勾验验收 → confirm-doc done ×3 → docs 关单提交

## 验证方式（关单判据）

- run-tests.mjs 全量输出（基线今日全绿，回流后须仍全绿）
- source-sync-check --gate / sync-hosts --diff 输出
- 装仓侧 `diff <(tr -d '\r' <装仓文件) <(tr -d '\r' <源仓templates对应)` 逐份零差异

## 风险

- 源仓 `.agents/commands/` 预算（65536B / 单篇 8192B）比装户紧：6 份各 +~180B，若 --staged 硬拦则同批上调 rule-budgets（实测+余量）并计入本提交。
- 装仓 .zcode/workflows/*.dwf.ts 入库为装户自持面，不属本批回流范围。
