---
状态: closed
级别: L1
发现: 2026-09-25
模块: pipeline
配对: ../incidents/2026-09-25-wf-runtime.md（doctor 加 owned 漂移校验作为该 incident「未做」节跟进）
备注: 本单为 wf-runtime incident 27da05c「未做」节跟进：补全 doctor 已有台账校验的 owned 部分 + 加测试覆盖。单笔 commit 收口（fix(engine)）；首次引入用 WARN 不 FAIL 避免现有装户突然挂，用户后续如要严化为 FAIL 单独提。
---

# INCIDENT — 2026-09-25 doctor 缺 owned 漂移校验 + 无测试覆盖

## 时间线
- 2026-09-25 wf-runtime incident 27da05c 闭环，doctor 自检 0 FAIL；当时确认遗留「doctor 加 owned 漂移校验规则 + doctor.test.mjs 用例」未做（incident 备注明确为「单笔 commit 收口，doctor 加校验留后续 incident 跟进」）
- 用户对话内拍板继续处理遗留项
- 立本 incident 当入口，直接做（incident 即入口，L1 无需独立 intent）

## 影响面
- doctor 第 4 节「kit.json managed 台账」已校验 managed 文件盘面 sha（pkg root 的 src/doctor.mjs:81-103），但同份台账的 `owned` 数组未做同样校验 —— owned 文件手改或包源改了装副本未同步时 doctor 完全无感
- sync.mjs 第 124-132 行有 owned 自动刷台账机制（盘面改 → sync 自动同步 sha）—— 这掩盖了 owned 漂移信号，因为 sync 跑过就「无害」了；wf-runtime 那次根本没改装副本，所以 sync 不报错也不提醒
- 装户侧：doctor 报告齐全了但「装副本 vs 包源 owned」可见性是零

## 根因
doctor 设计时只考虑了 managed 台账校验（managed 文件由 sync 强制对齐），没考虑 owned 文件的漂移可见性需求；sync.mjs 的 owned 自动刷机制（2026-09-24 Shipyard 回流策略）进一步掩盖了 owned 漂移信号。深层原因：engine 双源纪律机制对 owned 走「项目自持 + 哈希记账不约束」（src/sync.mjs 第 124-128 行注释）—— 这条契约让 owned 漂移成了「合规但沉默」的状态。

## 为什么之前没拦住
- **门禁**：doctor 不校验 owned；check-loop 只查 frontmatter 配对 / 规则面预算 / 闭环骨架，不查 owned 漂移
- **测试**：doctor.mjs 当前无 .test.mjs 套件（templates/_agents/scripts/ 下无 doctor.test.mjs）；新增校验无测试覆盖
- **规范**：原 AGENTS.md「引擎双源纪律」段未点名 owned 文件须手动同步的特例（27da05c 已补）；但 doctor 没把这条规则机器化

## 复盘三件套（缺一不可）

1. 结构性修复（最小集）
   - 修复动作 1：src/doctor.mjs 抽 `checkOwnedDrift(target)` 独立函数（返回 `{ drift, gone, total, skipped }`），doctor 主流程在第 6.5 节之后调用，根据返回结果 add PASS/WARN（保守用 WARN 不 FAIL，避免现有装户首次跑医生突然挂；用户后续如要严化为 FAIL 单独提）
   - 修复动作 2：templates/_agents/scripts/doctor.test.mjs 新增测试套件 —— 4 场景：①owned 全对齐 → PASS；②手改装副本（盘面 sha 变）→ drift > 0；③owned 文件缺失 → gone > 0；④kit.json 无 owned 字段 → skipped
   - 修复动作 3：workflow/regression-checklist.md 防复发条目指向 doctor.test.mjs（占位，待修复完成回填用例编号）
   - 影响环境：dev（包源 + 装副本同步）
   - 是否需要新 intent：否（incident 即入口）

2. 防复发验证
   - 自动化用例：templates/_agents/scripts/doctor.test.mjs（4 场景，npm test 随跑）
   - 回归清单：workflow/regression-checklist.md「防复发验证」节新增一行指 doctor.test.mjs
   - 或回归锚点：grep 「owned 漂移」应命中 doctor.mjs 校验逻辑 + regression-checklist 条目

3. 规范条目
   - 落点 1：src/doctor.mjs 加注释「owned 漂移校验（kit.owned 盘面 sha 不一致；2026-09-25 wf-runtime 复盘）」
   - 落点 2：workflow/regression-checklist.md 防复发条目
   - 引用：本次修复 commit SHA（修复完成后回填）