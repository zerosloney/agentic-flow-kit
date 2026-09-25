---
状态: approved
级别: L1
日期: 2026-09-25
模块: pipeline
备注: 源自 2026-09-25 双维度审查报告改进方向第 2 条。用户对话内确认「改进方向 2」。不改 doctor / check-loop 既有检查项（沿 gate-checklist intent 同一约束），只重写工具自身的匹配机制与修三处实锤 bug。
---

# INTENT — gate-checklist 显式配对登记表（关键词匹配退役 + 三处实锤修复）

## 背景与问题
- 2026-09-25 双维度审查实测 gate-checklist.mjs 三个实锤问题：
  1. `--json` 模式引用不存在的 `.title` 字段（doctor 项实际字段为 `concept`/`msg`，gate-checklist.mjs:163-164）——实测输出 matched 条目丢 doctor 字段、gaps 条目丢 item 字段；
  2. 匹配循环 tie-breaker 死代码——`d.msg.length > best.doctor.msg.length` 中 `best.doctor` 恒 undefined（best 被赋值为 cl 项）→ 条件恒 false，永远取第一个匹配（gate-checklist.mjs:112）；
  3. 关键词别名表（KEYWORD_ALIASES 26 对）覆盖不了真实措辞——实测 18 doctor 项 vs 14 check-loop 项只匹配 2、报 28 条「缺点」，真实新漏点淹没在噪声里，工具达不到「任一处加新检查项另一处不会静默漏掉」的设立目的。
- 原 intent（2026-09-25-gate-checklist）已拍板「只报告不修复」并把首次跑发现的 8 doctor 独有 + 12 check-loop 独有记为已知漏点——这份清单正该成为登记数据而非噪声。

## 目标
- **关键词匹配退役，改为显式配对登记表（PAIRS 单源在脚本内）**：三种登记形态——直接配对（doctor §N ↔ check-loop #N，同一检查两处实现）/ 声明独有（doctor §N 装户体检面无 check-loop 对应，cl: null）/ 经 §7 覆盖（doctor §7 整体运行 check-loop，各 #N 自动流入 doctor）。已知 9 项 doctor 独有 + 12 项经 §7 + 2 项直接配对全量登记。
- **报告只剩真信号**：①断档——登记表声明的 id 在对应侧已不存在（检查项被删/改号而登记未跟）②未登记——任一侧新增 § 检查项未进登记表（新检查项没对账）。真实仓库 baseline：0 断档 / 0 未登记。
- **修三实锤**：`--json` 字段从结构化结果真实字段构造（键齐无 undefined）；死 tie-breaker 随匹配算法整体退役；check-loop 多行注释标题截断仅影响展示不影响配对（按 id 配对）。
- 命令文档同步：登记表纪律（加新检查项必须登记）替代 KEYWORD_ALIASES 契约；移除已过时的「当前已识别的真实漏点」节（内容已进登记表）；预算 ≤ 8192B。
- doctor.mjs / check-loop.sh 既有检查项零改动（解析面：doctor 节注释 `// N.` + check-loop 头部 `# N.`，均为既有稳定结构）。

## 非目标
- 不做强制同步（沿 B-b「只报告不修复」，exit 恒 0）。
- 不改 doctor / check-loop 既有检查项与运行时机；不纳入看板告警（沿原 intent 边界）。
- 不改 build.md 挂载行语义（「任一处有而另一边无」口径由「未登记」承接）。

## 约束
- 零依赖；双源纪律——包源改 `templates/_agents/`，装副本手动同步（gate-checklist 三件此前「已存在未入台账」，sync 跳过）。
- 纯函数签名兼容：`gateChecklist({ doctorSrc, checkLoopSrc, pairs })`（pairs 可注入，测试 fixture 用）。

## 影响面
- 模块：pipeline
- 数据库：无
- 前端页面：无

## 触达红线（对照 AGENTS.md）
- [ ] 规则 / 契约变更 → 否（工具内部匹配机制重写，不改 doctor / check-loop 检查项与对外契约；同前例 L1）

## 验收标准（可测试）
- [ ] 关键词匹配退役：KEYWORD_ALIASES / matchDoctorToCheckLoop / 概念聚类整体移除，改为 PAIRS 登记表 + 按 id 配对
- [ ] 断档检测 fixture 断言：登记 id 侧消失（doctor 侧 / check-loop 侧各一场景）→ 报断档
- [ ] 未登记检测 fixture 断言：两侧各新增未登记 § → 报未登记；已登记（直接配对 / 声明独有 / 经 §7）不误报
- [ ] `--json` 修复实测：JSON.parse 成功，doctorCount / checkLoopCount / pairs / broken / unregistered 键齐，条目无 undefined 丢字段（回归原 bug）
- [ ] 真实仓库 baseline：`--diff` 输出 0 断档 / 0 未登记（12 doctor 节 + 14 check-loop 项全量登记）；死 tie-breaker 路径不存在
- [ ] 命令文档双源同步更新（登记纪律 + 新留痕链接，≤ 8192B 预算过门）
- [ ] `npm test` 全绿 + `source-sync-check --diff` 0 差异 + doctor 0 FAIL

## 确认与复核
- 确认日期：2026-09-25
- 确认人：用户（对话内「改进方向 2」——审查报告改进方向第 2 条）
- 确认范围：工具匹配机制重写 + 三实锤修复 + 命令文档同步；非目标不含强制同步与 doctor/check-loop 检查项改动
- 复核：L1 不要求独立复核
