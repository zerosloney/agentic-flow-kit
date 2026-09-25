---
状态: draft
级别: L2
模块: pipeline
备注: 草稿随入口同提过配对门；spec 确认后本 plan 过确认门。
---

# PLAN — workflow 编排脚本宿主读取形态

对应入口：../intents/2026-09-25-wf-runtime.md
对应 spec：../specs/2026-09-25-wf-runtime.md

## 任务拆解

1. ZCode 形态模板脚本：`templates/_agents/workflows/示例-并行实现评审.zcode.ts`
   - 判据：自包含（仅 node 内置 import）——角色 prompt helper 内联读 `.agents/roles/`、编排骨架含并行 fan-out + gate + BLOCKER 约定 + delegations 留痕；四件固定约定齐备；头注「提交前过宿主 typecheck」
   - 风险：中（宿主 facade 细节——以 typecheck 门与「按当前 facade 调整」注记兜底）
2. `_TEMPLATE.md` 重写：可行性结论、四件约定、宿主互补口径、扩展指引（直接写宿主脚本）
   - 判据：口径与 spec 一致；无 runner / 声明表残留混写
   - 风险：低
3. 废 orchestrate + 口径收口：删命令（templates+装副本）与 `示例-并行实现评审.md`；AGENTS.md / build.md 引用行改「宿主读取」口径；init.test ⑥ 断言改（workflow 模板在位 / orchestrate 不回流）
   - 判据：npm test 全绿；grep 无旧口径残留
   - 风险：低
4. sync + 关单：doctor 0 WARN、预算净减、check-loop 无断档
   - 判据：doctor 0 WARN；push 无 advisory
   - 风险：低

## 执行顺序

1 → 2 → 3 → 4

## 验证方式

- 静态门：`npm test` 全绿；grep 残留扫描
- 预算门：pre-commit（预期净减）
- 闭环：test 阶段勾验 intent 验收后关单

## 确认与复核

- 确认结果：（待 spec 确认后本 plan 过门）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次）
