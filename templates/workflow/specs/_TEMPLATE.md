---
状态: draft
级别: L1
模块: <词表之一，见 .agents/workflow-modules.txt>
---
# SPEC — <与入口文档同名主题>
<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2 / L3 必须先有 spec 确认通过方可起草 plan；L1 可省略 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled（done=关单、superseded=曾确认后放弃、cancelled=未完成即取消）；L3 确认通过后在 frontmatter 追加两行：`确认结果: approved` 与 `确认时间: YYYY-MM-DD`（check-loop 对 L3 强制校验） -->

对应入口：../intents/YYYY-MM-DD-<主题>.md 或 ../incidents/YYYY-MM-DD-<主题>.md（保留实际一项）

## 功能行为
<讲清功能怎么工作；分小节列用户 / 系统行为，必要时附状态机 / 时序图说明>

## 数据流
<数据从哪里来 → 经过哪些处理 → 落到哪里；含字段映射、接口契约、上下游依赖>

## 系统改动清单
- 后端：模块 / 文件 / 接口契约
- 数据库：无 / <表名 + 字段 + 迁移 SQL 路径>
- 前端：路由 / 组件 / store / api

## 约束遵守映射（对照 AGENTS.md 触达红线）
| 红线 | 本 spec 如何满足 |
|------|------------------|
| Application 禁引 Infrastructure / DbContext | <通过 XXX，不引入 YYY> |
| 规则 / 契约（编码权威 / 共享契约 / 既有接口语义 / 全局横切口径） | <是否触及（触及即 L2 定级依据）；编码权威仍在后端> |
| schema / 迁移 SQL（禁 dotnet ef） | <涉及 SQL 路径；历史 EF Migrations 目录（含 ModelSnapshot）已整体移除，不得重建> |
| 前端：Drawer / 禁 a-select / style.css 统一 | <本 spec 涉及哪些前端约定> |

## 风险评估
- <风险点 1> ｜ 应对：<测试 / hook / 评审>
- <风险点 2> ｜ 应对：…

## 确认与复核
> 个人工作流：确认 = 用户在对话内一句话通过；无第二审批人，追溯靠 git（commit 记录确认时点）。
> 确认结果 / 确认时间写在文件头 frontmatter（L3 由 check-loop 强制校验）；本节只留叙述性复核记录。

- 独立复核：<L3 强制：另开新会话由 AI 复核本 spec，记录复核会话与结论；L1 / L2 无则删除本行>
- 复核结论：<无则删除本行>
- 返修意见：<无则删除本行>
- 确认通过后，方可起草 ../plans/YYYY-MM-DD-<主题>.md
