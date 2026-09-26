---
状态: approved
级别: L2
日期: 2026-09-26
模块: pipeline
备注: 确认门机器化。L2 四节。bootstrap：本任务确认按对话进行；机制落地（feat 提交）次日 2026-09-27 起 TTY 确认生效——本任务三件套（文件名 2026-09-26）恰在生效日前，自身不受检查 15 管，闭环自洽。
---

# PLAN — 确认门机器化

## 任务拆解

1. **confirm-doc.mjs**：纯函数（computeFingerprint：CRLF 归一 + 剔指纹行 + sha256；nextStage：draft→approved / approved→done 唯二合法；applyTransition：只改状态行 + 指纹行其余字节原样；appendLedger：追加 jsonl 行）+ CLI 薄壳（TTY 门 / 逐份全文打印 / 「可以」键入 / --root 注入）。判据：confirm-doc.test.mjs 纯函数逐项断言 + 非 TTY spawn 拒绝断言全绿。
2. **check-loop 检查 15**：受管对象（intents/specs/plans 状态 approved/done + 生效日 2026-09-27 截断）+ 指纹/台账配对判定 + hard-block 消息；头部清单 +15；check-loop.test.mjs +4 场景 + mkfix 台账辅助。判据：套件全绿且真实仓库跑 0 新告警（存量全豁免）。
3. **gate-checklist 自举**：PAIRS + {doctor:'7', cl:'15'}。判据：--diff 登记完整（0 断档 / 0 未登记），套件 14 场景不回归。
4. **口径接线**：build/design/plan/test 四命令文档确认表述替换；AGENTS.md「门禁与提交」加一句；doctor §2 + confirm-doc.mjs。判据：rule-budget --staged 过门（AGENTS.md ≤ 7680B）；doctor 0 FAIL（布局 30 项）。
5. **双源同步 + 全量门禁**：sync（managed 自动；AGENTS.md owned 手动）；npm test / verify / source-sync-check / gate-checklist --diff / doctor。判据：见验证方式。

## 风险评估

- AGENTS.md 预算溢出 → 任务 4 先实测 rule-budget --staged，超限走缩句分支（一句话压到 ≤80B）或下沉至 build.md。
- TTY 正路径无自动化 → 纯函数 + 非 TTY 断言覆盖可自动部分；正路径留给机制生效后首个任务立项时人工实跑（机制首验，异常走 incident）。
- 检查 15 与既有检查交互 → `确认指纹` 为新键，检查 2 占位符正则不含该词、检查 8/12/14 不读该键——fixture 全量回归即证。

## 执行顺序

1（confirm-doc 纯函数）→ 2（检查 15 独立实现，不 import confirm-doc——门禁自包含）→ 3（登记自举，依赖 2 的清单号）→ 4（口径接线，依赖 1 的命令形态定稿）→ 5（双源收口 + 全量门禁）。

## 遗留项

- superseded/cancelled 与 incidents 状态是否纳入（v2 视使用摩擦再拍板）。
- 确认后内容漂移的 diff 审计辅助（台账指纹 vs git 历史对比报告）。
- TTY 正路径自动化（伪终端 node-pty 类方案，引依赖，暂缓）。

## 验证方式

- `node templates/_agents/scripts/confirm-doc.test.mjs` 全绿（纯函数 + 非 TTY 拒绝）。
- `node templates/_agents/scripts/check-loop.test.mjs`：41 场景全绿（37 既有 + 4 新）。
- 真实仓库 `node .agents/scripts/check-loop.mjs` exit 0 且相对基线 0 新增告警（存量豁免验证）。
- `node .agents/scripts/gate-checklist.mjs --diff` 登记完整；`sh .agents/scripts/rule-budget.sh --staged` 过；doctor 0 FAIL（布局 30 项）。
- `npm test` 全绿 + `source-sync-check --diff` 0 差异 + `verify.mjs` 2/2。

## 确认与复核

- 确认结果：approved（2026-09-26 用户对话内确认「可以」——bootstrap，机制未落地前按对话确认）
- 确认时间：2026-09-26
- 复核：L2 不要求新会话独立复核；关单勾验见同名 intent
