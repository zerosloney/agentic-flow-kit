---
状态: done
级别: L2
模块: pipeline
确认指纹: dc614a20dd2692d8
---
# PLAN — caliber-convergence（口径收敛批）

对应入口：../intents/2026-10-02-caliber-convergence.md
对应 spec：../specs/2026-10-02-caliber-convergence.md（泳道方案 C 分歧双严已定案）

## 改动方案

- `templates/_agents/scripts/stage-gates.mjs`（+装副本）：导出 `laneOf(fm)` 三态（low/high/suspect）与消费谓词；自身 draftGateFor 改用（suspect 按 high 不豁免）
- `templates/_agents/scripts/check-loop.mjs`（+装副本）：检查 1（suspect 按 low 拦红线）/ 加固门 lane（suspect 按 high）/ 逐阶段（suspect 按 high）改 import laneOf；检查 2 剥行内代码与围栏块再测占位符；头注「1-19」→「1-20」
- `templates/_agents/scripts/check-lane-surface.mjs`（+装副本）：活跃入口判定改 laneOf（suspect 计 high、不作豁免依据）；修法消息改「两字段同时升级并双写对齐」
- `templates/_agents/scripts/confirm-doc.mjs`（+装副本）：`--batch` 逐份级别读取改 laneOf（suspect 拒批量）
- `templates/_agents/scripts/fill-intent.mjs`（+装副本）：头注节数修正（仅注释）
- 测试：check-loop.test.mjs（laneOf 三态 + 三消费点分歧断言 + check 2 豁免三态）、check-lane-surface.test.mjs 与 confirm-doc.test.mjs（suspect 态断言与消息一致性）
- owned 对文档：`build.md`/`plan.md`/`design.md`/`sync-hosts.md`（根+模板）——plan 四节单套口径 + 7/6 节矛盾 + Working rules 引用 + 8→11；`workflow/README.md` 对——L1 三节；`workflow/plans/_TEMPLATE.md` 对——头注三节；根 `AGENTS.md`——6 字段限定 intent
- `.agents/kit.json`：sync 自动

## 任务拆解（L2/L3 必填）

1. laneOf 单源 + stage-gates 接入
   - 判据：laneOf 三态单测全绿（一致 low/high + 缺失/非法/分歧三型 suspect）；draftGateFor suspect 态不再豁免（fixture）
   - 风险：中（语义变更经 spec 授权；分歧态收紧方向）
2. 四消费点接入（check-loop ×3 / confirm-doc / check-lane-surface）
   - 判据：各点 suspect 断言绿——红线照拦 / 豁免全拒；lane-surface 消息含「两字段」指引；既有用例无 expectHard→expectOk 方向回退
   - 风险：中（多点位，靠套件回归）
3. check 2 样例豁免
   - 判据：反引号/围栏块内样例不报、裸占位符照报（三态 fixture）；真仓 advisory 占位符误报清零
   - 风险：低
4. 文档口径对齐（owned 对 ×6 组）
   - 判据：L1 三节/L2-L3 四节四处逐字一致；全库 grep「两节起步 / 风险评估 / 遗留项 / Working rules / 不占 1-19 / 8 个 commands」清零（AGENTS 适配区 6 字段行限定 intent）
   - 风险：低（纯文档；注意 owned 对手动双改）
5. sync + 全量验证
   - 判据：sync 无漂移；npm test 全绿；verify 全绿；check-loop 无新增 hard-block 且 advisory 占位符噪声下降；gate-checklist --diff 0/0
   - 风险：低

## 执行顺序（L2/L3 必填）

1 → 2 → 3 → 4（与 2/3 可并行）→ 5 收口。实现前先跑一次 check-loop 记录 advisory 基线（供 3 的前后对照）。

## 验证计划

- 静态门：测试 = `npm test`（含新增三态断言）；构建 = 无
- L2 追加：口径四处对照 grep 清单；advisory 前后对照（占位符误报归零）；gate-checklist 口径对账；独立复核一致性
- 前端 / UI / L3：不适用

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done。
- 确认结果：approved（2026-10-02 用户对话内确认，原话「执行」——plan 全文过目）；done（2026-10-02 关单，随入口文档置终态；实现 6d0e9fb + 复核收口 2989d9c，初判修复后放行 P1×2/P2×2 全收）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（改动方案节随 plan 全文一并过目确认）
- 复核：已完成——初判「修复后放行」（P1×2/P2×2），全收随 2989d9c；口径单源 / 方案 C 映射 / 豁免不缩面 / 断言无回退均核实