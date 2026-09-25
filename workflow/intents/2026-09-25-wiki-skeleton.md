---
状态: done
级别: L1
日期: 2026-09-25
模块: pipeline
备注: 沉淀 5 个已闭环推广环节（E/A/D/C/F）的复盘 / 决策点 / papercuts 进 wiki/，5 个主题目录 + INDEX.md 更新；不改 wiki 看板生成器；不动 draft-archive
---
# INTENT — Wiki 主题骨架填充（wiki-skeleton）

<!-- 与 plans/ 下同名文件配对 -->
<!-- frontmatter 受限子集（2026-09-13）：每行 `键: 值`；状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写 `备注:` 键）；级别∈L0/L1/L2/L3；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行 -->

## 背景与问题

- 5 个推广环节已闭环（commit 链：7313436 / 95c2a13 / 80317aa；22e8316 / 406a3f6；42618b3 / f4d7d25；ea866f4 / 52a5e6f / 65d3441；e3454bf / b5988d7 / 564c6bb），但**隐性知识（决策点 / papercuts / 复盘）散落在 workflow/intents / plans / incidents 多处**，跨会话查找靠 `kb-search.mjs`，但 wiki/ 主题层空壳
- 当前 wiki/ 现状：仅 drafts-archive/ + INDEX.md + 知识沉淀总览.html（生成），**0 份知识文档、0 个主题**（见 INDEX.md 「合计：**0 份**知识文档，**0 个主题**」）
- 工作流 / 工具脚本两类知识分散在 README.md / AGENTS.md / `.agents/commands/*.md`，没有按主题归位到 wiki/

## 目标

- 5 个主题目录（每个环节一个）建立：
  - `wiki/跨宿主适配/` — E 环节 sync-hosts（薄适配正文 sha 比对 + B-b 决策）
  - `wiki/文档闭环/` — A 环节 fill-{intent,spec,plan}（frontmatter 受限子集保护）
  - `wiki/口径一致性/` — D 环节 gate-checklist（doctor § ↔ check-loop § 对照）
  - `wiki/装户面同步/` — C 环节 source-sync-check（包源 vs 装副本 4 类诊断 + 白名单）
  - `wiki/双源漂移修复/` — F 环节 fix-double-source-drift（{{BOARD_PORT}} + 白名单 + rule-budgets 同步）
- 每个主题目录放 `README.md`：主题说明 / 决策点 / 复盘 / 关键 papercuts / 指向 workflow/ 原文链接
- `wiki/INDEX.md`「主题目录速览」表更新：5 行主题 + 「用途」列填实
- 看板 `wiki/知识沉淀总览.html`：不手改，跑 `node .agents/scripts/gen-wiki-board.mjs` 重生成（按 wiki 协议"计数 / 合计 / 看板 DATA 均为生成区"）

## 非目标

- 不动 `wiki/drafts-archive/`（按 wiki 协议只读不增量）
- 不改 wiki 看板生成器（`gen-wiki-board.mjs` / `verify-wiki-consistency.mjs`）
- 不复制定向对象原文（intents / plans / incidents 是唯一真相源，wiki/README 只做摘要 + 链接）
- 不动 AGENTS.md / README.md（这些是另一层总览）
- 不引入新协议字段（frontmatter 受限子集 5 字段不变）

## 约束

- L1 立项：5 个 README.md + INDEX.md 微更新，不引入新工具 / 契约
- 零依赖：与既有 wiki/ 风格一致
- 主题命名中文（按 INDEX.md 命名规则「主题目录用中文名」）
- 看板 / 映射表 / 计数为生成区，勿手改——commit 后跑 gen-wiki-board.mjs 重生成

## 影响面

- 模块：pipeline
- 数据库：无
- 新增/修改文件：
  - `wiki/跨宿主适配/README.md`（新增）
  - `wiki/文档闭环/README.md`（新增）
  - `wiki/口径一致性/README.md`（新增）
  - `wiki/装户面同步/README.md`（新增）
  - `wiki/双源漂移修复/README.md`（新增）
  - `wiki/INDEX.md`（M：速览表 + 5 行主题「用途」列填实）
  - `wiki/知识沉淀总览.html`（生成区，build 跑 gen-wiki-board 后重生成）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3

> 本 intent 不触及上述任一红线——建 5 份 README + INDEX 微更新，不改工作流契约 / 工具行为 / frontmatter 协议。故 L1 立项，不立 spec。

## 验收标准（可测试）

- [x] 5 个主题目录 + README.md 落盘：`wiki/跨宿主适配/`、`wiki/文档闭环/`、`wiki/口径一致性/`、`wiki/装户面同步/`、`wiki/双源漂移修复/`（证据：`ls wiki/` 5 个目录 + 各含 README.md；commit 12301af）
- [x] 每个 README.md 含 4 节：主题说明 / 关键决策点 / 复盘 / 指向 workflow/ 原文链接（证据：grep 4 节标题各 5 文件命中；commit 12301af）
- [x] `wiki/INDEX.md` 速览表更新：5 行主题 + 「用途」列填实 + 合计行 ≥ 5 份（证据：grep "用途" INDEX.md + 合计行「**5 份**知识文档，**5 个主题**」；commit 12301af）
- [x] 跑 `node .agents/scripts/gen-wiki-board.mjs` 重生成 `wiki/知识沉淀总览.html`（证据：commit 12301af 含看板更新；脚本输出「文件 5 份 / 主题 5 个」）
- [x] `node .agents/scripts/verify-wiki-consistency.mjs` 三方一致性通过（证据：实测输出「✅ wiki 三方一致：文件 5 份 / 主题 5 个（含占位）/ 归档 1 份」）
- [x] `npm test` 既 18 套件仍全绿（309/309 PASS 不回归；证据：npm test tail「✅ 全部套件通过」）
- [x] `flow-kit doctor` 仍 10 PASS / 0 WARN / 0 FAIL（证据：sync 后实测 doctor 输出 10/0/0）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 实测输出>）`。

## 确认与复核

- 确认日期：2026-09-25
- 确认人：用户（对话内一句"可以"即确认）
- 确认范围：intent 整体 + 5 段改动面 + 中文主题命名
- 关单 commit：`12301af`（feat(wiki): 主题骨架填充——5 个推广环节沉淀进 wiki/；11 文件 +239 行）
  - 7 条验收全勾验（见上「验收标准」段）
  - 18 套件 309/309 PASS（不回归）；doctor 10/0/0；source-sync-check 0 差异；verify-wiki-consistency 三方一致
- 复核：L1 不要求独立复核
- 复核：L1 不要求独立复核