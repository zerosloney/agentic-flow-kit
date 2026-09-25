---
状态: done
级别: L2
模块: pipeline
---

# SPEC — kit 编排机制：编排脚本 + steps 扩展点

对应入口：../intents/2026-09-25-wf-runtime.md

## 机制总览（可行性根基）

全宿主通用性建在四样本领上——读 AGENTS.md、读仓库文件、跑终端命令、（可选）子智能体，**每一样都是所有 kit 装户宿主既有能力**，故零协议适配：

```
自动加载：AGENTS.md 常驻指令（所有装户宿主本来就读 AGENTS.md）
    ↓
.agents/workflows/<主题>.md   ← 编排脚本：stages 表承载编排语义（分层/并行/重试/gate）
.agents/workflows/steps/<名>.md ← kit 扩展点：自定义步骤（统一参数约定）
    ↓
执行者 = 宿主 AI：按声明语义执行——有子智能体则层内并行 fan-out，无则顺序自做；gate 终端跑命令
```

## 功能行为

### ① 编排脚本（`.agents/workflows/<主题>.md`）

frontmatter（`name` / `description` / `concurrency` 默认 2）+ stages 表：

```md
---
name: 并行修两域
description: 后端+前端并行实现 → 汇聚过测试 → 部署验证（step）→ 独立评审
concurrency: 2
---
| id | after | role | step | task / params | files（授权） | accept（验收判据） | gate | retries |
|----|-------|------|------|---------------|--------------|-------------------|------|---------|
| backend | — | implementer | — | 实现后端 X | src/api/** | 项目测试过 | | 1 |
| frontend | — | implementer | — | 改前端 Y | web/** | 构建过 | | 0 |
| gate-all | backend,frontend | — | — | — | — | — | npm test | |
| deploy-check | gate-all | — | 部署验证 | env=staging | | 部署命令 exit 0 | | 0 |
| review | deploy-check | independent-reviewer | — | 评审两域改动 | | 符合 plan | | 0 |
```

**stage 三形态**（互斥）：role 派单行（子智能体执行 task）/ step 行（宿主 AI 读 `steps/<名>.md` 执行，task 列传 params）/ gate 行（终端跑命令，非零中止）。

**编排语义**（宿主 AI 按此执行，机制文档固化口径）：`after` 空 = 第 0 层；层全 ok 才派下一层；层内按 `concurrency` 分批，有子智能体并行 fan-out、无则顺序自做（验收不变）；失败且 retries>0 → 重派（全新上下文）；重试超限 / gate 非零 → 中止汇总。

### ② kit 扩展点：steps 自定义步骤（`.agents/workflows/steps/<名>.md`）

- 文件名即步骤名；frontmatter：`params` 约定（自由文本列明参数与含义）；正文 = 执行指引（可指使终端命令、子智能体、检查动作——宿主 AI 按指引执行并回报结果）。
- 编排脚本 step 行 `task / params` 列传参（如 `env=staging`）；步骤执行失败按行 retries 重试。
- 统一发现（steps 目录即注册表）、统一约定（kit 定义）、项目自由注册（部署 / 迁移 / 审计等领域动作）——**扩展机制归 kit，项目零成本接入**。

### ③ 自动加载与执行口径（`workflows/_TEMPLATE.md` 固化）

- AGENTS.md 常驻指令（一行）：多工作包编排——读 `.agents/workflows/` 声明按机制文档执行；自定义步骤在 `steps/`。
- 执行口径：解析校验（role ∈ `.agents/roles/`、step ∈ `steps/`、after 无环）→ 分层 → 派单/step/gate → 收敛复核（diff 与授权范围，与 build.md 委派约定同口径）→ 留痕 delegations.md（一次通过 / 返工×N / 返工待修）→ 汇总报告。
- 纪律：声明随 plan 确认后方可执行；子智能体不跨确认门、不 commit/push（派单红线行照旧）。

### ④ orchestrate.md 废止

执行语义已并入机制文档（`_TEMPLATE.md` = 机制单一文档）；删 `templates/_agents/commands/orchestrate.md`（+ 装副本）；build.md 引用行改「读 `.agents/workflows/` 编排」口径；`示例-并行实现评审.md` 更新（含 step 行示范）+ 新增 `steps/示例-部署验证.md`。

## 数据流

plan（已确认）→ 宿主 AI 经 AGENTS.md 指令读编排脚本 → 解析校验 → 分层执行（子智能体 fan-out / step 指引 / gate 终端）→ 收敛复核 → 留痕 → 汇总。

## 系统改动清单

- 引擎（templates/）：重写 `workflows/_TEMPLATE.md`（机制单一文档）；更新 `workflows/示例-并行实现评审.md`；新增 `workflows/steps/示例-部署验证.md`；删 `commands/orchestrate.md`；AGENTS.md 常驻指令 + build.md 引用行；init.test.mjs ⑥ 断言改。
- 不动：src/init·sync·doctor；宿主适配层；.githooks。收尾 sync。

## 约束遵守映射（对照 AGENTS.md 触达红线）

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 规则 / 契约变更 → L2 | 本 spec 即机制契约（目录约定 + 自动加载 + steps 扩展点） |
| 零运行时依赖 | 纯 md 约定，无脚本无进程 |
| 规则面预算 | orchestrate.md 删除（-3.4KB）净减；AGENTS.md 指令一行（~120B） |
| 子智能体不跨确认门 / 不自行提交 | 派单红线行 + 角色契约照旧；声明随 plan 确认 |
| 引擎双源纪律 | 全改 templates/ 后 sync |

## 风险评估

- 宿主 AI 执行声明语义的保真度（无机器强制）｜ 应对：stages 表刻意简单（一张表三形态）+ 机制文档固化逐条口径 + delegations/gate 事后可核对；若未来要机器强制，声明格式可平移给任何脚本运行时（第四稿骨架已留此路）
- 自动加载依赖 AGENTS.md 指令被遵守 ｜ 应对：指令是常驻一行、机制文档锚定；check-loop 可后续加编排声明勾验（不在本单）
- 单日多轮形态演进，引用残留 ｜ 应对：grep 扫旧口径 + 装户面负向断言（orchestrate 不回流）

## 确认与复核

- 确认结果：approved（2026-09-25 用户对话内确认机制骨架「对了，照此更新文档」——spec 为骨架的机制化转写）
- 确认通过后起草 ../plans/2026-09-25-wf-runtime.md
