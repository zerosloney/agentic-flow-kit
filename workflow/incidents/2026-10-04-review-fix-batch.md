---
状态: open
级别: L2
发现: 2026-10-04
模块: pipeline
---
# INCIDENT — 2026-10-04 review-fix-batch

<!-- 修复类：双轴审查（Standards / Spec）发现批修复。单日两工作包（board-run-panel、plan-section-name-evidence）落地后的审查收口。 -->

## 时间线
- 2026-10-04 上午 board-run-panel 与 plan-section-name-evidence 两工作包落地（6ea0051 / 94188ee），当日关单
- 2026-10-04 晚用户令对当日 12 提交做双轴审查：Standards 轴 8 项（6 Minor/Question + 2 Informational）+ Spec 轴 5 项（全 Minor），经证据核验无 Critical/Major
- 用户确认：2026-10-04 用户令修复全部 13 项发现；两处口径当面对话拍板——①AGENTS.md「随代码同一提交」修订为三段式闭环链 ②plan 节名单源改造本次不做（记 papercuts 暂缓）
- 2026-10-04 三件套起草（本 incident + spec + plan），确认后动手

## 影响面
- workflow-board-server（/api/runs 载荷键名、SSE watchdead 广播、/api/run 错误码、safeRunPath 测试面）
- board/index.html（前端消费键名、抽屉工单 tab 确认门要点渲染）
- check-loop.test.mjs（场景重号、测试断言强度）——check-loop.mjs 引擎逻辑零改动
- AGENTS.md 提交纪律节（规则文本修订，用户已拍板）、workflow/papercuts.md（台账）
- 发版 1.0.1 → 1.0.2；本地工具链，无 prod 数据面

## 根因
单日两工作包快速落地时验收文本与实现键名漂移（intent 验收#1 写 `cards`、实现返回 `runs`）、错误处理与测试覆盖欠账（404 吞错、safeRunPath 无测试、done 态占位符漏勾验）；「随代码同一提交」规则文本与确认门时序存在结构性冲突（规则缺陷，非执行缺陷——实际执行的三段式是自洽的）。

## 为什么之前没拦住
- 勾验证据粒度：验收#1 证据写「返回 3 个 run 卡片」未断言键名，人工勾验滑过文本与实现的漂移
- 测试门：新函数 safeRunPath（路径穿越白名单）未强制测试配套；spec:49 要求的「校验通过（type=sha）」断言只落在间接断言（不含「证据无关」）上
- 规则文本冲突无机器校验：口径类规则不走 check-loop，字面冲突（「随代码同一提交」vs「approved 后立即单独提交留痕」）只能靠人工发现
- 双轴审查为当日新增环节，此前无此拦截层

## 验收标准（可测试）
- [x] /api/runs 响应含 `cards` 数组（与 intent 2026-10-04-board-run-panel 验收#1 键名一致），前端消费 `data.cards`（证据：服务实测 `curl http://127.0.0.1:8933/api/runs` 返回 `{"cards":[...]}`、浏览器 fetch 断言 `RUNS.length=5`；⑦ 组断言随 npm test PASS；commit 6cf4eb8）
- [x] watchDir 同步 catch 分支广播 watchdead；isMain 内监听 PIPELINE_RUNS 前补建缺失目录（全新装机推送可用）（证据：workflow-board-server.mjs watchDir catch 补 `broadcast('watchdead')`、isMain 补 `fs.mkdirSync(PIPELINE_RUNS, {recursive:true})`（commit 6cf4eb8）；node --check + 套件 PASS）
- [x] /api/run 读失败区分 ENOENT→404 与其他→500（500 带 console.error 留痕）（证据：/api/run catch 分流实现（commit 6cf4eb8）；node --check PASS）
- [x] 抽屉工单 tab 渲染 awaitConfirm 确认门要点（doc / points / ledger）（证据：浏览器实测（chrome-devtools）——await-confirm fixture 抽屉工单 tab 渲染「等待确认 / 文档 code / 确认门要点 / 将经 confirm-doc 代录入台账」；work-order fixture 回归「工单 #1 · implement」字段齐；done run 空态回归「当前无工单」；fixture 已删、服务已停、无脏数据）
- [x] safeRunPath 有白名单正/负例测试（穿越、绝对路径、非 .json 拒绝；合法名通过）（证据：⑦ 组 4 断言 PASS——合法 runId.json / `..` 穿越 / 根相对路径 / 非 .json（npm test））
- [x] check-loop.test 场景重号消除（旧 43/44 → 45/46）且新增场景 47 端到端 type=sha 放行正例（证据 SHA 触及声明文件 + 锚前自报日期豁免存量面 + 无执行器标记 → exit 0 只能经 type=sha 路径达成；补齐 spec 2026-10-04-plan-section-name-evidence §49 断言强度。注：plan 草拟的「export 直测」不可行——check-loop.mjs 无 isMain 主守卫，import 即全量执行门禁并 exit，实证后回退 export 改端到端，可 import 化记 papercuts）（证据：npm test 全绿）
- [x] AGENTS.md（含 templates 源）提交纪律节改三段式闭环链；workflow/papercuts.md 恢复检查14 定性行 + 新增确认日期占位行 + 节名单源暂缓行（证据：commit 6cf4eb8；AGENTS.md 7666B ≤ 规则面预算 7680B——预算一进出一出压缩措辞，语义与缘由以本 incident + papercuts 为准；papercuts 共恢复 1 行 + 新增 3 行，含 check-loop 无主守卫 papercut）
- [x] `npm test` 全绿 + sync 后双源零漂移（证据：npm test 全部套件通过（check-loop 套件 196 断言含场景 47）；doctor 13 PASS ｜ 0 WARN ｜ 0 FAIL；sync 后 check-ledger 全对齐、owned 无漂移）

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：6cf4eb8（templates/_agents/scripts/{workflow-board-server.mjs + .test.mjs、check-loop.test.mjs}、templates/_agents/board/index.html、templates/AGENTS.md、AGENTS.md（owned 手动同步）、workflow/{papercuts,delegations,INDEX}.md、.agents/ 装副本与 kit.json）
   - 影响环境：dev（本地工具链与文档，无 staging/prod 部署面）
   - 是否需要新 intent：
     - 否 → 理由：审查发现批修复，根因分散（勾验粒度 / 测试覆盖 / 规则文本冲突）但均可单批收口，防复发落在测试与规则条目上

2. 防复发验证（必须落到自动化用例或回归清单条目，禁止只写「已人工验证」）
   - 自动化用例：`templates/_agents/scripts/check-loop.test.mjs` 场景 47（证据 SHA 触及声明文件端到端正例——exit 0 只能经 type=sha 路径达成）+ `templates/_agents/scripts/workflow-board-server.test.mjs` ⑦ 组 safeRunPath 白名单正/负例 + cards 键名断言（npm test 随跑）
   - 或回归清单条目：勾验粒度教训（证据须断言到契约字段名，不止「有返回」）记 workflow/papercuts.md 2026-10-04 行

3. 规范条目（必须有可追溯的落点）
   - 落点（多选）：AGENTS.md 门禁与提交节（三段式闭环链修订，消除与确认门的结构性冲突）/ workflow/papercuts.md（确认日期占位一次性、节名单源暂缓、check-loop 无主守卫三行）
   - 引用：commit 6cf4eb8 / 文件:AGENTS.md#L28、workflow/papercuts.md#L21-25
