---
状态: approved
级别: L1
日期: 2026-09-25
模块: pipeline
备注: 审查报告改进方向第 2 条。L1 极简两节（改动面 + 验证方式）。
---

# PLAN — gate-checklist 显式配对登记表

## 改动面

1. **重写 `templates/_agents/scripts/gate-checklist.mjs`**：移除 KEYWORD_ALIASES / matchDoctorToCheckLoop / parseDoctorChecks 概念聚类；新增 `parseDoctorSections`（扫 `// N. 标题` 节注释，id 支持 `6.5` 小节）+ `PAIRS` 登记表（直接配对 2：§5↔#2 占位符、§6↔#11 INDEX；声明独有 9：§1/2/3/4/6.5/6.6/6.7/6.8/8；经 §7 覆盖 12：#1/3/4/5/6/7/8/9/10/12/13/14）；`gateChecklist({ doctorSrc, checkLoopSrc, pairs = PAIRS })` 返回 { doctorCount, checkLoopCount, pairs, matched, broken, unregistered, doctor, checkLoop }；`--diff` 分四段输出（对照表 / 断档 / 未登记 / 登记完整结论），exit 恒 0；`--json` 从真实字段构造。
2. **重写 `templates/_agents/scripts/gate-checklist.test.mjs`**：≥12 场景——两侧解析、三种登记形态不误报、断档×2、未登记×2、真实仓库 baseline（0 断档 0 未登记 + 计数 ≥12/≥14）、`--json` CLI spawn 冒烟（键齐无 undefined，回归原 bug）、空串不崩（pairs 注入 []）。
3. **更新 `templates/_agents/commands/gate-checklist.md`**：登记表纪律（加新 § 必须登记：配对 / 独有 / 经 §7）替代 KEYWORD_ALIASES 契约；输出示例改四段式；删「当前已识别的真实漏点」（内容进登记表）；补新 intent 留痕链接；预算内（≤ 8192B）。
4. **手动同步装副本**：`.agents/scripts/gate-checklist.mjs`、`.agents/scripts/gate-checklist.test.mjs`、`.agents/commands/gate-checklist.md`（三件已存在未入台账，sync 跳过——沿 F 环节口径手动 cp）。

## 验证方式

- `node .agents/scripts/gate-checklist.mjs --diff`：真实仓库 0 断档 / 0 未登记，输出四段式。
- `node .agents/scripts/gate-checklist.mjs --json | node -e "JSON.parse(...)"`：解析成功键齐。
- `npm test`：全绿（gate-checklist 套件重写场景全过 + 既有无回归）。
- `node .agents/scripts/source-sync-check.mjs --diff`：0 差异；`node bin/flow-kit.mjs doctor`：0 FAIL。

## 确认与复核

- 确认结果：approved（2026-09-25 用户对话内确认「改进方向 2」）
- 确认时间：2026-09-25
- 复核：L1 不要求独立复核；关单勾验见同名 intent
