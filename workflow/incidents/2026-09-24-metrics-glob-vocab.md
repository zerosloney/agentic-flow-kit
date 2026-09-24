---
状态: fixed
级别: L1
发现: 2026-09-24
模块: pipeline
备注: P4 清账单（2026-09-24-p4-sweep）唯一有意跳过项的收口；顺手在探针中实证了旧口径的放宽行为。落库当日 check-loop 套件出现过 1 次瞬时 FAIL（场景 25，复跑 4 次全绿）——Windows/AV 文件锁时序类环境抖动，非代码缺陷，不作处理仅记录。
---
# INCIDENT — gen-workflow-metrics 预算表 glob 解析出词表：单星后缀匹配放宽误吃文件

## 时间线
- 2026-09-24：P4 清账时判定该条「影响极小、与 rule-budget 解析口径耦合」暂缓；用户点名收口 → 同日修复 + 场景 4 回归固化 + 落库

## 影响面
- 仅 gen-workflow-metrics（月度快照，非门禁）：预算表含 `前缀*.后缀`（如 `pl*.md`）或无斜杠单星（如 `a*b`）条目时，计量按「首个 * 之后的后缀 endswith」放宽——目录内所有同后缀文件被吃进合计与单篇峰值，快照数字虚高；多 `*` / 目录段 `*` 行为未定义

## 根因
快照脚本自实现 mini-glob 时只取「首个 * 的后缀」，丢弃了基名前缀，且不校验 `*` 数量与位置——预算表词表（`<路径或 glob>`，glob=基名内单个 `*`）从未在解析侧被约束。

## 为什么之前没拦住
- 实际在用的预算表只有 `.agents/commands/*.md`（前缀恰为空）——恰好落在正确行为上；fixture 测试同构，未覆盖非空前缀与词表外形态

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：6a16a0a（改动清单见 ../plans/2026-09-24-metrics-glob-vocab.md；装副本经 flow-kit sync 落地）
   - 影响环境：dev（快照报表口径修复，不触门禁——rule-budget.sh 走 shell glob，本就无此缺陷）
   - 是否需要新 intent：
     - 否 → 理由：根因属实现缺陷（mini-glob 解析不完整），单点修复 + 词表校验已闭环；无规范缺位（词表约定本就如此）

2. 防复发验证（必须落到自动化用例或回归清单条目，禁止只写「已人工验证」）
   - 自动化用例：gen-workflow-metrics.test.mjs 场景 4（单 `*` 前缀+后缀匹配只吃 plan.md 不吃 zeta.md / 多 `*` 与目录段 `*` 警告跳过 / 合计随之正确）
   - 回归清单条目：workflow/regression-checklist.md（防复发验证节已追加）

3. 规范条目（必须有可追溯的落点）
   - 落点：workflow/regression-checklist.md §防复发验证（自实现 mini 解析器必须校验词表边界，出表警告跳过而非放宽匹配）
   - 引用：本 incident + ../plans/2026-09-24-metrics-glob-vocab.md；commit 6a16a0a
