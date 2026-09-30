---
状态: done
级别: L2
模块: pipeline
确认指纹: b251adfd4839d9f1
---
# PLAN — p0-gate-noise-batch

<!-- 与 intents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->

对应入口：../intents/2026-09-29-p0-gate-noise-batch.md
对应 spec：../specs/2026-09-29-p0-gate-noise-batch.md

## 任务拆解

1. **C1 check18 判据对齐**（templates/_agents/scripts/check-loop.mjs + check-loop.test.mjs）
   - `delegationResultRows`：识别 `## 委派结果` 与 `## 自做任务结果` 两节（遇其他 `## ` 停止），数据行首列「形如 2026-09-30 的日期」过滤不变
   - check18 匹配：`r.line.includes(base) || r.line.includes(base 去 .md)`；告警文案与文件头 check18 判据注释同步更新
   - 头注释加口径互引：「两表解析口径与 agg-delegations.cjs splitTables 一致，一边改另一边须跟」
   - 测试新增 3 场景：① L2 done 文档名只出现于自做表（不带 .md）→ 不告警 ② 两表均无该文件名 → 仍告警 ③ 旧误报形态（行仅在委派表且不带 .md）→ 不告警
   - 判据：3 新场景 + 既有全部「委派台账」场景全绿；实跑告警数下降
   - 风险：中（大套件基线；靠既有场景回归兜底）
2. **C2 check14 生效日后移**（templates/_agents/scripts/policy.mjs）
   - v2 `check14Since: '2026-09-23' → '2026-09-26'`；版本 2 注释同步（不再声称「五日期同 v1」）
   - 判据：实跑 check14 告警 7 → 1（仅 adopter-derivers）
   - 风险：低
3. **C3 doctor 快照新鲜度 + test.md 回写步骤**
   - src/doctor.mjs：`export function checkDelegationSnapshotFreshness(target)`（纯函数）+ §6.5 块内接线（agg 检查之后）
   - templates/_agents/scripts/doctor.test.mjs：新增 4 场景（最新→stale=false / 陈旧→true / 无快照行→true+note / 无数据行→skipped）
   - templates/_agents/scripts/gate-checklist.mjs：PAIRS §6.5 note →「delegations 台账结构 + 快照新鲜度——装户体检独有」
   - templates/_agents/commands/test.md：关单节追加「委派快照回写」步骤（spec C3 原文）
   - 判据：doctor.test 新场景全绿；本仓 doctor 实跑快照项 PASS（C5 回贴后）；gate-checklist --diff 0 断档
   - 风险：低
4. **C4 pre-push 注释对齐**（templates/_githooks/pre-push L8）
   - 按 spec C4 目标措辞替换；同步 templates/_githooks/pre-push 与文档引用（.agents/commands/ 内如有复述同句处一并对齐——实施时 grep 确认）
   - 判据：注释与 ci.yml 事实一致；sync 后 .githooks/pre-push 进台账
   - 风险：低
5. **C5 台账补缺 + 快照回贴**（workflow/delegations.md）
   - C1 落地后实跑 check-loop，提取残留「委派台账」告警清单（唯一主题名去重）
   - 逐主题读 intent「确认与复核」节 + confirmations.jsonl done 行 ts → 判结果与关单日期 → 追加自做表行（备注「回填 2026-09-29；依据：<文档节/台账行>」）；无法判定的结果写「返工待修」
   - 跑 `node .agents/scripts/agg-delegations.cjs`，用可粘贴行替换 §月度聚合快照 2026-09 行
   - 判据：check18 告警清零；快照行 = agg 实时输出
   - 风险：低（结果判定失实靠「读证据 + 不臆断」缓解）
6. **判据文档同步**（templates/workflow/README.md + workflow/README.md「委派台账」段）
   - 判据句改为：两张结果表 + 文件名带/不带 .md；装副本保留其独有的 archaeology 注记行
   - 判据：两侧该段一致（diff 核对，仅注记行允许差异）
   - 风险：低
7. **双源同步 + 全量验证**
   - `node bin/flow-kit.mjs sync` → managed 副本 + kit.json 刷新
   - `node bin/flow-kit.mjs sync-hosts --apply`（test.md 薄适配）→ `--diff` 0 漂移
   - `node .agents/scripts/gen-workflow-index.mjs` 重生成 INDEX
   - npm test（templates/ 侧）+ .agents/scripts/*.test.mjs（shipped 侧）+ doctor + check-loop + source-sync-check --gate + workflows-check
   - 判据：全绿；check-loop advisory ≤50；doctor 0 FAIL
   - 风险：中（sync 可能暴露 unexpected 漂移；按 sync 输出逐份处置）
8. **L2 独立复核 + 关单**
   - independent-reviewer（独立上下文）读三件套 + diff → 用户定性
   - 验收逐条勾验补证据 → verify.mjs → intent/spec/plan → done（confirm-doc 逐件）→ INDEX 重生成
   - papercuts 追加：check14「git 历史 或 台账」判据改进（adopter-derivers 残余根源）
   - 判据：三件套 done、0 未勾项
   - 风险：低

## 执行顺序

1 → 2（同属 check-loop 判据面，连续做）→ 3 → 4 → 6（判据文档随 C1 定稿）→ 5（依赖 C1 落地后的实跑清单）→ 7（依赖 1-6 全部文件就位）→ 8
- 依赖：5 依赖 1；7 依赖 1-6；8 依赖 7
- 并行面：无（单智能体串行；7 的 sync 前所有改动须就位）

## 验证方式

- 静态门：`npm test`（全部套件）+ `node .agents/scripts/check-loop.mjs` + `node bin/flow-kit.mjs doctor`
- 机器门四件套（CI 同款）：check-loop / doctor / `source-sync-check.mjs --gate` / `workflows-check.mjs`
- 口径对账（L2）：check18 告警清单前后对比 + delegations 快照行 = agg 实时输出 + check-loop 实跑 advisory 计数
- 双源：`source-sync-check --diff` 0 差异 + `sync-hosts --diff` 0 漂移 + doctor §4/§4.5 台账一致

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-09-30 用户对话内确认，chat-delegated 原话「三件都通过」，台账 ts 2026-09-29T16:07:36Z，batch 39f2b2）；done（2026-09-30 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 独立复核已执行（independent-reviewer，独立上下文，2026-09-30）——0 P0 / 0 P1 / P2×5，须落实项关单前已落地（papercuts ×2 + scratch 处置），判「建议关单」
- 增量复核（2026-09-30，independent-reviewer「砚迟」）：0 P0 / 1 P1 / P2×5——P1-1（提交树 kit.json 预 landing）处置 = 关单完整提交 + clone 复验；P2 全处置（词表误报改写 / 日志清理 / F2-F3 留痕），详见同名 spec「确认与复核」节
