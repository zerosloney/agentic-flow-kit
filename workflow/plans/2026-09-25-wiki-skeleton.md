---
状态: approved
级别: L1
模块: pipeline
---
# PLAN — Wiki 主题骨架填充

<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 极简形态（2026-09-13 瘦身，L1 默认）：单/少文件微改动只填「改动面」+「验证方式」两节——改动面逐条列改哪个文件做什么（判据细节直接写进条目），验证一行静态门 + 按需 UI 实测；任务拆解/执行顺序仅 L1 多文件多步骤时保留 -->

对应入口：../intents/2026-09-25-wiki-skeleton.md
对应 spec：（L1 略）

## 改动面（L1 极简形态主节）

> 5 段改动面（5 个主题目录 + 1 个 INDEX.md 微更新 + 1 个看板重生成）。每个主题 README.md 用统一 4 节骨架：主题说明 / 关键决策点 / 复盘 / 指向 workflow/ 原文链接。

**1. wiki/跨宿主适配/README.md（E 环节）**

- 主题说明：跨宿主适配层同步工具 `flow-kit sync-hosts` + doctor §6.7；薄适配正文 = 权威源正文 + frontmatter 保留宿主特化。
- 关键决策点：
  - B-b 方案：薄适配正文 = 权威源正文 + frontmatter 保留宿主特化（用户拍板）
  - 工具按正文段 sha 比对（剥离 frontmatter），apply 单向覆盖正文不动 frontmatter
  - 不反向同步（防宿主特化污染权威源）
  - trae commands 加 `name: wf-X` 前缀；HOST_DIR 4 宿主 `.zcode` / `.omp` / `.opencode` / `.trae`
- 复盘：47 文件 / 2214 行；4 套件 113/113 PASS；doctor §6.7 包源环境自动 skipped
- 原文链接：commit 7313436 / 95c2a13 / 80317aa；intent + plan `workflow/intents/2026-09-25-cross-host-sync.md`、`workflow/plans/2026-09-25-cross-host-sync.md`

**2. wiki/文档闭环/README.md（A 环节）**

- 主题说明：文档闭环填空工具 `fill-{intent,spec,plan}.mjs`；frontmatter 受限子集 5 字段保护。
- 关键决策点：
  - 3 个 fill 工具独立（不合并单入口）
  - 零依赖；与既有 scripts 风格一致
  - L1 极简 fill-plan 无日期字段（与 plan _TEMPLATE 对齐）
- 复盘：21 文件 / 774 行；7 套件 170/170 PASS
- 原文链接：commit 22e8316 / 406a3f6；intent + plan `workflow/intents/2026-09-25-doc-fill-tools.md`、`workflow/plans/2026-09-25-doc-fill-tools.md`

**3. wiki/口径一致性/README.md（D 环节）**

- 主题说明：三处口径一致性检查 `gate-checklist.mjs`；doctor § ↔ check-loop § ↔ commits check 触发器 三方对照。
- 关键决策点：
  - 不纳入看板告警（沿用 B-b「只报告不修复」）
  - 不替代 check-loop / doctor（新增独立脚本）
  - 检查项分组：模板填充（13） + 工作流门（1） + doctor 子项（11）
- 复盘：12 文件 / 793 行；8 套件 180/180 PASS
- 原文链接：commit 42618b3 / f4d7d25；intent + plan `workflow/intents/2026-09-25-gate-checklist.md`、`workflow/plans/2026-09-25-gate-checklist.md`

**4. wiki/装户面同步/README.md（C 环节）**

- 主题说明：装户面同步一致性检查 `source-sync-check.mjs`；包源 templates/_agents/ ↔ 装副本 .agents/ 4 类诊断（缺失 / 孤儿 / 漂移 / frontmatter-only-diff）。
- 关键决策点：
  - 只报告不修复（沿用 D 环节 B-b 决策）
  - 不替代 sync / doctor（新增独立脚本）
  - 零依赖；exit code：clean=0 / findings>0=1 / error=2
  - 白名单 `RENDER_OUTPUT_FILES` = `{kit.json, settings.json, hooks/commit-check.config.json}`（init 渲染产物）
- 复盘：11 文件 / 747 行；9 套件 191/191 PASS（首次实测发现 5 个真实差异→F 环节闭环）
- 原文链接：commit ea866f4 / 52a5e6f / 65d3441；intent + plan `workflow/intents/2026-09-25-source-sync-check.md`、`workflow/plans/2026-09-25-source-sync-check.md`

**5. wiki/双源漂移修复/README.md（F 环节）**

- 主题说明：装户面双源漂移修复；收口 source-sync-check 跑出的 5 个真实差异（4 处漂移 + 1 处孤儿）。
- 关键决策点：
  - 包源 → 装副本同步方向（包源是权威源，应反映装副本实际状态）
  - 白名单扩展（commit-check.config.json init 渲染产物）
  - sync 自愈 owned 哈希（doctor §6.6 严化为 FAIL 后的标准动作）
- 复盘：12 文件 +105 / -36；18 套件 309/309 PASS（+4 场景）；doctor 10/0/0；预算上限 49152 → 65536
- 原文链接：commit e3454bf / b5988d7 / 564c6bb；intent + plan `workflow/intents/2026-09-25-fix-double-source-drift.md`、`workflow/plans/2026-09-25-fix-double-source-drift.md`

**6. wiki/INDEX.md 速览表更新**

- 「主题目录速览」表新增 5 行（跨宿主适配 / 文档闭环 / 口径一致性 / 装户面同步 / 双源漂移修复），「用途」列各 1 行简述（不超过 30 字）
- 「合计」行改为 ≥ 5 份知识文档 + 5 个主题
- 命名规则段保留（不修改）

**7. 看板重生成**

- `wiki/知识沉淀总览.html`：跑 `node .agents/scripts/gen-wiki-board.mjs` 重生成（按 wiki 协议"计数 / 合计 / 看板 DATA 均为生成区"）
- 不手改 .html（生成区由脚本负责）

## 验证方式

- 静态门：
  - `npm test`：18 套件全绿（target 309/309 PASS 不回归）
  - `node .agents/scripts/verify-wiki-consistency.mjs`：三方一致性 PASS（无失败）
  - `node bin/flow-kit.mjs doctor`：10 PASS / 0 WARN / 0 FAIL（wiki 不在 doctor 检查范围；防回归）
- 看板门：
  - 跑 `node .agents/scripts/gen-wiki-board.mjs`：看板重生成无错
  - `wiki/知识沉淀总览.html` 渲染含 5 主题（grep "跨宿主适配" / "文档闭环" / "口径一致性" / "装户面同步" / "双源漂移修复" 命中）
- 命名门：
  - 主题目录用中文（按 INDEX.md 命名规则「主题目录用中文名」）
  - 文件命名不限中英文（README.md 英文统一）
- L1 不要求独立复核（intent §确认与复核）。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-09-25 用户对话内"走 B"通过；用户对 5 主题 + 中文命名 + 7 段改动面认可）
- 关单 commit：(pending —— 5 段改动面 + 7 条验收全勾验)
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L1 不要求独立复核