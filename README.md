# agentic-flow-kit

AI-Native 工作流引擎的独立安装器。一条 `npx` 命令把引擎装进任意项目：**工作流面**管任务怎么从需求跑到关单，**工程治理面**管多宿主接线、门禁、权限、观测怎么落地。零运行时依赖，只用 Node.js ≥ 22 内置模块。

- **零依赖**：安装器与引擎脚本全部 Node 内置模块，无 Python、无框架。
- **12 宿主一次铺开**：trae / codebuddy / codex / codeartsdoer / claude / opencode / qwen / pi / cline / commandcode / qoder / zcode；能力单源在 `src/hosts/registry.mjs`，新宿主可作插件接入。
- **幂等安装与升级**：`install-manifest.json` 记文件哈希，冲突默认跳过、`--force` 覆盖；`upgrade` / `adopt` / `prune` / `diff` 全生命周期可回查。
- **双语**：`--lang zh-CN`（默认）或 `en`，语言包覆盖文档、提示词、脚手架与安装器输出。
- **交互向导**：交互终端裸跑进 TUI；非交互自动降级编号问答。

## 两大能力面

### 工作流：任务怎么跑

- **风险定级路由**（`new-task`）：L1 / L2 / L3 判级 + 触达面闭集，判低有机器硬拦；L0 / L1 走快速道。
- **手动阶段流**（`stages`）：Plan 立 intent → Design 起 spec → Build 起 plan + 实现 → Test 静态门 + 独立复核 + 关单；L2 / L3 强制独立复核（新会话、固定 git range）。
- **全自动执行器**（`pipeline-run`）：单命令驱动状态机，`PIPELINE-STOP` 停机点分流（工单 / 人件门原话代录 / 门失败 / 完成）；`onFail` 失败路由 + 重试预算 + 断点续跑；产物落 `workflow/tasks/<task>/`，与手动路径隔离。**保留待用**：目前零真实 run，启用前先跑 `check-pipeline-state.mjs` 静态闭包检查，再用小任务端到端验证。
- **任务投影与看板**：`projectTasks` 单源聚合 INDEX.md 任务表 + 本地 SSE 看板（`workflow-board-server.mjs`）。
- **证据链**：确认台账（原话代录 + 对质）、独立复核落盘、verify 证据绑定 runId、Spec / Tasks / Verify 三件套（`check-spec-packages` 可入 CI）。
- **观测**：usage 凭证采集（`PostToolUse(Agent)` 观测腿，缺字段零写入）、observability 聚合、门禁墙钟预算（advisory，数据驱动退役）。

### 工程治理：怎么管住

- **Hook 中性规格编译**：`gates.json` 单一事实源，按 12 宿主 schema 编译接线（含 Codex 用户级 hooks、CodeArtsDoer `.github/hooks`），托管条目幂等合并、用户条目保留；宿主不支持的规格降级为 doctor guarantee advisory。
- **权限编译**：allow / deny / ask 同源编译到各宿主；企业档按宿主能力分级加固。
- **MCP 接线**：`servers.json` 声明，安装器编译到宿主配置。
- **模型按角色**：code / judgment / review 三角色，安装时探测推荐或手填，按宿主注入或继承。
- **门禁与体检**：`doctor`（含 `--attest` 安装证明链）、`check-local-gates` 墙钟预算门、`diff` 漂移比对。
- **布局治理**：栈 profile（dotnet / node / ts / rust / go / java × 6 切面）、tier（lean / standard / enterprise）、devcontainer 校验 / 构建、CI 双发、多仓 workspace 聚合。

## 快速开始

```bash
npx agentic-flow-kit install --agent claude --agent codebuddy --lang zh-CN --stack dotnet --target .
npx agentic-flow-kit doctor --target .    # 装后体检
npx agentic-flow-kit                      # 交互终端裸跑 = TUI 向导
```

从源码运行把 `npx agentic-flow-kit` 换成 `node <仓库路径>/bin/flow-kit.mjs`。安装后脚本 / hook 随包运行时分发（`flow-kit run <script>` / `flow-kit hook <hook>`），项目内只落声明面；`flow-kit` 需在 PATH（CI 用 `npx --yes agentic-flow-kit`）。

核心子命令：`install` / `add-host` / `upgrade` / `adopt` / `prune` / `diff` / `status` / `doctor` / `run` / `hook` / `agent-eval`。完整选项与退出码见各命令 `--help`。

## 维护本仓

- **无 build / lint / 依赖安装**：`npm test` 跑全部（`node --test tests/*.test.mjs`）；单文件 `node --test tests/install.test.mjs`；单用例加 `--test-name-pattern`。不要引入运行时依赖或测试框架。
- **目录**：`src/` 安装器（宿主能力单源 `src/hosts/registry.mjs`）、`templates/` 引擎与宿主模板、`locales/` 语言包、`tests/`。
- **改动的硬性约定**：宿主能力只登记 registry，禁止在 `plan.mjs` / `doctor.mjs` 写宿主分支；manifest 哈希按最终文本计算（渲染、语言覆盖、模型注入之后）；语言覆盖整文件替换非合并；TUI 只有 `src/tui/screen.mjs` 接触 stdin / stdout。
- **测试约定**：`node:test` + `node:assert/strict`；安装测试在临时目录 `git init` 后 spawn CLI 并设 `FLOW_KIT_TEST=1`；宿主能力 / 安装行为改动补 `hosts.test.mjs` / `install.test.mjs` / `models.test.mjs`；中英文输出改动补 `tests/en.test.mjs`。
- **发布**：semver tag 必须等于 `package.json` 的 `version`，否则 CI 中止 publish；`prepublishOnly` 重跑全部测试。
- **本仓库不自安装引擎**（无 `.agents/`）：验证安装行为用临时目录 `--target <tmp>`。
- **架构细节**（安装管线、渲染三单源、宿主能力矩阵、模型解析、TUI）：见 `CLAUDE.md`；工作流命令手册在目标项目的 `.agents/commands/`。

## 许可证

MIT。见 `LICENSE`。
