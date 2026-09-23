---
状态: draft
级别: L1
模块: <词表之一，见 .agents/workflow-modules.txt>
---
# PLAN — <与入口文档同名主题>
<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 极简形态（2026-09-13 瘦身，L1 默认）：单/少文件微改动只填「改动面」+「验证方式」两节——改动面逐条列改哪个文件做什么（判据细节直接写进条目），验证一行静态门 + 按需 UI 实测；任务拆解/执行顺序仅 L1 多文件多步骤时保留 -->

对应入口：../intents/YYYY-MM-DD-<主题>.md 或 ../incidents/YYYY-MM-DD-<主题>.md（保留实际一项）
对应 spec：../specs/YYYY-MM-DD-<主题>.md（L1 可省略）

## 改动面（L1 极简形态主节；L2/L3 可作任务拆解的汇总或删本节）
- <文件/组件>：<做什么；判据细节直接写进条目，如「L771 message.success 改『更新成功』」>

## 任务拆解（L2/L3 必填；L1 仅多文件多步骤时用，单任务微改动删本节）
1. <任务>
   - 判据：<怎样算完成；尽量对应一个测试或可复现操作>
   - 风险：低 / 中 / 高（<原因>）
2. <任务>
   - 判据：…
   - 风险：…

## 执行顺序（L2/L3 必填；L1 单文件微改动删本节）
<1 → 2 → 3；标注依赖关系>

## 验证方式
- 静态门：`项目构建命令`（+ `项目测试命令`，测试项目就绪后）
- 前端：cd frontend && npm run build（vue-tsc）
- UI：.agents/commands/test.md（涉及页面改动必走，headless Chrome 实测）
- L2 追加：<契约 / 规则面比对：编码结果抽样 / 接口契约断言 / 口径对账>
- L3 追加：<含 schema 变更：备份 + 回滚 SQL 就绪后执行；仅运行时 / 管线：回退上一 release tag + 配置开关预案>

## 确认与复核
> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 `draft → approved` 并回填本节（确认环节的机器可见态），`done` 只在关单出现——禁从 `draft` 直跳 `done`（2026-09-22 papercut）。
- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（`build.md` 两道门，逐次，不合并）
