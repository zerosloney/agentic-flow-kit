# 工件真相源（Source of Truth）

> 背景（Anthropic AI-native SDLC）：每个工件必须指定**唯一**真相源，其他系统只存副本或链接。
> 否则 Jira / Confluence / Figma / 变更单与仓库文档会互相漂移，agent 会读到两份“真相”。
>
> 用法：开工前查本表；新增工件类型必须先登记。没有登记的工件，默认以仓库 markdown 为准。

| 工件 | 唯一真相源 | 其他系统怎么放 | 谁维护 | 过期信号 |
|---|---|---|---|---|
| intent（要什么） | `workflow/intents/` markdown | Jira/需求工具存链接 + 摘要；评审记录在链接里 | 产品 owner | 状态仍 draft 超过约定天数 |
| spec（决定什么） | `workflow/specs/` markdown | Confluence 只放链接，不复制正文 | 产品 + 技术 lead | 与 intent 的验收判据不一致 |
| plan（怎么做） | `workflow/plans/` markdown | PR 描述引用路径；不另写一份 | 实现者 | 合并 diff 与 plan 文件清单不一致 |
| 代码与测试 | git 仓库 | 任何外部系统只读镜像 | 工程 | 镜像落后一个提交 |
| 评审结论 | PR / `workflow/reviews.d/` | 评审工具存链接或事件 id | 复核者 | 意见无采纳/拒绝结论 |
| 事故与复盘 | `workflow/incidents/` | 事故平台存链接 + 影响面摘要 | on-call + owner | 复盘三件套缺一 |
| 领域知识 | `wiki/` markdown | `wiki/` HTML 只是展示快照 | wiki owner | HTML 与 md 不一致 |
| 记忆主张 | `workflow/claims.d/` | 不复制；其他文档引用 claim id | 主智能体 | 引用的原文已消失（broken） |
| 行为评测 | `.agents/evals/results.jsonl` | CI 报告存链接 | 平台/引擎 owner | 凭证过期或签名不匹配 |

## 迁移到 AI-native 时

1. 先逐项填本表，再动流程；没有“唯一源”的工件不要开始自动化。
2. 旧系统（Jira/Figma/变更委员会）不能立刻下线时，**仓库为源、旧系统为链接**，并在旧系统字段里写清“以 commit/path 为准”。
3. 反向选择（旧系统为源）只有在审计/监管强制时才用；此时仓库文档必须带 `source: <系统>#<id>`，且不复制正文。
4. 任何“两份都像真的”状态都按缺陷处理，登记 papercut。
