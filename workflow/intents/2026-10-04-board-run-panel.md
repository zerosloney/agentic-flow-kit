---
状态: approved
级别: L1
risk_level: L1
日期: 2026-10-04
模块: pipeline
备注: pipeline-run 执行器面板（spec 二期）
确认指纹: d187d568115d573d
---
# INTENT — board-run-panel

## 背景与问题

pipeline-run 是机器驱动的六阶段闭环执行器（2026-10-02 上线），run 事件流落在 `.agents/cache/pipeline-runs/<runId>.json`（脚本亲写、gate 事件含真实退出码，是机器事实）。但当前观测面只有 `status` / `watch` 两个终端命令——`specs/2026-10-02-pipeline-run.md` 数据流节已把「ensure-board 读 pipeline-runs/ 渲染面板」列为二期，本次实现该二期。

workflow 看板（`.agents/board/index.html` + `workflow-board-server.mjs`）已有 SSE 实时推送与卡片渲染基础设施，但只渲染 `workflow/` 文档，不显示执行器内部状态。本次在看板增加执行器面板（Run 面板），展示 pipeline-run 事件流与阶段条。

## 历史教训/防复发

- 检索结果：`kb-search "执行器面板 pipeline-run 看板"` 无命中（全新主题）
- 避坑指南：
  - **journal 是自报态、非验证态**（`.agents/workflows/_TEMPLATE.md`）——看板渲染 pipeline-runs/ 事件流（脚本亲写的机器事实），**不读** `.agents/cache/orchestration-runs.jsonl`（宿主 AI 自报），避免把自报态当机器事实展示
  - run 文件是 gitignored 缓存态（`specs/2026-10-02-pipeline-run.md` 明确「非权威——workflow/ 文档 + confirmations.jsonl 是唯一真相源」），面板定位为**只读观测层**，不做任何告警/门禁判定，不加状态迁移能力

## 目标

- workflow 看板新增「执行器」视图，展示 pipeline-runs/ 下所有 run 的卡片：runId / 需求 / 阶段条（复用 pipeline-run.mjs stageBar 的 Plan/Design/Build/Test 阶段映射）/ 停机点类型 / 更新时间
- 点击 run 卡片展开抽屉：事件时间线（run-created / work-order / gate（含退出码与耗时）/ confirm / commit / stop / done / abort）+ 工单详情（当前工单全文）+ 确认门要点
- 看板通过已有 SSE 通道实时刷新（run 文件落盘即推送）

## 非目标

- 不做执行器控制面：不启动 / 不推进 / 不中止 pipeline-run（面板纯只读）
- 不渲染 `.agents/cache/orchestration-runs.jsonl`（编排脚本的宿主 AI 自报 journal）
- 不做 gate-fail 修复引导 / 告警判定（面板不消费 check-loop）
- 不改 pipeline-run.mjs 状态机本身

## 约束

- 复用 `workflow-board-server.mjs` 的本地只读 HTTP + SSE 基础设施（fs.watch → 500ms 防抖 broadcast）
- 复用 `pipeline-run.mjs` 的 `stageBar` 阶段映射口径（Plan/Design/Build/Test/Review/Checklist/Authorize/Verify），不另造一套
- 前端沿用 `index.html` 既有「纸墨工业」风格与抽屉交互模式（卡片 / 抽屉 / 时间线）
- 引擎双源纪律：改动落 `templates/_agents/` 包源，再 `node bin/flow-kit.mjs sync` 更新 `.agents/` 装副本
- 测试：新增 server 纯函数测试用例进 `npm test`（run 文件解析 / 事件时间线排序 / 阶段映射复用）

## 影响面

- 模块：pipeline
- 数据库：无
- 前端页面：`.agents/board/index.html`（新增「执行器」视图与抽屉 Run 时间线 tab）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 或 Quick-Plan 中说明）

- [ ] <按本项目 AGENTS.md 红线逐行补；无则删本行>
- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3

> 触及任一红线即为 L2 / L3，必须立 ../specs/YYYY-MM-DD-<主题>.md 写明如何满足，方可起草 plan。

## 验收标准（可测试）

- [ ] `GET /api/runs` 返回 `.agents/cache/pipeline-runs/` 下全部 run 的解析卡片（runId / requirement / stage / stopType / updatedAt / triage / 事件数），JSON 结构含 `cards` 数组
- [ ] `GET /api/run?file=<runId>.json` 返回单 run 完整事件流（含 gate 退出码 / commit sha / work-order 全文），路径白名单校验（越界 403）
- [ ] run 卡片阶段条映射与 `pipeline-run.mjs stageBar` 口径一致（复用导出函数，不另写映射）
- [ ] 看板页面新增「执行器」入口，点击显示 run 卡片列（空态显示「暂无 run」）；点击卡片展开抽屉显示事件时间线
- [ ] 新增 run 文件落盘后看板 SSE 自动刷新（`fs.watch` 监听 pipeline-runs/ 目录）
- [ ] 新增 server 纯函数测试通过（`npm test` 全绿）

## 确认与复核

- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：
- 复核：L1 不要求独立复核