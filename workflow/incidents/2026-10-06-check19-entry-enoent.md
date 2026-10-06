---
状态: closed
级别: L1
发现: 2026-10-06
模块: pipeline
备注: fail-loud fs 读 × 检查 19 判据 B「读空判级」惯用法无守卫——incident 闭环主题每次推送出账 12 条 ENOENT 噪声；判定面不变，修 existsSync 守卫
确认指纹: e0af1696e26ffeea
---
# INCIDENT — 2026-10-06 check19-entry-enoent

## 时间线
- 2026-10-06 推送 v1.1.5：pre-push check-loop stderr 出现 12 条「文档读取异常 *.md（ENOENT）——按空文档降级，检查面可能收窄」（pre-push 两段式输出 ×2 成对）
- 2026-10-06 定位：fs monkey-patch 抓栈复现——12 条全部命中 check-loop.mjs 检查 19 判据 B 入口 intent 读取（`fmGet(workflow/intents/<主题>.md)` 无 existsSync 守卫）；12 个主题均为 incident 闭环（L2 incident 为入口，按闭环约定无同名 intent）
- 2026-10-06 修复方案过目：入口读取加 existsSync 守卫（同文件 entryConfirmed19 与 spec 读取两处先例），缺文件仍不豁免顺序判定——判定面不变，只消诊断噪声
- 2026-10-06 实现期扩大：新增测试场景裸 fixture 实证揪出**同类潜伏点**两处——检查 5 `textOf` 助手（AGENTS.md 读空）与检查 6（AGENTS.md / new-task.md 读空，实仓恒存在故从未触发）；同根因同文件一并守卫，测试断言升级为「裸 fixture 全程无 ENOENT 出账」整类钉住
- 用户确认：修复方案过目通过（2026-10-06）

## 影响面
- 门禁诊断输出：每次 push 固定 12 条 stderr 噪声（fail-loud 出账），淹没真异常信号；检查 19 判定行为不受影响（缺文件 → 级别空 → 不豁免，顺序判定照跑）

## 根因
检查 19 判据 B 对台账主题无条件 fmGet 读入口 intent 取「级别」，而 incident 闭环主题不存在同名 intent——「读空判级」惯用法依赖 fs 读取静默失败；2026-10-05-gitout-fail-open 把 fs 读取改 fail-loud 后，该惯用法每次响亮出账。
（深层：fail-loud 改造只盘点了「文件存在但瞬时读取失败」，未盘点「路径本就不存在」的合法调用点——同一惯用法在检查 5 textOf / 检查 6 还有两处潜伏，实仓因 AGENTS.md 恒存在而未触发。）

## 为什么之前没拦住
- 测试：fixture 场景均有同名 intent 文件（或 policy v1 整体跳过检查 19），「台账有行、入口缺件」形态零覆盖
- 门禁：ENOENT 出账是 warning 级 stderr，不阻断任何门——噪声类缺陷天然无硬门可拦
- 规范：fail-loud 改造（gitout-fail-open，L2 三件套）复核未扫「读空判级」惯用法调用点

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：f8514a5（templates/_agents/scripts/check-loop.mjs 三处守卫 + check-loop.test.mjs 新场景；.agents/scripts/ 装回两件 + package.json/kit.json 1.1.7 + CHANGELOG）
   - 影响环境：kit 仓自身 + 装户（templates 包源随 1.1.7 发布）
   - 是否需要新 intent：
     - 否 → 理由：实现 bug 单点修复（守卫 + 测试场景），无门禁缺位/系统性问题

2. 防复发验证（必须落到自动化用例或回归清单条目，禁止只写「已人工验证」）
   - 自动化用例：templates/_agents/scripts/check-loop.test.mjs（新增场景：台账有 approved 行 + 入口 intent 缺件 → 裸 fixture 全程无 ENOENT 出账；顺序倒置照报「审批顺序倒置」——守卫不放松判定。红→绿实证：修复撤下场景红，三处守卫齐 211/0 全绿）

3. 规范条目（必须有可追溯的落点）
   - 落点：templates/_agents/scripts/check-loop.mjs（判据 B 读取点 + 检查 5 textOf 助手 + 检查 6，三处守卫注释互引 incident）
   - 引用：commit f8514a5
