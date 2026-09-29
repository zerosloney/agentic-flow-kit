---
状态: approved
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 plan。同名 intent 已于 61ec130 approved，同名 spec 已于 fe2874a approved。
确认指纹: de1b4f8f384cfee8
---
# PLAN — 委派台账对账

对应入口：../intents/2026-09-29-delegation-ledger.md
对应 spec：../specs/2026-09-29-delegation-ledger.md

## 改动面（L1 极简形态主节；L2/L3 可作任务拆解的汇总或删本节）

- `templates/_agents/scripts/check-loop.mjs`：检查 18
- `templates/_agents/scripts/check-loop.test.mjs`、`check-loop-rev.test.mjs`：夹具
- `templates/_agents/scripts/wf-journal.mjs`：`status` 只读对账
- `templates/_agents/scripts/wf-journal.test.mjs`：夹具
- `templates/_agents/scripts/gate-checklist.mjs`：登记 cl 18
- `workflow/README.md`、`templates/workflow/README.md`：委派台账一段
- sync 更新装副本

## 任务拆解（L2/L3 必填；L1 仅多文件多步骤时用，单任务微改动删本节）

1. 按 spec 实现检查 18，警告走 `warnings.push`，并写上 spec 列出的夹具。
   - 判据：夹具 1 到 11 成立；`check-loop.test.mjs` 既有用例通过
   - 风险：中（警告插在中间会打乱已有输出快照）
2. 在 `check-loop-rev.test.mjs` 加 spec 的第 12 条。
   - 判据：工作区补了匹配行之后，`--rev` 指向旧提交仍输出 `委派台账`
   - 风险：低
3. `status` 增加只读对账和 `--delegations`。`add` 的必填参数保持 `--wf`、`--stage`、`--status`。
   - 判据：journal 夹具 1 到 7 成立；既有 `add` 缺参失败仍失败
   - 风险：中（无 run 的早退路径若也做对账，会改掉首轮输出）
4. gate-checklist 登记 cl 18。两份 README 加上委派台账段。`policyVersion` 那句不动。
   - 判据：`gate-checklist.test.mjs` 的真实仓库场景仍是 0 断档、0 未登记
   - 风险：低
5. sync。
   - 判据：`check-loop.mjs`、`wf-journal.mjs`、`gate-checklist.mjs` 在 source-sync-check 下无漂移
   - 风险：低

## 执行顺序（L2/L3 必填；L1 单文件微改动删本节）

1 与 2 一起写 → 3 → 4 → sync → 跑验证方式里的四个套件。规则提交不补历史委派行，也不关历史文档。

## 验证方式

- 静态门：`node templates/_agents/scripts/check-loop.test.mjs`
- 静态门：`node templates/_agents/scripts/check-loop-rev.test.mjs`
- 静态门：`node templates/_agents/scripts/wf-journal.test.mjs`
- 静态门：`node templates/_agents/scripts/gate-checklist.test.mjs`
- 关单前再跑 `npm test`
- 不测浏览器页面

## 确认与复核

- 确认结果：approved（2026-09-29 用户对话原话「可以」，仅本份）
- 复核：L2，独立复核留到关单前
