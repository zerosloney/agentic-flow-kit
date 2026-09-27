---
状态: closed
级别: L1
发现: 2026-09-27
模块: pipeline
备注: audit-gate-hardening（0caaf4f）L2 独立复核提出的 P2×5 延后项，用户拍板「收掉」批量处理。P2-4（spec 偏差追认留痕）已随 cc97098 关单闭环，本单不重复；实修 4 项：P2-1 绑定复原的状态行分隔符保真 / P2-2 双源门禁两条边界文档点明 / P2-3 绑定生效锚改台账 ts / P2-5 source-sync-check.test 装副本路径直跑 FAIL。级别判 L1：均为当日落地检查项自身缺陷的修正（误伤边角 / 豁免漏洞 / 测试路径健壮性），检查项编号、契约面、消费方（gate-checklist PAIRS）零变化。修复：93399c8（立项）+ c651846（实现，14 文件）。
---

# INCIDENT — 2026-09-27 gate-hardening 复核 P2 批量收口

## 时间线
- 2026-09-27 audit-gate-hardening 实现提交 0caaf4f 后，independent-reviewer 子代理独立复核（基准 b49f8ec），判「有条件通过」：0 P0 / 0 P1 / P2×5
- 条件项（P2-4 spec 偏差追认）随关单 cc97098 由用户「可以」追认闭环
- 同日用户对话内拍板「收掉」剩余 P2×4，立本 incident 收口

## 影响面
- `templates/_agents/scripts/check-loop.mjs`（检查 15 内容绑定的复原算法与生效锚）及其测试
- `templates/_agents/scripts/source-sync-check.test.mjs`（SRC_ROOT 解析）
- `templates/_githooks/pre-commit`（双源门禁注释）、`templates/_agents/commands/build.md`（边界说明一行）
- 无运行时行为回退风险：全部为边角修正与文档点明，主路径判定不变

## 根因
三项实修分别对应复核实证的缺陷：①bindingSha256 重建状态行时恒输出规范单空格格式，与 confirm-doc 前向「按原行字面计算指纹」不对称——两跳间状态行被手工改成非规范格式（如双空格）即误伤；②绑定生效锚取文档自报日期，日期 < 生效日的文档即使晚于生效日才确认 done 也永不绑定（含本批 3 份失配存量的泛化面）；③source-sync-check.test 的 SRC_ROOT 按 `../../..` 硬编码层级解析，从装副本路径直跑 S5 baseline 必 FAIL。

## 为什么之前没拦住
- 复核（人）拦住了——本单全部条目来自 L2 独立复核的实证清单（临时目录真实双跳实验 / 路径模拟），非线上暴露；P2-1/P2-3 的触发前提（绕过 confirm-doc 手改状态行 / 旧日期文档晚关单）在主流程纪律下低频，故定级 P2 延后而非阻断
- 测试面盲区：绑定场景未覆盖非规范分隔符与「文档日期早于台账 ts」组合；测试入口假设 npm test（templates 路径），未考虑装副本直跑

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：c651846（14 文件：check-loop.mjs 复原算法 + ts 锚 + 头注释 / check-loop.test.mjs 场景重写扩至 6 条 / source-sync-check.test.mjs SRC_ROOT 探测 + S5·S9 SKIP 守卫 / pre-commit 边界注释 / build.md 边界一行；sync 5 份覆盖更新 + sync-hosts 34 对对齐）
   - 影响环境：dev（引擎包源 + 本仓装副本，未发布版本面）
   - 是否需要新 intent：
     - 否 → 理由：实现级缺陷单点修复（复原算法保真 / 生效锚收紧 / 测试路径健壮性），已有规范条目覆盖（check-loop 检查 15 与 pre-commit 双源门禁本体），无门禁缺位类系统性根因

2. 防复发验证（必须落到自动化用例或回归清单条目，禁止只写「已人工验证」）
   - 自动化用例：templates/_agents/scripts/check-loop.test.mjs 绑定场景 6 条（一致过 / 篡改拦 / ts 锚前豁免 / 日期早 ts 锚后篡改拦 / 缺 prev 降级 / 双空格分隔符不误伤）——套件 58/0；source-sync-check.test.mjs 19/0，且装副本路径（.agents/scripts/）直跑 S5/S9 实证通过（c651846 后）

3. 规范条目（必须有可追溯的落点）
   - 落点：.githooks/pre-commit 双源门禁注释（工作树比较 / 删包源退化为孤儿只报告两条边界）+ .agents/commands/build.md「改包源后必跑」节同口径一行
   - 引用：c651846（templates/_githooks/pre-commit 双源一致性段、templates/_agents/commands/build.md 边界行）
