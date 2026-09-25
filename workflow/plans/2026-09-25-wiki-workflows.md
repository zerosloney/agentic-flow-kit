---
状态: done
级别: L1
模块: pipeline
---
# PLAN — wiki 工作流主题沉淀

<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 极简形态（2026-09-13 瘦身，L1 默认）：单/少文件微改动只填「改动面」+「验证方式」两节——改动面逐条列改哪个文件做什么（判据细节直接写进条目），验证一行静态门 + 按需 UI 实测；任务拆解/执行顺序仅 L1 多文件多步骤时保留 -->

对应入口：../intents/2026-09-25-wiki-workflows.md
对应 spec：（L1 略）

## 改动面（L1 极简形态主节）

> 1 段改动面（1 主题目录 + 1 README + INDEX 微更新 + 看板重生成）——pipeline-closing 第 3 层 build stage。

**1. `wiki/工作流/README.md`（新增）**

- 主题说明：编排机制（workflow declarations）——`.agents/workflows/` 下的编排脚本承载编排语义（依赖分层 / 并行 / 重试 / gate），宿主 AI 经 AGENTS.md 常驻指令自动加载并按语义执行
- 关键决策点：
  - 3 种 stage 形态（互斥）：role 派单行 / step 行 / gate 行
  - `step ∈ steps/` 纪律：step 形态必须先注册到 `.agents/workflows/steps/<name>.md`
  - role 派单：`task` 目标 / `files` 授权清单 / `accept` 验收判据写进派单头 + 红线行
  - 子智能体不跨确认门、不 commit / push
  - 失败且 `retries` > 0 → 重派（全新上下文）；gate 非零 → 中止后续
- 编排语义（执行口径）：
  - `after` 空 = 第 0 层；一层全 ok 才推依赖它的下一层
  - 层内按 `concurrency` 分批（默认 2）——有子智能体的宿主并行 fan-out，没有的顺序自做
  - 解析校验先行：role ∈ `.agents/roles/`、`after` 引用存在且无环——任一不过即拒
- 已落地声明：
  - `示例-并行实现评审.md`（后端 + 前端并行 → gate → 部署验证 → 独立评审）
  - `pipeline-closing.md`（G 环节 6 阶段闭环：author → confirm → build → 3 关 gate → closeout）
  - `source-sync-repair.md`（G 环节漂移修复专项：scan-diff → classify → repair → gate-rescan → closeout）
- steps 扩展：
  - `示例-部署验证.md`（env / timeout-min params；npm deploy + curl smoke）
- 复盘：G 环节（2026-09-25-workflows-declare）落地 2 个声明（pipeline-closing + source-sync-repair）；首次把 5 环节推广节奏固化为可复用编排
- 原文链接：
  - `.agents/workflows/_TEMPLATE.md`（编排机制 + stages 表 + 3 形态定义 + 纪律）
  - commit `3cc10d6`（feat(pipeline): 工作流声明扩展）
  - workflow/intents/2026-09-25-workflows-declare.md + plans/ 同名

**2. `wiki/INDEX.md` 速览表更新**

- 「主题目录速览」表新增 1 行：「工作流」/「用途：编排机制——3 种 stage 形态（role 派单 / step 指令 / gate 终端）+ 已落地声明清单 + 纪律摘要」
- 「合计」行改为 **6 份知识文档 / 6 个主题**
- 命名规则段保留（不修改）

**3. 看板重生成**

- `wiki/知识沉淀总览.html`：跑 `node .agents/scripts/gen-wiki-board.mjs` 重生成（按 wiki 协议"计数 / 合计 / 看板 DATA 均为生成区"）
- 不手改 .html

## 验证方式

- 静态门：
  - `node .agents/scripts/source-sync-check.mjs --diff`：exit 0，0 命中（README + INDEX 微更新不涉双源结构）
  - `npm test`：18 套件全绿（target 309/309 PASS 不回归）
  - `node .agents/scripts/verify-wiki-consistency.mjs`：三方一致 PASS（6 文件 / 6 主题 / 1 归档）
  - `node bin/flow-kit.mjs doctor`：10 PASS / 0 WARN / 0 FAIL
- 看板门：
  - 跑 `node .agents/scripts/gen-wiki-board.mjs`：看板重生成无错
  - `wiki/知识沉淀总览.html` 渲染含 6 主题（grep "工作流" 命中）
- 命名门：
  - 主题目录用中文（按 INDEX.md 命名规则）
- L1 不要求独立复核（intent §确认与复核）。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-09-25 用户对话内"把 G 环节的 pipeline-closing 实际跑一次"通过；用户对 1 主题 + 中文命名 + pipeline-closing 自举测试认可）
- 关单 commit：`f8ce87d`（feat(wiki): 工作流主题沉淀——G 环节 workflow 声明归档；5 文件 +74 行）
- 8 条验收全勾验；18 套件 309/309 PASS；doctor 10/0/0；source-sync-check 0 差异
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L1 不要求独立复核