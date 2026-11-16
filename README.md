# agentic-flow-kit

AI-Native 工作流引擎：**工作流面**管任务怎么从需求跑到关单，**工程治理面**管多宿主接线、门禁、权限、观测怎么落地。以零依赖安装器分发——一条 `npx` 命令把整套引擎装进任意项目，只依赖 Node.js ≥ 22 内置模块。

- **零依赖**：引擎与安装器全部 Node 内置模块，无 Python、无框架。
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

## 引擎图表

### 工作流：一轮任务的生命周期

```
需求
 │
 ├─ new-task 定级（L1 / L2 / L3，两问定级 + 触达面闭集；判低 → 机器硬拦）
 │
 ├─ L0 / L1 快速道
 │    plan 即入口 ──→ 实现 ──→ 静态门 ──→ 关单
 │
 └─ L2 / L3 四并一阶段流（手动路由，stages）
      Plan ──────→ Design ─────→ Build ──────→ Test ──────→ 关单
      (intent)     (spec)        (plan+实现)    (静态门+独立复核)
         │            │              │              │
         └────────────┴──────────────┴──────────────┘
            每阶段：人件门确认（原话代录入台账）/ 独立复核（L2/L3 强制）/ 产物落盘

全自动执行器（pipeline-run，与手动路由二选一，禁混用）：
  triage → intent → spec → plan → implement → verify → review → closeout → done
    │         │        │       │         │         │         │
    └─────────┴────────┴───────┴─────────┴─────────┴─────────┘
      停机点：work-order 工单 ｜ await-confirm 人件门 ｜ gate-fail → onFail 退回
      产物：workflow/tasks/<task>/（与手动路径隔离）｜ 恢复：inFlight 断点续跑
```

### 治理面：引擎如何落到项目

```
目标项目
├─ .agents/            引擎声明面
│  ├─ skills/  roles/  commands/     技能 · 角色契约 · 命令手册
│  ├─ config/                         机器可读策略（pipeline · gates · model-roles）
│  └─ scripts/  hooks/                运行时实现（随包分发，由 flow-kit 调度）
├─ workflow/           数据资产（任务文档 · 台账 · 证据 · 看板）
└─ 宿主目录/            .claude/  .codebuddy/  …   各宿主原生声明面（命令 / agent / 技能）

        ↑ install · upgrade · adopt · prune · diff
          （manifest 哈希记最终文本 · 冲突默认跳过 · adopt 接管 · prune 清孤儿）

agentic-flow-kit
├─ src/hosts/registry.mjs    宿主能力单源（12 宿主 × 命令 / 技能 / hooks / 模型）
│  ├─→ gates 编译      gates.json → 各宿主 hook schema
│  ├─→ 权限编译        allow / deny / ask → 宿主权限配置
│  ├─→ MCP 编译        servers.json → 宿主 MCP 配置
│  └─→ 模型注入        code / judgment / review → 宿主 agent 模型
├─ doctor · check-local-gates    体检 · 安装证明链 · 墙钟预算门
└─ bin/flow-kit.mjs              命令入口（install · upgrade · run · hook · TUI）
```

## 快速开始

```bash
# 免安装：npx 直接跑（首次使用推荐）
npx agentic-flow-kit install --agent claude --agent codebuddy --lang zh-CN --stack dotnet --target .

# 或全局安装（包名 agentic-flow-kit，命令名 flow-kit）
npm install -g agentic-flow-kit@2.3.0     # 跟最新版用 @latest
flow-kit install --agent claude --lang zh-CN --stack dotnet --target .

npx agentic-flow-kit doctor --target .    # 装后体检
npx agentic-flow-kit                      # 交互终端裸跑 = TUI 向导
```

脚本与 hook 随包运行时分发，目标项目内只落声明面（不复制 `.agents/scripts`）；执行统一走 `flow-kit run <script>` / `flow-kit hook <hook>`——需 `flow-kit` 在 PATH（全局安装即满足；CI 用 `npx --yes agentic-flow-kit`）。

| 命令 | 作用 |
|---|---|
| `install` | 从零安装；`--agent` 可重复，`--auto-hosts` 探测现有宿主目录 |
| `add-host` / `remove-host` | 追加 / 移除单个宿主的适配层与技能面（引擎、栈、其他宿主保留） |
| `upgrade` | 按 manifest 重放模板升级；冲突默认跳过，`--force` 覆盖 |
| `adopt` | 接管已有或半安装目录并播种 manifest（`--dry-run` 零写入） |
| `prune` | 删除 manifest 登记、当前模板已无的孤儿文件 |
| `uninstall` | 删除全部托管文件（用户改过的默认保留，`--force` 覆盖） |
| `diff` / `status` | 只读对比 manifest / 磁盘 / 模板；或摘要输出安装状态 |
| `doctor` | 体检 manifest、在位文件、git 配置、钩子、宿主接线；`--deep` 跑本地门禁，`--attest` 出安装证明链 |
| `run <script>` | 执行包内引擎脚本（`--list` 列出可用；评测记录用 `run agent-eval.mjs record`） |
| `hook <hook>` | 执行包内宿主 hook 适配器（stdin 与参数透传） |
| `skills` | `skills lint` 准入检查；`add-skill` / `remove-skill` 管理外部技能与 lockfile |
| `workspace` | `workspace init` / `status`：多仓安装聚合 |
| `new-host <name>` | 生成可安装的宿主插件（后续命令自动发现） |

完整选项与退出码见各命令 `--help`。

## 许可证

MIT。见 `LICENSE`。
