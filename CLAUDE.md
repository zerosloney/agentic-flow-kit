# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

`agentic-flow-kit` 是一个 Node.js ≥ 22、ESM、零运行时依赖的安装器 CLI。它把 AI-Native 工作流引擎（`.agents/`）、git 门禁、宿主适配层和 `wiki`/`workflow` 脚手架从零生成到任意项目，并按 14 个宿主（Trae、CodeBuddy、Codex、CodeArtsDoer、Claude Code、OpenCode、Qwen、PI、Cline、Command Code、Cursor、Qoder、ZCode、Antigravity）各自的原生目录规范落盘（清单以 `src/hosts/registry.mjs` 为单源）。

- 包入口：`bin/flow-kit.mjs`；npm bin 名 `flow-kit`。
- 安装目标项目由 `--target` 指定，默认当前目录。
- 语言：`zh-CN`（默认）与 `en`；安装器输出用 `locales/<lang>/installer.json`，生成文件用 `locales/<lang>/overrides/`。
- 不引入运行时依赖；测试与打包只依赖 Node 内置模块和 npm 本身。

## 常用命令

```bash
npm test                                  # 全部测试（node --test tests/*.test.mjs）
node --test tests/install.test.mjs        # 单个测试文件
node --test --test-name-pattern="claude" tests/install.test.mjs   # 单个用例

node bin/flow-kit.mjs --help
node bin/flow-kit.mjs install --agent claude --stack node --target <tmp>
node bin/flow-kit.mjs add-host trae --target <tmp>
node bin/flow-kit.mjs add-skill ./my-skill --target <tmp>
node bin/flow-kit.mjs skills lint --target <tmp>
node bin/flow-kit.mjs upgrade --target <tmp>
node bin/flow-kit.mjs upgrade --target <tmp> --explain-policy --dry-run
node bin/flow-kit.mjs prune --target <tmp>
node bin/flow-kit.mjs explain .claude/agents/implementer.md --target <tmp>
node bin/flow-kit.mjs run --list
node bin/flow-kit.mjs run --root <tmp> check-scripts-syntax
node bin/flow-kit.mjs hook --list
node bin/flow-kit.mjs doctor --target <tmp>
node bin/flow-kit.mjs doctor --target <tmp> --attest --out proof.json
npm run doctor:self                       # 对当前仓库执行 doctor（需当前仓库已安装引擎）
npm run changelog -- --write              # 重渲染 CHANGELOG.md（Conventional Commits 单源）
npm run changelog -- --notes --to <version>    # 出 release notes 底稿（单版本段）
```

- 没有 build / lint 步骤，也没有依赖安装步骤。
- `prepublishOnly` 会再次执行全部测试。
- 测试通常创建临时 git 仓库并 spawn CLI；TUI 测试用内存流模拟 TTY。

辅助工具（一次性/只读，不参与安装流程）：

```bash
node tools/parity-report.mjs --project <project>
node tools/extract-from-project.mjs --project <project> [--dry-run]
node tools/make-en-host-overrides.mjs
node tools/make-en-host-overrides.mjs --check   # CI：英文覆盖缺失/过期/孤儿
node tools/lint-templates.mjs                   # CI：frontmatter / i18n / 运行态污染 / hosts×tiers×langs 渲染矩阵
node tools/new-host.mjs myhost [--hooks] [--permissions] [--mcp claude|opencode]
```

## 安装管线（核心）

命令分发在 `src/cli/main.mjs`。`install`、`add-host`、`upgrade` 最终都汇聚到 `src/commands/install.mjs` 的 `runInstall`：

1. `parseArgs`（`src/cli/args.mjs`）→ 读取 manifest、栈、语言、模型参数。
2. `buildPlan`（`src/install/plan.mjs`）生成计划条目。
3. `applyPlan`（`src/install/apply.mjs`）渲染文本、处理冲突、写盘并更新 manifest。
4. `writeManifest` 记录最终文件 sha256。

`buildPlan` 的顺序是理解安装结果的关键：

1. 静态层按优先级入队：engine 10、profile 20、surface 21+（按声明顺序）、host 30、scaffold/git 40；存在 surface 时追加 `profile.json`（25）；宿主层之后生成 Hook 合并条目（31）与 MCP 合并条目（32）。
2. 按 `targetRel` 应用语言覆盖（覆盖文件替换 `srcAbs`）→ 第一次去重。
3. 从覆盖后的 `.agents/skills/<name>/SKILL.md` 读取 frontmatter，动态生成宿主技能面。
4. 对生成项再应用一次语言覆盖 → 第二次去重（同一 `targetRel` 高优先级胜出）→ 类别过滤。

`applyPlan` 的写盘语义：

- 目标不存在 → 创建；目标哈希等于 manifest → 更新；被用户改过 → 三方合并或冲突跳过；非本工具安装 → 跳过；`--force` 覆盖。
- 落盘统一走 `writeAtomicSync`（同目录 `.tmp` 再 rename）；磁盘内容与待写文本相同时不重写（空跑 `upgrade` 不刷 mtime），stats 计数与日志口径不变。
- 文本直写文件的基线保存在 `.agents/.kit/baseline/<targetRel>`（默认 gitignore；`--no-baseline` 关闭，`--baseline` 重新开启）。升级时若用户改过且模板相对基线确有变化，以 baseline 为 base、磁盘为 ours、新模板为 theirs 调用 `git merge-file`：clean 自动写回并把基线更新为模板侧内容，conflict 写冲突标记、保留 manifest 旧哈希并计入 `conflict`。无基线、二进制或 git 不可用时回退为哈希冲突跳过。合并块 / MCP / hooks 配置不存基线（自身已有合并语义）。
- `.gitattributes` / `.gitignore` 使用带标记的合并块，重复执行不重复追加。
- manifest 的哈希记录的是**最终文本**：模板渲染、语言覆盖、模型注入都完成之后才计算；`manifest.schemaVersion` 记录 manifest 结构版本（当前 3）；`manifest.baseline` / `baselineVersion` 记录基线状态，基线内容不参与哈希；`manifest.managedPermissions` 记录上次编译进各宿主配置的权限条目，`manifest.mergeOrigins` 记录合并型配置首次安装时是否已存在。`manifest.prevHooksPath` 记录安装前本地 `core.hooksPath`（`null` = 未设置；读到本工具的 `.githooks` 也按 `null` 记）：只在首次配置 git 时写入，升级 / 重装原样保留；完整 `uninstall` 且当前值仍是 `.githooks` 时据此还原，用户后来改过就不动，`remove-host` 不还原。
- `src/install/migrations.mjs` 在 `upgrade` 前按 `manifest.schemaVersion` 顺序加载 `migrations/<from>-<to>.mjs`，全部成功后才写 manifest，失败零写盘；`--dry-run` 只报告，`--json` 增加 `migration`。迁移只转换 manifest，不改目标文件；缺失 schemaVersion 视为 0，高于当前支持版本时拒绝升级。
- 派生工件（如 `workflow/INDEX.md`）生成后会重算哈希，并把被生成器改写的路径登记到 `manifest.derived`；`diff` 不对这些路径做静态模板比对。

`adopt` 用于接管已有安装（含缺失 manifest 的半安装树）：元数据优先取 `engine.json` 的 `options.{hosts,stack,language}` 与 `createdAt`，其次既有 manifest、宿主探测与参数；语言在候选集中按“与磁盘逐文件匹配数”择优。`src/commands/adopt.mjs` 复用 `buildState` 与 `readPlanEntry`，只把渲染结果完全一致的文件写入 manifest；合并块只比较托管块（块外用户内容不影响接管）；`workflow/INDEX.md` 按现状收录并登记 `derived`；`.agents/notes/engine-map.md` 等纯生成物与运行态文件不进 manifest。已改动 / 缺失 / 未识别文件分别报告且不覆盖，`--dry-run` 零写入；无可接管文件且无既有 manifest 时退出 1。

`diff` / `status` 复用 `buildPlan`、manifest 哈希与 `readInjectedModels`，只读输出 `unchanged` / `user-modified` / `kit-updated` / `orphan` / `missing`；不传 `--lang` 时跟随 manifest 语言。`prune` 复用同一套 orphan 分类：哈希与 manifest 一致才删，用户改过的保留并提示，`--force` 覆盖，删除后清理空目录；`prune --baseline` 额外清理 manifest 中已无对应文件的基线。`explain` 复用 `buildState` 与 `classifyEntry`，输出模板来源、语言覆盖、模型注入和哈希；语言覆盖会在 plan 条目上记录 `templateAbs` / `localeOverride`。

所有命令共享 `--json` 与退出码契约（`src/cli/exit.mjs`）：`--json` 时 stdout 只允许最终单对象，人类进度走 stderr；`--strict` 把冲突/漂移变成退出码 1。码值：0 成功、1 冲突或严格模式漂移、2 用法、3 target/manifest 缺失、4 未知宿主、5 IO、6 安装锁冲突（可重试）。新增错误类型时在 `exit.mjs` 登记 `err.code`，不要在命令里直接 `process.exit`。

`add-host` 只写 `category: 'host'`，并保留已安装的 stack / language；`upgrade` 按 manifest 记录的宿主和语言重放。`upgrade --explain-policy` 在应用前用 `src/install/policy-diff.mjs` 对比磁盘与本次渲染文本，只做策略面语义差分（gates / budgets / enums / roles / policy）；有变化才打印，`--json` 增加 `policyDiff`。

`install --auto-hosts` 通过 `src/hosts/detect.mjs` 只读探测宿主点目录与注册表声明的根级配置/记忆文件（如 `.mcp.json`、`opencode.json`、`QWEN.md`）；仅在未显式 `--agent` 时采用，探测为空报错。探测结果只进入 `--json` 的 `detectedHosts`，不写 manifest；TUI 用同一结果预选宿主。

`remove-host` / `uninstall` 同样以 manifest 哈希为安全闸：普通托管文件哈希一致才删，用户改过则跳过 / `--force` 覆盖。合并型配置（`merge-host` / `merge-mcp`）不能整文件删除：只有 `manifest.mergeOrigins[rel] === 'created'` 且哈希一致时才整体删除，否则只摘除托管 hook / 权限（按 `managedPermissions` 记录）/ MCP server，保留安装前已有的用户内容，文件变空才删。`remove-host` 只处理该宿主 `category: 'host'` 的文件和孤儿残留，根记忆文件（`rootMemory`，如 `CLAUDE.md`）视为用户文件、默认保留并停止托管；宿主集合变化后会用剩余宿主重渲染 engine.json / AGENTS.md / `.gitignore` 等宿主相关文件（仅当当前哈希仍等于 manifest）。`uninstall` 只移除带标记的合并块（保留块外用户内容，文件变空才删除），默认保留根记忆文件与用户改过的文件，全部清理完成才删除 manifest。完整卸载删除清单前先还原 `core.hooksPath`（见 `manifest.prevHooksPath`）。

## 包内运行时入口

`run` / `hook` 在通用 `parseArgs` 之前分派（`src/commands/runtime.mjs`），因为脚本参数可能自带 `--json` / `--root` 等旗标。入口从包内 `templates/engine/.agents/{scripts,hooks}` 解析目标，只消费 `--root` / `--lang` / `--list` 等入口选项，其余参数与 stdin 原样透传。目标根解析顺序：`--root` > `FLOW_KIT_PROJECT_ROOT` > 从 cwd 向上查找 `.agents` > cwd；子进程 cwd 固定为目标根，并注入 `FLOW_KIT_PROJECT_ROOT` / `FLOW_KIT_RUNTIME_ROOT` / `FLOW_KIT_RUNTIME_SCRIPTS` / `FLOW_KIT_RUNTIME_HOOKS`。

脚本的 `ROOT` 解析优先读取 `FLOW_KIT_PROJECT_ROOT`，回退到自身 `SCRIPT_DIR/../..`，因此既可由包内入口执行，也可直接执行安装副本。未知脚本 / hook 为 `UNKNOWN_SCRIPT` / `UNKNOWN_HOOK`（退出码 2），目标缺失为 `TARGET_MISSING`（3）。R5-1b 起安装面收缩：`.agents/scripts/**`、`.agents/hooks/**`（实现文件）与 `.agents/tests/**` 不再写入目标项目，项目内只保留 agent 声明面与配置；`isRuntimeEnginePath()`（`plan.mjs`）是唯一判定源，`migrations/1-2.mjs` 把旧 manifest 中的运行时条目摘除，并按旧哈希只清理未改动的磁盘副本。

`doctor` 的 `flow-kit cli` 检查用 `flowKitVersionDrift` 比对 PATH 上 `flow-kit` 与清单版本，不一致给 advisory：钩子与 MCP 执行的是 PATH 上那个，而不是装出这棵树的版本。

## 工件与证据

- `templates/scaffold/workflow/specs/_TEMPLATE/` 提供目录化 `spec.md` / `tasks.md` / `verify-report.md`；`templates/engine/.agents/scripts/check-spec-packages.mjs` 校验包内三件套、`## 验收标准`、任务勾选项、`## 结果` / `## 证据` 与 `结论: pass|fail|partial`。以 `_` 开头的目录跳过，脚本可独立运行（`--root` / `--json`，失败退出 1）。
- `agent-eval.mjs` 的 `recordEval` 在 JSONL 凭证外写版本化 `.agents/evals/eval-log.json`（`version: 1`、threshold、outcome），可用 `--no-eval-log` / `--eval-log` 控制；schema 为 `schemas/eval-log.schema.json`。既有 `results.jsonl` 行为不变。
- `sbom-license.mjs`（R3-8 供应链）从 `package-lock.json` 生成 SPDX 2.3 SBOM 到 `.agents/sbom/spdx.json`，并按 `.agents/config/license-policy.json`（schema `schemas/license-policy.schema.json`）的 allow/deny 闭集判定依赖许可证；`--check` 只读比对漂移，lockfile 缺失退出 2（fail-closed）。verify 安全段门 `sbom-license` 恒执法；判定纯函数（`judgeLicense` 等）可直接 import 测试。

## 技能包分发与准入

`src/skills/` + `src/commands/skills.mjs` 实现 `add-skill` / `remove-skill` / `skills lint`：

- 来源解析在 `src/skills/source.mjs`：local 直接复制；git 用 `git clone --depth 1 [--ref|#ref]`；npm 用 `npm install --no-save`。git/npm 必须显式 `--allow-network`，默认离线。
- lockfile 固定为 `.agents/skills.lock.json`（`src/skills/lock.mjs`，schema `schemas/skills-lock.schema.json`）：来源、版本、包校验和（排序后 `<rel>\0<sha256>\n` 再 sha256）与逐文件哈希。manifest 的 `skills` 段与 `manifest.files` 同步记录，供升级/移除与哈希闸使用。
- 准入规则在 `src/skills/lint.mjs`：frontmatter 必填、name 唯一且匹配目录、描述 ≤ 300 字符、可选 `triggers` 跨技能冲突、`evalTasks` 引用 `.agents/evals/tasks.tsv`、lockfile 漂移。`add-skill` 安装前复用同一套规则。
- 宿主技能面从磁盘 `.agents/skills/*/SKILL.md` 动态生成（`plan.mjs` 的外部技能补充）：add/remove 后用 `runInstall({categories:['host'], quiet:true})` 重放，不复制正文。
- `remove-skill` 只删 manifest 哈希一致的文件，用户改动需 `--force`；同时清理宿主指针目录与空目录。
- `agent-eval record --skill <name>` 写技能粒度凭证（eval-log schema 可选 `skill`），`agent-eval status` 聚合最新通过率。

全新安装可用性约定（R3-4 并入）：`templates/git/.gitleaks-baseline.json` 随安装落盘；`workflow-modules.txt` 空词表 = 不校验模块枚举（pipeline-run / kb-search）；wiki 计数忽略点文件（`.gitkeep`），模板 INDEX 与 `数据维护/README.md` 对齐；`check-secrets-lite` 扫「已跟踪 + 未跟踪未被忽略」；`pipeline-run` 的 `changedFiles` 剔除 manifest 记录且哈希未变的安装产物（首次工单不再误判越权）。

## 多仓 Workspace

`src/commands/workspace.mjs` 提供 `workspace init` / `workspace status`：清单固定为 `.flow-kit/workspace.json`（schema `schemas/workspace.schema.json`），只记录显式 `--repos` 列出的仓库，不做隐式发现。仓库必须在根目录内且含 `.git`；每仓独立安装，workspace 只读取各仓 `.agents/install-manifest.json` 的宿主 / 栈 / 语言 / 版本摘要。`init` 幂等并保留 `createdAt`；`status` 只读、路径消失标 `missingPath`。非法仓库 `BAD_REPO` → 退出码 2，缺清单 `NO_WORKSPACE` → 3；`--repos` 支持空格分隔（收集到下一个 `--flag`）与逗号分隔。`workspaceCommand` 由 `main.mjs` 在 `workspace` 子命令分派，不加载安装计划。

## 治理与供应链命令

安装管线之外，`src/cli/main.mjs` 还分派了以下命令（用法目录见 `flow-kit --help`）：

| 命令 | 实现 | 作用 |
|---|---|---|
| `policy <link\|check\|sync>` | `src/commands/policy.mjs` | 策略即代码：校验 / 关联 / 同步策略面（机制登记、预算上限、枚举引用） |
| `bundle <pack\|inspect\|verify\|unpack>` | `src/commands/bundle.mjs` | 把模板、语言包与外部宿主清单打成可校验的分发包，并支持检视、校验、解包 |
| `sbom <export\|verify>` | `src/commands/sbom.mjs` | SBOM 导出与校验（支持签名 / 验签） |
| `keygen` / `sign` / `verify-sig` | `src/commands/notary.mjs`、`src/install/notary.mjs` | 公证与数字签名：生成密钥、对工件签名、验签 |
| `handoff <create\|verify\|list>` | `src/commands/handoff.mjs`、`src/install/handoff.mjs` | 多智能体接力：生成 / 验签 / 列出接力信封；验签时做上下文防污染扫描与工件路径核验 |
| `mcp <audit\|check-call\|stats>` | `src/commands/mcp.mjs`、`src/install/mcp-gateway.mjs` | MCP 网关的角色权限：审计调用、按角色判定单次调用、统计 |
| `metrics <report\|export\|check>` | `src/commands/metrics.mjs`、`src/install/metrics.mjs` | AI-DORA 指标：报告 / OpenTelemetry 导出 / 阈值检查 |
| `arch <init\|check\|graph>` | `src/commands/arch.mjs`、`src/install/arch-guard.mjs` | 架构守卫：按预设初始化、检查边界违规、输出依赖图 |
| `sandbox <inspect\|init\|route\|exec>` | `src/commands/sandbox.mjs`、`src/install/sandbox.mjs` | 沙箱：检视引擎与策略现状、初始化策略、按指令高危等级路由、在沙箱内执行 |
| `gate [check\|badge\|init-ci]` | `src/commands/gate.mjs`、`src/ci/gate.mjs` | 门禁卡口：按变更集跑检查、生成徽章、生成 CI 工作流；`ci` 是同一处理器的别名（`flow-kit ci init` 等价 `gate init-ci`） |
| `hud` | `src/commands/hud.mjs`、`src/tui/hud.mjs` | 项目看板快照；`--watch` 实时刷新，`--json` 结构化输出 |

## 宿主能力注册表

`src/hosts/registry.mjs` 是宿主能力的单一来源，不要在 `plan.mjs` / `doctor.mjs` 里为某个宿主写硬编码分支。字段包括：

- `dir`、`rootMemory`：`hostTargetRel()` 负责把宿主模板相对路径映射到 `<dir>/...`，根记忆文件映射到项目根。根记忆文件（`CLAUDE.md`、`GEMINI.md`）是指向根 `AGENTS.md` 的指针式入口：不复制规则、不写项目专属事实，项目名与栈描述只出现在根 `AGENTS.md`。
- `commands` / `agents` / `skills` / `hooks` / `permissions` / `hardening`：声明目录、扩展名、技能模式和接线文件；`hooks.events` 描述 Hook 编译器需要的宿主 schema（事件、`matchers`、`command.form/template`、超时、容器路径、root/group/hook 扩展键）；`permissions` 描述权限编译能力（`syntax`、shell 工具名、支持的 `tools`、`extraAllow`）；`hardening.level`（managed / permissions / hooks / none）与可选 `settings` 驱动企业档矩阵。
- `agents.modelField` / `agents.inheritValue`：该宿主子代理是否支持按角色指定模型，以及 `inherit` 的写法。
- `modelProbe.configs/env/cli`：模型探测来源。
- `templates`：外部宿主的静态模板目录（绝对路径）；内置宿主不设置，回退到 `templates/hosts/<host>`。

外部宿主插件由 `src/hosts/external.mjs` 在命令分派前加载（`main.mjs` 调用 `loadExternalHosts`）：`~/.flow-kit/hosts/*.json` → `<target>/.flow-kit/hosts/*.json` → `--host-manifest <file>`，后加载者覆盖同名定义（项目层例外：随仓库分发的 JSON 只能新增宿主，不能重定义既有宿主，需覆盖时用 `--host-manifest`；单个定义文件上限 1 MiB），注册进 `HOSTS` / `HOST_NAMES` 并记录 `HOST_SOURCES`（`hostSource()` 供 doctor / list-hosts 使用）。JSON 走手写校验（`schemas/host.schema.json` 是对外文档，`HOST_DEFINITION_KEYS` / `HOOK_FORMS` 是代码侧单源，lint 双向核对），非法定义抛 `HOST_MANIFEST` → 退出码 2，错误带字段名。模板默认取与 JSON 同名的兄弟目录，`templates` 可显式覆盖；`skillMeta` 指向自带技能入口模板（否则用包内 `templates/host-meta/<host>` 或中性回退）；`mcp` 让外部宿主接入 MCP 合并。`plan.mjs` / `doctor.mjs` 统一用 `h.templates || templates/hosts/<host>`，不要新增按宿主名分支。`flow-kit new-host <name>`（`src/commands/new-host.mjs`，`tools/new-host.mjs` 为薄封装）生成完整插件：命令/子代理指针壳、技能入口模板、可选 hooks（`cli` 形式）/ permissions / MCP，写盘后立即用同一套校验器自校验，不修改内置注册表。

`npm run lint:templates`（`tools/lint-templates.mjs`）是模板面的维护门：frontmatter 必填与 name 一致、宿主指针壳引用存在、installer 中英文键对齐、en 覆盖检查、`hosts × tiers × langs` 全量渲染（残留占位符 / JSON 可解析 / 运行态路径不进安装面 / `flow-kit run|hook` 引用可解析 / skill·command·role 引用存在）。新增模板或宿主能力时先跑它；故意破坏模板必须能失败。

MCP 接线在 `src/install/mcp.mjs`：`templates/mcp/servers.json`（项目可用 `.flow-kit/mcp/servers.json` 替换）声明中性 server，`buildPlan` 为注册表中声明了 `mcp` 的宿主生成 `kind: 'merge-mcp'` 条目，`getText` 渲染时读取磁盘并按 `format`（`claude` → `mcpServers`，`opencode` → `mcp`）合并，只补缺失同名 server，不覆盖用户内容；远程 server 在 claude 格式写 `type: http`（可声明 `sse`），opencode 写 `type: remote`。MCP 条目不走 user-modified 冲突分支（合并语义本身安全），apply 记录 `manifest.mcpServers[targetRel] = [names]` 与 `manifest.mergeOrigins`；`manifest.mcp` 是布尔开关（`--no-mcp` / upgrade 重放）。Qwen 的 `.qwen/settings.json` 与静态宿主模板同路径，文件不存在时以静态模板渲染结果打底，避免丢掉 hooks/permissions。卸载 / remove-host 对合并型文件只摘 manifest 记录的 server 名，`created` 且未改动才整文件删除；`prune` 以哈希为闸。`doctor` 校验缺失 / JSON 损坏 / 容器或 server 缺失。

Hook 接线在 `src/install/hooks.mjs`：中性规格来自引擎模板 `.agents/hooks/gates.json` 的 `hooks` 数组（`event`、`tool: write|shell|agent|session`、`script`、`timeout`），`buildPlan` 为注册表中声明了 `hooks.events` 的宿主生成 `kind: 'merge-host'` 条目（优先级 31，高于静态宿主条目 30），以宿主静态模板或有文件的磁盘内容为底稿，只替换托管条目，保留用户 hook、其它事件与 `permissions` 等键。注册表 `command.form` 为 `cli`（字符串 `flow-kit hook <id>`）或 `cli-args`（`command: flow-kit` + `args: ["hook", "<id>"]`）；`env` / `relative` / `args` 保留给外部宿主。`managedScript()` 同时识别 `flow-kit hook <id>` 与旧版 `.agents/hooks/*.cjs|mjs` 路径，因此升级可接管旧接线。同一文件同时有 MCP 时（Qwen `settings.json`）`addMcpEntries` 把 MCP 挂到该条目上组合执行，不再单独生成条目。没有 `hooks.events` 的宿主（opencode / pi / cline）继续安装静态模板，行为不变；规格 JSON 非法时回退静态模板。`doctor` 与安装共用同一规格源（kit 模板 `gates.json` + 语言覆盖，`readGatesSpecs`），按 `event|matcher|script` 比对，报告缺失 / 多余接线；golden 夹具在 `tests/fixtures/hooks/`。`hooks.events.event` 可为数组（claude：PreToolUse 两门 + PostToolUse usage 观测 + SessionStart 路由令注入）；规格中宿主未声明的 event / tool / matcher 由 `applicable()` 编译期过滤，`doctor` 据 `inapplicableSpecs()`（userHooks 宿主据 `inapplicableForUserHooks()`）给 guarantee advisory，降级可见而非静默缺失。

权限编译在 `src/install/permissions.mjs`（与 Hook 编译共用合并骨架）：`gates.json` 的 `allow` / `deny` / `ask`（`tool: shell|read|web`）按注册表 `permissions` 能力编译，`hardened` 段在 `--hardened` 时追加；宿主 `syntax` 决定 `Bash(cmd:*)` 或 `Bash(cmd *)`，栈白名单来自 `STACK_SHELL` 自动追加。`mergePermissionsIntoRoot` 按 `manifest.managedPermissions` 替换上次托管项、保留用户自建条目（静态模板打底时整体替换），保留 `defaultMode` / `disableBypassPermissionsMode` 等其它键；与 hooks / MCP 在同一个 `merge-host` 条目里组合执行。宿主不支持的 `tool` 类别不静默丢弃，编译结果带 `unsupported`；`doctor` 对账 `permissions <host>` 的缺失编译项 / 残留托管项（用户条目不算漂移），并对无权限能力的宿主给 `guarantee` advisory。

开发容器（R3-8 沙箱面）在 `src/install/devcontainer.mjs`：该文件是「栈 → 官方基础镜像 / 扩展」映射与渲染规则的单源（`STACK_IMAGES` / `STACK_EXTENSIONS`）。`buildPlan` 生成 `category: 'devcontainer'`、优先级 41 的两条 `kind: 'generated'` 条目（`.devcontainer/devcontainer.json` + `.devcontainer/Dockerfile`），Dockerfile 里 `ARG FLOW_KIT_VERSION=<安装器版本>` 钉死随镜像安装的 kit 版本；`--no-devcontainer` 关闭，选择记进 `manifest.devcontainer`，`upgrade` 按 manifest 重放（不静默重开）。白名单（`allowedImagePrefixes` / `forbiddenTags` / `requirePinnedFlowKit`）落在项目内 `.agents/config/devcontainer-policy.json`（schema `schemas/devcontainer-policy.schema.json`），运行时门 `templates/engine/.agents/scripts/check-devcontainer.mjs` 与 `doctor` 共读这一份，避免两处策略各说各话；门挂在 verify 安全段 `devcontainer`（项目没有 `.devcontainer/` 时大声跳过不判红），CLI `flow-kit devcontainer check|build`（`build` 需要 docker，缺失退出 2）。容器身份与 node 供给按镜像核对：`STACK_CONTAINER_USER`（node/typescript → `node`，其余 → `vscode`）与 `STACK_PROVISIONS_NODE`（只有 typescript-node 真带 node；dotnet/go/java 上游是 node feature `version: "none"`、只有 nvm 壳，rust/empty 无 node——这些栈在 Dockerfile 里以 `ARG NODE_VERSION` + 官方 tar 包 sha256 补装），生成器（`src/install/devcontainer.mjs`）与运行时门（`check-devcontainer.mjs`）两侧同表、必须同步；门从 `install-manifest.json` 读 stack，因此身份/镜像/补装写错都会当场判红。

「容器可构建」的证据由 `tools/devcontainer-build.mjs` 产出，两层分开记账：静态层（零 docker）逐栈生成 `.devcontainer/` 并用 `checkDevcontainer` 校验全部 9 栈，`npm run devcontainer:check`（`--dry-run`）在 CI 的 test 作业里跑；构建层需要 docker，对选定栈真跑 `docker build` + 冒烟 `docker run`，docker 缺失时 fail-closed 退出 2（不假装构建过），钉的版本尚未发布到 npm 时构建退回 `latest` 并记账。kit 自身 CI 的 `devcontainer-build` 矩阵作业跑 node/dotnet 两个代表栈；目标项目 CI 模板里的同名作业默认关闭（仓库变量 `FLOW_KIT_DEVCONTAINER_BUILD=true` 才开），避免默认拉镜像。

技能安装由 `skills.mode` 驱动：

- `native`：生成 `<宿主目录>/skills/<name>/SKILL.md` 指针壳，正文权威仍在 `.agents/skills/`。
- `shared`：宿主原生读取 `.agents/skills`，不复制，只生成 `wf-skills` 索引入口。
- `index`：生成 `wf-skills.md`（有命令目录）或 `SKILLS.md` 索引。

技能指针/索引模板在 `templates/host-meta/`，它**不是** `templates/hosts/<host>` 的静态宿主文件，遍历宿主模板时不要把它算进去。生成项从语言覆盖后的 `.agents` 技能 frontmatter 取描述，因此 `locales/en/overrides/...` 中的 `description` 会直接影响生成结果。

## 模型解析与注入

模型逻辑在 `src/models/`：

- `probe.mjs`：读取宿主配置、环境变量；只读 CLI 仅在显式允许时执行（1.5s 超时、失败静默）。
- `resolve.mjs`：合并 CLI / TUI / 本地配置 / 探测推荐 / `inherit`，输出每个宿主的 `{ code, judgment, review }`。
- `known.mjs`：只放已核实的推荐别名，不合成未知模型 ID。

优先级（高 → 低）：CLI `--model` > TUI > `.agents/config/model-roles.local.json` > 探测 + 推荐 > `inherit`。

关键约束：

- 模型注入发生在 `readPlanEntry` 内、渲染和语言覆盖之后，注入后的文本才进 manifest。
- 只有注册表声明了 `agents.modelField` 的宿主会写 `model` 字段；其余宿主只记录到本地配置。
- `.agents/config/model-roles.local.json` 是用户所有：不进 manifest、升级默认不覆盖；升级时如果该文件缺失，会从已安装子代理的 `model` 字段回收，避免静默回退为 `inherit`。
- `review` 与 `code` 相同时只告警（`REVIEW_SAME_AS_CODE`），不阻断安装；显式配置（CLI/TUI/本地）不会被静默改写。

## 模板与语言分层

- `templates/engine/`：通用 `.agents/` 引擎。栈无关但 ALM 专用的技能也留在这一层：`tfs-pr` 面向 Azure DevOps Server（自托管），任何技术栈都可能用到，不属于母项目残留。
- `templates/profiles/<stack>/`：dotnet / node / typescript / rust / go / java / python / cpp / empty 的栈配置与 `AGENTS.md`。栈专用技能也住这一层（如 dotnet 的 `csharp-quality-gates`）；`tools/lint-templates.mjs` 的技能存在性与 frontmatter 检查同时查 engine 与各 profile。
- `templates/surfaces/<surface>/`：组合式切面 `frontend` / `api` / `data`，按声明顺序以优先级 21+ 叠加在 stack（20）之上；同名路径后声明者覆盖。仅当存在 surface 时生成 `.agents/config/profile.json`；`src/install/profiles.mjs` 是闭集与解析的单一来源，`manifest.surfaces` 记录组合。
- `templates/scaffold/`：`wiki/`、`workflow/` 数据资产骨架。
- `templates/git/`：五钩子、`.gitattributes`、`.gitignore` 合并块。
- `templates/hosts/<host>/`：静态宿主适配文件（command / agent / hooks）。
- `templates/host-meta/`：动态技能指针/索引模板。
- `locales/<lang>/overrides/<targetRel>`：按目标路径镜像的覆盖，优先级高于模板；覆盖文件替换源文件（而不是合并）。

安装器自身的提示文案在 `locales/<lang>/installer.json`，通过 `makeT(lang)` 读取；`zh-CN` 是回退语言。

## 安装档位与加固

`install` / `add-host` / `upgrade` 接受 `--tier lean|standard|enterprise` 与 `--hardened`：

- `lean`：不生成 CI（`azure-pipelines.yml` / `.github/workflows/ci.yml`），其余引擎面不变。
- `standard`（默认）：生成 CI，CI 在 `verify --full` 后跑 advisory 的 agent-eval / memory-tier / pipeline-state。
- `enterprise` / `--hardened`：按 registry `hardening.level` 分级加固——`managed`（claude）替换 `settings.hardened.json`（sandbox、MCP/权限 managed-only 键，权限数组由 `gates.json` 基线 + `hardened` 追加项编译覆盖，该文件**不**作为独立文件安装）；`permissions`（qwen / qoder / commandcode）编译 hardened 权限项；`hooks`（codebuddy / trae / zcode）只有命令门禁；`none`（opencode / pi / cline）无可配置面。`hardening.settings` 声明的文件作为宿主主配置替换源，不独立安装。
- 档位与 `hardened` 写入 manifest；hardened 时额外写 `manifest.enterprise`（`posture`、每宿主级别、`gaps`、`proofChain`、`policyChecks`，默认档不写该字段）。`doctor` 显示档位、实际姿态、宿主矩阵与缺口（advisory），核对证明链（agent-eval / outcome-metrics / pipeline-state）与策略面（`.githooks` / CI / permissions），并继续报告 CI 缺失、宿主能力缺口（无 hooks / 无 modelField）、模型漂移和 manifest 漂移。

## AI-Native 治理面（引擎模板）

- 行为评测：`flow-kit run agent-eval`（实现随包）；敏感面在 `.agents/config/agent-eval.json`，凭证是 `.agents/evals/results.jsonl`（内容签名，不是提交号）。
- 多智能体接力（handoff）：信封验签 + 指令面检查（SECRET_LEAK 硬拒；SUSPICIOUS_DIRECTIVE 计 warnings，verify 文本输出与 hud 看板均可见并计入 warned 聚合）。
- 经验与记忆：`session-log.mjs`（运行态日志）、`memory-wiki.mjs`（生成 `wiki/_memory/`）、`memory-tier.mjs`（200 行 / 25KB 注入层）、`path-lease.mjs`（单写者租约）。
- 记忆生命周期：`memory-lifecycle.mjs` 把记忆做成确定性状态机（candidate / active / dormant / retired / superseded；记录 `.agents/memory/records.jsonl`，迁移审计 `.agents/memory/audit.jsonl`）：`decay` 只依赖 `now - max(lastHitAt, createdAt)`，`conflict` 按来源权威 rank → 时间 → id 裁决并保留双方来源，`promote` 只替换注入层 `memory:auto:begin/end` 托管块且写前用 `memory-tiers.json` 预算预检（超限不落状态），`query` 统一检索记录 / claims / incidents / papercuts / 联邦仓库并把命中写回 `.agents/cache/memory-hits.jsonl`，`report --check` 在预算溢出、托管块陈旧或未消解冲突时退出 1。口径 `.agents/config/memory-lifecycle.json`（schema `schemas/memory-lifecycle.schema.json`）；CI 为 advisory。
- 代码四门中的三个通用门：`check-architecture.mjs` 是规则执行器，规则来自项目级 `.agents/hooks/architecture-redlines.json`（`forbidden` / `noNavigationProperties` / `catchRequires` 三类）；`check-delete-guard.mjs` 的扫描目录与调用正则来自 `.agents/hooks/delete-guard.json`；`check-audit-fields.mjs` 的受保护字段与豁免来自 `.agents/hooks/audit-fields.json`。三份配置都不随装分发，未配置时 loud-skip，不再因目标目录缺失而 fail-closed；声明了的目标缺失仍 fail-closed。`code-notify-guard` 不是通用门，需要它的项目经 `product-gates.json` 登记。`check-schema-residue.mjs` 的连接串与豁免清单经参数 / 环境变量提供。
- 技术栈产品门是项目配置：`verify.mjs` 基础门表只含通用门（引擎段 / 安全段 / 代码三门 / `wiki-consistency`），其余来自 `.agents/config/product-gates.json` 与 `product-gates.<名称>.json`（`when` 与 `commit-check.cjs` 同语义：路径存在 / 尾部 `*` / `pkg:<脚本路径>`；配置非法 exit 2）。dotnet profile 只带 `when` 守卫的中性默认值，后端测试、E2E、通知守卫由项目自行登记。`--mid` 仍按 id 约定给 `backend-test` 追加 `--unit-only`。
- 推送前测试同理：`commit-check.cjs` 的 `pushTests` 只在 `--range` 模式（`pre-push` 调用）执行，命令可用 `{old}` / `{new}`，`when` 声明脚本存在才启用，`whenEnv` 是环境开关；`pre-push` 自身不再写死任何技术栈的测试。
- 看板端口单源 `board-port.mjs`：基端口 8933，`FLOW_KIT_BOARD_SLOT` 按 `slot×10` 偏移（旧名 `SHIPYARD_SLOT` 兼容）；不再依赖包外的 `ports.mjs`。
- dotnet profile 的 `runtime-env.md`、`test-impact-map.json`、`lane-surfaces.txt`、`workflow-modules.txt` 是中性骨架：项目环境事实登记在 `.agents/notes/runtime-env.local.md`（本机私有），模块词表留空即不校验枚举。规则里引用 `backend/AGENTS.md`、`frontend/AGENTS.md` 这类项目文件一律写成「存在才读」——没有任何 profile 提供它们。
- 修复保护：`fix-task.mjs` 落 `.agents/cache/fix-task.json`，`pre-write-check.cjs` §2.5 在窗口内拦既有测试写入。
- 结果指标：`outcome-metrics.mjs`；闭环状态机静态检查：`check-pipeline-state.mjs` + `.agents/config/pipeline.json`。执行器 `pipeline-run.mjs` 支持门执行前 `inFlight` 落盘（`next`/`resume` 断点续跑）、`--retry` verify 门重试预算、`--parallel` 并发门分支，并按 `pipeline.json` 的 `stageArtifacts` 在门之前校验阶段产物；续跑时 `docsCommit` 以 HEAD 同主题提交判幂等。失败路由由 `pipeline.json` 的 `onFail`（`{to, retry}`）声明，run 文件以 `retries` / `nextTarget` 记录 per-stage 失败计数与退回目标，`check-pipeline-state.mjs` 静态校验该表闭合。
- 成本与延迟：`usage-log.mjs` 追加角色/模型调用凭据（`.agents/usage.jsonl`，gitignore 运行态）；`observability.mjs` 聚合 pipeline run 事件、verify 凭证、eval-log 时间线、usage 与复核产物，支持 `--format prom|otel` 与 `--baseline` 快照对比。聚合纯函数在 `metrics-core.mjs`；口径配置 `.agents/config/observability.json`（schema `schemas/observability.schema.json`）。缺 token/价格的调用记 `unpricedCalls`，不按 0 计费。
- 模型升级治理：`.agents/skills/model-upgrade/SKILL.md`；严格度分层：`.agents/config/steering.json` + `steering.mjs`。
- 策略即代码：`.agents/config/policy.json`（`schemas/policy.schema.json`）声明策略面路径、机制闭集、预算上限、枚举键与角色映射；`flow-kit run policy check|explain` 双向核对 `mechanisms.required` 与 `mechanism-registry.md`、复用 `rule-budget.mjs --all` 执法预算、校验 `workflow-enums.txt` / `pipeline.json` / `model-roles.json` / `pr-review.json` 引用；`flow-kit run gen-effective-policy` 复用同一视图生成 `workflow/effective-policy.md`。CI 跑 `npm run policy:check`。
- 安装证明链：`src/install/attest.mjs` 生成 `flow-kit-attest/v1`（manifest / files / policy / evals / git 五段 sha256 链）；`doctor --attest [--out <file>]` 输出可归档证明，托管文件缺失/哈希不符时 `ok:false` 且退出 1；证明不含时间戳/绝对路径/网络访问，schema 为 `schemas/attestation.schema.json`。
- **新增硬门禁必须登记** `.agents/config/mechanism-registry.md`，并同步 `policy.json` 的 `mechanisms.required`（双向核对会拒绝漏登）；该文件受 `rule-budgets.txt` 字节/单行预算约束，新增行前先量预算。
- 未完成/已完成的缺口与验收口径见根目录 `BACKLOG.md`。

## TUI

`src/tui/` 是零依赖交互向导：

- `screen.mjs` 是 TUI 层中唯一接触 stdin/stdout 的模块，包含自研按键解码器；`flows.mjs` 组织安装/追加宿主/升级/体检流程。
- 交互终端下无参数运行进入菜单；无参数且非 TTY 时直接打印帮助。进入向导后若 raw mode 不可用，自动降级为编号问答。
- `wizard.mjs` 的 `buildInstallArgs` 负责把 TUI 选择转换成 CLI argv 形状。
- 新增交互原语时，同时考虑交互路径（`runPrompt` + widget）和降级路径（`askLine`）。

## 测试约定

- 使用 `node:test` 和 `node:assert/strict`，不引入测试框架。
- 安装测试在临时目录 `git init` 后 spawn `bin/flow-kit.mjs`，并设置 `FLOW_KIT_TEST=1`。
- 测试要建临时目录时用 `tests/helpers/tmp.mjs` 的 `makeTmp(prefix)`，不要直接 `fs.mkdtempSync`：helper 登记本进程创建的目录并在进程退出时删掉，避免 `%TEMP%` 越攒越多。
- TUI 测试用 `PassThrough` / `EventEmitter` 模拟终端，并直接喂 CSI 转义序列验证按键解码。
- 新增宿主能力或安装行为时，优先补 `tests/hosts.test.mjs`、`tests/install.test.mjs`、`tests/models.test.mjs`；中英文输出改动同时补 `tests/en.test.mjs`。

## 泛化面（2026-11 起）

- **栈注册单源**：`src/install/stack-registry.mjs`（菜单顺序 / 探测标记 / 默认端口描述 / 宿主权限命令 / devcontainer 映射）；`profiles.mjs`、`tokens.mjs`、`install.mjs`、`devcontainer.mjs` 全部由它派生。加栈 = 改注册表 + 加 `templates/profiles/<stack>/`；`tests/stack-registry.test.mjs` 守护注册表 ↔ STACKS ↔ schema 枚举一致（schema 枚举缺项会红）。
- **产品面单源**：`templates/engine/.agents/scripts/faces.mjs` 读 `.agents/config/project-faces.json`（ui / code / tests / data 前缀）。未配置 = 保守全触发；配置错误 = fail-closed。消费者：`.githooks/pre-commit`、`.githooks/commit-msg`、`hooks/pre-write-check.cjs`、`hooks/check-confirm-order.mjs`、`scripts/verify.mjs` 与 `confirm-doc.mjs` 脏路径、`verify-scope.mjs`、`check-regression-consistency.mjs`。dotnet 画像带默认面，其余画像留空。
- **门禁配置可见性**：`src/install/gate-summary.mjs` 在 install/upgrade 结束输出「门禁配置：未配置 N 项（=SKIP）」；doctor 有 `gate *` 与 `faces coverage` 检查；10 份项目级配置的字段与未配置语义见 `templates/engine/.agents/notes/project-configs.md`。
- **运行时双语**：`templates/engine/.agents/scripts/lang.mjs`（`runtimeLang` / `t()`，读 `engine.json` 的 `options.language`）；门禁脚本 SKIP/BLOCK 与 verify 内建门名已接入，zh 默认输出逐字节不变。
- **选测与证据机制**：`test-impact-map.json` 的 `runner`（kind/project/list/listNamePattern/filter）决定选测语义，generic 无 filter 模板回退全量；`regr-evidence-vocab.mjs` 与 `s23-convergence-audit.mjs` 的证据/命令白名单由 engine.json 栈 + product-gates + commit-check 命令生成。
- **升级路径**：升级/装户输出门禁配置报告；升级汇总单列「已安装后被修改、跳过」（不写冲突标记）。母仓升级预演与迁移清单在 `tmp/origin-migration/`（git 忽略，不入库）。
- **项目形态 / 端口 / 脚手架档位**：`--product web|api|library|cli`（缺省 web）经 `{{productNote}}` 渲染到根 AGENTS.md 与宿主 CLAUDE.md（非 web 形态替换「前端 dev 连 API」句，UI 实测阶段声明不适用）；`--api-port/--web-port` 写 manifest `ports` 与 engine.json `options.ports`（未显式指定不落字段，缺省继续跟随栈注册表）；`--scaffold full|minimal|none`（minimal 仅留 `wiki/INDEX.md`，none 不装脚手架）。三者均随 upgrade / add-host 重放。
- **未做**：脚手架目录名语言化（`wiki/数据维护` 等改名会牵动引擎路径契约，需单独设计）；TUI 尚未为 product/端口增加交互提问（CLI 参数可用）。
- **规则包（rules v1，实验性）**：`flow-kit rules validate|explain|check|init`。旧配置由 `src/rules/adapters.mjs` 投影为统一模型（原语闭集：content / require / absence / inventory / env / command / navProperties / plugin）；`.agents/rules/{stack,project,local}.json`（JSONC）按层覆盖，同 id 后者整条替换、`{id, enabled:false}` 即可禁用；diff 作用域（审计字段）与 repo 作用域（架构/删除/通知）分开，command 规则需 `--with-commands`（支持 `{old}/{new}` 区间占位）；`--prefix` 按规则组裁剪。**Phase 2–4 已切**：pre-commit 四门与宿主写前门（快照保留）统一走 `flow-kit rules check`；verify 的 code 三门改 `rules check --prefix`，且 code 四门对所有技术栈保留；`notify-guard` 配置化；dotnet 画像分发 `.agents/rules/stack.json`（栈层骨架）；插件子进程 API（`plugins` 白名单 + stdin/stdout JSON 契约 + 超时/崩溃按 severity 记违例）已落地；`rules validate` 对 legacy 层打印迁移提示。**Phase 5 已切**：commit-check（`builds`/`checks`/`pushTests`）委托 rules 引擎执行（wrapper 保留历史参数与 OK/SKIP/BLOCK 输出；`--no-build`/`--full`/`--range` 语义保持；命令规则支持 `name`/`lockPattern`/`lockHint`/`exclude`、超时默认 10min、`[超时]` 输出；`when` 数组语义 = OR，与旧配置一致）。**未切**：verify 的 product-gates 仍由 verify 直接执行（deps/when/type 语义更丰富，规则里仅投影备用）。

