---
状态: approved
级别: L2
日期: 2026-09-23
模块: pipeline
备注: M4 实现计划；与同名 intent 一同确认后开工。
---
# PLAN — M4：自装 dogfooding

## 改动面
- 安装：`node bin/flow-kit.mjs init --hosts zcode --stack none --board-port 8933`（目标 = 仓库根；已有 workflow/ 文件保守跳过）。
- AGENTS.md 项目适配区（owned，装后手填）：构建 = 无（纯 JS 脚手架，node 直跑）；测试 = `npm test`；类型检查 = 无；双源纪律一行——引擎改动改 templates/ 后跑 `node bin/flow-kit.mjs sync`，.agents/ 是装副本不直改。
- .agents/hooks/commit-check.config.json 与 .agents/settings.json：保持 none 空基线（本仓库无可秒检的 lint/类型配置，构建无产物可验证）。
- package.json：scripts.test = `node src/run-tests.mjs`；新增 src/run-tests.mjs（零依赖 runner：顺序 spawnSync 跑 src/sync.test.mjs + templates/_agents/scripts/*.test.mjs + bash check-loop.test.sh，任一非零整体失败，跨平台）。
- workflow/：本 intent + plan 留痕。

## 验证方式
- init 输出 + doctor 7 PASS / 0 WARN。
- 既有留痕不动：git status 确认 M1/M3 四份文档无修改。
- npm test 全绿（7 套，38 + 105 例）。
- M4 提交穿过真钩子落库（dogfooding 验证点）；提交后 doctor / check-loop 复跑干净。
