---
状态: done
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 intent。开工句是「WP-E 立项」。
确认指纹: 52e37f2ffd46f27d
---
# INTENT — 委派台账对账

## 背景与问题

需求来自 2026-09-29 审查后的修复波次。WP-A、WP-B、WP-C、WP-D 已关单。本包只做其中的 WP-E。

`workflow/delegations.md` 的委派结果表现在只有两行，日期是 2026-09-23 和 2026-09-24。自做任务结果表里已经写过 L2 独立复核由 independent-reviewer 子代理完成，例如 2026-09-27 的门禁体系加固批，这一行不在委派结果表里。文件头部写着一次完成率达标之前不扩并发。样本不进委派表，门槛就没有这份输入。

check-loop 现在不读这张表。`audit: false` 时卫生警告被丢掉，阻断仍在。`wf-journal.mjs` 只记编排阶段的 pass、fail、blocked，不和委派表对账，也不调度任务。

## 目标

- L2 或 L3 的 intent、spec、plan 状态为 done，或同级别 incident 状态为 fixed 或 closed 时，若委派结果表在该文档日期之后没有一行含该文件名，check-loop 输出警告，退出码仍是 0。
- 补上一行委派记录，日期不早于该文档日期，且含该文件名：这条警告消失。
- L1 的 done 不触发。状态仍是 draft 或 approved 的不触发。
- `audit: false` 的装户沿现有政策吞掉这条警告。不进 hard-block。
- `wf-journal.mjs` 增加一条只读输出：journal 里结果为 pass、对应编排阶段的 role 是 implementer 或 independent-reviewer，而委派结果表没有同行日期与文件名时，把该阶段 id 列出来。
- 若因此新增检查号，同一次改动登记 gate-checklist。已有检查号的含义不改。

## 非目标

- 不把这条警告做成阻断。
- 不把 Markdown 编排做成调度器，不自动派子智能体。
- 不要求每次代码提交都带 intent。不用提交说明模糊匹配主题名。
- 自做任务结果表里提到文件名，不抵消这条警告。
- 不改检查 17 的判据，不改 `policyVersion`，不改并发扩容门槛的数字。
- 不改 `wf-journal.mjs add` 的必填参数。
- 不做拆分 check-loop、提交后重生成索引、CI 片段、覆盖率。

## 约束

- 警告写入 warnings，使 `audit: false` 继续把它吞掉。
- 委派结果表的判定只看该表，不看文件里的其他节。文件名按带 `.md` 的全名匹配。
- 角色名从编排脚本的 stages 表读取，pass 从 journal 读取。对账命令只读，不写 journal，不写 `delegations.md`。
- 引擎改 `templates/_agents/scripts/check-loop.mjs`、`templates/_agents/scripts/wf-journal.mjs` 及其测试，再 sync。输出顺序是稳定契约，本包单独调整因此产生的断言。
- 不新增运行时依赖。

## 影响面

- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2

check-loop 增加一条不阻断的委派台账警告，`wf-journal` 增加只读对账输出。级别 L2。如何满足写在同名 spec。

## 验收标准（可测试）

- [x] 一份 L2、状态 done 的文档，委派结果表没有该文件名：出现警告，退出码 0（证据：`templates/_agents/scripts/check-loop.test.mjs`「检查18 委派表不存在：L2 done 警告且 exit 0；L1 done 与 L2 approved 不警告」；`check-loop-rev.test.mjs`「委派行只在工作区：--rev 旧提交仍输出委派台账」。实现 `47b0a53`。`verify.mjs` 退出码 0，两套件 146/146、24/24）
- [x] 补上一行含该文件名、日期不早于文档日期的委派记录：该警告消失（证据：同套件「检查18 补上不早于文档日期且含文件名的一行：该警告消失」。早于文档日期、只有去掉扩展名的主题名、文件名只在自做任务结果，三条警告仍在。`check-loop-rev.test.mjs`「同一工作区不带 --rev：后补的委派行消掉警告」。`47b0a53`）
- [x] 一份 L1、状态 done 的文档不触发这条警告（证据：同套件「检查18 委派表不存在：L2 done 警告且 exit 0；L1 done 与 L2 approved 不警告」断言 `low.md` 不出现在委派台账行。`47b0a53`）
- [x] `audit: false` 时这条警告不输出，退出码 0；配对断裂仍阻断（证据：同套件「检查18 audit false：委派台账不输出且 exit 0」；既有「audit false：缺 plan 仍阻断」仍通过。`47b0a53`，该套件 146/146）
- [x] journal 有一条 pass，对应阶段 role 为 implementer 或 independent-reviewer，委派表为空：对账输出含该阶段 id（证据：`templates/_agents/scripts/wf-journal.test.mjs`「委派表为空且 role=implementer 的 pass：列出阶段 id」「role=independent-reviewer 的 pass：同样列出」。正例要求某一整行等于「委派台账未记录（1）：<阶段 id>」，锁在 `7e8ee74`。该套件 18/18）
- [x] `check-loop.test.mjs` 与 `wf-journal.test.mjs` 的既有用例保持通过（证据：`verify.mjs` 退出码 0。`check-loop.test.mjs` 146/146，含「audit false：缺 plan 仍阻断」。`wf-journal.test.mjs` 18/18，含「add 缺 --wf 仍失败」与 S1 至 S9）

## 确认与复核

- 确认结果：approved（2026-09-29 用户对话原话「可以」，仅本份）
- 复核：L2 独立复核已执行（独立上下文，基准 `ff091ef` → `7e8ee74`）。未发现阻断问题，无 P0/P1/P2。此前对 `47b0a53` 的一条 P2（正例未锁对账整行）已由 `7e8ee74` 收紧，本次复核确认该洞已关上。
- 关单：done（2026-09-29 用户对话原话「可以」，仅本份）
