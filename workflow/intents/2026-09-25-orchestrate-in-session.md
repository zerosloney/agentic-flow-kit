---
状态: done
级别: L2
日期: 2026-09-25
模块: pipeline
备注: 2026-09-25 用户指出方向错误（「你加的 dynamic workflows 是编排宿主执行？」）并经 AskUserQuestion 拍板「加会话内编排、废 runner」——方向确认即 intent 确认。取代 2026-09-25-subagent-orchestration 的执行形态结论（声明面与角色派单语义保留，headless runner 全废）。
---

# INTENT — 编排执行形态修正：会话内原生子智能体 fan-out 取代 headless runner

## 背景与问题
- 上一单（2026-09-25-subagent-orchestration）把「脚本编排子智能体」实现成了 **headless runner**：wf-run.mjs spawn 宿主 CLI 无头进程（codex exec / claude -p 等）当子智能体——这是「编排宿主进程」，不是用户要对标的 ZCode dynamic workflows / Claude Code 形态（**宿主运行时内、会话内原生子智能体** fan-out）。
- 根因是第二轮澄清误读：用户「应该是通过脚本编排」意指保留脚本声明形态，主智能体（宿主会话内）执行；我过度矫正成独立 node runner 进程。runner 里 provider spawn / .cmd shim / stdin 协议的全套复杂度都服务于这个错误形态。
- 会话内形态的价值：子智能体共享宿主基建（Agent 工具 fan-out、角色注册表、权限模型、上下文），无 CLI 冷启动 / 登录态 / Windows shim 问题。

## 目标
- **orchestrate 执行契约**（`.agents/commands/orchestrate.md` 新命令）：主智能体（宿主会话内）读 workflow 声明 → 按语义 fan-out 宿主**原生子智能体**（Agent 工具 / Task / opencode agents，角色 prompt 从 `.agents/roles/` 组装）→ 收敛结果 → 逐阶段 gate（终端跑命令）→ 失败策略（重试上限 / 中止）→ 汇总 + delegations.md 留痕；无子智能体宿主按 `fallback` 顺序自做，验收不变。
- workflow 声明文件保留为唯一真相源（格式按 spec 确认——声明式 stages，主智能体可解释执行）。
- **废 runner 全套**：wf-run.mjs / wf-run.test.mjs / providers.json / providers 概念 / 冒烟件全删；引用面（AGENTS.md / build.md）改写为 orchestrate 口径。

## 非目标
- 不做「主智能体解释执行任意 JS」——跨四宿主没有可靠的会话内 JS 运行时语义，声明式是诚实边界；ZCode 用户要真脚本控制流可直接用宿主原生 dynamic workflows（命令里提示）。
- 不改变确认门纪律：workflow 声明随 plan 确认后方可执行；子智能体不跨确认门、不 commit/push（照旧）。
- 不动既有闭环阶段路由（编排发生在 Build/Maintain 确认后的执行环节）。

## 约束
- 规则面预算：新增 `.agents/commands/orchestrate.md` 须在余量内（现余约 12KB）；AGENTS.md / build.md 引用行改写不超现量。
- 引擎双源：全改 templates/ 后 sync；既有测试不回归（init 装户面断言随删除同步改）。

## 影响面
- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md）
- [ ] 规则 / 契约变更（编排执行契约重定义 + runner 契约废止）→ L2

## 验收标准（可测试）
- [x] `templates/_agents/commands/orchestrate.md` 落地：声明解析、原生子智能体派单口径（含四宿主差异与 fallback）、gate、失败策略、留痕、纪律（随 plan 确认）；预算门通过（证据：orchestrate.md 3391B/单文件 8192B、commands 目录 ~40.4KB/49152B，pre-commit 预算门随提交机器复核）
- [x] workflow 声明格式定稿并有模板 + 示例（声明式，主智能体可解释）；`init` 装户自带（证据：workflows/_TEMPLATE.md + 示例-并行实现评审.md；init.test.mjs ⑥ 装户面 3 例 PASS——orchestrate 命令 / 声明两件 / 负向断言无 wf-run·providers 回流）
- [x] runner 全套移除：templates 与装副本无 wf-run*/providers 残留；引用面改口径；`npm test` 全绿（证据：git rm 9 件 + sync 出台账 4 份；grep 全仓仅 init.test 负向断言字符串；全套件绿含 ⑥ 断言修正）
- [x] doctor / verify / check-loop 对改动面无漂移无断档（证据：doctor 8 PASS 0 WARN 0 FAIL；check-loop 随 push 实跑无 advisory）
