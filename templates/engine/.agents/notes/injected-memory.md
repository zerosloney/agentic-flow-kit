# 注入层（Injected Memory）

> 每次会话都会加载的文件。**上限 200 行 / 25KB**（见 `.agents/config/memory-tiers.json`）。
> 只放“每次都必须知道”的稳定事实；细节一律用链接下沉。
> 更长不等于更有效：指令文件越长，遵循度越低（Anthropic agent memory 研究）。
> 由 dreaming 的 `memory-tier audit/suggest` 维护；`suggest` 只出候选，不自动改本文件。

- 入口与定级：`.agents/commands/new-task.md`
- L2/L3 阶段流：`.agents/commands/stages.md`
- 会话重入：`.agents/skills/session-resume/SKILL.md`
- 主张账（未来会当真的话）：`workflow/claims.d/`
- 记忆地图：`wiki/_memory/INDEX.md`
- 行为评测门：`.agents/scripts/agent-eval.mjs`
- 离线梦境：`.agents/skills/dream/SKILL.md`
