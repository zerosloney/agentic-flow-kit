---
状态: done
级别: L2
日期: 2026-09-25
模块: pipeline
备注: 2026-09-25 用户对话提出「添加类似 Claude Code dynamic workflows / ZCode workflows 的脚本编排子智能体执行」；经两轮对话拍板——形态=脚本运行时编排（runner spawn 宿主 CLI headless 会话），非主智能体现场编排；宿主适配只做现有 4 宿主，不新增 claude-code 装户适配；headless 之外的形态不做。2026-09-25 用户对话内确认 intent 要点（可以，进 spec）。
---

# INTENT — 脚本化子智能体编排（workflow 脚本 + runner）

## 背景与问题
- kit 现有子智能体体系是**单点委派**：build / maintain / test 阶段把单个已确认工作包委派给 `implementer` / `independent-reviewer` / `ui-verifier`，一次一个、主智能体逐个手动调度；多任务并行、链式「实现→独立评审→验证」、批量扫尾等场景没有编排层。
- 业界已成型的形态是**脚本运行时编排**（ZCode dynamic-workflows / Claude Code 无头编排模式）：作者写一段含控制流的脚本（串行 / 并行 fan-out / 条件 / 重试），由运行时 spawn 多个无头模型会话作为子智能体执行，中间结果类型化传递、阶段间过门禁——确定性、可复跑、可进 CI。
- kit 具备承接基础：角色契约（roles/*.md）本身就是子智能体 prompt 源；delegations.md 台账可承接执行留痕；零依赖 node 引擎与各宿主 CLI 的 headless 模式（`zcode exec` / `claude -p` / `opencode run`）是现成执行器。
- 需求来源：用户 2026-09-25 对话，两轮澄清后确认要脚本运行时编排。

## 目标
- **workflow 脚本格式**（JS ESM `.mjs`，控制流用原生 JS）：作者在脚本里用 runner 提供的编排面（agent 派单、parallel fan-out、gate 门禁、重试 / 失败策略、结构化中间结果）写确定性编排；脚本人可读可审、可 git 追溯，**须随 plan 确认后方可执行**。
- **runner 运行时**（`templates/_agents/scripts/wf-run.mjs`，sync 后 `.agents/scripts/`）：零依赖 node ≥18 直跑——解析 / 校验脚本 → 按 provider 注册表 spawn 宿主 CLI 无头会话（prompt = 角色契约 + 派单说明 + 授权文件 + 验收判据）→ 并行调度与汇聚 → 阶段门禁（gate 命令非零即阶段失败）→ 失败策略（中止 / 重试上限）→ 执行留痕写 `workflow/delegations.md`。
- **provider 注册表**（可扩展）：内置 zcode / claude / opencode 三家无头 spawn 适配（命令模板 + 输出提取，项目可覆写）；trae / omp 无 headless CLI，文档明示「不承担 provider，装有任一 provider CLI 即可跑 runner」。
- **角色契约复用**：spawn 的子智能体 prompt 一律从 `.agents/roles/*.md` 组装（角色边界、禁 commit/push、blocker 上报照旧），子智能体不跨用户确认门。
- 引擎双源纪律：全改 `templates/`，`node bin/flow-kit.mjs sync` 更新 `.agents/`；init 装户自带 runner 与 workflows 目录。

## 非目标
- 不做「主智能体现场编排」形态（此前讨论的方案A 命令）——执行形态只有 runner，避免双轨。
- 不新增 claude-code 装户适配（`.claude/` 文件）——claude 仅作为 provider CLI 被 spawn，与装户适配无关。
- 不做 TS 方言与类型检查——workflow 脚本就是 JS（零依赖红线，node ≥18 引擎兼容）；不做跨项目 / 分布式编排与可视化编辑。
- 不改变既有闭环与确认门——workflow 执行属于 plan 确认后的工作包执行环节：plan 两道确认门、红线检查、关单流程照旧；runner 不提交不推送（commit/push 仍由主智能体复核后执行）。

## 约束
- 零运行时依赖：runner 与 workflow 脚本仅用 node 内置模块；spawn 的宿主 CLI 是项目环境既有工具，非 npm 依赖。
- 规则面预算：若新增命令 / 技能卡，`.agents/commands/` 余 12445B、须控制在预算内。
- 既有测试不回归：init / sync / doctor / check-loop / S10 等用例全绿；runner 测试用 fake provider（构造命令），不依赖真实 CLI 与登录态。

## 影响面
- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md）
- [ ] 规则 / 契约变更（新增编排契约面：workflow 脚本 API + runner 语义 + provider 注册表 + 子智能体无头化口径）→ 级别至少 L2

## 验收标准（可测试）
- [x] `templates/_agents/workflows/` 落脚本格式：`_TEMPLATE.md`（API 契约 + 信任边界）+ 可执行示例；`init` 装户后项目内存在 `.agents/workflows/` 与 runner（证据：init.test.mjs ⑥ 装户面 2 例 PASS——真实模板树 renderTree 断言 runner/workflows 必装；本仓库 sync 实装 doctor 布局 PASS，实现 commit 7a9a1fd）
- [x] runner 可用 fake provider 全链路测试：串行 / 并行 fan-out / gate 失败中止 / 重试上限 / 结果汇聚 / delegations 留痕，用例进 `npm test`（证据：wf-run.test.mjs 23 例 PASS，含并发峰值恰为上限、retriesUsed、留痕行格式、--dry-run 拒非法脚本；npm test 全套件绿）
- [x] provider 注册表内置 zcode / claude / opencode / codex 四家且项目可覆写；trae / omp 口径写明（证据：providers.json + wf-run.mjs BUILTIN_PROVIDERS deep-merge；_TEMPLATE.md「trae / omp 无 headless CLI 不承担 provider」；冒烟时 codex 校准为第 4 家内置）
- [x] 真实冒烟：本仓库实跑最小 workflow（单 agent 单 gate）——链路全验证：spawn→认证→错误捕获→超时进程树强杀→门禁→退出码（证据：codex 实跑两轮，命中配额墙「usage limit」被 runner 正确捕获转为 agent 失败、超时 taskkill /T 生效、gate 42 PASS、退出码 1；成功 roundtrip 待 codex 配额恢复（2026-10-01）补跑，冒烟件 .agents/workflows/冒烟-codex.mjs 已留，plan 遗留项跟踪）
- [x] `npm test` 全绿；doctor / verify 对新增目录与文件不漂移；规则面预算门通过（证据：npm test 14 套件全绿；doctor 9 PASS 0 WARN 0 FAIL；AGENTS.md 5306B/7680B、build.md 5131B/8192B、commands 目录 37042B/49152B，pre-commit 预算门随提交通过）
