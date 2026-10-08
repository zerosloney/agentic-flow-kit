---
状态: done
级别: L2
日期: 2026-10-08
模块: pipeline
备注: 关联 intent 2026-10-08-selfmeasure-and-modularize（L2 防御道，含用户两处取舍拍板）
确认指纹: aea4950099279f87
---
# SPEC — selfmeasure-and-modularize

对应入口：../intents/2026-10-08-selfmeasure-and-modularize.md

## 功能行为

**场景 A · DASHBOARD 生成物漂移门（新增）**：`gen-workflow-dashboard.mjs --check` 渲染当前值到内存，与盘面 `workflow/DASHBOARD.md` 逐行比对——**比较前两侧均把「生成于 <ISO 时间戳>」归一**（该行本就随每次运行变化，不归一则恒漂移、门禁必红）。一致 → exit 0 静默；不一致 → exit 1 并打印首行差异 + 修复命令；盘面文件缺失 → exit 1 + 提示生成。CLI 既有 `--dry-run`（不写盘）行为零变化，无参默认写盘行为零变化。

**场景 B · check-loop 检查 11 覆盖面扩展**：`check-loop.mjs` 检查 11 从「仅 `workflow/INDEX.md`」扩为「**生成物漂移（INDEX + DASHBOARD）**」——遍历两个生成器，各跑一次 `--check`，各自独立 WARN 文案并指名修复命令。**判定口径不复刻渲染**（沿检查 11 既有纪律：调生成器 `--check`，口径单一）。装户语义：生成器脚本不存在（旧装副本）→ 跳过；`workflow/DASHBOARD.md` 不存在（从未生成过）→ 跳过不报——**新装用户不得因未生成过看板而在每次 push 吃常驻 WARN**。

**场景 C · 门禁噪声返工归因拆分**：`agg-delegations.cjs` 的 `parseResult` 新增取值 `返工×N（门禁噪声）` → `{kind:'rework-noise', rework:N}`。`metrics()` 双列累计：`reworkSum`（**仅** `kind:'rework'`）与 `reworkNoiseSum`（仅 `kind:'rework-noise'`）。扩容门第 3 项「月度返工次数 = 0」判据改为**只对设计返工判 `=0`**，门禁噪声返工在同一条描述里单列观测（不计入 `ok` 判定）。**存量行零回填**：旧取值 `一次通过 / 返工×N / 主兜底 / 返工待修` 的解析与判定逐条不变（与 batch/seq/of 纯增字段先例同款）。

**场景 D · check-loop 卫生类检查拆模块**：检查 2 / 9 / 11 / 12 / 13 迁入新模块 `check-hygiene.mjs`，由 `check-loop.mjs` 调用。五检查的判定口径与 WARN 文案**逐字节不变**（stash 同状态 stdout+stderr 对账 `diff` 为空作关单证据）。拆分只搬代码不改判据。

**场景 E · metrics.md 刷真值**：重跑 `gen-workflow-metrics.mjs`，2026-10 行刷成实盘值。**不新增任何门**——沿 `gen-workflow-metrics.mjs:9` 既定设计（快照是历史记录，逐字节漂移校验会常红）。

**场景 F · 文档单源化与措辞校准**：删 `README.md` 两处过期表述（「当前能力（已发布 0.8.0）」整节逐条特性枚举 + 「活跃层 09-23~09-28 未改成 done」陈旧段），改为指向 `CHANGELOG.md` 的单源表述；删 `CHANGELOG.md:3` 反向互指「未打进 package.json 的改动见 README『当前能力』」。README 确认门表述补「留痕而非防伪」限定，与 `.agents/scripts/stage-gates.mjs` 头部已声明的信任边界对齐。

**边界与异常**：`--check` 与 `--dry-run` 同时传入 → `--dry-run` 优先且不比对（不写盘，无可比对象）；生成器 `spawn` 异常 → 检查 11 按既有 `fs.existsSync(gen)` 前置短路，不新增异常路径；拆分模块 import 零副作用（无顶层执行，与 `check-metric-claims.mjs` 先例同款）；缺 `rule-budget.sh` 或 `workflow-modules.txt` → 沿既有 `existsSync` 跳过。

## 数据流

- **DASHBOARD 漂移门**：`runCheckLoop` 检查 11 → `spawnSync(node, [gen-workflow-dashboard.mjs, --check])` → 生成器内 `collectDoneIntents` / `collectDoneMap` / `qualityRows`（既有纯函数）渲染 → 读 `workflow/DASHBOARD.md` → 双侧「生成于」行归一 → 逐行比对 → exit 码 → 检查 11 收 WARN 文案（取子进程输出首行拼进提示，沿既有 `[WARN 索引漂移]` 文案形态）。
- **返工归因**：`delegations.md` 两张表 → `splitTables`（表头签名）→ `readLedger` → `parseResult`（新增取值分支）→ `metrics`（双列累计）→ `gateMonth` 第 3 项（判据改设计返工）→ `expansionVerdict` → `gen-workflow-dashboard.mjs` 的 `qualityRows` 复用处同一判据 → `DASHBOARD.md` 质量表（新增「门禁噪声」列）。
- **拆分模块**：`check-loop.mjs` 组装 ctx（`{ root, docFiles, linesOf, fmGet, isTracked, readdirOrNull, kitPolicy }`）→ `check-hygiene.mjs` 的 `runCheckHygiene(ctx)` 返回 `string[]` → 调用方 `warnings.push(...ret)`。**ctx 传入既有 helper 而非模块内复刻**——`docFiles` 的「仓库模式只扫 tracked（HEAD）」语义、`fmGet` 的 frontmatter 受限子集口径均属 check-loop 核心语义，复刻即制造口径漂移点。

## 系统改动清单

1. **修改** `templates/_agents/scripts/gen-workflow-dashboard.mjs`：`main()` 加 `--check` 分支（渲染 → 归一「生成于」行 → 比对盘面 → exit 0/1 + 差异首行）；既有 `--dry-run` / 无参写盘分支不动。
2. **修改** `templates/_agents/scripts/agg-delegations.cjs`：`parseResult` 加 `返工×N（门禁噪声）` 分支；`metrics()` 增 `reworkNoise` / `reworkNoiseSum`（`reworkSum` 排除 noise）；`gateMonth` 第 3 项判据改设计返工单列；输出行补门禁噪声计数；`qualityRows` 消费方同步（由 DASHBOARD 生成器调用）。
3. **新增** `templates/_agents/scripts/check-hygiene.mjs`：承载检查 2 / 9 / 11（扩展）/ 12 / 13，导出 `runCheckHygiene(ctx)`。
4. **新增** `templates/_agents/scripts/check-hygiene.test.mjs`：五检查正反场景 + ctx 缺项降级场景（fixture root 注入，不触真实 workflow/）。
5. **修改** `templates/_agents/scripts/check-loop.mjs`：删检查 2 / 9 / 12 / 13 四段（约 92 行），检查 11 段改为调 `runCheckHygiene`；文件头检查项清单的检查 11 条目文案补 DASHBOARD；import 段加一行。
6. **修改** `templates/_agents/scripts/check-loop.test.mjs`：补 DASHBOARD 漂移场景（检查 11 覆盖扩展）；既有 219 断言零改动。
7. **修改** `templates/_agents/scripts/agg-delegations.test.mjs`：补新取值解析 + 扩容门第 3 项判据场景；旧取值场景断言不动。
8. **修改** `templates/_agents/scripts/gen-workflow-dashboard.test.mjs`：补 `--check` 一致 / 不一致 / 时间戳归一三场景。
9. **修改** `workflow/delegations.md`：头部记法补 `返工×N（门禁噪声）` 取值定义与判定口径（什么算门禁噪声：预算超限、双源漏刷、节名不一致、门禁自身误报等）。
10. **修改** `README.md`：删两处过期表述，确认门措辞补「留痕而非防伪」限定（owned 件）。
11. **修改** `CHANGELOG.md`：删首行反向互指；版本条目随本次改动补写。
12. **生成物**：重跑 `gen-workflow-metrics.mjs`（刷十月行真值）+ `gen-workflow-dashboard.mjs`（刷当前值）+ `gen-workflow-index.mjs`（新增文档后重生成）+ `gen-workflow-dashboard.mjs --check` 自验。
13. 实现后 `node bin/flow-kit.mjs sync`（装副本成对，kit.json 台账刷新）。

无删除、无新依赖（仅 node 标准库）；门禁判据口径与 WARN 文案零改动（除检查 11 覆盖面与第 3 项扩容门判据两处**显式声明的行为变更**）。

## 约束遵守映射（对照 AGENTS.md 触达红线）

| 红线（按本项目 AGENTS.md 实际红线逐行填） | 本 spec 如何满足 |
|---|---|
| 引擎双源纪律 | 一律改 `templates/`（包源）→ `node bin/flow-kit.mjs sync` 更新 `.agents/` 装副本；`.agents/` 不直改（直改会被 doctor 台账漂移 FAIL） |
| 检查项编号不得增删改（`gate-checklist.mjs` PAIRS 按 id 消费） | 检查 11 **扩覆盖面**而非新增编号；11 的条目文案按既有措辞追加 DASHBOARD |
| 门禁稳定输出契约（pre-push / pre-commit 消费者） | 拆分后 CLI stdout+stderr 逐字节不变为硬验收：stash 同状态前后对账 `diff` 为空；五检查文案零改动 |
| 不产出不可消退噪声（`2026-09-27-audit-gate-hardening` P3 教训） | ①「生成于」时间戳归一后再比对，否则门禁必红；②装户 DASHBOARD.md 缺失 → 跳过不报；③metrics.md 明确**不挂门**（沿 `gen-workflow-metrics.mjs:9` 既定设计） |
| 引擎脚本测试覆盖（检查 20） | 新增 `check-hygiene.mjs` 必带同名 `check-hygiene.test.mjs`；不开豁免登记 |
| 删既有代码 STOP 线 | 检查 2/9/12/13 为**代码搬迁**而非删除（判定逻辑与文案整体移入新模块，git 可逐行对位）；检查 11 为扩覆盖面 |
| 确认门留痕语义 | `stage-gates.mjs` 的信任边界声明不动；README 措辞向之对齐而非反向升格 |

## 风险评估

- **拆分后判定漂移**（搬运时漏带 `kitPolicy` / `isTracked` 等闭包）｜中｜ctx 全量传入既有 helper，模块内零复刻；stash 同状态 stdout+stderr 对账 `diff` 为空作硬验收；`check-hygiene.test.mjs` 五检查正反场景 + `check-loop.test.mjs` 既有 219 断言全量保留为行为回归网。
- **DASHBOARD `--check` 因时间戳恒红**（新门一上线就不可用）｜中｜比对前双侧归一「生成于」行；测试三场景钉住（一致 / 内容漂移 / 仅时间戳不同→exit 0）。
- **装户因未生成过 DASHBOARD 常红**｜中｜检查 11 在 spawn 前判 `fs.existsSync(DASHBOARD.md)`，缺失即跳过；测试覆盖缺失分支。
- **扩容门第 3 项判据放宽被当成降低标准**｜中｜判据改为「设计返工 = 0」并在同条描述里显式列出被移出的门禁噪声计数，数字仍可见不隐藏；`delegations.md` 头部写清门禁噪声定义与边界（不可用于给设计返工贴标签）。
- **门禁噪声标记被滥用**（设计返工贴「门禁噪声」标签洗白指标）｜中｜该取值由作者手写、机器无法判定真伪——同 `--delegated` 信任边界；缓解是口径写进台账头部且检查 18 对账仍要求 L2/L3 落台账行。
- **存量 delegations 行被重新解释**｜低｜旧取值解析分支不动，纯新增；测试旧场景断言不变作钉子。
- **`check-hygiene.mjs` 引入兄弟依赖打破 check-loop 自包含**（门禁脚本自包含是既有设计先例）｜低｜模块是 check-loop 的**被调用方**（单向依赖 check-loop → 模块），不是反向；沿 `check-metric-claims.mjs` 既有先例（已被 check-loop import）。
- **README owned 件改动触发台账漂移 FAIL**｜低｜改完跑 `node bin/flow-kit.mjs sync` 刷 owned 记账（sync 每次按盘面自愈刷新）。

## 确认与复核

- 确认日期：2026-10-08
- 复核：**L2 独立复核未执行**（用户 2026-10-08 拍板放行并承担取舍；本仓单人 + AI 协作，无第二审批人）。主智能体以实测量替代，覆盖 spec 风险表列出的全部高风险项：
  - 拆分后判定漂移 → **拆分前后 CLI stdout+stderr 逐字节对账 diff 为空**（取 HEAD 旧件跑 before、sync 后跑 after，两次 exit 0）；`check-loop.test.mjs` 223/0 全量回归网 + `check-hygiene.test.mjs` 10/0。
  - `--check` 时间戳恒红 → 纯函数层三态直测（仅戳不同→相等 / CRLF→相等 / 内容漂移仍不等）+ 关单前实仓三态复验。
  - 装户常红 → `check-loop.test.mjs` 场景 27b 与 `check-hygiene.test.mjs` 各覆盖「DASHBOARD.md 缺失→跳过」。
  - ctx 传入完整性 → **该判据实测抓到一次真实集成 bug**：模块解构 `root` 而 check-loop 实参传 `ROOT`，被 doctor 的 check-loop FAIL 拦下（模块自测用自己的 ctx 组装函数故全绿）。已修并补入回归网。
  - 扩容门第 3 项意图保真 → `agg-delegations.test.mjs` 反例断言「设计返工 1 + 噪声 1 → 门 3 仍 ❌」钉住不可用噪声标签洗白。
- 偏离留痕：① spec 写「检查 2/9/12/13 迁出」，实现时把检查 11 一并迁入同一模块（检查 11 本次要扩 DASHBOARD 覆盖面，与拆分开销同批做更省一次回归面）；② spec 写 `agg-delegations` 改 `gateMonth` 第 3 项，实现时 `avgRework` 仍含噪声以保 `delegations.md` 快照表结构零改动（spec 未明写此点，属实现期的兼容决策，已同步写入该文件注释与测试断言）。