---
状态: draft
级别: L2
日期: 2026-09-25
模块: pipeline
备注: 2026-09-25 用户在形态对比后拍板——「不要管其他宿主有没有、不依赖宿主，运行时形态应该是 kit 通用能力，宿主使用时可自定义扩展脚本进去」；AskUserQuestion 确认：废 orchestrate（运行时唯一执行形态）、扩展 = 自定义 step 目录 + 脚本级自由。取代 2026-09-25-orchestrate-in-session 的执行形态结论（该单产物 orchestrate.md 将删除）。
---

# INTENT — 编排运行时扶正：kit 自有通用运行时 + 自定义步骤扩展

## 背景与问题
- 本单是同日第三轮形态演进：subagent-orchestration（headless runner，被否）→ orchestrate-in-session（主智能体解释声明表）→ 用户看形态对比后定调：Claude Code / ZCode 的 dynamic workflows 之所以强，是因为有**真运行时**（脚本真控制流、确定性执行、运行中交互）——这套运行时形态应当是 **kit 自有的通用能力**，不因「某宿主没有」而降级为 LLM 解释执行，也不依赖宿主自身的编排机制。
- orchestrate.md（LLM 解释声明表）与运行时重叠且保真度低，按用户拍板废止——运行时是唯一执行形态。
- 被废的 headless runner（git 6d6e239，含独立复核全部修复：stdin 传输、批处理 fail-fast、settleAll 收尾、台账列口径、正则负例等）正是运行时形态的半成品，本次**扶正为正式能力并补扩展机制**，不推倒重来。

## 目标
- **编排运行时**（kit 自有，`templates/_agents/scripts/wf-run.mjs` 从 6d6e239 复活）：workflow 脚本（JS ESM `.mjs`，零依赖）带真控制流（循环 / 条件 / `wf.parallel` fan-out / `retries` / `wf.gate` 门禁），运行时确定性执行；子智能体 = 宿主 CLI 无头会话（provider 注册表，stdin 传输协议，**不依赖宿主原生编排能力**）；留痕 delegations.md；`--dry-run` 校验；脚本随 plan 确认后执行。
- **自定义步骤扩展**（用户新要求）：`.agents/workflows/steps/<名>.mjs` 导出 `async (ctx, params)`，运行时自动加载，脚本 `await wf.step('<名>', params)` 调用——项目可把自己的领域动作（部署、迁移、审计上报等）注册进编排机制；workflow 脚本本身亦可 import 项目任意本地模块（两层扩展，信任边界同脚本、文档明示）。
- **宿主关系口径**：运行时不依赖宿主编排能力；宿主自带 dynamic workflows（ZCode / Claude Code）且需要会话内交互、断点续跑时可直接用宿主能力——互补不互斥，文档写明。
- 引擎双源纪律与既有测试不回归照旧。

## 非目标
- 不做 TS 方言与类型检查（零依赖红线，JS 直跑）；不做运行中断点续跑 / 后台任务管理 / 运行中向用户提问（那是宿主运行时的增量，需要时另立）。
- 不做 provider 之外的执行器抽象（会话内执行器等）——CLI 无头会话是本期唯一子智能体通道。
- 不复辟 orchestrate.md（LLM 解释执行声明表）——已按拍板废止。

## 约束
- 零运行时依赖（node 内置模块 only，node ≥ 18）。
- 规则面预算：orchestrate.md 删除释放 ~3.4KB，runtime 无新增命令面；引用行改写不超现量。
- incident 2026-09-25-wf-run-review-fixes 的全部修复与回归用例随复活带回，回归清单条目继续有效。

## 影响面
- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md）
- [ ] 规则 / 契约变更（编排执行契约再次重定义：运行时唯一形态 + steps 扩展点 + orchestrate 废止）→ L2

## 验收标准（可测试）
- [ ] `templates/_agents/scripts/wf-run.mjs` + `wf-run.test.mjs` 复活（全部 incident 修复与 34 例用例回归绿），并新增 steps 扩展：steps 目录加载、`wf.step()` 调用、step 抛错进脚本异常路径——各配自动化用例
- [ ] `providers.json` 回归（zcode / claude / opencode / codex，stdin 形态）；providers.local.json 覆写口径随文档回归
- [ ] `orchestrate.md` 删除（templates + 装副本）；AGENTS.md / build.md 引用行改 runtime 口径；`_TEMPLATE.md` 重写（运行时 + steps 扩展 + 宿主互补口径）；示例脚本恢复为 .mjs
- [ ] `npm test` 全绿（init 装户面断言改：runner + steps 扩展点在位、orchestrate 不回流）；doctor 0 WARN；预算门通过
