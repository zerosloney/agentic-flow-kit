---
状态: done
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 intent。开工句是「WP-D 立项」。
确认指纹: 226d5d9ab10d2978
---
# INTENT — 发版树上的未收口文档

## 背景与问题

需求来自 2026-09-29 审查后的修复波次。WP-A、WP-B、WP-C 已关单。本包只做其中的 WP-D。

同类入口是 `workflow/intents/2026-09-29-adopter-surface.md`。它把检查 17 定成：最近一次 `package.json` 的 `version` 变更提交上，状态已经是 draft 的 intent、spec、plan，被扫描的树上仍是 draft，则 hard-block。那次提交上已经是 approved、之后仍停在 approved 的文件不在覆盖面里。发版可以把未收口文档原样带出去。

`templates/_agents/scripts/policy.mjs` 的 `POLICIES` 只有版本 1。`kit.json` 缺 `policyVersion` 或版本不在表内时回退版本 1。本仓与 `init` 新装都写版本 1。新规则若直接改版本 1，已装仓库会在升级后突然套上。

## 目标

- 发版提交上状态已是 draft 或 approved，被扫描的树上该文件仍是 draft 或 approved：退出码 1。
- 同一文件在被扫描的树上已是 done：退出码 0。
- 「approved 仍未收口」只对锚之后的 version 变更生效。锚之前的发版树即使全是 approved，退出码 0。
- 「draft 仍是 draft」保持现在的行为，不因为新锚而放行。
- 锚只写在 `templates/_agents/scripts/policy.mjs` 的 `POLICIES` 版本 2。`check-loop.mjs` 不再另埋一个日期。
- 本仓 `kit.json` 的 `policyVersion` 升到 2。仍写 1 的已装仓库继续用版本 1 的锚。未知 `policyVersion` 仍回退版本 1。
- `init` 新装的 `kit.json` 写 `policyVersion` 2。
- 不带 `--rev` 时，现在的状态读工作区。带 `--rev` 时，读被推送的那棵树。
- 检查号仍是 17。

## 非目标

- 不要求每次代码提交都带 intent。两次发版之间只改 `src/`、不带 workflow 文档的提交仍然能过。
- 不用提交说明模糊匹配主题名。判据只看该文件在不在那次发版树上。
- 不在本包关闭或标放弃创始文档（npx 包、M3、M4、M5）。引入规则的那次提交里也不做历史关单。
- 0.2.0 到 0.8.0 的 version 变更不追溯套用「approved 仍未收口」。
- 不新增检查号，不改配对、验收、确认留痕的判据条文。
- incident 的 open 不参与。发版提交之后才新建的文件不参与。
- 不做委派台账告警，不拆分 check-loop，不在提交后重生成索引，不加覆盖率，不加 CI 片段。
- 不把 `audit` 缺省改成 false。`audit: false` 时本检查仍走阻断，不走被吞掉的警告。

## 约束

- 先用本仓 0.6.0、0.7.0、0.8.0 三次真实 version 提交做回放，把命中文件列表写进同名 spec，确认都落在锚之前，再写规则。规则提交单独走。
- 锚的具体取值在 spec 里定，只进 `POLICIES` 版本 2。
- 查找最近一次 version 变更仍走 `package.json` 的全部历史，不设次数上限。
- 引擎改 `templates/_agents/scripts/policy.mjs`、`templates/_agents/scripts/check-loop.mjs` 及其测试，以及 `src/init.mjs` 的新装字面量，再 sync。不拆检查文件。
- 不新增运行时依赖。

## 影响面

- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2

检查 17 的阻断集合从「仍是 draft」扩到「仍是 draft 或 approved」，并用 `policyVersion` 2 限定新规则的生效锚。级别 L2。如何满足写在同名 spec。

## 验收标准（可测试）

- [x] 锚之后的发版树上有 approved，目标树仍是 approved：按该树扫描退出码 1（证据：`templates/_agents/scripts/check-loop.test.mjs`「检查17 锚之后 approved 仍是 approved → hard」，断言含 `version=0.9.0`；实现 `fc1ceff`；`verify.mjs` 退出码 0，该套件 138/138）
- [x] 同一文件在目标树已是 done：退出码 0（证据：同套件「检查17 同一文件已是 done → 不拦」；`fc1ceff`）
- [x] 锚之前的发版树即使全是 approved：退出码 0（证据：同套件「检查17 锚之前 approved 仍是 approved → 不拦」，发版版本 `0.8.0`；`fc1ceff`）
- [x] 发版树上是 draft、目标树已改成 approved：退出码 1（证据：同套件「检查17 发版树上是 draft、现在是 approved → hard」；`fc1ceff`）
- [x] `check-loop.test.mjs` 里「发版树上的 draft 仍为 draft」仍 hard-block；发版之后新建的 draft 仍不拦（证据：同套件「检查17 发版树上的 draft 仍为 draft → hard」「检查17 发版之后新建的 draft 不拦」；`fc1ceff` 后 138/138）
- [x] `init` 新装的 `kit.json` 中 `policyVersion` 为 2，且 `audit` 仍为 false（证据：`src/fresh-init.test.mjs`「新装 audit 为 false 且 policyVersion 为 2」；`verify.mjs` 中该套件 4/4；`fc1ceff`）
- [x] 同名 spec 里 0.6.0、0.7.0、0.8.0 的回放列表，与对这三次 version 提交重跑的命中文件一致，且都在锚之前（证据：2026-09-29 重放 `80042e9`、`0272a1c`、`3df1756`，approved 17/17/13、draft 3/0/0、done 106/103/102，与 spec 回放段一致；三版都不大于 `0.8.0`）

## 确认与复核

- 确认结果：approved（2026-09-29 用户对话原话「可以」，仅本份）
- 复核：L2 独立复核已执行（独立上下文，基准 `894cf8c` → `fc1ceff`）。未发现阻断问题，无 P0/P1/P2。
- 关单：done（2026-09-29 用户对话原话「可以」，仅本份）
