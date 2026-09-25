---
状态: done
级别: L2
模块: pipeline
---

# SPEC — 编排执行形态修正：会话内原生子智能体 fan-out

对应入口：../intents/2026-09-25-orchestrate-in-session.md（取代 2026-09-25-subagent-orchestration 的执行形态结论）

## 功能行为

### ① workflow 声明文件（`.agents/workflows/<主题>.md`，frontmatter + stages 表，声明式）

> 形态取舍：ZCode dynamic workflows 是真 TS 脚本——那是宿主运行时能力。kit 要跨四宿主（zcode/opencode/trae/omp），主智能体解释执行任意 JS 不可靠，**声明式是诚实边界**；ZCode 用户要真脚本控制流直接用宿主原生 dynamic workflows（orchestrate 命令内提示）。

```md
---
name: 并行修两域
description: 后端+前端并行实现 → 汇聚过测试 → 独立评审
concurrency: 2          # 同层并行派单上限（主智能体分批 fan-out 依据）
---
# workflow — 并行修两域

| id | after | role | task | files（授权） | accept（验收判据） | gate | retries |
|----|-------|------|------|--------------|-------------------|------|---------|
| backend | — | implementer | 实现后端 X | src/api/** | 项目测试过 | | 0 |
| frontend | — | implementer | 改前端 Y | web/** | 构建过 | | 1 |
| gate-all | backend,frontend | — | — | — | — | npm test | |
| review | gate-all | independent-reviewer | 评审两域改动 | | 符合 plan 与判据 | | 0 |
```

语义：`after` 空 = 首层并行；有 after = 等依赖 stage 全 ok 才派；`gate` 行跑 shell 命令，非零 = 中止（retries>0 的 stage 失败重派，全新会话）；`role` 必须 ∈ `.agents/roles/`。**文件随 plan 草稿一并确认后方可执行**（纪律与旧 spec 同）。

### ② orchestrate 命令（`templates/_agents/commands/orchestrate.md` 新增）

主智能体（宿主会话内）执行，不是外部进程：

1. **解析**：读声明文件 frontmatter + stages 表；校验（role 词表、after 引用存在、无环）——解析失败即拒，不执行。
2. **分层调度**：按 after 依赖分层；每层内 stage 数 > concurrency 时分批；**同批 stage 用宿主原生子智能体并行 fan-out**——派单 prompt = `.agents/roles/<role>.md` 契约全文 + 派单头（task / files 授权清单 / accept 判据 / context 必读）+ 红线行（禁 commit/push、超范围 BLOCKER 上报）。
   - 宿主差异：zcode = Agent 工具（subagent_type 按角色）；opencode = agents；trae / omp 无原生子智能体 → 命令明示 fallback：主智能体按层**顺序自做**，验收标准不变。
3. **收敛**：每个子智能体返回改动清单 / 验证结果 / blocker；主智能体复核 diff 与授权范围（与 build.md 既有约定同口径）。
4. **gate**：gate 行由主智能体在终端跑命令，非零 → 按声明中止或降级（无声明 → 中止报告）。
5. **留痕**：每个派单 stage 完成后向 `workflow/delegations.md` 委派结果表追加一行（主智能体写，口径与 agg-delegations 对齐：一次通过 / 返工×N / 返工待修）。
6. **汇总**：全部层完成后输出汇总（各 stage ok / 重试 / gate 结果），退出时主智能体报告失败项。

### ③ 废止与移除（runner 全套）

- 删：`templates/_agents/scripts/wf-run.mjs`、`wf-run.test.mjs`、`templates/_agents/workflows/providers.json`、`.agents/workflows/冒烟-codex.mjs`（本仓库装户侧）、装副本对应件。
- 改写：`templates/_agents/workflows/_TEMPLATE.md`（provider / runner / stdin 概念全删，改声明式格式 + 会话内执行说明）；`templates/_agents/workflows/示例-并行实现评审.mjs` → `示例-并行实现评审.md`（声明式）；`templates/AGENTS.md` 与 `templates/_agents/commands/build.md` 引用行改 orchestrate 口径。
- 测试改：init.test.mjs ⑥ 装户面断言（runner → orchestrate 命令 + workflows 模板/示例）；wf-run 相关用例随文件删除。
- 上一单遗留项「codex 配额恢复后补跑冒烟」随 runner 废止而作废（在新 intent 已注取代关系）。

## 数据流

plan（已确认）→ workflow 声明（.md）→ orchestrate 命令（主智能体执行）→ 分层 → 宿主原生子智能体 fan-out（prompt = 角色契约 + 派单头）→ 结果收敛复核 → gate（终端）→ delegations.md 留痕 → 汇总报告。

## 系统改动清单

- 引擎（templates/，包源）：新增 `commands/orchestrate.md`；重写 `workflows/_TEMPLATE.md`；示例改 .md；删 runner 三件；AGENTS.md / build.md 引用行改写；`src/init.test.mjs` ⑥ 断言改。
- 不动：`src/init.mjs` / `src/sync.mjs` / doctor（整树拷贝与必检清单自动适配——wf-run 不在 doctor 必检清单）；`.githooks`（预算门照常）；宿主适配层四家。
- 收尾 `node bin/flow-kit.mjs sync`；装户侧冒烟件删除。

## 约束遵守映射（对照 AGENTS.md 触达红线）

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 规则 / 契约变更 → L2 | 本 spec 即契约重定义（声明格式 + orchestrate 语义 + runner 废止），确认后起草 plan |
| 规则面预算 | orchestrate.md 新增控制在余量内（~4KB / 余 12KB）；AGENTS.md / build.md 改写不超现量 |
| 子智能体不跨确认门 / 不自行提交 | 派单红线行 + 角色契约双保险照旧；声明随 plan 确认后执行 |
| 引擎双源纪律 | 全改 templates/ 后 sync，不直改装副本 |

## 风险评估

- 主智能体对声明语义的执行保真度（分层/分批/重试）无机器强制 ｜ 应对：命令里给「逐层执行清单」结构化步骤 + 声明格式刻意简单（一张表）；delegations 留痕与 gate 输出可事后核对
- 无原生子智能体宿主（trae/omp）顺序自做变慢 ｜ 应对：命令明示该口径，属既有 fallback 文化
- 删 runner 后 CI/headless 场景失去编排能力 ｜ 应对：非目标（用户拍板废）；后续需要再立 intent

## 确认与复核

- 确认结果：approved（2026-09-25 用户对话内确认——声明式 stages 表 + 会话内原生子智能体执行 + runner 全废）
- 确认通过后起草 ../plans/2026-09-25-orchestrate-in-session.md
