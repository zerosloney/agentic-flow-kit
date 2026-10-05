---
状态: open
级别: L2
发现: 2026-10-05
模块: pipeline
备注: gitOut 把 spawn 异常与「非 git 仓」合并返回 null——git 仓内瞬时探测异常静默降级（fail-open）；根治 = fail-loud + 单次重试，同名 spec/plan 配对
---
# INCIDENT — 2026-10-05 gitOut fail-open：瞬时 spawn 异常致检查 8 静默跳过

## 时间线

- 2026-10-05 01:48Z（v1.1.0 发版窗口）：CI dedfc7d（run 37252874044）ubuntu+node22 腿红 1 例——check-loop.test.mjs 场景「过程证据:无标记无关提交 → 仍拦 证据无关」合计 PASS 195 / FAIL 1；失败 detail：`exit=0`、输出仅 advisory（角色缺失 ×3），**无任何证据核验裁决**（检查 8 整体被跳过，而非判错）
- 2026-10-05 定位：`gitOut`（templates/_agents/scripts/check-loop.mjs:213-218）把 spawn 异常（`r.error`）与「非 git 仓」（status≠0）与 ok 过滤失败合并返回单一 `null`；检查 8 入口门（:720 `gitOut(['rev-parse','--git-dir']) !== null`）得 null 即静默跳过证据核验 → git 仓内瞬时 spawn 异常（runner 资源紧张 EAGAIN/EPERM 类）被降级为「非 git 仓」，fail-open
- 2026-10-05 排除业务误判：同环境后续 Release v1.1.0（run 37262932643）与 CI 34ba1b8（run 37262932728）两轮 `npm test` 全绿——单次未复现，定性 flaky；同根源旁支：:581 直连 spawnSync 的 SHA 存在性判定遇 `r.error`（status=null）会被 `status !== 0` 捕获而误判「证据伪造」（fail-closed 方向误报）
- 2026-10-05 留痕：workflow/papercuts.md 2026-10-05 行（d9096ba 双观察项收口批），含根治方向
- 2026-10-05 用户确认：按 papercuts 2026-10-05 行口径排期立单（L2 根治 incident，对话内明确）

## 影响面

- 引擎件 check-loop.mjs 全部 git 探测消费点——:161（`--show-toplevel` 根定位）、:555（证据上下文）、:720（检查 8 入口门）、:796（检查 X 入口门）：git 仓内瞬时 spawn 异常 → 静默降级「非 git 仓」→ 对应检查静默失效且 exit 0。装户 CI 门禁与本仓发版链（Release 跑 npm test）同暴露
- 测试平台：check-loop.test.mjs 196 断言跨 CI 六矩阵的稳定性；现有 fixture 全部走 git 成功路径，对探测异常零检测面
- 同根源旁支：:581 直连 spawnSync（绕过 gitOut），`r.error` 被误判「证据伪造」——方向相反（fail-closed 误报）但同属「基础设施异常与业务失败不可区分」

## 根因

- `gitOut` 三态合并：`if (r.error || r.status !== 0 || !ok(r)) return null`——基础设施异常与业务失败在返回值上不可区分，调用方只能一律按「非 git 仓」解释
- 深层原因：缺「引擎内 spawn 基础设施异常须与业务失败区分并响亮出账」的横切口径——检查 16 装户侧已确立 fail-loud 先例（取数器载入失败响亮出账、不静默），git 探测面未纳入同一口径

## 为什么之前没拦住

- 门禁：check-loop 检查 20 只查引擎脚本「有同名套件」，不查异常路径的覆盖面
- 测试：196 场景全部走 git 成功路径；无 GIT 替身 / 必败注入，spawn 异常路径零检测——防线与真实威胁形态（runner 抖动）不同构
- 规范：fail-loud 原则散见于检查 16 实现（响亮出账先例），未成文覆盖 git 探测面；无「spawn 基础设施异常不得与业务失败合并」条目

## 复盘三件套（缺一不可）

> 立单时点为前瞻计划形态；fixed/closed 时回填实际 SHA 与证据。

1. 结构性修复
   - 修复方向：方案 A（fail-loud + 单次重试，语义红线不动）——`gitOut` 对 `r.error` 响亮出账（stderr，进程级去重）并重试一次，仍异常才返回 null（调用方与 20+ 业务调用点语义零变化）；`CHECK_LOOP_GIT` env 测试注入钩子；:581 直连点同模式。详见同名 spec
   - 影响环境：dev（引擎包源 templates/ + 装副本 .agents/，经 flow-kit sync 双源同步）
   - 是否需要新 intent：
     - 否 → 理由：根因属实现缺陷（错误分类缺失），单点修复 + 防复发用例 + 规范条目可覆盖；incident 即 intent 等价物，spec/plan 同名配对承载

2. 防复发验证（必须落到自动化用例或回归清单条目，禁止只写「已人工验证」）
   - 自动化用例（计划）：templates/_agents/scripts/check-loop.test.mjs 新增场景——`CHECK_LOOP_GIT` 指向不可执行路径 → stderr 响亮出账（进程级去重恰一条）+ 降级 exit 语义不变；正常 git 路径零出账（防误报负例）
   - 稳定性验证（计划）：node:22 同环境循环 ≥50 轮 check-loop.test.mjs 无 FAIL（test 阶段记证）
   - 回归清单条目（计划）：workflow/regression-checklist.md 防复发验证节追加一行

3. 规范条目（必须有可追溯的落点）
   - 落点（计划）：check-loop.mjs gitOut 处注释互引（gitOut 与 :581 直连点、与检查 16 fail-loud 先例）；workflow/regression-checklist.md 防复发验证节追加「引擎内 spawn 基础设施异常须与业务失败区分并响亮出账」
   - 引用：修复 commit（fixed 时回填）；papercuts 2026-10-05 行（d9096ba）
