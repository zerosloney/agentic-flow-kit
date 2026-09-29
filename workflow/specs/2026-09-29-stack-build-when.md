---
状态: done
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 spec。同名 intent 已于 806efdf approved。
确认指纹: 9b6af246c0851a61
---
# SPEC — 技术栈构建门认脚本、帮助文本列全门禁

对应入口：../intents/2026-09-29-stack-build-when.md

## 功能行为

`commit-check` 的 `when` 增加谓词 `pkg:scripts.build`。它读构建项 `cwd`（缺省为仓库根）下的 `package.json`，沿点分路径取值。值是非空字符串才算满足；文件缺失、JSON 非法、键不存在、值不是字符串或只有空白，都算不满足。

`builds` 与 `checks` 共用这一判断。扩展名或前缀已经命中、但 `when` 不满足时，构建项打印 `SKIP: <name>（未找到 <谓词>，跳过构建——配置好后自动启用）`，质量检查项把「跳过构建」换成「跳过质量检查」。不执行命令，退出码仍按其余项决定。全部构建项都因 `when` 跳过时，不再额外打印「无匹配的源码变更」。`--full` 同样尊重 `when`：没有脚本就不跑，这是能力判断，不是路径过滤。

无 `when` 的构建项保持无条件执行。文件路径和尾部 `*` 通配的旧谓词仍相对仓库根做存在性判断，语义不变。

node 栈的 `builds` 带 `when: ["pkg:scripts.build"]`，命令仍是 `npm run build`。python 栈的 `builds` 改为空数组。python 的 ruff 检查、settings.json 里允许运行 pytest，都保持原样。

`flow-kit --help` 在进程启动时扫描 `modules/gates/` 的子目录，把目录名写进 add-gate 的用法行。新增门禁目录后帮助文本自动带上，不再手写「当前只有某一项」。

已装仓库的 `commit-check.config.json` 归 owned。本次不迁移旧配置。新 init 才拿到新初值。

## 数据流

`src/profiles.mjs` 的 `STACKS` → `commitCheckConfig()` → init 写入 `.agents/hooks/commit-check.config.json` → pre-commit 调用 `commit-check.cjs` 读 `when`。帮助文本不经 init，由 `src/cli.mjs` 直接读包内 `modules/gates/`。

## 系统改动清单

- 后端：`templates/_agents/hooks/commit-check.cjs`（`when` 谓词与 builds 跳过）、`src/profiles.mjs`（node / python 初值）、`src/cli.mjs`（帮助文本）
- 数据库：无
- 测试：`templates/_agents/scripts/commit-check-trigger.test.mjs`、`src/stack-profile.test.mjs`

## 约束遵守映射（对照 AGENTS.md 触达红线）

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 规则 / 契约：`when` 为提交门与技术栈配置的共享契约 | 新谓词只追加，旧的文件存在性判断不改；python 测试从提交门移出，与「测试不放提交门」对齐 |
| 引擎双源 | 钩子只改 `templates/_agents/`，sync 更新装副本 |
| 零运行时依赖 | 只使用 `node:fs` 读 JSON |

## 风险评估

- 已装 node 项目的旧配置仍会在没有 build 脚本时拦住提交。应对：spec 写明不自动迁移，README 与帮助不承诺改旧台账。
- `pkg:` 路径写错会静默 SKIP，构建不再跑。应对：SKIP 行打印完整谓词，测试锁住 `pkg:scripts.build` 字样。

## 确认与复核

- 确认结果：approved（2026-09-29 用户对话原话「可以」，仅本份）
- 复核：L2 独立复核已执行（独立上下文，基准 `8725373` → `0176eab`）。未发现阻断问题，无 P0/P1。P2×2 已采纳：`--full` 注释与 S6/S8/S9，提交 `7045ea8`。
- 关单：done（2026-09-29 用户对话原话「可以」，仅本份）
