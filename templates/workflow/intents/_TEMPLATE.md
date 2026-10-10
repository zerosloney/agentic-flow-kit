---
状态: draft
级别: L1
日期: YYYY-MM-DD
模块: <词表之一，见 .agents/workflow-modules.txt>
备注: <可选：附注自由文本，check-loop 不解析>
---
# INTENT — <主题>
<!-- 复制本模板为 YYYY-MM-DD-<主题>.md 后填写；plans/ 下同名文件与本文件配对 -->
<!-- frontmatter 受限子集（2026-09-13）：每行 `键: 值`；状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行 -->
<!-- 探索泳道（可选，2026-09-30 hybrid-governance-explore-hardening）：experiment/ 前缀分支上的 PoC 任务在 frontmatter 加「阶段: exploring」——提交/推送门降级 advisory，spec/plan 可先于本入口确认起草（限 L0/L1）；转正合入 main 前须收口（本档 approved/done + 同名 plan/spec 在场，check-loop --hardening 加固门），或显式放弃（superseded/cancelled） -->

## 背景与问题
<为什么做；写明需求来源（工单 / 沟通记录 / 待办事项）>

## 目标
- <可验证的目标>

## 非目标（L1 微改动无实质内容可删本节，不硬填）
- <明确不做的，防止范围蔓延>

## 约束（L1 微改动无实质内容可删本节，不硬填）
- <复用什么、不许动什么>

## 影响面
- 模块：<词表之一，见 .agents/workflow-modules.txt>
- 数据库：无 / <表名>（涉及 schema 变更 → L3；无 schema 的运行时 / 管线结构面亦为 L3，判据见 `.agents/commands/new-task.md` §级别判断）
- 前端页面：<路由或组件，无则删本行>

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）
- [ ] <按本项目 AGENTS.md 红线逐行补；无则删本行>
- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3

> 触及任一红线即为 L2 / L3，必须立 ../specs/YYYY-MM-DD-<主题>.md 写明如何满足，方可起草 plan。

## 验收标准（可测试）
- [ ] <逐条可测试；写不出可测试判据 = 还没想清楚>

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 warning。
> **场景覆盖**（2026-10-10 scenario-coverage 灰度）：同名 spec 写了「验收场景」节时，本节须**逐场景 ID 引用**——
> `- [x] 场景：S1 <判据>（证据：…）`。缺引用只出 warning（灰度第一档，不阻断）；spec 无该节则本条不适用。
