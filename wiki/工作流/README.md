# 工作流（workflow declarations）

> 编排机制——`.agents/workflows/` 下的编排脚本承载编排语义（依赖分层 / 并行 / 重试 / gate），宿主 AI 经 AGENTS.md 常驻指令自动加载并按语义执行，让 orchestrate 命令有实际工作流模板可拉起。

## 主题说明

- **问题**：用户要跑编排、或 plan 执行多工作包时，需要一份结构化声明（依赖 / 并行 / 重试 / gate）让宿主 AI 自动 fan-out 派单——而不是 AI 每轮重新读 plan 临时编排
- **方案**：`.agents/workflows/<主题>.md` 声明文件 = frontmatter（`name` / `description` / `concurrency` 默认 2）+ 一张 stages 表
- **零宿主协议适配**：机制只依赖所有宿主共有的四样本领（读 AGENTS.md / 读仓库文件 / 跑终端命令 / 子智能体）——有子智能体的宿主并行 fan-out，没有的顺序自做，验收不变

## 关键决策点

- **3 种 stage 形态（互斥）**：
  - **role 派单行**（`role` 非空）：派子智能体（`task` 目标 / `files` 授权清单 / `accept` 验收判据写进派单头 + 红线行）
  - **step 行**（`step` 非空）：宿主 AI 读 `steps/<step>.md` 按指引执行，`task / params` 列传参
  - **gate 行**（`gate` 非空，role/step 空）：终端跑命令，非零即中止
- **`step ∈ steps/` 纪律**：step 形态必须先注册到 `.agents/workflows/steps/<name>.md`；解析校验先行——role ∈ `.agents/roles/`、`step` ∈ `steps/`、`after` 引用存在且无环——任一不过即拒，不执行
- **子智能体红线**：不跨确认门、不 commit / push（派单红线行：只改授权文件；缺输入或需偏离 → `BLOCKER:` 停下）
- **失败处理**：失败且 `retries` > 0 → 重派（全新上下文）；重试超限 / gate 非零 → 中止后续、汇总报告失败项
- **声明随 plan 确认后方可执行**：编排脚本是 plan 任务拆解的执行器；plan 草稿先经用户对话内确认

## 编排语义（执行口径，全宿主同一）

- `after` 空 = 第 0 层
- 一层全 ok 才推依赖它的下一层
- 层内按 `concurrency` 分批——有子智能体的宿主并行 fan-out，没有的顺序自做（验收标准不变）
- 留痕：每个派单 / step stage 完成后向 `workflow/delegations.md` 委派结果表追加一行（`一次通过` / `返工×N` / `返工待修`）

## 已落地声明

| 声明 | 阶段 | 主题 | commit |
|---|---|---|---|
| `示例-并行实现评审.md` | 5 | 后端 + 前端并行 → gate → 部署验证 → 独立评审 | 既有示例 |
| `pipeline-closing.md` | 10 | G 环节 6 阶段闭环：author → confirm → build → 3 关 gate → closeout | `3cc10d6` |
| `source-sync-repair.md` | 7 | G 环节漂移修复专项：scan-diff → classify → repair → gate-rescan → closeout | `3cc10d6` |

## steps 扩展

| step | params | 主题 |
|---|---|---|
| `示例-部署验证.md` | `env`（目标环境）；`timeout-min`（可选，默认 10）| npm deploy + curl smoke 检查 |

## 复盘

- **G 环节（2026-09-25-workflows-declare）**：把 5 环节推广节奏（E/A/D/C/F/B）固化为可复用编排——`pipeline-closing` 是完整 6 阶段闭环模板，`source-sync-repair` 是漂移修复专项子集
- **本次自举测试**：用 `pipeline-closing` 自身起草 + 实施「wiki 工作流主题沉淀」L1 微改动——验证声明自举可行（commit `409ea6f` plan + 后续 feat + closeout）
- **首跑发现**：3 形态覆盖完整时不必引入新 step（role 派单 + gate 终端已能描述大多数 L1 推广环节）

## 原文链接

- 模板：`.agents/workflows/_TEMPLATE.md`（编排机制 + stages 表 + 3 形态定义 + 纪律）
- intent：`workflow/intents/2026-09-25-workflows-declare.md`
- plan：`workflow/plans/2026-09-25-workflows-declare.md`
- 关联：B 环节 wiki 主题沉淀（`wiki/README.md` 总览）