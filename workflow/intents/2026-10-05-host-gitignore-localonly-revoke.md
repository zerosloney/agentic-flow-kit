---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-05
模块: pipeline
备注: 撤销 zcode/omp 的 localOnly——init/add-host 不再把宿主目录写进装户 .gitignore
确认指纹: eefa639334dcda52
---
# INTENT — host-gitignore-localonly-revoke

## 背景与问题

需求来源：用户 2026-10-05 会话内直接提出「.gitignore 去掉 .zcode .omp」，并选定「改产品逻辑 + 本仓」范围。

装户运行 `flow-kit init --hosts zcode,omp` 时，`src/profiles.mjs#HOSTS` 把 zcode / omp 标为 `localOnly: true`，导致 `init.mjs` 与 `add-host.mjs` 会把 `.zcode/`、`.omp/` 整目录写进装户的 `.gitignore`。而这两个目录装的是 **managed 台账件**（薄适配 `agents/*.md`）——被 ignore 后：

- 装户 `git clone` 出的 CI runner 拿不到 `.zcode/agents/*.md`，`doctor` 的 managed 台账校验与 check-loop 的跨宿主薄适配 sha 比对会失配；
- 本仓自己已经在 2026-09-27 踩过这个坑并付出过返工成本（见「历史教训」）。

本仓 `.gitignore` 原本已无 `.zcode/` 整目录条目（只剩 `.zcode/drafts/`、`.zcode/plans/` 两行草稿规则），即产品逻辑与本仓实际用法早已脱节——装户按默认 zcode 装出来的东西与本仓形态不一致，属真实口径漂移。

## 历史教训/防复发

- **kb 检索**：`kb-search.mjs "localOnly"` 命中 `workflow/intents/2026-09-23-m3-sync-addons.md`（done，L1，pipeline）——`localOnly` 档位正是该单引入的，本次是**撤销**而非重复立项。
- **本仓已付过的学费**：`workflow/intents/2026-09-27-gate-coverage.md:56` 记载——2026-09-27 独立复核抓出 P1「CI 机器门在 runner 克隆必红」，三根因之一即「`.zcode` managed 被 gitignore」，当时靠「`.zcode` 三份入库（gitignore 摘除）」修复。
- **防复发**：本次把「宿主目录一律入库」变成产品默认口径（`localOnly: false`），让装户口径与本仓一致，而不是靠本仓单独维护 gitignore 例外。代价（zcode 液态草稿需装户自管规则）已在 README 与 intent 中显式声明，不留隐性负担。

## 目标

- `flow-kit init` / `flow-kit add-host` 对 **全部七个宿主**（zcode / opencode / trae / omp / claude / cursor / codex）均不再向装户 `.gitignore` 追加宿主目录条目。
- 装户口径与本仓一致：薄适配 `agents/*.md` 入库、会话级液态草稿（`.zcode/drafts/`、`.zcode/plans/`）不入库。
- `localOnly` 字段保留在 `HOSTS` 中作为判定单源，代码分支不删除（未来若重开「本机专属宿主」档位无需改结构）。
- 既有测试全绿，`flow-kit doctor` 13 PASS / 0 WARN / 0 FAIL。

## 非目标

- 不动 `.zcode/agents/` 等薄适配正文与其 managed 台账记账（本次不动任何 `modules/hosts/**` 内容）。
- 不动会话级液态草稿机制本身（`.zcode/drafts/`、`.zcode/plans/` 的生成逻辑与使用方式不变，仅其 gitignore 归属从「产品自动写」改为「装户自管」）。
- 不删除 `localOnly` 字段，也不清理 `init.mjs` / `add-host.mjs` 中已无宿主命中的分支代码。
- 不追改历史上已按旧口径装出的装户仓库（无迁移脚本，README 已给出补救说明）。

## 约束

- 判定单源仍在 `src/profiles.mjs#HOSTS.localOnly`，两处消费点（`init.mjs`、`add-host.mjs`）继续从该表派生，不得各自硬编码宿主名单。
- 文档与代码注释同步更新：`README.md`、`src/cli.mjs` 帮助文本、`src/add-host.mjs` / `src/init.mjs` 头注释中「zcode/omp 为本地配置，自动进 .gitignore」的表述必须一并改掉，避免装户照抄陈旧口径。
- 本仓 `.gitignore` 的 `.zcode/drafts/`、`.zcode/plans/` 两行保持（本次净效果是「删后加回 + 补注释」），`.zcode/agents/*.md` 保持 tracked。
- 遵守本仓「引擎双源纪律」：本次改的是包源 `src/`，装户侧 `.agents/` 无对应件，无需 `sync`；但若后续发现 `templates/` 下有同口径文案需一并处理。

## 影响面

- 模块：pipeline
- 数据库：无（纯 CLI 行为与配置文件生成逻辑，无 schema / 迁移 / DI / 认证管线变更）
- 前端页面：无
- 受影响消费方（自查句 ≥2，命中即 L2）：
  - `src/init.mjs:247`（init 的 `.gitignore` 追加清单）
  - `src/add-host.mjs:55`（add-host 的 localOnly 分支）
  - `src/sync.test.mjs:165`（S7 既有断言，语义翻转）
  - 装户盘面：所有 `init --hosts zcode` / `init --hosts omp` / `add-host zcode|omp` 的新装项目
  - 文档面：`README.md` 选项表、`src/cli.mjs` 帮助文本

## 触达红线

- [x] 规则 / 契约变更（`HOSTS.localOnly` 是被 init/add-host/测试多处消费的宿主注册表契约；`--hosts` 参数对 zcode/omp 的行为发生变化）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3

> 触及 L2 红线，依 new-task.md 走防御道：intent + spec + plan 三件套，spec 与 plan 均须用户确认后方可推进。

## 验收标准（可测试）

- [x] `profiles.mjs#HOSTS` 七个宿主的 `localOnly` 全为 `false`（grep 断言，无 `localOnly: true` 残留）（证据：精确 grep 排除注释行后 0 命中，`src/profiles.mjs:13-21` 七项全 false；首轮 grep 报的 1 处命中经核为注释文本「原 localOnly:true」，非配置项）
- [x] 全新空 git 仓跑 `init --hosts zcode`，装户 `.gitignore` 中**不含** `.zcode/`（fresh-init 场景扩展断言或手工冒烟）（证据：TEMP 空 git 仓实跑 `init --stack none --hosts zcode` exit 0，装户 `.gitignore` 仅 `# agentic-flow-kit` + `.agents/cache/` 两行；`independent-reviewer` 独立复现同结论）
- [x] 全新空 git 仓跑 `add-host omp`，装户 `.gitignore` 中**不含** `.omp/`（证据：TEMP 空 git 仓 `init --hosts claude` + `add-host omp` 均 exit 0，`.gitignore` 仍仅两行无 `.omp/`；`.omp/agents/` 三份薄适配正常落盘——正是本次要恢复的语义）
- [x] `src/sync.test.mjs` S7 断言已翻转为「不进 .gitignore」且该套件 PASS（证据：`node src/sync.test.mjs` PASS 56 / FAIL 0；**注入式实证断言有效性**——临时改 zcode 回 `localOnly: true` 即 FAIL 55/1 并打印 `.zcode/`，还原后 56/0）
- [x] `npm test` 相关套件全绿：`src/sync.test.mjs` / `src/init.test.mjs` / `src/fresh-init.test.mjs` / `src/stack-profile.test.mjs` / `src/sync-hosts.test.mjs` / `src/pack.test.mjs` + `templates/_agents/scripts` 下 28 个引擎套件（证据：逐套件实跑 src 9 + 引擎 28 = 37 套件全 exit 0；`check-loop.test.mjs` 196/0 复跑三次稳定；`npm test` 整跑在本机因 PowerShell 管道 OOM + `workflow-enums.test.mjs` 依赖 `sh -c sed`（Windows 无 sh）不可用，属环境限制绕行，非脚本缺陷）
- [x] `node bin/flow-kit.mjs doctor` 输出 13 PASS / 0 WARN / 0 FAIL（证据：首次因 `workflow/INDEX.md` 漂移得 12 PASS / 1 WARN（复核 P2-2），跑 `gen-workflow-index.mjs` 后复跑 `doctor：13 PASS ｜ 0 WARN ｜ 0 FAIL`）
- [x] `README.md` 与 `src/cli.mjs` 帮助文本无「自动进 .gitignore」陈旧表述，且含草稿目录自管提示（证据：正向 grep「为本地配置」在 README/cli/init/add-host 四处 0 命中；`README.md:57` 与 `src/cli.mjs:49` 现口径一致；复核方读完 README 全 93 行确认「装了什么」「设计原则」两节无残留矛盾说法）
- [x] 本仓 `.gitignore` 含 `.zcode/drafts/`、`.zcode/plans/` 两行，且 `git check-ignore` 确认 `.zcode/plans/` 生效、`.zcode/agents/*.md` 仍为 tracked（证据：`git check-ignore -v` → `.gitignore:7:.zcode/plans/` 命中；`git ls-files .zcode` 返回三份 `agents/*.md`；`git check-ignore .zcode/agents/implementer.md` 空输出即未被忽略）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截。

## 确认与复核

- 确认日期：2026-10-05
- 确认人：用户（对话内明确放行即确认）
- 确认范围：级别定档 L2、走防御道三件套
- 复核：L2 要求独立复核（见同名 plan 与 spec）
