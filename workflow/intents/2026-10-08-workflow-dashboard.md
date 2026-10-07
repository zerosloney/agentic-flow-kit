---
状态: approved
级别: L1
risk_level: L1
日期: 2026-10-08
模块: pipeline
备注: workflow 仪表盘——关单时长（台账 done 行-立项日）+ 质量/返工（agg 纯函数复用）+ 红绿灯控制带，生成 workflow/DASHBOARD.md
确认指纹: f5a5a1ae2bdce984
---
# INTENT — workflow-dashboard

## 背景与问题

用户点名 eli5 提升方向卡第 ③ 项（2026-10-08 对话）：「自动亮出数字：一单多久关、返工几次；数字变差，红灯就亮，不用等人去翻账本」。现状盘点（复用面）：

- **返工/通过率已有**：`agg-delegations.cjs` 算一次通过率 / 平均返工 / 主兜底 + 6 门 ✅/❌ 判定，且纯函数已导出（metrics / gateMonth / expansionVerdict，board-kb-p1）——但快照行要**手动粘贴**进 delegations.md。
- **规模趋势已有**：`gen-workflow-metrics.mjs` → workflow/metrics.md（手动跑，趋势观测，明确不挂对错）。
- **缺口 1 · 关单时长没人算**：四套件无一计算「一单从立项到关单多久」。数据源现成——intent frontmatter「日期」（立项日）+ confirmations.jsonl 该 intent 的 `done` 行 ts（关单时点，确认门生效后的单全覆盖）。真实分布已测：43 单样本 P50=0 天 / P90=7 / max=8。
- **缺口 2 · 无统一亮灯面**：看板（workflow-board-server）零指标；判定散在 agg 的 stdout 里，跑完即逝。「不用等人翻账本」缺一个常驻、一眼见红绿的生成物。

## 历史教训/防复发

- 检索：incidents/2026-09-28-metric-claim-gate、2026-09-28-adopter-derivers——指标域两态归属先例（登记表/取数器归 owned，防 sync 报「本地已改」+ 门禁停摆）；本单生成物 `workflow/DASHBOARD.md` 归 workflow/（owned），且**包源模板树不预置该文件**→ 不进台账 → doctor §6.6 / 感知锚 / §4.5 全零交互（INDEX.md 同模式）。
- 避坑：①metrics 域「不挂门禁」教训（gen-workflow-metrics 头注释：快照是历史记录，拿来做漂移校验只会常红）——仪表盘只观测不裁决，红灯是**看**的不是**拦**的；②复用 agg 纯函数（require 同目录 .cjs），不重写判据——判据漂移防复发（N3 教训）；③isMain 守卫 + 纯函数导出（board-kb-p1 先例），测试 import 直测。

## 目标

- 新增 `templates/_agents/scripts/gen-workflow-dashboard.mjs`（managed 脚本）：聚合三类数字生成 `workflow/DASHBOARD.md`——
  1. **关单时长**（新指标）：done 态 intents 的「立项日 → 台账最早 done 行 ts」天数分布（P50 / P90 / max / 样本数；无台账行的存量单诚实跳过不虚构）；
  2. **质量/返工**：require agg-delegations 导出复算（月度行 + 扩容门 verdict 原样引用，判据零重复）；
  3. **控制带 verdict**：头部一行红绿灯——质量门沿用 delegations.md §并发扩容门槛权威口径；时长带新增（默认 P50≤1 且 P90≤10 天为绿，实测分布 P50=0/P90=7 在带内，注释「默认带，数据说话后调」）。
- DASHBOARD.md 头部「生成于」时间戳 + 红绿灯 emoji 行；生成器 isMain 守卫 + 纯函数导出；usage 自说明（零 AGENTS.md 改动——常驻面预算仅剩 223B）。
- 测试 `gen-workflow-dashboard.test.mjs`（fixture：台账行 + done intents + delegations 两表）钉住：时长计算（同日=0 / 跨天 / 最早 done 行 / 无台账跳过）、带判定三态、agg 复用数字一致性、生成物结构。

## 非目标（防范围蔓延）

- **不挂任何门禁**（check-loop / doctor / pre-commit 零改动）：观测面非裁决面，红灯不拦提交；漂移告警也不做（首版）。
- 不做自动定时/钩子触发（post-commit 自动重生成有脏工作区问题）——与 INDEX.md 同模式：「想看就跑」，命令一行。
- 不动看板 HTML / INDEX / metrics.md / delegations.md 结构；不做 bands 配置文件（内置常量单源，真需要调带时再外置——YAGNI）。
- 不做存量单（无台账行）的时长回溯虚构。

## 约束

- 复用阶梯：agg 纯函数 require 复用；台账解析沿 check-loop 检查 14/15 同口径（坏行容忍、doc 正斜杠根相对）；零新依赖。
- 双源纪律：脚本 + 测试落 `templates/_agents/scripts/`（包源），`flow-kit sync` 刷装副本；DASHBOARD.md 由装户首跑自建（owned，不进台账）。
- L1 协作道：Quick-Plan 快车道；本 intent + quick-plan 两道确认。

## 影响面

- 模块：pipeline
- 数据库：无

## 验收标准（可测试）

- [ ] `node .agents/scripts/gen-workflow-dashboard.mjs`（本仓）生成 workflow/DASHBOARD.md：头部红绿灯行 + 时长分布（真实值 P50=0/P90=7/max=8、样本 43）+ 质量月度行与 agg-delegations 直跑输出一致（证据：本仓实跑 + 抽查比对）
- [ ] fixture 测试：时长计算四例（同日=0 / 跨 N 天 / 多次 done 取最早 / 无台账行跳过）+ 带判定三态（绿/超 P50/超 P90）+ 复用数字与 agg 纯函数同值（证据：gen-workflow-dashboard.test.mjs 全绿）
- [ ] `npm test` 全套通过（新套件经 run-tests glob 自动发现）（证据：verify 凭证）
- [ ] `flow-kit sync` 装副本成对（脚本+测试 2 份覆盖更新）、doctor 全绿；装户视角 DASHBOARD.md 不在模板树（init 不落盘、零台账交互）（证据：sync 输出 + doctor）

## 确认与复核

- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：intent 全文（含不挂门禁 / 不做定时触发的非目标决策）
- 复核：L1 不要求独立复核（协作道异步审计）
