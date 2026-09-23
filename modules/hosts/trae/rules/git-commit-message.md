---
alwaysApply: false
scene: git_message
---

提交信息一律中文，遵循 Conventional Commits：`<类型>(<范围>): <说明>`，例如 `fix(采购订单): 页签切换浮层收纳`、`docs(trae): 同步工作流适配层`。

- 类型枚举：feat / fix / docs / style / refactor / perf；`.githooks/commit-msg` 按此硬校验首行，非枚举前缀会被拦下，merge / revert 提交豁免。
- 范围可省：`fix: 说明` 同样合法；分隔符 `:` 或 `（` 均可。
- 禁止 `[feat] 说明` 这类方括号写法。
