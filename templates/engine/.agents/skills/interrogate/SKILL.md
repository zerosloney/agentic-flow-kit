---
name: interrogate
description: 多模型多镜头对抗复核——不同模型/不同视角独立拆同一 diff，再聚合去重；供高风险 PR、L2/L3 复核、或单模型复核不放心时使用。
---

# interrogate — 多镜对抗复核

## 触发

- 高风险 diff（跨边界、并发、鉴权、数据迁移、公共接口）。
- L2/L3 独立复核之外还想加一道。
- 单模型复核结论「看起来没问题」，但你不放心。

## 核心

**不是再跑一遍单模型 review。** 是让不同模型、不同镜头**独立**拆同一 diff，再聚合去重。不同模型抓不同的真 bug；同一模型换镜头也能抓单镜漏掉的面。

## 步骤

1. **固定目标**：base/head、spec 路径、风险级别。目标不固定不开始。
2. **生成计划**：`node .agents/skills/interrogate/scripts/interrogate-plan.mjs --base <ref> --head <ref> [--spec <path>]`。输出六个镜头（correctness / security / quality / performance / tests / spec）及每个镜头的文件切片与提示词。
3. **并行派发**：每个镜头一个子代理，独立读 diff，互不共享结论。
   - 模型：按 `.agents/config/model-roles.json` 的 `review` 角色（`heterogeneous: true`）；宿主支持模型覆盖时用不同模型，不支持时用不同 agent 人格（`reviewer` / `security-reviewer` / `code-simplifier` / `caveman-reviewer`）。
   - 每个子代理只拿自己的镜头提示词 + 文件切片，不拿其他镜头的结论（防锚定）。
4. **聚合**：按 `file:line + 问题` 去重；分 P0/P1/P2；确认的与推测的分开；噪声逐条给「为什么不是问题」。
5. **输出**：一张合并表 + 「合入前必须修」+ 「已排除」+ 「未覆盖」。

## 输出格式

| 严重度 | 位置 | 问题 | 证据 | 修法 | 来源镜头 |
|---|---|---|---|---|---|
| P0 | `file:line` | … | … | … | security |

- **合入前必须修**：P0 全部 + P1 中确认的。
- **已排除**：看起来像问题但查过不是的，逐条给理由。
- **未覆盖**：没有镜头覆盖到的面（如运行时行为、外部服务），明确写出来。

## 本仓落点

- `review.md` 执行流程：L2/L3 高风险 diff 叠加本技能。
- `review-method`：Standards×Spec 双轴 + 坏味道走查仍是单镜基线；本技能是并行补充。
- `independent-reviewer`：单一独立复核不替代；本技能是多模型补充。
- 机器门禁：不替代 `verify` / `check-loop`；本技能只出清单，定性仍人放行。

## 边界

- 多模型一致同意是高信号，不是证明；仍要 `blast-radius` 证明关键安全事实。
- 不把「另一个模型也这么说」当证据；证据仍是 `file:line` / 跑过的代码。
- 子代理结论必须自己复核，不直接透传。
