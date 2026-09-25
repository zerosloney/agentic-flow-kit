---
状态: approved
级别: L2
日期: 2026-09-26
模块: pipeline
备注: 审查报告改进方向第 4、5 条合并落地（同一机制契约扩展）。L2 四节。
---

# PLAN — 编排执行面补强：run journal + human 确认门

## 任务拆解

1. **机制文档**：`_TEMPLATE.md` 改四形态（表 + human 语义 + 示例 human 行）、编排语义补 human/journal、纪律补 journal 三条与机器门指引。判据：文档自洽（四形态判据互斥可机检）、AGENTS.md 零改动。
2. **linter 四形态**：`workflows-check.mjs` COLS+human（表头缺列兼容）、E9 四选一、W4（human×retries）、export `parseStages`；测试补 S14 human 场景组（单形态全绿 / human+gate E9 / human+retries W4 / 10 列表头解析）。判据：新场景全过 + 既有 14 场景零回归 + 真实仓库自扫 0/0。
3. **wf-journal**：新脚本（add/status + `replayRun`/`planStages` 纯函数 + attempt 自动计次 + run 复用/--new-run + 坏行容忍 + `--journal`/`--wf-root` 注入）；`wf-journal.test.mjs` ≥8 场景。判据：全过且覆盖 schema 各字段与边界。
4. **pipeline-closing 示范**：表头 10 列、confirm 行 human 形态、prose 特判删除、编排语义/纪律行同步。判据：linter 0/0、与 _TEMPLATE 口径一致。
5. **双源同步 + 门禁**：sync + 未入台账件手动 cp；npm test（21 套件）/ verify / source-sync-check / doctor / gate-checklist --diff 全绿。判据：见验证方式。

## 风险评估

- 既有 9 列脚本兼容性（source-sync-repair / 示例零改动）→ linter 缺列兼容 + 既有场景回归覆盖。
- journal 坏数据 / 空文件 → status 坏行容忍 + 空 journal 全量输出，测试覆盖。
- 宿主不记 journal → 能力失效但不破门禁（可丢弃缓存），spec 风险节已载。

## 执行顺序

1 → 2（文档定口径后 linter 跟进）→ 3（wf-journal 复用 2 导出的 parseStages）→ 4（用 2 校验）→ 5（门禁 + 双源）。1-3 无文件冲突可交叉；4 依赖 2 的列解析；5 收口。

## 遗留项

- journal 清理策略（按 run 保留 N 条）——不阻塞，后续 papercut/intent。
- 看板可视化 journal（实时编排进度）——超出本次范围。

## 确认与复核

- 确认结果：approved（2026-09-26 用户对话内确认「4（编排执行 run journal…）、5（用户确认门显式化…）」）
- 确认时间：2026-09-26
- 复核：L2 不要求新会话独立复核；关单勾验见同名 intent
