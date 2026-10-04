---
状态: done
级别: L1
模块: pipeline
确认指纹: 48f8509b2dbc1f8e
---
# PLAN — board-run-panel

对应入口：../intents/2026-10-04-board-run-panel.md

## 改动方案

- `templates/_agents/scripts/workflow-board-server.mjs`（包源，sync 后 `.agents/` 装副本）：
  - 新增 `GET /api/runs`：扫 `.agents/cache/pipeline-runs/*.json`，解析每 run 为卡片（runId / requirement / stage / stopType / updatedAt / triage / 事件数），按 updatedAt 倒序
  - 新增 `GET /api/run?file=<runId>.json`：返回单 run 完整事件流（含 gate 退出码 / commit sha / work-order 全文），路径白名单（`pipeline-runs/` 内 + `.json` 后缀，越界 403）
  - 新增纯函数 `parseRunFile(text)`（解析单 run JSON + 校验必填字段）与 `stageBarOf(run)`（复用 `pipeline-run.mjs` 导出的阶段映射口径），导出供测试
  - 扩展 `fs.watch` 监听：在既有 `WORKFLOW` 监听基础上增加 `pipeline-runs/` 目录，落盘变化同样 500ms 防抖广播 `changed`
- `templates/_agents/board/index.html`（包源，sync 后装副本）：
  - 顶栏新增「执行器」切换按钮（与文档看板并列），点击显示 run 卡片列
  - run 卡片：runId / 需求 / 阶段条（`stageBarOf` 渲染 Plan/Design/Build/Test 四阶段 [✓]/[●]/[…]）+ 停机点类型徽标（work-order / await-confirm / gate-fail / done / aborted）+ 更新时间
  - 点击 run 卡片展开抽屉：新增「时间线」tab（复用既有 `.tl` 时间线样式）——事件类型色点 + 描述（gate 显示命令与退出码、commit 显示 sha、work-order 显示标题）+ 时间
  - 空态显示「暂无 run」
- `templates/_agents/scripts/workflow-board-server.test.mjs`（包源，sync 后装副本）：新增 `parseRunFile` / `stageBarOf` 纯函数用例（真实 run 文件 fixture + 空/坏 JSON）

## 约束与风险

- 约束：
  - **只读观测层**：面板只展示 pipeline-runs/ 事件流，不启动 / 不推进 / 不中止 run，不做告警判定（沿用看板「只读预警层，非门禁」定位，AGENTS.md）
  - **机器事实 vs 自报态**：只渲染 pipeline-runs/（脚本亲写 + gate 真实退出码），**不读** orchestration-runs.jsonl（宿主 AI 自报 journal）——遵循 `_TEMPLATE.md` 「journal 是自报态非验证态」口径
  - **双源纪律**：一切改动落 `templates/_agents/`，再 `node bin/flow-kit.mjs sync` 更新 `.agents/`；禁手动双写绕过台账
  - **前端 XSS 防线沿用**：run 文件内容经 `esc()` 输出，抽屉 md 渲染沿用既有剥 HTML 标签逻辑
  - **路径白名单**：`/api/run` 只读 `pipeline-runs/` 内 `.json`，resolve 后越界 403（对齐既有 `safeDocPath` 模式）
  - **不新增依赖**：server 保持 node 内置模块（node:http/fs/path）；前端不引外部库
- 风险：
  - run 文件可能被 AI/进程半写（写入原子化是临时文件+rename，但读瞬间可能 rename 前）→ `parseRunFile` 对坏 JSON 容错（跳过该文件，不 500）
  - `fs.watch` 监听两个目录可能触发重复广播 → 统一走同一 500ms 防抖（合并事件）
  - 阶段映射与 `pipeline-run.mjs stageBar` 漂移 → 复用导出的同一函数，不另写映射

## 验证计划

- 静态门：`npm test`（新增 server 纯函数测试全绿）
- 后端：`node .agents/scripts/workflow-board-server.mjs --port 8934` 手工探活 `/api/runs` 与 `/api/run?file=20261002-1819-runtime-env-md-c2ju.json`（真实 run 文件返回 200 + 完整事件流）
- UI：拉起看板 `node .agents/scripts/ensure-board.mjs --port 8934`，浏览器实测「执行器」视图（run 卡片列 + 抽屉时间线 + SSE 实时刷新）
- 双源：`node .agents/scripts/source-sync-check.mjs --diff` 0 差异；`node bin/flow-kit.mjs doctor` 0 FAIL

## 确认与复核

- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L1 不要求独立复核