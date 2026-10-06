---
状态: approved
级别: L2
模块: pipeline
备注: 2026-10-06 补 approved 快照——台账有 approved 行（09-29T23:38Z，代录「继续」）但 git 无中间快照致检查 14 恒告警；本提交指纹取台账 approved 行、随即重确认 done 重绑内容。
确认指纹: dca5f10921c21921
---
# PLAN — stage-gate-machine

<!-- 与 intents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->

对应入口：../intents/2026-09-30-stage-gate-machine.md（approved）
对应 spec：../specs/2026-09-30-stage-gate-machine.md（approved；设计点按建议 A / B / 新增键定案）

## 改动面

- 新增 `templates/_agents/scripts/stage-gates.mjs`：C1 / C2 共享判定（入口确认 + 级别解析 + 回退文案）
- `templates/_agents/scripts/fill-spec.mjs` 与 `fill-plan.mjs`：起草门接线（拒绝 exit 2、零产出）
- `templates/_agents/scripts/confirm-doc.mjs`：确认门前置校验（拒绝 exit 2、不落盘不记账）
- `templates/_agents/scripts/check-loop.mjs`：检查 19「逐阶段」（判据 A 在途扫描 + B 台账顺序；内联实现）
- `templates/_agents/scripts/policy.mjs`：v2 增 `stageGateSince`
- `templates/_agents/scripts/gate-checklist.mjs`：登记表补检查 19 行
- 四个 test 套件（fill-spec / fill-plan / confirm-doc / check-loop）：C5 场景
- `templates/_agents/commands/` 四命令（plan / design / build / maintain）：C4 措辞（替换式改写）
- 装副本：sync（.agents/ 对应副本 + kit.json）+ sync-hosts --apply（宿主命令副本）

## 任务拆解

1. **C1 起草门**（stage-gates.mjs + fill-spec + fill-plan）
   - 判据：双工具拒绝场景（无入口 / 入口 draft / L2 缺 spec）exit 2 且零文件产出；放行场景（入口 approved / spec approved）原行为；仓外草稿提示不拦；套件场景全绿
   - 风险：中（共享口径初版，两工具三入口分支；靠 C5 场景矩阵兜底）
2. **C2 确认门**（confirm-doc）
   - 判据：spec / plan 前置未过 → exit 2、台账零新增、文件状态未改；合规 → 正常落账（TTY 与 --delegated 两形态）；done 与 --to 路径零影响；并录 compose 三连全绿
   - 风险：中（触及确认门本体——最敏感面；须全量套件 + 本仓实跑回归）
3. **C3 审计与登记**（check-loop 检查 19 + policy 键 + gate-checklist）
   - 判据：判据 A、B 双向用例（违规告警 / 合规静默 / 日期门静默）；本仓实跑 advisory 对照实施前基线零新增；gate-checklist --diff 0 断档
   - 风险：低（warning 不 hard-block；判据窄且带双日期门）
4. **C4 命令文档**（四命令 × 双源 + 澄清句）
   - 判据：规则面预算过门（rule-budget --staged）；sync-hosts --diff 0 漂移；source-sync-check --gate 0 差异
   - 风险：中（字节预算曾拦 build.md；替换式改写 + 一进一出）
5. **C5 测试补齐**（四套件）
   - 判据：新场景全绿 + 既有场景零回归（基线 30 套件全绿）
   - 风险：低
6. **双源同步 + 全量验证**
   - `flow-kit sync` → .agents/ 副本 + kit.json 刷新；`sync-hosts --apply` 宿主；`gen-workflow-index` 重生成
   - 判据：npm test 全量 + check-loop + doctor + 四门（check-loop / doctor / source-sync-check --gate / workflows-check）全绿；check-loop advisory 与本仓基线对照零新增
   - 风险：中（sync 可能暴露意外漂移；逐份处置）
7. **L2 独立复核 + 关单**
   - independent-reviewer（独立上下文）读三件套 + diff → 结论；验收逐条勾验补证据 → verify.mjs → 三件套 done（confirm-doc 逐件）→ INDEX 重生成
   - 判据：0 P0 / P1 或问题收口；三件套 done、0 未勾项
   - 风险：低

## 执行顺序

1 →（2 与 3 同批，共用口径）→ 5（随 1-3 各自落地）→ 4（文档措辞最后定稿）→ 6 → 7
- 依赖：2 / 3 依赖 1（stage-gates.mjs 口径）；6 依赖 1-5 全部就位；7 依赖 6
- 并行面：无（单智能体串行）
- 遗留声明（不在本单）：起草登记式审计（全后验）/ raw 绕行运行时拦截 / 提交节奏机器门——均已入 spec 非目标

## 验证方式

- 静态门：`npm test`（全量 30+ 套件）+ `node .agents/scripts/check-loop.mjs` + `node bin/flow-kit.mjs doctor`
- 机器门四件套（CI 同款）：check-loop / doctor / `source-sync-check.mjs --gate` / `workflows-check.mjs`
- 口径对账（L2）：拒绝路径三处实跑演示（fill-spec / fill-plan / confirm-doc 各一，留 exit 2 与文案证据）+ 本仓 check-loop advisory 前后对照 + source-sync-check 与 sync-hosts 零差异
- 独立复核（L2）：关单前 independent-reviewer（独立上下文）执行，结论回填 spec 与 plan
- 生效关系：机制落地后自下一单起强制；本单三件套自身沿修正节奏人工执行（逐件确认、不复用同句）

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-09-30 用户对话内确认，原话「继续」，代录 batch c07cb0；台账 ts 2026-09-29T23:38:54Z）；done（待关单，随入口文档置终态）
- 确认门记录：① plan 草稿全文过目 + 放行（2026-09-30 原话「继续」）；② 改动清单确认：已过目并放行（2026-09-30 原话「可以」；含 README ×2 增补按建议纳入）
- 复核：L2 独立复核**七轮**已执行（独立上下文、全程只读）；终轮 **0 P0 / 0 P1 / 0 P2**。完整复核链见同名 spec「确认与复核」节（单一真相源）
