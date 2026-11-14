# agentic-flow-kit

AI-Native 工作流驱动开发引擎的独立安装器。把现行仓的 `.agents/` 引擎、git 门禁、宿主适配层与 `wiki`/`workflow` 数据资产脚手架，从零生成到任意项目；功能与现行引擎保持 parity。

- 零运行时依赖：只用 Node.js ≥ 22 内置模块。
- 指定 agent：一次可装一个或多个宿主壳（命令 / 角色 / 规则 / hooks / 技能接线），按各宿主原生规范落盘。
- 技能单源：技能正文只保留在 `.agents/skills/`；原生支持技能的宿主生成指针壳，其余宿主生成 `wf-skills` 索引。
- 模型按角色配置：安装时探测宿主配置 / 环境变量（可选只读 CLI），按 `code` / `judgment` / `review` 推荐，也可 `--model` 或 TUI 手填。
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
npx agentic-flow-kit run check-local-gates --fix
npx agentic-flow-kit doctor --target .
```

脚本与 hook 实现随包分发：装好 `agentic-flow-kit` 即具备能力，项目内只落 `.agents` 的声明面（技能、子代理、命令、MCP / hooks 配置）与数据资产，不再复制 `.agents/scripts`、`.agents/hooks/*.cjs|*.mjs`、`.agents/tests`。git 钩子、宿主适配层与 MCP 统一通过 `flow-kit run <script>` / `flow-kit hook <hook>` 调用，因此 `flow-kit` 需在 PATH（CI 用 `npx --yes agentic-flow-kit`）。

## 子命令

| 命令 | 作用 |
|---|---|
| `install` | 从零安装；可重复 `--agent`，也可 `--agents a,b,c`；`--auto-hosts` 探测现有宿主目录 |
| `add-host <host>` | 已安装仓追加宿主壳（同时接受 `--agent <host>`） |
| `upgrade` | 按 manifest 记录的宿主/语言/栈重放模板；冲突默认跳过；`--explain-policy` 输出本次门禁/预算/枚举/角色模型差异 |
| `adopt` | 接管已有安装或半安装目录：按当前渲染结果识别文件并播种 manifest，未识别/已改动文件分类报告；`--dry-run` 零写入；之后 `upgrade` / `diff` 可用 |
| `prune` | 删除 manifest 登记、当前模板已不存在的孤儿文件；用户改过的默认跳过，`--force` 覆盖；清理空目录 |
| `remove-host <host>` | 移除单个宿主的适配层与技能面，保留引擎 / 栈 / 其他宿主；根记忆文件（如 `CLAUDE.md`）默认保留；刷新 `.gitignore` 合并块 |
| `uninstall` | 删除全部托管文件与合并块；用户改过的文件、根记忆文件默认保留，`--force` 覆盖；清理空目录与安装清单 |
| `diff` | 只读对比 manifest、磁盘与当前模板，分类 `unchanged` / `user-modified` / `kit-updated` / `orphan` / `missing`；支持 `--json`、`--all` |
| `status` | 摘要输出安装档位、宿主、语言、栈与差异计数；支持 `--json` |
| `explain <targetRel>` | 解释单个托管文件：类别、模板来源、语言覆盖、模型注入与 manifest/当前哈希 |
| `doctor` | 校验 manifest、文件在位、git 配置、`.gitattributes`、五钩子、宿主接线、Node 版本；`--deep` 再跑 `flow-kit run check-local-gates`；`--attest [--out <file>]` 生成安装证明链；manifest 漂移以 advisory 报告 |
| `list-hosts` | 列出支持的宿主 |
| `new-host <name>` | 生成可直接安装的宿主插件（定义 JSON + 命令/子代理指针壳 + 技能入口模板）；写入 `<out>/.flow-kit/hosts/`，后续命令自动发现。可选 `--skills native\|shared\|index`、`--hooks`、`--permissions`、`--mcp claude\|opencode`、`--model-field` / `--inherit`、`--root-memory` |
| `add-skill <local\|git\|npm>` | 安装外部技能到 `.agents/skills/<name>/`，写 `.agents/skills.lock.json` 与 manifest `skills` 段并刷新宿主技能面；git/npm 需 `--allow-network`，已有技能用 `--update` 升级 |
| `remove-skill <name>` | 按 manifest 哈希安全移除技能与宿主指针；用户改动默认拒绝，`--force` 覆盖 |
| `skills lint` | 技能准入检查：frontmatter 必填、name 唯一且匹配目录、描述预算、触发词冲突、`evalTasks` 引用、lockfile 完整性 |
| `run <script>` | 从包内运行时执行引擎脚本；`--root <dir>` 指定项目根，`--` 后的参数原样透传；`--list` 列出可用脚本 |
| `hook <hook>` | 从包内运行时执行宿主 hook 适配器；stdin 与剩余参数透传；`--list` 列出可用 hook |
| `workspace init --repos <dir>...` | 在多仓根目录生成 `.flow-kit/workspace.json`，记录仓库清单与各仓安装摘要；可重复执行刷新 |
| `workspace status` | 只读聚合 workspace 内各仓的安装状态、宿主、栈、版本与路径缺失 |

通用选项：

| 选项 | 说明 |
|---|---|
| `--target <dir>` | 目标项目根，默认当前目录 |
| `--lang zh-CN\|en` | 语言包，默认 `zh-CN` |
| `--stack dotnet\|node\|typescript\|rust\|go\|java\|empty` | 项目栈 profile；缺省按根目录标记探测：`.sln`/`.csproj` → dotnet，`Cargo.toml` → rust，`go.mod` → go，`pom.xml`/`build.gradle` → java，`tsconfig.json` → typescript，`package.json` → node |
| `--surface frontend\|api\|data` | 叠加切面，可重复/逗号分隔，也可写成 `--stack dotnet+frontend`；与 stack 同层合并，同名文件后声明者覆盖 |
| `--tier lean\|standard\|enterprise` | 安装档位。`lean` 不生成 CI，适合小项目；`standard`（默认）生成 CI；`enterprise` 另启用按宿主能力分级的加固矩阵（见下） |
| `--hardened` | 等价于 `--tier enterprise`；有 managed-only 键的宿主（目前为 Claude）需由平台/IT 以 managed settings 部署才不可覆盖 |
| `--name <name>` | 渲染 `{{projectName}}`，默认目标目录名 |
| `--dry-run` | 只打印计划，不写盘 |
| `--force` | 覆盖冲突/非本工具安装的既有文件 |
| `--no-git-config` | 不自动写三条例行 git 配置 |
| `--track-hosts` | 不把本机宿主目录写进 `.gitignore` |
| `--auto-hosts` | 扫描宿主点目录与根级配置/记忆文件，采用探测结果作为安装宿主；仅在未显式 `--agent` 时生效，探测为空报错 |
| `--host-manifest <file>` | 加载外部宿主定义，可重复；同名时优先级 `--host-manifest` > 项目 `.flow-kit/hosts` > 用户 `~/.flow-kit/hosts` > 内置 |
| `--no-mcp` | 跳过 MCP 配置编译（默认按 `templates/mcp/servers.json` 接线）；选择写入 manifest，`upgrade` 重放 |
| `--model [host:]role=<id>` | 可重复。指定模型角色；`role` 为 `code` / `judgment` / `review`，省略宿主则全局生效 |
| `--model-mode recommend\|detect\|inherit` | `recommend`（默认，探测 + 推荐）、`detect`（强制重新探测）、`inherit`（全部继承宿主默认） |
| `--probe-models` | 允许执行宿主注册表中声明的只读模型列表命令（1.5s 超时，失败静默） |
| `--no-model-config` | 跳过模型探测 / 注入，也不写 `.agents/config/model-roles.local.json` |
| `--json` | 最终只向 stdout 输出单个 JSON 对象；人类进度改写 stderr。`diff` / `status` / `prune` / `remove-host` / `uninstall` / `explain` / `adopt` / `doctor` / `list-hosts` 均支持 |
| `--strict` | 冲突或漂移视为失败：`install` / `add-host` / `upgrade` 遇冲突返回 1；`diff` / `status` 有任何漂移返回 1；`prune` / `remove-host` / `uninstall` 有未清理项返回 1 |

`diff` / `status` / `prune` / `remove-host` / `uninstall` / `explain` 未传 `--lang` 时跟随 manifest 记录的语言。`adopt` 没有 manifest 可跟随时，依次用 `engine.json`、既有 manifest、候选语言渲染匹配数推断语言与栈。

退出码契约（所有命令一致）：

| 码 | 含义 |
|---|---|
| `0` | 成功（`--strict` 下无冲突、无漂移） |
| `1` | 冲突，或 `--strict` 下的漂移 / 未清理项 |
| `2` | 用法错误（未知命令、参数、语言、档位、模型） |
| `3` | target 或 manifest 缺失 |
| `4` | 未知宿主 |
| `5` | IO 失败（权限、只读、磁盘已满等） |

## 多仓 Workspace

在包含多个仓库的父目录运行：

```bash
flow-kit workspace init --repos ./api ./web
flow-kit workspace status --json
```

- 清单固定为 `.flow-kit/workspace.json`（schema：`schemas/workspace.schema.json`），只记录显式列出的仓库，不做隐式发现。
- 仓库必须在 workspace 根目录内且是 git 仓库；每仓独立安装本引擎，workspace 只读取各自的 `.agents/install-manifest.json`。
- `init` 幂等并保留 `createdAt`；`status` 不写盘，按路径重新聚合，仓库被删除时标记 `missingPath`。
- JSON 输出包含 `repos` 与 `summary`；非法仓库退出码 2，缺少 workspace 清单退出码 3。

## Spec / Tasks / Verify 工件

安装后 `workflow/specs/_TEMPLATE/` 提供目录化的三件套，供需要可审计证据链的团队使用：

| 文件 | 作用 |
|---|---|
| `spec.md` | 背景、目标、非目标、`## 验收标准`、约束与风险 |
| `tasks.md` | 与验收标准对应的勾选任务，至少一条 `- [ ]` |
| `verify-report.md` | `## 结果`、`## 证据`，以及 `结论: pass\|fail\|partial` |

每个需求建 `workflow/specs/<name>/` 并复制模板；`flow-kit run check-spec-packages [--root <dir>] [--json]` 校验缺件、缺节与无法识别的结论。脚本默认只检查以 `_` 开头的模板目录之外的包，可独立接入 CI / verify。

评测证据另有版本化输出：`agent-eval record` 在写 `.agents/evals/results.jsonl` 的同时生成 `.agents/evals/eval-log.json`（`version: 1`、阈值、结果、证据签名，schema：`schemas/eval-log.schema.json`），便于外部评估平台消费。`--no-eval-log` 关闭，`--eval-log <path>` 指定路径。

## 宿主

v1 支持 10 个现行宿主：

| 宿主 | 命令 | 子代理 | 技能 | hooks | 模型注入 |
|---|---|---|---|---|---|
| `trae` | `.trae/commands/` | `.trae/agents/*.md` | index → `wf-skills` | `hooks.json` | 否 |
| `codebuddy` | `.codebuddy/commands/` | `.codebuddy/agents/*.md` | native `.codebuddy/skills/<name>/SKILL.md` | `settings.json` | 否 |
| `claude` | `.claude/commands/` | `.claude/agents/*.md`（`model`） | native `.claude/skills/<name>/SKILL.md` | `settings.json` | 是（`inherit` / 别名） |
| `opencode` | `.opencode/commands/` | `.opencode/agents/*.md`（`model`） | native `.opencode/skills/<name>/SKILL.md` | 插件式（保持现状） | 是（省略 = 继承） |
| `qwen` | `.qwen/commands/` | `.qwen/agents/*.md`（`model`） | shared `.agents/skills`（不复制） | `settings.json` | 是（`inherit`） |
| `pi` | 无 | `.pi/agents/*.md`（`model`） | index → `.pi/SKILLS.md` | `extensions/` | 是（网关 ID，无 `inherit`） |
| `cline` | `.cline/workflows/` | `.cline/agents/*.yml` | index → `wf-skills` | `hooks/` 适配器 | 否 |
| `commandcode` | `.commandcode/commands/` | `.commandcode/agents/*.md`（`model`） | shared `.agents/skills`（不复制） | `settings.json` | 是（`inherit`） |
| `qoder` | `.qoder/commands/` | `.qoder/agents/*.md` | index → `wf-skills` | `settings.json` | 否 |
| `zcode` | `.zcode/workflows/*.dwf.ts` | `.zcode/agents/*.md` | index → `wf-skills` | `config.json` | 否 |

宿主壳全部是指针壳：正文权威仍在 `.agents/commands/`、`.agents/roles/`、`.agents/skills/`，安装器不复制正文，避免双源漂移。

技能安装分三种模式（由注册表 `skills.mode` 驱动）：

- **native**：宿主会自行发现 `<宿主目录>/skills/<name>/SKILL.md`。安装器按 `.agents/skills/*/SKILL.md` 的语言覆盖后内容动态生成指针壳（原生 frontmatter + 指向权威正文），不手写 22 × N 份静态副本。
- **shared**：宿主原生读取 `.agents/skills`（Qwen、Command Code）。不生成宿主技能副本，只生成 `wf-skills` 索引入口。
- **index**：无法确认原生技能目录的宿主生成一个索引（有命令目录时是 `wf-skills.md`，否则是 `SKILLS.md`），逐行列出技能名、描述与 `.agents/skills/<name>/SKILL.md` 路径。

### 技能包来源与准入（R3-4）

`flow-kit add-skill` 支持三种来源，默认离线：

```bash
flow-kit add-skill ./skills/my-skill                 # 本地目录（含 SKILL.md）
flow-kit add-skill https://github.com/org/repo.git --ref v1.2.0 --subdir skills/x --allow-network
flow-kit add-skill @scope/pkg@1.0.0 --allow-network    # npm（npm install --no-save 取包）
```

- 技能正文落到 `.agents/skills/<name>/`；来源、版本、校验和与逐文件哈希落 `.agents/skills.lock.json`（schema：`schemas/skills-lock.schema.json`）。
- manifest 的 `skills` 段记录同一份来源与校验和（`category: skill`），用于升级/移除；宿主技能面（指针/索引）由安装器按磁盘技能动态重生成。
- 准入规则：`SKILL.md` 必须有 frontmatter 与 `name` / `description`，name 为 kebab-case 且与目录一致，描述 ≤ 300 字符；可选 `triggers` 不得跨技能冲突，`evalTasks` 必须引用 `.agents/evals/tasks.tsv` 中的任务。
- `--update` 升级已登记技能；直接覆盖用户改动的技能需要 `--force`；`remove-skill` 按 manifest 哈希拒绝删除用户改动文件（`--force` 覆盖）。
- `flow-kit skills lint` 全量检查并报告 lockfile 漂移；`agent-eval record --skill <name>` 落技能粒度凭证，`agent-eval status` 聚合各技能最新通过率。

### 外部宿主插件

不重发版也能接入新宿主。定义是 JSON（schema：`schemas/host.schema.json`），放置位置按优先级从低到高：

1. 内置注册表（`src/hosts/registry.mjs`）
2. 用户级 `~/.flow-kit/hosts/*.json`
3. 项目级 `<target>/.flow-kit/hosts/*.json`
4. `--host-manifest <file>`（可重复）

同名定义后者覆盖前者。静态 command / agent 文件放在与 JSON 同名的兄弟目录（如 `.flow-kit/hosts/myhost/commands/*.md`），或用 `templates` 指向别处；技能索引/指针仍由 `.agents/skills` 动态生成，可用 `skillMeta` 指向自带模板目录。`mcp` 字段声明后，中性 server 列表会按 `claude` / `opencode` 格式合并进该宿主的配置文件。接线命令统一用 `command.form: "cli"`（模板 `flow-kit hook {hook}`）。

`flow-kit new-host <name>` 直接生成上述完整插件（命令指针壳、子代理壳、技能入口模板，可选 `--hooks` / `--permissions` / `--mcp`）；生成即通过 `validateHostDefinition` 自校验，安装后 `doctor` 可对账 hooks / permissions / MCP。

```json
{
  "name": "myhost",
  "dir": ".myhost",
  "label": "My Host",
  "commands": { "dir": "commands", "ext": ".md" },
  "agents": { "dir": "agents", "ext": ".md", "modelField": null, "inheritValue": null },
  "skills": { "mode": "index" },
  "hooks": null
}
```

字段缺失、目录非法、枚举越界、未知键都会在加载时以退出码 2 报出具体字段；`doctor` 会标注每个已安装宿主的定义来源（`builtin` / `user` / `project` / `cli`）。

## Hook 接线

Hook 不再按宿主各维护一份静态壳。中性规格在 `.agents/hooks/gates.json` 的 `hooks` 数组（事件、`write`/`shell` 工具类别、脚本、超时），安装器按注册表 `hooks.events` 编译成宿主 schema，并幂等合并进宿主配置：

| 宿主 | 文件 | 形态 |
|---|---|---|
| `claude` / `codebuddy` / `qwen` / `trae` / `commandcode` | 各自配置 | `flow-kit hook <id>` 命令字符串 |
| `qoder` | `settings.json` | `command: flow-kit` + `args: ["hook", "<id>"]` + `name` / `statusMessage` |
| `zcode` | `config.json` | `hooks.events`，条目带 `enabled` |

合并只替换托管 hook 条目（`flow-kit hook <id>` 或旧版 `.agents/hooks/*.cjs` 路径，用于接管旧安装）：用户自建 hook、其它事件、`permissions` 等其余键原样保留；重复安装不会重复追加，过期接线（错误 matcher）会被清理。Gate 实现随包分发，项目内只保留声明与配置。Qwen 的 `settings.json` 同时承载 hooks 与 MCP，两个合并器对同一份 JSON 组合执行。`opencode` / `pi` / `cline` 没有 `hooks.events`，继续使用静态模板，行为不变；外部宿主也可在宿主定义的 `hooks.events` 中接入同一编译器。`doctor` 以 `gates.json` 为期望值检查缺失 / 多余接线。

## 权限编译

权限与 Hook 同源：`.agents/hooks/gates.json` 的 `allow` / `deny` / `ask`（`tool` 为 `shell` / `read` / `web`）编译进宿主 `permissions` 数组；`hardened` 段是 enterprise 档的追加项（凭据读拒绝、禁 `WebFetch` / `curl` / `wget`）。`--hardened` 走同一个编译器，Claude 的 `settings.hardened.json` 只保留 `sandbox`、`allowManagedPermissionRulesOnly` 等 managed-only 键，权限数组由 gates 生成。

| 宿主 | 语法 | tool 类别 |
|---|---|---|
| `claude` / `qoder` | `Bash(cmd:*)` | shell / read / web |
| `qwen` | `Bash(cmd *)` | shell |
| `commandcode` | `Shell(cmd *)` | shell |

权限数组按“托管条目”合并：安装/升级只替换 manifest 记录的上次编译项，用户自建 allow/deny/ask 条目保留；重复安装幂等。栈相关白名单（`dotnet build`、`cargo test` 等）由栈配置自动追加。宿主不支持声明的 `tool` 类别时降级跳过，`doctor` 给出 `permissions <host> unsupported` 告警；没有权限能力的宿主（codebuddy / trae / zcode 等）得到 `guarantee <host>` advisory，不静默丢弃。`doctor` 还会对账权限数组：缺失编译项或残留已废弃托管项都会报出，用户自建条目不误报。

## 企业档加固矩阵

`--tier enterprise` / `--hardened` 按宿主实际能力分级加固，不再是 Claude 专属：

| 能力级别 | 宿主 | 企业档行为 |
|---|---|---|
| `managed` | `claude` | 替换 `settings.hardened.json`（sandbox、managed-only 权限 / hooks / MCP 键）+ gates.json 硬化权限 |
| `permissions` | `qwen` / `qoder` / `commandcode` | gates.json `hardened` 权限项（凭据读、网络命令）编译进 `permissions` |
| `hooks` | `codebuddy` / `trae` / `zcode` | 仅命令门禁 hook，无权限面 → 计入缺口 |
| `none` | `opencode` / `pi` / `cline` | 无可配置加固面 → 计入缺口 |

配置能力由注册表 `hardening.level` / `hardening.settings` 声明，外部宿主同样可声明；加固配置作为宿主主配置的替换源，不独立安装。`manifest.enterprise` 记录 `posture`、每个宿主的实际级别、`gaps`、`proofChain` 与 `policyChecks`。`doctor` 展示档位 / 姿态 / 宿主矩阵 / 缺口，并核对证明链（agent-eval、outcome-metrics、pipeline-state）与策略面（`.githooks`、CI、权限编译）；缺口以 advisory 呈现，默认 `standard` 档不产生该字段，行为不变。

## MCP 接线

安装器把中性 server 声明编译进各宿主的原生 MCP 配置，安装期不联网，只写配置：

| 宿主 | 文件 | 容器 / 形态 |
|---|---|---|
| `claude` | `.mcp.json` | `mcpServers` |
| `opencode` | `opencode.json` | `mcp`，`type: local/remote`、`command` 数组、`environment` |
| `qwen` | `.qwen/settings.json` | `mcpServers`（与 hooks / permissions 同文件合并） |

默认声明在 `templates/mcp/servers.json`，项目可用 `.flow-kit/mcp/servers.json` 整体替换（同为 `{"servers": {...}}`）。每个 server 支持 `command` + `args` + `env`，或远程 `url` + `headers`。

合并是幂等的：只补缺失的同名 server，保留用户自建 server 与文件中的其它键（如 `permissions`）；重复安装/升级不会重排或覆盖既有内容。远程 server 按宿主 schema 生成：Claude / Qwen 写 `type: http`（可用 `type: sse` 覆盖），OpenCode 写 `type: remote`。卸载时按 manifest 记录的 server 名摘除托管条目，用户内容保留；只有本工具创建且未被改动的文件才整文件删除（`manifest.mergeOrigins`）。`doctor` 校验配置文件存在、JSON 合法、容器与 server 齐全。`--no-mcp` 完全跳过接线，并把选择写入 manifest 供 `upgrade` 重放。

默认声明带一个只读本地 server `flow-kit-wiki`（`flow-kit run wiki-mcp`），提供 `wiki_search` 工具检索 `wiki/` 与 `.agents/`；不联网、不写盘。

## 模型配置

安装器按三个角色为子代理选模型：

| 角色 | 用途 | 典型分工 |
|---|---|---|
| `code` | 实现 / 改代码 | 低成本、高吞吐（如 `haiku` / `sonnet`） |
| `judgment` | 判断 / 规划 / 仲裁 | 强推理（如 `opus`） |
| `review` | 独立复核 | 强推理，且建议与 `code` 不同 |

解析优先级（高 → 低）：

1. CLI `--model [host:]role=<id>`
2. TUI 交互选择
3. 已存在的 `.agents/config/model-roles.local.json`（宿主级 > 角色级）
4. 探测 + 内置推荐
5. 宿主 `inherit`

探测来源：

- 宿主配置：如 `~/.claude/settings.json`、`~/.qwen/settings.json`（JSONC 容错）。
- 环境变量：如 `ANTHROPIC_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`、`QWEN_MODEL`。
- 只读 CLI：仅注册表中声明且已核实的命令（当前为 Command Code 的 `--list-models`）；默认不执行，交互安装或 `--probe-models` 才启用，1.5s 超时，失败静默。
- 内置推荐：只写已核实的别名（当前仅 Claude 的 `sonnet` / `haiku` / `opus`），不合成未知模型 ID。

解析结果写入 `.agents/config/model-roles.local.json`（用户所有，不进 manifest、升级不覆盖）；宿主子代理的 `model` 字段在渲染与语言覆盖之后注入，manifest 哈希记录最终文本。升级时若本地配置缺失（例如被 gitignore 后换机），会从已安装子代理的 `model` 字段回收，避免把用户已配置的模型静默改回 `inherit`。仅注册表声明了 `agents.modelField` 的宿主会注入；其余宿主只在输出与本地配置中记录角色模型，并提示该宿主不支持按角色指定子代理模型。

`review` 与 `code` 解析为同一模型时给出 `REVIEW_SAME_AS_CODE` 警告（不阻断安装）；`doctor` 也会对现有配置做同样提示；本地配置与已安装子代理的 `model` 字段不一致时，doctor 报 `model drift`，要求先按 `.agents/skills/model-upgrade/SKILL.md` 评测再升级。

## 治理、评测与记忆

安装后的引擎在静态门之外还带一层 AI-Native 治理面（全部零依赖）：

| 面 | 入口 | 作用 |
|---|---|---|
| 行为评测 | `flow-kit run agent-eval` + `.agents/skills/eval/` | 技能/命令/角色/模型变更后，用固定任务集跑 A/B，凭证绑定“评测敏感面”的内容签名；CI 先 `--advisory`，稳定后转硬门 |
| 测试不可弱化 | `flow-kit hook pre-write-check` §2.5 + `flow-kit run fix-task` | 修复窗口内禁改既有测试；新建复现测试放行；`TEST-GUARD-ALLOW:` 留逃生口 |
| 离线梦境 | `flow-kit run dream-run` | 归档、索引、主张依据、**经验回放**、**记忆表示**、**注入层预算**、结果指标 |
| 经验日志 | `flow-kit run session-log` | 记录 failure/correction/refusal，供 dreaming 对照纠错 |
| 记忆表示 | `flow-kit run memory-wiki` | 从 claims/incidents/session-logs 生成 `wiki/_memory/` 链接地图 |
| 注入层预算 | `flow-kit run memory-tier` | 200 行 / 25KB 上限；只出上浮候选，不自动改 |
| 记忆生命周期 | `flow-kit run memory-lifecycle.mjs` | 提升 / 衰减 / 冲突消解 / 跨仓联邦 / 统一查询 / 命中率审计；只维护注入层 `memory:auto` 标记块 |
| 单写者租约 | `flow-kit run path-lease` | 并行 agent 写同一页面前加租约，防共享页丢事实 |
| 结果指标 | `flow-kit run outcome-metrics` | 首次过门率、复核采纳率、逃逸缺陷、评测通过率、返工占比 |
| 成本与延迟 | `flow-kit run usage-log` + `observability` | 按 run / 角色 / 模型的 token、成本、延迟；模型质量时间线；导出 Prometheus / OTLP JSON |
| 闭环执行器 | `flow-kit run pipeline-run.mjs` | 六阶段状态机；断点续跑（inFlight + resume）、verify 门重试预算、并行门分支、阶段产物契约 |
| 闭环状态机 | `flow-kit run check-pipeline-state` | stage/stopType 闭包检查；静态检查不能替代真实端到端 run |
| 策略即代码 | `.agents/config/policy.json` + `flow-kit run policy` | 双向核对机制台账、预算、枚举闭集与角色/模型引用；`check` 失败非零，`explain` 输出人类视图 |
| 安装证明链 | `flow-kit doctor --attest --out <file>` | manifest / files / policy / eval / git 五段 sha256 链；篡改可检出，输出确定、可归档 |

`--tier standard`（默认）会生成 `azure-pipelines.yml` 与 `.github/workflows/ci.yml`，在 `verify --full` 之后跑上述 advisory 检查；`lean` 不生成 CI，`enterprise` 另装加固配置。未完成项与验收口径见 [BACKLOG.md](BACKLOG.md)。

### 可观测与成本

`observability` 只聚合已有台账，不造数：pipeline run 事件流给 run/阶段延迟，verify 凭证给通过率与逐门耗时，`eval-log.json` 给模型质量时间线，`usage-log` 给角色/模型 token 与成本，复核产物给 verifier 投票分布。

```bash
# 记录一次子代理调用的凭据（拿不到的字段就不写）
flow-kit run usage-log append --role verifier --model <id> \
  --input-tokens 1200 --output-tokens 300 --latency-ms 4200 --outcome pass --run <runId>

flow-kit run observability                          # Markdown（stdout）
flow-kit run observability --json --out workflow/metrics/observability.json
flow-kit run observability --baseline workflow/metrics/observability-old.json   # 对比两个版本
flow-kit run observability --format prom --out metrics.prom                     # Prometheus 文本
flow-kit run observability --format otel --out metrics.json                     # OTLP JSON（无 SDK）
```

口径由 `.agents/config/observability.json` 控制（schema：`schemas/observability.schema.json`）：`windowDays`、回归阈值 `regression.passRateDrop`、导出前缀 / service name、可选 `pricing`（每百万 token）。成本只在行内 `costUsd` 或价格表可换算时计入，缺 token/价格的调用记 `unpricedCalls`，不按 0 计费；缺源在报告末尾单列。报告 JSON 去掉 `generatedAt` 后与输入一一对应，可直接重算，`--baseline` 即依赖这一点。

### 记忆生命周期

`memory-lifecycle` 把记忆从“只读建议”变成可运营的状态机（记录在 `.agents/memory/records.jsonl`，迁移审计在 `.agents/memory/audit.jsonl`）：

- **状态迁移确定性**：`candidate → active → dormant → retired`；命中次数达到 `promotion.minUses` 才上浮，闲置超过 `decay.dormantAfterDays` / `retireAfterDays` 自动降级；`retired` / `superseded` 是终态。
- **冲突消解**：同 key、不同文本按“来源权威 rank → 时间新者 → id 小者”裁决，败者置 `superseded` 并记录 `supersededBy`；审计保留双方来源。
- **注入层只改托管块**：`promote` 只替换 `injected-memory.md` 中 `memory:auto:begin/end` 标记块，块外手写内容不受影响；写前用 `memory-tiers.json` 的 200 行 / 25KB 预算预检，超限拒绝写入。
- **统一查询与命中率**：`query` 同时检索记忆记录、claims、incidents、papercuts 与联邦仓库（只读），结果带来源；每次查询写入 `.agents/cache/memory-hits.jsonl`，`report` 据此算查询命中率与逐条命中。

```bash
flow-kit run memory-lifecycle.mjs add --text "先复现失败测试再修" --kind session-log --ref session-logs/2026-05-01.jsonl
flow-kit run memory-lifecycle.mjs query "缓存" --limit 10      # 统一检索（自动记命中）
flow-kit run memory-lifecycle.mjs decay                       # 衰减迁移
flow-kit run memory-lifecycle.mjs conflict                    # 冲突消解
flow-kit run memory-lifecycle.mjs promote --from-suggest      # 上浮到注入层托管块
flow-kit run memory-lifecycle.mjs cycle                       # decay → conflict → promote
flow-kit run memory-lifecycle.mjs report --check --out tmp/memory-audit.md   # 审计；预算/块陈旧/未消解冲突时退出 1
flow-kit run memory-lifecycle.mjs query "约定" --roots ../other-repo          # 跨仓联邦（只读）
```

口径由 `.agents/config/memory-lifecycle.json` 控制（schema：`schemas/memory-lifecycle.schema.json`）：存储/审计/命中路径、托管块标记、上浮阈值、衰减窗口、来源权威顺序、联邦仓库与默认返回条数。`report --json` 的 `records` 每行带 `source` / `refs`，可直接追溯；CI 以 advisory 方式跑 `report --check`。

### 策略即代码

`policy.json` 是策略面的机器可读索引，不复制各配置的业务内容：

```bash
flow-kit run policy check            # 校验；问题退出 1
flow-kit run policy check --json     # 机器可读输出
flow-kit run policy explain          # 当前生效策略视图
flow-kit run gen-effective-policy    # 重生成 workflow/effective-policy.md
flow-kit upgrade --explain-policy --dry-run      # 只读输出升级将带来的策略差异
```

- `mechanisms.required` 与 `mechanism-registry.md` **双向一致**：policy 引用未登记机制、或台账新增行未登记到 policy 都会失败。
- 预算由 `rule-budget.mjs --all` 复用执法，墙钟预算核对 `gate-budgets.json` 与策略上限。
- 枚举闭集覆盖 `workflow-enums.txt` 与 `pipeline.json` 的 stage/stopType；角色/模型引用覆盖 `model-roles.json`、`pr-review.json` 与本地覆盖。
- 根仓库 CI 用 `npm run policy:check` 在临时目标安装后跑 `check` 与 `effective-policy --check`。
- `upgrade --explain-policy` 按同一策略面做语义 diff：门禁接线、预算、枚举、角色/模型引用；无变化时人类输出为空，`--json` 的 `policyDiff.changed` 为 `false`。

### 安装证明链

```bash
flow-kit doctor --target <dir> --attest --out attest.json
flow-kit doctor --target <dir> --attest --json    # 证明对象随 JSON 返回
```

证明由 `manifest` / `files` / `policy` / `evals` / `git` 五段摘要串联成 `root`：

- 托管文件缺失或哈希不符时 `ok:false`，doctor 退出 1，证明仍会归档问题清单；
- 不包含时间戳或绝对路径，同一状态重复生成字节一致；
- 目标在 git 仓库内时绑定 `HEAD` 与 dirty 状态，便于把证明对应到提交；
- 信任模型是“归档后重生成比对 root”；第三方签名可在归档侧对 JSON 完成。

## 模板 / Profile / State 三层

| 层 | 位置 | 内容 |
|---|---|---|
| engine | `templates/engine/` | `.agents/` 通用引擎（commands / skills / roles / hooks / scripts / config / pipelines / tests / board / notes） |
| profile | `templates/profiles/<stack>/` | 栈相关 `AGENTS.md`。栈：`dotnet` / `node` / `typescript` / `rust` / `go` / `java` / `empty` |
| surface | `templates/surfaces/<surface>/` | 可叠加切面：`frontend` / `api` / `data`；与 stack 同层（优先级 21+），不改单 stack 的产物 |
| scaffold | `templates/scaffold/` | `wiki/` 目录骨架 + INDEX + 看板；`workflow/` 状态机骨架 + 空台账 + `_TEMPLATE.md` |
| git | `templates/git/` | `.githooks/` 五钩子、`.gitattributes` 合并块、`.gitignore` 运行态块 |
| host-meta | `templates/host-meta/` | 宿主原生技能指针 / 技能索引模板；按能力动态生成，不参与 `templates/hosts/` 静态枚举 |
| locale | `locales/<lang>/overrides/` | 按目标路径镜像的语言覆盖；缺省回退模板 |

运行态（`cache/`、`tmp/`、`*.jsonl` 台账、`confirmations.d/`、`workflow/archive`、`.agents/tools/`）不打包，由引擎在装户内产生。

### 组合式 profile

`--stack` 保持单选基底，`--surface` 叠加闭集切面，两者也可合并写：`--stack dotnet+frontend --surface api`。

- 闭集：`frontend` / `api` / `data`（未知 surface 退出码 2）。
- 合并顺序：engine → stack profile → surfaces（按声明顺序）；同一目标路径**后声明者覆盖**（surface 优先级 21+，stack 为 20）。
- 只有存在 surface 时才生成 `.agents/config/profile.json`（记录 `stack` / `surfaces` / `profiles`），单 stack 安装的产物与行为完全不变。
- `manifest.surfaces` 记录组合；`upgrade` / `add-host` 重放，`adopt` 从 `profile.json` 恢复，`doctor` 校验凭证与 manifest 一致。
- 注意：`typescript` 是栈而不是 surface；dotnet 后端 + TS 前端用 `--stack dotnet+frontend`。

## 冲突与升级

- 目标文件不存在 → 创建。
- 目标文件存在且哈希等于 manifest → 更新。
- 目标文件存在但哈希不等于 manifest（装后被改）：
  - 有基线且模板确有变化 → 以基线为 base、磁盘为 ours、新模板为 theirs 调用 `git merge-file` 三方合并；无冲突自动写回，冲突写冲突标记并计入 `conflict`（`--strict` 退出 1）。
  - 无基线、二进制或模板未变 → 冲突跳过；`--force` 覆盖。
- 目标文件存在且不在 manifest（非本工具安装）→ 跳过；`--force` 覆盖。
- `.gitattributes` / `.gitignore` 用带标记的合并块，重复执行不会重复追加。

基线保存在 `.agents/.kit/baseline/`，内容为上次安装的文本，默认被 `.gitignore` 忽略；`--no-baseline` 关闭，`--baseline` 可在旧安装上重新开启，`upgrade` 重放 manifest 中的选择。基线不参与 manifest 哈希；`prune --baseline` 清理无主基线，`doctor` 报告基线与无主项。

manifest 带 `schemaVersion`（当前为 1）。`upgrade` 在生成计划前按 `migrations/<from>-<to>.mjs` 顺序迁移旧 manifest：全部步骤成功才写盘，失败零写入；`--dry-run` 只报告将执行的迁移，`--json` 输出 `migration` 字段。迁移只转换 manifest 元数据，不触碰目标文件；版本高于当前工具支持时拒绝升级。

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
  4. `verify.mjs`：按 `engine.json options.stack` 过滤 dotnet/Vue 专用 product 门；`node`/`typescript` 在 `package.json` 有 `test` 脚本时追加 `npm test`，`rust` 追加 `cargo test`，`go` 追加 `go test ./...`，`java` 按 `pom.xml` 或 Gradle 追加测试门；
  5. `.githooks/pre-push`：宿主接线面扩到 10 宿主；
  6. `.agents/board/dev-tour.html`：项目名改为 `{{projectName}}` 占位；
  7. `check-ledger-invariant.mjs`：本仓历史基线哈希在新仓解析不出时按无基线处理，避免装户报警。
- `verify-ui/features/` 是装户业务特性地图，只保留空目录占位，不随通用引擎打包。

本仓迁移策略：先保留现行 `.agents`/`.githooks`/宿主目录；其他项目安装验证完成后，再在本仓卸载现行引擎并安装本工具（届时用 `--force` 采用现有文件）。

## 开发

```bash
node tools/extract-from-project.mjs --project 项目目录   # 重新提取模板（一次性迁移工具）
node tools/make-en-host-overrides.mjs                                     # 重新生成英文宿主指针壳
node tools/make-en-host-overrides.mjs --check                             # 检查英文覆盖缺失/过期/孤儿（CI 失败）
node tools/lint-templates.mjs                                             # 模板 lint：frontmatter / i18n / 运行态污染 / 渲染矩阵 / 引用可解析
node tools/new-host.mjs myhost --hooks --permissions                      # 生成宿主插件（等价于 flow-kit new-host）
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

## 许可证

[MIT](LICENSE) © dc
