# AGENTS.md — AI 工作流 + Wiki

> 本文件由 agentic-flow-kit 生成：说明本仓库的 AI 工作流与 Wiki 用法。「项目适配区」由项目自行填写；工作流约定可增不可删。

## AI工作流

**闭环模型**：`workflow/` 是唯一真相源——intents（为什么做）→ specs（怎么设计）→ plans（怎么做）→ incidents（学到了什么）。单人 + AI 协作：AI 起草 / 实现 / 验证 / 自查，取舍与放行由用户拍板，确认在对话内一句话完成，追溯靠 git。文档协议（frontmatter 字段、状态枚举、命名规则）见 `workflow/README.md`。

### 开工前必读

1. **新需求 / 功能**：先立 `workflow/intents/` intent（复制 `_TEMPLATE.md`），对话内与用户确认后开工。
2. **修复类任务**：先查 `workflow/incidents/` 同类历史；L1 以上立 incident（修复中即 intent 等价入口，L2/L3 与 spec/plan 同名配对）。
3. **级别判断**（就高不就低）：实现级（页面 / 交互 / 样式）→ L1；改「规则 / 契约」→ L2；改「数据与运行时结构」（schema / 迁移 SQL / DI 链 / 认证与中间件管线）→ L3。细则见 `.agents/commands/new-task.md`。

### 阶段路由

总入口 `.agents/commands/new-task.md`：Plan `.agents/commands/plan.md` → Design `.agents/commands/design.md` → Build `.agents/commands/build.md` → Test `.agents/commands/test.md` → Deploy `.agents/commands/deploy.md` → Maintain `.agents/commands/maintain.md`；`.agents/commands/review.md` 为横切评审入口。

### 子智能体

公共角色契约在 `.agents/roles/`（`implementer` / `independent-reviewer` / `ui-verifier`），各宿主经薄适配层（`.opencode/agents/`、`.trae/agents/`、`.zcode/agents/` 等）注册，宿主不支持子智能体时按命令 frontmatter 的 `fallback` 执行。子智能体不跨用户确认门、不替用户批准、不自行提交。

### 门禁与提交

- `.githooks/`（经 `core.hooksPath` 挂载，本地 clone 后执行 `git config core.hooksPath .githooks`）：pre-commit（闭环配对 / wiki 台账 / 规则面预算 / 敏感信息扫描与条件构建）、pre-push（闭环断档扫描）、commit-msg、post-commit、pre-merge-commit。
- **`git commit` / `git merge` / `git push` 三处一律禁 `--no-verify`**——被拦说明产出不合规，按提示修完原路重试。
- 项目专属门禁挂 `.agents/hooks/local-pre-commit`。
- 提交遵循 Conventional Commits 中文（feat / fix / docs / style / refactor / perf）；L1+ 入口文档 / spec / plan 随代码同一提交；确认（approved）后立即 `docs(*)` 单独提交留痕。

### 检索、看板与量化

- 跨语料检索：`node .agents/scripts/kb-search.mjs "<词>"`（workflow 节级定位 + wiki 全文）；活跃流程读 `workflow/INDEX.md`（状态变更后 `node .agents/scripts/gen-workflow-index.mjs` 重生成）。
- workflow 看板（可选，默认不拉起）：需要时手动跑 `.agents/scripts/ensure-board.ps1`，然后访问 http://127.0.0.1:{{BOARD_PORT}}（只读预警层，非门禁）。
- 委派 / 自做结果留痕 `workflow/delegations.md`（聚合 `node .agents/scripts/agg-delegations.cjs`）；命令 / 技能卡壳记 `workflow/papercuts.md`，不当场顺手改。

### 验证与关单

验证入口 `.agents/commands/test.md`；**关单在 test**：逐条勾验入口文档「验收标准」并补证据后 intent → done，未勾验会被 check-loop 拦。上 prod 另走 `.agents/commands/deploy.md`（tag / 回滚 / 观察），不用 deploy 关单。

## Wiki

`wiki/` 是项目知识沉淀，按主题目录归位；原始 / 一次性文档归档 `wiki/drafts-archive/<日期-主题>/`（只读不增量）。

- 人工只维护两样：**磁盘文件本身 + `wiki/INDEX.md` 速览表「用途」列**；计数 / 映射表 / 看板 DATA 均为生成区，勿手改——`node .agents/scripts/gen-wiki-board.mjs` 重生成，`node .agents/scripts/verify-wiki-consistency.mjs` 三方一致性验证（触及 `wiki/` 的提交会被 pre-commit 台账门禁校验）。
- wiki 看板：`wiki/知识沉淀总览.html`。

## 项目适配区（项目自填）

- **构建 / 测试 / 类型检查命令**（静态门，各阶段命令引用此处口径）：构建 = {{BUILD_CMD}}；测试 = {{TEST_CMD}}；类型检查 = {{TYPECHECK_CMD}}
- **运行时环境**（端口 / 进程 / 终端差异）：`.agents/notes/runtime-env.md`
- **目录级规则**：如 `backend/AGENTS.md`、`frontend/AGENTS.md`（如有）——目录级约定不回填本文件
- **权限与提交验证配置**：`.agents/settings.json`（allow / deny / ask）、`.agents/hooks/commit-check.config.json`（条件构建 / 质量检测命令与密钥白名单——质量检测只放秒级确定性检查（lint / 类型检查 / vet），测试不放提交门，关单在 test 阶段门）
