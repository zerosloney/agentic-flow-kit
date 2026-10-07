---
状态: approved
级别: L2
日期: 2026-10-08
模块: pipeline
备注: 关联 incidents/plans 2026-10-08-checkloop-importable（L2 防御道，incident 已含用户确认留痕）
确认指纹: c8ea2a48a33cd809
---
# SPEC — checkloop-importable

## 功能行为

**场景 A · CLI 消费者（逐字节不变）**：`.githooks/pre-push` / pre-commit 经 check-loop.sh shim → `node check-loop.mjs [--rev <sha>] [--hardening]`——输出（banner 字样/空行/`- ` 前缀/HARD-BLOCK 与 WARN 两段式/全部 WARN 文案）与退出码（blockers→1、仅 warnings→0）**逐字节一致**；`CHECK_LOOP_ROOT` / `CHECK_LOOP_GIT` 环境注入语义不变；`--rev` worktree 导出与 exit 钩子清理不变。

**场景 B · import 消费者（新能力）**：`import { runCheckLoop, delegationResultRows, versionGreater, fmStatus, bindingSha256 } from './check-loop.mjs'`——**零副作用**（不执行门禁、不退出、不打印）。`runCheckLoop(opts)` 同步返回 `{ exitCode, blockers, warnings }`：opts = `{ root?, rev?, hardening? }`；root 显式参数优先级最高（import 注入 fixture），缺省回落 `CHECK_LOOP_ROOT` env → git toplevel（与 CLI 相同解析链）；`--rev` 与 root 参数/env 互斥（同现状语义，报错文案扩展提及 root 参数）；`opts.rev` 的 worktree 导出与 exit 钩子清理在进程内可用（多次调用累计监听器，测试场景 ≤3 次可接受，注释声明）。

**场景 C · 纯零件直测**：四个模块级纯函数加 `export`——delegationResultRows(file)（表头签名识别两结果表）、versionGreater(a,b)（semver 比较）、fmStatus(text)（frontmatter 状态提取）、bindingSha256(lines, prevStatus)（done 内容绑定复原重算）。自足性已核：仅依赖参数与标准库（fs/path/crypto），不引用流程局部状态。

**边界与异常**：非 git 仓 CLI → 「不在 git 仓库内,跳过扫描」exit 0 不变；CHECK_LOOP_ROOT 不可访问 → 报错 exit 1 不变；`opts.root` 不可访问 → 同款报错 return 1；枚举文件缺失 fail-loud 不变；加固门 HARDENING 开关语义不变（pre-push 对 main 传入）。

## 数据流

- CLI：argv → takeOpts()（用法错误仍 process.exit(1)，CLI 专属）→ main 调 `runCheckLoop(opts)` → 内部解析链（root/rev/enums/kitPolicy）→ 约 1280 行检查流（blockers/warnings 数组收集 + 沿途 stderr 输出）→ 判决 return → main `process.exit(r.exitCode)`。
- import：调用方构造 opts → 同一 runCheckLoop → 返回值消费；输出流（stderr/stdout 打印）照旧发生在 run 内——「想静默自行断言返回值」的消费方需自行重定向 stderr（首版不做静默开关，YAGNI）。
- worktree（--rev）：mkdtemp + worktree add → ROOT 指向 wt → `process.on('exit')` 清理（进程级钩子，行为不变）。

## 系统改动

1. **修改** `templates/_agents/scripts/check-loop.mjs`（机械变换为主，`git diff --ignore-all-space` 实质变更约 40 行）：
   - 流程段（`:127` `const { rev: REV_ARG... } = takeOpts();` → `:1411` `process.exit(0);`）整体包进 `export function runCheckLoop(opts = {}) { ... }`（整体缩进 2 空格）；
   - 段首两行：`const REV_ARG = opts.rev ?? null; const HARDENING = !!opts.hardening;`（takeOpts 保留为 CLI 专用）；
   - 根解析插 `opts.root` 分支（优先级最高）；`REV_ARG && env` 互斥检查扩展为 `REV_ARG && (opts.root || env)`；
   - 9 处顶层 `process.exit(N);` → `return { exitCode: N, blockers, warnings };`（根/枚举解析段在 blockers/warnings 声明之前的 6 处 → `return { exitCode: N, blockers: [], warnings: [] };`）；
   - 4 个纯函数加 `export`；文件头注释补 import 契约与稳定输出契约声明；
   - 末尾新增 isMain 主守卫 CLI 入口（board-kb-p1 先例形态）。
2. **新增** `templates/_agents/scripts/check-loop-unit.test.mjs`：runCheckLoop 进程内直测（fixture：root 注入断言 exitCode 0/1 两态 + rev 互斥报错）+ 四零件单测（delegationResultRows 表头签名/节标题漂移、versionGreater 边界、fmStatus 形态、bindingSha256 prev 复原对称性）。
3. **修改** `templates/_agents/scripts/check-loop.test.mjs`：仅头部注释（:20「无 isMain 主守卫只能 spawn」改为「可 import；本套件保持端到端 spawn 作为行为回归网」）——断言零改动。
4. **修改** `workflow/papercuts.md` 2026-10-04 isMain 行：处置标注（关单批补）。
5. 实现后 `node bin/flow-kit.mjs sync`（check-loop.mjs + 两个测试文件装副本成对）。

无删除、无新依赖；门禁判据 / WARN 文案 / 检查项清单零改动。

## 约束遵守映射

| 红线 / 约束 | 本 spec 如何满足 |
|---|---|
| 稳定输出契约（pre-push/pre-commit 消费者） | 逐字节不变为硬验收：重构前后本仓实跑 stdout+stderr diff 为空（证据留存）；check-loop.test.mjs 219 断言全量保留为回归网 |
| 引擎双源纪律 | templates/ 改 → flow-kit sync 装副本成对；shipped 套件双份跑 |
| 删既有代码 STOP 线 | 零删除——纯包裹/导出/入口收敛；takeOpts 保留 |
| L2 引擎重构单独 incident（papercuts 既定路线） | incident 2026-10-08-checkloop-importable（含用户确认留痕）+ 本 spec + plan 三件套，防御道逐门确认 |
| 机械 diff 可审性 | `git diff --ignore-all-space` 为审阅主视图（实质变更 ≈40 行），复核与留痕注明该口径 |

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 包裹变换漏改某个 process.exit / 变量作用域断裂（顶层 const 变函数局部） | 中 | 变换后逐字节输出对账 + 219 断言套件 + 新 unit 套件三重网；`git diff -w` 审阅；块内所有顶层声明（blockers/warnings/kitPolicy/ENUMS/REV/ROOT 等）随包裹自然进函数作用域，函数声明提升不受影响 |
| process.on('exit') 清理在 import 多次调用下累积 | 低 | 测试场景 ≤3 次；注释声明；进程退出仍全清 |
| takeOpts 的用法错误 process.exit(1) 留在 CLI 层 | 无 | 设计如此（CLI 专属路径），unit 不触达 |
| 纯零件隐式依赖未察觉（导出后跨调用漂移） | 低 | 四件自足性逐个核过（仅参数+标准库）；unit 直测钉行为 |
| 输出契约静默漂移（banner/文案） | 低 | 本仓前后对账 diff 为空作关单证据 |

## 确认与复核

- 确认日期：
- 复核：L2 独立复核——independent-reviewer 以 `git diff -w` 主视图复核接缝变换与退出点改写（实现后、提交前）
