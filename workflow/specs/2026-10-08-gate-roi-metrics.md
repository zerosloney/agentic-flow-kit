---
状态: done
级别: L2
日期: 2026-10-08
模块: pipeline
备注: 关联 intent 2026-10-08-gate-roi-metrics（L2 防御道，用户 2026-10-08「先做 2，再做 1」）
确认指纹: 453961239fa1291b
---
# SPEC — gate-roi-metrics

对应入口：../intents/2026-10-08-gate-roi-metrics.md

## 功能行为

**场景 A · 段间插桩（默认静默）**：`check-loop.mjs` 主流程引入段标记 `gateSeg(id, label)`。在每段**开始**处记录 `warnings.length` / `blockers.length` 与时间戳，在**下一次 `gateSeg` 调用**时结算上一段（写入 `{id, label, warns, blocks, ms}`）。**判定逻辑、判定文案、所有 `warnings.push` / `blockers.push` 调用点零改动**——统计完全由长度差推出，不侵入任何检查体。

**场景 B · 默认路径零影响**：不带 flag 运行时，stdout / stderr / 退出码与插桩前**逐字节相同**。统计数组在内存中构建但不打印、不写盘。**这是硬约束**——pre-push / pre-commit 消费者、doctor 的 WARN 行计数、check-loop.test.mjs 的 223 条断言全部依赖输出契约。

**场景 C · `--gate-stats` 显式落盘**：加该 flag 时，跑完后向 `<root>/.agents/cache/gate-stats.jsonl` append 一行 `{ts, root, segs:[{id,label,warns,blocks,ms}], totalMs}`，并向 stderr 打一行摘要（`[gate-stats] 14 段已记账 …`）。**IO 失败只出账不阻断**（沿 verify.mjs 凭证落账同款容错）。`.agents/cache/` 已在 `.gitignore`，故落盘后 `git status` 仍干净。

**场景 D · 聚合**：`agg-gate-stats.mjs` 读该 jsonl → 按检查 ID 聚合 → 输出表（运行次数 / 命中次数 / 拦截数 / 警告数 / 平均耗时 ms）+ 两类结论：**噪声率 top N**（警告数 ÷ 命中次数，降序）与 **死检查**（声明了但从未命中的段）。支持 `--days N` 窗口（默认 30）。

**场景 E · DASHBOARD 增节**：`gen-workflow-dashboard.mjs` 增「门禁 ROI」节，从 cache 聚合（无数据时显示「未采集——跑 check-loop --gate-stats」并优雅降级）。**观测面非门禁**：红灯提示看不拦提交（沿 DASHBOARD 既定语义）。

**边界与异常**：cache 目录不存在 → 自动创建；jsonl 坏行 → 跳过不抛（与 confirmations.jsonl 同容错口径）；非 git 仓 / fixture 模式 → 照常统计（长度差机制与 git 无关）；单段耗时含 spawn 子进程时间（检查 11 调两个生成器 `--check`、检查 13 调 `sh rule-budget.sh`）——**这正是要度量的成本，不做剔除**。

## 数据流

- 采集：`runCheckLoop` 主流程 → `gateSeg(id,label)` 边界处记 `{w: warnings.length, b: blockers.length, t: Date.now()}` → 下次调用时结算 `{id, label, warns: Δw, blocks: Δb, ms: Δt}` → 结束段在输出段前结算 → `--gate-stats` 时 append jsonl。
- 聚合：`agg-gate-stats.mjs` → 读 jsonl（坏行跳过）→ 按 id 聚合 hits/blocks/warns/Σms/样本数 → 排序 → stdout 表 + 两类结论。
- 消费：`gen-workflow-dashboard.mjs` 的新节调同一聚合函数（`require` 复用，判据单源）；无 cache 数据 → 降级提示。

## 系统改动清单

1. **修改** `templates/_agents/scripts/check-loop.mjs`：
   - 新增模块级纯零件 `export function gateSeg(collector, id, label)`（便于测试直测，不依赖主流程）；
   - `runCheckLoop` 内新增 `gateStats` 收集器 + 14 个段前插一行 `gateSeg(...)`；
   - 输出段前结算末段；
   - `takeOpts()` 增 `--gate-stats`（用法错误文案同步）；
   - 落盘仅在 flag 为真时执行，写 `.agents/cache/gate-stats.jsonl`。
2. **新增** `templates/_agents/scripts/agg-gate-stats.mjs`：导出 `aggregate(rows, now, days)`（pure，供测试）+ CLI（`--days N`）。
3. **新增** `templates/_agents/scripts/agg-gate-stats.test.mjs`：聚合数学 / 坏行容错 / 死检查识别 / 噪声率排序 / 空数据降级。
4. **修改** `templates/_agents/scripts/gen-workflow-dashboard.mjs`：增「门禁 ROI」节 + 复用 `aggregate`；无数据优雅降级。
5. **修改** `templates/_agents/scripts/gen-workflow-dashboard.test.mjs`：增无数据降级场景。
6. **修改** `templates/_agents/scripts/check-loop.test.mjs`：增「默认路径输出逐字节不变」回归（插桩不改变既有 223 断言的预期输出——既有断言零改动即最强钉子）+ `--gate-stats` 落盘场景。
7. 实现后 `node bin/flow-kit.mjs sync`。

无删除、无新依赖。

## 约束遵守映射（对照 AGENTS.md 触达红线）

| 红线 | 本 spec 如何满足 |
|---|---|
| 门禁稳定输出契约 | **默认路径不打印不写盘**；插桩前后 stdout+stderr 逐字节对账 diff 为空作关单硬证据；既有 223 断言零改动即钉子 |
| 不改判定逻辑与文案 | 只加段边界调用，**不动任何 push 调用点**；统计由长度差推出 |
| 不污染工作区 | 落 `.agents/cache/`（已 gitignore）；不入 git、不进 kit.json managed 台账 |
| 防不可消除噪声 | 统计默认静默；无数据时看板降级为提示而非报错 |
| 不增门禁编号 | 只读现有编号，不新增检查项；聚合器引用 id 不定义 id |
| 引擎双源纪律 | 改 `templates/` → sync |
| 新脚本测试覆盖（检查 20） | `agg-gate-stats.mjs` 必带同名 `.test.mjs`，不开豁免 |

## 风险评估

- **插桩破坏输出契约**｜高｜默认路径零打印；插桩前后逐字节对账；223 断言零改动。若对账非空即视为实现失败，不得放行。
- **段边界漏插或重复插**（某检查被记到相邻段）｜中｜段标记紧贴 `// --- N.` 注释行；聚合器输出逐段列出供人工核对；测试断言段数 == 14 且 id 唯一。
- **耗时口径失真**（spawn 子进程时间计入）｜中|**刻意保留**——门禁真实成本就是要含子进程；但在 spec 与看板显式声明口径，避免下一个人误读为「纯计算耗时」。
- **cache 目录被 sync 收编进 managed 台账**｜中｜`.agents/cache/` 已在 `.gitignore` 且不在包源 glob 内；`flow-kit sync` 按包源清单安装，不会收编运行时产物（`papercuts` 2026-10-05 探针临时件事故的教训：临时件生命周期须罩住台账刷新——本单落点选在**已 gitignore 的 cache 目录**，正是为避开该类事故）。
- **数据量不足就下结论**｜中｜`--days` 窗口默认 30 且在输出中标注样本数；intent G5 明确「本单不自动拆门」。
- **首次运行无数据导致看板报错**｜中｜无 cache 时看板降级为提示行，不报错、不留空节。

## 确认与复核

- 确认日期：
- 复核：L2 独立复核未执行（用户 2026-10-08 放行）。主智能体以「插桩前后逐字节对账 + 223 断言零改动 + 段数/id 唯一性断言 + 实仓首轮数据」取证替代；重点核对输出契约与段归属正确性。