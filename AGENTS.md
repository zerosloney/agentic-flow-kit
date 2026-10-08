# AGENTS.md — AI 工作流协议 (Protocol)

> **定义**：本文件是 `agentic-flow-kit` 的运行协议。所有 AI 操作必须遵循此闭环逻辑，严禁跳步。

---

## 1. 闭环工作流 (Closed-Loop Model)

**唯一真相源**：`workflow/` 目录。
**执行链路**：`Intents` (为什么) → `Specs` (怎么设计) → `Plans` (怎么做) → `Incidents` (学到了什么)。

### 1.1 任务分级与风险泳道
| 级别 | 类型 | 定义 | 确认门禁 |
| :--- | :--- | :--- | :--- |
| **L0** | 例行 | 简单修改/文档更新 | 协作道：轻确认 → 异步审计 |
| **L1** | 实现 | 功能实现/Bug 修复 | 协作道：轻确认 → 异步审计 |
| **L2** | 规则 | 契约/接口/逻辑变更 | 防御道：**同步确认 (Spec/Plan approved)** |
| **L3** | 结构 | 数据/运行时结构变更 | 防御道：**同步确认 + 独立复核** |

### 1.2 阶段路由 (Stage Routing)
**入口**：`.agents/commands/new-task.md`
**指令**：`.agents/commands/plan.md` → `.agents/commands/design.md` → `.agents/commands/build.md` → `.agents/commands/test.md` → `.agents/commands/deploy.md` → `.agents/commands/maintain.md`
**横切**：`.agents/commands/review.md` (评审)；自动化驱动 `pipeline-run.mjs`（二选一）

### 1.3 确认门 (Confirmation Gate)
**唯一入口**：`node .agents/scripts/confirm-doc.mjs <path>`
- **状态流转**：draft→approved→done / open→fixed→closed，两跳闭环，禁单跳。
- **放弃态**：`--to superseded|cancelled`（四终态同样内容绑定）。
- **执行形态**：
    1. **TTY**：用户终端亲手键入「可以」（AI 会话内被拒）。
    2. **委托代录**：`--delegated "<用户原话>"` → 台账记 `source: chat-delegated` + 原话供对质。
- **纪律**：逐件调用 + 逐件原话——一次一份，多份并录被拒；每次传当次实际放行的措辞，**不复用同句**（复用使台账 quote 失去分辨力）。
- **批量**：仅 L0/L1 可 `--batch`（台账 `brief:true`，并录告警豁免）；L2/L3 逐份。
- **done 内容绑定**：关单编辑（勾验/回填）先于 done 确认，confirm-doc 是最后一次写入；此后修订走 superseded 或新 intent。
- **approved 留痕**：done 确认前 approved 态须已进 git 历史（confirm-doc 前置门硬校验，逐份）。
- **防伪**：check-loop 15 指纹+台账对账，缺记录/指纹不配对 → hard-block；伪造台账留痕供事后对质。

---

## 2. 门禁与提交 (Gates & Commits)

### 2.1 提交规范
- **格式**：Conventional Commits 中文 (`feat`/`fix`/`docs`/`style`/`refactor`/`perf`)。
- **禁令**：`git commit/merge/push` **绝对禁止** `--no-verify`——被拦按提示修完原路重试。
- **闭环链**：L1+ 三段式 `docs(*)` approved 留痕 → 代码 → 关单 `docs(*)`，相邻提交即同一闭环。

### 2.2 自动化门禁
- **本地钩子** (`.githooks/`，clone 后 `git config core.hooksPath .githooks`)：pre-commit (闭环配对 / 泳道完整性 / wiki 台账 / 规则面预算 / 双源一致性 / managed 台账快检 / 敏感扫描与条件构建)、pre-push (闭环断档扫描)、commit-msg / post-commit / pre-merge-commit。
- **CI 远端门**：`.github/workflows/kit-ci.yml` 复跑 `node .agents/scripts/verify.mjs`；非 GitHub 装户可删，等价门 = 同入口命令 + 服务端分支策略。
- **项目专属门**：`.agents/hooks/local-pre-commit`；装户五条硬规则见 `workflow/README.md`「硬规则」。

---

## 3. 核心工具与资源

### 3.1 检索与量化
- **全局检索**：`node .agents/scripts/kb-search.mjs "<词>"` (Workflow + Wiki)。
- **活跃流程**：`workflow/INDEX.md`（状态变更后跑 `node .agents/scripts/gen-workflow-index.mjs` 重生成）。
- **看板**（可选，默认不拉起）：`node .agents/scripts/ensure-board.mjs`（端口 8933 起自动上探）。
- **留痕**：`workflow/delegations.md`（委派，聚合 `agg-delegations.cjs`）/ `workflow/papercuts.md`（卡壳，不当场顺手改）。

### 3.2 验证与关单
- **入口**：`.agents/commands/test.md`。
- **关单协议**：逐条勾验「验收标准」→ 补证据 → `intent` → `done`（缺证据被 check-loop 拦）。
- **部署**：`.agents/commands/deploy.md` (tag / 回滚 / 24h 观察，不用于关单)。

### 3.3 Wiki 维护
- **存储**：`wiki/` (主题归位) / `wiki/drafts-archive/` (只读归档)。
- **人工只维护**：磁盘文件 + `wiki/INDEX.md` 速览表「用途」列；计数 / 映射表 / 看板 DATA 为生成区。
- **同步**：`node .agents/scripts/gen-wiki-board.mjs` (看板) → `node .agents/scripts/verify-wiki-consistency.mjs` (三方一致性，pre-commit 台账门校验)。

---

## 4. 项目适配区 (Project Specifics)

### 4.1 运行指令
- **构建/测试**：构建 = 无（纯 JS，node 直跑）| 测试 = `npm test` | 类型检查 = 无。
- **闭环驱动**：`node .agents/scripts/pipeline-run.mjs start "<需求>"`（工单干活 / 到门即停 / `--delegated` 原话代录）；与 new-task 手动路由二选一。
- **文档填空**：起草 intent / spec / plan 先跑 `node .agents/scripts/fill-{intent,spec,plan}.mjs` 拿骨架再填实。

### 4.2 引擎双源纪律 (Core Discipline)
- **同步路径**：`templates/` (包源) → `node bin/flow-kit.mjs sync` → `managed` (装副本)。**`.agents/` 直改 managed 文件会被 doctor 台账漂移告警。**
- **Owned 文件**：`AGENTS.md` / workflow 模板等 sync 不动，须手动同步装副本（见 incidents/2026-09-25-wf-runtime）。
- **宿主同步**：改 `templates/_agents/{commands,roles}` 权威源后跑 `node bin/flow-kit.mjs sync-hosts --apply`（薄适配正文对齐，frontmatter 保留宿主字段）；详见 `.agents/commands/sync-hosts.md`。

### 4.3 配置与环境
- **权限**：`.agents/settings.json` (allow / deny / ask)。
- **提交验证**：`.agents/hooks/commit-check.config.json`（质量检测只放秒级确定性检查，测试不放提交门）。
- **运行时环境**：`.agents/notes/runtime-env.md`（端口 / 进程 / 终端差异）。
- **目录级规则**：如 `backend/AGENTS.md`（如有）——不回填本文件。
