---
状态: draft
级别: L2
模块: pipeline
---

# SPEC — workflow 编排脚本宿主读取形态

对应入口：../intents/2026-09-25-wf-runtime.md

## 可行性分析（用户令分析后落档）

**结论：可行。前提 = 宿主有「读取并执行 workflow 脚本」的运行时机制**——ZCode dynamic workflows 即是（脚本提交给宿主，typecheck 通过后由宿主运行时执行，子智能体为宿主原生化派单）；Claude Code 同类机制同理。三条支柱：

1. **脚本形态 = 宿主原生**：kit 交付的编排脚本就是宿主运行时认识的格式。编排能力（并行 fan-out、依赖等待、重试循环、gate 门禁）以宿主 facade 的**真控制流**写成普通代码——确定性、类型化结果、交互提问、断点续跑都是宿主运行时既有能力，kit 不复制不自建。
2. **角色接线现成**：kit 宿主适配层本就把 `implementer` / `independent-reviewer` / `ui-verifier` 注册为宿主子智能体（如 `.zcode/agents/*.md`）——脚本按角色名派单即命中；角色契约 prompt 由脚本**内联 helper** 在运行时经 `node:fs` 读 `.agents/roles/<role>.md` 组装（宿主允许 node 内置 import，不受项目文件 import 限制——这也决定了模板必须自包含）。
3. **kit 执行权为零**：无 spawn、无自带运行时、无 LLM 解释。kit 交付的是模板、规范（gate / 留痕 / 红线约定）与装户接线——执行权 100% 在宿主，确认与权限模型用宿主的（提交时确认，与本 kit「声明随 plan 确认」纪律叠加成两道门）。

**扩展性**（用户要求「宿主使用时可自定义扩展脚本进去」）：宿主脚本本身就是全权代码——项目手写 / 改写 workflow 脚本即自定义扩展（新步骤、新控制流、接项目工具），kit 不自建 steps 机制，宿主机制即扩展机制。

**诚实边界**：没有 workflow 脚本运行时的宿主（trae / omp）不在本形态覆盖内（用户明确不管）——其继续走阶段命令既有路径（主智能体顺序自做，验收不变）。

## 功能行为

### ① 交付物：宿主原生编排脚本模板（首个 = ZCode dynamic workflows 形态）

`.agents/workflows/示例-并行实现评审.zcode.ts`——自包含 TS 脚本（不 import 项目文件），骨架：

```ts
// 提交给宿主 workflow 运行时执行（ZCode：CreateWorkflow path=本文件）；按 plan 改写后使用。
// kit 编排脚本规范：①角色 prompt 从 .agents/roles 组装 ②gate 用宿主命令设施 ③留痕追加 delegations ④随 plan 确认后执行。
import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '<项目根>'; // 提交时改写为实际项目根
const rolePrompt = (role: string, task: string, files: string[], accept: string): string =>
  [
    readFileSync(join(ROOT, '.agents', 'roles', `${role}.md`), 'utf8'),
    '# 派单', `目标：${task}`,
    `授权文件（只允许改动这些）：\n${files.map((f) => `- ${f}`).join('\n')}`,
    `验收判据：${accept}`,
    '红线：只改授权文件；禁 git commit / push；需偏离 → 输出「BLOCKER: 原因」并停止。',
  ].join('\n');

// —— 编排本体（真控制流；派单走宿主原生子智能体，按角色名） ——
// 并行两实现 → gate 测试 → 独立评审；BLOCKER 视为失败；完成后追加 delegations 留痕行（node fs）。
// …（按宿主 facade 书写 agent 派单 / 门禁 / 循环重试；本文件经宿主 typecheck 后执行）
```

（模板以宿主当前 facade 惯例书写并注明「提交前过宿主 typecheck」；facade 细节随宿主版本，由 typecheck 门兜底。）

### ② 规范（`_TEMPLATE.md` 重写）

- **四件固定约定**（跨宿主不变量）：角色 prompt 组装口径（含红线行）/ gate 门禁 / delegations 留痕（node fs 追加行，列格式与 agg-delegations 对齐）/ 随 plan 确认后执行。
- 宿主互补口径：本形态的前提是宿主有 workflow 脚本运行时；kit 不依赖、不复制宿主机制，宿主能力（交互提问 / 断点续跑）直接可用。
- 扩展指引：直接手写 / 改写宿主脚本（自定义步骤 = 写代码），模板即起点。

### ③ orchestrate.md 废止与口径改写

- 删 `templates/_agents/commands/orchestrate.md`（+ 装副本）；AGENTS.md / build.md 引用行改为「workflow 编排脚本由宿主运行时读取执行，模板见 `.agents/workflows/`」。
- 上一轮的 stages 表声明、`示例-并行实现评审.md` 被 ① 的宿主脚本模板取代。
- init.test.mjs ⑥ 装户面断言再改：workflow 模板（.zcode.ts + _TEMPLATE.md）在位；负向断言防 orchestrate.md 回流。

## 数据流

plan（已确认）→ workflow 脚本（宿主原生格式，.agents/workflows/）→ 用户提交宿主 → 宿主运行时 typecheck + 确认 → 原生子智能体派单（prompt = 内联 helper 读角色契约）→ 门禁（宿主命令设施）→ 留痕（node fs 追加 delegations.md）→ 宿主运行时汇报结果。

## 系统改动清单

- 引擎（templates/）：新增 `workflows/示例-并行实现评审.zcode.ts`；重写 `workflows/_TEMPLATE.md`；删 `commands/orchestrate.md` 与 `workflows/示例-并行实现评审.md`；AGENTS.md / build.md 引用行改写；init.test.mjs ⑥ 断言改。
- 不动：src/init·sync·doctor；宿主适配层（角色注册正是本形态的接线基础）；.githooks。收尾 sync。

## 约束遵守映射（对照 AGENTS.md 触达红线）

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 规则 / 契约变更 → L2 | 本 spec 即契约（宿主读取形态 + orchestrate 废止） |
| 零运行时依赖 | kit 只交付模板与文档；脚本仅 node 内置 import + 宿主 facade |
| 规则面预算 | orchestrate.md 删除（-3.4KB）> 模板与引用行增量，净减 |
| 子智能体不跨确认门 / 不自行提交 | 派单红线行内联模板；宿主提交确认 + plan 确认两道门 |
| 引擎双源纪律 | 全改 templates/ 后 sync |

## 风险评估

- 宿主 facade 细节随版本漂移，模板可能过时 ｜ 应对：模板注明「以宿主当前 facade 为准、提交前过 typecheck」；typecheck 是机器门
- 单日三次形态演进，引用残留 ｜ 应对：grep 全仓扫旧口径（orchestrate / runner / 声明表混写）+ 装户面负向断言
- 角色契约路径依赖项目根写死 ｜ 应对：模板 ROOT 显式标注「提交时改写」；文档提示相对推导

## 确认与复核

- 确认结果：（待确认——含可行性分析结论）
- 确认通过后起草 ../plans/2026-09-25-wf-runtime.md
