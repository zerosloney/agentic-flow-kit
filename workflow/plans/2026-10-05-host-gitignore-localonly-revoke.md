---
状态: approved
级别: L2
日期: 2026-10-05
模块: pipeline
备注: 与 intent / spec 同名配对
确认指纹: a8c84582b9c4f7a9
---
# PLAN — host-gitignore-localonly-revoke

对应入口：../intents/2026-10-05-host-gitignore-localonly-revoke.md
对应 spec：../specs/2026-10-05-host-gitignore-localonly-revoke.md

## 改动方案

- `src/profiles.mjs`：`HOSTS.zcode.localOnly` 与 `HOSTS.omp.localOnly` 由 `true` 改 `false`；表上方加注释块记录撤销日期、理由（装户口径对齐本仓 gate-coverage 返工后形态）与代价（草稿目录改由装户自管）。**这是本次唯一的行为改动**。
- `src/init.mjs`：第 4 步上方注释改为「七个宿主一律 `localOnly:false`，实际只补 `.agents/cache/`」；`giNeed` 表达式不动（仍从 `HOSTS.localOnly` 派生，保持判定单源）。
- `src/add-host.mjs`：头注释第 3 行与 `if (HOSTS[host].localOnly)` 分支注释改为「暂无宿主命中，保留是为了未来重开本机专属宿主档位不必改结构，判定单源在 `profiles.mjs#HOSTS.localOnly`」；分支代码与 `console.log` 不动。
- `src/cli.mjs`：`--hosts` 帮助文本「zcode/omp 为本地配置，自动进 .gitignore」→「七个宿主一律入库，不自动进 .gitignore」。
- `src/sync.test.mjs`：新增 `ROpt = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '')` 可选读 helper；S7 断言由 `R(...).includes('.zcode/')` 翻转为 `!ROpt(...).includes('.zcode/')`，断言名同步改为「宿主目录不再进 .gitignore（localOnly 已撤销，zcode 与其余宿主同策）」。
- `README.md`：`--hosts` 选项表说明改为「七个宿主一律入库（2026-10-05 起 zcode/omp 撤销 localOnly——换宿主不丢文件、CI 克隆面与本仓一致）」，并补「zcode 会话级液态草稿是本机态、不该入库——init 不再自动写这条规则，请自行加进 `.gitignore`（本仓实例见根 `.gitignore`）」。
- `.gitignore`：`# agentic-flow-kit` 段内保留 `.zcode/drafts/`、`.zcode/plans/` 两行（净效果与改动前一致），上方加注释「zcode 会话级液态草稿（本机态，不入库）；`.zcode/agents/` 薄适配是 managed 件，保持 tracked」。
- `templates/_agents/scripts/check-loop.mjs`（L2 独立复核 P2-1 追加，2026-10-05 用户选定本单处理）：第 507 行 `existsSync` 分支注释「本地配置不入 git：缺失不告警，存在时校验一致性」→「`.zcode/agents/` 现为入库件（2026-10-05 起宿主一律入库）；缺失只说明宿主未装，不告警，存在时校验一致性」。**仅注释，代码不动**（行为面上该分支本就因 `existsSync` 守卫而只在文件存在时执行，口径改后反而校验更严）。
- `templates/_agents/scripts/check-loop.test.mjs`（同上）：第 256 行场景 15 标题「缺失不告警(本地配置不入 git)」→「缺失不告警(宿主未装)」。**仅注释，断言不动**。
- 上述两件为 `templates/` 包源侧，按根 `AGENTS.md` 引擎双源纪律跑 `flow-kit sync` 刷新 `.agents/` 装副本与 kit.json 台账 sha（sync 覆盖更新 2 份，managed 98 份校验通过）。

> plan 偏离留痕：本次 L2 独立复核（`independent-reviewer`，基准 `5a7f293`）报 P2-1 指出上述两处旧口径；原计划另立小单，经用户在对话内选定「本单一并处理」，故回填本节与任务拆解第 6 项。

## 任务拆解

1. 改 `profiles.mjs` 判定单源
   - 判据：`grep 'localOnly: true' src/profiles.mjs` 0 命中；七个宿主表项齐全
   - 风险：低（单表数据面，两处消费点随之生效）
2. 同步四处代码注释与帮助文案
   - 判据：`grep -rn '自动进 .gitignore\|自动进 \.gitignore' src/ README.md` 0 命中残留；`init.mjs` / `add-host.mjs` 注释与新行为一致
   - 风险：低（纯文案，但漏改会让装户照抄陈旧口径——2026-09-29 p0-gate-noise-batch 同类）
3. 翻转 S7 断言并加 `ROpt` 可选读
   - 判据：`node src/sync.test.mjs` exit 0，输出「合计: PASS 56 / FAIL 0」
   - 风险：中（首次改完实测崩过 ENOENT——装户端不再创建 `.gitignore`；`ROpt` 即由此修掉）
4. 本仓 `.gitignore` 补注释
   - 判据：`git check-ignore -v .zcode/plans/<任一文件>` 有输出且指向 `.gitignore` 的 `.zcode/plans/` 行；`git ls-files .zcode` 仍返回三份 `agents/*.md`
   - 风险：低
5. 全套验证 + 独立复核
   - 判据：`src/` 八个套件 + `templates/_agents/scripts` 二十八个套件全 exit 0；`node bin/flow-kit.mjs doctor` 输出 13 PASS / 0 WARN / 0 FAIL；`independent-reviewer` 复核结论记入本 plan「确认与复核」节
   - 风险：低
6. （L2 复核 P2-1 追加）改 `templates/` 旧口径注释 + sync 刷装副本
   - 判据：`grep '本地配置不入 git' templates/_agents/scripts/*.mjs .agents/scripts/*.mjs` 0 命中；`flow-kit sync` 覆盖更新 2 份且 `kit.json` managed 98 份校验通过；`check-loop.test.mjs` 196/0
   - 风险：低（仅注释，断言与代码未动；但须走 sync 刷台账 sha，否则 check-ledger 漂移）

## 执行顺序

1 → 2 → 3 → 4 → 5 → 6。

依赖说明：1 必须最先（2/3 的文案与断言都以新行为为准）；3 依赖 1；4 与 1–3 无耦合，可并行；5 收口，须在 1–4 全部落盘后执行；6 由 5 的 L2 独立复核产出 P2-1 后追加，在 5 之后执行。

已完成情况（本次会话内已按此顺序执行完毕）：

- 任务 1–4：✅ 已完成
- 任务 5：✅ 已完成——`src/sync.test.mjs` 56/0、`init.test` 32/0、`fresh-init` 4/0、`stack-profile` 14/0、`sync-hosts` 29/0、`pack` 2/0、`gates` 12/0、`gate-dotnet-ca` 5/0、`trae-hooks` 22/0；`templates/_agents/scripts` 28 套件全 exit 0；`doctor` 13 PASS / 0 WARN / 0 FAIL。L2 独立复核已执行（`independent-reviewer`，基准 `5a7f293`）：**8/8 验收满足，无 P0/P1**，报 3 项 P2——P2-1 旧口径注释（→ 任务 6，本单处理）、P2-2 INDEX 漂移时序（已在关单前重生成闭合）、P2-3 init 侧「`.agents/cache/` 须追加」无测试断言（既有缺口，不属本单范围，不加固）
- 任务 6：✅ 已完成——两处注释改毕 + `flow-kit sync` 覆盖更新 2 份 + managed 98 份校验通过 + `check-loop.test.mjs` 196/0

> 门禁实录：任务 6 落盘后 `check-loop.test.mjs` 曾报 `PASS 195 / FAIL 1`，失败用例为「L1 plan『改动方案』节 + 证据不触及声明文件 → 仍报证据无关（负例）」——该守卫比对 plan 声明的文件清单与实际 diff，发现 `templates/` 两文件未在 plan 中声明。回填本 plan 改动方案与任务拆解后复跑 196/0。**此为守卫正确报警，非 flaky**，后续三次复跑均 196/0。

## 验证计划

- 静态门：本仓为纯 JS 脚手架包，无构建 / 无类型检查（见根 `AGENTS.md` 项目适配区）；实际静态门 = 测试套件
- 测试（`项目测试命令` = `npm test`）：本机 PowerShell 管道整跑会 OOM 且 `workflow-enums.test.mjs` 依赖 `sh -c sed`（Windows 无 sh），故按套件逐个 `node <suite>` 跑并逐个记 exit code——这是环境限制的绕行，不是对 `npm test` 脚本的修改
- 契约 / 规则面比对（L2 追加）：`grep 'localOnly: true'` 在 `src/` 与 `README.md` 0 命中；`git check-ignore` 确认本仓草稿目录被忽略且 `.zcode/agents/` 仍 tracked；`doctor` 的 managed 台账与薄适配 sha 比对 0 FAIL
- 冒烟：`node bin/flow-kit.mjs doctor` 全绿（本仓自举装户口径体检）
- 独立复核：L2 按根 `AGENTS.md` 在关单前由 `independent-reviewer` 复核（读 `.agents/roles/independent-reviewer.md`），结论记入本节

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。

- 确认结果：approved（2026-10-05 用户对话内确认，原话见 confirmations.jsonl）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 独立复核已执行（2026-10-05，子智能体 `independent-reviewer`，基准 `5a7f293`，复核范围 `git diff HEAD`，只读）

  **结论：未发现阻断问题（P0/P1 均无），intent 8 条验收标准 8/8 满足，建议放行至关单。**

  复核方确认的关键事实：
  - `localOnly` 全仓仅 `init.mjs` / `add-host.mjs` 两处消费，无第三处、无硬编码宿主名单；`sync.mjs` / `sync-hosts.mjs` / `doctor.mjs` 只用 `.dir` 不受影响
  - S7 断言**确有回归检测力**（推演 + 本方注入式实证：改回 `true` → FAIL 55/1，还原 → 56/0）；`ROpt` 未弱化断言语义
  - 实测 `flow-kit sync` 对含 `.zcode/` 旧条目的 `.gitignore` **逐字不动**——spec「不做装户迁移」与代码完全一致
  - `.agents/`、`modules/`、`templates/` 未越界（`git status` 该三处为空）；`templates/` 下 `localOnly` 0 命中，故「改 `src/` 无需 sync」前提成立
  - README 全 93 行读完，「装了什么」「设计原则」两节无残留旧说法

  复核方报出的 3 项 P2 与处置：
  - **P2-1**（旧口径注释 `check-loop.mjs:507` / `check-loop.test.mjs:256`）→ 复核方建议另立小单；**本方主张本单处理**（该文件是发给每个装户的引擎件，留旧口径即复现 2026-09-29 p0-gate-noise-batch 同类漂移），经用户对话内选定「本单一并处理」，落为任务 6，已完成
  - **P2-2**（`workflow/INDEX.md` 漂移导致 doctor 瞬时 12 PASS/1 WARN）→ 复核方指出为 plan approved 状态流转与索引生成的时序问题，非代码引入；本方在关单前重生成索引并复跑 doctor 确认 13/0/0，**已闭合**
  - **P2-3**（init 侧「`.agents/cache/` 仍须追加」无测试断言）→ 复核方定性为**既有缺口**、非本次引入，建议可选加固；本方裁定不属本单范围、**不加固**（避免范围蔓延），留待后续单处理

  复核方声明的未验证范围（据实转录）：POSIX 实机行为、真实存量装户端到端迁移、`npm pack` 清单、`templates` 其余引擎套件独立复跑、pre-commit 门禁实跑（只读约束）、check-loop zcode 分支新口径的构造实测。其中 pre-commit 一项已由本方在关单提交时实跑覆盖。
