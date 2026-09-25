---
description: Plan 阶段:立 intent(需求来源 / 目标 / 约束 / 触达红线)
stage: Plan
triggers:
  - "起个 intent"
  - "立 intent"
  - "新需求 <主题>"
  - "要做个 <功能>"
approval_required: true
next: L1 → .agents/commands/build.md ；L2/L3 → .agents/commands/design.md
---

# Plan · 立 intent

> AI 起草,用户确认。确认前不进下一阶段。

## 执行

> **看板（可选，默认不拉起）**：需要实时看板时手动跑 node .agents/scripts/ensure-board.mjs（跨平台；幂等：探活 / 旧代码自动重启 / 全新启动才弹浏览器；多项目并行自动上探首个可用端口），链接以脚本输出为准（基端口 8933）；不开看板不影响任务流程。

1. 若 `workflow/intents/` 已有目标 intent 且状态为 approved → 按级别跳 next（L1 → `build.md`，L2/L3 → `design.md`）
2. 否则起草新 intent:
   - **先检索同类**：`node .agents/scripts/kb-search.mjs "<关键词>" --scope workflow --type intents,specs`——命中同类先读其结论与验收，新 intent 引用（防重复立项 / 重复踩坑）
   - **填空工具先跑**：`node .agents/scripts/fill-intent.mjs --module <模块> --level <L0|L1|L2|L3> --topic <主题> --output workflow/intents/<date>-<主题>.md --notes "<备注>"`——输出含 frontmatter 5 字段 + 7 节正文（背景与问题/目标/非目标/约束/影响面/触达红线/验收标准）的草稿；AI 据此填实，模板与节标题机器保证不出错
   - 复制 `workflow/intents/_TEMPLATE.md` → `workflow/intents/YYYY-MM-DD-<主题>.md`
   - frontmatter 填 `模块:`（词表见 `.agents/workflow-modules.txt`，新建文档必填，check-loop 会警告）
   - 按 6 节填写:背景与问题 / 目标(可验证) / 非目标 / 约束 / 影响面 / 触达红线（L1 微改动可省非目标/约束两节，不硬填）
   - 红线勾选对照根 `AGENTS.md`「Working rules」+ 改动域目录级 `AGENTS.md`（如有）;**没触及就全不勾**,不要硬填
3. 写不出可测试判据 = 还没想清楚 → 反问澄清,不要硬填
4. 起草后停下,输出草稿全文给用户过目,一句"可以"即确认

## 技能辅助(可选,宿主级 skills)

- 需求模糊、判据写不出时:用 `grilling`/`grill-me` 拷问需求,答完回填 6 节
- 需要用户离线拍板的决策:用 `to-questionnaire` 生成问卷,问题清单随 intent 草稿一并列出
- 讨论中需同时沉淀术语表/ADR:用 `grill-with-docs`,文档落 `workflow/` 下与主题同名
- 技能只辅助澄清,产出仍按 `_TEMPLATE.md` 落 `workflow/intents/`,确认门不变

## 执行主体

- 需求澄清、级别判断与 intent 起草由主智能体负责,本阶段不委派子智能体。

## 确认后

- intent 状态 draft → approved
- 立即 `docs(workflow)` 单独提交留痕(根 `AGENTS.md` 提交约定;check-loop 检查 14 口径)
- L1 → `.agents/commands/build.md`；L2/L3 → `.agents/commands/design.md`
