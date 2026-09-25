---
状态: draft
级别: L1
模块: pipeline
---
# PLAN — 装户面双源漂移修复

<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 极简形态（2026-09-13 瘦身，L1 默认）：单/少文件微改动只填「改动面」+「验证方式」两节——改动面逐条列改哪个文件做什么（判据细节直接写进条目），验证一行静态门 + 按需 UI 实测；任务拆解/执行顺序仅 L1 多文件多步骤时保留 -->

对应入口：../intents/2026-09-25-fix-double-source-drift.md
对应 spec：（L1 略）

## 改动面（L1 极简形态主节）

> 5 段改动面（4 处漂移修复 + 1 处工具白名单）；按 C 环节 source-sync-check 实测报告定向闭环。

**1. 装副本 3 处占位符替换（与包源对齐）**

- `.agents/commands/maintain.md`：注释中 `{{BOARD_PORT}}` → `8933`。判据：grep "BOARD_PORT" .agents/commands/maintain.md 0 命中。
- `.agents/notes/runtime-env.md`：注释中 `{{BOARD_PORT}}` → `8933`。判据：grep "BOARD_PORT" .agents/notes/runtime-env.md 0 命中。
- `.agents/scripts/ensure-board.mjs`：注释中 `{{BOARD_PORT}}` → `8933`。判据：grep "BOARD_PORT" .agents/scripts/ensure-board.mjs 0 命中。
- 注：包源已渲染为 `8933`（v0.4.0 跨平台升级后基线值）；装副本保留占位符是 init 渲染后的存量问题，本次按 B-b 决策向包源对齐。

**2. 包源 rule-budgets.txt 上限同步**

- `templates/_agents/rule-budgets.txt`：第 8 行 `.agents/commands/ 49152` → `65536`（与已装修副本 65d3441 commit 一致）。判据：Get-Content 输出 `.agents/commands/ 65536`。
- 注：装副本手动同步按 2026-09-25-wf-runtime 复盘条目（rule-budgets.txt 属 owned）。

**3. source-sync-check 工具白名单**

- `.agents/scripts/source-sync-check.mjs`：新增模块顶常量 `RENDER_OUTPUT_FILES = new Set(['hooks/commit-check.config.json'])`（与既有 `kit.json` / `settings.json` 同类——init 渲染产物，不属双源结构）；在「孤儿」诊断分支把该集合内文件从报告里过滤掉（同时从「缺失」逆向兜底：包源有这些文件也不算孤儿反向）。判据：grep "RENDER_OUTPUT_FILES" .agents/scripts/source-sync-check.mjs 命中 + 跑 --diff 0 命中 commit-check.config.json。
- 包源 `templates/_agents/scripts/source-sync-check.mjs` 同步：双源纪律。

**4. source-sync-check 测试套件新场景**

- `.agents/scripts/source-sync-check.test.mjs`：新增 S12「commit-check.config.json 装副本独有不报孤儿」+ S13「RENDER_OUTPUT_FILES 中文件装副本有 / 包源无 → 0 findings」。判据：npm test 新场景 PASS + 总数 +2。
- 包源同步（同 §3 双源纪律）。

**5. AGENTS.md / docs 不动**

- 本环节不动 AGENTS.md / README.md / 既有命令文档；白名单是 source-sync-check 内部配置项，不改外部协议。

## 验证方式

- 静态门：
  - `node .agents/scripts/source-sync-check.mjs --diff`：exit 0，0 命中。
  - `npm test`：19 套件（含 S12/S13 新场景），全绿（target 307/307 PASS = 305+2）。
  - `node bin/flow-kit.mjs doctor`：10 PASS / 0 WARN / 0 FAIL。
  - `sh .agents/scripts/check-loop.sh`：clean，exit 0。
- 预算门：装副本 52567B < 65536B 上限（无新增 helper 命令文件，不动预算）。
- L1 不要求独立复核（intent §确认与复核）。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：(pending —— 用户对话内一句"可以"通过后回填)
- 关单 commit：(pending —— 5 段改动面 + 8 条验收全勾验)
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L1 不要求独立复核