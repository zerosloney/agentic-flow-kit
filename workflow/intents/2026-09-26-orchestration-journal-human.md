---
状态: approved
级别: L2
日期: 2026-09-26
模块: pipeline
备注: 源自 2026-09-25 双维度审查报告改进方向第 4、5 条（用户对话内确认一次做完）。编排 DSL 是多处依赖的机制契约（机制文档 / linter / 编排脚本 / 宿主执行口径），新增 stage 形态与 journal 文件契约为契约扩展 → L2（同 wf-runtime 定级先例）。
---

# INTENT — 编排执行面补强：run journal（断点续跑）+ human 确认门（第四形态）

## 背景与问题
- 审查报告改进方向 4：编排中止后（重试超限 / gate 非零）哪些 stage 已完成无机器记录，重新执行从头还是续跑未定义，retries 消耗不持久化，delegations.md 留痕纯 prose 纪律。
- 审查报告改进方向 5：pipeline-closing 的 confirm 用户确认门伪装成 `role: implementer` 派单行——按机器判据该派子智能体，与「子智能体不跨确认门」纪律自相矛盾，靠 prose 特判覆写（"confirm 是用户对话门，宿主 AI 停下询问"）；DSL 缺显式用户门形态。

## 目标
- **DSL 第四形态 `human`（确认门行）**：stages 表新增可选 `human` 列；判据 `human` 非空 → 宿主 AI 停下向用户询问（`task` 列=问什么、`accept` 列=通过判据），通过才派下层，驳回 → 中止汇总；不派子智能体。linter 四选一互斥升级 + `human` 行填 `retries` 告警（无重试语义）。
- **run journal**：新脚本 `wf-journal.mjs`——`add`（stage 结果追加 JSONL，run 自动复用 / `--new-run` 新起，attempt 自动计次）+ `status`（合并 stages 表：已完成 / 就绪（含重试就绪）/ 待定；坏行容忍告警）。journal 落 `.agents/cache/orchestration-runs.jsonl`（本地运行态，已 gitignore）。
- **机制文档定稿**：`_TEMPLATE.md` 四形态表 + human 执行语义 + journal 纪律（每 stage 记行 / 续跑先 status / 已 pass 不重跑）+ 解析校验行接机器门 `workflows-check.mjs`。
- **pipeline-closing 落地示范**：confirm 行改 human 形态（表头 10 列），role 伪装矛盾消除。

## 非目标
- 不做执行器 / 调度器（执行者仍是宿主 AI；journal 只提供记录与续跑判定，不驱动执行）。
- 不改 after 依赖 / concurrency / gate 既有语义；不加 doctor 检查项（journal 是可丢弃缓存，不入体检面）。
- 不改 delegations.md 聚合口径（journal 汇总行由 AI 顺手粘贴，agg-delegations 不读 journal）。

## 约束
- 兼容性：既有 9 列编排脚本（无 human 列）必须原样通过 lint——human 列可选，缺列视为恒空。
- 零依赖；双源纪律（包源 templates/_agents/，sync 刷装副本；未入台账件手动 cp）。

## 影响面
- 模块：pipeline
- 数据库：无
- 前端页面：无

## 触达红线（对照 AGENTS.md）
- [x] 规则 / 契约变更（编排 DSL 机制契约扩展：新增 stage 形态 + journal 文件契约）→ 级别 L2（消费方：机制文档 / linter / pipeline-closing / 宿主执行口径 ≥4 处）

## 验收标准（可测试）
- [ ] DSL 四形态定稿：`_TEMPLATE.md` 四形态表（role/step/gate/human）+ human 执行语义 + 示例表含 human 行 + 解析校验行标注机器门；AGENTS.md 常驻指令零改动（预算中性）
- [ ] linter 四形态：`human` 列解析（表头缺列兼容）、四选一互斥 E9、human×retries 新告警 W4、导出 `parseStages` 供 wf-journal 复用；fixture ≥3 新场景 + 真实仓库自扫 0 error 0 warning
- [ ] pipeline-closing confirm 行改 human 形态（10 列表头，双源同步），linter 通过且 prose 特判行删除；source-sync-repair / 示例 9 列脚本零改动仍全过（兼容性证据）
- [ ] wf-journal.mjs：`add` 记行（ts/run/wf/stage/form/status/attempt/note；attempt 省略时自动 = 同 run 同 stage 既有条数+1；run 复用与 `--new-run`）；`status` 按最新 run（或 `--run`）输出 已完成/就绪（含重试就绪×N）/待定；`--journal`/`--wf-root` 可注入；≥8 场景测试全绿（含坏行容忍、多次 run、replay 末次生效）
- [ ] journal 契约文档化：`_TEMPLATE.md` 纪律三条（记行 / 续跑先 status、已 pass 不重跑 / 汇总可粘 delegations）；`.agents/cache/` 已 gitignore 实证
- [ ] `npm test` 全绿（21 套件）+ `source-sync-check --diff` 0 差异 + doctor 0 FAIL + `gate-checklist --diff` 登记完整（无 doctor § 变更）

## 确认与复核
- 确认日期：2026-09-26
- 确认人：用户（对话内「4（编排执行 run journal…）、5（用户确认门显式化…）」——审查报告改进方向第 4、5 条）
- 确认范围：DSL 第四形态 + run journal + 机制文档定稿 + pipeline-closing 示范；非目标不含执行器与既有语义改动
- 复核：L2 不要求新会话独立复核（L3 才要求）；spec 随本 intent 确认
