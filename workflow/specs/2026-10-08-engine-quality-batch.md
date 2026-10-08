---
状态: approved
级别: L2
日期: 2026-10-08
模块: pipeline
备注: engine-quality-batch（lint 工具链 + check-loop 头部判据下沉 + pipeline-run 拆分）
确认指纹: 70c658f6d7dac5df
---
# SPEC — engine-quality-batch

## 功能行为

本 spec 为引擎质量批，三项改动均**零用户可见行为变化**（对装户而言 kit 行为不变），变化全在开发时工具链与代码组织：

**S1 · lint 工具链（对 intent G1）**
- 场景：开发者在包源仓跑 `npm run lint` → eslint 9（flat config）扫描包源四区（src / bin / templates/_agents/scripts / modules），0 error 退出；`npm test`（run-tests.mjs）首步先跑 lint，非零整体失败。
- 范围外（ignores）：`.agents/`（managed 装副本，sync 生成物）、`modules/hosts/`（薄适配生成物 + 宿主工程件）、`**/cache/`、`workflow/`、`wiki/`、`*.test.mjs` 中的夹具字符串不特殊处理（正常 lint）。
- 边界：装户 init / `flow-kit sync` 后的环境**不新增任何依赖**——eslint 仅存于包源仓 devDependencies，`files` 打包面不含 node_modules。
- 异常：lint 报错即 npm test 失败（fail-closed，无豁免通道；豁免规则用 eslint 配置内的 `// eslint-disable-next-line` 行内标注并计入评审视野）。

**S2 · check-loop 头部判据下沉（对 intent G2）**
- 场景：读 check-loop.mjs 头部清单（1-130 行）只见「N. 标题 [severity]（实现已迁 check-hygiene.mjs）」精简行；已迁出检查项（2/9/11/12/13）的判据详注（含变更史与 incident 引用）移至 check-hygiene.mjs 对应检查实现处。
- 不变量：头部清单的 `// N. 标题 [severity]` 行**逐字保留**（编号 / 标题 / severity 与 HEAD 一致）——gate-checklist `parseCheckLoopChecks` 按 id 消费该清单（多行标题截断仅影响展示，配对按 id）；仅删除清单行下方的续行判据注并搬运。
- 未迁出检查项（1/3/4/5/6/7/8/10/14/15）的头部注释**原位不动**（判据仍在 check-loop.mjs 实现旁）。

**S3 · pipeline-run 拆分（对 intent G3）**
- 场景：`node .agents/scripts/pipeline-run.mjs <start|next|status|watch|abort>` 的入参、stdout/stderr 输出（含 `PIPELINE-STOP` 机器标记行）、exit 码与拆分前逐字节一致。
- 拆分形态（按职责层，文件均在 templates/_agents/scripts/）：
  - `pipeline-run-docs.mjs`——文档纯函数层：`placeholdersIn` / `validateDraftContent` / `closeoutComplete` / `summarizeDoc` / `sectionBody` / `fmGet`（无 IO、无 process 状态）；
  - `pipeline-run-run.mjs`——run 存储层：`ctxEnv` / `moduleList` / `runFileOf` / `loadRun` / `saveRun` / `emit` / `latestRunId` / `newRunId`（run 文件读写与事件流，run schema 不变）；
  - `pipeline-run.mjs`——CLI 编排层：五子命令入口、工单协议、`runNode` / `runGit`（进程调用）与主流程。
- 测试注入契约不变：`PIPELINE_RUN_ROOT` / `PIPELINE_RUN_BIN` / `PIPELINE_RUN_GIT_BIN` / `PIPELINE_RUN_TODAY` 四注入点行为原样；`pipeline-run.test.mjs` 断言零改动（仅 import 路径与被测模块路径随迁）。

## 数据流

- **S1**：`npm test` → `src/run-tests.mjs`（新增首步 `npm run lint`）→ `eslint.config.mjs`（flat config，`node --run lint` 或 spawnSync npm）→ 扫描四区源文件 → 0 error 继续既有套件序列，非零 `failed++` 整体 exit 1。CI 侧：`.github/workflows/ci.yml` 在 `npm test` 前补 `npm install`（当前无 install 步骤，因零依赖；引入 devDeps 后 runner 需要）。
- **S2**：纯注释文本搬运，无数据流变化；gate-checklist 对账路径不变（`gate-checklist.mjs` 读 check-loop.mjs 头部清单 → PAIRS 配对）。
- **S3**：run 数据流不变（`.agents/cache/pipeline-runs/<runId>.json` 读写 + `confirmations.jsonl` 经 confirm-doc）；仅模块边界重划：CLI 层 import docs 层与 run 层的导出符号。

## 系统改动

与 plan §任务拆解一一对应：

| # | 文件 | 改动 |
|---|------|------|
| 1 | `package.json` | +`devDependencies.eslint@^9`、+`scripts.lint`（`eslint .`） |
| 2 | `package-lock.json` | 新增入库（npm install 产物，保证 CI 可复现） |
| 3 | `eslint.config.mjs` | 新增：flat config，`js.configs.recommended` 基线 + ignores（上述范围外）+ 少量必要规则豁免（如 `no-process-exit`——CLI 脚本合法用 exit） |
| 4 | `src/run-tests.mjs` | 套件序列首位插入 lint 步骤 |
| 5 | `.github/workflows/ci.yml`（owned） | `npm test` 前补 `npm install` 步骤 |
| 6 | `templates/_agents/scripts/check-loop.mjs` | 头部清单 2/9/11/12/13 的续行判据注删除（清单行保留+短指针） |
| 7 | `templates/_agents/scripts/check-hygiene.mjs` | 对应 5 项检查实现处接收判据注（含变更史与 incident 引用） |
| 8 | `templates/_agents/scripts/pipeline-run-docs.mjs` / `pipeline-run-run.mjs` | 新增（自 pipeline-run.mjs 迁出的两层） |
| 9 | `templates/_agents/scripts/pipeline-run.mjs` | 瘦身为 CLI 编排层（import 新模块） |
| 10 | `templates/_agents/scripts/pipeline-run.test.mjs` | 仅 import / 被测路径随迁，断言零改动 |
| 11 | `.gitignore` | 无需改（node_modules/ 已在）；package-lock.json 明确**不**忽略 |

引擎双源纪律：6-10 一律改 `templates/`（包源）→ `node bin/flow-kit.mjs sync` 刷装副本与台账；4（src/run-tests.mjs）为包源仓自有文件无装副本；1-3/5 为仓库根/owned 件直接改。

## 约束遵守映射

- **零运行时依赖红线（根 AGENTS.md §4.2 引擎双源纪律 + pipeline-run 红线「零依赖」）**：eslint 仅入 devDependencies；`files` 打包面（bin/src/templates/modules/README）不含 node_modules；装户 init 后环境无 eslint 也无任何运行时 import 变化（S3 拆分模块间用相对路径 import，均为包内文件）。S1 的「新构建步骤」影响面 = 包源仓 CI 与本地 npm test，装户 CI（复跑 verify.mjs = npm test + check-loop）不新增 install 需求——verify 在装户跑的 npm test 也会先 lint？**否**：装户无 node_modules，run-tests.mjs 的 lint 步骤须容错——检测 eslint 不可用（无 node_modules）时**显式打印跳过原因**并继续（fail-open 仅限装户场景，包源仓内 lint 失败仍 fail-closed）。此容错写入 run-tests.mjs 实现并在 plan 判据中覆盖。
- **check-loop 头部清单契约（gate-checklist.md「不得增删改号」）**：S2 仅搬续行注，清单行逐字保留；改完跑 `gate-checklist.mjs --diff` 验「登记完整（0 断档 / 0 未登记）」为 plan 判据。
- **测试不 weakening（intent 约束）**：S3 允许改 import 路径不改断言；S1 对既有套件零改动（除 run-tests.mjs 加首步）。
- **新模块带测试（selfmeasure 先例，检查 20）**：S3 拆出的 docs/run 两层各带同名 `.test.mjs`？——**评估**：纯函数已由 pipeline-run.test.mjs 全量覆盖（迁 import 后继续覆盖），为新模块单建测试文件属形式主义；按「最短可工作 diff」原则不为拆分单独造测试文件，以 pipeline-run.test.mjs 绿为准。此偏离记入 plan 偏离留痕供确认。
- **常驻面预算（rule-budget）**：S2 净删注释字节（头部变薄、check-hygiene 增厚），`.agents/commands/*.md` 不触；AGENTS.md 不触。
- **L2 三段式闭环链**：docs(workflow) approved 留痕 → 代码（feat/refactor）→ 关单 docs。

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| S1 eslint 对既有 18k 行代码报大量 error（recommended 基线含 no-unused-vars 等） | 中 | 先跑 `npx eslint . --rulesdir` 干跑盘点；存量 error 用最小 disable 行内标注（非文件级禁用），一次清零不跨单累积 |
| S1 装户 npm test 因无 node_modules 误跳过 lint 造成「假绿」 | 中 | run-tests.mjs 的跳过必须**显式打印**（如 `[lint] skipped: eslint not installed (adopter env)`），包源仓内 eslint 存在但失败时不得跳过；plan 判据含两侧输出对照 |
| S2 头部清单行被误改 → gate-checklist 断档 / check-loop.test 断言红 | 低 | 清单行逐字节 diff 对照 HEAD（plan 判据）；gate-checklist --diff 验登记完整 |
| S3 拆分引入循环依赖或隐式全局共享被切断 | 低 | 分层单向（CLI→run→docs），docs 层禁止 import 另两层；pipeline-run.test.mjs 全量回归 |
| package-lock 入库后 CI 与本地 node 版本矩阵漂移 | 低 | lock 锁定包版本不锁 node；ci.yml 既有矩阵（node 18/20/22 视现状）不变 |
| 回滚难度 | 低 | 三项各自独立成 commit，可单独 revert |

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核（independent-reviewer）；实现完成后 test 阶段按 test.md §4 执行
