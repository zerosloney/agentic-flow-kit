---
状态: done
级别: L2
日期: 2026-09-30
模块: pipeline
备注: 逐阶段控制机制化：起草门（fill-spec / fill-plan 前置校验）+ 确认门（confirm-doc 顺序校验）+ 审计（check-loop 逐阶段子项）。动因：2026-09-29 p0 批三件同批起草 + 单句放行未被任何机器门捕获，用户拍板「落实到流程闭环逐阶段控制」
确认指纹: 2c57b46636b2bc17
---
# INTENT — stage-gate-machine

<!-- 与 plans/ 下同名文件配对；frontmatter 受限子集（2026-09-13）：每行 键: 值；状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行 -->

## 背景与问题

需求来源：2026-09-29/30 会话（p0-gate-noise-batch 批的流程复盘）。该批实况：三件套同批起草、同一轮过目、一句「三件都通过」一次放行——spec 起草时入口文档仅 draft、plan 起草时 spec 尚未确认（违反 design.md / build.md 的「未批准则拒绝、回上一阶段」前置）；三次代录复用同句（违反 617cfc0「逐件配逐件原话、不复用同句」纪律）。**全程零机器告警**：并录审计（2026-09-28 batch-ledger-audit）按设计读调用事实——三次独立调用 of=1，程序合规；旧「同 quote + ts」判据已因四类失效整段退役；「确认点是否被并作一次」无任何机器判据。

用户拍板（2026-09-30）：「『后续我严格逐阶段』需要你严格自觉才行——应该落实到 AI 流程闭环逐阶段控制」。即：不依赖 AI 自觉，把「一个环节一个文档、确认前不进下一阶段」做成机器控制。

现状缺口（机制面，均已核实——代码核对 + 本批实证）：
1. 起草工具无前置校验：fill-spec / fill-plan 对入口状态零检查（入口未确认时照常生成草稿）；
2. confirm-doc 无阶段顺序校验：spec / plan 的 draft→approved 不检查入口是否已确认——批内调用顺序自洽即可全部落账；
3. check-loop 无逐阶段审计子项：无「起草先于入口确认」「台账审批顺序倒置」判据，批内并阶段形态静默通过。

同类历史（引用其结论，防重复踩坑）：
- 2026-09-27-confirm-gate-one-per-call：管「一次调用落多份」（of>1 拒录）——覆盖不了「逐次调用、单句放行」；
- 2026-09-28-batch-ledger-audit：确立「写入时记事实、审计读事实」方法论（batch/seq/of）——本单沿此方法扩展；
- 2026-09-28-confirm-gate-effective-date-anchor：生效锚=台账 ts（不采信自报日期）——本单前置判据沿此口径；
- 2026-09-27-gate-coverage：机器门覆盖「未覆盖能力」的既有先例。

## 目标

- G1 起草门（硬拦）：fill-spec / fill-plan 生成前校验同主题入口已确认——未过拒绝生成（非零退出 + 回退指引）；intent 路径以台账行（approved / done）为机器事实源；incident 路径口径随 spec 定案（候选：存在 + 时间线「用户确认」留痕，须与 maintain.md 口径一致）。
- G2 确认门（硬拦）：confirm-doc 对 spec / plan 的 draft→approved 施加同口径前置校验——未过拒绝落账（台账零新增；非零退出或 spec 定案的等价强信号 + 回退指引）。
- G3 审计（首版 warning）：check-loop 新增逐阶段审计子项，判据形态随 spec 定案（至少覆盖「起草先于入口确认」与「台账审批顺序倒置」中可判形态），生效日期门、历史零新增。
- G4 文档与测例：plan / design / build / maintain 命令文档写明两道门与回退路径（双源 + 宿主薄适配同步）；相关工具测试套件补拒绝 + 放行双向场景。
- G5 零回归：既有全绿面（npm test / doctor / 四门 / 双源 / 宿主 diff）不变；既有成功路径输出与退出语义不被破坏。

## 非目标

- 不追溯历史：生效日前既有文档与记录豁免（含 p0 批已发生形态，不改既有记录）。
- 不改 TTY / --delegated / quote / 并录（batch/seq/of）语义；不改 incident 两跳状态机（open→fixed→closed）。
- 不引入对「绕过工具链（raw 写文件起草）」的运行时拦截——信任边界沿 2026-09-28 声明（本地不可机器防，留痕供事后对质）；审计只对可判形态出账。
- build.md 第二道门「改动清单」无文档载体，不进本期机器门（仍为对话纪律）。
- 不强制提交节奏（「确认后立即单独提交留痕」仍为纪律，不做机器门）。
- 不加「incident fixed 前置=spec / plan 终态」新判据（配对门已有部分覆盖；如需另行立单）。

## 约束

- 双源纪律：fill-* / confirm-doc / check-loop / 命令文档一律先改 templates/ 包源，随后 flow-kit sync + sync-hosts --apply 刷装副本。
- 判据基座：前置「已确认」以 confirmations.jsonl 台账为唯一机器事实源（沿 check15 生效锚口径），文档自报状态不单独成立；入口当前状态为 superseded / cancelled 时不视为有效前置。
- 政策门：新审计子项按 policy.mjs 生效日惯例（新键或复用语义于 spec 定案）；v1 不动。
- 输出契约：fill / confirm 既有成功路径输出与退出语义不变；新增拒绝路径须有可判文案（含回退指引）。
- 兼容：adopter 存量（无台账行 / 无登记草稿）零新增告警。
- 测试留痕：每门双场景（拒绝 + 放行）进既有套件（fill-spec.test.mjs / fill-plan.test.mjs / confirm-doc.test.mjs / check-loop.test.mjs）。

## 影响面

- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（门禁判据 / doctor 检查项 / 阶段命令流程 / 钩子注释）→ 级别至少 L2

> 触及任一红线即为 L2 / L3，必须立 ../specs/YYYY-MM-DD-<主题>.md 写明如何满足，方可起草 plan。

## 验收标准（可测试）

- [x] G1a（起草门·spec）：fill-spec 对「无同名入口」与「入口未确认」拒绝生成（非零退出 + 回退指引）；入口已确认时正常生成。fill-spec.test.mjs 双向场景。（证据：fill-spec.test **32/0**——S8 无入口 exit 2 且零产出 / S9 入口 draft 拒 / S10+S14 放行 / S11 正路台账行放行 / S12 incident 缺留痕拒 / S13 仓外草稿不拦 / S16 门禁后缺级别拒 / S17+S15 存量短路放行 / S19 负例三形态拒 / S21 形态矩阵正例 8 全放行 / S22 负例 5 全拒 / S23 模板样例可解析；实跑演示：`fill-spec --output .s/workflow/specs/x.md` → exit 2、文件未生成）
- [x] G1b（起草门·plan）：fill-plan 同口径——L1 要求入口确认、L2 / L3 要求入口 + spec 确认；intent / incident 双入口场景。fill-plan.test.mjs。（证据：fill-plan.test **25/0**——S8/S9/S10/S11/S12/S13 双向 + S14 级别取入口（传 --level L1 不弱化前置）+ S15 入口 L1 免 spec 档；S11 夹具含台账行，实证触达「缺 spec」分支）
- [x] G2a（确认门）：confirm-doc 对 spec / plan 的 draft→approved 前置未过时拒绝落账（台账零新增 + 非零退出或 spec 定案的等价强信号 + 回退指引）；已过时正常落账（TTY 与 --delegated 两形态）。confirm-doc.test.mjs。（证据：confirm-doc.test **32/0**——S19 spec 无入口 exit 2 + 未落盘未记账 / S20 入口 draft 拒 / S21 存量放行 / S22 L2 缺 spec 拒（含零落盘断言）/ S23 入口台账行正路放行 / S24 存量短路放行；**实跑**：`confirm-doc workflow/specs/2026-09-30-demo2.md --delegated demo --root <临时仓>` → exit 2、台账文件未创建、状态未改）
- [x] G2b（确认门·compose）：与并录审计（of>1）互不干扰——三次合规逐件调用仍全绿。（证据：G2a 的实测即 3 次独立 `--delegated` 调用（intent→spec→plan），台账三行各 `of=1`、batch 各不相同；check-loop 并录审计零告警（本仓实跑 warnings=5 全为声明残余，无「确认并录」））
- [x] G3a（审计）：新子项对违规样本（按 spec 定案判据构造）→ 告警；check-loop.test.mjs 双向场景。（证据：check-loop.test **162/0**（templates 侧）——检查 19 判据 A（入口未确认 / 日期门静默 / 放行侧静默 / plan→spec 分支 / incident 正例 + 叙述句负例）、判据 B（倒置告警 / 合规静默 / 日期门整组跳过）、v1 缺键整体跳过、交叉一致性①②（stage-gates 判据与检查 19 内联同判）；反向注入验承重：恒 false → 正例红、过宽 → 负例红）
- [x] G3b（审计·本仓）：本仓实跑 advisory 总量不高于实施前基线（新增项对现状零新增）。（证据：实施前后实跑对照——本仓 advisory 均为既有声明残余 5 条（4 模板未填 + 1 adopter-derivers 确认态缺失），**检查 19「逐阶段」0 条**；`node .agents/scripts/check-loop.mjs` exit 0 / hard 0）
- [x] G4a（文档）：命令文档（plan / design / build / maintain 相关节）写明机器门与回退路径；sync-hosts --diff 0 漂移、source-sync-check --gate 0 差异。（证据：design.md 前置句补「已由机器强制：fill-spec / confirm-doc 未过即拒」；build.md 前置句补「fill/confirm 未过即拒」；plan.md 补「提交最早可行点受配对门约束」；maintain.md 补「时间线『用户确认』是 L2/L3 机器前置」；workflow/README.md 两侧闭环规则第 2 条补逐阶段机器强制；`sync-hosts --diff` 正文对齐 76 对 / 无漂移，`source-sync-check --gate` 71 份无差异）
- [x] G5（零回归）：npm test 全量 + doctor + check-loop / 四门全绿。（证据：关单前复跑——`npm test` **30 套件 0 FAIL / exit 0**「✅ 全部套件通过」；shipped 扫掠 `.agents/scripts/*.test.mjs` **22/22 全绿**；`doctor` **13 PASS / 0 WARN / 0 FAIL**；`check-loop` exit 0 / 0 阻断；`source-sync-check --gate` 无差异；`workflows-check` 0 error / 0 warning；`gate-checklist --diff` 0 断档；`sync-hosts --diff` 76 对 0 漂移）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 warning。

## 确认与复核

- 确认日期：2026-09-30（台账 ts 2026-09-29T17:33:12Z，source=chat-delegated，原话「可以」，batch ff55e0；确认范围 = intent 草稿全文过目）
- 确认范围：intent 全文；目标 G1-G5 / 非目标 / 约束 / 验收标准 8 条
- 复核：L2 独立复核**七轮**已执行（独立上下文、全程只读）；终轮 **0 P0 / 0 P1 / 0 P2**。完整复核链（每轮结论 / 实质问题 / 处置）与「三轮 P1 均为修上一条时引入」的教训记录，见同名 spec 的「确认与复核」节（单一真相源，不在此复述）
- 关单验收：8 条验收标准逐条实跑勾验补证据（见上）；关单前机器面复跑全绿（npm test 30 套件 / doctor 13-0-0 / check-loop exit 0 / 四门）
