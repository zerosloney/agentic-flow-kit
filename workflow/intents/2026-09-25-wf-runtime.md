---
状态: draft
级别: L2
日期: 2026-09-25
模块: pipeline
备注: 同日第三轮形态定音（runner 被否 → orchestrate 被否）。2026-09-25 用户定调：「也不是让 kit 用 CLI 执行子智能体——kit 的脚本要**支持让宿主读取**，而脚本本身带编排能力；分析可行后落文档」。AskUserQuestion 前置确认仍有效：废 orchestrate、扩展 = 宿主脚本天然自由（kit 不自建 steps 机制）。
---

# INTENT — workflow 编排脚本宿主读取形态（kit 交付可被宿主运行时执行的编排脚本）

## 背景与问题
- 两轮纠偏后的正解：kit 既不 spawn CLI 当子智能体（headless runner，废），也不让主智能体解释声明表（orchestrate.md，废）——kit 交付**宿主 workflow 运行时原生格式**的编排脚本（ZCode 即 dynamic workflows 的 TS 脚本），宿主读取后用自己的运行时与**原生子智能体**执行。编排能力（fan-out / 依赖 / 重试 / gate）以宿主 facade 的真控制流写在脚本里；确认 / 权限 / 交互 / 断点续跑全部是宿主运行时既有能力。
- 可行性已分析（详 spec §可行性）：宿主有「读取并执行 workflow 脚本」运行时机制（ZCode dynamic workflows 即是）则成立；kit 宿主适配层已把三角色注册为宿主子智能体，接线现成；角色契约 prompt 由脚本内联 helper 经 node:fs 运行时读取（宿主允许 node 内置 import）。
- 「自定义扩展脚本」随形态天然满足：宿主脚本本身就是代码，项目手写 / 改写即扩展，kit 不自建扩展机制。

## 目标
- **workflow 脚本模板与规范**（kit 交付物）：`.agents/workflows/` 装宿主原生格式编排脚本模板（首个 = ZCode dynamic workflows 形态 `.ts`）+ `_TEMPLATE.md` 规范——固定约定四件：①角色派单 prompt 从 `.agents/roles/` 组装（内联 helper，红线行照旧：禁 commit/push、超范围 BLOCKER）②gate 门禁用宿主命令执行设施 ③执行留痕追加 `workflow/delegations.md`（node fs，口径与 agg-delegations 对齐）④声明随 plan 确认后方可提交宿主执行。
- **宿主互补口径成文**：kit 不依赖、不复制宿主编排机制；宿主自带 dynamic workflows 的（ZCode / Claude Code）本就是本形态的执行前提；无该机制的宿主不在本形态覆盖内（用户明确不管，其仍走阶段命令既有路径）。
- **orchestrate.md 废止**：LLM 解释执行与「宿主读取脚本」重叠且保真度低，按拍板删除；引用行改写；测试断言同步。

## 非目标
- kit 不做任何执行体：不 spawn CLI、不自带运行时、不 LLM 解释——执行权 100% 在宿主 workflow 运行时。
- 不做跨宿主声明翻译层 / emitter（单宿主项目直接写宿主脚本；多宿主翻译需要时另立）。
- 不做 steps 自定义机制（宿主脚本即扩展机制）；不做 TS 编译链（脚本由宿主 typecheck）。

## 约束
- 零运行时依赖照旧（模板脚本只用 node 内置 import + 宿主 facade）。
- 规则面预算：orchestrate.md 删除（-3.4KB）远大于引用行与模板增量，净减。
- 宿主脚本约束（如 ZCode dynamic workflows 仅允许 node 内置与官方根 import）→ 模板必须自包含（helper 内联，不 import 项目文件）。

## 影响面
- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md）
- [ ] 规则 / 契约变更（编排形态三定：宿主读取脚本；orchestrate 废止）→ L2

## 验收标准（可测试）
- [ ] ZCode 形态模板脚本落地：`.agents/workflows/示例-并行实现评审.zcode.ts`（自包含：角色 prompt helper 内联读 roles、编排骨架含并行 fan-out + gate + 留痕、BLOCKER/红线约定），过宿主 typecheck 方式验证（提交前门）
- [ ] `_TEMPLATE.md` 重写：宿主读取形态说明 + 四件固定约定 + 宿主互补口径 + 「如何扩展（直接写宿主脚本）」
- [ ] `orchestrate.md` 删除（templates + 装副本）；AGENTS.md / build.md 引用行改「宿主读取」口径；grep 无旧口径残留
- [ ] `npm test` 全绿（init 装户面断言改：workflow 模板在位、orchestrate 不回流）；doctor 0 WARN；预算门通过（净减）
