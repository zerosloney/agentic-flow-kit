---
状态: done
级别: L1
日期: 2026-09-25
模块: pipeline
备注: L1（新增 gate-checklist 工具脚本 + 套件 + 双源同步；不改 doctor / check-loop 既有检查项；不替代两者的运行）
---
# INTENT — 三处口径一致性检查（gate-checklist.mjs）

<!-- 复制本模板为 YYYY-MM-DD-<主题>.md 后填写；plans/ 下同名文件与本文件配对 -->
<!-- frontmatter 受限子集（2026-09-13）：每行 `键: 值`；状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行 -->

## 背景与问题

- doctor 8+ 检查项（`src/doctor.mjs` §1-7.x：Node 版本 / 目录布局 / hooksPath / kit.json / 占位符 / workflow/INDEX.md / delegations / owned §6.6 / 跨宿主薄适配 §6.7 / check-loop 干净）
- check-loop 13 检查项（`.agents/scripts/check-loop.sh`：配对断裂 / 占位符残留 / incidents 复盘三件套 / 引用有效性 / 状态字段 / Adapter 一致性 / 阶段索引同步 / 验收对账 / 文件名 kebab-case / 级别 vs 迁移 / INDEX 漂移 / frontmatter 模块合法性 / 常驻面体积预算）
- 两处口径必须一致，缺一处就漏——但目前**没有工具断言两边同步**：
  - 任何一处加新检查项，另一处不会自动同步（依赖人脑记忆）
  - 两次 incident 同源根因：`2026-09-25-wf-runtime`（owned 漂移 doctor §6.6 严化为 FAIL，check-loop 无对应检查） + `2026-09-25-wf-run-review-fixes`（doctor / check-loop / 看板三处口径分叉）
- 看板（`wiki/知识沉淀总览.html`）只展示 workflow/INDEX.md 活跃/档案计数，不做告警判定——本次不纳入

## 目标

- 新增 `.agents/scripts/gate-checklist.mjs`：扫 doctor §检查项 + check-loop §检查项 → 输出对照表 + 缺点告警
- 新增套件：断言 doctor 至少 7 项检查、check-loop 至少 11 项检查；任一处有而另一边无 → 报告缺点
- 新增 `.agents/commands/gate-checklist.md` 阶段命令描述（包源 + 装副本双写）
- 嵌入 build.md "改完后" 段：加一行"跑 `node .agents/scripts/gate-checklist.mjs --diff` 看两处口径是否一致"
- 双源纪律（按 wf-runtime 复盘手动同步装副本）
- L1（新增工具不修改 doctor / check-loop 既有检查项，不修改契约）

## 非目标

- 不改 doctor / check-loop 既有检查项（首次跑可能发现缺点但本 intent 不强修，留作 follow-up）
- 不做强制同步（gate-checklist 只报告，不自动改）
- 不替代 doctor 或 check-loop（两者继续独立运行）
- 不纳入看板告警覆盖（看板当前无告警规则，扩展超出本次范围）
- 不改 doctor / check-loop 调用顺序或执行时机

## 约束

- **零依赖**：仅 `node:fs` / `node:path`，不引第三方
- **L1 立项**：新增工具不修改 doctor / check-loop 既有检查项；新装户装时随 templates/ 落 managed 台账
- **双源纪律**：包源 `templates/_agents/scripts/gate-checklist.mjs` + 装副本 `.agents/scripts/gate-checklist.mjs` 双写；按 wf-runtime 复盘手动同步装副本
- **常驻面体积预算**：`.agents/commands/gate-checklist.md` ≤ 6KB
- **不修改既有契约**（state / level / module / note 4 字段；新增文件不引入新字段）

## 影响面

- 模块：pipeline
- 数据库：无
- 新增/修改文件：
  - `templates/_agents/scripts/gate-checklist.mjs`（包源）
  - `templates/_agents/scripts/gate-checklist.test.mjs`（包源）
  - `.agents/scripts/gate-checklist.mjs`（装副本）
  - `.agents/scripts/gate-checklist.test.mjs`（装副本）
  - `templates/_agents/commands/gate-checklist.md`（包源）
  - `.agents/commands/gate-checklist.md`（装副本）
  - `.agents/commands/build.md`（加挂载点；包源 + 装副本）
  - `templates/_agents/commands/build.md`（同步）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3

> 本 intent 不触及上述任一红线——新增工具不修改既有契约字段；doctor / check-loop 既有检查项不变。故 L1 立项，不立 spec。

## 验收标准（可测试）

- [x] `node .agents/scripts/gate-checklist.mjs --diff` 输出 doctor ↔ check-loop 对照表：行数（doctor §检查项）+ 列数（check-loop §检查项）+ 匹配条目 + 缺点告警
（证据：commit pending；端到端实测输出含 10 doctor + 14 check-loop + 1 匹配 + 22 缺点；JSON 模式可解析）
- [x] 工具能识别 doctor § 检查项标题（如「目录布局」「owned 漂移」「跨宿主薄适配」）
（证据：gate-checklist.test.mjs S1-S5 PASS 5 项；聚类算法按"概念词 + 优先级最高 level"合并 PASS/WARN/FAIL 分支）
- [x] 工具能识别 check-loop § 检查项编号（#1-#13）
（证据：gate-checklist.test.mjs S2 PASS；正则 `^\s*#\s*\d+\.\s+(.+?)(?:\s*\[(hard-block|warning|advisory)\])?\s*$/gm` 提取编号与严重度）
- [x] 套件断言：doctor 至少 7 项检查、check-loop 至少 11 项检查、套件全绿
（证据：S7 PASS「实际仓库 doctor §检查项 ≥ 7」实测 10；S8 PASS「check-loop §检查项 ≥ 11」实测 14；套件总 10/10 PASS）
- [x] 双源纪律（包源 + 装副本 4 份 + 2 份命令文件双写）
（证据：templates/_agents/scripts/gate-checklist.mjs + .agents/scripts/gate-checklist.mjs 同 6351B；test.mjs 双写 5711B；commands/gate-checklist.md 双写 4061B）
- [x] `npm test` 全绿（既 170 + 新套件 PASS）
（证据：本回合实测 8 套件 180/180 PASS）
- [x] `flow-kit doctor` 10 PASS / 0 WARN / 0 FAIL
（证据：本回合实测 doctor 报「10 PASS / 0 WARN / 0 FAIL」）
- [x] build.md 加一行挂载点：`flow-kit gate-checklist --diff` 跑两处口径一致性
（证据：grep "gate-checklist" 命中 .agents/commands/build.md 与 templates/_agents/commands/build.md 双写段「改 doctor / check-loop 后必跑」）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 实测输出>）`。

## 确认与复核

- 确认日期：2026-09-25
- 确认人：用户（对话内一句"按这个走"即确认；用户对 4 个关键决策点拍板默认）
- 确认范围：intent 整体 + 4 个关键决策点拍板：
  1. **L1 立项**（不改 doctor / check-loop 既有检查项）
  2. **只报告不修复**（gate-checklist 报告缺点，修复留 follow-up）
  3. **不纳入看板告警**（看板当前无告警规则，扩展超出范围）
  4. **零依赖**（与既有 .agents/scripts/ 风格一致）
- 关单 commit：(pending —— 5 段改动面 + 8 条验收全勾验)
- 复核：L1 不要求独立复核