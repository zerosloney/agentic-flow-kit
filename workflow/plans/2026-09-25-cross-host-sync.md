---
状态: approved
级别: L1
模块: pipeline
---
# PLAN — 跨宿主适配层同步工具（flow-kit sync-hosts）

<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 极简形态（2026-09-13 瘦身，L1 默认）：单/少文件微改动只填「改动面」+「验证方式」两节——改动面逐条列改哪个文件做什么（判据细节直接写进条目），验证一行静态门 + 按需 UI 实测；任务拆解/执行顺序仅 L1 多文件多步骤时保留 -->

对应入口：../intents/2026-09-25-cross-host-sync.md
对应 spec：（L1 略）

## 改动面（L1 极简形态主节）

> 共 7 类改动，下文每条带 `文件:做什么 — 判据` 三件套。引擎双源纪律（owned 手动同步）按 2026-09-25-wf-runtime 复盘单列。

**1. CLI 子命令实现（包源）**

- `src/sync-hosts.mjs`：新增 CLI 子命令实现。导出 `syncHosts(args, pkgRoot)`。功能：扫权威源 `templates/_agents/{commands,roles}/*.md` vs `modules/hosts/{zcode,opencode,trae,omp}/agents/*.md` + `modules/hosts/{opencode,trae}/commands/*.md`（trae 命令加 `wf-` 前缀映射表内置），输出 diff 报告；`--apply` 时单向同步（权威源 → 薄适配）；零依赖（仅 `node:fs` / `node:path` / `node:crypto` / `node:child_process`）。判据：`flow-kit sync-hosts --diff` exit 0 不修改任何文件；`--apply` 仅写薄适配，权威源不动。
- `src/cli.mjs`：加 `if (cmd === 'sync-hosts') { syncHosts(argv.slice(1), PKG_ROOT); return; }` 路由 + HELP 文本加 sync-hosts 子命令说明。判据：`flow-kit help` 输出含 sync-hosts 段；既有 5 个子命令路由不动。
- `src/sync-hosts.test.mjs`：新增套件测试（仿 `src/sync.test.mjs` 模式：临时 git 仓库 + 渲染模块 + sha 比对）。判据：覆盖三场景 ①权威源 vs 薄适配全对齐 → diff 空 ②权威源改了薄适配未跟 → diff 列漂移 ③apply 后 grep 比对一致。`npm test` 全绿。

**2. doctor 漂移检查（包源）**

- `src/doctor.mjs`：新增 §7.x 跨宿主薄适配漂移检查。复用 `checkOwnedDrift` 模式：扫 `templates/_agents/{commands,roles}/*.md`（权威源）vs `modules/hosts/<h>/{agents,commands}/*.md`（薄适配），按 rel 映射（含 trae `wf-` 前缀映射），漂移即 WARN（首次引入按 intent 决策 3）。判据：薄适配与权威源 sha 对齐时 PASS；漂移时 WARN 含「权威源改了，薄适配未跟」提示；doctor 既有 11 套件测试不回归。
- `.agents/scripts/doctor.test.mjs`：套件测试适配新检查项（至少 1 PASS + 1 WARN 用例）。判据：`npm test` 全绿。
- `.agents/scripts/check-loop.sh`：新增 hard-block 检查「跨宿主薄适配漂移」(与 §7.x WARN 升级路径配套；首次引入 WARN 不升 hard-block，避免误拦)。判据：`check-loop.sh` clean 不漂移。

**3. 阶段命令文件（双源纪律：owned 装副本手动同步）**

- `templates/_agents/commands/sync-hosts.md`：新增包源。frontmatter：`description: 跨宿主适配层同步（diff 报告 + 用户拍板 + 执行同步 + 自检）；stage: helper（横向工具）；triggers: 同步宿主适配层/改了角色契约要不要同步/扫一下宿主漂移；delegation: implementer 用户拍板后；approval_required: true`。正文 4 节（扫源 / diff 报告 / 拍板执行 / 自检留痕），参考 orchestrate.md 体量（≤6KB，预算门通过）。
- `.agents/commands/sync-hosts.md`：装副本（owned），内容与包源完全一致；按 2026-09-25-wf-runtime 复盘手动同步装副本。
- 判据：`templates/_agents/commands/sync-hosts.md` + `.agents/commands/sync-hosts.md` 双写内容一致；`kit.json` owned 哈希按盘面自愈（与 sync.mjs 既有策略同源）。

**4. 4 宿主薄适配同步（命令段，机械搬运）**

- `modules/hosts/zcode/agents/implementer.md` 等 3 份（zcode 宿主，agents/）：每份末尾追加 1 行「同步工具：跑 `node bin/flow-kit.mjs sync-hosts --diff` 看权威源 vs 薄适配漂移」。判据：grep "sync-hosts" 命中 zcode/agents/*.md。
- `modules/hosts/omp/agents/implementer.md` 等 3 份（omp 宿主，agents/）：同上。
- `modules/hosts/opencode/agents/{implementer,independent-reviewer,ui-verifier}.md` 3 份 + `modules/hosts/opencode/commands/{new-task,plan,design,build,test,deploy,maintain,review}.md` 8 份（共 11 份 opencode 薄适配）：每份末尾追加 1 行同口径说明。
- `modules/hosts/trae/agents/*.md` 3 份 + `modules/hosts/trae/commands/wf-*.md` 8 份（共 11 份 trae 薄适配）：每份末尾追加 1 行同口径说明（trae 命令前缀 `wf-` 已映射）。
- 判据：32 份薄适配全部含「sync-hosts」指针；grep 32 命中。
- 注意：trae 宿主额外有 `hooks/{pre-shell-check,post-edit-check,resolve-shell}.cjs` 与 `rules/*.md` 不属于"权威源派生"范畴，**不在本次同步范围**（独立演进，与本次任务无关）。

**5. AGENTS.md 常驻指令（owned 装副本手动同步）**

- `AGENTS.md`「项目适配区」末尾追加 1 行：`同步工具：flow-kit sync-hosts（diff 报告 + apply）—— 改权威源后跑 --diff 看漂移；详见 .agents/commands/sync-hosts.md`。判据：grep "sync-hosts" 命中仓库根 AGENTS.md。
- 装副本手动同步（owned，按 2026-09-25-wf-runtime 第 50 行规范条目）。判据：commit 内含根 AGENTS.md 改动。

**6. 挂载点收敛（owned 装副本手动同步）**

- `.agents/commands/build.md`：末尾加一行权威源改后跑 `flow-kit sync-hosts --diff`，确认无漂移再合入。判据：grep "sync-hosts" 命中 build.md。
- `.agents/commands/test.md`：§1 静态门加一条 doctor 含 §7.x。判据：grep "§7" 命中 test.md。
- `.agents/commands/review.md`：P1 应拦加一条「跨宿主薄适配漂移 = P1」。判据：grep "跨宿主薄适配漂移" 命中 review.md。
- 装副本手动同步。判据：commit 内含 build.md / test.md / review.md 改动。

**7. README 跨平台冒烟备注**

- `README.md`：在「快速开始」或路线段加一行备注——「跨平台冒烟由本地手测；CI 跑 Linux 即可（intent 决策 4）」。判据：grep "跨平台冒烟" 命中 README.md。
- owned 装副本手动同步。

## 验证方式

- 静态门：
  - `npm test`：跑全部 14 套件（含新 sync-hosts.test.mjs）；exit 0。
  - `node bin/flow-kit.mjs doctor`：8 PASS / 0 WARN / 0 FAIL（含新 §7.x PASS）；exit 0。
  - `sh .agents/scripts/check-loop.sh`：clean；exit 0。
- 跨宿主漂移冒烟（Linux CI 跑）：
  - 临时 git 仓库装入 kit（`init --stack node --hosts zcode,opencode,trae,omp`）→ 改 `templates/_agents/roles/implementer.md` 一行 → 跑 `flow-kit sync-hosts --diff` → 4 份薄适配漂移报告列出 → 拍板 → `flow-kit sync-hosts --apply` → grep 比对 sha 一致 → `flow-kit doctor` 仍 8 PASS。
- 跨平台冒烟：README 备注口径；本地 Windows / macOS 手测不在 CI 强制。
- L1 不要求独立复核（intent §确认与复核）。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 `draft → approved` 并回填本节（确认环节的机器可见态），`done` 只在关单出现——禁从 `draft` 直跳 `done`（2026-09-22 papercut）。
- 确认结果：approved（2026-09-25 用户对话内确认；用户对 7 段改动面 + 验证方式 + vs intent 影响面的 3 个差异点「确认」通过）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（`build.md` 两道门，逐次，不合并）
- 复核：L1 不要求独立复核