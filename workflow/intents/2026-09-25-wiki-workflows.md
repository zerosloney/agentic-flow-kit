---
状态: draft
级别: L1
日期: 2026-09-25
模块: pipeline
备注: 把 G 环节新增的 2 个 workflow 声明（pipeline-closing + source-sync-repair）沉淀进 wiki/工作流/ 主题目录——闭环 G 自身的知识资产；L1 微改动
---
# INTENT — wiki 工作流主题沉淀（wiki-workflows）

<!-- 与 plans/ 下同名文件配对 -->
<!-- frontmatter 受限子集（2026-09-13）：每行 `键: 值`；状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写 `备注:` 键）；级别∈L0/L1/L2/L3；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行 -->

## 背景与问题

- G 环节（2026-09-25-workflows-declare）新增 2 个 workflow 声明（`pipeline-closing` + `source-sync-repair`）落盘 + 双源同步 + 3 关静态门通过——但 wiki 主题目录未覆盖 workflows
- B 环节（2026-09-25-wiki-skeleton）建了 5 个工具主题目录（跨宿主适配 / 文档闭环 / 口径一致性 / 装户面同步 / 双源漂移修复），全是「工具脚本」类知识——workflows 是「编排机制」类知识，未归位
- 当前 `.agents/workflows/` 内容对用户/AI 仍是隐性的（只能读目录发现），无中文摘要 + 决策点 + 复盘的快速入门

## 目标

- 新增 1 个主题目录：`wiki/工作流/`（与既有 5 主题同级，中文命名按 INDEX.md 命名规则）
- 新增 `wiki/工作流/README.md`：汇总 2 个 workflow 声明（`pipeline-closing` + `source-sync-repair`）的关键决策点 / 编排语义 / 复盘 / 指向 `.agents/workflows/` 原文链接
- 更新 `wiki/INDEX.md` 速览表第 6 行主题「工作流」「用途」列填实
- 跑 `gen-wiki-board.mjs` 重生成看板（生成区）

## 非目标

- 不改 `.agents/workflows/` 既有内容（`pipeline-closing.md` / `source-sync-repair.md` / `_TEMPLATE.md` / `示例-并行实现评审.md` / `steps/示例-部署验证.md`）
- 不动 `wiki/drafts-archive/`
- 不改 wiki 看板生成器（`gen-wiki-board.mjs` / `verify-wiki-consistency.mjs`）
- 不引入新主题目录（仅补 1 个）

## 约束

- L1 立项：1 主题目录 + 1 README.md + INDEX.md 微更新，不引入新工具 / 契约
- 零依赖：纯 markdown，与既有 wiki/ 风格一致
- 主题命名中文（按 INDEX.md 命名规则「主题目录用中文名」）

## 影响面

- 模块：pipeline
- 数据库：无
- 新增/修改文件：
  - `wiki/工作流/README.md`（新增）
  - `wiki/INDEX.md`（M：速览表 + 1 行主题「用途」列填实；合计 6 份 / 6 主题）
  - `wiki/知识沉淀总览.html`（生成区，重生成）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3

> 本 intent 不触及上述任一红线——1 主题目录 + 1 README + INDEX 微更新，不改工作流契约 / 工具行为 / frontmatter 协议。故 L1 立项，不立 spec。

## 验收标准（可测试）

- [ ] 1 个主题目录 + README.md 落盘：`wiki/工作流/README.md`（证据：`ls wiki/工作流/` 1 个 README.md）
- [ ] README 含 4 节：主题说明 / 关键决策点 / 编排语义 / 指向 `.agents/workflows/` 原文链接（证据：grep 4 节标题命中）
- [ ] `wiki/INDEX.md` 速览表更新：1 行主题「工作流」+「用途」列填实 + 合计 6 份 / 6 主题（证据：grep "工作流" INDEX.md + 合计行 grep）
- [ ] 跑 `node .agents/scripts/gen-wiki-board.mjs` 重生成 `wiki/知识沉淀总览.html`（证据：commit 含看板更新）
- [ ] `node .agents/scripts/verify-wiki-consistency.mjs` 三方一致性通过（证据：实测输出 PASS）
- [ ] `node .agents/scripts/source-sync-check.mjs --diff` 报告 **0 差异**（证据：实测输出「无差异 ✅」）
- [ ] `npm test` 既 18 套件仍 309/309 PASS（不回归；证据：npm test tail「✅ 全部套件通过」）
- [ ] `flow-kit doctor` 仍 10 PASS / 0 WARN / 0 FAIL（证据：实测输出）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 实测输出>）`。

## 确认与复核

- 确认日期：2026-09-25
- 确认人：用户（对话内一句"可以"即确认）
- 确认范围：intent 整体 + 1 主题目录 + 中文命名
- 关单 commit：(pending —— 1 主题 + 8 条验收全勾验)
- 复核：L1 不要求独立复核