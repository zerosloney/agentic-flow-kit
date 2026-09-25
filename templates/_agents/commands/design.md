---
description: Design 阶段:起 spec(L2/L3 强制,L1 可省略)
stage: Design
triggers:
  - "起个 spec"
  - "接着起 spec"
  - "intent 看过了"
  - "spec 走一下"
delegation:
  - role: independent-reviewer
    instructions: .agents/roles/independent-reviewer.md
    when: L3 spec 草稿完成且用户确认前
    required: true
    fallback: new-session
approval_required: true
next: .agents/commands/build.md
---

# Design · 起 spec

> L2/L3 强制;L1 可省略(直接跳 `next: build.md`)。

## 执行

1. 确认同名入口文档已批准：新需求为 approved intent，修复为已确认的 incident 草稿；否则拒绝，分别回 `plan.md` / `maintain.md`
2. 级别判断(对照 AGENTS.md 第 3 条):
   - **L1**(实现级改动,未命中 L2/L3)→ 可省略 spec,直接跳 `next: build.md`
   - **L2**(改规则 / 契约:编码权威 / 共享契约 / 既有接口语义 / 全局横切口径,闭集见 `new-task.md` §级别判断)→ 必须有 spec
   - **L3**(数据与运行时结构:schema / 迁移 SQL / DI 链 / 认证与中间件管线)→ 必须有 spec + **新会话独立复核**
3. 起草 spec:
   - **填空工具先跑**：`node .agents/scripts/fill-spec.mjs --level <L1|L2|L3> --topic <主题> --output workflow/specs/<date>-<主题>.md`——输出含 frontmatter 5 字段 + 5 节正文（功能行为/数据流/系统改动/约束遵守映射/风险评估）的草稿；AI 据此填实
   - 复制 `workflow/specs/_TEMPLATE.md` → `workflow/specs/YYYY-MM-DD-<主题>.md`(与入口文档同名)
   - 按 5 节填写:功能行为 / 数据流 / 系统改动 / 约束遵守映射 / 风险评估
   - 约束映射必须对照根 `AGENTS.md`「Working rules」与改动域目录级 `AGENTS.md`（如有）逐条说明如何满足
   - 存在多个可行方案时,在 spec 中列出各方案取舍与 AI 建议项,由用户选定后方可确认
   - **页面/交互入口形态必须用户确认**:spec 须写明入口是「表单（字段清单）」还是「选择器/弹窗」，禁止自行推定交互形态
4. 起草后停下,输出草稿全文给用户过目
5. L3 必须独立复核:宿主支持子智能体时调用 `independent-reviewer`,并要求其读取 `.agents/roles/independent-reviewer.md`;不支持时另开新会话。复核者读 spec + 根 AGENTS.md 与改动域目录级 AGENTS.md 的红线挑漏洞,结论写入 spec「确认与复核」节;复核未过不得确认

## 技能辅助(可选,宿主级 skills)

- 对话已充分、无需再访谈时:用 `to-spec` 直接综合成 spec 草稿;其"发布到 issue tracker"默认行为一律改为写入 `workflow/specs/` 同名文件,按 `_TEMPLATE.md` 格式
- L2/L3 模块设计:用 `codebase-design`(深模块/接缝/接口收窄);术语混乱或需记 ADR:用 `domain-modeling`
- 方案取舍需压力测试:用 `grilling`;技能产出不越过用户确认门,L3 独立复核流程不变

## 委派约定

- spec 起草、方案取舍与用户确认由主智能体负责,不委派;只有 L3 确认前的独立复核委派 `independent-reviewer`(必需输入:入口文档、spec、根 `AGENTS.md` + 改动域目录级 `AGENTS.md`、固定复核目标)。
- 宿主不支持子智能体时必须 `fallback: new-session`,不得由原主智能体自查冒充独立复核。

## 确认后

- spec 状态 draft → approved
- 立即 `docs(workflow)` 单独提交留痕(根 `AGENTS.md` 提交约定;check-loop 检查 14 口径)
- 进 `next: .agents/commands/build.md`
