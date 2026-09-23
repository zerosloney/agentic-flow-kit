---
状态: approved
级别: L1
日期: 2026-09-23
模块: pipeline
备注: M5 极简 plan；范围与同名 intent 一同于对话内确认。
---
# PLAN — M5：npm 发布

## 改动面
- `git rm templates/_agents/cache/kb-index.json`；包仓 `.gitignore` 追加 `templates/_agents/cache/`。
- `templates/workflow/specs/_TEMPLATE.md` 红线表通用化（通用示例行 + 指引）；本仓 `workflow/specs/_TEMPLATE.md`（owned 装副本）手工同步；papercuts.md 该行标记已修。
- 新增 `LICENSE`（MIT）。
- 发布：`npm pack --dry-run` 审查 → tarball 临时目录安装冒烟 → `npm publish`（待用户 npm login）。

## 验证方式
- npm pack 干跑清单逐项核对；tarball 安装后 `npx flow-kit` help/version/init/doctor 冒烟。
- 全套 `npm test` 不回归；提交穿真钩子；发布后 `npm view agentic-flow-kit version`。
