---
状态: approved
级别: L2
日期: 2026-09-29
模块: pipeline
备注: P0 门禁噪声修复批——check18 判据对齐 + check14 生效日后移 + 快照回写门禁化 + pre-push 注释对齐 + 台账补缺
确认指纹: 15727f4acaef40bb
---
# INTENT — p0-gate-noise-batch

## 背景与问题

需求来源：2026-09-29 用户发起的四维审查（目标可验证 / 约束显式化 / 输出结构化 / 反馈闭环化），用户拍板「先做 P0」。实跑 `node .agents/scripts/check-loop.mjs` 得 **73 条 advisory**，其中可机器判定的噪声四类：

1. **check18「委派台账」判据与台账真实结构不匹配**（21 条告警）：`delegationResultRows`（.agents/scripts/check-loop.mjs:867-886）只解析 `## 委派结果` 一节，且要求行内含**带 .md 的全文件名**；而台账实际是两张结果表（委派表 + 自做任务表），L2/L3 自做任务记在自做表、备注通写**不带 .md** 的全名。实测 21 条中 10 条为「行存在仅格式不匹配」（09-26/09-27 批），11 条为真缺行（09-25 ×3、09-28 ×2、09-29 ×5，逐一无台账行）。
2. **check14「确认态缺失」7 条永久误报**：policy v2 `check14Since=2026-09-23` 早于确认门实际上线（2026-09-26 confirm-gate-machine），09-25 六件属门禁引入前历史；09-28 一件（2026-09-28-adopter-derivers spec）为判据盲区——台账证明 draft→approved→done 两跳确认均已走（11:31:32 / 11:31:37 两行），但两跳同批提交致 git 历史无 approved 中间态，git 历史口径误判。
3. **量化反馈环回写无门**：workflow/delegations.md 月度聚合快照停留在「有效任务 2、一次通过率 100%」（09-23 初数据），`agg-delegations` 实时算出「有效任务 20、一次通过率 50%、返工 13 次」——快照 3 周未回写，扩容门判定基于陈旧数据。回写是「粘贴」型人工步骤，无任何门禁约束。
4. **.githooks/pre-push 头注释与事实矛盾**：L8「CI 配置为本地未入库件（.gitignore 排除），不构成跨环境保证」——ci.yml 自 4652309（2026-09-27 gate-coverage）已入库，push(main)/全部 PR 复跑四道门（check-loop / doctor / source-sync-check --gate / workflows-check）。以双源纪律立身的仓库自身出现口径漂移，装户会照抄模板。

## 目标

- G1 check18 判据对齐台账真实结构：解析两张结果表 + 文件名带/不带 .md 均命中；格式误报清零，真缺行仍告警（不假阴性）
- G2 check14 永久误报 7 → 1（policy v2 check14Since → 2026-09-26；09-28 一件留作声明式残余并记 papercuts）
- G3 doctor §6.5 增快照新鲜度检查（陈旧 = WARN）；test.md 关单流程增「快照回写」步骤
- G4 templates/_githooks/pre-push 头注释对齐事实（通用措辞：服务端兜底依赖项目自有 CI，kit 不附带 CI）
- G5 delegations.md 补缺自做任务结果行（结果按各文档「确认与复核」证据回填、备注标「回填」）+ 月度聚合快照行更新为实时值
- G6 check-loop advisory 总量 73 → ≤50（残余为真信号或已声明残余）

## 非目标

- 不改 check14「git 历史 或 台账」判据（判据改进，记 papercuts，P1 再议）
- 不修 check2 叙述文本误报（4 条，P1）
- 不改 gate-checklist.mjs 机制（不引入 CI 第三侧对照）
- 不改 confirm-doc / confirmations.jsonl 语义、不动任何 done 文档（内容绑定）
- 不把敏感信息扫描接入 CI

## 约束

- **双源纪律**：check-loop.mjs / policy.mjs / test.md / pre-push 一律先改 `templates/` 包源（`templates/_agents/scripts/`、`templates/_agents/commands/`、`templates/_githooks/`），再 `node bin/flow-kit.mjs sync` 刷 managed 装副本 + kit.json 台账；test.md 另跑 `sync-hosts --apply` 刷宿主薄适配
- `src/doctor.mjs` 为包体（非 managed），直接改；新增检查逻辑独立 export 供 doctor.test.mjs 场景化测试（沿用 checkLedgerCoverage 先例）
- workflow/README.md 不在 managed/owned 任一侧：`templates/workflow/README.md` 与装副本两侧手动同步改（装副本多一行 archaeology 注记，属 owned 定制，保留）
- check18 两表解析口径与 agg-delegations.cjs `splitTables` 表头签名识别一致（一边改另一边须跟，注释互相引用）
- check-loop 稳定输出契约（banner 字样 / WARN 行计数 / exit 语义）不变；测试基线全绿
- doctor 新增检查对「无 delegations.md / 台账无数据行」装户须 skip 不误报（存在性先行，沿用 §6.5 既有语义）

## 影响面

- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（门禁判据 / doctor 检查项 / 阶段命令流程 / 钩子注释）→ 级别至少 L2

> 触及任一红线即为 L2 / L3，必须立 ../specs/YYYY-MM-DD-<主题>.md 写明如何满足，方可起草 plan。

## 验收标准（可测试）

- [x] G1a：check-loop 实跑 check18 告警清零（补缺后无残留）（证据：实跑 `node .agents/scripts/check-loop.mjs` exit 0，「WARN 委派台账」0 条；独立复核复跑同结果）
- [x] G1b：check-loop.test.mjs 新增场景——「L2/L3 done 文档名只出现在自做表（不带 .md）→ 不告警」「两表均无该文件名 → 仍告警（不假阴性）」「旧判据误报形态（仅委派表有行）→ 不告警」全绿（证据：套件 149/0；场景「去掉扩展名的主题名也命中：警告消失」「文件名在自做任务结果表：警告消失」「文件名仅出现在非台账节：警告仍在」）
- [x] G2：check14 告警仅剩 2026-09-28-adopter-derivers 一条；09-25 六条消失（实跑输出 + policy.mjs diff 为证）（证据：实跑「确认态缺失」1 条=adopter-derivers；policy.mjs v2 check14Since=2026-09-26、v1 保持 2026-09-23；09-25 六件经 d<check14Since 豁免，独立复核逐件核实）
- [x] G3a：doctor.test.mjs 新增快照新鲜度场景（最新/陈旧/无快照行/无台账行）全绿；本仓 doctor 实跑快照项 PASS（证据：doctor.test.mjs 26/0 含场景 19-23；doctor 实跑「✅ delegations 月度快照最新（2026-09）」）
- [x] G3b：test.md「关单」节含快照回写步骤（通用措辞）；`sync-hosts --diff` 薄适配漂移 0（证据：test.md 关单清单「委派快照回写」行；sync-hosts --diff「正文对齐 76 对 / 无漂移 ✅」）
- [x] G4：templates/_githooks/pre-push 注释与 ci.yml 事实一致；sync 后 .githooks/pre-push sha 进台账（证据：L8-9 改写与 .github/workflows/ci.yml push main/全部 PR 四道门事实一致；source-sync-check --gate 70/70 无差异）
- [x] G5a：delegations.md 自做任务结果表含全部在管 L2/L3 done 任务行（备注标「回填 2026-09-29」）（证据：16 行补齐（6×返工×1 + 10×一次通过），备注均标「回填 2026-09-29」+ 证据提交号；check18 实跑 0 告警为完备性机器证明）
- [x] G5b：月度聚合快照 2026-09 行 = agg 实时输出可粘贴行（有效任务 20 / 50% / 返工 13 等）（证据：快照行「| 2026-09 | 36 | 56% | 0.53 | 0% | 22 | ❌ 未达标（连续性中断）：2+3+5 | 样本含待修0 |」与 agg-delegations.cjs 实时输出逐字节一致；括注 20/50%/13 为补缺前估算，实际 36/56%，判据本质「快照行=agg 实时输出」满足）
- [x] G6：check-loop advisory 总量 ≤50；doctor 0 FAIL；npm test 全部套件绿（templates/ 与 .agents/ 两侧）（证据：实跑 73→5 条（4 模板未填=声明 P1 残余 + 1 adopter-derivers 确认态缺失=声明残余）；doctor 13 PASS / 0 WARN / 0 FAIL；npm test 全部套件通过（30 套件 0 FAIL、末行「✅ 全部套件通过」、exit 0；含 check-loop 149/0、doctor 26/0、gate-checklist 14/0）；.agents/ 侧 check-loop.test 实跑 147/0、doctor.test 按装户语境设计性 SKIP；两侧字节经 source-sync-check --gate 70/70 无差异）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 warning。

## 确认与复核

- 确认日期：2026-09-30（台账 ts 2026-09-29T16:07:19Z，source=chat-delegated，原话「三件都通过」，batch b20ce2）
- 确认人：用户（对话内一句"可以"即确认）
- 确认范围：intent 草稿全文过目 + 目标/非目标/验收标准（chat-delegated 代录，of=1/1）
- 复核：L2 独立复核已执行（independent-reviewer，独立上下文，2026-09-30）——0 P0 / 0 P1 / P2×5；须关单前落实的 2 条（check18 两表识别机制待对齐、check14 git 历史判据改进）已入 papercuts，scratch 文件已处置（删快照 + 归档调研件）；其余 3 条（关单日期时区口径未定 / 本 intent 背景「11 条真缺行」为盘点前估算、实际 16 行 / fresh 装户端到端未实测）不阻断，见复核报告
