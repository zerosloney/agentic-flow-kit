---
状态: closed
级别: L2
发现: 2026-10-01
模块: pipeline
备注: v0.9.0 代码审查缺陷批——①solidify-task.mjs 自动伪造 --delegated 用户原话（确认门契约破坏，Critical）②pre-push experiment→main 直推绕过 --hardening 加固门（Major）；修复走 L2 三件套
确认指纹: 6fce819e7529a265
---
# INCIDENT — v0.9.0 代码审查缺陷批（确认门伪造 + 加固门直推绕过）

## 时间线

- 2026-10-01 v0.9.0 发版后，对 `df9ed14..HEAD`（11 提交 / 90 文件）做双轴代码审查（Standards 轴 + Spec 轴，独立只读子代理并行）
- 2026-10-01 复核确认两项高危缺陷：
  - **Critical**：`templates/_agents/scripts/solidify-task.mjs:75-91` 在无任何用户交互的情况下，对每份草稿直接执行 `confirm-doc.mjs <rel> --delegated "固化 L1 任务 X：用户确认草稿无误，执行固化归档"` —— 脚本自动编造用户原话写入 `source=chat-delegated` 台账
  - **Major**：`templates/_githooks/pre-push:43-53` 的 `case "$local_ref" in experiment/*)` 命中即 `continue`，早于 `remote_ref=main` 的 `--hardening` 判定 —— `git push origin experiment/x:main` 直推绕过加固门
- 2026-10-01 用户定性：先立 incident/intent 记录这两件后走修复流程
- 2026-10-01 用户确认：incident 按此范围记档，推进 L2 修复流程（对话内原话「确认」）

## 影响面

- `.agents/scripts/solidify-task.mjs` 与 `templates/_agents/scripts/solidify-task.mjs`（双源装副本）：L1 快车道的一键固化脚本——自动代录伪造 quote 污染确认台账（审计完整性）
- `.githooks/pre-push` 与 `templates/_githooks/pre-push`：加固门覆盖缺口（转正通道漏口）
- 波及所有装户：solidify-task 随 0.9.0 已发布（`npm` 侧尚待 publish，git 侧已推送）；pre-push 随 20490ad 落地
- 本仓当前实际污染：**零**——本会话未运行过 solidify-task，台账无伪造行（可在修复前复核确认）

## 根因

1. **确认门契约只在「人机接口」处防伪造，未在「脚本调用面」设防**：confirm-doc 的 `--delegated` 信任调用方声明的 quote，脚本（尤其是官方提供的 L1 快车道脚本）以自动化方式调用该旗标即天然绕过 TTY 门——根因与 incidents/2026-09-28-batch-ledger-audit「惩罚合规、放行伪装」的教训同族：防线只堵了交互层，没堵批量执行层。上会话实现 L1 快车道时为「一键」便利，把用户确认动作隐含进脚本假想原话。
2. **推送门分支顺序错误**：experiment/* advisory 分支先于目标分支判定，advisory 的 `continue` 吞掉了 main 目标的加固门执行——「先按来源分支豁免，再按目标分支加固」的顺序把转正路径漏出。

## 为什么之前没拦住

- **审查层**：solidify-task 无测试、不在 npm test 覆盖内（`run-tests.mjs` 只跑 `*.test.mjs`）——缺陷无机器可见性；pre-push 的直推场景（experiment→main refspec）无端到端测试，既有测试只覆盖正常推 main。
- **流程层**：L1 快车道特性（2026-09-30 上会话）实现时无三件套、未过独立复核——留档断点导致确认门这类安全敏感契约的审查缺位；本会话补档时按「补档只记录不审实现」的定位，也未触发逐行审查。

## 复盘三件套（修复时补齐，缺一不可）

1. 结构性修复
   - 修复 commit：`7e6bc39`（实现：solidify 重写 + pre-push 判定重写 + 两套件 + owned 双改）+ `b1237ce`（P2-2/P2-3 收口：TTY 指引 + 索引失败独立用例）
   - 修复 ①：solidify-task.mjs 移除自动 `--delegated`——无确认来源只迁移不落账并打印 TTY/`--delegated` 双指引；`--delegated "<原话>"` quote 由调用方显式传入、原样转发；`--auto` 显式旗标（Strict 下被拒并计数失败）；失败计数 + 索引失败退出码传播；死代码清理
   - 修复 ②：pre-push 判定键从 `$local_ref` 改为 `$remote_ref` 三态分派——目标 main 必跑 `--hardening`（experiment→main 直推亦覆盖）；experiment 目标 advisory；其余全量
   - 影响环境：dev（引擎包源）+ 装户（sync 下发）
   - 是否需要新 intent：是——本次根因含「门禁缺位/无测试/无独立复核」系统性缺口（L1 快车道当年无三件套、solidify 无测试即发布），需另立 intent 补门禁缺位（防复发验证落地后按 2026-10-01 复盘流程立档）

2. 防复发验证（必须落到自动化用例，禁止只写「已人工验证」）
   - solidify-task.test.mjs：**16/16**——T1 默认不落账、T2 quote 原样（`"quote":"固化了可以"`）、T3/T7 `--auto` Strict 拒绝失败退出码、T8 索引失败传播；跑真实 confirm-doc + 真实 gen-workflow-index
   - pre-push.test.mjs：**6/6** 真仓端到端——桩 check-loop 记录 argv，断言 `experiment/x→main` 含 `--hardening`（回归漏口）、`experiment→experiment` 不含、`main→main` 含
   - 全量回归：`npm test` 全部套件通过 + `verify.mjs` 2/2 + `source-sync-check --diff` 无漂移 + `check-ledger` 对齐 + 台账 191 行零伪造 quote（独立复核实测）

3. 规范条目（必须有可追溯的落点）
   - 落点：`workflow/README.md` + `templates/workflow/README.md` 硬规则 3 增补「`--delegated` 原话仅限用户对话内明确确认的当次措辞——官方脚本/门禁不得自动代录或编造 quote」；`.agents/commands/new-task.md` + `templates/_agents/commands/new-task.md` L1 行更新固化需显式确认后带参执行
   - 引用：`7e6bc39`（README 硬规则 3 / new-task L1 行 + 脚本头注）＋ `b1237ce`（指引细化）