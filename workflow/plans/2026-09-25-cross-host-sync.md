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

- `src/sync-hosts.mjs`：新增 CLI 子命令实现。导出 `syncHosts(args, pkgRoot)` 与 `diffHosts({authorityRoot, adaptersRoot})`。**B-b 方案语义**（用户 2026-09-25 拍板）：薄适配 = 权威源正文 + 宿主特化 frontmatter；工具按**正文段 sha 比对（剥离 frontmatter）**；`--apply` 时单向同步（**权威源正文覆盖薄适配正文，frontmatter 保留宿主特化不动**）；不反向同步（防宿主特化污染权威源）。零依赖。判据：`flow-kit sync-hosts --diff` exit 0 不修改任何文件；`--apply` 仅写薄适配正文段，权威源 + 薄适配 frontmatter 均不动；改权威源一行 → 跑 `--apply` → 4 份薄适配正文段与权威源 sha 一致。
- `src/cli.mjs`：加 `if (cmd === 'sync-hosts') { syncHosts(argv.slice(1), PKG_ROOT); return; }` 路由 + HELP 文本加 sync-hosts 子命令说明。判据：`flow-kit help` 输出含 sync-hosts 段；既有 5 个子命令路由不动。
- `src/sync-hosts.test.mjs`：新增套件测试（仿 `src/sync.test.mjs` 模式：临时 git 仓库 + 渲染模块 + sha 比对）。判据：B-b 语义三场景 ①权威源正文 vs 薄适配正文全对齐 → inSync = N，drift 空 ②权威源改了正文薄适配未跟 → drift 列漂移（frontmatter 不计入 drift）③apply 后正文 sha 一致（frontmatter 仍保留各自宿主特化）④反向漂移：薄适配 frontmatter 手改 → 不在 drift 范围。`npm test` 全绿。

**2. doctor 漂移检查（包源）**

- `src/doctor.mjs`：新增 §7.x 跨宿主薄适配正文漂移检查。复用 `checkOwnedDrift` 模式：扫 `templates/_agents/{commands,roles}/*.md`（权威源）vs `modules/hosts/<h>/{agents,commands}/*.md`（薄适配），按正文段 sha 比对（剥离 frontmatter），含 trae `wf-` 前缀映射。**装户侧**版本同样调用：权威源 = `.agents/{commands,roles}/*.md`，薄适配 = `.zcode/.omp/.opencode/.trae` 下 `{agents,commands}/*.md`。漂移即 WARN（首次引入按 intent 决策 3）。判据：正文段对齐时 PASS；漂移时 WARN 含「权威源改了正文，薄适配正文未跟，跑 flow-kit sync-hosts --apply」提示；doctor 既有 11 套件测试不回归。
- `.agents/scripts/doctor.test.mjs`：套件测试适配新检查项（至少 1 PASS + 1 WARN 用例）。判据：`npm test` 全绿。
- `.agents/scripts/check-loop.sh`：首次引入 WARN 不升 hard-block（与 intent 决策 3 一致，避免首次装户升级时误拦）。

**3. 阶段命令文件（双源纪律：owned 装副本手动同步）**

- `templates/_agents/commands/sync-hosts.md`：新增包源。frontmatter：`description: 跨宿主适配层同步（正文 sha 比对 + 用户拍板 + 单向 apply）；stage: helper（横向工具）；triggers: 同步宿主适配层/改了角色契约要不要同步/扫一下宿主漂移；delegation: implementer 用户拍板后；approval_required: true`。正文 4 节（扫源 / 剥离 frontmatter 比对正文段 / 拍板执行 / 自检留痕），参考 orchestrate.md 体量（≤6KB，预算门通过）。
- `.agents/commands/sync-hosts.md`：装副本（owned），内容与包源完全一致；按 2026-09-25-wf-runtime 复盘手动同步装副本。
- 判据：`templates/_agents/commands/sync-hosts.md` + `.agents/commands/sync-hosts.md` 双写内容一致；`kit.json` owned 哈希按盘面自愈（与 sync.mjs 既有策略同源）。

**4. 32 份薄适配改写为权威源正文副本（B-b 方案落地）**

- 薄适配新契约：**正文 = 权威源正文，frontmatter 保留宿主特化字段**（trae commands 加 `name: wf-X`、`opencode/omp/zcode` 各自原 description 措辞、`trae/omp/zcode/agents` 原 frontmatter 风格）。
- 操作：对每份薄适配，取对应权威源正文段（前导 frontmatter 之后的 # 标题段及之后），替换薄适配的对应正文段；薄适配原 frontmatter 保留不动。
- 具体覆盖：
  - `modules/hosts/zcode/agents/{implementer,independent-reviewer,ui-verifier}.md` 3 份：frontmatter 保留 zcode 风格，正文 = `templates/_agents/roles/{...}.md` 正文段。
  - `modules/hosts/omp/agents/{implementer,independent-reviewer,ui-verifier}.md` 3 份：frontmatter 保留 omp 风格，正文同上权威源 roles。
  - `modules/hosts/opencode/agents/{implementer,independent-reviewer,ui-verifier}.md` 3 份：frontmatter 保留 opencode 风格，正文同上权威源 roles。
  - `modules/hosts/opencode/commands/{new-task,plan,design,build,test,deploy,maintain,review}.md` 8 份：frontmatter 保留 opencode 描述，正文 = templates _agents commands 同名 .md 正文段。
  - `modules/hosts/trae/agents/{implementer,independent-reviewer,ui-verifier}.md` 3 份：frontmatter 保留 trae 风格（含 name 字段），正文同上权威源 roles。
  - `modules/hosts/trae/commands/{wf-new-task,wf-plan,wf-design,wf-build,wf-test,wf-deploy,wf-maintain,wf-review}.md` 8 份：frontmatter 保留 trae `name: wf-X` + description 简化，正文 = `templates/_agents/commands/<原 name>.md` 正文段。
- 删除所有薄适配中"本文件不内联步骤副本，避免与权威版本漂移"明文（与新契约冲突）。
- trae 宿主额外 `hooks/{pre-shell-check,post-edit-check,resolve-shell}.cjs` 与 `rules/*.md` 不属于"权威源派生"范畴，**不在本次同步范围**（独立演进）。
- 判据：grep "避免与权威版本漂移" 在 32 份薄适配中 **0 命中**；`flow-kit sync-hosts --diff` 报告 **inSync = 28**（8 commands × 2 适配 + 3 roles × 4 宿主 - trae omp 不算 commands - omp/zcode 无 commands）；drift = 0。

**5. AGENTS.md 常驻指令（owned 装副本手动同步）**

- `AGENTS.md`「引擎双源纪律」段补一句薄适配新契约：`薄适配（modules/hosts/<h>/{agents,commands}/*.md）正文 = 权威源正文，frontmatter 保留宿主特化；改权威源后跑 flow-kit sync-hosts --apply 单向同步薄适配正文，详见 .agents/commands/sync-hosts.md`。判据：grep "flow-kit sync-hosts" 命中仓库根 AGENTS.md。
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
- 确认结果：approved（2026-09-25 用户对话内确认；用户对 7 段改动面 + 验证方式 + vs intent 影响面的 3 个差异点「确认」通过）
- 计划调整（2026-09-25 第二轮）：跑通工具后用户拍板 **B-b 方案**（薄适配正文 = 权威源正文 + frontmatter 保留宿主特化 + 工具按正文段 sha 比对 + apply 覆盖正文不动 frontmatter）；§1 §4 §5 已重写对齐新语义
- done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（`build.md` 两道门，逐次，不合并）
- 复核：L1 不要求独立复核