---
状态: draft
级别: L1
日期: 2026-09-25
模块: pipeline
备注: 收口 source-sync-check --diff 跑出的 5 个真实差异：3 处 {{BOARD_PORT}} 占位符未渲染 + 1 处 rule-budgets 装副本单边改 + 1 处 commit-check.config.json 孤儿白名单
---
# INTENT — 装户面双源漂移修复（fix-double-source-drift）

<!-- 与 plans/ 下同名文件配对 -->
<!-- frontmatter 受限子集（2026-09-13）：每行 `键: 值`；状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写 `备注:` 键）；级别∈L0/L1/L2/L3；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行 -->

## 背景与问题

- 2026-09-25 完成 C 环节 `source-sync-check.mjs` 工具落盘（commit 52a5e6f），首次实测发现 5 个真实差异（漂移 4 + 孤儿 1）：
  - 漂移 3：`commands/maintain.md` / `notes/runtime-env.md` / `scripts/ensure-board.mjs` —— 装副本保留 `{{BOARD_PORT}}` 占位符，包源已渲染为 `8933`（v0.4.0 跨平台升级时遗留；本质是 init 渲染后装副本未跟）
  - 漂移 1：`rule-budgets.txt` —— 装副本 65536（新值），包源 49152（旧值）；本轮 C 环节关单时装修副本未同步包源（同 wf-runtime 同类根因的真实样本）
  - 孤儿 1：`hooks/commit-check.config.json` —— 装副本独有空壳配置（init 渲染产物，本就不属双源结构）
- 现状：5 个差异在仓库内自相矛盾，CI / 装户复制都会触发"包源 vs 装副本不一致"的台账基线漂移

## 目标

- 装副本 3 处 `{{BOARD_PORT}}` 占位符替换为 `8933`（与包源对齐；按 B-b 决策"包源是权威源"）
- 包源 `rule-budgets.txt` 上限同步到 65536（与已装修副本对齐）
- `source-sync-check.mjs` 加白名单：装副本独有的 `hooks/commit-check.config.json` 不报孤儿（与既有 `kit.json` / `settings.json` 同等待遇）
- 重跑 `source-sync-check --diff`：0 差异（pass）

## 非目标

- 不修 init 渲染逻辑（占位符替换属于 init 命令职责，不在本工具范围内）
- 不改 source-sync-check 既有语义（白名单是参数扩展，不动 4 类诊断主流程）
- 不引入自动化同步（B-b 决策只报告不修复；本环节是手动闭环修复存量差异）
- 不动既有 18 套件测试

## 约束

- 双源纪律：包源改了装副本手动同步（按 2026-09-25-wf-runtime 复盘）
- L1 立项：仅修漂移，不引入新契约字段
- 零依赖：与既有 scripts 风格一致
- 预算门：.agents/commands/ 当前 52567B < 65536B 上限，不动预算

## 影响面

- 模块：pipeline
- 数据库：无
- 新增/修改文件：
  - `.agents/commands/maintain.md`（修：`{{BOARD_PORT}}` → `8933`）
  - `.agents/notes/runtime-env.md`（修：`{{BOARD_PORT}}` → `8933`）
  - `.agents/scripts/ensure-board.mjs`（修：注释 `{{BOARD_PORT}}` → `8933`）
  - `templates/_agents/rule-budgets.txt`（修：`49152` → `65536`）
  - `.agents/scripts/source-sync-check.mjs`（M：加白名单常量 `RENDER_OUTPUT_FILES`）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3

> 本 intent 不触及上述任一红线——修漂移 + 加白名单（白名单是 source-sync-check 内部配置项，不改外部接口与既有语义）。故 L1 立项，不立 spec。

## 验收标准（可测试）

- [ ] `.agents/commands/maintain.md` 注释中 `{{BOARD_PORT}}` 替换为 `8933`（证据：grep "BOARD_PORT" .agents/commands/maintain.md 0 命中）
- [ ] `.agents/notes/runtime-env.md` 注释中 `{{BOARD_PORT}}` 替换为 `8933`（证据：grep "BOARD_PORT" .agents/notes/runtime-env.md 0 命中）
- [ ] `.agents/scripts/ensure-board.mjs` 注释中 `{{BOARD_PORT}}` 替换为 `8933`（证据：grep "BOARD_PORT" .agents/scripts/ensure-board.mjs 0 命中）
- [ ] `templates/_agents/rule-budgets.txt` 上限从 `49152` → `65536`（证据：Get-Content 输出 `.agents/commands/ 65536`）
- [ ] `source-sync-check.mjs` 加白名单常量 `RENDER_OUTPUT_FILES` 含 `hooks/commit-check.config.json`（证据：grep "RENDER_OUTPUT_FILES" .agents/scripts/source-sync-check.mjs 命中 + test.mjs 新场景）
- [ ] 重跑 `node .agents/scripts/source-sync-check.mjs --diff` 报告 **0 差异**（证据：实测 exit 0 + 输出空报告）
- [ ] 既 18 套件仍 305/305 PASS（证据：npm test tail 输出）
- [ ] `flow-kit doctor` 仍 10 PASS / 0 WARN / 0 FAIL（证据：实测输出）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 实测输出>）`。

## 确认与复核

- 确认日期：2026-09-25
- 确认人：用户（对话内一句"可以"即确认）
- 确认范围：intent 整体 + 5 段改动面 + B-b 决策延续
- 关单 commit：(pending —— 5 段改动面 + 8 条验收全勾验)
- 复核：L1 不要求独立复核