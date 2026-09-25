---
状态: done
级别: L2
模块: pipeline
备注: 草稿随入口同提过配对门；spec 确认通过后本 plan 才过确认门（未确认前不动代码）。
---

# PLAN — 编排执行形态修正：会话内原生子智能体 fan-out

对应入口：../intents/2026-09-25-orchestrate-in-session.md
对应 spec：../specs/2026-09-25-orchestrate-in-session.md（确认后方可执行本 plan）

## 任务拆解

1. orchestrate 命令：`templates/_agents/commands/orchestrate.md`
   - 判据：声明解析与校验（role 词表 / after 引用 / 无环）、分层调度与分批、宿主派单差异（zcode Agent 工具 / opencode agents / trae·omp fallback 顺序自做）、gate 执行、失败策略、delegations 留痕口径、纪律（随 plan 确认）；预算门通过
   - 风险：低
2. 声明面：`workflows/_TEMPLATE.md` 重写 + 示例改 .md
   - 判据：frontmatter + stages 表格式成文；示例通过解析校验（人工走查表语义）
   - 风险：低
3. 废 runner：删 templates 三件 + 装副本对应件 + 冒烟件；AGENTS.md / build.md 引用行改写；init.test.mjs ⑥ 断言改
   - 判据：`npm test` 全绿；全仓无 wf-run / providers 残留引用（grep 验证）
   - 风险：低
4. sync + 关单：`node bin/flow-kit.mjs sync`；doctor / check-loop 无漂移无断档
   - 判据：doctor 0 WARN；check-loop 干净
   - 风险：低

## 执行顺序

3（先清场）→ 1 → 2 → 4

## 验证方式

- 静态门：`npm test` 全绿；grep 无 runner 残留
- 预算门：pre-commit 规则面预算
- 闭环：test 阶段勾验 intent 验收标准后关单

## 确认与复核

- 确认结果：approved（2026-09-25 用户对话内确认，plan 草稿全文 + 改动清单两道门逐次过）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次）
