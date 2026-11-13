---
description: pipeline-run 自动化驱动入口——单命令驱动六阶段闭环（工单协议+机器门+原话代录）；与手动阶段路由二选一，禁混用
stage: entry
triggers:
  - "pipeline-run"
  - "跑执行器"
  - "全自动跑"
approval_required: true
fallback: 主智能体亲自做 AI 槽位（工单由主智能体完成，不依赖子智能体）
next: 按 run 停机点循环推进至 done
---

# pipeline-run · 全自动闭环执行器入口

阶段机已对齐 commands 手册。与手动阶段路由二选一，禁混用。

> **保留待用**：暂零 run（`cache/pipeline-runs/` 空）但不退役。启用前先跑
> `flow-kit run check-pipeline-state.mjs`（静态闭包检查：stage/stopType 是否都在
> `.agents/config/pipeline.json` 内），再用一个小任务跑一次端到端 run——静态检查不能替代真实状态机验证。

> **分工**：确定性部分由 `pipeline-run.mjs` 状态机驱动（fill-* $\rightarrow$ confirm-doc $\rightarrow$ verify.mjs $\rightarrow$ git，退出码全记录）；AI 槽位按工单协议执行；人件门到点即停、原话代录；宿主禁自行改状态。
> **fix 工单**：动手前 `flow-kit run fix-task.mjs start`，签收后 `stop`——窗口内既有测试只读。

## 1. 驱动协议 (Protocol)

**Input**: 需求原文
**Process**:
1. **启动**: `flow-kit run pipeline-run.mjs start "<需求原文>"` (可预判加 `--hint "kind=… level=… module=…"`)
2. **循环读停机点**: stdout 末行机器标记 `PIPELINE-STOP <type> …` $\rightarrow$ 按 type 分流:

| 停机类型 | 动作 | 回跑命令 |
|---|---|---|
| `work-order <runId> <工单id>` | 读工单全文 $\rightarrow$ **按单干活** (见下表) | `next` (implement/fix 须 `--files "a,b"`) |
| `await-confirm <runId> <doc>` | **人件门**: 转述要点索确认 $\rightarrow$ 用户放行后 | `next --delegated "<用户原话>"` (逐字原话) |
| `gate-fail <runId> <stage>` | 读 problems 原因 $\rightarrow$ 修复后原路重跑 | `next` (禁绕门/禁 `--no-verify`) |
| `done <runId>` | 汇报总结 (阶段条/门数/提交链) | 流程结束 |
| `aborted <runId>` | 汇报放弃态与留档位置 | 流程结束 |

### 工单类型执行矩阵

| 工单类型 | 执行要求 | 进入即装载（联动，见 new-task §1c） |
|---|---|---|
| **triage** | 判级回填 `next --triage "kind=… level=… module=… topic=<英文kebab>"` (就高不就低) | 无；kb 检索同 new-task §L1 快速道第 2 步 |
| **draft** | 起草指定文档 | intent→`grilling`；spec→`stages.md` Design §2「必读输入」+ `grilling`（分叉比选 `arena`）；plan→无 |
| **implement / fix** | 按授权文件实现 $\rightarrow$ **偏离即停** (公共接口/计划外文件/新依赖 $\rightarrow$ 停机上报，不自行放行) | 无强制技能；fix 类根因不明先 `why` |
| **review / closeout** | 按单产出并写入指定位 (review-only 汇报后 `--done` 收尾) | review→`review-method`（高风险 diff +`interrogate`）；closeout→`shipyard-workflow-closeout`（§0 关单自核） |

3. **放弃**: 用户明确不做 $\rightarrow$ `abort --run <id> --to superseded|cancelled --delegated "<原话>"` (approved 文档逐份走 confirm-doc --to)
4. **观测** (可选): `status [--run <id>] [--json]` 全量事件流水 / `watch` 终端轮询视图
5. **并行写同一页**: 多个 arm 要改同一 `workflow/` 或 `wiki/` 页面时，先 `flow-kit run path-lease.mjs acquire --path <page> --owner <arm>`，写完 `release`；一页一 writer。

### 断点续跑 / 重试 / 并行分支（R3-5）

- **断点续跑**：门执行前脚本把 run 标 `inFlight` 并落盘；进程被杀（CI 超时/中断）后 `next` 自动从该门重入，`resume --run <id>` 可显式续跑。恢复记 `resume` 事件，`status` 显示「↻ 中断于 …」。
- **重试**：`next --retry <0-5>` 只作用于 verify 门；失败后重跑至多 N 次，每次记 `retry` 事件。耗尽仍红才进修复环 / `gate-fail`；重试不跳过 `--files` 核对。
- **并行分支**：`next --parallel "check-a.mjs,check-b.mjs"` 让附加门与 `verify.mjs` 并发执行，任一非零即整体非零；事件带 `parallel` 组号。只接受门脚本名，拒绝路径分隔符。
- **阶段产物契约**：`.agents/config/pipeline.json` 的 `stageArtifacts` 用 `{entry}/{spec}/{plan}` 声明产物；缺失或为空时在门执行前停 `gate-fail`（模板默认覆盖 `spec-confirm` / `plan-confirm` / `verify` / `closeout`）。
- **续跑幂等**：`docsCommit` 若发现 HEAD 已是同主题提交，不再重复提交（记 `resumed: true` 的 commit 事件）。

## 🚫 硬纪律 (违反即协议破坏)

| 操作 | 后果 / 机器行为 | 例外 |
|---|---|---|
| 直改 workflow 状态 | → 绕过唯一迁移入口（confirm-doc） | 宿主永不直改 frontmatter |
| 编造/复用原话 | → 台账 `confirmations.jsonl` 对质暴露 | `--delegated` 必须是当次对话原话 |
| 带病推进 | 修复环超限 (3 次) 停机交人工 | verify 非绿不关单 |
| 写 run 文件 | → 与机器事实冲突 | 宿主只读不写 |
| 自动放行人件门 | `await-confirm` 须转述要点、拿到用户放行原话后才 `next --delegated` | 自动触发仅指阶段衔接与技能装载 (new-task §1c 联动协议)，任何人件门永不自动越过 |
