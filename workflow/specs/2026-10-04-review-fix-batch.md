---
状态: approved
级别: L2
日期: 2026-10-04
模块: pipeline
备注: 与 incidents/2026-10-04-review-fix-batch.md 同名配对（修复类，审查发现批）
确认指纹: 70b6fe7b9e2414e4
---
# SPEC — review-fix-batch

<!-- 与 ../incidents/2026-10-04-review-fix-batch.md 同名入口配对；来源：2026-10-04 双轴审查 13 项发现（Standards 8 + Spec 5），用户令全修 -->

## 功能行为

按发现逐项（编号沿审查报告）：

1. **S1/Spec#1 API 键名对齐**：`GET /api/runs` 载荷由 `{ runs: [...] }` 改为 `{ cards: [...] }`，前端 `RUNS = data.cards`——与已关单 intent 2026-10-04-board-run-panel 验收#1「JSON 结构含 `cards` 数组」文本一致。消费面仅自带前端与手工探活（v1.0.1 当日发布的本地只读工具，无外部消费者）。
2. **S2/Standards#2+Spec#2 推送可靠性**：`watchDir` 同步 catch 分支补 `broadcast('watchdead')`（与异步 error 分支口径一致，前端徽标如实切换「60s 轮询」）；`isMain` 内监听 `PIPELINE_RUNS` 前先 `fs.mkdirSync(PIPELINE_RUNS, { recursive: true })`——全新装机（`.agents/cache/` 被 gitignore）目录缺失导致 fs.watch ENOENT、SSE 永不生效的根因消除。
3. **S3/Standards#4 错误保真**：`/api/run` 读失败区分 `ENOENT → 404 run 文件不存在` 与其他错误 → 500（`console.error` 留操作/对象/原因后返回），不再把 EACCES/EISDIR 误报为 404。
4. **S4/Spec#3 确认门要点**：抽屉工单 tab 在停机点为 await-confirm 时渲染 `run.awaitConfirm`（文档、要点 points、是否入台账 ledger），不再一律显示「当前无工单」——补齐 intent 目标节「工单详情 + 确认门要点」的缺半。
5. **S5/Standards#1 测试重号**：check-loop.test.mjs 旧场景 43/44（cd078ca 引入：花括号展开 / 命名约定）改号 45/46，消除与新 43/44（94188ee 引入：证据真相）重号；已关单 incident 2026-10-04-plan-section-name-evidence 按号引用新 43/44，故动旧不动新。
6. **S6/Standards#3+Spec#5 断言强度**：`verifyEvidenceTruth` 加 export 供直测；新增场景 47 直测 `{ ok: true, type: 'sha' }` 正例与 irrelevant / forged 负例——补齐 spec 2026-10-04-plan-section-name-evidence §49「校验通过（type=sha）」的显式断言。
7. **S7/Standards#5 测试盲区**：`safeRunPath` 加 export，⑦ 组补白名单正/负例（`..` 穿越、绝对路径、非 .json 拒绝；合法 runId.json 通过）。
8. **S8/Standards#6 Question 裁决**：AGENTS.md（templates 源 + 装副本）提交纪律由「随代码同一提交」修订为三段式闭环链——`docs(*)` approved 留痕 → 代码 → `docs(*)` 关单（相邻提交即同一闭环，check-loop 配对门校验）；消除与「approved 后立即单独提交留痕」「L2/L3 确认后方可动手」的结构性冲突（用户 2026-10-04 对话拍板）。
9. **S9/Standards#7 台账修复**：workflow/papercuts.md 恢复被 d8d3d7d 整行替换误删的 2026-09-30「检查 14 ×3 存量定性」行（该行自称「保留即审计可见性」）；新增 2026-10-04 两行：done spec「确认日期」占位一次性（模板本身不含该行，作者手写，done 内容绑定不可回填，台账 confirmations.jsonl 为准——不给不可修文档加永久 WARN）与 plan 节名单源暂缓（用户拍板，regression-checklist 已有防复发条目守着）。
10. **S10/Standards#8 收尾**：新 43/44 孪生脚手架提 helper + `GIT` 平台常量（仅新场景，旧场景沿手术式不动）；workflow-board-server.mjs 文件尾补换行；package.json 1.0.1 → 1.0.2 + CHANGELOG。

## 数据流

- `/api/runs` → `scanRuns()` → `{ cards: RunCard[] }` → 前端 `refreshRuns()` 消费 `data.cards`（键名 S1）
- `/api/run?file=<runId>.json` → `safeRunPath` 白名单 → 读文件：成功 200 / ENOENT 404 / 其他 500+SSE 不受影响（S3）
- fs.watch（workflow/ 与 pipeline-runs/）→ 防抖 500ms → `broadcast('changed')`；初始化失败（同步 catch 与异步 error）→ `broadcast('watchdead')` → 前端徽标切轮询 + 既有 60s 无条件兜底轮询不变（S2）
- run JSON（pipeline-run.mjs 亲写）：`awaitConfirm = { doc, points, ledger }` / `gateFail = { stage, problems }` / `workOrder`——前端工单 tab 按停机点类型分流渲染（S4）

## 系统改动

| 模块 | 改动 | 对应 |
|---|---|---|
| templates/_agents/scripts/workflow-board-server.mjs | 键名 cards / catch 广播 watchdead / mkdir 兜底 / 404·500 区分 / safeRunPath export / 尾换行 | S1 S2 S3 S7 S10 |
| templates/_agents/board/index.html | data.cards / 工单 tab 确认门要点渲染 | S1 S4 |
| templates/_agents/scripts/workflow-board-server.test.mjs | safeRunPath 正负例、cards 键名断言 | S1 S7 |
| templates/_agents/scripts/check-loop.mjs | verifyEvidenceTruth 加 export（仅导出，逻辑零改动） | S6 |
| templates/_agents/scripts/check-loop.test.mjs | 旧 43/44→45/46、新场景 helper 去重、场景 47 直测 | S5 S6 S10 |
| templates/AGENTS.md + AGENTS.md（owned 手动同步） | 提交纪律三段式修订 | S8 |
| workflow/papercuts.md | 恢复 1 行 + 新增 2 行 | S9 |
| package.json / CHANGELOG.md | 1.0.2 发版 | S10 |
| workflow/{incidents,specs,plans}/2026-10-04-review-fix-batch.md | 本三件套 | 配对 |
| .agents/ 装副本 | `node bin/flow-kit.mjs sync` 生成（managed 文件，不手改） | 双源纪律 |

## 约束遵守映射

- **手术式变更**：13 项发现逐条对应上表，无顺手改；/api/doc 的同型 404 吞错为存量（本次 diff 之前已在），不在本批范围（审查报告已注明）。
- **引擎双源纪律**：引擎文件一律改 templates/ 后 sync；AGENTS.md 为 owned 文件 sync 不动，装副本手动同步（与模板逐字一致）。
- **不偷懒清单（错误与日志）**：500 路径 console.error 含操作（读 run）、对象（rel 路径）、原因（e.message）；不吞异常。
- **公开契约**：/api/runs 键名变更属接口契约变更——本地只读工具、唯一消费方为自带前端（同提交内对齐）与人工探活，v1.0.1 无外部装机消费面；风险接受并记 CHANGELOG。
- **done 内容绑定**：已关单 intent/spec/incident 一律不回改；代码向 spec 文本对齐（S1），缺口以 papercuts 留痕（S9）。

## 风险评估

- 键名改名破坏未已知消费者：低（消费面自查完毕：index.html + 测试 + 手工探活文档），随 CHANGELOG 声明
- mkdir 副作用：低（仅补建 pipeline-runs 空目录，pipeline-run.mjs 首跑本会建；看板「只读」承诺指不写文档/run 数据，启动横幅注明）
- AGENTS.md 规则文本变更：中（规则面）——用户 2026-10-04 对话拍板，check-loop 配对门行为不变（三段式本就通过），回滚 = revert 单提交
- 测试改号引用漂移：低（动旧不动新，全仓 grep 确认旧 43/44 无文档按号引用）
- 回滚：git revert 修复提交即整体回退，无数据迁移

## 确认与复核

- 确认日期：2026-10-04（对话委托代录，原话「可以，三件套均批准」；台账 confirmations.jsonl 为准）
- 复核：L2 推荐独立复核——本批为审查发现修复、引擎 gate 逻辑零改动、npm test 全绿把关；独立复核省略，理由：改动面逐项对应审查报告且用户逐项过目（本 spec 即报告转写）
