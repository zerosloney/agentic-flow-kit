---
状态: done
级别: L1
模块: pipeline
确认指纹: 1717141a56775bde
---
# PLAN — 2026-10-08 check8-gitdead-digit-leak

对应入口：../incidents/2026-10-08-check8-gitdead-digit-leak.md

## 改动面

- templates/_agents/scripts/check-loop.mjs：检查 8 `verifyEvidenceTruth` 的 rev-parse 分流增 `revParse.error` 守卫——spawn 异常（实证不可能）时禁用纯数字 text / external 豁免、按伪造拦（fail-closed，与守卫上方既有注释对齐）；通道健康语义零变化
- templates/_agents/scripts/check-loop.test.mjs：新增场景双断言——① `CHECK_LOOP_GIT` 坏死 × 纯数字证据 → exit 1 + 「证据伪造」；② 通道健康 × 纯数字假 sha → exit 0 + 「证据豁免 text」（misfire 防线不回归）
- 装回：`node bin/flow-kit.mjs sync`（.agents/scripts/ 两件 managed 副本 + kit.json sha）+ CHANGELOG
- 状态注记：本 plan 为 e1624b7（2026-10-08 00:21 已提交）的补留痕——改动面按已落地实现回填，非先行起草

## 验证方式

- 静态门：`npm test` 全绿（含新增双断言；e1624b7 提交时全量套件 exit 0）
- 实仓冒烟：`node .agents/scripts/check-loop.mjs` exit 0（通道健康路径输出不变）

## 确认与复核

- 确认结果：approved（2026-10-08 用户对话内代录「确认」——补留痕过目）；done（2026-10-08 关单，随入口文档置终态）
- 确认门记录：修复本体已随 e1624b7 提交并由 CI 与本地测试验证；本 plan 与同名 incident 同为 2026-10-08 双轴审查整改项（用户「处理1，2，3」第 2 项）
