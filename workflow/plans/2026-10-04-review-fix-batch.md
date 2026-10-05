---
状态: done
级别: L2
模块: pipeline
确认指纹: 75d8bb97eb4ca5c8
---
# PLAN — review-fix-batch

<!-- 与 ../incidents/2026-10-04-review-fix-batch.md 同名入口配对；spec：../specs/2026-10-04-review-fix-batch.md（已过目） -->

对应入口：../incidents/2026-10-04-review-fix-batch.md
对应 spec：../specs/2026-10-04-review-fix-batch.md

## 改动方案

- templates/_agents/scripts/workflow-board-server.mjs：①`/api/runs` 载荷 `{ runs: scanRuns() }` → `{ cards: scanRuns() }`（spec S1）②`watchDir` 同步 catch 分支补 `broadcast('watchdead')`（spec S2，与异步 error 分支口径一致）③`isMain` 内 `watchDir(PIPELINE_RUNS)` 前补 `fs.mkdirSync(PIPELINE_RUNS, { recursive: true })` + try/catch（目录缺失 ENOENT 根因；启动横幅补「run 目录缺失时补建空目录」注明）④`/api/run` 读失败 `e.code === 'ENOENT' → 404`，其余 `console.error(操作/对象/原因)` 后 500（spec S3）⑤`safeRunPath` 加 `export`（spec S7）⑥文件尾补换行（spec S10）
- templates/_agents/board/index.html：①`RUNS = data.runs || []` → `data.cards || []` ②`loadRunWorkOrder` 分流：有 `workOrder` 走现状；否则有 `awaitConfirm` 渲染确认门要点（文档 rel / points 要点 / ledger 提示「将经 confirm-doc 代录入台账」）；否则维持「当前无工单」空态（spec S4）
- templates/_agents/scripts/workflow-board-server.test.mjs：⑦ 组新增 `safeRunPath` 正/负例（`../../package.json` 拒绝、绝对路径拒绝、非 .json 拒绝、合法 `<runId>.json` 通过）；import 面补 safeRunPath
- templates/_agents/scripts/check-loop.mjs：`function verifyEvidenceTruth` → `export function verifyEvidenceTruth`（仅导出，逻辑零改动；spec S6）
- templates/_agents/scripts/check-loop.test.mjs：①旧场景 43/44 注释改号 45/46（消除与新 43/44 重号；动旧不动新——已关单 incident 按号引用新 43/44）②新 43/44 块提 `evidenceFixture` helper + 模块级 `const GIT`（替代块内 `process.platform === 'win32' ? 'git.exe' : 'git'` 内联）③新增场景 47：直测 `verifyEvidenceTruth`——正例（真实 sha 触及声明文件 → `{ ok: true, type: 'sha' }`）+ 负例（声明 ghost 文件 → type:'irrelevant'；不存在 sha → ok:false type:'forged'）（spec S5 S6 S10）
- templates/AGENTS.md #L29 与装副本 AGENTS.md（owned，手动同步）：「L1+ 入口文档 / spec / plan 随代码同一提交」→ 三段式闭环链表述（approved docs(*) 先行 → 代码 → 关单 docs(*) 随后，相邻提交即同一闭环由 check-loop 配对门校验；注明 2026-10-04 review-fix-batch 修订缘由）（spec S8）
- workflow/papercuts.md：恢复 2026-09-30「检查 14 ×3 存量定性」行（d8d3d7d 误删，按 b3658c3 原文）；表尾新增 2026-10-04 两行（done spec 确认日期占位一次性 / plan 节名单源暂缓）（spec S9）
- package.json 1.0.1 → 1.0.2；CHANGELOG.md 补 1.0.2 条目（spec S10）
- workflow/{incidents,specs,plans}/2026-10-04-review-fix-batch.md：本三件套（已建）
- .agents/ 装副本（managed）：`node bin/flow-kit.mjs sync` 生成，不手改

## 任务拆解（L2/L3 必填）

1. board-server 行为修复（cards / watchdead / mkdir / 404·500 / safeRunPath export / 尾换行）
   - 判据：`node --check` 通过 + ⑦ 组新增断言 PASS + `/api/runs` 返回 `cards` 键
   - 风险：低（本地只读工具；键名消费面仅自带前端，同批对齐）
2. 前端 cards 消费 + 工单 tab 确认门要点渲染
   - 判据：浏览器实测——runs 视图正常出卡；造 await-confirm fixture run，抽屉工单 tab 显示文档/要点/台账提示
   - 风险：低（纯展示层分流，不动 SSE/刷新逻辑）
3. check-loop 测试改号 + 去重 + 场景 47 直测
   - 判据：`npm test` 全绿；全仓 grep 无重号场景引用漂移
   - 风险：低（动旧不动新，旧 43/44 无文档按号引用——cd078ca incident 已核实未引用）
4. 规则与台账文档（AGENTS.md 三段式 / papercuts 三行 / 发版 1.0.2）
   - 判据：templates 与装副本逐字一致；papercuts 表行数 = 原 +2（恢复 1 行）
   - 风险：低（用户已拍板口径；文本变更可 revert）
5. sync 双源 + 全量验证
   - 判据：sync 后 `git status` 无模板漂移告警；`npm test` 全绿
   - 风险：低

## 执行顺序（L2/L3 必填）

1 → 2 → 3 → 4 → 5；1/2/3 相互无依赖（2 依赖 1 的 cards 键名联调，编码可先行）；5 收尾统一验证

## 验证计划

- 静态门：`node --check` 三个改动 .mjs（templates 与装副本）
- 项目测试：`npm test` 全套件（check-loop 套件 + board-server 套件）
- 前端/UI：涉及页面改动必走——verify-ui 技能实测：runs 视图卡片 + 抽屉工单 tab（await-confirm fixture 渲染确认门要点；work-order fixture 回归现状渲染）
- L2 追加：双源一致性（sync 后 `node .agents/scripts/verify-wiki-consistency.mjs` 不涉；git status 对 .agents/ 无手改漂移）；键名契约断言在 ⑦ 组
- L3 追加：不适用（无 schema / 运行时结构变更）

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 推荐独立复核——引擎 gate 逻辑零改动（check-loop.mjs 仅加 export），独立复核省略，理由随 spec 复核节
