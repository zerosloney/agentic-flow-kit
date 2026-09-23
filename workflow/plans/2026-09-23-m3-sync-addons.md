---
状态: approved
级别: L1
日期: 2026-09-23
模块: pipeline
备注: 2026-09-23 与同名 intent 一同确认后当日完成。完成注记：① 测试合并为 src/sync.test.mjs 单文件 38 例（原计划拆 sync/add 两个文件，场景可共用 fixture，合并更省）；② 实现中发现 M1 遗留缺陷并连带修复——local-pre-commit 模板尾部 exit 0 吞门禁失败，改 set -e + 挂载点归 owned + add-gate 旧装态归一化（改动超出原列改动面，为 add-gate 接线正确性必需，经 e2e 拦截验证）；③ templates/_agents/cache/kb-index.json 为 v0.1.0 误提交的测试残留（kb-search 按指纹自愈），M4/M5 清理候选，本次未动。
---
# PLAN — M3：sync / add-host / add-gate

## 改动面
- src/sync.mjs：读 .agents/kit.json（缺 → 报错引导 init）→ 由 options（boardPort + stack）重建渲染 vars → 内存渲染 templates + 已装宿主层 → 逐 managed 三方比对（台账 sha / 磁盘 sha / 新渲染 sha）分态处理 → 台账外新文件安装 → 包内已删报告 → 重写 kit.json（版本对齐、managed 数组重建）→ 重跑 gen-workflow-index / gen-wiki-board → doctor。选项：--dir / --force。
- src/add-host.mjs：`<host>`（zcode|opencode|trae|omp，复用 profiles.HOSTS）→ 渲染宿主层（已存在保守跳过，--force 覆盖）→ managed 台账按 rel 去重补记 → options.hosts 补记 → localOnly 宿主 .gitignore 追加。选项：--dir / --force。
- src/add-gate.mjs：`<gate>`（枚举 modules/gates/ 目录，当前 dotnet-ca）→ 模块文件拷入 .agents/hooks/（README.md 为包内文档不拷）→ .agents/hooks/local-pre-commit 不存在则创建、缺挂载行则追加（幂等）→ owned 台账补记。选项：--dir / --force。
- src/cli.mjs：三个子命令路由 + HELP 用法节。
- package.json：version 0.2.0。README：快速开始补三命令用法、路线勾选 sync / add-host / add-gate、两态模型段补升级语义。
- 测试：src/sync.test.mjs + src/add.test.mjs（fixture 迷你包根：小模板树 + 假宿主 + 假门禁，验证不依赖真实包内容）。
- workflow/：本 intent + plan 留痕；完成后 done 勾验。

## 验证方式
- node src/sync.test.mjs、node src/add.test.mjs 全绿。
- 既有引擎 6 套测试（5 个 *.test.mjs + check-loop.test.sh）全绿无回归。
- e2e 临时 git 仓库按 intent 验收标准走查（含 doctor 收尾全绿）。
