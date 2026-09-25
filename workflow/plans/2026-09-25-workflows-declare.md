---
状态: approved
级别: L1
模块: pipeline
---
# PLAN — 工作流声明扩展

<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 极简形态（2026-09-13 瘦身，L1 默认）：单/少文件微改动只填「改动面」+「验证方式」两节——改动面逐条列改哪个文件做什么（判据细节直接写进条目），验证一行静态门 + 按需 UI 实测；任务拆解/执行顺序仅 L1 多文件多步骤时保留 -->

对应入口：../intents/2026-09-25-workflows-declare.md
对应 spec：（L1 略）

## 改动面（L1 极简形态主节）

> 2 段改动面（2 个 workflow 声明新建 + 双源纪律）；按 .agents/workflows/_TEMPLATE.md 的 3 形态（role 派单 / step 指令 / gate 终端）落地。

**1. `.agents/workflows/pipeline-closing.md`（+ 装副本双写）**

- 主题：推广环节 6 阶段闭环（intent → 用户确认 → plan → build → test → 关单留痕）——把 E/A/D/C/F/B 已闭环的 5 个环节推广节奏固化为标准模板
- frontmatter：
  - `name: pipeline-closing`
  - `description: 推广环节 6 阶段闭环：fill-intent → 用户确认 → fill-plan → build → 3 关静态门（source-sync-check / npm test / doctor）→ 关单留痕`
  - `concurrency: 2`（step 与 gate 可并行）
- stages 表（5 行，覆盖 3 形态）：
  - 第 0 层：`fill-intent`（step；参数：topic / module / level）→ 起草 workflow/intents/<date>-<topic>.md
  - 第 0 层：`fill-plan`（step；参数：topic / module / level）→ 起草 workflow/plans/<date>-<topic>.md
  - 第 1 层（after: fill-intent,fill-plan）：`confirm`（step；参数：无）→ 用户对话内"可以"+ plan 状态 draft → approved
  - 第 2 层（after: confirm）：`build`（role: implementer；task: 按 plan §改动面 执行；files: 见 plan；accept: 计划改动面完成；retries: 1）
  - 第 3 层（after: build）：`gate-sync`（gate: source-sync-check --diff）→ 必须 0 差异
  - 第 3 层（after: build）：`gate-test`（gate: npm test）→ 必须全绿
  - 第 3 层（after: build）：`gate-doctor`（gate: flow-kit doctor）→ 必须 0 FAIL
  - 第 4 层（after: gate-sync, gate-test, gate-doctor）：`intent-closeout`（step；参数：commit-sha）→ 补 8 条验收勾验 + plan → done + 关单 docs commit 留痕
- 双源：包源 `templates/_agents/workflows/pipeline-closing.md` 同步（按 wf-runtime 复盘 workflows 属 managed）

**2. `.agents/workflows/source-sync-repair.md`（+ 装副本双写）**

- 主题：装户面双源漂移修复专项（source-sync-check --diff → 修漂移 → 双写 → 重跑确认）——基于 F 环节真实过程沉淀
- frontmatter：
  - `name: source-sync-repair`
  - `description: 装户面双源漂移修复：跑 source-sync-check 看差异 → 修漂移（包源 / 装副本按 B-b 方向）→ 双写 → 重跑确认 0 差异 → 走 pipeline-closing 标准关单`
  - `concurrency: 2`
- stages 表（4 行，覆盖 3 形态）：
  - 第 0 层：`scan-diff`（step；参数：--diff）→ 跑 `node .agents/scripts/source-sync-check.mjs --diff`，输出 4 类诊断（缺失 / 孤儿 / 漂移 / frontmatter-only-diff）
  - 第 1 层（after: scan-diff）：`repair`（role: implementer；task: 按漂移方向修齐——包源 → 装副本同步 / 白名单扩展；files: 见 source-sync-check 输出；accept: 漂移方向 B-b 决策延续；retries: 1）
  - 第 2 层（after: repair）：`gate-rescan`（gate: source-sync-check --diff）→ 必须 0 差异
  - 第 3 层（after: gate-rescan）：`pipeline-closing`（step；参数：intent-name）→ 走 pipeline-closing 标准关单（参考声明复用，不重新定义 6 阶段）
- 双源：包源 `templates/_agents/workflows/source-sync-repair.md` 同步

**3. workflows 索引（无需 INDEX.md 更新）**

- `.agents/workflows/` 目录按主题命名（中文 .md），无需额外索引文件；用户 / AI 直接读目录列表即可发现可用 workflow
- `wiki/工作流/` 主题目录（按 B 环节扩展可选）——本次 L1 不做，仅留后续 G+ 环节推广

## 验证方式

- 静态门：
  - `node .agents/scripts/source-sync-check.mjs --diff`：exit 0，0 命中（4 个文件双写一致）
  - `npm test`：18 套件全绿（target 309/309 PASS 不回归）
  - `node bin/flow-kit.mjs doctor`：10 PASS / 0 WARN / 0 FAIL（workflows 不在 doctor 检查范围；防回归）
- 双源门：
  - 4 个文件 `git hash-object` 校验：包源 vs 装副本 sha 两两一致
- 命名门：
  - 文件命名按既有约定（中文 .md；前缀按主题）
  - frontmatter 3 字段齐：`name` / `description` / `concurrency`
- L1 不要求独立复核（intent §确认与复核）。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-09-25 用户对话内"推进最后一个环节"通过；用户对 2 个 workflow 声明 + 6 阶段闭环 + 漂移修复专项认可）
- 关单 commit：(pending —— 2 个声明 + 9 条验收全勾验)
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L1 不要求独立复核