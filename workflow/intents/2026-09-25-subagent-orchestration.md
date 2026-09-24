---
状态: approved
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
- [ ] `templates/_agents/workflows/` 落脚本格式：`_TEMPLATE.md`（API 契约 + 编排面参考）+ 至少一个可执行示例脚本；`init` 装户后项目内存在 `.agents/workflows/` 与 runner
- [ ] runner 可用 fake provider 全链路测试：串行 / 并行 fan-out / gate 失败中止 / 重试上限 / 结果汇聚 / delegations 留痕，用例进 `npm test`
- [ ] provider 注册表内置 zcode / claude / opencode 适配且项目可覆写；trae / omp 口径写明
- [ ] 真实冒烟：本仓库用 zcode provider 实跑一条最小 workflow（单 agent 单 gate），产出留痕
- [ ] `npm test` 全绿；doctor / verify 对新增目录与文件不漂移；规则面预算门通过
