---
description: pipeline-run 自动化驱动入口——单命令驱动六阶段闭环（工单协议+机器门+原话代录）
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

> 确定性部分由 `pipeline-run.mjs` 状态机驱动（机器门序列：fill-* → confirm-doc → verify.mjs → git，退出码全记录）；
> AI 槽位经工单协议交宿主执行；人件门到点即停、原话代录。宿主只按本协议驱动，不自行改状态。

## 驱动协议（宿主 AI 逐条执行）

1. **启动**：`node .agents/scripts/pipeline-run.mjs start "<需求原文>"`（可预判则加 `--hint "kind=… level=… module=…"`）。
2. **循环读停机点**：每次命令的 stdout 末行是机器标记 `PIPELINE-STOP <type> …`，按 type 分流：
   - `work-order <runId> <工单id>`——读工单全文（目标/步骤/约束/验收），**按单干活**：
     - triage：判级回填 `next --triage "kind=… level=… module=… topic=<英文kebab>"`（就高不就低）
     - draft：起草指定文档；implement/fix：按授权文件实现（**偏离即停**——公共接口/计划外文件/新依赖→停机向用户上报，不自行放行）；review/closeout：按单产出并写入指定位
     - 干完回跑 `next`（implement/fix 须 `--files "a,b"` 回填改动清单；review-only 汇报后 `--done` 收尾）
   - `await-confirm <runId> <doc>`——**人件门**：向用户转述「要点」索确认；用户明确放行后
     `next --delegated "<用户原话>"`（逐字原话，**永不编造、永不复用旧句**；一次一份）
   - `gate-fail <runId> <stage>`——读 problems 原因，修复后原路重跑（不绕门、不加 `--no-verify`）
   - `done <runId>`——向用户汇报总结（阶段条/门数/提交链），流程结束
   - `aborted <runId>`——已显式放弃，汇报放弃态与留档位置
3. **放弃**：用户明确不做时 `abort --run <id> --to superseded|cancelled --delegated "<原话>"`（approved 文档逐份走 confirm-doc --to）。
4. **观测**（可选）：`status [--run <id>] [--json]` 全量事件流水；`watch` 终端轮询视图。

## 硬纪律（违反即协议破坏）

- 状态迁移唯一入口是脚本内部的 confirm-doc 调用——宿主**永不直改** workflow 文档 frontmatter 状态。
- `--delegated` 的原话必须是用户当次对话原话（台账 `confirmations.jsonl` 留痕可对质）。
- 修复环超限（3 次）时停机交人工，不带病推进；verify 非绿不关单。
- run 文件（.agents/cache/pipeline-runs/）是脚本亲写的机器事实——宿主只读不写。

## 与 new-task 的关系

本命令是**自动化驱动的并列入口**（单命令走全程）；new-task.md 是手动阶段路由入口。同一套门禁与确认语义，二者只选其一驱动一个任务，不混用。
