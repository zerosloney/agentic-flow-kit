# 严格度分层（steering tiers）

> 背景：Anthropic agent memory 研究显示，对更强模型，事先写死的固定规则
> （例如“只记录失败”）会削弱记忆带来的增益；告诉它“记忆用来做什么”，比规定“怎么用”更有效。
> Playbook 也提醒：更长/更细的指令文件会降低遵循度。

## 分层

| 档 | 适用 | 脚手架 | 判断空间 |
|---|---|---|---|
| frontier | 强推理模型（judgment/review） | goal（目标 + 约束 + 验收） | 高 |
| standard | 默认 | mixed（确认门 + 精简步骤） | 中 |
| lean | 小模型/低成本实现 | step（明确步骤 + 模板 + 反例） | 低 |

配置单源：`.agents/config/steering.json`；解析：
`flow-kit run steering.mjs resolve --model opus`。

## 什么永远不能“按档放宽”

`invariants` 列表里的内容不随模型档位变化：确认门、独立复核、单源、测试不可弱化、提交/推送门禁。
分层只调整**表达方式**（目标式 vs 步骤式），不调整**底线**。

## 切换口径

- 换模型后先跑 `.agents/skills/model-upgrade/SKILL.md` 的评测。
- 强模型档发现命令文件步骤过细、反而降低判断质量时，把该命令的实现段改成目标式；
  确认门与验收判据保留。
- 弱模型档不要靠“它应该懂”省略步骤；用模板与门禁补。
