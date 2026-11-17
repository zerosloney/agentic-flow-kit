---
状态: open
日期: YYYY-MM-DD
主题: <英文 kebab-case，与文件名一致>
---
# 决策地图 — <initiative 标题>
<!-- 复制本模板为 workflow/decision-maps/YYYY-MM-DD-<主题>.md 后填写。写法与触发条件单源 = .agents/skills/wayfinder/SKILL.md -->
<!-- 地图状态∈open/closed（open=仍有未决节点，closed=全部 decided/dropped）；节点状态∈open/decided/dropped。两者都是本地枚举，不是 workflow 文档状态机，不经 confirm-doc 迁移、不进 workflow/INDEX.md -->
<!-- 节点是待决问题不是交付物：「实现 X」不合格，「X 的口径按 A 还是 B」才合格。答案正文送真相源（ADR / glossary / intent / spec），本表只留指针 -->

## 覆盖范围
<一句话写清这份地图管哪个 initiative、为什么跨会话；不写实现方案>

## 节点
| # | 待决问题（可判定） | 为什么现在决不了 | 依赖 | 分型 | 答案形状 / 最小探针 | 状态 | 去向与依据 |
|---|---|---|---|---|---|---|---|
| 1 | <按 A 还是 B 口径？> | <缺哪个事实 / 缺谁的裁定> | <节点号或 —> | 实验 / 裁定 / 比选 | <可判定的选项集，或探针命令> | open | <decided 后填：ADR / 术语行 / intent / spec 指针 + 依据；dropped 填理由> |

## frontier（一次只解一个）
- 当前节点：<#>（依赖已清、最阻塞）
- 本轮动作：<跑探针 / 问用户一个问题（走 grilling）/ 起 arena 比选>
- 证据指针：<输出 / path:line / 用户原话所在台账行；未解则留空>

## 收图
- 全部节点 decided/dropped 后：frontmatter `状态` 改 closed，主线入口 = <intent / spec 路径>。
- 地图留 git 不删除；口径变了就地修订节点，历史依据留 git 与 ADR 的 superseded 链。
