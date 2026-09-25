---
description: Orchestrate 阶段:会话内编排执行已确认的 workflow 声明(原生子智能体 fan-out)
stage: Build
triggers:
  - "跑下编排"
  - "执行 workflow"
  - "编排执行"
approval_required: true
next: .agents/commands/test.md
---

# Orchestrate · 会话内编排执行

> 主智能体（宿主会话内）读 workflow 声明，分层 fan-out **宿主原生子智能体**执行——不是外部进程。声明格式见 `.agents/workflows/_TEMPLATE.md`。

## 前置纪律

- **声明文件随 plan 确认后方可执行**：workflow 声明是 plan 任务拆解的执行器，随 plan 草稿一并过目确认；未确认只可走查校验、不得派单。
- 编排不跨确认门：stages 派单内容须在已确认 plan 范围内；公共接口 / Schema / 依赖 / 安全 / 权限 / 破坏性操作不得进 stages（红线与 `build.md` 同）。
- 声明式是跨宿主诚实边界；宿主有原生脚本编排能力（如 ZCode dynamic workflows）且需要真控制流时，直接用宿主原生能力，不必硬套本命令。

## 执行

1. **解析校验**：读声明 frontmatter（`name` / `concurrency`）+ stages 表；校验 role ∈ `.agents/roles/`、`after` 引用存在、依赖无环、gate 行 role 为空——任一不过即拒并报原因，不执行。
2. **分层调度**：`after` 为空 = 第 0 层；某层全部 ok 后才派依赖它的下一层；层内 stage 数超过 `concurrency`（默认 2）时分批。
3. **派单**（每个 stage）：prompt = `.agents/roles/<role>.md` 契约全文 + 派单头（task / files 授权清单 / accept 验收判据 / context 必读材料）+ 红线行（只改授权文件；禁 git commit / push / reset --hard；缺输入或需偏离 → 返回 `BLOCKER:` 停下，不扩大范围）。同批并行派单：
   - zcode：Agent 工具（按角色 subagent_type）；opencode：agents——**原生子智能体 fan-out**
   - trae / omp 或宿主不支持子智能体：主智能体按层**顺序自做**，验收标准不变
4. **收敛复核**：每个子智能体返回后，检查 diff 与授权文件范围、确认未覆盖既有修改并重跑相关验证（与 `build.md` 委派约定同口径）；返回 BLOCKER 的 stage 停住待处置，不计重试。
5. **gate**：gate 行由主智能体在终端跑命令（口径同 test.md 静态门）；非零 → 中止并报告（除非已确认 plan 另有降级约定）；gate 通过才派 after 依赖它的层。
6. **失败策略**：stage 失败且 `retries` > 0 → 全新派单重试至上限；重试超限或依赖层失败 → 中止后续、汇总报告。
7. **留痕**：每个派单 stage 完成后向 `workflow/delegations.md` 委派结果表追加一行（`一次通过` / `返工×N` / `返工待修`，口径与 agg-delegations.cjs 对齐；BLOCKER / 超时记返工待修）。
8. **汇总**：输出各 stage ok / 重试 / gate 结果表与失败项，向用户报告；有失败不得宣称完成。

## 子代理调用约定

- 子智能体不跨用户确认门、不替用户批准、不自行提交；提交由主智能体复核 diff 后执行。
- stages 表即授权面：`files` 列为空视为只读侦察任务（派单头明示「不改动任何文件」）。

## 完成后

- 全 stage 过 → 报告汇总并进 `next: .agents/commands/test.md`（关单仍在 test，编排结果照常走勾验）。
