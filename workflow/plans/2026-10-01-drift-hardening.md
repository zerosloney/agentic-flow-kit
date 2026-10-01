---
状态: done
级别: L2
模块: pipeline
确认指纹: 199536a09a8a01c4
---
# PLAN — drift-hardening

对应入口：../intents/2026-10-01-drift-hardening.md
对应 spec：../specs/2026-10-01-drift-hardening.md

## 改动方案

- `templates/_agents/scripts/check-lane-surface.mjs`（新建）：泳道完整性门禁本体，检查 A（触达面判低：暂存命中面模式 + 活跃入口分级豁免）+ 检查 B（experiment/* 分支 intent 缺 `阶段: exploring` 拦截）；头注释载判据、教训引用（batch-ledger-audit 一手事实判准 / quotepath / CRLF）与已知边界
- `templates/_agents/scripts/check-lane-surface.test.mjs`（新建）：六场景 fixture 正反例 + 平台边界用例
- `templates/_agents/lane-surfaces.txt`（新建）：L2 触达面配置模板——ERE 逐行 / `#` 注释与空行忽略 / 缺失或空 = 检查 A 跳过；含本仓默认面清单（`templates/`、`.agents/(scripts|hooks|commands|roles)/`、`.githooks/`、`bin/`、`modules/`）
- `templates/_githooks/pre-commit`（修改）：pairing 门之后接线「泳道完整性（增量）」——guard 存在性检查 + `run_gate` 调 node；装副本经 sync 下发
- `.agents/kit.json`（sync 自动登记，非手改）：3 个新 managed 文件 sha 入台账
- 根 `AGENTS.md` + `templates/AGENTS.md`（owned 对，手动双改）：「门禁与提交」pre-commit 括号枚举补「泳道完整性」
- `workflow/README.md` + `templates/workflow/README.md`（owned 对，手动双改）：探索泳道节「漏标记不被加固门覆盖」诚实边界改为「pre-commit 已拦截」口径

不动的：check-loop.mjs（含加固门）、pre-push、confirm-doc、fill-*、rule-budgets.txt。

## 任务拆解（L2/L3 必填；L1 仅多文件多步骤时用，单任务微改动删本节）

1. 脚本本体 check-lane-surface.mjs
   - 判据：临时 fixture 下七态退出码与消息符合 spec 功能行为表——S1 命中+活跃 L2 → 0；S2 命中+活跃全 L0/L1 → 1（消息含命中文件与最新 L0/L1 入口名+三选修法）；S3 命中+无活跃 → 0（advisory 一行）；S4a experiment 分支检查 A → 0（advisory）；S4b experiment 分支无标记 intent → 1、补标记 → 0；S5 配置缺失 → 静默 0；S6 非 experiment 分支 B 不触发；detached HEAD 检查 A 按 strict
   - 风险：中（判据分支多；frontmatter 解析需容忍 CRLF）
2. 测试套件 check-lane-surface.test.mjs
   - 判据：上述场景全部落用例（另含 CRLF frontmatter、quotepath 非 ASCII 路径、`_TEMPLATE.md` 排除），`npm test` 全绿且既有套件不回退
   - 风险：低
3. 配置模板 lane-surfaces.txt
   - 判据：格式注释完整 + 本仓默认面清单，被任务 1 脚本实际解析通过
   - 风险：低
4. pre-commit 接线（templates/_githooks/pre-commit）
   - 判据：guard + run_gate 接线正确；本批自身提交即实测（surface 命中 + 本 intent 活跃 L2 → 豁免放行先例）
   - 风险：中（改门禁编排本体，提交自身受影响——提交前本地直跑钩子全量自测）
5. sync 下发与台账登记
   - 判据：`node bin/flow-kit.mjs sync` 后 `source-sync-check --diff` 无缺失/漂移；kit.json managed 收录 3 新文件；`.agents/` 装副本就位（新增 managed 文件由 sync 统一登记，禁手动双写）
   - 风险：低
6. owned 双改（AGENTS.md 对 + workflow/README.md 对）
   - 判据：两对逐字一致；`rule-budget.sh --staged` 实测 AGENTS.md 不超 7680 字节；README 探索泳道节口径更新
   - 风险：低（预算余量先实测，超限先精简既有措辞）
7. 拦截实录演示（intent 验收证据用）
   - 判据：临时构造「面命中 + 仅 L0/L1 活跃入口」暂存态直跑钩子，实录 S2 阻断输出存证；演示后 `git reset` 还原，不留脏数据
   - 风险：低
8. 全量验证收口
   - 判据：`npm test` 全绿；`node bin/flow-kit.mjs doctor` 无新增告警；spec 功能行为表 ↔ 测试用例一一对应（契约对账）

## 执行顺序（L2/L3 必填；L1 单文件微改动删本节）

1 → 2（先逻辑后固化用例）→ 3 → 4（依赖 1、3）→ 5（依赖 1–4）→ 6（与 5 并行可）→ 7（依赖 5，装副本就位后）→ 8 收口。

## 验证计划

- 静态门：构建 = 无（纯 JS 脚手架包）；测试 = `npm test`（全量套件，含新 check-lane-surface.test.mjs）
- 前端 / UI：无涉及
- L2 追加：契约/规则面比对——① spec 功能行为表 ↔ 测试用例对应表逐行对账；② pre-commit 编排本地全量直跑（含本批自身提交实测豁免先例）；③ 双源与台账三查（source-sync-check / check-ledger / doctor）
- L3 追加：不适用（本批 L2）

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-10-01 用户对话内确认，原话「确认」——plan 全文与改动方案节一并过目）；done（2026-10-01 关单，随入口文档置终态；实现 e6816e5 + 复核 P1 收口 c51555e）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（改动方案节随 plan 全文一并过目确认）
- 复核：L2 独立复核已完成（2026-10-01，independent-reviewer 新上下文）——0 P0 / 3 P1 / 5 P2；P1×3 用户定性全采纳（收口 c51555e + fix-forward 留痕），P2×5 留后续；判据一致性 S1-S6 逐条核对无偏离（除 P1-3 已收口）
