---
状态: done
级别: L2
risk_level: L2
模块: infra
确认指纹: 8762c4a790a437a4
---

# SPEC — 闭环引擎审查修复回流批次

对应入口：../intents/2026-10-06-backflow-loop-audit-remediation.md

## 方案

回流以装仓已验证版本为基准（装户档 2026-10-06-loop-audit-remediation 关单提交 8d897f1 + 57cb937）：装仓 `.agents/` 与源仓 `templates/_agents/` 当前对应 9 份差异恰为回流内容（预检 diff 确认无第三方漂移），直接整份复制、双侧成对（templates/_agents ↔ .agents、templates/_githooks ↔ .githooks），避免手抄分叉。

1. **policy.mjs**：POLICIES 增 v4 = v3 五键 + `delegationSince: '2026-10-06'`（注释含装户背景与缺键语义）。kit 仓自身 policyVersion 维持现状（v4 仅供装户选入），沿 v3 同款惯例。
2. **check-loop.mjs**：头部检查清单条目 18 补豁免说明；检查 18 在文档日期校验后插 `date < delegationSince → continue`（缺键维持原全量对账）。
3. **check-loop.test.mjs**：检查 18 场景群补 2 场景（v4 豁免 / v4 受管照报——exit 1 属检查 15 同场非本检查升级）；缺键回退由既有场景群覆盖（fixture 无 kit.json → v1）。
4. **commands ×6**：frontmatter 闭合后统一「装户边界」标注块（src/、bin/flow-kit.mjs、templates/_agents/、modules/hosts/ 为包源视角，装户仓对应命令不适用）。
5. **pre-push**：头部 CI 注释两段式（源仓 ci.yml 复跑四道门 / 装户仓无 CI、本地钩子即全部机器门）——钩子逻辑零变化。
6. **发版**：package.json 1.1.4 → 1.1.5 + CHANGELOG 一条（回流批次口径沿 v114 先例）。

## 约束遵守

- 双源纪律：复制后 source-sync-check --gate 须绿（sha256 LF 归一口径，行尾不影响）。
- 检查编号不动（gate-checklist 登记表按号消费）。
- sync 对本地已改 managed 件「跳过并报告」——本批回流后装仓下次 sync 不再有该 9 份的漂移报告面。

## 已知边界

- 装户 workflow/ 模板不属 managed（init 一次性复制），模板演进不达装户的机制缺口本批不动（intent 已记录）。
