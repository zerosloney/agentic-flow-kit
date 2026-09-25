---
状态: approved
级别: L2
日期: 2026-09-26
模块: pipeline
备注: 编排 DSL 机制契约扩展的设计约束。前置机制：2026-09-25-wf-runtime（三形态定稿）→ 本 spec 扩为四形态 + journal 契约。
---

# SPEC — 编排执行面：human 确认门 + run journal

## 功能行为

### F1 human 确认门（第四 stage 形态）
- stages 表新增**可选**列 `human`（表头建议位序：gate 与 retries 之间；缺列 = 恒空，既有 9 列脚本零改动兼容）。
- 判据：`human` 非空且 role/step/gate 空 → human 形态；四形态（role/step/gate/human）**恰填一项**（0 项或 ≥2 项 = linter E9）。
- 执行语义：宿主 AI **停下向用户询问**——`task / params` 列写问什么（如「plan 草稿全文过目，一句"可以"即确认」），`accept` 列写通过判据；用户通过 → 该 stage 记 pass、派下层；驳回/弃权 → 记 blocked、中止后续并汇总。**不派子智能体**（机器判据层面落实「子智能体不跨确认门」）。
- `retries` 对 human 行无重试语义（用户驳回不能"重派用户"）——linter W4 告警，值视作 0。

### F2 run journal（stage 结果流水 + 续跑判定）
- 存储：`.agents/cache/orchestration-runs.jsonl`（本地运行态缓存，已 gitignore；可随时删除，删除仅丢失续跑记忆不影响门禁）。
- 行 schema（JSONL，每行一 JSON 对象）：`ts`（ISO 时间）/ `run`（run 标识 `wf@YYYYMMDD-HHMM`）/ `wf`（编排名）/ `stage`（stage id）/ `form`（role|step|gate|human，可省）/ `status`（pass|fail|blocked）/ `attempt`（第几次尝试，≥1）/ `note`（自由文本，可省）。
- `add` 语义：追加一行；`--run` 缺省 = 复用该 wf 最近一条的 run（同一编排连续执行天然同 run）；`--new-run` 强制新起（自动 id）；`--attempt` 缺省 = 同 run 同 stage 既有条数 + 1。
- `status` 语义：取该 wf 最新 run（`--run` 可指定历史）；**同 stage 多条按末次状态生效**（重试后过 = pass，attempt 保留最大值）；结合 stages 表 after 依赖输出三类——已完成（末次 pass）/ 就绪（依赖全 pass 且自身未 pass；末次 fail 者标注「重试就绪×attempt」）/ 待定（依赖未齐）；末次 blocked 标注中止原因行。
- 坏行容忍：status 遇非法 JSON 行 stderr 告警并跳过，不中断（缓存可丢弃）；add 对目录不存在自动建。

## 数据流

- 写入方：宿主 AI 按 `_TEMPLATE.md` 纪律在每个 stage 结束（含每次重试尝试）调 `wf-journal.mjs add`。
- 读取方：宿主 AI 续跑前调 `wf-journal.mjs status` 得就绪层；关单收尾可把 status 汇总粘 `workflow/delegations.md`（人读，聚合脚本不读 journal）。
- 校验方：`workflows-check.mjs`（linter）只读编排脚本不读 journal；journal 不进门禁（doctor 不查）。

## 系统改动

- `templates/_agents/workflows/_TEMPLATE.md`：四形态表 + human 语义 + journal 纪律 + 示例表 human 行 + 解析校验行接机器门。
- `templates/_agents/scripts/workflows-check.mjs`：human 列解析（可选列）、E9 四选一、W4 human×retries、导出 `parseStages`。
- 新增 `templates/_agents/scripts/wf-journal.mjs`（add/status CLI + `replayRun`/`planStages` 纯函数导出）与 `wf-journal.test.mjs`。
- `templates/_agents/workflows/pipeline-closing.md`：表头 10 列，confirm 行 human 形态，编排语义/纪律行同步。
- 装副本经 sync + 未入台账件手动 cp。

## 约束遵守映射

- 零依赖（仅 node:fs/path/url）：是。
- 双源纪律 / source-sync-check 0 差异：是（新增件随 sync 安装入台账）。
- 常驻面预算中性：AGENTS.md 与 .agents/commands/ 零改动。
- 既有契约不破坏：9 列表全兼容；状态/级别枚举单源（workflow-enums.txt）不涉及；check-loop / doctor 检查项零增减（gate-checklist 登记表不动）。

## 风险评估

- **宿主不记 journal → 续跑能力失效**：纪律 prose 层面约束（与 delegations 留痕同强度）；缓解——status 对空 journal 天然全量输出不误报，工具缺失不影响门禁。
- **journal 无限增长**：缓存属可丢弃（.agents/cache/ 与 kb-index 同域）；后续可加清理（遗留项，不阻塞）。
- **human 列位序不一致引发解析歧义**：linter 按表头列名定位不按位序，位序仅是建议。
- **多会话并行同 wf 并发写 journal**：单人串行前提（AGENTS.md「单人 + AI 协作」）；JSONL 追加写最坏交错行可在 status 坏行容忍中跳过。
