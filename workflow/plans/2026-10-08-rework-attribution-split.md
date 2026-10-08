---
状态: approved
级别: L2
模块: pipeline
确认指纹: f61eb9c045b7838b
---
# PLAN — rework-attribution-split

对应入口：../intents/2026-10-08-rework-attribution-split.md
对应 spec：../specs/2026-10-08-rework-attribution-split.md

## 改动方案

### 包源引擎（`templates/_agents/scripts/` → sync 装副本）

- `agg-delegations.cjs`：
  - `parseResult(raw)` 增**行内双值**分支：`/^返工×(\d+)\s*\+\s*门禁噪声×(\d+)$/` → `{ kind: 'rework-mixed', rework: N, reworkNoise: M }`（排在两个单值分支之前；宽容空格）。
  - 返回值统一为 `{ kind, rework, reworkNoise }`——`一次通过` → `{kind:'pass', rework:0, reworkNoise:0}`、`返工×N` → `{kind:'rework', rework:N, reworkNoise:0}`、`返工×N（门禁噪声）` → `{kind:'rework-noise', rework:0, reworkNoise:N}`、`主兜底` / `返工待修` / `unknown` 同理补对称字段（**既有取值域与判定不变**）。
  - `metrics()`：`reworkSum` 累加条件显式含 `rework` 与 `rework-mixed`；`reworkNoiseSum` 累加条件显式含 `rework-noise` 与 `rework-mixed`；`valid`（排除 pending/unknown）与 `total` 按**行**计——混合行仍是一个任务。
- `agg-delegations.test.mjs`：补行内双值场景（解析 / 双列 / `total` 不虚增 / 第 3 项判定 / 四格式互不误吞）；旧场景断言零改动。

### 台账 `workflow/delegations.md`

- 头部记法补第三种格式 `返工×N + 门禁噪声×M` 的定义与用法（何时用、何时不用）。
- **回溯标注：只改 L29 一行**——`adopter-ci-github` 结果列 `返工×2` → `返工×1 + 门禁噪声×1`，备注列补依据（① 规则面预算拦 AGENTS.md 7969B>7680 = 合法增长被历史上限拦，标噪声；② rule-budgets 只改装副本 = 真实双源违约，留在设计返工）。
- **新增「返工归因回溯判定留痕」节**：29 行逐行结论（可标 / 不可标 / 不可精确拆分 + 原因）+ 「结果列返工点数 < 备注列返工点数」的存量行清单。

### 生成物

- 重跑 `gen-workflow-dashboard.mjs`：2026-10 设计返工 16 → 15、门禁噪声 0 → 1。

## 任务拆解

1. **`parseResult` 行内双值 + 返回值字段对称化**
   - 判据：新格式解析出两个分量；旧三格式解析**逐条不变**（既有测试断言零改动即钉子）；`返工×a` 落 `unknown`；无空格变体可解析。
   - 风险：中（新分支误吞旧格式）
2. **`metrics()` 双列累计 + 任务总数不虚增**
   - 判据：双值行 `total`=1、`reworkSum`=1、`reworkNoiseSum`=1；`passRate` 分母不因两个数字变化；扩容门第 3 项在「设计 0 + 噪声 N」时判 ok 且描述带噪声数。
   - 风险：中（total 虚增抬高一次通过率分母）
3. **台账头部记法补格式**
   - 判据：头部含三格式定义 + 用法边界；`splitTables` 表头签名不受影响（结果列内容不进表头识别）。
   - 风险：低
4. **回溯标注 L29 + 判定留痕节**
   - 判据：L29 结果列改写且备注列写明依据；留痕节覆盖全部 29 行结论 + 不可精确拆分清单。
   - 风险：中（洗白工具化——以「只标 1 行 + 逐点依据 + 其余留痕」约束）
5. **重生成 + 全量验证 + 关单**
   - 判据：DASHBOARD 2026-10 设计返工 15 / 噪声 1；`verify.mjs` exit 0；`doctor` 0 FAIL；双源零 diff；两笔 commit 关单。
   - 风险：低

## 执行顺序

1 → 2 → 3 → 4 → 5。1/2 同文件同段，一次改完再跑测试（避免中间态测试红两次）；3 独立；4 依赖 1/2（先确认解析支持再改数据，否则改完解析不了）；5 收口。

## 验证计划

- 单元：`node templates/_agents/scripts/agg-delegations.test.mjs`（旧场景 + 新场景全绿）
- 端到端：`node .agents/scripts/gen-workflow-dashboard.mjs` 后读 `workflow/DASHBOARD.md` 质量表，确认 2026-10 设计返工降 1、噪声升 1，2026-09 行不变
- 不变量 ①：旧格式逐条不变——既有测试断言零改动是钉子
- 不变量 ②：`total` 不虚增——新增断言专测
- 静态门：`node .agents/scripts/verify.mjs`（npm test + check-loop）、`node bin/flow-kit.mjs doctor`
- 双源：`templates/_agents/scripts/agg-delegations.cjs` 与 `.agents/scripts/` sha 零 diff
- L2 追加：核对旧格式零行为变化与 total 不虚增两条；核对回溯标注的可对质性（每条噪声标注有依据）

## 确认与复核

- 确认结果：approved（2026-10-08 用户对话内确认，授权按 B 方案直接执行）；done（待关单，随入口文档置终态）
- 确认门记录：用户 2026-10-08 追问「怎么不执行？」= 授权不再停在选项确认；intent/spec 逐份代录，原话在 `.agents/confirmations.jsonl`
- 复核：L2 独立复核未执行（用户放行）。主智能体以测试 + 实仓指标变化 + 逐行留痕替代。
- 偏离留痕：无（本单实现前已知悉 spec 全量，未改判据范围）