---
状态: approved
级别: L1
日期: 2026-09-24
模块: pipeline
---
# PLAN — 审查修复：量化台账静默吞数据 + 生成器静默跳过 + sync 基线化单周期陷阱

对应入口：../incidents/2026-09-24-review-fixes.md

## 改动面
- `templates/_agents/scripts/agg-delegations.cjs`：台账解析改按表头签名识别（委派表含「被委派方」列、自做表=日期+任务一句话），不依赖 `## ` 节标题；存在日期数据行但识别不到表 → exit 1 报结构漂移。
- 新增 `templates/_agents/scripts/agg-delegations.test.mjs`：三场景 fixture 回归（无节标题入账 / 漂移 exit 1 / 空台账提示）。
- `src/doctor.mjs`：新增 delegations 台账结构检查项（agg 解析失败 → WARN，init/sync/doctor 自动重验）。
- `workflow/delegations.md`：恢复模板节结构（委派结果/自做任务结果/月度聚合快照/并发扩容门槛），既有数据行迁入委派结果表；补记 2026-09-24 审查委派行。
- `templates/_agents/scripts/gen-wiki-board.mjs`：映射表锚点与「合计」行锚点缺失 → exit 1 未写盘（对齐速览表/DATA 的 fail-loud 口径）；drafts-archive 缺失 → 警告 + 归档按 0，不崩栈。
- `templates/_agents/scripts/gen-wiki-board.test.mjs`：补场景 4/5（映射表锚点缺失 exit 1 / drafts-archive 缺失不崩）。
- `templates/_agents/scripts/verify-wiki-consistency.mjs`：drafts-archive 缺失 → 记 problems（exit 1 明示协议目录被删），不崩栈。
- `templates/_agents/scripts/gen-workflow-metrics.mjs`：预算条目的目录/glob 目录/单文件缺失 → 警告跳过该条，不崩栈。
- `src/sync.mjs` + `src/cli.mjs` + `README.md`：跳过件台账保持包侧基线（不再跟随磁盘）——本地已改持续报告直至 --force 或对齐新版，消除「跳过一次后下次 sync 被静默覆盖」；HELP/README 语义同步。
- `src/sync.test.mjs`：S1 断言改为包侧基线；新增 S11（二次 sync 不覆盖本地改动且持续报告）。
- `workflow/regression-checklist.md`：防复发验证节追加条目。

## 验证方式
- 静态门：`npm test` 全套件全绿（新增 agg 三场景 + gen-wiki-board 场景 4/5 + sync S11）。
- 实跑对账：`node .agents/scripts/agg-delegations.cjs` 输出 2026-09 有效任务 2（修复前「台账为空」）；`node bin/flow-kit.mjs sync` 落地装副本；`node bin/flow-kit.mjs doctor` 全 PASS。

## 确认与复核
- 确认结果：approved（2026-09-24 用户对话内确认「按这个优先级逐项修复」）
- 确认门记录：审查报告（P1/P2/P3 三档 + 建议处理顺序）过目后用户拍板按序修复
