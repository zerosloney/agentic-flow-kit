---
状态: approved
级别: L2
模块: pipeline
确认指纹: 347d09aa00cb6aba
---
# PLAN — selfmeasure-and-modularize

对应入口：../intents/2026-10-08-selfmeasure-and-modularize.md
对应 spec：../specs/2026-10-08-selfmeasure-and-modularize.md

## 改动方案

### 包源引擎（改 `templates/_agents/scripts/`，随后 sync 装副本）

- `gen-workflow-dashboard.mjs`：`main()` 增 `--check` 分支。渲染逻辑抽成可复用函数（`render()`），`--check` = `render()` → 读 `workflow/DASHBOARD.md` → 两侧把 `生成于 <ISO>` 归一为固定串 → 逐行比对。一致 exit 0 静默；不一致 exit 1 + 打印首个不一致行 + 修复命令；盘面缺失 exit 1 + 提示生成。既有 `--dry-run`（不写盘）与无参（写盘）分支不动。归一正则只吃 `生成于 <ISO8601>` 形态（`生成于 [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z`）。
- `agg-delegations.cjs`：
  - `parseResult` 增分支：`/^返工×(\d+)（门禁噪声）$/` → `{kind:'rework-noise', rework:N}`（**须排在既有 `^返工×(\d+)$` 之前判定**，否则后缀残留导致误配；用 `$` 锚定保证旧正则不吞新形态）。
  - `metrics()`：新增 `reworkNoise` / `reworkNoiseSum`；`reworkSum` 累加条件显式写 `kind === 'rework'`（不含 noise），避免口径漂移。
  - `gateMonth` 第 3 项：`ok: m.reworkSum === 0` 保持，但描述改为「月度**设计**返工 N=0（门禁噪声返工 M 次已剥离，单列不计）」——判据语义变更在文案显式可见。
  - stdout 有效任务行补 `门禁噪声返工 N` 计数。
- 新增 `check-hygiene.mjs`：`export function runCheckHygiene(ctx)`，ctx = `{ root, docFiles, linesOf, fmGet, isTracked, readdirOrNull, kitPolicy }`，返回 `string[]`。内含检查 2（模板占位符）、9（文件名 kebab）、11（生成物漂移，扩 DASHBOARD）、12（模块枚举）、13（体积预算）。**判定逻辑与 WARN 文案逐字搬运**，不改一字。文件头注释声明覆盖的检查号与 ctx 各字段来源（沿 `check-metric-claims.mjs` 先例形态）。
- 新增 `check-hygiene.test.mjs`：五检查各一正一反场景 + ctx 缺项降级（缺 `workflow-modules.txt` / `rule-budget.sh` 跳过）+ DASHBOARD.md 缺失跳过分支。fixture 用 `CHECK_LOOP_ROOT` 注入的临时根，不触真实 `workflow/`。
- `check-loop.mjs`：删检查 2（:386-428）、9（:854-865）、12（:908-928）、13（:930-941）四段；检查 11 段（:896-906）改为调 `runCheckHygiene`；import 段加 `import { runCheckHygiene } from './check-hygiene.mjs';`；文件头清单检查 11 条目文案补「+ workflow/DASHBOARD.md 漂移」。**不动其他 15 个检查的任何字符**。
- `check-loop.test.mjs`：补检查 11 覆盖 DASHBOARD 的场景（fixture 内放陈旧 DASHBOARD.md → 出 WARN；不存在 → 不出账）；既有 219 断言零改动。
- `agg-delegations.test.mjs`：补 `返工×N（门禁噪声）` 解析、`reworkNoise` 累计、第 3 项判据（noise 不影响 ok）三场景；旧取值场景断言不动。
- `gen-workflow-dashboard.test.mjs`：补 `--check` 三场景（一致 exit 0 / 内容漂移 exit 1 / **仅时间戳不同仍 exit 0**）。

### 台账与文档

- `workflow/delegations.md` 头部记法：结果列取值表补 `返工×N（门禁噪声）`，并写清定义与边界——**门禁噪声 = 预算超限 / 双源漏刷 / 节名不一致 / 门禁自身误报等由门禁面（而非设计面）触发的返工**；不得用于给设计返工贴标签（机器无法判真伪，同 `--delegated` 信任边界，由事后对质兜底）。
- `README.md`：
  - 删 `## 当前能力（已发布 0.8.0）` 节的逐条特性枚举与「仓库里还没打进版本号的增量」段（所列项全部已随 1.1.x / 1.2.x 发布），改为指向 `CHANGELOG.md` 的单源表述 + 一句当前语义说明。
  - 删「活跃层里 2026-09-23 至 09-28 的 approved / open 文档没有在这次改成 done」段（实盘活跃层 0）。
  - 五条硬规则节与产品描述：确认门表述补「留痕而非防伪」限定，与 `stage-gates.mjs` 头部信任边界声明对齐。
- `CHANGELOG.md`：删首行「未打进 `package.json` 的改动见 README『当前能力』」反向互指；新增本次版本条目。

### 生成物（重跑刷真值，非手改）

- `gen-workflow-metrics.mjs` → `workflow/metrics.md`（2026-10 行刷成 261 篇真值）
- `gen-workflow-dashboard.mjs` → `workflow/DASHBOARD.md`（刷当前值 + 新增门禁噪声列）
- `gen-workflow-index.mjs` → `workflow/INDEX.md`（新增三件套后重生成）
- `gen-workflow-dashboard.mjs --check` 自验 exit 0

## 任务拆解

1. **`gen-workflow-dashboard.mjs --check` + 检查 11 扩展**（修复 1 的门禁面）
   - 判据：`--check` 在仅时间戳不同时 exit 0、内容漂移时 exit 1 并打印差异；`check-loop.mjs` 对陈旧 DASHBOARD 出 `[WARN 仪表盘漂移]` 且文案含修复命令；DASHBOARD.md 缺失不报；`check-loop.test.mjs` 新场景通过。
   - 风险：中（时间戳归一写错 → 门禁恒红；缺存在性前置 → 装户常红）
2. **`agg-delegations.cjs` 门禁噪声返工 + 台账头部记法**（修复 2）
   - 判据：`parseResult('返工×2（门禁噪声）')` → `{kind:'rework-noise', rework:2}`；`metrics()` 的 `reworkSum` 不含 noise、`reworkNoiseSum` 含；`gateMonth` 第 3 项在「设计返工 0 + 噪声 2」时判 ok；旧取值四档解析逐条不变（旧测试断言零改动即钉子）。
   - 风险：中（正则顺序写反 → 新形态被旧正则吞掉；判据语义变更需文案显式可见）
3. **`check-hygiene.mjs` 拆分 + 四段删除 + 新测试**（修复 3）
   - 判据：`git stash` 同状态下跑拆分前后 `check-loop.mjs`，stdout+stderr `diff` 为空（含 banner / 空行 / `- ` 前缀 / 两段式 / 退出码）；`check-loop.mjs` 行数下降约 92 行；`check-hygiene.test.mjs` 全绿；检查 20 全绿（无豁免登记）。
   - 风险：中（搬运漏带闭包 → 判定漂移；靠对账 + 219 断言兜底）
4. **metrics.md / DASHBOARD.md / INDEX.md 重生成**（修复 1 的数据面）
   - 判据：`workflow/metrics.md` 2026-10 行与 `gen-workflow-metrics.mjs` 实跑输出一致（文档数 / 字节 / 活跃数三处）；`gen-workflow-dashboard.mjs --check` exit 0；`gen-workflow-index.mjs --check` exit 0。
   - 风险：低（纯生成器重跑）
5. **README / CHANGELOG 单源化与措辞校准**（修复 4 + 5）
   - 判据：`grep '已发布 0.8.0'` 与 `grep '还没打进版本号'` 均无命中；README 确认门表述含「留痕」限定语；`CHANGELOG.md` 首行无反向互指；README 无「活跃层…09-28」段。
   - 风险：低（纯文档；README 为 owned，改后 sync 刷记账）
6. **`flow-kit sync` + 全量验证 + 关单**
   - 判据：`node .agents/scripts/verify.mjs` exit 0；`node bin/flow-kit.mjs doctor` 0 FAIL；`templates/_agents/scripts/` 与 `.agents/scripts/` 目标件零 diff；`.agents/confirmations.jsonl` 新增绿行；intent 验收标准逐条勾验补证据 → 三件套置 done。
   - 风险：低

## 执行顺序

1 → 2 → 3 → 4 → 5 → 6。1/2/3 之间无耦合（分别触及不同文件与不同检查段），但**统一在包源 `templates/` 改、最后一次性 sync**（避免中途 sync 造成台账多次刷新与装副本半新半旧）。4 依赖 1/2/3 全部落定（新列与新门须先存在），5 与 1-3 无耦合并行。6 收口。

## 验证计划

- 静态门：`node .agents/scripts/verify.mjs`（内含 `npm test` 全量 38 套件 + check-loop，任一非零即红）
- 拆分不变量：拆分前后 stash 同状态 `check-loop.mjs` 的 stdout+stderr `diff` 为空（**逐字节输出契约**，本批最关键证据）
- 双源：`templates/_agents/scripts/` 与 `.agents/scripts/` 本批目标件逐文件 sha 零 diff
- 体检：`node bin/flow-kit.mjs doctor` → 0 FAIL（本批新增脚本须在 kit.json managed 台账在册）
- 自验新门：`node .agents/scripts/gen-workflow-dashboard.mjs --check` exit 0；手工改一行后 exit 1（改回）
- 生成物口径对账：`gen-workflow-metrics.mjs` 实跑输出 vs `workflow/metrics.md` 十月行；`gen-workflow-index.mjs --check` exit 0
- L2 追加：独立复核（`git diff -w` 主视图）拆分接缝 ctx 传入完整性、`--check` 时间戳归一与装户跳过分支、扩容门第 3 项判据变更的意图保真；review 结论记入 spec/plan「确认与复核」节

## 确认与复核

- 确认结果：approved（2026-10-08 用户对话内确认）；done（2026-10-08 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（用户 2026-10-08 对话内点名「修复 1/2/3/4/5」并就两处取舍拍板，逐份代录，原话在 `.agents/confirmations.jsonl`）
- 复核：L2 独立复核未执行（用户拍板放行）。主智能体实测替代，覆盖见同名 spec「确认与复核」节。
- 偏离留痕：
  1. **任务 1 范围调整** —— spec/plan 原把「检查 11 扩展」与「检查 2/9/12/13 拆分」分列两任务，实现时合并进任务 3：检查 11 既要扩 DASHBOARD 覆盖面、又要随卫生类检查迁入同一模块，分两批做等于同一文件两次回归。
  2. **判据口径修正（G5）** —— 验收判据原写「`grep '已发布 0.8.0'` 全仓无命中」，写判据时未考虑**存量 done intent `2026-09-29-adopter-surface.md` 的验收证据合法引用该串**（done 态内容绑定，永不可改），该判据从一开始就不可满足。实际判据收窄为 `README.md` 零命中（四串各 0），全仓剩余命中逐条归属为 CHANGELOG 元描述 / 存量 done 证据 / 本批三件套描述三类合法留痕。已在 intent 勾验中如实留痕，未事后改判据掩盖。
  3. **`avgRework` 口径（任务 2）** —— plan 未明写，实现时定为**仍含噪声**（`(reworkSum + reworkNoiseSum) / total`），以保 `delegations.md` §月度聚合快照表结构零改动（改表结构会连带 delegations.md 正文与看板口径）。测试断言钉住该口径。
  4. **返工 4 次（全部为设计返工，非门禁噪声）** —— ① ctx 键名 `ROOT` vs `root` 不匹配（doctor 抓到，自测未抓到）；② 模块内输出顺序写成 2→9→12→13 违反稳定输出契约（自查抓到）；③ 新测试 fixture 漏建 `DASHBOARD.md`；④ 顺序断言 fixture 漏建词表致检查 12 整段跳过。已全部计入 `delegations.md` 自做表本批行（`返工×4`），未使用「门禁噪声」标签（该标签须留给真·门禁面触发的返工，如预算超限 / 双源漏刷）。