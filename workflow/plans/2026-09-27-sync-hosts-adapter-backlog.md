---
状态: done
级别: L1
日期: 2026-09-27
模块: pipeline
配对: ../intents/2026-09-27-sync-hosts-adapter-backlog.md
备注: 随报随修回溯单：方向分析 → 修复 → 验证已按 intent 约束完成，本单为提交前闭环收口。2026-09-27 起 TTY 确认门生效（check 15）——approved / done 须经用户终端 confirm-doc.mjs 键入「可以」。
确认指纹: f6c1986505d02093
---

# PLAN — sync-hosts 适配层欠账清零（12 对 apply + 6 份新建）

对应入口：../intents/2026-09-27-sync-hosts-adapter-backlog.md

## 改动面（L1 极简形态主节）

- 方向分析（先行，不留产物）：薄适配当前正文（行尾归一化）vs 权威源 git 全历史版本正文 sha 逐一比对——12/12 历史命中 = 全部「适配滞后」，apply 方向安全（判据：任一未命中即停单研判）
- `modules/hosts/{opencode,trae}/commands/` 既有 12 份（build / design / maintain / plan / review / test × 2 宿主）：`flow-kit sync-hosts --apply` 按权威源正文覆盖薄适配正文段（frontmatter 不动，行尾字节保真）
- `modules/hosts/opencode/commands/{gate-checklist,source-sync-check,sync-hosts}.md` 新建 3 份：宿主特化 frontmatter（仅 description，按既有 opencode 命令样板）+ 权威源正文段
- `modules/hosts/trae/commands/wf-{gate-checklist,source-sync-check,sync-hosts}.md` 新建 3 份：frontmatter（name: wf-X + description，按既有 trae 命令样板）+ 权威源正文段

## 验证方式

- 静态门：`sync-hosts --diff` 终态「正文对齐 34 对 / 无漂移 ✅」（权威源缺失 0 / 正文漂移 0）；npm test 全部套件通过；doctor 12 PASS / 0 WARN / 0 FAIL；check-loop exit 0
- 判据：新建 6 份正文 sha 与权威源一致（对齐计数 28 → 34）；既有 12 份归位后零漂移

## 确认与复核

- 确认结果：approved（2026-09-27 00:21 用户终端 TTY 确认——.agents/confirmations.jsonl 台账行 + 指纹配对）；done（2026-09-27 对话委托代录「好了」——confirm-doc --delegated 正式首用，台账 source=chat-delegated + 原话）
- 确认门记录：欠账由 2026-09-26 双轴审查发现并记 incident 备注「另行立项」→ 用户指令「收口」授权执行 → 方向分析安全后修复 → 用户终端 TTY 确认
- 复核：L1 不要求独立复核（方向分析即安全复核——12/12 历史命中排除手改覆盖风险）
