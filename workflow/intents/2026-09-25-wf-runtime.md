---
状态: done
级别: L2
日期: 2026-09-25
模块: pipeline
备注: 同日第四轮定稿。骨架经 AskUserQuestion 用户确认：「AGENTS.md 自动加载 + stages 编排脚本 + steps kit 扩展点 + 宿主 AI 原生执行，零协议适配」。取代 orchestrate-in-session（其命令载体废止，机制改目录约定）与两轮更早形态。前两轮 AskUserQuestion 结论仍有效：废 orchestrate 命令、扩展机制归 kit（steps 扩展点）。
---

# INTENT — kit 编排机制：编排脚本 + steps 扩展点（全宿主自动加载，零协议适配）

## 背景与问题
- 同日三轮形态演进与用户纠偏的最终定音：kit 的编排机制要**所有宿主都读到、跑起来**——不依赖某宿主的 workflow 运行时（不止 zcode），不做宿主协议适配，扩展机制是 **kit 自己的扩展点**。
- 全宿主共有的唯一基座 = 四样本领：读 AGENTS.md、读仓库文件、跑终端命令、（可选）子智能体。机制只建在这四样上 → 天然全宿主通用、零适配：**AGENTS.md 常驻指令就是自动加载通道**（所有 kit 装户宿主本来就读 AGENTS.md），编排能力以声明语义固化（宿主 AI 按语义执行，不是自由发挥），扩展点由 kit 统一定义。

## 目标
- **编排脚本**（`.agents/workflows/<主题>.md`）：frontmatter（name / concurrency）+ stages 表——真编排语义：`after` 依赖分层、同层并行批、`retries` 重派、`gate` 门禁行（终端跑命令）；stage 三形态：role 派单行（子智能体）/ step 行（引用自定义步骤）/ gate 行。
- **kit 扩展点**（`.agents/workflows/steps/<名>.md`）：自定义步骤——统一参数约定，步骤正文可指使命令 / 子智能体 / 任意动作；编排脚本 step 行引用即用；项目把领域动作（部署 / 迁移 / 审计）注册进机制。
- **自动加载**：AGENTS.md 常驻指令——跑编排 / plan 执行多工作包时读 `.agents/workflows/` 按语义执行；执行口径（分层 → 层内并行 fan-out 或顺序自做 → 收敛复核 → gate → 留痕 delegations.md → 汇总）固化在机制文档 `_TEMPLATE.md`，全宿主同一口径，无子智能体宿主 fallback 验收不变。
- **orchestrate.md 废止**：执行语义并入机制文档（目录约定，不占命令面）；引用行改口径。

## 非目标
- 不做任何执行体（不 spawn CLI、不自带 node 运行时）——执行者 = 宿主 AI；不做宿主协议适配；不做 emitter 翻译层。
- steps 不做机器强制的参数 schema（md 参数约定 + 宿主 AI 执行，机制文档写清口径）。

## 约束
- 零运行时依赖照旧（纯 md 约定 + 既有引擎面）。
- 规则面预算：orchestrate.md 删除（-3.4KB）净减；AGENTS.md 常驻指令一行控制在余量内。

## 影响面
- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md）
- [ ] 规则 / 契约变更（编排机制定稿：目录约定 + 自动加载 + steps 扩展点；orchestrate 废止）→ L2

## 验收标准（可测试）
- [x] 机制文档 `workflows/_TEMPLATE.md` 定稿：自动加载口径、stages 语义（三形态 stage）、steps 扩展点约定（参数 / 发现 / 执行）、纪律（随 plan 确认、留痕、不跨确认门）（证据：_TEMPLATE.md 重写——自动加载指令 / stage 三形态表 / steps 约定与示例 / 执行口径八条）
- [x] 装户件齐：示例编排脚本（stages 表）+ `steps/` 示例步骤 + AGENTS.md 常驻指令；`init` 装户自带（证据：init.test.mjs ⑥ 3 例 PASS——机制文档与示例 / steps 扩展点 / orchestrate 不回流负向断言；本仓库 sync 实装 3 覆盖 1 新增）
- [x] `orchestrate.md` 删除（templates + 装副本）；build.md 引用行改口径；grep 无旧口径残留（证据：git rm 2 处 + sync「包内已移除」出台账 + 盘上清理；grep templates/.agents/src 仅 init.test 负向断言字符串）
- [ ] `npm test` 全绿（init 装户面断言改：声明件 + steps 在位、orchestrate 不回流）；doctor 0 WARN；预算门净减
