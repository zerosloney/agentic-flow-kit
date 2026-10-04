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
- [ ] /api/runs 响应含 `cards` 数组（与 intent 2026-10-04-board-run-panel 验收#1 键名一致），前端消费 `data.cards`（证据：⑦ 组断言 + 浏览器实测）
- [ ] watchDir 同步 catch 分支广播 watchdead；isMain 内监听 PIPELINE_RUNS 前补建缺失目录（全新装机推送可用）（证据：代码 + npm test）
- [ ] /api/run 读失败区分 ENOENT→404 与其他→500（500 带 console.error 留痕）（证据：代码）
- [ ] 抽屉工单 tab 渲染 awaitConfirm 确认门要点（doc / points / ledger）（证据：浏览器实测造 fixture run）
- [ ] safeRunPath 有白名单正/负例测试（穿越、绝对路径、非 .json 拒绝；合法名通过）（证据：⑦ 组断言）
- [ ] check-loop.test 场景重号消除（旧 43/44 → 45/46）且新增 verifyEvidenceTruth 直测 type=sha 正例 + irrelevant/forged 负例（补齐 spec 2026-10-04-plan-section-name-evidence §49 断言强度）（证据：npm test 全绿）
- [ ] AGENTS.md（含 templates 源）提交纪律节改三段式闭环链；workflow/papercuts.md 恢复检查14 定性行 + 新增确认日期占位行 + 节名单源暂缓行（证据：git diff）
- [ ] `npm test` 全绿 + sync 后双源零漂移（证据：命令输出）

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：<关单时回填 SHA + 改动文件清单>
   - 影响环境：dev（本地工具链与文档，无 staging/prod 部署面）
   - 是否需要新 intent：
     - 否 → 理由：审查发现批修复，根因分散（勾验粒度 / 测试覆盖 / 规则文本冲突）但均可单批收口，防复发落在测试与规则条目上

2. 防复发验证（必须落到自动化用例或回归清单条目，禁止只写「已人工验证」）
   - 自动化用例：`templates/_agents/scripts/check-loop.test.mjs` 场景 47（verifyEvidenceTruth 直测：type=sha 正例 / irrelevant / forged 三路断言）+ `templates/_agents/scripts/workflow-board-server.test.mjs` ⑦ 组 safeRunPath 白名单正/负例 + cards 键名断言（npm test 随跑）
   - 或回归清单条目：勾验粒度教训（证据须断言到契约字段名，不止「有返回」）记 workflow/papercuts.md 2026-10-04 行

3. 规范条目（必须有可追溯的落点）
   - 落点（多选）：AGENTS.md 门禁与提交节（三段式闭环链修订，消除与确认门的结构性冲突）/ workflow/papercuts.md（确认日期占位一次性、节名单源暂缓两行）
   - 引用：commit <关单时回填> / 文件:AGENTS.md#L29、workflow/papercuts.md#L18-21
