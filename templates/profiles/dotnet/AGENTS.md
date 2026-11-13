# Repository Guidelines

船厂物资管理系统。ASP.NET Core 6 后端（Clean Architecture 双模块）+ Vue 3 + SQL Server。

## 1. 运行时联通 (Runtime Connectivity)
前端 dev 5203 连 API `http://localhost:8932`；API 须监听 8932 才联通。端口/工具缺陷/可执行文件解析机理等环境事实见 `.agents/notes/runtime-env.md` §6；各机绝对路径与版本自登记 `.agents/notes/runtime-env.local.md`。

## 2. 本地 Clone 必做 (Local Setup)
> 漏配则门禁静默失效，详见 `.agents/notes/runtime-env.md` §7。
- `git config core.hooksPath .githooks` 挂仓库自带钩子。
- `git config merge.ours.driver true` 启用 `appsettings.json` 的 `merge=ours` 策略。
- `git config merge.jsonl-union.driver "flow-kit run git-merge-jsonl.mjs %O %A %B"` 启用 `.agents/*.jsonl` 并集合并策略。
- **禁令**：commit / merge / push 三处一律禁 `--no-verify`。
- **自检**：`flow-kit run check-local-gates.mjs --fix`

## 3. 全局红线 (Universal Laws)
- **安全/隐私**：不提交密钥、令牌、`.env` 或真实用户数据；发现敏感信息立即停止扩散。
- **不可逆操作**：默认不执行生产部署、远程推送、数据删除等操作 → 须用户明确要求且不得绕过门禁。
- **最小改动**：优先做满足需求的最小改动，禁止顺手重构无关代码、修改格式或修复无关 Lint 警告。
- **单源纪律**：路径 / 版本 / 缺陷等环境事实只登记于 `.agents/notes/runtime-env.md` §6，别处禁止复制原文。
- **上下文纪律**：批量取数、长日志、大 diff、全仓盘点交子代理，主线只收结论摘要与 `file:line`；子代理回报写结论与证据路径，禁把原始输出整段搬回主线。
- **提交规范**：Conventional Commits 中文，类型限 `feat/fix/docs/style/refactor/perf/chore`。

## 4. 阶段路由表 (Workflow Routing)
按任务类型跳转对应指令文件：

| 任务类型 | 指令文件 | 核心职责 |
|---|---|---|
| **L0 极简道** | `.agents/commands/new-task.md` | 全机器可判的极小改动，与 L1 同走快速道：改码 → `verify --face`/`--scope` → 单笔 commit；判据与仲裁见 new-task.md §L0 极简道 |
| **L1 快速道** | `.agents/commands/new-task.md` | 定级、实现、`verify --scope`、单笔关单（仅独立关单场景开技能）。不打开 `stages.md` |
| **新需求 / 功能** | `.agents/commands/new-task.md` | L1 走上一行快速道；L2/L3 才进 `stages.md` |
| **L2/L3 阶段流（意图 → 设计 → 实现 → 验证关单）** | `.agents/commands/stages.md` | 四章 Plan→Design→Build→Test：立 intent → 起 spec → 起 plan + 实现 → 静态门 → UI 实测 → 独立复核 → 关单。L1 不进 |
| **修复 / 事故** | `.agents/commands/maintain.md` | L1 非事故只做 §1 立档后回快速道。线上事故与 L2/L3 读全文 |
| **上线 / 发布** | `.agents/commands/deploy.md` | 静态门 → 回归检查（含 DB 验证）→ 授权 → PR 审查合并 |
| **合入评审** | `.agents/commands/review.md` | P0/P1/P2 分级评审 → 结论定性 |
| **自动化驱动** | `.agents/commands/pipeline-run.md` | 实验位保留待用：状态机尚未验证、零 run 记录，启用前须补状态机测试——口径以 pipeline-run.md 自述为准；与手动阶段路由二选一，禁混用 |
| **无人值守 / 过夜** | `.agents/skills/autonomous-run/SKILL.md` | 长跑合同：逐单元签收 + 停机条件；门禁与确认门不豁免，可挂 pipeline-run 驱动（实验位待用） |
| **性能 / 视觉对齐** | `.agents/skills/perf/SKILL.md` · `.agents/skills/visual-parity/SKILL.md` | 先基线后单变量；像素对齐只改样式，差异表清零才宣称一致 |

> **纠偏短名**：任务中途报短名即可，索引 `.agents/config/principles.md`。

> **引擎面豁免**：改 AI-Native 治理引擎自身，**豁免工作流三件套**——不生成 intents/specs/plans、不走确认门，Conventional Commits 直接变更。引擎面 = `.agents/` 全部、`.zcode/`、`.githooks/`、`azure-pipelines.yml`、workflow/ 模板与台账、根 `package.json`、宿主适配目录 `.opencode/`、`.trae/`、`.codebuddy/`、`.qwen/`、`.pi/`、`.cline/`、`.commandcode/`、`.claude/`；其中 `.pi/`、`.cline/`、`.commandcode/`、`.claude/` 等本机私有目录不入库、不随 clone 传播，其门禁接线完整性由 `check-local-gates.mjs` advisory 对账（机理 `.agents/notes/runtime-env.md` §6.4）。**wiki 豁免**：调整 `wiki/` 知识文档内容（含 INDEX 与看板）同享上述豁免，`docs(wiki)` 直接变更。**边界**：git 钩子与静态门照常执行；删除 wiki 文件仍须用户单独指令；数据维护 SQL 的**执行**不豁免，仍按数据维护台账与 DB 验证口径走；触及 `backend/`、`frontend/`、数据维护 SQL 等**业务面**不豁免，按下表级别走闭环；混合改动只对业务部分立档。

## 5. 目录级规则 (Directory-level Rules)
**禁止回填本文档**。具体实现细节请查阅对应目录的 `AGENTS.md`：
- **后端**: `backend/AGENTS.md` (.NET 开发规范 / 数据完整性 / API 契约 / 数据库操作)
- **前端**: `frontend/AGENTS.md` (前端开发规范 / 类型检查 / 契约与门禁 / UI 实测门)
- **成对文档同步**：`wiki/用户功能/物资系统功能验证手册-一期.{html,md}` 与 `wiki/用户功能/全流程与数据主线.{html,md}` 必须成对维护；修改任一份须同步另一份，并同步更新 `wiki/INDEX.md` 与 `wiki/知识沉淀总览.html`。

## 6. 项目适配区 (Project Adaptations)
- **构建/测试/类型检查**: 命令清单单源 `.agents/hooks/commit-check.config.json`。
- **冒烟探活**: 脚本路径与 6 端点判定事实见 `.agents/notes/runtime-env.md` §6.1。
