# delegations.md 自做任务结果表 16 主题回填调研（只读）

> 调研时间 2026-09-30；证据源：`.agents/confirmations.jsonl`（139 行，首行 2026-09-27T00:21:37Z）、`git log --all`、各 intent/incident/spec 的 frontmatter 与「确认与复核 / 复核与更正」节、check-loop.mjs 检查 18 实现（`r.date >= date && r.line.includes(base|stripped)`，date 取 frontmatter「日期」/ incident 取「发现」）。
> 注意：**jsonl 的 ts 为 UTC（Z 后缀），本地提交时间为 UTC+8**（例：check16-inline-debt done ts `2026-09-28T17:09:08Z` = 本地 2026-09-29 01:09，commit 03725ef）。

## 16 行表格

| 主题 | 关单日期 | 任务一句话 | 结果 | 判定依据 |
|------|----------|------------|------|----------|
| 2026-09-25-orchestrate-in-session | 2026-09-25 | 会话内原生子智能体 fan-out 取代 headless runner（orchestrate 命令） | 返工×1 | 无 done 台账行（jsonl 自 09-27 起），取 frontmatter 日期；08f6207 落地并关单（10:28）→ 用户第三轮纠偏（32a61c6 立 intent 废 orchestrate）→ 同日 orchestrate 命令废止、机制改目录约定（d9a7620）；无独立复核记录，形态返工以用户对话纠偏为准 |
| 2026-09-25-subagent-orchestration | 2026-09-25 | 脚本化子智能体编排（workflow 脚本 + headless runner） | 返工×1 | 无 done 台账行，取 frontmatter 日期；3ce4ef9 关单（02:06）后独立复核抓 P0×1（Windows 批处理 prompt 截断）+ P1×4（settleAll/竖线全角/providers.local.json/正则假绿）+ P2，6d6e239 全修 34/0（incident 2026-09-25-wf-run-review-fixes）= 返工 1 次；同日 runner 形态整体废止（08f6207），形态重做计入下题 orchestrate-in-session，不重复计 |
| 2026-09-25-wf-runtime | 2026-09-25 | 编排脚本 + steps 扩展点，AGENTS.md 全宿主自动加载零适配 | 返工×1 | 无 done 台账行，取 frontmatter 日期；d9a7620 关单（12:25）后 incident 回溯收口 27da05c（13:30：装副本 AGENTS.md 双源漂移 + 验收未勾 + INDEX 未刷新）= 返工 1 次；7ccc7b9/75707c3（doctor owned 漂移校验 + WARN→FAIL）为无单后续加固不计 |
| 2026-09-26-managed-ledger-adopt | 2026-09-26 | managed 文件台账收养分支 + doctor 台账覆盖率检查 | 一次通过 | 无 done 台账行（incident 停 fixed 态），取 incident 发现日期 2026-09-26；无独立复核（spec「确认与复核」节载明「L2 无独立复核要求（本仓库 L2 不强制）」）；03648df 立项 → 9d39413 实现 → 942c03f 关单（21:22-21:23），关单后无同主题修复提交 |
| 2026-09-27-confirm-gate-one-per-call | 2026-09-27 | 确认门逐件化：--delegated 单文档强制 + 并录审计 | 一次通过 | plan done ts 2026-09-27T16:44:06Z（本地 09-28 00:44，71081d6；incident 停 fixed 态为两跳制前状态）；独立复核 0 P0/P1、P2×4 关单前全采纳（0abb57d）；关单后无同主题修复提交（并录判据方向性替换归 batch-ledger-audit 单，f194428） |
| 2026-09-28-adopter-derivers | 2026-09-28 | 装户可扩展指标取数器（内置硬编码 + 模块可选载入，fail-loud） | 返工×1 | incident closed ts 2026-09-28T11:54:19Z（本地 19:55，ac7d0e3）；independent-reviewer 复核 P1×1（shipped 测试套件在每个装户崩：`import ../../../src/profiles.mjs` 路径不存在）+ P2×4 全采纳修复（08768eb 收口；4204093 为实现期自查）= 返工 1 次；关单后无同主题修复提交 |
| 2026-09-28-batch-ledger-audit | 2026-09-28 | 并录审计改读调用事实 batch/seq/of（弃时间戳猜测） | 一次通过 | incident closed ts 2026-09-28T03:02:54Z（本地 11:02，66cb220）；verifier 复核 0 P0/P1，P2×4 关单前全采纳（acf93b6 + 583f31a）；关单后无同主题修复提交 |
| 2026-09-28-check8-git-anchor | 2026-09-28 | 检查 8 生效日锚改 git 首次加入日期 | 返工×1 | incident closed ts 2026-09-28T05:14:16Z（本地 13:14，1a958e0）；verifier 复核 P1×1（「锚不可手填/通道关闭」系不实陈述——锚取 %aI author date，`git commit --date=` 可伪造）+ P2×2 全采纳（87bb788 表述更正）= 返工 1 次；关单后无同主题修复提交 |
| 2026-09-28-confirm-gate-effective-date-anchor | 2026-09-28 | 检查 15 生效日锚由自报日期改台账 ts | 一次通过 | incident closed ts 2026-09-28T01:27:21Z（本地 09:27，02e58e2；台账另有 revert-open 注记行：起草误照抄 draft 起始态，不参与判定）；verifier 复核 0 P0/P1，P2×4 关单前全采纳（92cdf03）；关单后无同主题修复提交（09:35 起并录误报 papercut 为 batch-ledger-audit 新立项） |
| 2026-09-28-ledger-precommit-gate | 2026-09-28 | pre-commit 补 managed 台账快检（拦 sha 预 landing） | 一次通过 | intent/spec/plan done ts 2026-09-28T15:08:19Z（本地 23:08，3454cf5）；independent-reviewer 复核 verdict 通过 0 P0/P1，P2-2/P2-3 关单前采纳（9894de7）、P2-1 为 spec 已声明取舍登记不放；关单后无同主题修复提交 |
| 2026-09-28-opencode-cmd-wf-prefix | 2026-09-28 | opencode 命令薄适配统一 wf- 前缀（与 trae 对齐） | 返工×1 | intent done ts 2026-09-28T16:13:00Z（本地 09-29 00:13，4dfaf50）；ff3c721 还原误带入 doctor.test 的 opencode rename 预期（main 上 CI 红）= 返工 1 次；a6f3d1b（doctor §6.7 注释补改，537df18 漏改）为 docs 层后续不计；无独立复核记录（spec 仅「L2 推荐独立复核」，关单复验为主智能体自抽 7 条证据并据实更正 1 句） |
| 2026-09-29-check16-inline-debt | 2026-09-29 | 检查 16 内联债拆出 check-metric-claims + 扫描口径 tracked-only + TTY 逃生门声明 | 一次通过 | intent done ts 2026-09-28T17:09:08Z（UTC 日期部分 09-28；本地关单 09-29 01:09，03725ef）——**行按 2026-09-29 写**（frontmatter 日期 2026-09-29，check18 要求行日期 ≥ 文档日期，写 09-28 不过）；independent-reviewer 复核 7 项全 CONFIRMED、0 P0/P1，P2×2 关单前采纳（ad2117a）；关单后无同主题修复提交 |
| 2026-09-29-delegation-ledger | 2026-09-29 | 委派台账对账检查（L2/L3 done 无台账行 → 警告） | 一次通过 | intent done ts 2026-09-29T15:25:54Z（本地 23:25，bd3129e）；初复核对 47b0a53 判 P2×1（正例未锁对账整行）由 7e8ee74 关单前收紧，终复核（基准 ff091ef→7e8ee74）0 P0/P1/P2 并确认该洞已关；关单后无同主题修复提交 |
| 2026-09-29-push-scans-tree | 2026-09-29 | pre-push 扫描被推送 sha 的 workflow 树 | 一次通过 | intent done ts 2026-09-29T10:25:29Z（本地 18:25，b246dd0）；复核 0 P0/P1，P2×2 关单前采纳（fcf82c7：仓库外 --rev 退出码 1 + 补扫描面用例）；关单后无同主题修复提交 |
| 2026-09-29-release-unclosed | 2026-09-29 | 发版树上 approved 未收口 hard-block（policy v2 版本锚） | 一次通过 | intent done ts 2026-09-29T12:52:33Z（本地 20:52，92149b5）；复核（基准 894cf8c→fc1ceff）0 P0/P1/P2；实现（fc1ceff 19:32）至关单间无修复提交，关单后无同主题修复提交 |
| 2026-09-29-stack-build-when | 2026-09-29 | node 构建门认 scripts.build、--help 列全门禁目录 | 一次通过 | intent done ts 2026-09-29T07:48:48Z（本地 15:48，3e83215；该单与 board-fullname-pair 同 commit 0176eab 实现）；复核 0 P0/P1，P2×2 关单前采纳（7045ea8：--full 注释与 S6/S8/S9 用例）；关单后无同主题修复提交 |

## 不确定项说明

1. **T12 check16-inline-debt 关单日期口径冲突（唯一必须偏离「ts 日期部分」规则处）**：jsonl done ts 的 UTC 日期部分是 2026-09-28，但文档 frontmatter 日期为 2026-09-29、本地关单时间为 09-29 01:09（commit 03725ef）。check18 判据为「行日期 ≥ 文档日期」，行写 2026-09-28 必然不过，故行日期取本地关单日 2026-09-29。T11 同型（done ts 09-28T16:13Z = 本地 09-29 00:13）但文档日期为 09-28，按规则写 2026-09-28 即可通过；若按本地时间写 09-29 同样通过，两口径不冲突。
2. **T4 managed-ledger-adopt 的「一次通过」无复核记录支撑**：spec 节载明当时「L2 无独立复核要求（本仓库 L2 不强制）」，判定完全依赖「关单后无同主题修复提交 + plan 验证方式节实跑结果（14 文件实现 + 台账 62→77）」。若口径要求必须有独立复核记录，应降为「返工待修」（缺证据 = 复核记录）。
3. **T11 opencode-cmd-wf-prefix 证据薄弱**：① 无独立复核记录（spec 仅「L2 推荐独立复核」，非「已执行」）；② 返工×1 依据是 ff3c721，但该提交未指明哪个前序提交「误带入」rename 预期（归因模糊，嫌疑为 0272a1c v0.7.0 备发批次），且属 CI 红修复而非复核驳回；③ 实现（537df18 22:03）与发版（80042e9 23:12）均先于三件套确认（09-29 00:11 起），断档已在 papercuts 登记（intent 节自述）。若严格要求独立复核记录，应降为「返工待修」。
4. **T1/T2 的形态级返工无复核记录，纯用户对话纠偏**：09-25 用户指出「你加的 dynamic workflows 是编排宿主执行？」（T2 备注）后三轮定形（32a61c6/b6ded2a/104cd02）。归因口径：T2 的 6d6e239（复核 P0/P1 修复）计 T2 返工×1；runner 形态整体废止（08f6207）计 T1 返工×1（承接任务重做）；wf-runtime 为第三形态不计。如希望「形态重做」在 T2 也计一笔，则 T2 应为返工×2。
5. **T3 wf-runtime 的未立项后续**：7ccc7b9/75707c3（doctor owned 漂移校验 + WARN→FAIL 升级）未立 incident（incident 备注明言「留后续 incident 跟进」但未立），未计入返工；若计为第二波返工则 T3 为返工×2。另 cd078ca（09-27，check-loop-review-fixes 单内）给 wf-runtime intent 末条验收补挂证据，属文档层证据补挂，不计 T3 返工。
6. **T5 confirm-gate-one-per-call 的判据后续被替换**：其实现的 check-loop 15 并录子检查（同 quote + ts<2s 聚组）次日被判定方向性失效，由 batch-ledger-audit（T7）以 batch/seq/of 替换（f194428）。该替换已单独成单（T7 行），不计 T5 返工；T5 自身复核 0 P0/P1 且关单后无同主题修复。
7. **T6 adopter-derivers 的相邻提交**：577f02c（09-28 21:01，CI 矩阵加 node 20 + shipped 套件步骤，「上线即抓出 3 处真实缺陷」）与本单 P1（shipped 套件 CI 看不见）主题相邻，但提交记为 CI 加固（v0.7.0 备发），未计本单返工。
8. **incident 状态口径**：T5 的 incident 现停 fixed 态（两跳 closed 制 2026-09-28 起生效前遗留），T4 同样停 fixed 态；check18 对 incident 取 fixed/closed 均入扫描面，不影响本表。
