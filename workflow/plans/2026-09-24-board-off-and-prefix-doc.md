---
状态: approved
级别: L1
日期: 2026-09-24
模块: pipeline
---
# PLAN — prefix 文档化 + 看板默认不拉起

## 改动面
- `templates/_agents/hooks/commit-check.cjs`：仅配置示例注释补 `prefix` 字段（含 Shipyard 式用法例）。
- 新增 `templates/_agents/scripts/commit-check-trigger.test.mjs`：临时 git 仓 + 假构建命令（node -e）驱动的触发器测试（命名避开装户项目已有的 commit-check.test.mjs）。
- `templates/_agents/commands/plan.md` / `maintain.md`：任务入口动作块改为「看板按需（默认不拉起）」提示。
- `templates/AGENTS.md` 看板行、`templates/workflow/README.md` 看板 bullet、`src/doctor.mjs` 端口信息行：口径改「默认不拉起，需要时手动 ensure-board / workflow-board-server」。
- Shipyard 落地：sync + config 前端构建加 `prefix`（去 ext，复刻旧前缀行为）+ owned 两文件手工 + 停 8933 遗留进程 + 对照探针。

## 验证方式
- npm test 全套件（含新触发器五场景）绿；grep 无「默认拉起」残留。
- Shipyard 对照探针：wiki html 暂存 → SKIP 前端构建；frontend/ 暂存 → 前端构建跑；commit 穿门禁落库；doctor 7 PASS。
