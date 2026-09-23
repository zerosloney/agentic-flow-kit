---
name: wf-new-task
description: 闭环总入口 · 路由判断（新需求 → wf-plan / 修复 → wf-maintain）+ 级别判断（L0-L3）
---

严格按 AGENTS.md 与 .agents/commands/new-task.md 执行：闭环总入口 · 路由判断（新需求 intent → wf-plan / 修复 incident → wf-maintain）+ 级别判断（L0-L3）。

先完整读取上述两个文件并完全遵循，读不到即停下报告阻塞；本文件不内联步骤副本，避免与权威版本漂移。

【Trae 宿主注记】
- 输出路由结论与级别，指明进入哪个 wf-*.md；不并阶段、不跳阶段。
- approval_required 阶段产出未经用户对话内一句话确认，不得进入下一阶段。
- 宿主级差异（规则惰性加载 / 终端 shell / 子智能体开关 / 门禁冗余）见 alwaysApply 规则 `.trae/rules/project-workflow.md`，不在此重复。
