---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-01
模块: pipeline
备注: 门禁缺位追踪（v09-review-defects 复盘三件套第①项「是否需要新 intent=是」的兑现）——引擎脚本测试覆盖机器门 + trust-mode 补测 + 库件豁免机制
确认指纹: 18771bb3bebfba5d
---
# INTENT — gate-script-test-coverage（引擎脚本测试覆盖门）

## 背景与问题

`incidents/2026-10-01-v09-review-defects` 复盘三件套第①项结构性修复结论：「是否需要新 intent：是——本次根因含『门禁缺位/无测试/无独立复核』系统性缺口（L1 快车道当年无三件套、solidify 无测试即发布），需另立 intent 补门禁缺位」。双轴审查同时点名 `trust-mode.mjs`（授权语义、fail-closed 缺省）无测试。

现状盘点（2026-10-01 实测）：`templates/_agents/scripts/` 下 7 个非 `*.test.mjs` 引擎脚本无兄弟测试：
`check-metric-claims.mjs`、`ensure-board.mjs`、`policy.mjs`、`stage-gates.mjs`、`trust-mode.mjs`、`verify-wiki-consistency.mjs`、`wiki-search.mjs`。其中 `policy.mjs` / `stage-gates.mjs` 等是库件——被 check-loop / confirm-doc / fill-* 等套件 import 覆盖；`trust-mode.mjs` 是纯 CLI 脚本、无任何覆盖。**规则缺口**：没有任何机器检查强制「新引擎脚本默认带测试」，全靠会话自觉，solidify 事件即漏网实例。

## 历史教训/防复发

- 检索结果：`incidents/2026-10-01-v09-review-defects`（无测试脚本漏过审查、发布后才发现）；`incidents/2026-09-28-batch-ledger-audit`（测试覆盖盲区的教训——旧判据从未构造关键场景）
- 避坑指南：
  - 测试覆盖必须是**机器检查**而非规范口号——本次即「规范存在但无机器强制」漏网
  - 豁免要显式可审计（登记理由），不能靠「这个脚本很简单」的隐性豁免

## 目标

- 新增「引擎脚本测试覆盖」检查（check-loop 新检查项，warning 级起步）：`templates/_agents/scripts/` 下每个非 `*.test.mjs` 的引擎脚本须有**同名兄弟 `.test.mjs`**，或在豁免登记文件 `.agents/scripts-test-exempt.txt` 中有理由行；缺失 → warning 列出
- 首个达标样本：`trust-mode.mjs` 补 `trust-mode.test.mjs`（覆盖 Strict/Standard/Trusted 三级语义 + 缺文件 fail-closed + --auto 拒绝路径）
- 库件豁免机制落地：`policy.mjs` / `stage-gates.mjs` 等被其他套件 import 覆盖的脚本登记豁免并注明覆盖套件名
- 规范条目：README 硬规则或 AGENTS.md 增补「新增引擎脚本默认必须带 `.test.mjs`，缺失由机器门列出；库件须登记豁免」

## 非目标

- 不为 7 个存量脚本全部补测试（本轮只补 trust-mode + 登记豁免；其余按各自团队/后续批次补）
- 不把覆盖检查设为 hard-block（warning 起步，给存量收敛期；后续可升级——不在本批）
- 不引入新测试框架/依赖（沿用 node:test 直跑惯例）

## 约束

- 双源纪律：检查实现改 `templates/_agents/scripts/` + sync；豁免文件走 managed/模板下发（templates 侧含默认豁免清单）
- 只增不松：新检查只读目录结构，不触碰既有判据
- 装户兼容：豁免文件缺失 = 全量脚本进入检查（装户若有自定义脚本会看到 warning——可接受，告警不阻断）

## 影响面

- 模块：pipeline
- 数据库：无
- （无前端页面）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）$\rightarrow$ 级别至少 L2
  - 触及面：check-loop 新检查项（机器门契约）+ 引擎脚本开发规范（新增脚本必须带测试）

> 触及任一红线即为 L2 / L3，必须立 ../specs/YYYY-MM-DD-<主题>.md 写明如何满足，方可起草 plan。

## 验收标准（可测试）

- [ ] 新增检查项运行后：7 个无兄弟测试脚本中，`trust-mode.mjs` 已补测试、6 个库件/工具已登记豁免，warning 清单与豁免登记一致（证据：check-loop 输出 + 豁免文件内容）
- [ ] `trust-mode.test.mjs` 用例覆盖：三级语义（Strict/Standard/Trusted 名称与数值）、缺文件 fail-closed 回落 Strict、`--auto` 在 Strict 下被 confirm-doc 拒绝路径；npm test 全绿（证据：用例名 + 测试输出）
- [ ] 豁免文件含 `policy.mjs`、`stage-gates.mjs` 等库件，理由注明实际覆盖套件名（证据：文件内容 + 对应套件存在性 grep）
- [ ] README/AGENTS.md 含「新增引擎脚本默认必须带测试，缺失由机器门列出」规范条目（证据：文件行）
- [ ] 全量回归：npm test + verify.mjs 全绿；check-loop 无新增 hard-block（证据：命令输出）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 hard-block。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：gate-script-test-coverage（测试覆盖机器门 + trust-mode 补测 + 豁免机制）
- 复核：L2 口径——落地后 independent-reviewer 复核检查判据、豁免真实性、测试覆盖有效性