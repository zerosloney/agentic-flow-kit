---
状态: approved
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 spec。同名 intent 已于 ac64e65 approved。回放于 2026-09-29 对本仓三次 version 提交执行。
确认指纹: 03fe89349d81cff4
---
# SPEC — 发版树上的未收口文档

对应入口：../intents/2026-09-29-release-unclosed.md

## 功能行为

检查号仍是 17。最近一次 `package.json` 的 `version` 与其父提交不同的那次提交，仍沿该文件的全部历史查找，不设次数上限。incident 的 open 不参与。该提交之后才出现的文件不参与。

当时状态与被扫描树上的现在状态按下表阻断。现在状态在不带 `--rev` 时读工作区，带 `--rev` 时读被推送的那棵树。当时状态始终读那次发版提交。

| 发版提交上的状态 | 被扫描树上的现在状态 | 结果 |
|---|---|---|
| draft | draft | 退出码 1。不看版本锚 |
| draft | approved | 退出码 1。不看版本锚 |
| approved | draft | 仅当发版版本大于 `0.8.0` 时退出码 1 |
| approved | approved | 仅当发版版本大于 `0.8.0` 时退出码 1 |
| draft 或 approved | done | 退出码 0 |
| 其他 | 其他 | 本检查不拦 |

版本比较按主、次、修订三段整数，不用字符串序。发版版本拆不开三段整数时，不触发「approved 仍未收口」。`0.8.0` 本身不大于 `0.8.0`。

锚只放在 `templates/_agents/scripts/policy.mjs` 的 `POLICIES` 版本 2，键名 `check17UnclosedAfter`，值为 `0.8.0`。版本 2 带上版本 1 的全部日期键，值不变。`check-loop.mjs` 不另写这个版本号。

`kit.json` 缺 `policyVersion`、或请求的版本不在 `POLICIES` 里：仍回退版本 1。版本 1 没有 `check17UnclosedAfter`，因此不启用上面两行 approved 规则。「draft 仍是 draft」和「draft 改为 approved」在版本 1 下也阻断。

本仓 `kit.json` 的 `policyVersion` 改为 2。`init` 新装写入 `policyVersion: 2`，`audit` 仍是 false。`audit: false` 时本检查走阻断，不走被吞掉的警告。

阻断句保留「发版草稿」这四个字，并写上发版版本、提交前 7 位、当时状态和现在状态。不带 `--rev` 时现在位置写工作区，带 `--rev` 时写「提交 」加被扫描提交的前 7 位。

## 数据流

`kit.json` 的 `policyVersion` → `loadKitPolicy` → 检查 17。发版提交由 `git log` 沿 `package.json` 找到，当时状态用 `git show <发版>:<路径>`。现在状态读 `ROOT` 上的文件；`--rev` 已经把 `ROOT` 指到那次提交的临时工作树。

## 系统改动

- `templates/_agents/scripts/policy.mjs`：增加 `POLICIES[2]`
- `templates/_agents/scripts/check-loop.mjs`：检查 17 的状态组合与版本锚；头部注释写明 approved 与锚
- `templates/_agents/scripts/check-loop.test.mjs`：本 spec 的夹具
- `src/init.mjs`：新装 `policyVersion` 改为 2
- `src/fresh-init.test.mjs`：断言改为 2，`audit` 仍为 false
- `.agents/kit.json`：本仓 `policyVersion` 改为 2
- `workflow/README.md`：本仓生效版本从 1 改为 2。未知版本回退 1 的那句保留
- 改完 templates 后 `node bin/flow-kit.mjs sync`

## 约束遵守映射

| 红线 | 本 spec 如何满足 |
|---|---|
| 规则 / 契约（检查 17 的阻断集合） | 只扩展检查 17 的状态组合，不新增检查号，不改配对、验收、确认留痕的条文 |
| 双源 | 引擎脚本改 templates/，装副本靠 sync。`src/init.mjs` 是包源。本仓 `kit.json` 与 `workflow/README.md` 手改 |
| schema | 不涉及 |

## 回放

2026-09-29 对本仓三次 version 变更提交重放。命中 = 该提交树上 intent、spec、plan 的状态为 draft 或 approved。下面的名单必须与对同一提交再跑一次的结果一致。三份都在锚之前：它们的发版版本都不大于 `0.8.0`。

0.8.0 是 `80042e9`，父版本 0.7.0。approved 17 份，draft 3 份，done 106 份。

approved：

- `workflow/intents/2026-09-23-agentic-flow-kit-npx-package.md`
- `workflow/intents/2026-09-23-m3-sync-addons.md`
- `workflow/intents/2026-09-23-m4-dogfooding.md`
- `workflow/intents/2026-09-23-m5-npm-publish.md`
- `workflow/intents/2026-09-24-shipyard-increment-port.md`
- `workflow/plans/2026-09-23-agentic-flow-kit-npx-package.md`
- `workflow/plans/2026-09-23-cjs-ext-in-typemodule.md`
- `workflow/plans/2026-09-23-m3-sync-addons.md`
- `workflow/plans/2026-09-23-m4-dogfooding.md`
- `workflow/plans/2026-09-23-m5-npm-publish.md`
- `workflow/plans/2026-09-24-shipyard-increment-port.md`
- `workflow/plans/2026-09-28-adopter-derivers.md`
- `workflow/plans/2026-09-28-claim-exceeds-fix.md`
- `workflow/plans/2026-09-28-metric-claim-gate.md`
- `workflow/specs/2026-09-23-m4-dogfooding.md`
- `workflow/specs/2026-09-27-confirm-gate-one-per-call.md`
- `workflow/specs/2026-09-28-metric-claim-gate.md`

draft：

- `workflow/intents/2026-09-28-opencode-cmd-wf-prefix.md`
- `workflow/plans/2026-09-28-opencode-cmd-wf-prefix.md`
- `workflow/specs/2026-09-28-opencode-cmd-wf-prefix.md`

这 17 份 approved 在当前工作区仍是 approved。这 3 份 draft 在当前工作区已是 done。因此锚若把 `0.8.0` 算进去，规则提交会被这 17 份拦住。锚取「大于 `0.8.0`」之后，当前最新发版不触发 approved 规则。

0.7.0 是 `0272a1c`，父版本 0.6.0。approved 17 份，与上面的 approved 名单相同。draft 0 份。done 103 份。

0.6.0 是 `3df1756`，父版本 0.5.0。approved 13 份，draft 0 份，done 102 份。approved 是 0.8.0 那 17 份去掉下面 4 份：

- `workflow/plans/2026-09-28-adopter-derivers.md`
- `workflow/plans/2026-09-28-claim-exceeds-fix.md`
- `workflow/plans/2026-09-28-metric-claim-gate.md`
- `workflow/specs/2026-09-28-metric-claim-gate.md`

## 风险评估

- 版本 2 漏抄版本 1 的日期键，升版后检查 14、15 的生效日会变。应对：版本 2 明示带上那五个键，测试断言与版本 1 相等。
- 锚用字符串比较会把 `0.10.0` 判成不大于 `0.8.0`。应对：三段整数比较。
- 规则提交若同时去关历史 approved，提交自己会被拦住。应对：本包不关那 17 份。关单另走 confirm-doc。
- 两次发版之间只改 `src/` 的提交仍能通过。这是检查 17 只看最近一次 version 变更提交的既有边界。

## 确认与复核

- 确认结果：approved（2026-09-29 用户对话原话「可以」，仅本份）
- 复核：L2，独立复核留到关单前
