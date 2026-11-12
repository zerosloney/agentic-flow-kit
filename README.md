# agentic-flow-kit

AI-Native 工作流驱动开发引擎的独立安装器。把现行仓的 `.agents/` 引擎、git 门禁、宿主适配层与 `wiki`/`workflow` 数据资产脚手架，从零生成到任意项目；功能与现行引擎保持 parity。

- 零运行时依赖：只用 Node.js ≥ 22 内置模块。
- 指定 agent：一次可装一个或多个宿主壳（命令 / 角色 / 规则 / hooks 接线）。
- 可选语言：`--lang zh-CN`（默认）或 `--lang en`；语言包覆盖文档、提示词、记忆文件、脚手架与安装器输出。
- 幂等升级：`.agents/install-manifest.json` 记录版本、宿主、语言与文件哈希；冲突默认跳过，`--force` 才覆盖。
- 交互式 TUI 向导：交互终端不带参数直接运行进入菜单（安装 / 升级 / 追加宿主 / 体检 / 宿主列表），零依赖；非交互终端自动降级为编号问答或打印帮助。

## 快速开始

在目标项目根运行：

```bash
npx agentic-flow-kit install \
  --agent trae --agent codebuddy \
  --lang zh-CN \
  --stack dotnet \
  --target .
```

从本仓库源码运行时，把 `npx agentic-flow-kit` 换成 `node <仓库路径>/bin/flow-kit.mjs`。

也可以用交互式向导：在交互终端不带任何参数直接运行，进入 TUI 菜单，按提示选宿主 / 语言 / 栈与开关：

```bash
npx agentic-flow-kit
```

安装后：

```bash
node .agents/scripts/check-local-gates.mjs --fix
npx agentic-flow-kit doctor --target .
```

## 子命令

| 命令 | 作用 |
|---|---|
| `install` | 从零安装；可重复 `--agent`，也可 `--agents a,b,c` |
| `add-host <host>` | 已安装仓追加宿主壳（同时接受 `--agent <host>`） |
| `upgrade` | 按 manifest 记录的宿主/语言/栈重放模板；冲突默认跳过 |
| `doctor` | 校验 manifest、文件在位、git 配置、`.gitattributes`、五钩子、宿主接线、Node 版本；`--deep` 再跑 `check-local-gates.mjs` |
| `list-hosts` | 列出支持的宿主 |

通用选项：

| 选项 | 说明 |
|---|---|
| `--target <dir>` | 目标项目根，默认当前目录 |
| `--lang zh-CN\|en` | 语言包，默认 `zh-CN` |
| `--stack dotnet\|node\|empty` | 项目栈 profile；缺省按 `.sln`/`.csproj`/`package.json` 探测 |
| `--name <name>` | 渲染 `{{projectName}}`，默认目标目录名 |
| `--dry-run` | 只打印计划，不写盘 |
| `--force` | 覆盖冲突/非本工具安装的既有文件 |
| `--no-git-config` | 不自动写三条例行 git 配置 |
| `--track-hosts` | 不把本机宿主目录写进 `.gitignore` |

## 宿主

v1 支持 10 个现行宿主：

| 宿主 | 目录 | 说明 |
|---|---|---|
| `trae` | `.trae/` | 命令 / 角色 / 规则 / hooks.json |
| `codebuddy` | `.codebuddy/` | 命令 / 角色 / 规则 / 技能 / settings / 记忆 |
| `claude` | `.claude/` + 根 `CLAUDE.md` | 命令 / 角色 / settings / 根记忆 |
| `opencode` | `.opencode/` | 命令 / 角色 |
| `qwen` | `.qwen/` | 命令 / 角色 / settings |
| `pi` | `.pi/` | 角色 / 扩展 / settings |
| `cline` | `.cline/` | workflows / 角色 YAML / hook |
| `commandcode` | `.commandcode/` | 命令 / 角色 / settings |
| `qoder` | `.qoder/` | 命令 / 角色 / settings |
| `zcode` | `.zcode/` | 角色 / config / workflows |

宿主壳全部是指针壳：正文权威仍在 `.agents/commands/`、`.agents/roles/`、`.agents/skills/`，安装器不复制正文，避免双源漂移。

## 模板 / Profile / State 三层

| 层 | 位置 | 内容 |
|---|---|---|
| engine | `templates/engine/` | `.agents/` 通用引擎（commands / skills / roles / hooks / scripts / config / pipelines / tests / board / notes） |
| profile | `templates/profiles/<stack>/` | 栈相关配置与 `AGENTS.md`：`test-impact-map.json`、`lane-surfaces.txt`、`rule-budgets.txt`、`workflow-modules.txt`、`commit-check.config.json`、`delete-guard-allowlist.txt` |
| scaffold | `templates/scaffold/` | `wiki/` 目录骨架 + INDEX + 看板；`workflow/` 状态机骨架 + 空台账 + `_TEMPLATE.md` |
| git | `templates/git/` | `.githooks/` 五钩子、`.gitattributes` 合并块、`.gitignore` 运行态块 |
| locale | `locales/<lang>/overrides/` | 按目标路径镜像的语言覆盖；缺省回退模板 |

运行态（`cache/`、`tmp/`、`*.jsonl` 台账、`confirmations.d/`、`workflow/archive`、`.agents/tools/`）不打包，由引擎在装户内产生。

## 冲突与升级

- 目标文件不存在 → 创建。
- 目标文件存在且哈希等于 manifest → 更新。
- 目标文件存在但哈希不等于 manifest（装后被改）→ 冲突跳过；`--force` 覆盖。
- 目标文件存在且不在 manifest（非本工具安装）→ 跳过；`--force` 覆盖。
- `.gitattributes` / `.gitignore` 用带标记的合并块，重复执行不会重复追加。

## 语言

- `zh-CN`：模板原文即中文。
- `en`：`locales/en/overrides/` 覆盖命令、角色、技能入口、宿主指针壳、记忆文件、`wiki`/`workflow` 脚手架与安装器输出。
- 机器协议与锚点（例如 `wiki/INDEX.md` 的生成锚点、`_TEMPLATE.md` 的节标题）保持中文原样，避免破坏生成器与门禁解析；英文包只翻译人类可读面。
- `runtime-env.md`、`gate-diet.md` 等环境/历史长文暂回退中文；按需在 `locales/en/overrides/.agents/notes/` 补译。

## 迁移与 parity

本工具的模板由 `tools/extract-from-project.mjs` 从现行仓一次性提取；`tools/parity-report.mjs` 只读对比模板与现行引擎/宿主/git 面。当前结果：

- 350 个对比对：342 完全一致，7 处刻意差异，0 个现行跟踪文件未被覆盖：
  1. `engine.json` 用 `{{installedAt}}` / `{{hostsJson}}` / `{{stack}}` / `{{language}}` 占位；
  2. `check-local-gates.mjs`：dotnet 与 `TEST_DB_CONN` 检查只在 `stack=dotnet` 时执行；
  3. `check-scripts-syntax.mjs`：缺失 `scripts/verify` 时跳过（存在但为空仍 fail-closed）；
  4. `verify.mjs`：按 `engine.json options.stack` 过滤 dotnet/Vue 专用 product 门，node 栈追加 `npm test`；
  5. `.githooks/pre-push`：宿主接线面扩到 10 宿主；
  6. `.agents/board/dev-tour.html`：项目名改为 `{{projectName}}` 占位；
  7. `check-ledger-invariant.mjs`：本仓历史基线哈希在新仓解析不出时按无基线处理，避免装户报警。
- `verify-ui/features/` 是装户业务特性地图，只保留空目录占位，不随通用引擎打包。

本仓迁移策略：先保留现行 `.agents`/`.githooks`/宿主目录；其他项目安装验证完成后，再在本仓卸载现行引擎并安装本工具（届时用 `--force` 采用现有文件）。

## 开发

```bash
node tools/extract-from-project.mjs --project 项目目录   # 重新提取模板（一次性迁移工具）
node tools/make-en-host-overrides.mjs                                     # 重新生成英文宿主指针壳
node tools/parity-report.mjs --project 项目目录          # 对比现行引擎
node --test tests/*.test.mjs                                              # 安装器测试
```

目录：

```
agentic-flow-kit/
├── bin/flow-kit.mjs
├── src/{cli,install,hosts,render,git}/
├── templates/{engine,hosts,profiles,scaffold,git}/
├── locales/{zh-CN,en}/
├── schemas/
├── tests/
└── tools/
```
