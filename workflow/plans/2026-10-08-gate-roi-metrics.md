---
状态: approved
级别: L2
模块: pipeline
确认指纹: 4d39b11bc1ae20ad
---
# PLAN — gate-roi-metrics

对应入口：../intents/2026-10-08-gate-roi-metrics.md
对应 spec：../specs/2026-10-08-gate-roi-metrics.md

## 改动方案

### `templates/_agents/scripts/check-loop.mjs`（旁路插桩，判定零改动）

- 新增导出纯零件 `gateSeg(collector, id, label)`：在每次调用时**结算上一段**（`warns = warnings.length - prev.w`，`blocks = blockers.length - prev.b`，`ms = now - prev.t`）再记新段的起点。`collector` 形如 `{ warnings, blockers, segs: [] }`。
- `runCheckLoop` 内建 `collector = { warnings, blockers, segs: [] }`；在 **14 个 `// --- N.` 段注释之后、检查体之前**各插一行 `gateSeg(collector, 'N', '<label>')`（label 取头部清单同款标题）。
- 输出段前补一次「结算末段」调用（末段后无下次调用，须显式结算）。
- `takeOpts()` 增 `--gate-stats`；跑完且该 flag 为真时 append `<root>/.agents/cache/gate-stats.jsonl`（`{ts, root, segs, totalMs}`）并向 stderr 打一行摘要；IO 失败只出账不阻断。
- **默认路径（无 flag）不打印不写盘**，stdout/stderr/退出码逐字节不变。

### 新增 `templates/_agents/scripts/agg-gate-stats.mjs` + 同名 `.test.mjs`

- `export function aggregate(rows, now, days)`（pure）：按 `id` 聚合 `{runs, hits, blocks, warns, msSum, avgMs}`；`hits` = 该段至少命中一次（warns+blocks > 0）的运行数。
- 派生结论：`noiseTop` = 按 `warns / max(hits,1)` 降序取前 N；`dead` = 声明了但 `hits === 0` 的段。
- CLI：`--days N`（默认 30）；输出表 + 两类结论 + 样本数与窗口声明（样本不足时显式提示「结论待样本积累」）。

### `templates/_agents/scripts/gen-workflow-dashboard.mjs`

- 增「门禁 ROI」节：`require('./agg-gate-stats.cjs')`…**注意本件为 `.mjs`，改用 `createRequire` 复用 `agg-gate-stats.mjs` 的 ESM 导出**；无 cache 数据 → 显示「未采集——跑 `check-loop --gate-stats`」并优雅降级（不报错、不留空节）。

### 测试

- `check-loop.test.mjs`：既有 223 断言**零改动**（最强输出契约钉子）+ 新增 `--gate-stats` 落盘场景 + 段数 == 14 且 id 唯一断言。
- `agg-gate-stats.test.mjs`：聚合数学 / 坏行容错 / 死检查识别 / 噪声率排序 / 空数据降级。
- `gen-workflow-dashboard.test.mjs`：增无 gate-stats 数据时降级不报错。

## 任务拆解

1. **check-loop 段间插桩 + `--gate-stats`**
   - 判据：14 段全部计入、id 唯一且与头部清单一致；默认路径 stdout+stderr 逐字节对账 diff 为空；`--gate-stats` 落盘 jsonl 且 `git status` 仍干净。
   - 风险：**高**（输出契约）→ 对账为硬门。
2. **`agg-gate-stats.mjs` 聚合器 + 测试**
   - 判据：聚合数学正确（命中/拦截/警告/均耗时）；坏行跳过不抛；死检查与噪声 top 识别正确；空数据降级。
   - 风险：中
3. **DASHBOARD 增「门禁 ROI」节**
   - 判据：有数据时出表；无数据时提示且不报错；`--check` exit 0。
   - 风险：中
4. **实仓首轮数据 + 结论**
   - 判据：跑 `check-loop --gate-stats` 落盘，`agg-gate-stats` 产出可读结论（哪些检查在产噪声、哪些是死检查），结论写进台账留痕。
   - 风险：中（样本仅 1-2 次运行，**必须显式标注样本不足**）
5. **全量验证 + 关单**
   - 判据：输出逐字节对账空、`verify.mjs` exit 0、`doctor` 0 FAIL、双源零 diff、两笔 commit。

## 执行顺序

1 → 2 → 3 → 4 → 5。1 必须先做（否则 2/3 无数据可聚合）；4 依赖 1/2/3 全通；5 收口。

## 验证计划

- **输出契约（本批最关键证据）**：插桩前后分别跑 `node .agents/scripts/check-loop.mjs`，stdout+stderr 逐字节 `diff`（须为空）、退出码相同。
- 回归网：`check-loop.test.mjs` 223 断言零改动全绿。
- 新增断言：段数 == 14、id 唯一且 ∈ 头部清单编号集、`--gate-stats` 落盘后 `git status` 干净。
- 聚合数学：`agg-gate-stats.test.mjs` 直测。
- 看板降级：无 cache 时不报错 + `--check` exit 0。
- 静态门：`verify.mjs`（npm test + check-loop）、`doctor`、双源 sha 零 diff。
- L2 追加：核对段归属正确性（抽 2-3 段人工验证归属：其 warns/blocks 与该检查实际输出条数一致）。

## 确认与复核

- 确认结果：approved（2026-10-08 用户对话内「先做 2，再做 1」）；done（待关单，随入口文档置终态）
- 确认门记录：intent/spec 逐份代录，原话「先做 2，再做 1」在 `.agents/confirmations.jsonl`
- 复核：L2 独立复核未执行（用户放行）。主智能体以输出逐字节对账 + 223 断言零改动 + 段归属人工抽查 + 实仓首轮数据取证替代。
- 偏离留痕：无（实现前已知悉 spec 全量）。