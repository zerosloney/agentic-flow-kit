---
状态: done
级别: L1
日期: 2026-09-25
模块: pipeline
备注: L1（新增 CLI 子命令 + 新增 .agents/commands/ 阶段命令文件；不改既有接口语义、不改既有契约字段；新装户装时随 templates/ 落 managed 台账）。落地期间与 plan 同步调整为 B-b 方案（薄适配正文 = 权威源正文 + frontmatter 保留宿主特化），见 plan §确认与复核
---
# INTENT — 跨宿主适配层同步工具（flow-kit sync-hosts）

<!-- 复制本模板为 YYYY-MM-DD-<主题>.md 后填写；plans/ 下同名文件与本文件配对 -->
<!-- frontmatter 受限子集（2026-09-13）：每行 `键: 值`；状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行 -->

## 背景与问题

- 引擎权威源在 `templates/_agents/{commands,roles}/*.md`，每文件被 2~4 宿主薄适配消费（`modules/hosts/{zcode,opencode,trae,omp}/agents/*.md` 与 `modules/hosts/{opencode,trae}/commands/*.md`；trae 命令加 `wf-` 前缀、omp 无 commands 薄适配）——共 32 份薄适配。
- 改一处权威源要手动复制到 N 份薄适配，否则**装户侧 agent 宿主拿不到新行为**；同类事故已发生多次：
  - `2026-09-23-cjs-ext-in-typemodule` —— CJS 改名 5 文件，引用点 8 处手动同步；
  - `2026-09-24-p4-sweep` —— trae 钩子 3 份 + 引用 6 处手动同步；
  - `2026-09-25-wf-runtime` —— owned 漂移（含宿主适配层同类）首次系统性上报。
- 现在没有自动化工具：每次改 `templates/_agents/roles/implementer.md` 就要人工 git diff `modules/hosts/{zcode,opencode,trae,omp}/agents/implementer.md` × 4；改 `templates/_agents/commands/build.md` 就要人工 diff `modules/hosts/opencode/commands/build.md` + `modules/hosts/trae/commands/wf-build.md`。高重复、易漏、AI 最擅长干。

## 目标

- **新增 `flow-kit sync-hosts` CLI 子命令**：扫权威源 vs 4 宿主薄适配 → 输出漂移报告 → 用户拍板 → 执行同步 → 自检 → 留痕。
- **doctor 新增检查项**：跨宿主薄适配漂移即 FAIL（类比已有 6.6 owned 漂移 FAIL 的语义）。
- **新 `.agents/commands/sync-hosts.md` 阶段命令**（templates 权威源 + 装副本双写，owner 文件双源纪律按 2026-09-25-wf-runtime 复盘手动同步）+ 4 宿主薄适配同名命令文件（按各自宿主格式）。
- **挂载点收敛**：build.md 末尾加一条权威源改后跑 `flow-kit sync-hosts --diff`；test.md §1 静态门加一条 `flow-kit doctor` 含 7.x 检查；review.md P1 加一条「跨宿主薄适配漂移 = P1」。
- **判定**：用户改一处权威源 → 跑 `flow-kit sync-hosts --diff` → AI 列漂移 → 用户拍板 → 同步 → grep 自检 → 关单。这条链路可重复使用且不漏。

## 非目标

- 不改既有 `flow-kit init` / `sync` / `add-host` / `add-gate` / `doctor` 子命令的接口与行为。
- 不改 `templates/_agents/commands/*.md` 与 `modules/hosts/<h>/commands/*.md` 之间的"薄适配≠简单复制"语义（薄适配可包含宿主特化的指令行、命令前缀、fallback 标注；本工具只负责"权威源改了提示同步"，不做语义改写）。
- 不替代 `flow-kit sync` 的 managed 台账逻辑——sync-hosts 只管"权威源 vs 薄适配"这一对，不动 kit.json。
- 不动 omp 宿主（`modules/hosts/omp/` 只有 agents/ 3 份无 commands/，按既有事实保持）。
- 不引入新依赖（保持零运行时依赖纪律）。

## 约束

- **CLI 表面扩展**：新增 `flow-kit sync-hosts` 子命令，`src/cli.mjs` 路由 + `HELP` 文本同步加；不改既有子命令。
- **零依赖**：复用 `node:fs` / `node:path` / `node:crypto` / `node:child_process`，不引第三方包。
- **常驻面体积预算**：`.agents/commands/sync-hosts.md` ≤ 6KB（参考 orchestrate.md 3.4KB 现状；新文件占预算余量；`rule-budget.sh --staged` 校验）。
- **引擎双源纪律**：新增 `.agents/commands/sync-hosts.md` 在 `templates/_agents/commands/sync-hosts.md`（包源）+ 仓库根 `.agents/commands/sync-hosts.md`（装副本）双写；按 `2026-09-25-wf-runtime` incident 第 50 行规范条目——`templates/` 改后手动同步装副本，commit 内一并落地。
- **doctor 不漂移**：`flow-kit doctor` 新增 7.x 检查项后，PASS/WARN/FAIL 计数与现有 §6.6 owned 检查一致；既有 11 套件测试不回归。
- **跨平台**：Windows / macOS / Linux 均可跑（与 `ensure-board.mjs` 同源纪律）；不自创 `.ps1` / `.sh` 分叉。

## 影响面

- 模块：pipeline
- 数据库：无
- 前端页面：无
- 新增/修改文件（计划在 plan 中精确列）：
  - `src/sync-hosts.mjs`（新增，CLI 子命令实现）
  - `src/cli.mjs`（修改，加 sync-hosts 路由 + HELP 文本）
  - `src/sync-hosts.test.mjs`（新增，套件测试）
  - `src/doctor.mjs`（修改，新增 §7.x 跨宿主漂移检查）
  - `.agents/scripts/doctor.test.mjs`（修改，套件测试适配新检查项）
  - `.agents/commands/sync-hosts.md`（新增，阶段命令描述——owned 双写）
  - `templates/_agents/commands/sync-hosts.md`（新增，包源）
  - `modules/hosts/{zcode,opencode,trae,omp}/agents/implementer.md` 等 12 份（修改，加 sync-hosts 章节或说明）
  - `modules/hosts/{opencode,trae}/commands/{...,wf-...}.md` 等 16 份（同上）
  - `AGENTS.md`（修改，「项目适配区」命令预填加一行 sync-hosts 入口；装副本手动同步）
  - `.agents/commands/build.md`（修改，末尾加权威源改后跑 sync-hosts --diff）
  - `.agents/commands/test.md`（修改，§1 静态门加 doctor 含 7.x）
  - `.agents/commands/review.md`（修改，P1 加跨宿主漂移）
  - 装副本对应件（按双源纪律手动同步）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3

> 本 intent 不触及上述任一红线——新增 CLI 子命令 + 新增命令文件不修改既有接口语义、不修改既有契约字段；新装户装时随 templates/ 落 managed 台账走既有约定。故 L1 立项，不立 spec。

## 验收标准（可测试）

- [x] `node bin/flow-kit.mjs sync-hosts --diff` 在临时仓库内执行：扫描权威源 vs 4 宿主薄适配 → 输出漂移报告（每条带 file:line + 改前/改后 sha），不修改任何文件，exit 0。
（证据：commit 95c2a13；src/sync-hosts.test.mjs 场景 S1/S2 PASS；B-b 语义下报告按正文段 sha 比对剥离 frontmatter）
- [x] `node bin/flow-kit.mjs sync-hosts --apply` 在已知漂移的临时仓库执行：仅同步「权威源改了而薄适配未跟」的方向，不动反向漂移（薄适配手改未回流权威源），不重排薄适配顺序；执行后 grep 比对权威源 vs 薄适配 sha 一致，exit 0。
（证据：commit 95c2a13；src/sync-hosts.test.mjs 场景 S3 PASS「opencode 正文已同步到 v2」「trae 正文已同步到 v2」「权威源不动」；场景 S5「apply 不污染权威源」；B-b 方案下 apply 保留薄适配 frontmatter 不动）
- [x] `node bin/flow-kit.mjs sync-hosts` 无参数时：默认走 `--diff`（防误操作）并在 HELP 文本明示。
（证据：src/sync-hosts.mjs `if (a === '--diff') apply = false` 初值 + sync-hosts.test.mjs 场景 S1 验证；HELP 文本含 sync-hosts 子命令）
- [x] `flow-kit doctor` 新增 §6.7 跨宿主漂移检查：装副本薄适配与 templates 权威源 sha 一致时 PASS；不一致时 WARN（首次引入按 wf-runtime 复盘「先 WARN 升级 FAIL」路径，与 intent 决策 3 一致）；doctor 既有测试不回归（`templates/_agents/scripts/doctor.test.mjs` + `src/sync.test.mjs` + `src/init.test.mjs` 等全绿）。
（证据：commit 95c2a13；src/doctor.mjs §6.7 + checkAdapterDrift；doctor.test.mjs 场景 9-14 共 6 个 PASS；doctor 报「跨宿主薄适配校验跳过（包源环境……§7.x 仅在装户环境有意义）」正确分流）
- [x] `templates/_agents/commands/sync-hosts.md` + 仓库根 `.agents/commands/sync-hosts.md` 双写内容一致；`kit.json` owned 哈希按盘面自愈（与 sync.mjs 既有策略同源）。
（证据：commit 95c2a13；两份文件 3874B 一致；`flow-kit sync` 报告「owned 台账哈希按盘面刷新 1 份」+ 后续 doctor 报「owned 16 份无漂移」）
- [x] `npm test` 全绿（src/ 下 4 套件：sync-hosts 26 + doctor 16 + sync 48 + init 23 = 113 PASS；templates/_agents/scripts/ 下 13 套件 doctor 等；Windows 无 sh 环境 check-loop.test.sh 跳过）。
（证据：commit 95c2a13；4 套件实测 113/113 PASS）
- [x] `flow-kit doctor` 10 PASS / 0 WARN / 0 FAIL（含新 §6.7）；`check-loop.sh` 干净（17 → 14 条 advisory 警告，全是既有项）。
（证据：commit 95c2a13；doctor 实测输出 10 PASS / 0 WARN / 0 FAIL）
- [x] AGENTS.md「引擎双源纪律」段加 B-b 同步工具说明：薄适配正文 = 权威源正文 + frontmatter 保留宿主特化 + `flow-kit sync-hosts --apply` 单向同步；既有项目适配区命令不动。
（证据：commit 95c2a13；AGENTS.md 第 51 行新增项）
- [x] build.md / test.md / review.md 加挂载点：build.md「改权威源后必跑」段、test.md §1 静态门加 `flow-kit doctor`、review.md P1 加「跨宿主薄适配正文漂移」；包源 + 装副本同步双写。
（证据：commit 95c2a13；templates/_agents/commands/build.md / test.md / review.md + .agents/commands/ 装副本各 3 份同步）
- [x] 跨平台冒烟：CI 跑 Linux 即可，Windows / macOS 由 README 备注口径（intent 决策 4）；README.md 路线补 v0.5.0 含跨平台备注。
（证据：commit 95c2a13；README.md 第 67 行「跨平台冒烟由 CI 跑 Linux，Windows / macOS 由本地手测（不入 npm test）」）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 warning。

## 确认与复核

- 确认日期：2026-09-25
- 确认人：用户（对话内一句"可以"即确认；后续拍板 A 推进方案 + B-b 落地语义）
- 确认范围：intent 整体 + 4 个关键决策点拍板：
  1. **L1 立项**（不改既有接口语义、不触红线）
  2. **单向同步**（B-b 方案落地：仅按权威源正文覆盖薄适配正文段，frontmatter 保留宿主特化不动；不反向同步避免宿主特化污染权威源）
  3. **doctor §6.7 检查首次引入为 WARN**（与 `2026-09-25-wf-runtime` 复盘「先 WARN 装户吃过警告后升级 FAIL」同源路径），后续视装户反馈升级 FAIL
  4. **跨平台冒烟**：CI 跑 Linux 即可，Windows / macOS 冒烟由 README 备注口径（不强制）
- 关单 commit：95c2a13（feat(pipeline): 跨宿主适配层同步工具 + doctor §6.7；47 文件，2214 行）
- 复核：L1 不要求独立复核