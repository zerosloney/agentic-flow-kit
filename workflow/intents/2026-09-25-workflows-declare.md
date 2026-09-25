---
状态: done
级别: L1
日期: 2026-09-25
模块: pipeline
备注: G 环节：把 5 环节推广节奏固化为可复用 workflow 声明——pipeline-closing（6 阶段闭环）+ source-sync-repair（漂移修复专项），让 orchestrate 命令有实际工作流模板可拉起；双源纪律
---
# INTENT — 工作流声明扩展（workflows-declare）

<!-- 与 plans/ 下同名文件配对 -->
<!-- frontmatter 受限子集（2026-09-13）：每行 `键: 值`；状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写 `备注:` 键）；级别∈L0/L1/L2/L3；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行 -->

## 背景与问题

- 5 个推广环节（E/A/D/C/F/B）已全部闭环，每个环节都跑了"6 阶段闭环"（intent → plan → build → test → 关单留痕）——但流程知识散落在每次对话里，没有沉淀为可复用工作流
- 当前 `.agents/workflows/` 只有 1 个示例（`示例-并行实现评审.md`）和 1 个 step（`示例-部署验证.md`），orchestrate 命令落地后没有真实工作流模板可拉起
- 6 阶段闭环里"修双源漂移"和"标准 pipeline 关单"是高频动作，每次都靠 AI 重写一遍工作流 stage 表，浪费精力

## 目标

- 新增 2 个可复用 workflow 声明（双源：包源 `templates/_agents/workflows/` + 装副本 `.agents/workflows/`）：
  - **`pipeline-closing.md`** — 推广环节 6 阶段闭环（intent → 用户确认 → plan → build → test → 关单留痕），把 E/A/D/C/F/B 已闭环的 5 个环节推广节奏固化为标准模板
  - **`source-sync-repair.md`** — 装户面双源漂移修复专项（source-sync-check --diff → 修漂移 → 双写 → 重跑确认），基于 F 环节真实过程沉淀
- 2 个声明遵循 `.agents/workflows/_TEMPLATE.md` 的 3 种 stage 形态（role 派单 / step 指令 / gate 终端）
- 新声明命名遵守既有命名约定（中文主题名 + .md）

## 非目标

- 不改 `.agents/workflows/_TEMPLATE.md` 既有结构
- 不改 `examples/示例-并行实现评审.md` / `steps/示例-部署验证.md`（既有示例已落地）
- 不改 orchestrate 命令行为（声明文件本身不改命令逻辑）
- 不引入新角色 / step 类型（沿用 `implementer` / `independent-reviewer` / `verifier` + `plan-confirm` / `intent-closeout` 等既有）
- 不动 `roles/` / `commands/` / `scripts/` 等其他目录

## 约束

- 双源纪律：包源 `templates/_agents/workflows/` + 装副本 `.agents/workflows/` 双写（按 2026-09-25-wf-runtime 复盘，workflows 属 managed）
- L1 立项：新增 2 个声明文件，不改既有协议 / 字段 / 形态
- 零依赖：纯 markdown 声明，不引 JS / shell
- 3 关静态门：source-sync-check --diff（必须 0 差异）/ npm test（必须全绿）/ flow-kit doctor（必须 0 FAIL）

## 影响面

- 模块：pipeline
- 数据库：无
- 新增/修改文件：
  - `templates/_agents/workflows/pipeline-closing.md`（新增）
  - `.agents/workflows/pipeline-closing.md`（装副本双写）
  - `templates/_agents/workflows/source-sync-repair.md`（新增）
  - `.agents/workflows/source-sync-repair.md`（装副本双写）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3

> 本 intent 不触及上述任一红线——新增 2 个声明文件，沿用既有 _TEMPLATE.md 的 stage 表 3 形态（role / step / gate），不改命令 / 角色 / step 协议。故 L1 立项，不立 spec。

## 验收标准（可测试）

- [x] 2 个 workflow 声明落盘：`templates/_agents/workflows/pipeline-closing.md` + `source-sync-repair.md`（双源：装副本同步存在；证据：`ls .agents/workflows/` 4 个 .md 文件；commit 3cc10d6）
- [x] 每个声明 frontmatter 含 `name` / `description` / `concurrency`（证据：grep 命中 4 文件）
- [x] 每个声明含 7-10 行 stage 表，覆盖 role 派单 + gate 终端 2 形态（证据：grep "role\|step\|gate" 各列命中；pipeline-closing 10 行 + source-sync-repair 7 行；不引新 step——`_TEMPLATE.md` 纪律 `step ∈ steps/`，新增 step 留给后续项目注册）
- [x] `pipeline-closing.md` 体现 6 阶段闭环（author → confirm → build → 3 关 gate → closeout；证据：grep "author\|confirm\|build\|gate\|closeout" stage 表行）
- [x] `source-sync-repair.md` 含 source-sync-check --diff gate + 漂移修复 role 派单（证据：grep "scan-diff\|repair\|gate-rescan\|source-sync"）
- [x] 双源纪律：包源 2 份 + 装副本 2 份 sha 一致（证据：git hash-object 显示 pipeline-closing 双方 87cf2471... + source-sync-repair 双方 2a921528...）
- [x] 重跑 `node .agents/scripts/source-sync-check.mjs --diff` 报告 **0 差异**（证据：实测「包源 53 份 / 装副本 53 份 / 无差异 ✅」）
- [x] `npm test` 既 18 套件仍 309/309 PASS（不回归；证据：npm test tail「✅ 全部套件通过」）
- [x] `flow-kit doctor` 仍 10 PASS / 0 WARN / 0 FAIL（证据：sync 后实测 doctor 输出 10/0/0）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 实测输出>）`。

## 确认与复核

- 确认日期：2026-09-25
- 确认人：用户（对话内一句"可以"即确认）
- 确认范围：intent 整体 + 2 个 workflow 声明 + 双源纪律
- 关单 commit：`3cc10d6`（feat(pipeline): 工作流声明扩展——2 个可复用编排脚本（pipeline-closing + source-sync-repair）；6 文件 +126 行）
  - 9 条验收全勾验（见上「验收标准」段）
  - 18 套件 309/309 PASS；doctor 10/0/0；source-sync-check 0 差异；双源 4 文件 sha 一致
- 复核：L1 不要求独立复核
- 复核：L1 不要求独立复核