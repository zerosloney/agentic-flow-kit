# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

`agentic-flow-kit` 是一个 Node.js ≥ 22、ESM、零运行时依赖的安装器 CLI。它把 AI-Native 工作流引擎（`.agents/`）、git 门禁、宿主适配层和 `wiki`/`workflow` 脚手架从零生成到任意项目，并按 10 个宿主（Trae、CodeBuddy、Claude Code、OpenCode、Qwen、PI、Cline、Command Code、Qoder、ZCode）各自的原生目录规范落盘。

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
node bin/flow-kit.mjs upgrade --target <tmp>
node bin/flow-kit.mjs prune --target <tmp>
node bin/flow-kit.mjs explain .claude/agents/implementer.md --target <tmp>
node bin/flow-kit.mjs doctor --target <tmp>
npm run doctor:self                       # 对当前仓库执行 doctor（需当前仓库已安装引擎）
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
```

## 安装管线（核心）

命令分发在 `src/cli/main.mjs`。`install`、`add-host`、`upgrade` 最终都汇聚到 `src/commands/install.mjs` 的 `runInstall`：

1. `parseArgs`（`src/cli/args.mjs`）→ 读取 manifest、栈、语言、模型参数。
2. `buildPlan`（`src/install/plan.mjs`）生成计划条目。
3. `applyPlan`（`src/install/apply.mjs`）渲染文本、处理冲突、写盘并更新 manifest。
4. `writeManifest` 记录最终文件 sha256。

`buildPlan` 的顺序是理解安装结果的关键：

1. 静态层按优先级入队：engine 10、profile 20、host 30、scaffold/git 40。
2. 按 `targetRel` 应用语言覆盖（覆盖文件替换 `srcAbs`）→ 第一次去重。
3. 从覆盖后的 `.agents/skills/<name>/SKILL.md` 读取 frontmatter，动态生成宿主技能面。
4. 对生成项再应用一次语言覆盖 → 第二次去重（同一 `targetRel` 高优先级胜出）→ 类别过滤。

`applyPlan` 的写盘语义：

- 目标不存在 → 创建；目标哈希等于 manifest → 更新；被用户改过 → 冲突跳过；非本工具安装 → 跳过；`--force` 覆盖。
- `.gitattributes` / `.gitignore` 使用带标记的合并块，重复执行不重复追加。
- manifest 的哈希记录的是**最终文本**：模板渲染、语言覆盖、模型注入都完成之后才计算。
- 派生工件（如 `workflow/INDEX.md`）生成后会重算哈希，并把被生成器改写的路径登记到 `manifest.derived`；`diff` 不对这些路径做静态模板比对。

`diff` / `status` 复用 `buildPlan`、manifest 哈希与 `readInjectedModels`，只读输出 `unchanged` / `user-modified` / `kit-updated` / `orphan` / `missing`；不传 `--lang` 时跟随 manifest 语言。`prune` 复用同一套 orphan 分类：哈希与 manifest 一致才删，用户改过的保留并提示，`--force` 覆盖，删除后清理空目录。`explain` 复用 `buildState` 与 `classifyEntry`，输出模板来源、语言覆盖、模型注入和哈希；语言覆盖会在 plan 条目上记录 `templateAbs` / `localeOverride`。

所有命令共享 `--json` 与退出码契约（`src/cli/exit.mjs`）：`--json` 时 stdout 只允许最终单对象，人类进度走 stderr；`--strict` 把冲突/漂移变成退出码 1。码值：0 成功、1 冲突或严格模式漂移、2 用法、3 target/manifest 缺失、4 未知宿主、5 IO。新增错误类型时在 `exit.mjs` 登记 `err.code`，不要在命令里直接 `process.exit`。

`add-host` 只写 `category: 'host'`，并保留已安装的 stack / language；`upgrade` 按 manifest 记录的宿主和语言重放。

`install --auto-hosts` 通过 `src/hosts/detect.mjs` 只读探测宿主点目录与注册表声明的根级配置/记忆文件（如 `.mcp.json`、`opencode.json`、`QWEN.md`）；仅在未显式 `--agent` 时采用，探测为空报错。探测结果只进入 `--json` 的 `detectedHosts`，不写 manifest；TUI 用同一结果预选宿主。

`remove-host` / `uninstall` 同样以 manifest 哈希为安全闸：哈希一致的托管文件才删，用户改过的跳过并保留记录，`--force` 覆盖；删除后清理空目录。`remove-host` 只处理该宿主 `category: 'host'` 的文件和孤儿残留，根记忆文件（`rootMemory`，如 `CLAUDE.md`）视为用户文件、默认保留并停止托管；宿主集合变化后会用剩余宿主重渲染 engine.json / AGENTS.md / `.gitignore` 等宿主相关文件（仅当当前哈希仍等于 manifest）。`uninstall` 只移除带标记的合并块（保留块外用户内容，文件变空才删除），默认保留根记忆文件与用户改过的文件，全部清理完成才删除 manifest。

## 宿主能力注册表

`src/hosts/registry.mjs` 是宿主能力的单一来源，不要在 `plan.mjs` / `doctor.mjs` 里为某个宿主写硬编码分支。字段包括：

- `dir`、`rootMemory`：`hostTargetRel()` 负责把宿主模板相对路径映射到 `<dir>/...`，根记忆文件映射到项目根。
- `commands` / `agents` / `skills` / `hooks`：声明目录、扩展名、技能模式和接线文件。
- `agents.modelField` / `agents.inheritValue`：该宿主子代理是否支持按角色指定模型，以及 `inherit` 的写法。
- `modelProbe.configs/env/cli`：模型探测来源。

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

- `templates/engine/`：通用 `.agents/` 引擎。
- `templates/profiles/<stack>/`：dotnet / node / typescript / rust / go / java / empty 的栈配置与 `AGENTS.md`。
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
- `enterprise` / `--hardened`：宿主 `claude` 的 `settings.json` 换成 `templates/hosts/claude/settings.hardened.json`（sandbox、凭据读拒绝、MCP/权限 managed-only 键）。该文件**不**作为独立文件安装。
- 档位与 `hardened` 写入 manifest；`doctor` 显示档位、CI 缺失（advisory）、宿主能力缺口（无 hooks / 无 modelField）、模型漂移和 manifest 漂移（advisory，明细引导到 `diff`）。

## AI-Native 治理面（引擎模板）

- 行为评测：`.agents/scripts/agent-eval.mjs`；敏感面在 `.agents/config/agent-eval.json`，凭证是 `.agents/evals/results.jsonl`（内容签名，不是提交号）。
- 经验与记忆：`session-log.mjs`（运行态日志）、`memory-wiki.mjs`（生成 `wiki/_memory/`）、`memory-tier.mjs`（200 行 / 25KB 注入层）、`path-lease.mjs`（单写者租约）。
- 修复保护：`fix-task.mjs` 落 `.agents/cache/fix-task.json`，`pre-write-check.cjs` §2.5 在窗口内拦既有测试写入。
- 结果指标：`outcome-metrics.mjs`；闭环状态机静态检查：`check-pipeline-state.mjs` + `.agents/config/pipeline.json`。
- 模型升级治理：`.agents/skills/model-upgrade/SKILL.md`；严格度分层：`.agents/config/steering.json` + `steering.mjs`。
- **新增硬门禁必须登记** `.agents/config/mechanism-registry.md`；该文件受 `rule-budgets.txt` 字节/单行预算约束，新增行前先量预算。
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
- TUI 测试用 `PassThrough` / `EventEmitter` 模拟终端，并直接喂 CSI 转义序列验证按键解码。
- 新增宿主能力或安装行为时，优先补 `tests/hosts.test.mjs`、`tests/install.test.mjs`、`tests/models.test.mjs`；中英文输出改动同时补 `tests/en.test.mjs`。
