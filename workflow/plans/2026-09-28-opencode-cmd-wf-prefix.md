---
状态: approved
级别: L2
模块: pipeline
确认指纹: 24f00e1a384323f4
---
# PLAN — opencode-cmd-wf-prefix

对应入口：../intents/2026-09-28-opencode-cmd-wf-prefix.md
对应 spec：../specs/2026-09-28-opencode-cmd-wf-prefix.md

## 改动面

- `src/profiles.mjs`：`HOSTS` 给 opencode / trae 加 `commandPrefix: 'wf-'`——映射单源（新增命令层宿主只改这一处；原设计两份实现各硬编码前缀分叉）。
- `src/sync-hosts.mjs`：`pairsFor` 的 commands 分支改遍历带 `commandPrefix` 的宿主；`adapterOrphans` 的前缀反推条件由 `h === 'trae'` 改为「有 commandPrefix 且文件名以之开头」；头部注释同步。
- `src/doctor.mjs`（装户侧第二份实现）：新增 `HOST_CMD_DIR`；`checkAdapterDrift` 的 commands 映射改走该列表。
- `modules/hosts/opencode/commands/`：11 份 `.md` → `wf-*.md`（`git mv`，纯重命名，frontmatter 与正文均不动）。
- `src/sync-hosts.test.mjs`：opencode fixtures 与断言路径加 `wf-`；新增带前缀孤儿 fixture `wf-legacy.md` + 2 条反推断言。
- `templates/_agents/scripts/doctor.test.mjs`：3 处 `.opencode/commands/build.md` fixture 改 `wf-build.md`；装副本经 `flow-kit sync` 刷新。
- `templates/_agents/commands/sync-hosts.md` + 根 `AGENTS.md`：更新「opencode/zcode/omp 各自原描述」口径句为「opencode / trae 同用 `wf-` 前缀，单源见 `profiles.mjs#HOSTS.commandPrefix`」。

## 任务拆解

1. 改映射逻辑（包源侧 + 装户侧两份实现）
   - 判据：`node bin/flow-kit.mjs sync-hosts --diff` 输出的映射行为 `commands/plan.md → opencode/commands/wf-plan.md`；`doctor.mjs` 内无残留 `<name>.md` 无前缀映射。
   - 风险：低（纯路径常量；两份实现必须同批改，漏一处会漂移误报）
2. 重命名 11 份薄适配
   - 判据：`ls modules/hosts/opencode/commands/` 全为 `wf-*.md` 且数量 11；`git status` 显示 11 删 11 增且无内容差异。
   - 风险：低（纯重命名）
3. 更新两侧测试
   - 判据：`node src/sync-hosts.test.mjs`、`node .agents/scripts/doctor.test.mjs` 全绿。
   - 风险：低
4. 全量验证 + 装副本刷新
   - 判据：`npm test` 全绿；`node bin/flow-kit.mjs sync-hosts --diff` 无漂移；`node .agents/scripts/check-loop.mjs` 无新增 hard-block。
   - 风险：低

## 执行顺序

1 → 2 → 3 → 4（4 依赖 1–3 完成；2 必须在 1 之后，否则 diff 会把旧名薄适配报成孤儿 + 新名报 authorityMissing）

## 验证方式

- 静态门：`npm test`（本仓纯 JS 脚手架包，node 直跑，全量套件）
- 契约面比对：`node bin/flow-kit.mjs sync-hosts --diff` —— 权威源正文段 vs 薄适配正文段 sha 逐对比对，漂移数须为 0、对齐对数须等于权威源文件数 × 适配份数
- 装户口径复核：`node bin/flow-kit.mjs doctor`（包源环境 §7.x 按设计 skip，确认 skip 口径未被本次改动破坏）
- L2 追加：映射口径抽样对账——11 个命令名在 trae / opencode 两宿主下同名同形（`wf-<name>`），`git diff` 逐行确认无其他行为改动
- UI：不涉及（无前端页面）

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现——禁从 draft 直跳 done。
- 确认结果：approved（2026-09-29 用户对话内确认，原话「逐件确认」）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（两道门，逐次，不合并）
- 复核：L2 推荐独立复核，本次以 `npm test` 全量回归 + 契约面 sha 对账为证据
