---
状态: open
级别: L1
发现: 2026-09-25
模块: pipeline
配对: ../incidents/2026-09-25-doctor-owned-drift.md（首次引入用 WARN；本单为严化升级 FAIL）
备注: 本单为 doctor-owned-drift 7ccc7b9「未做」节跟进：把 owned 漂移 WARN 升级 FAIL。首次引入保守用 WARN 避免现有装户首次跑 doctor 突然挂；现在用户拍板严化（installed 装户已吃过一次警告，知道要手动同步）。规则严度参数变更非规则语义变更 → L1；incident 即入口，不另立 intent；spec 略（L1 可省）。
---

# INCIDENT — 2026-09-25 doctor owned 漂移 WARN 升级 FAIL

## 时间线
- 2026-09-25 doctor-owned-drift 7ccc7b9 commit 首次引入 owned 漂移校验，保守用 WARN（incident 备注键明记「首次引入用 WARN 不 FAIL，避免现有装户首次跑 doctor 突然挂」）
- 用户对话内拍板严化：「doctor owned 漂移 WARN 升级 FAIL」
- 立本 incident 当入口，直接做（incident 即入口，L1 无需独立 intent）

## 影响面
- src/doctor.mjs 第 6.6 节输出级别 WARN → FAIL：drift 与 gone 都升级
- doctor 主流程 results 中出现 FAIL → process.exit(1)，pre-commit 链路未受影响（pre-commit 不调 doctor，只调 check-loop.sh / commit-check.cjs）
- 现有装户：已吃过一次 WARN 警告的装户现在必须修复（手动同步装副本 + sync 刷台账）才能让 doctor 复绿；这是用户拍板接受的
- 现有规则不变：仅严度参数升级（drift 检测逻辑、owned 列表读取路径均沿用 7ccc7b9）

## 根因
7ccc7b9 首次引入 owned 漂移校验时为最小化误伤选 WARN；用户拍板后严化为 FAIL 让规则强约束生效——这是「规则严度参数化」的正常推进路径，不是规则设计缺陷。

## 为什么之前没拦住
- N/A（这是参数化升级，非事故）

## 复盘三件套（缺一不可）

1. 结构性修复（最小集）
   - 修复动作 1：src/doctor.mjs 第 6.6 节输出级别 WARN → FAIL（drift 与 gone 两行均升）
   - 修复动作 2：templates/_agents/scripts/doctor.test.mjs 新增场景 8 —— spawnSync 跑本仓库 doctor（cwd=仓库根）抓 stdout 断言「❌」出现 OR（fixture 路径验证 FAIL 字符串）；保守用 grep 断言 doctor 主流程输出含「❌」+「owned 漂移」前缀
   - 修复动作 3：workflow/regression-checklist.md「防复发验证」节第 8 条更新文案——明确 WARN→FAIL 是规则严度，doctor 主流程字符串含「❌」前缀即视为严化生效
   - 影响环境：dev（包源 + 装副本同步）
   - 是否需要新 intent：否（incident 即入口）

2. 防复发验证
   - 自动化用例：templates/_agents/scripts/doctor.test.mjs 场景 8（npm test 随跑）
   - 回归清单：workflow/regression-checklist.md 防复发条目更新文案

3. 规范条目
   - 落点：src/doctor.mjs 第 6.6 节注释更新「WARN 首次引入 / FAIL 严化（2026-09-25 doctor-owned-drift-strict）」
   - 引用：本次修复 commit SHA（修复完成后回填）