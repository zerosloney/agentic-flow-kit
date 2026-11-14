# 能力扩展路线图（Roadmap）

> 基线：`v2.1.0`（10 宿主、tier/hardened、模型注入、manifest 收敛）。
> 定位：本文件记录**新增能力**的规划与验收；已识别的缺口修复仍归 `BACKLOG.md`，两者不重复。
> 约束：Node ≥ 22、ESM、零运行时依赖；宿主能力只经 `src/hosts/registry.mjs`；安装器负责生成/收敛/解释，运行态能力进 `templates/engine`。
> 状态：`TODO` / `WIP` / `DONE`。完成一项须在同一提交更新本文件并补测试。
> 规模：`S` ≤ 0.5 人日，`M` 0.5–2 人日，`L` > 2 人日（单人估算，含测试与文档）。

## 1. 设计原则

1. **manifest 是唯一账本**：任何“新增/升级/删除/接管”都以 `.agents/install-manifest.json` 为准，不做目录猜测。
2. **registry 是宿主能力唯一来源**：不在 `plan.mjs` / `doctor.mjs` 里为单个宿主写分支。
3. **安装器与运行态分层**：安装器只负责生成、收敛、解释；运行态脚本随包分发（`flow-kit run` / `flow-kit hook`），项目只落 agent 可识别的声明式面（技能、子代理、命令、MCP 与 hooks 配置）。
4. **新能力必须可检查**：能被 `doctor` 或 `verify` 发现缺失、漂移或降级，否则不算完成。
5. **门禁面先登记**：进入硬门禁的能力须写 `.agents/config/mechanism-registry.md`，并遵守 `rule-budgets` 的一进一出。

## 2. 能力地图

| 编号 | 能力 | 波次 | 规模 | 主要落点 | 状态 |
|---|---|---|---|---|---|
| R1-1 | `diff` / `status` 漂移视图 | 1 | M | `src/commands/diff.mjs` | DONE · [#3](https://github.com/zerosloney/agentic-flow-kit/issues/3) |
| R1-2 | `prune` 清理僵尸文件 | 1 | S | `src/install/apply.mjs` / 新命令 | DONE · [#2](https://github.com/zerosloney/agentic-flow-kit/issues/2) |
| R1-3 | `remove-host` / `uninstall` | 1 | M | `src/commands/remove-host.mjs` | DONE · [#4](https://github.com/zerosloney/agentic-flow-kit/issues/4) |
| R1-4 | `--json` 与退出码契约 | 1 | M | `src/cli/main.mjs`、各命令 | DONE · [#5](https://github.com/zerosloney/agentic-flow-kit/issues/5) |
| R1-5 | `explain <targetRel>` 来源解释 | 1 | S | `src/commands/explain.mjs` | DONE · [#6](https://github.com/zerosloney/agentic-flow-kit/issues/6) |
| R2-1 | 基线留存 + 三方合并 | 2 | L | `src/install/baseline.mjs`、`apply.mjs` | DONE · [#8](https://github.com/zerosloney/agentic-flow-kit/issues/8) |
| R2-2 | `adopt` 接管已有安装 | 2 | M | `src/commands/adopt.mjs`、`tools/parity-report.mjs` | DONE · [#9](https://github.com/zerosloney/agentic-flow-kit/issues/9) |
| R2-3 | 外部宿主插件 | 2 | M | `schemas/host.schema.json`、`registry.mjs` | DONE · [#10](https://github.com/zerosloney/agentic-flow-kit/issues/10) |
| R2-4 | Hook 编译器 | 2 | L | 中性 hook 规格 + 宿主序列化器 | DONE · [#11](https://github.com/zerosloney/agentic-flow-kit/issues/11) |
| R2-5 | MCP 接线 | 2 | M | registry `mcp` 字段、`templates/mcp/` | DONE · [#12](https://github.com/zerosloney/agentic-flow-kit/issues/12) |
| R2-6 | 权限 / 工具白名单编译 | 2 | M | 复用 `gates.json` 与 hardened 路径 | DONE · [#13](https://github.com/zerosloney/agentic-flow-kit/issues/13) |
| R2-7 | 宿主探测 `--auto-hosts` | 2 | S | `src/commands/install.mjs`、TUI | DONE · [#14](https://github.com/zerosloney/agentic-flow-kit/issues/14) |
| R2-8 | 组合式 profile | 2 | M | `src/install/plan.mjs`、`schemas/project-profile.schema.json` | DONE · [#15](https://github.com/zerosloney/agentic-flow-kit/issues/15) |
| R2-9 | 企业档宿主矩阵 | 2 | M | `templates/hosts/*`、`doctor` | DONE · [#16](https://github.com/zerosloney/agentic-flow-kit/issues/16) |
| R2-10 | i18n 覆盖一致性检查 | 2 | S | `tools/make-en-host-overrides.mjs --check` | DONE · [#17](https://github.com/zerosloney/agentic-flow-kit/issues/17) |
| R3-1 | policy-as-code | 3 | L | `templates/engine/.agents/config/policy.json` + `policy.mjs` | DONE |
| R3-2 | 升级策略影响面 | 3 | S | `doctor` / `upgrade --explain-policy` | DONE |
| R3-3 | 安装证明链 | 3 | M | manifest + eval 凭证 + 签名 | DONE |
| R3-4 | 技能包分发与准入 | 3 | L | `add-skill`、lockfile、`skills lint` | DONE |
| R3-5 | pipeline 真实执行器 | 3 | L | `templates/engine/.agents/scripts/pipeline-run.mjs` | DONE |
| R3-6 | 记忆生命周期 | 3 | L | `memory-tier.mjs` / `memory-wiki.mjs` / `memory-lifecycle.mjs` | DONE |
| R3-7 | 可观测与成本 | 3 | M | `outcome-metrics.mjs`、`metrics-core.mjs` | DONE |
| R3-8 | 沙箱与供应链 | 3 | L | devcontainer / MCP 权限 / SBOM | TODO |
| R3-9 | manifest 迁移框架 | 3 | M | `migrations/`、`manifest.schemaVersion` | DONE |
| R3-10 | `new-host` 生成器与模板 lint | 3 | M | `tools/new-host.mjs`、`npm run lint:templates` | DONE |
| R4-1 | 多仓 Workspace 协调 | 4 | M | `src/commands/workspace.mjs`、`.flow-kit/workspace.json` | DONE |
| R4-2 | Spec / Tasks / Verify 工件规范 | 4 | M | `templates/scaffold/workflow/specs/` + 校验脚本 | DONE |
| R4-3 | eval-log 证据格式 | 4 | S | `agent-eval.mjs`、`schemas/eval-log.schema.json` | DONE |
| R5-1 | 运行时能力包内化 | 5 | L | `src/commands/runtime.mjs`、`flow-kit run/hook`、安装面收缩 | DONE |

## 3. Wave 1 — 生命周期闭环

目标：让“装了之后”可观察、可清理、可自动化。全部基于现有 manifest，不改模板语义。

跟踪 issue：[#7](https://github.com/zerosloney/agentic-flow-kit/issues/7)。

### R1-1 `diff` / `status`（[#3](https://github.com/zerosloney/agentic-flow-kit/issues/3)）

- **现状**：`doctor` 检查 manifest 记录的文件是否存在，并以 advisory 报告 manifest 漂移；`upgrade` 直接重放；用户改动只能靠冲突行发现。
- **目标**：`flow-kit diff [--target] [--json]` 对每个路径输出五类之一：
  `unchanged` / `user-modified` / `kit-updated` / `orphan` / `missing`。`status` 给出宿主、档位、语言、栈、计数摘要。
- **落点**：新增 `src/commands/diff.mjs`；`src/cli/main.mjs` 注册；复用 `buildPlan` 与 manifest 哈希；文案进 `locales/*/installer.json`。
- **验收**：
  - 构造五类文件夹具，分类与计数正确；
  - `--json` 输出稳定字段，可直接被 CI 解析；
  - 只读，不写盘；
  - `tests/diff.test.mjs` 覆盖。
- **依赖**：无。规模 `M`。

### R1-2 `prune`（[#2](https://github.com/zerosloney/agentic-flow-kit/issues/2)）

- **现状**：`applyPlan` 的 `nextFiles` 从旧 manifest 复制（`src/install/apply.mjs:61`），模板下线或改名后旧文件永久留在账本和磁盘。
- **目标**：`flow-kit prune [--dry-run] [--force]` 删除“旧 manifest 有、当前计划无”的条目；仅当磁盘哈希等于 manifest 才自动删，用户改过则跳过并提示。
- **落点**：新增命令；复用 `applyPlan` 的哈希与冲突口径；删除后清理空目录。
- **验收**：模板下线夹具；用户改过的孤儿不被删除；连续执行两次结果一致。
- **依赖**：R1-1。规模 `S`。

### R1-3 `remove-host` / `uninstall`（[#4](https://github.com/zerosloney/agentic-flow-kit/issues/4)）

- **现状**：已实现。`remove-host` 按 manifest 哈希删除宿主面并保留根记忆文件；`uninstall` 清理全部托管文件与合并块；宿主集合变化后会收敛宿主相关渲染；`tests/remove-host.test.mjs` 覆盖隔离、恢复、用户修改与合并块。
- **目标**：
  - `remove-host --agent <name>`：删除该宿主 `category: host` 的文件，保留引擎/栈/其他宿主；
  - `uninstall`：删除全部托管文件；
  - 安全规则：哈希匹配才删；不匹配要求 `--force`；清理空目录；`.gitattributes` / `.gitignore` 的合并块仅在无其他宿主需要时移除；
  - `rootMemory`（如 `CLAUDE.md`）视为用户文件，默认保留。
- **落点**：新增 `src/commands/remove-host.mjs`；`manifest.hosts` 与 `files` 同步更新；TUI 增加入口。
- **验收**：`claude + trae` 安装后移除 trae，claude 面完整；重复安装可恢复；用户改过的 `CLAUDE.md` 不被删除。
- **依赖**：R1-2。规模 `M`。

### R1-4 `--json` 与退出码契约（[#5](https://github.com/zerosloney/agentic-flow-kit/issues/5)）

- **现状**：已实现。`src/cli/exit.mjs` 统一映射 `err.code`；`install` / `add-host` / `upgrade` 支持 `--json` 与 `--strict`；`diff` / `status` / `prune` / `explain` / `doctor` / `list-hosts` 支持 `--json`，`diff` / `status` / `prune` 支持 `--strict`；`tests/cli-contract.test.mjs` 覆盖全部退出码与 JSON 纯度。
- **目标**：
  - 所有命令支持 `--json`（建议最终单对象，或 `--json-stream` 输出 NDJSON 事件）；
  - 退出码：`0` 成功、`1` 冲突/严格模式漂移、`2` 用法错误、`3` 目标或 manifest 缺失、`4` 未知宿主、`5` IO 失败；
  - `--strict`：冲突或漂移时非零，供 CI 使用。
- **落点**：`src/cli/main.mjs` 统一错误码映射；各命令返回结构化结果；README 增加退出码表。
- **验收**：每个错误码有测试；TUI 路径不受影响；`--json` 不掺杂人类日志。
- **依赖**：R1-1。规模 `M`。

### R1-5 `explain <targetRel>`（[#6](https://github.com/zerosloney/agentic-flow-kit/issues/6)）

- **现状**：无法回答“这个文件为什么被安装、来自哪层”。
- **目标**：`flow-kit explain .claude/commands/wf-review.md` 输出：category、模板来源、语言覆盖、模型注入字段/角色/值、manifest 哈希与当前哈希。
- **落点**：新增 `src/commands/explain.mjs`；复用 `buildPlan` 条目的来源信息。
- **验收**：模板 / 覆盖 / 注入三种来源各有用例；未托管文件非零退出。
- **依赖**：R1-1。规模 `S`。

## 4. Wave 2 — 收敛与适配

目标：把“重放式升级”升级为“可合并升级”，把宿主支持从硬编码扩展为可插拔能力。

### R2-1 基线留存 + 三方合并

- **现状**：`src/install/baseline.mjs` 把文本直写文件的上次内容存到 `.agents/.kit/baseline/<targetRel>`（默认 gitignore、`--no-baseline` 关闭、`--baseline` 重启、upgrade 重放）；升级遇到用户改动且模板变化时用 `git merge-file` 三方合并：clean 写回并把基线更新为模板侧，conflict 写冲突标记、保留旧哈希、计入 `conflict`（`--strict` 退出 1）；二进制、无基线或 git 不可用回退哈希跳过。`manifest.baseline` / `baselineVersion` 记录状态且不参与哈希；`prune --baseline` 清理无主基线，`doctor` 报告基线数量与无主项。
- **目标**：
  - 对文本文件保存上次安装的完整内容到 `.agents/.kit/baseline/`（默认 gitignore，可 `--no-baseline` 关闭）；
  - 升级时若用户有改动，调用 `git merge-file` 做三方合并（base = baseline，ours = 磁盘，theirs = 新模板）；
  - 无冲突自动合并；有冲突写冲突标记并计入 `conflict`；二进制/非文本回退为哈希跳过；
  - `prune --baseline` 清理无主基线。
- **落点**：`src/install/baseline.mjs`；`apply.mjs` 写入/冲突分支；manifest `baseline` / `baselineVersion`。
- **验收**：用户改 A 段 + 模板改 B 段 → 自动合并；同段冲突 → 保留标记且 `--strict` 退出 1；基线不进 manifest 哈希。
- **风险**：基线含用户内容，必须 gitignore、可关闭、可清理。规模 `L`。

### R2-2 `adopt` 接管已有安装

- **现状**：`src/commands/adopt.mjs` 已接管现有安装：优先从 `engine.json` / 既有 manifest 还原宿主、栈、语言、档位与安装时间；按当前语言渲染逐文件比对，仅“完全一致”的文件写入 manifest；合并块只比对托管块；`workflow/INDEX.md` 按现状收录并登记 `derived`。已改动 / 缺失 / 未识别文件只报告不接管，`--dry-run` 零写入，重复执行幂等；无任何可接管文件且无既有 manifest 时退出 1。`tools/parity-report.mjs` 保留为一次性只读工具。
- **目标**：`flow-kit adopt [--dry-run]` 扫描现有树，对可识别文件按渲染结果打指纹并播种 manifest；未识别/已改动文件分类报告；之后 `upgrade` 可用。
- **落点**：产品化 `tools/parity-report.mjs` 为 `src/commands/adopt.mjs`；复用 `buildPlan`。
- **验收**：parity 夹具；`--dry-run` 零写入；连续 adopt 幂等；不覆盖用户文件。
- **依赖**：R1-1。规模 `M`。

### R2-3 外部宿主插件

- **现状**：`src/hosts/external.mjs` 在命令分派前加载用户级、项目级与 `--host-manifest` 定义，注册进同一 `HOSTS` 注册表并记录来源；`schemas/host.schema.json` 描述完整字段。静态模板默认取 JSON 同名兄弟目录（或 `templates` 字段），`plan` / `doctor` 统一解析；`doctor` / `list-hosts` 输出 `builtin` / `user` / `project` / `cli` 来源。非法定义以退出码 2 报字段级错误，内置 10 宿主行为不变。
- **目标**：支持 `.flow-kit/hosts/<name>.json` 与 `--host-manifest <file>`；新增 `schemas/host.schema.json`；优先级：项目 > 用户 > 内置；非法定义给出可操作错误。
- **落点**：`src/hosts/registry.mjs` 改为“内置 + 外部合并”；`doctor` 标注宿主来源。
- **验收**：自定义宿主可安装 command/agent/skill/index；schema 错误被拒绝；内置行为不变。
- **风险**：外部定义可能声明不存在的目录；registry 继续坚持“探测不到就留空，不编造”。规模 `M`。

### R2-4 Hook 编译器

- **现状**：`src/install/hooks.mjs` 读取 `.agents/hooks/gates.json` 的 `hooks` 中性规格（事件、`write`/`shell`、脚本、超时），按注册表 `hooks.events` 编译成 7 个已验证宿主的 schema，并幂等合并进其配置；只替换指向托管脚本的条目，用户自建 hook 与其它键保留。Qwen 的 hooks 与 MCP 对同一份 `settings.json` 组合执行。`opencode` / `pi` / `cline` 无 `hooks.events`，继续使用静态模板；外部宿主也可声明 `hooks.events` 接入。`doctor` 按规格检查缺失 / 多余接线；golden 夹具在 `tests/fixtures/hooks/`。
- **目标**：以 `.agents/hooks/gates.json` 为事件源，声明中性规格；按宿主 schema 编译并幂等合并进 settings/hooks 文件；保留静态模板作为逃生口。
- **落点**：`src/hosts/registry.mjs` 增加 `hooks.events` 映射；`src/install/hooks.mjs` 编译模块与 golden 测试。
- **验收**：首批 7 宿主 golden 输出；重复安装不重复追加；`doctor` 校验接线；现有模板迁移后语义不变。
- **风险**：宿主 schema 不稳定，先覆盖已验证宿主，其余回退静态模板。规模 `L`。

### R2-5 MCP 接线

- **现状**：`src/install/mcp.mjs` 把 `templates/mcp/servers.json`（项目可用 `.flow-kit/mcp/servers.json` 替换）编译进 Claude `.mcp.json`、OpenCode `opencode.json`、Qwen `.qwen/settings.json`；幂等合并、保留用户 server，`--no-mcp` 跳过并写入 manifest，`upgrade` 重放。卸载按 manifest 记录只摘托管 server；`doctor` 校验缺失 / JSON 损坏 / 容器与 server 齐全。默认声明带零依赖只读 `wiki-mcp` server（`wiki_search`）。
- **目标**：registry 增加 `mcp` 能力（文件、格式、scope、merge 策略）；`templates/mcp/servers.json` 为中性描述；编译到各宿主；`--no-mcp` 跳过；安装期不联网，只写配置。
- **落点**：`templates/mcp/`、registry、编译器、`doctor` 校验缺失/格式错误。
- **验收**：Claude / OpenCode / Qwen 夹具；幂等合并；用户已有 server 不被覆盖。
- **规模**：`M`。

### R2-6 权限 / 工具白名单编译

- **现状**：`src/install/permissions.mjs` 把 `gates.json` 的 `allow` / `deny` / `ask`（`shell` / `read` / `web`）按注册表 `permissions` 能力编译到 claude / qwen / qoder / commandcode 的 `permissions` 数组；`--hardened` 走同一编译器并追加 `hardened` 段（凭据读、`WebFetch`、`curl` / `wget`），Claude managed-only 键保持不变。权限数组按托管策略精确对齐，栈白名单自动追加；不支持的 `tool` 降级并进入 `unsupported`，`doctor` 对账缺失 / 多余项并对无权限能力的宿主给 advisory。
- **目标**：声明式权限（复用 `gates.json` 的 deny/ask 语义）编译到各宿主 settings；hardened 走同一编译器；`doctor` 报“声明了但宿主不支持”。
- **落点**：`src/install/permissions.mjs`；`gates.json` 增加 allow / hardened；`templates/hosts/claude/settings.hardened.json` 保持等价（权限数组由编译器覆盖）。
- **验收**：与 `gates.json` 对账一致；hardened 语义不变；不支持的能力降级告警。
- **依赖**：R2-4（共享编译器骨架）。规模 `M`。

### R2-7 宿主探测 `--auto-hosts`

- **现状**：已实现。`src/hosts/detect.mjs` 只读探测宿主目录与根级配置/记忆文件；`install --auto-hosts` 仅在未显式 `--agent` 时采用，探测为空报错；TUI 预选探测结果；`--json` 输出 `detectedHosts`。
- **目标**：扫描 `.claude/`、`.qwen/`、`.opencode/`、配置与锁文件，给出建议宿主；`--auto-hosts` 仅在显式开启时采用；TUI 预选。
- **验收**：10 宿主夹具；探测不到时给明确空结果；绝不静默安装。规模 `S`。

### R2-8 组合式 profile

- **现状**：`src/install/profiles.mjs` 定义闭集 `frontend` / `api` / `data`，支持 `--stack dotnet+frontend` 与可重复 `--surface`；plan 在 20 层后按声明顺序叠加（21+），同名文件后者覆盖；存在 surface 时生成 `.agents/config/profile.json` 并写入 `manifest.surfaces`。`upgrade` / `add-host` 重放、`adopt` 从凭证恢复、`doctor` 校验一致性；单 stack 产物不变。TUI 安装流提供可跳过多选。
- **目标**：支持 `stack + surface` 叠加（如 `dotnet+frontend`）；plan 优先级 20 内确定合并顺序；project-profile schema 扩展。
- **验收**：`dotnet + typescript` 夹具；同名文件冲突有确定规则；文档写明支持的 surface 闭集。
- **风险**：组合爆炸，先只支持 `frontend` / `api` / `data` 三个面。规模 `M`。

### R2-9 企业档宿主矩阵

- **现状**：`enterprise` / `--hardened` 按注册表 `hardening.level` 分级：claude = managed（settings.hardened.json + hardened 权限），qwen / qoder / commandcode = permissions（hardened 权限项），codebuddy / trae / zcode = hooks，opencode / pi / cline = none。`manifest.enterprise` 记录 posture、每宿主级别、缺口、证明链与策略面；`doctor` 展示档位 / 姿态 / 矩阵 / 缺口，并核对证明链（agent-eval / outcome-metrics / pipeline-state）与策略（githooks / CI / permissions）。默认 standard 档不写 enterprise 字段，行为不变。
- **目标**：为每个有配置能力的宿主提供加固等价物；enterprise 同时启用证明链与策略检查；manifest 记录实际启用的能力。
- **落点**：registry `hardening`、宿主快照夹具、`doctor` 档位 / 姿态 / 缺口输出。
- **验收**：每宿主快照；`doctor` 显示“档位 + 实际姿态 + 缺口”；不支持加固的宿主 advisory。
- **依赖**：R2-6。规模 `M`。

### R2-10 i18n 覆盖一致性检查

- **现状**：已实现。`--check [--json]` 报告缺失 / 过期 / 孤儿覆盖，`npm run check:i18n` 已接入 CI；生成与检查均按 LF 归一，Windows 检出不会误报。
- **目标**：增加 `--check`，报告缺失、过期、孤立覆盖；CI 失败。
- **验收**：故意制造漂移可失败；修复后通过。规模 `S`。

## 5. Wave 3 — 治理、分发与运行态

目标：把分散的治理配置收敛为可执行策略，把技能与运行态能力变成可分发、可评测的产品面。

### R3-1 policy-as-code

- **现状**：`steering.json`、`agent-eval.json`、`gate-budgets.json`、`mechanism-registry.md`、`pipeline.json`、`pr-review.json` 各自为政；机制登记与预算靠人工。
- **目标**：新增 `policy.json` + schema + `policy check|explain`，校验机制登记、预算、枚举闭集、角色/模型引用；生成 `effective-policy.md`；保留 Markdown 台账作为人类视图。
- **落点**：`templates/engine/.agents/config/policy.json`、`policy.mjs`、`mechanism-registry` 可解析化。
- **验收**：未登记机制被拒绝；预算超限非零；CI 作业；现有配置迁移后行为不变。
- **风险**：Markdown 台账是人工资产，先做“检查”而非“替换”。规模 `L`。
- **落地（2026-11-13）**：`policy.json` 只声明策略面路径、机制闭集、预算上限、枚举键与角色映射；`policy.mjs check` 双向核对 `mechanisms.required` 与 Markdown 台账、复用 `rule-budget.mjs --all` 执法预算、校验枚举/角色/模型引用；`explain` 与 `gen-effective-policy.mjs` 共用同一策略面视图；CI 新增 `npm run policy:check`（临时安装后跑 check + 生成器防漂移）。

### R3-2 升级策略影响面

- **目标**：`upgrade --explain-policy` 输出门禁、预算、角色、模型引用的 diff；无变化时输出为空。
- **依赖**：R3-1。规模 `S`。
- **落地（2026-11-13）**：`src/install/policy-diff.mjs` 按 `policy.json` 的策略面（gates / budgets / enums / roles / policy）对比磁盘与本次升级渲染文本，做语义差分；人类输出只在有变化时打印，`--json` 增加 `policyDiff`；`tests/policy-diff.test.mjs` 覆盖空 diff、角色/模型、门禁、预算与枚举。

### R3-3 安装证明链

- **目标**：manifest 哈希 + eval 凭证 + 策略版本组成哈希链；`doctor --attest --out <file>` 输出可归档证明；可选本地签名/绑定 git 提交。
- **验收**：篡改任一文件可检出；输出确定性；不依赖网络。
- **风险**：先定义信任模型（谁签、验什么），再实现。规模 `M`。
- **落地（2026-11-13）**：`src/install/attest.mjs` 生成 `flow-kit-attest/v1`（sha256-chain/v1）：manifest/files/policy/eval/git 五段摘要组成 root；`doctor --attest [--out <file>]` 输出证明并写入 `--json`，托管文件缺失/哈希不符即 `ok:false` 且 doctor 退出 1；证明不含时间戳、绝对路径与网络访问，可选绑定 `git HEAD` 与 dirty 状态；信任模型为“归档后重生成比对 root”，第三方签名可在归档侧完成。

### R3-4 技能包分发与准入

- **目标**：
  - `flow-kit add-skill <local|git|npm>`，生成 lockfile（来源、版本、校验和）；
  - manifest 增加 `category: skill`，支持 upgrade / remove；
  - `skills lint`：frontmatter 必填、name 唯一、触发词冲突、描述预算；
  - 每个技能可绑定 eval task，`agent-eval` 输出技能粒度通过率；
  - 默认离线，联网需显式 `--allow-network`。
- **验收**：安装/升级/移除全生命周期；校验和不匹配拒绝；评测凭证可按技能查询。
- **风险**：供应链安全，校验和与来源必须强制。规模 `L`。
- **落地（2026-11-14）**：
  - **来源**：`add-skill <local|git|npm>`；local 直接复制，git 走 `git clone --depth 1 [--ref|#ref]`，npm 走 `npm install --no-save`；git/npm 必须 `--allow-network`（默认离线）。`--subdir` 选择仓库内技能目录，`--name` 覆盖技能名。
  - **lockfile**：`.agents/skills.lock.json`（`schemas/skills-lock.schema.json`）记录来源/版本/包校验和/逐文件 sha256；校验和 = 排序后 `<rel>\0<sha256>\n` 的 sha256。manifest 增 `skills` 段（`category: skill`），并与 `files` 同步。
  - **生命周期**：`--update` 升级已登记技能；`remove-skill` 按 manifest 哈希拒绝删除用户改动（`--force` 覆盖），同时清理宿主指针与空目录、重放宿主面刷新索引。
  - **准入**：`skills lint` 校验 frontmatter 必填、name 唯一且匹配目录、描述 ≤ 300 字符、可选 `triggers` 冲突、`evalTasks` 引用、lockfile 漂移；`add-skill` 安装前对单个技能跑同一套规则。
  - **评测绑定**：`agent-eval record --skill <name>` 落技能粒度凭证（eval-log schema 增可选 `skill`），`agent-eval status` 输出各技能最新通过率。
  - **全新安装可用性并入**：`gitleaks` 基线随 `templates/git/.gitleaks-baseline.json` 安装；`workflow-modules.txt` 空词表不再校验模块枚举（pipeline-run / kb-search）；wiki 看板与 INDEX 口径对齐（忽略 `.gitkeep` 等点文件，模板计入 `数据维护/README.md`）；`check-secrets-lite` 工作树扫描改为「已跟踪 + 未跟踪未被忽略」，首装未提交基线也能过；`pipeline-run` 的 `changedFiles` 剔除 manifest 记录且哈希未变的安装产物，首次工单不再被「改动超出回填清单」误拦。

### R3-5 pipeline 真实执行器（引擎面）

- **目标**：在现有 `pipeline-run` 与静态闭包检查上补断点续跑、重试、并行分支、阶段产物契约校验。
- **验收**：小任务端到端跑通；kill 后可恢复；状态机静态检查仍通过。
- **边界**：只进 `templates/engine`，不进安装器。规模 `L`。
- **落地（2026-11-13）**：
  - **断点续跑**：门执行前写 `run.inFlight` 并落盘；`next` 自动从该门重入并记 `resume` 事件，新增 `resume` 子命令显式续跑（无断点时空操作退出 0）；`docsCommit` 以 HEAD 同主题提交判幂等，避免续跑重复提交。
  - **重试**：`next --retry <0-5>` 只作用于 verify 门，每次失败记 `retry` 事件；预算耗尽仍红才进修复环 / `gate-fail`，不跳过 `--files` 授权核对。
  - **并行分支**：`next --parallel "a.mjs,b.mjs"` 用 `spawn` 并发执行 verify 与附加门，任一非零即整体非零，事件带 `parallel` 组号；只接受门脚本名（拒绝路径）。
  - **阶段产物契约**：`.agents/config/pipeline.json` 新增 `stageArtifacts`（`{entry}/{spec}/{plan}` 占位），在阶段逻辑与门之前校验产物存在且非空；模板默认覆盖 `spec-confirm` / `plan-confirm` / `verify` / `closeout`。
  - **兼容**：`advance` 改异步以支持并发门；`check-pipeline-state` 闭包不变（无新增 stage / stopType）。
  - **测试**：`tests/pipeline-executor.test.mjs` 8 例——产物契约先于门、重试计数与事件、并行屏障证明真并发、并行失败传播、真实 kill 后 `inFlight` 与 `resume`、无断点空操作、静态闭包。

### R3-6 记忆生命周期（引擎面）

- **目标**：`memory-tier` / `memory-wiki` 之上补提升、衰减、冲突消解、跨仓联邦、统一 `memory query` 与命中率评测。
- **验收**：状态迁移确定性；审计报告可追溯来源；注入层预算不破。规模 `L`。
- **落地（2026-11-14）**：
  - `memory-lifecycle.mjs`：记录库 `.agents/memory/records.jsonl`（candidate / active / dormant / retired / superseded）+ 迁移审计 `.agents/memory/audit.jsonl`；`add` / `decay` / `conflict` / `promote` / `cycle` / `query` / `report` 子命令。
  - **状态机确定性**：`idle = now - max(lastHitAt, createdAt)` 是唯一时间输入；`candidate --hits>=promotion.minUses--> active`、`active --idle>dormantAfterDays--> dormant`、非终态 `--idle>retireAfterDays--> retired`、`dormant` 在窗口内再次命中回到 `active`；`retired` / `superseded` 终态。
  - **冲突消解**：同 key、不同文本按“来源权威 rank → createdAt 新者 → id 小者”裁决；败者 `superseded` + `supersededBy`，审计保留双方来源。id 用折叠后的 key+text，大小写/引号/空白差异不产生假冲突。
  - **注入层预算不破**：`promote` 只替换 `injected-memory.md` 的 `memory:auto:begin/end` 托管块（块外手写内容不动），写前用 `memory-tiers.json` 的 200 行 / 25KB 预检，超限拒绝写入且不落状态。
  - **统一查询与命中率**：`query` 同时检索记录、`workflow/claims.d`、`workflow/incidents`、`workflow/papercuts.d` 与联邦仓库（只读）；命中写入 `.agents/cache/memory-hits.jsonl` 并回写记录 `hits` / `lastHitAt`；`report` 输出查询命中率、逐条命中、审计事件与可追溯来源，`--check` 在预算溢出 / 托管块陈旧 / 未消解冲突时退出 1。
  - **跨仓联邦**：`federation.roots` / `--roots` 只读其他仓库的 `records.jsonl`，结果带仓库标签，不写对方。
  - 口径配置 `.agents/config/memory-lifecycle.json` + `schemas/memory-lifecycle.schema.json`；CI 追加 advisory `report --check`；`dream-run` 阶段 J 纳入生命周期审计。
  - 测试：`tests/memory-lifecycle.test.mjs` 9 例（id 幂等、衰减确定性、休眠复活、冲突裁决、上浮/预算拒绝、统一查询与命中日志、联邦只读、审计可追溯与陈旧检测、托管块组合）。

### R3-7 可观测与成本（引擎面）

- **目标**：从现有 ledger 派生按 run/角色/模型的成本与延迟；模型质量回归时间线；可选 OTel/Prometheus 导出（无外部依赖时落本地文件）。
- **验收**：指标可由现有证据重算；时间线可对比两个版本。规模 `M`。
- **落地（2026-11-13）**：
  - `metrics-core.mjs` 增加纯聚合内核：`percentile` / `stageLabel` / `summarizeRuns` / `summarizeUsage` / `evalTimeline` / `diffReports`（无读盘、无写盘，供 observability 与看板复用）。
  - `usage-log.mjs`：`append` 校验后写入 `.agents/usage.jsonl`（gitignore），`list` 只读；拿不到的字段不写，`costUsd` 可由行内值或价格表换算。
  - `observability.mjs`：聚合 pipeline run 事件（run/阶段延迟、停止类型）、verify 凭证（通过率、逐门耗时）、`eval-log.json`（模型质量时间线，回归按 `regression.passRateDrop` 或 pass→fail）、usage（角色/模型 token、成本、延迟、失败）与复核产物（verifier 投票模型分布、复核墙钟）；缺源单列。输出 `md|json|prom|otel`；`--baseline <report.json>` 对比两个版本（数值差分 + 模型通过率回归）。
  - 口径配置 `.agents/config/observability.json` + `schemas/observability.schema.json`；缺 token/价格的调用记 `unpricedCalls`，不按 0 计费。
  - 测试：`tests/observability.test.mjs`（可重算、成本换算、回归检测、Prom/OTel 导出、基线差分、usage-log 校验）。

### R3-8 沙箱与供应链（引擎面）

- **目标**：devcontainer 生成、MCP 工具权限策略、SBOM/许可证检查（`check-secrets` 已有基础）。
- **验收**：生成的容器可构建；未列入策略的 MCP 工具被拒。规模 `L`。

### R3-9 manifest 迁移框架

- **现状**：`upgrade` 只能重放，结构变更（文件拆分/合并/改名）需要手工处理。
- **目标**：manifest 增加 `schemaVersion`；`migrations/<from>-<to>.mjs` 在 upgrade 前执行，支持 `--dry-run` 与失败回滚说明。
- **验收**：旧 manifest 夹具可迁移；重复执行幂等；迁移不影响用户文件。规模 `M`。
- **落地（2026-11-13）**：`src/install/migrations.mjs` 按 `schemaVersion` 顺序加载 `migrations/<from>-<to>.mjs`，当前版本 2（`0-1.mjs` 初始化、`1-2.mjs` 收缩运行时安装面）；升级前在内存中逐步迁移，全部成功才写 manifest，失败零写盘；`--dry-run` 只报告；manifest 版本高于工具当前支持时拒绝升级；`upgrade --json` 增加 `migration` 报告。

### R3-10 `new-host` 生成器与模板 lint

- **目标**：
  - `flow-kit new-host <name>` 生成 registry 条目、模板目录、host-meta、测试与 locale key；
  - `npm run lint:templates` 校验 frontmatter、i18n 覆盖、运行态污染、`hosts × tiers × langs` 渲染矩阵；
  - 纳入 CI。
- **验收**：生成的新宿主开箱通过测试；故意破坏模板可失败。规模 `M`。
- **落地（2026-11-13）**：
  - `flow-kit new-host <name>`（`src/commands/new-host.mjs`，`tools/new-host.mjs` 薄封装）生成外部宿主插件到 `<out>/.flow-kit/hosts/`：定义 JSON、命令/子代理指针壳（从引擎 `commands` / `roles` 派生）、技能入口模板（`skillMeta`），可选 `--hooks`（`cli` 形式）、`--permissions`、`--mcp claude|opencode`；写盘后复用 `validateHostDefinition` 自校验，不修改内置注册表。生成物可被安装器自动发现，安装后 `doctor` 的 hooks / permissions / MCP 对账全过。
  - 外部宿主定义补齐 `mcp`、`skillMeta` 与 `cli` / `cli-args` hook 形式；`schemas/host.schema.json` 与 `src/hosts/external.mjs` 的键/枚举由 lint 双向核对。
  - `npm run lint:templates`（`tools/lint-templates.mjs`）检查：skill/host 指针 frontmatter、installer 中英文键对齐、en 覆盖、`hosts × tiers × langs` 渲染矩阵（残留占位符、JSON 可解析、运行态路径不进安装面、`flow-kit run|hook` 与 skill/command/role 引用可解析）。CI 增加 `npm run lint:templates`。
  - 测试：`tests/new-host.test.mjs`（生成→安装→doctor）、`tests/lint-templates.test.mjs`（全量通过 + 破坏 frontmatter / 指针 / locale 必须失败）。

## 6. Wave 4 — 方法论对齐

对齐外部 Harness 方法论（HelixHarness 等）中本仓缺失的三块：多仓协调、可审计工件、可互操作的评测证据。原则仍是“安装器生成 + 运行态可检查”，不引入服务端依赖。

### R4-1 多仓 Workspace 协调

- **现状**：已实现 `workspace init/status`。清单 `.flow-kit/workspace.json` 只记录显式仓库；init 幂等保留 createdAt；status 只读聚合各仓 manifest 的宿主/栈/语言/版本，路径缺失标 `missingPath`；非法仓库退出码 2，缺清单 3。`--repos` 支持空格/逗号分隔。
- **目标**：
  - `flow-kit workspace init --repos ./api ./web` 生成 `.flow-kit/workspace.json`（仓库清单 + 各仓 manifest 摘要）；
  - `flow-kit workspace status` 只读聚合各仓安装状态、宿主/栈/版本与缺失；
  - 仓库必须在 workspace 根目录内且是 git 仓库；不引入 workspace 清单以外的隐式发现。
- **落点**：`src/commands/workspace.mjs`、`schemas/workspace.schema.json`、CLI help/locale。
- **验收**：init 幂等、status `--json` 契约、非法仓库退出码、缺失清单退出码。规模 `M`。

### R4-2 Spec / Tasks / Verify 工件规范

- **现状**：`workflow/specs/_TEMPLATE/` 提供 `spec.md` / `tasks.md` / `verify-report.md`；`check-spec-packages.mjs` 校验三件套、验收标准节、任务勾选项、结果/证据节与结论枚举，支持 `--root` / `--json`，缺件或伪完成退出 1。
- **目标**：`workflow/specs/` 增加 `_TEMPLATE/{spec,tasks,verify-report}.md`；active/completed 目录约定；校验脚本检查必填节与证据字段。
- **验收**：模板随安装落盘；校验可发现缺节/伪完成；文档说明工作流。规模 `M`。

### R4-3 eval-log 证据格式

- **现状**：`recordEval` 在既有 `results.jsonl` 外写版本化 `eval-log.json`（version 1、threshold、outcome、证据签名），支持 `--no-eval-log` 与 `--eval-log <path>`；schema 在 `schemas/eval-log.schema.json`，既有评测门行为不变。
- **目标**：`agent-eval.mjs` 在既有 JSONL 凭证外输出版本化 `eval-log.json`（阶段、结果、证据签名、资源计数），并提供 JSON schema；字段与外部平台可对齐。
- **验收**：schema 校验；既有评测行为不变；可关闭/指定输出路径。规模 `S`。

## 7. Wave 5 — 运行时能力归位

目标：脚本能力随 npm 包提供，项目只保留 agent 能识别的声明式适配面；不把运行时实现复制进每个目标项目。

### R5-1 运行时能力包内化

- **R5-1a（DONE）包内 runtime 入口**：`flow-kit run <script>` / `flow-kit hook <hook>` 从包内执行引擎脚本与 hook 适配器；目标根按 `--root` > `FLOW_KIT_PROJECT_ROOT` > 向上查找 `.agents` 解析；子进程注入 `FLOW_KIT_PROJECT_ROOT` / `FLOW_KIT_RUNTIME_*`，脚本的 ROOT 解析改为优先读取该环境变量（直接执行安装副本时保持原回退）。
- **R5-1b（DONE）安装面收缩与迁移**：`buildPlan` 跳过 `.agents/scripts/**`、`.agents/hooks/*.cjs|mjs`、`.agents/tests/**`（`isRuntimeEnginePath` 单一判定源）；git 钩子、宿主 hooks、MCP、commands/skills 中的运行时调用统一改为 `flow-kit run x` / `flow-kit hook x`；manifest `schemaVersion` 1→2 迁移摘除旧运行时条目，并按旧哈希只删除未改动的磁盘副本（用户改动保留为 legacy）；`doctor` 报告遗留运行时文件与 `flow-kit` PATH advisory；CI 使用 `npx --yes agentic-flow-kit`，项目自建 `local-pre-commit` 优先于包内默认实现。
- **验收**：`run/hook --list`、root 解析、未知入口退出码 2、从包执行不污染包目录；新装项目无 `.agents/scripts` / `.agents/hooks` 实现文件，`policy check`、`check-local-gates`、hooks 接线与安装测试全绿。规模 `L`（a：M，b：L）。

## 8. 依赖关系

```text
R1-1 diff ──┬─> R1-2 prune ──> R1-3 remove-host
            ├─> R1-5 explain
            ├─> R2-1 三方合并
            └─> R2-2 adopt

R2-4 hook 编译器 ──> R2-6 权限编译 ──> R2-9 企业档矩阵

R3-1 policy-as-code ──> R3-2 策略 diff ──> R3-3 证明链
R3-4 技能包 ──> R3-10 模板/技能 lint（共享校验骨架）
```

## 9. 完成定义（DoD）

任何路线图条目完成，须同时满足：

- `npm test` 全绿，新增行为有测试；
- 中英文安装器文案同步（`locales/zh-CN` / `locales/en`）；
- `doctor` 或引擎 `verify` 能发现该能力的缺失/漂移/降级；
- 零运行时依赖，不新增 build/lint 依赖；
- 文档更新：`README.md`、`CLAUDE.md`、本文件状态；涉及缺口时同步 `BACKLOG.md`；
- 若进入门禁面：登记 `mechanism-registry.md` 并守住 `rule-budgets` 预算。

## 10. 风险与不做清单

**风险**

- 基线文件会保存用户内容：必须默认 gitignore、可 `--no-baseline`、可清理。
- 外部宿主与技能包引入不可信输入：schema 校验、校验和、默认离线。
- 宿主配置格式不稳定：编译器保留静态模板逃生口，按已验证宿主逐步推进。
- policy-as-code 与 Markdown 台账双源：先“检查一致性”，稳定后再考虑生成。

**不做**

- 不把安装器做成 agent runtime；
- 不引入默认联网、遥测或远程注册中心；
- 不在 `plan.mjs` / `doctor.mjs` 里为单个宿主写硬编码分支；
- 不为了覆盖率重写已验证的引擎脚本。
