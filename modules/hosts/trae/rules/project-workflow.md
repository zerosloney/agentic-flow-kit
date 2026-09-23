---
alwaysApply: true
---

本项目工作流唯一权威是根目录 `AGENTS.md`：开工前必须完整读取并严格遵循（任务流程 / 通用 Working rules / 目录级规则 / 运行时与验证标准），本规则只做入口指针，不复制内容。

- 规则加载是惰性的：根 `AGENTS.md` 常驻；目录级 `AGENTS.md`（如有，如 `backend/AGENTS.md`、`frontend/AGENTS.md`）只在该目录文件被读取或被提及时才生效——动对应目录前先主动读，别凭记忆。
- 终端环境差异（shell 可用性 / 退出码取法 /「命令不存在 ⇒ 假绿」）见 `.agents/notes/runtime-env.md` §1。
- 闭环流程目录：`workflow/`（intents / specs / plans / incidents / delegations.md 委派台账 / papercuts.md 留痕）。
- 6 阶段命令：按用户触发短语路由到 `.trae/commands/wf-*.md`（new-task / plan / design / build / test / deploy / maintain / review）。
- 子智能体（`.trae/agents/*.md`）按适配器委派；Trae 子智能体为 Beta 功能、需在设置中开启，未开启时按权威命令的 fallback 执行——`fallback: new-session` 必须另开新会话，不得由原会话自查冒充。
- 闭环兜底以 `.githooks/` 为准（门禁清单以各 hook / `.agents/scripts/check-loop.sh` 头部注释为准，不在本文件复述）；`.trae/hooks/` 在命令执行前再拦一次，`core.hooksPath` 漏配时它是唯一门禁。
- 委派完成后在 `workflow/delegations.md` 追加一行留痕；命令 / 技能卡壳误导时在 `workflow/papercuts.md` 记一行，不当场顺手改。
- 中文为项目唯一语言；提交遵循 Conventional Commits 中文。
