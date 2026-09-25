---
状态: approved
级别: L2
模块: pipeline
备注: 草稿随入口同提过配对门；spec 确认后本 plan 过确认门。
---

# PLAN — kit 编排机制：编排脚本 + steps 扩展点

对应入口：../intents/2026-09-25-wf-runtime.md
对应 spec：../specs/2026-09-25-wf-runtime.md

## 任务拆解

1. 机制文档：`workflows/_TEMPLATE.md` 重写（自动加载口径 / stages 三形态语义 / steps 扩展点约定 / 执行口径与纪律）
   - 判据：口径与 spec 一致；无 runner / orchestrate 残留混写
   - 风险：低
2. 装户件：示例编排脚本更新（含 step 行示范）+ 新增 `workflows/steps/示例-部署验证.md`（params 约定 + 执行指引示范）
   - 判据：示例走查通过三形态各至少一处（role 派单 / step / gate）
   - 风险：低
3. 废 orchestrate + 口径收口：删命令（templates+装副本）；AGENTS.md 常驻指令一行 + build.md 引用行改口径；init.test ⑥ 断言改（声明件 + steps 在位 / orchestrate 不回流）
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

- 确认结果：approved（2026-09-25 plan 全文与改动清单呈递后用户指示继续——内容为已确认骨架的机械转写，无新增决策点）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次）
