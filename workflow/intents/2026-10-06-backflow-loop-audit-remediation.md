---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-06
模块: infra
备注: 装户（Shipyard.Material）2026-10-06-loop-audit-remediation 回流批次，用户 2026-10-06 对话拍板「风险1 要处理」；kit 仓自身不切 v4（POLICIES[4] 供装户 kit.json 选入）
确认指纹: 91423c7baf8b0839
---

# INTENT — 闭环引擎审查修复回流批次（policy v4 / 检查 18 豁免 / 装户边界标注 / pre-push 两段式）

## 背景与问题

装户 Shipyard.Material 2026-10-06 对闭环引擎做全量审查（check-loop 实跑 + 29 套件 + 门禁链通读），其中四项修复（装户档 2026-10-06-loop-audit-remediation，L2 已关单）涉及 9 份 managed 件本地改动，按回流纪律入源：

1. **policy v4**：装户检查 18（委派台账对账）产出 113 条不可消退 advisory——delegations.md 记法自始为「任务一句话」（全表 0 行含 workflow 文件名），匹配口径要求行含文件名且无生效日豁免，8 月底起存量永远无法满足，违反「无判定依据的行不产出不可消除噪声」红线。装户已本地先行 POLICIES[4]（= v3 键集 + delegationSince: 2026-10-06）并经 kit.json 选入。
2. **检查 18 豁免**：日期 < delegationSince 存量豁免；缺键（v1-v3）维持原全量对账（向后兼容不放松）；测试补 v4 豁免/受管两场景（缺键回退由既有场景群天然覆盖）。
3. **commands 装户边界标注**：6 份命令文档（build/test/review/gate-checklist/sync-hosts/source-sync-check）引用 `src/`、`bin/flow-kit.mjs`、`templates/_agents/`、`modules/hosts/` 包源专属路径，装户照抄执行即撞墙且无边界说明——顶部统一加「装户边界」标注块。
4. **pre-push 两段式 CI 注释**：原「本仓 ci.yml 复跑四道门」在 kit 源仓为真、下发装户后成虚指（装户无 CI、source-sync-check --gate 在无包源环境恒 exit 1）——改为「源仓有 ci.yml / 装户仓无 CI、本地钩子即全部机器门」两段式，两种语境皆准。

附带发现（记录不处理）：装户 `workflow/` 模板为 init 时一次性复制、不属 managed，源仓模板后续演进（incidents 时间线「用户确认」样例行）不达装户——曾致装户 fill-spec.test S18/S20 引入即失败（v1.1.3 装入当日，测试假设与装户模板断链，未被任何门禁捕获）。装户侧已手工对齐模板；下发机制改进另案。

## 目标

- POLICIES 增 v4；check-loop 检查 18 加 delegationSince 生效日豁免（缺键回退原行为）+ 测试 +2 场景。
- 6 份 commands 顶部装户边界标注；pre-push 头部 CI 注释两段式。
- 双源纪律：templates/_agents 与 .agents、templates/_githooks 与 .githooks 逐字节一致（source-sync-check --gate 绿）。
- 版本 1.1.4 → 1.1.5 + CHANGELOG（沿 v114 回流批次发版惯例；源仓活跃层为 0，检查 17 发版锚安全）。

## 非目标

- workflow/ 模板纳入 sync 下发面的机制改进（另案）。
- 装户侧其余审查遗留（占位符假阳性 P2-4、检查 17 装户适用性 P2-5 等，见装户审查报告，不随本批）。

## 约束

- 豁免通道不得吞掉生效日后的真漏点（v4 受管日期照报，测试钉住）。
- `.agents/commands/` 体积预算（源仓 65536B / 单篇 8192B）不超限；超限则同批调 rule-budgets（实测 + 余量口径）。

## 影响面

- 模块：infra（引擎件 9 份 + 测试 + 发版面）；数据库：无

## 触达红线

- [x] 跨调用方契约变更（检查 18 对账口径 + POLICIES 版本表面）→ 级别至少 L2（risk_level 双写 L2）
- [ ] 其余不触及

## 验收标准（可测试）

- [x] `node src/run-tests.mjs` 全部套件通过（含 check-loop.test.mjs v4 新场景）（证据：回流提交 53d3105 前后各跑一轮，FAIL 行数 0；中途 trae-hooks 4 FAIL 系手动复制致 managed 台账漂移 10 份被 pre-commit 模拟拦——`flow-kit sync` 刷台账后恢复全绿，53d3105 已含台账）
- [x] `node .agents/scripts/source-sync-check.mjs --gate` 绿（templates ↔ .agents / _githooks ↔ .githooks 双侧成对）（证据：feat 提交前实跑 exit 0，缺失 0 / 漂移 0；rule-budgets.txt 双侧 cp 成对后过门）
- [x] `node bin/flow-kit.mjs sync-hosts --diff` 无漂移（或 --apply 后无漂移）（证据：--apply 后「正文对齐 81 对 / 权威源缺失 0 / 正文漂移 0」，30 对漂移 = 6 commands × 5 宿主薄适配，随 53d3105 提交）
- [x] 装仓 E:\Git\Shipyard.Material 的 9 份对应文件与源仓 templates/_agents/、templates/_githooks/ 零 diff（LF 归一口径）（证据：2026-10-06 逐份 diff 实跑，9 份 scripts/commands + pre-push 全部一致）
- [x] package.json version 1.1.5 + CHANGELOG 记本批（证据：53d3105——version 1.1.4→1.1.5、CHANGELOG 1.1.5 节 4 条目 + 已知边界 1 条）

> **闭环对账**：关单在 test 阶段。intent 置 done 前逐条勾验，每条勾选项后补证据。
