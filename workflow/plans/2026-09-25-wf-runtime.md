---
状态: draft
级别: L2
模块: pipeline
备注: 草稿随入口同提过配对门；spec 确认后本 plan 过确认门。
---

# PLAN — 编排运行时扶正 + 自定义步骤扩展

对应入口：../intents/2026-09-25-wf-runtime.md
对应 spec：../specs/2026-09-25-wf-runtime.md

## 任务拆解

1. 复活运行时：从 6d6e239 恢复 `scripts/wf-run.mjs` / `wf-run.test.mjs` / `workflows/providers.json`（34 例回归绿，incident 修复全带）
   - 判据：wf-run.test.mjs 34/34；diff 6d6e239 仅叠加 steps 扩展
   - 风险：中（复活基线核对）
2. steps 扩展：运行时加载 `.agents/workflows/steps/*.mjs` + `wf.step(name, params)` + ctx（root/log/spawn/params）；新增用例（加载 / 调用 / 抛错进异常路径）
   - 判据：新增用例绿；_TEMPLATE 文档成文
   - 风险：中
3. 废 orchestrate + 口径改写：删命令（templates+装副本）；AGENTS.md / build.md 引用行改 runtime 口径；_TEMPLATE 重写（宿主互补口径）；示例恢复 .mjs；init.test ⑥ 断言改（含防 orchestrate 回流负向）
   - 判据：npm test 全绿；grep 无 orchestrate / 旧 runner 残留口径
   - 风险：低
4. sync + 关单：doctor 0 WARN、预算门（净减）、check-loop 无断档
   - 判据：doctor 0 WARN；push 无 advisory
   - 风险：低

## 执行顺序

1 → 2 → 3 → 4（复活是扩展基线）

## 验证方式

- 静态门：`npm test` 全绿；grep 残留扫描
- 预算门：pre-commit（预期净减）
- 闭环：test 阶段勾验 intent 验收后关单

## 确认与复核

- 确认结果：（待 spec 确认后本 plan 过门）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次）
