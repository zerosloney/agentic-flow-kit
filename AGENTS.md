# AGENTS.md

This file provides guidance to the AI agent when working with code in this repository.

`agentic-flow-kit`：Node.js ≥22、ESM（`.mjs`）、零运行时依赖的安装器 CLI，把 AI-Native 工作流引擎安装到目标项目。完整架构（安装管线、宿主注册表、模型解析、TUI）见 @CLAUDE.md。

## 命令

- 测试：`npm test`（`node --test tests/*.test.mjs`）。单文件：`node --test tests/install.test.mjs`；单用例：`node --test --test-name-pattern="claude" tests/install.test.mjs`。
- 没有 build / lint / format 步骤，也没有依赖安装步骤。不要引入运行时依赖或测试框架（只用 Node 内置模块）。
- `npm run doctor:self` 对本仓库会告警/失败：本仓库未自安装引擎（无 `.agents/`）。验证安装行为请用临时目录 `--target <tmp>`。

## 硬性约定

- 宿主能力单一来源是 `src/hosts/registry.mjs`；禁止在 `plan.mjs` / `doctor.mjs` 里为某个宿主写硬编码分支。
- `templates/host-meta/` 是动态技能指针/索引模板，遍历 `templates/hosts/<host>` 静态宿主文件时不要把它算进去。
- manifest 哈希记录**最终文本**：模板渲染、语言覆盖、模型注入全部完成后才计算；模型注入发生在 `readPlanEntry` 内、渲染与覆盖之后。
- `.agents/config/model-roles.local.json` 归用户所有：不进 manifest，升级默认不覆盖。
- 语言覆盖（`locales/<lang>/overrides/`）是整文件替换而非合并；`zh-CN` 是回退语言。
- TUI：`src/tui/screen.mjs` 是唯一接触 stdin/stdout 的模块；新增交互原语须同时实现交互路径（`runPrompt` + widget）与降级路径（`askLine`）。

## 测试约定

- `node:test` + `node:assert/strict`；安装测试在临时目录 `git init` 后 spawn CLI，并设 `FLOW_KIT_TEST=1`；TUI 测试用内存流模拟 TTY。
- 新宿主能力或安装行为 → 补 `tests/hosts.test.mjs`、`tests/install.test.mjs`、`tests/models.test.mjs`；中英文输出改动 → 同时补 `tests/en.test.mjs`。

## 仓库约定

- Conventional Commits（`feat/fix/docs/ci/...`，主题常用中文，参照 git log）。
- 发布：semver tag 必须与 `package.json` 的 `version` 完全一致，否则 CI 中止 publish；`prepublishOnly` 会重跑全部测试。
- 注意：`templates/profiles/*/AGENTS.md` 与 `locales/*/overrides/AGENTS.md` 是发给目标项目的模板（含 `{{占位符}}`），**不是**本仓库的开发规则，不要据此约束本仓库的改动。