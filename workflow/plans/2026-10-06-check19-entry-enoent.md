---
状态: approved
级别: L1
模块: pipeline
确认指纹: 174c8b4cb72b333f
---
# PLAN — 2026-10-06 check19-entry-enoent

对应入口：../incidents/2026-10-06-check19-entry-enoent.md

## 改动面
- templates/_agents/scripts/check-loop.mjs：检查 19 判据 B 入口 intent 读取（ilvlB）加 existsSync 守卫——缺同名 intent（incident 闭环主题）跳过读取、级别视为空，顺序判定与豁免语义不变；注释互引同文件两处守卫先例
- templates/_agents/scripts/check-loop.mjs：**同类读空点一并守卫**（新增测试场景裸 fixture 实证揪出，同根因同文件不扩散）——检查 5 `textOf` 助手集中守卫（AGENTS.md 可合法缺失，调用方按空数组判定本就预期缺失态）+ 检查 6 AGENTS.md / new-task.md 读取守卫（实仓恒存在故属潜伏面，装户缺件时才触发）
- templates/_agents/scripts/check-loop.test.mjs：新增场景——fixture kit.json policyVersion 2 + 台账 specs/plans approved 行 + 无同名 intent：① 顺序合规裸 fixture → exit 0 且全程无「文档读取异常」（判据 B 与 AGENTS.md/new-task.md 同类读空点一并钉住）；② 顺序倒置 → 照报「审批顺序倒置」（守卫不放松判定）
- 装回：`node bin/flow-kit.mjs sync`（.agents/scripts/ 两件 managed 副本）
- 版本收尾：package.json 1.1.6 → 1.1.7 + kit.json version 同步 + CHANGELOG

## 验证方式
- 静态门：`npm test` 全绿（含新增场景）
- 实仓冒烟：`node .agents/scripts/check-loop.mjs`——stderr 不再出现 12 条「文档读取异常（ENOENT）」，检查 19 其余出账不变

## 确认与复核
- 确认结果：approved（2026-10-06 用户对话内代录「修它」）；done（关单时随入口文档置终态）
- 确认门记录：根因定位、修复点、测试面即改动方案全量在对话内过目（defect 报告先行），用户一句话放行
