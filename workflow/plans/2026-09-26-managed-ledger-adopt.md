---
状态: done
级别: L2
模块: pipeline
---

# PLAN — managed 台账收养 + 覆盖率检查

对应入口：../incidents/2026-09-26-managed-ledger-adopt.md
对应 spec：../specs/2026-09-26-managed-ledger-adopt.md

## 改动面

- `src/render.mjs`：新增导出 `listTree(srcRoot)` —— 只枚举模板树 rel（复用既有 `relOf` 映射与 `.agents/cache` 排除），不落盘、不算 sha；供 doctor 覆盖率检查复用同一路径映射，避免复刻漂移。
- `src/sync.mjs`：台账外文件分支加**收养判定**（`diskSha === freshFile.sha` → 登记入台账 + 报告列 `收养登记`）；文件头注释补收养语义与边界。
- `src/doctor.mjs`：新增 §4.5「台账覆盖率」检查 + 导出 `checkLedgerCoverage(target, pkgRoot)`；首次以 WARN 报，`pkgRoot/templates` 缺失或 kit.json 异常即 skipped。
- `src/cli.mjs`：doctor 调用处传入 `PKG_ROOT`（现 `doctor(argv.slice(1), PKG_ROOT)` 已传，无需改——实现时确认 `doctor()` 签名已接收 pkgRoot 并透传给 §4.5）。
- `src/sync.test.mjs`：新增 S5 场景（收养三态）+ 头部注释补场景说明。
- `templates/_agents/scripts/doctor.test.mjs`：新增 `checkLedgerCoverage` 场景（4 例）；**同步装副本** `.agents/scripts/doctor.test.mjs`。
- `.agents/commands/build.md` + `templates/_agents/commands/build.md`（双源）：双源纪律段补一句「新增 managed 类文件须经 init/sync 登记，禁手动双写绕过台账（doctor 覆盖率检查会拦）」。
- `workflow/incidents/2026-09-26-managed-ledger-adopt.md`：关单时回填修复 commit SHA。
- `workflow/papercuts.md`：对应行标注已修 + SHA。

## 任务拆解

1. `src/render.mjs` 加 `listTree(srcRoot)`
   - 判据：导出存在；对 `templates/_agents` 调用返回的 rel 集合与 `renderTree` 的 `written[].rel` 集合完全一致（同机比对断言，可临时脚本验）；`.agents/cache` 下的件不出现。
   - 风险：低（纯新增导出，不动既有 `renderTree`）。

2. `src/sync.mjs` 收养分支
   - 判据：台账外 + 盘上有 + `diskSha === freshFile.sha` → 入 `managedNew` 且 stdout 含 `收养登记` + 该 rel；台账外 + 盘上有 + sha 不等 → 仍 `本地已改，跳过`、台账不登记；台账外 + 盘上无 → 仍 `新增安装`。
   - 风险：中（收养若判据写松会把本地改动登记为包侧基线，导致下次升级静默覆盖——这是本仓库 `2026-09-24` 语义修正明确要防的方向，故判据必须严格取 sha 相等；S5 ② 专测）。

3. `src/doctor.mjs` 覆盖率检查
   - 判据：本仓库跑 `doctor` 输出中，修复前应报 `台账覆盖率` WARN 且列出 15 份（差集与实测目标集一致）；跑 `sync` 收编后该 WARN 消失；`pkgRoot/templates` 不存在时 skipped。
   - 风险：中（误报会污染所有装户 doctor 输出；WARN 级 + skipped 条件 + 已实测差集恰为 15 无噪音，三重约束）。

4. 测试补齐
   - 判据：`npm test` 全绿，且 `src/sync.test.mjs` S5 三态断言、`doctor.test.mjs` 覆盖率 4 例断言全部 PASS；S1 既有断言无一失败（防回归）。
   - 风险：低。

5. 双源件同步
   - 判据：`templates/_agents/scripts/doctor.test.mjs` 与 `.agents/scripts/doctor.test.mjs` 内容一致（`node .agents/scripts/source-sync-check.mjs --diff` 报无差异）；`build.md` 两处一致。
   - 风险：低（这正是本 incident 的题材，须以身作则经 `sync` 而非手动双写）。

6. 收编本仓库 15 份 + 全量验证
   - 判据：`node bin/flow-kit.mjs sync` 报 `收养登记` 15 份；`doctor` 11+ PASS / 0 WARN / 0 FAIL（覆盖率 WARN 已消）；`source-sync-check --diff` 无差异；`npm test` 全绿。
   - 风险：低（内容已核准 15/15 sha 相等，收养不改盘面）。

7. 关单
   - 判据：incident / spec / plan 三件状态置终态；incident 时间线回填 SHA；papercuts 行标注；`check-loop` 无新 hard-block；`gen-workflow-index.mjs` 重生成后 INDEX 无漂移。
   - 风险：低。

## 执行顺序

1 → 2 → 3 → 4（2/3 可并行开发但 4 依赖两者接口定稿）→ 5（依赖 4 的测试文件定稿）→ 6（依赖 2/3 实装）→ 7。
依赖关系：3 的应有清单实现依赖 1 的 `listTree`；6 的验收依赖 2 与 3 都已落地。

## 验证方式

- 静态门：`npm test`（本仓库全量套件：`src/{sync,init,pack}.test.mjs` + `templates/_agents/scripts/*.test.mjs`）
- 包源自检：`node bin/flow-kit.mjs doctor`（期望 0 WARN / 0 FAIL）
- L2 追加（契约 / 规则面比对）：
  - 收养边界断言：构造 `diskSha != freshSha` 的台账外文件，断言 sync 后**台账仍无该条目且盘面未被覆盖**（防 misadopt）
  - 覆盖率差集断言：本仓库跑 doctor 前 WARN 列出的 rel 集合 == 15 份目标集（逐份比对，防超集/漏集）
  - 回归断言：`sync.test.mjs` S1（台账内三态）+ `doctor.test.mjs` 既有 owned/adapter 场景全绿
- 双源一致性：`node .agents/scripts/source-sync-check.mjs --diff` 无差异

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 `draft → approved` 并回填本节（确认环节的机器可见态），`done` 只在关单出现——禁从 `draft` 直跳 `done`。

- 确认结果：approved（2026-09-26 用户对话内授权按 bootstrap 口径晋态）；done（2026-09-26 关单，随入口 incident 置终态）
- 确认门记录：本单为 bootstrap 期末日（检查项 15 确认门 2026-09-27 起生效），按前两次同例在对话内完成晋态；同次对话用户已明确指示「改 B+A」并授权晋态

## 实跑结果（实现后回填）

- `npm test`：✅ 全部套件通过；`src/sync.test.mjs` **PASS 56 / FAIL 0**（含 S14 收养三态）；`templates/_agents/scripts/doctor.test.mjs` **PASS 21 / FAIL 0**（含场景 15-18 覆盖率）；`gate-checklist.test.mjs` PASS 11 / FAIL 0
- `node bin/flow-kit.mjs doctor`：**12 PASS ｜ 0 WARN ｜ 0 FAIL**（含「台账覆盖率完整（77 份 managed 全在册）」）
- 收编实证：`sync` 报「收养登记（15）」——与 doctor 报出的缺口集合逐一对应；台账 62 → 77
- 误收养边界实证（临时克隆）：改台账外文件为本地独有内容 → sync 后 sha 保持 `80095DB7CA01` 不变、台账不登记、报「已存在未入台账」→ 本地真改动不被覆盖
- `listTree` 与 `renderTree` rel 集合：98/98 一致
- `source-sync-check --diff`：无差异 ✅
- `gen-workflow-index.mjs --check`：活跃 16 行 / 档案 75 篇 / 2661 B，与磁盘一致 ✅
- `gate-checklist --diff`：登记完整（0 断档 / 0 未登记）——§4.5 已登记为 doctor 声明独有
- `check-loop`：exit 0（无 hard-block）
