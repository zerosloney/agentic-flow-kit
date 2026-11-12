---
name: model-upgrade
description: 模型升级治理——别名/宿主模型变化时，先对当前评测敏感面跑行为评测、落凭证、写迁移说明，再升级；禁止静默换模型。
---

# model-upgrade — 模型升级治理

## 触发

- `flow-kit upgrade` 前后、宿主配置里的模型别名变化、`--model` 显式改角色模型。
- doctor 报 `model drift`：本地 `model-roles.local.json` 与已安装子代理 `model` 字段不一致。
- 用户说「换模型 / 升级模型 / 这个模型更便宜」。

## 为什么不是普通依赖升级

模型变化会改变**行为**，而静态门只证明代码还能跑。Playbook 的口径：
评测是 AI-native 的 QA；模型/提示/技能变更都应跑固定任务集。

## 步骤

1. **固定基线**：确认当前 `.agents/config/model-roles.local.json` 与已安装子代理的 `model` 字段一致。
2. **跑评测**：按 `.agents/skills/eval/SKILL.md` 用新模型跑 A/B；至少覆盖：
   - 技能触发正/负例；
   - 命令确认门顺序；
   - 角色契约（越界即停）；
   - 一个已知答案的复核样本（`review-method/golden-set.md`）。
3. **落凭证**：
   ```bash
   node .agents/scripts/agent-eval.mjs record --pass-rate <0-1> --tasks <N> --model <id> --note "upgrade <old> -> <new>"
   node .agents/scripts/agent-eval.mjs check
   ```
4. **写迁移说明**：`workflow/model-upgrades.d/<YYYY-MM>.md` 一行一模型：
   `日期 | 角色 | 旧 | 新 | 通过率 | Δ | 翻转任务 | 回退方式`。
5. **升级**：`flow-kit upgrade --target .`；doctor 通过后提交。
6. **回退**：保留旧 `model-roles.local.json` 副本；回退只改本地配置并重跑 `agent-eval check`。

## 红线

- 不在没有评测凭证时把 `agent-eval.json` 设为 `advisory: false` 后宣称“已评估”。
- 不把 `review` 与 `code` 配成同一模型后忽略告警（`REVIEW_SAME_AS_CODE`）。
- 不静默改写用户本地模型配置；显式配置永远优先。
