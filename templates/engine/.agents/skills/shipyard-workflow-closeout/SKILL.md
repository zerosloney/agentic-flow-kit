---
name: shipyard-workflow-closeout
description: Shipyard.Material 关单序列：verify --scope、验收勾验、closeout.mjs 落终态/索引/提交、机器门与失败恢复。用于把 workflow 文档收到 done/closed。
---

# Shipyard.Material 关单确认门操作序列

## 目标
把已批准的 workflow 文档收到终态，并留下可对账的验证凭证、确认分片和索引。

## 触发条件
- `workflow/{intents,specs,plans,incidents}` 文档要进入 `done` 或 `closed`。

## 前置
`approved`（incident 为 `fixed`）已经在当前分支的 git 历史里。还是 `draft` 或 `open` 时，先 `confirm-doc` 到 `approved` / `fixed` 并单独提交，再走下面的关单。

**L1 单笔提交例外（2026-11-08 档 2-D 起，`new-task.md` 快速道第 6 步）**：L1 的 approved→done 连续两跳后，plan(done) + 代码 + 确认分片 + verify 凭证**同笔入库**——approved 不必单独先行入库，也**不走本技能与 closeout.mjs**（其候选路径清单不含产品代码，外来路径护栏会拒），直接 git 提交。同一份文档两跳可用同一次放行原话；跨文档禁复用。本技能仅剩「plan 独立关单」（代码已在前笔入库）与 L2/L3 / incident 场景。

状态行只由 `confirm-doc.mjs` 改。代录使用用户对话里的原话。提交不用 `--no-verify`。自做 L1 不往 `workflow/delegations.md` 写结果行；委派任务和 L2/L3 自做仍按 `stages.md` Test §5 留痕。**承诺面被改写时的出路**：`confirm-doc.mjs <doc> --reconfirm --delegated "<用户原话>"`——重录指纹与承诺面指纹，状态仍为 approved（状态行仍由脚本写，不手改 frontmatter）。

## 执行序列

### 0. 关单自核（原 check-loop §1/§3x hard 职责下沉，2026-10-21 门禁极小化第 2 批）
对要关的文档族核对四项，缺任一 → 先补齐再关单，禁带着缺口写 done。其中 1（L2/L3）、2、3（L2/L3 intent）已前移到 `confirm-doc.mjs` 关单动作时刻机器执法（2026-11-08 closeout-skill-hardening）——人只补存量与特长外情形，脚本拒绝时按报错补齐：

1. **配对自核**：同族同名件齐否——L2/L3 intent 须有同名 spec 与 plan（confirm-doc 的 `specConfirmed` / `planConfirmedFor` 硬门）；intent（含存量 L1）须有同名 plan；incident 须有同名 plan（L2/L3 另须同名 spec）。L1 配对仍是自核：2026-10-21 门禁极小化已把配对硬门降为 WARN，不在此重硬。
2. **incident 三件套**（关 incident 时）：`## 复盘三件套` 节内 `1. 结构性修复 / 2. 防复发验证 / 3. 规范条目` 三节齐 +「是否需要新 intent」行；选「是」→ 引用的 intent 路径存在。判据单源 `stage-gates.mjs / incidentTrioGate`，由 confirm-doc 对 →fixed/→closed 硬拦；2026-11-09 首加锚前的存量件与 `流程: legacy` / `存量确认态豁免（` 声明件仍人工自核（判据同上）。
3. **L2/L3 复核上下文必填**：落盘行格式 `- 独立复核：…（复核上下文：<会话/子代理 id>）`，以 `- 独立复核：` 起行且含「复核上下文：」；L2/L3 intent→done 由 confirm-doc 的 `reviewLineFor` 硬拦，spec/plan 与 L1 仍自核。缺则 **HALT**：回 `.agents/commands/stages.md` Test §4 补独立复核并落盘该行后再关。
4. **承诺面未被改写（2026-10-27 新增）**：approved 之后若改过**承诺面**（判据文本 / 红线 / 目标 / 改动方案），须先让用户**重新点头**再关单——跑 `flow-kit run confirm-doc.mjs <doc> --reconfirm --delegated "<用户原话>"` 重录承诺面指纹（不推进状态）。**勾验收 + 证据回填 / `确认结果` / 复核行改锚不算改承诺**（已归一，正常关单不受影响）。

完成标准：四项通过；机器门以 confirm-doc 的拒绝信息为准，人工自核项逐条核对。

### 1. 验证
跑 `flow-kit run verify.mjs --scope`。快速道第 5 步刚刚跑过可沿用，判据不再靠记忆：全绿行落账时记 `dirty`（当时 `backend/` `frontend/` 脏路径快照），关单时 confirm-doc 比对当前业务脏路径——verify 之后新出现的业务改动即判凭证过期（24h 窗口照旧）。存量绿行（无 dirty 字段）维持原口径。

完成标准：有一次退出码 0，且关单时未被判「凭证过期」（被判则重跑 verify 刷新快照）。scope 判定要全量时脚本自己回落，不手改 `workflow/verify-evidence.md`。时序：verify 绿行须**先于** done 跳转产生（dirty 快照记录当时业务脏路径；L1 单笔提交同批的代码在 verify 时已在工作区、属绿行已见路径，不判过期）。

范围对账（advisory，2026-11-11 dev-tour 接线）：跑 `flow-kit run gen-dev-tour.mjs workflow/plans/<name>.md --scope-report`——「文档外实际改动」非空时先解释或回填 plan 再关单（口径同 dev-tour 触发条件；与 `check-scope.mjs` 越界硬门互补，此处只提示不拦，恒 exit 0）。

### 2. 勾验收
在文档里逐条勾上验收项并写上证据，格式固定：`- [x] 验收项` 同行或紧随续行写「证据：<命令输出 / 路径 / 实测记录>」。判据单源 `stage-gates.mjs / acceptanceEvidenceGate`（关单格式门）：未勾项、缺「证据：」标注的勾选项、L2/L3 spec 无「验收判据」数据行都会在 confirm-doc 处被拒。L1 勾 plan。L2/L3 新需求勾 intent。修复勾 incident，路径是 `open` → `fixed` → `closed`。

完成标准：每一条验收都能指到证据（命令输出、路径或实测记录）；L1 单笔提交时勾验与证据回填须在**提交前**完成（勾选进同笔的 plan(done) blob）。

**勾选语义（口径声明，2026-11-10）**：文档勾选分三类，done 与勾选总数无关——① 任务拆解勾选＝过程留痕 / 会话重入锚（如 `stages.md` §1 捷径检查读勾选态对齐进度），未全勾≠未完成，不构成不关单理由；② 入口红线问卷为否定声明，L1 全不勾即「未触达」的正确态；③ done 的唯一勾选判据＝验收标准节逐条 `[x]` 清零＋证据行（本节 acceptanceEvidenceGate）。禁为「齐整」伪造回填勾选。

### 3. 代录终态
首选一次调用 `flow-kit run closeout.mjs <doc> --delegated "<用户原话>"`（串接 §3–§5，用法与失败恢复见 §5.1）；下面三步是手工等价路径。

手工代录：`flow-kit run confirm-doc.mjs <doc> --delegated "<用户原话>"`。

incident 从 `fixed` 到 `closed` 再跑一次。spec 标 `done` 时，第 1 步的全绿凭证已经存在。

完成标准：目标文档状态已是 `done` 或 `closed`，正文在这次代录之后保持不动。

### 4. 索引
跑 `flow-kit run gen-workflow-index.mjs`。

完成标准：`workflow/INDEX.md` 已按磁盘重生成。

### 5. 提交
`git add` 这些路径：`.agents/confirmations.d/<文档基名>.jsonl`、`workflow/INDEX.md`、`workflow/verify-evidence.md`，以及被关的文档。`.agents/confirmations.jsonl` 只有这次 diff 碰到它才加入。

提交前看该分片的 `git diff`，只保留这次会话的确认行。`closeout.mjs` 已按此清单自动 add 并核对暂存区只有候选路径（夹带其它在途改动即拒），提交不用 `--no-verify`。

提交信息：`docs(workflow): <批次> 关单`。

完成标准：上述路径已入库，钩子通过。

### 5.1 一次调用与失败恢复（重入）

`flow-kit run closeout.mjs <doc> --delegated "<用户对话原话>" [--msg "<提交主题>"] [--dry-run]`

串接顺序：confirm-doc 落终态 → gen-workflow-index 重生成 → git add 固定路径清单 → git commit。incident 两跳各跑一次（`fixed` 与 `closed`）。`--dry-run` 只报当前状态 / 下一跳 / 候选路径变更，不落态、不写盘、不提交。

任一步失败即停，修因后**重跑同一命令**（幂等：终态跳过代录、索引生成幂等、无暂存改动跳过 commit）：

- confirm-doc 拒：该份未落账、未写盘；按报错补齐（配对 / 三件套 / 复核行 / 验收证据 / 委派台账）后重跑。
- 凭证过期：重跑 `verify.mjs --scope` 刷新 dirty 快照后重跑。
- 承诺面指纹不符：先 `confirm-doc.mjs <doc> --reconfirm --delegated "<用户原话>"` 重新点头，再关单。
- 暂存区夹带外来路径：脚本拒绝提交并列出；单独提交或撤销这些路径后重跑（代录与索引已完成，重跑只提交）。
- 钩子拒绝提交：修钩子原因后重跑，不要 `--no-verify`。

> L1 单笔提交不走本入口（见「前置」例外段）——那条路径只有一笔 git 提交，无独立关单提交。

### 6. 回填特性文档

本次行为变化写进对应活文档，并在 plan / incident 留指针；同一特性只保留一个文档：

| 变化类型 | 回填目标 |
|---|---|
| 用户可见交互 / 路径 | `.agents/skills/verify-ui/features/<feature>.md` |
| 契约 / 规则 / 数据口径 | 原 spec 原地修订（`workflow/README.md` spec 生命周期） |
| 防复发断言 | `workflow/regression-checklist.md` 对应模块节 |
| 架构 / 方案 | `wiki/开发方案/` |

只追加变化事实与证据指针，不复制整篇；回填随关单提交。没有对应文档时新建一个，topic 带特性键。

### 7. 配方回收（长任务 / 绕路，非事故）

判据（任一）：同一动作在本次会话重复 $\ge 2$ 次；同一处返工 $\ge 2$ 次；为定位入口或环境试探 $\ge 2$ 轮。

动作：把配方写回权威文件一处——优先改现有命令 / 技能 / 角色正文，不新立技能。落点层级按 `.agents/skills/papercut-fix/SKILL.md` §0 阶梯，本回路通常落第 5 层（文本）。

写法：一句触发条件 + 一步动作 + 一个可指认的验证；引用本次卡点，禁写泛泛建议。

不做：一次性环境故障（进 `.agents/notes/runtime-env.local.md` 或 papercuts `[env]`）；事故走 `.agents/commands/maintain.md` 三件套。

提交：`docs(engine)` 单独提交，不夹带业务代码。
