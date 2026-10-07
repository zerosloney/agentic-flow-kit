---
状态: done
级别: L1
模块: pipeline
确认指纹: 0bb347e0c9a380e4
---
# PLAN — workflow-dashboard

对应入口：../intents/2026-10-08-workflow-dashboard.md
对应 spec：../specs/（L1 走快车道省略）

## 改动方案

- `templates/_agents/scripts/gen-workflow-dashboard.mjs`：**新建**——聚合生成 `workflow/DASHBOARD.md`：
  1. 头部红绿灯行（生成于时间戳 + 三段 verdict）：质量门 = require `./agg-delegations.cjs` 复用 metrics/gateMonth/expansionVerdict（月度行原样引用，判据零重复）；时长带 = 内置常量（`P50 ≤ 1 天且 P90 ≤ 10 天` 为 ✅，注释「默认带，实测分布 P50=0/P90=7 在带内，数据说话后调」）。
  2. 关单时长：扫 `workflow/intents/*`（状态 done，排除 _TEMPLATE）→ frontmatter「日期」→ confirmations.jsonl 该 doc **最早** done 行 ts（多次 done 取首关；无台账行跳过不虚构）→ 天数分布 P50/P90/max/样本数 + 最慢 3 单清单。
  3. 台账解析沿检查 14/15 口径（坏行容忍、`e.doc === rel` 正斜杠根相对）；isMain 守卫 + 纯函数导出（`closeDurations` / `durationVerdict` 供测试 import）；usage 自说明。
  4. DASHBOARD.md 整文件重写（同月/同日重跑幂等）；包源模板树不预置该文件（装户首跑自建，不进台账）。
- `templates/_agents/scripts/gen-workflow-dashboard.test.mjs`：**新建**——fixture（临时 ROOT 注入式纯函数测试为主 + 端到端 spawn 一例）：时长四例（同日=0 / 跨 N 天 / 多次 done 取最早 / 无台账行跳过）、带判定三态、与 agg 纯函数同值对账、生成物结构断言（红绿灯行 / 表头 / 生成于戳）。

## 约束与风险

- 约束：不挂任何门禁（check-loop / doctor / pre-commit / gate-checklist 零改动——观测面非裁决面，gen-workflow-metrics 头注释教训）；不动看板 / INDEX / metrics.md / delegations.md；零新依赖；双源纪律（脚本+测试落包源，`flow-kit sync` 刷装副本）；DASHBOARD.md 属 owned 生成物，不进台账（包源不预置 → 台账/感知锚/§4.5 零交互）。
- 风险：低——纯新增观测件，不改任何既有判据与门禁；最大风险是时长口径误读（多次 done / revert 场景），以「最早 done 行 = 首次关单」钉死并测试。

## 验证计划

- 静态门：`npm test` 全套（新套件经 run-tests glob 自动发现；templates/ + shipped `.agents/` 双套件天然覆盖）。
- 实仓冒烟：本仓跑 `node .agents/scripts/gen-workflow-dashboard.mjs` → DASHBOARD.md 真实值对账（时长 P50=0/P90=7/max=8、样本 43；质量行与 `node .agents/scripts/agg-delegations.cjs` 直跑输出一致）。
- `flow-kit sync` 装副本成对（新增 2 份脚本/测试装回）+ doctor 全绿。
- 无前端、无 UI、无 schema（相关行不适用）。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-10-08 用户对话内确认）；done（2026-10-08 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L1 不要求独立复核
- 偏离留痕：①（使能改动）agg-delegations.cjs readLedger 增 root 显式参数 + soft 模式并导出（原签名缺省行为不变、main() 零变化）——plan 未列该文件，系「判据零重复复用」的必要使能（硬编码 ROOT + fail() 退出无法被仪表盘注入 fixture 复用）；②（实现修正）时长天数用 floor 非 round（日历天语义：同日关单 0.625 天记 0，round 会记 1——测试夹具实证后修正）；③（包源跑法边角）包源份脚本 ROOT=脚本位置上两级——源仓自跑必须跑装副本 `.agents/scripts/`（首跑误跑包源份把 DASHBOARD.md 落到 templates/workflow/，已清理；装户无此问题），教训与「debug 调 sync 须显式 --dir」同族
