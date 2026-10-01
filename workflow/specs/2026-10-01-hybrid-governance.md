---
状态: approved
级别: L2
日期: 2026-10-01
模块: pipeline
备注: 混合治理批补档（回填）——按 20490ad 落地行为如实落档；入口 intents/2026-10-01-hybrid-governance.md
确认指纹: dcd24a1656845833
---
# SPEC — hybrid-governance（补档：四特性按落地行为落档）

> 本 spec 为**回填档**：实现已随 20490ad 落地并全量测试通过，本文按落地代码如实记录判据，不引入未落地的设计。判据锚点以 20490ad 文件与行号为准。

## 功能行为

### 1. 风险泳道（hybrid-governance-risk-lanes）

| 场景 | 落地行为 |
|------|---------|
| fill-intent 起草 | frontmatter 6 字段双写：`级别: <L>` 与 `risk_level: <L>` 同值落盘（fill-intent.mjs:41） |
| 协作道勾红线 | check-loop「红线判低」hard 拦：级别或 risk_level 任一为 L0/L1 且正文存在勾选的 `- [x]` 红线行（匹配 `(→\|$\rightarrow$)\s*级别\|级别至少 L[23]`）→ 就高升级 L2/L3 并补同名 spec（check-loop.mjs 检查 1 泳道一致性段） |
| 选道口径 | L0/L1 协作道（轻确认 + 异步审计，可 `--batch`）；L2/L3 防御道（spec 确认 → plan 确认同步门）——命令文档（new-task/plan/design/build/test）统一改口径 |
| 批量代录 | `confirm-doc <docs...> --delegated "<原话>" --batch`：逐份读级别，L2/L3 逐份拒绝；台账行 brief:true，quote 原话仍入账；batch/seq/of 一手事实记「本次调用落几份」 |
| 批量边界 | `--batch` 仅 --delegated 协作道形态；与 `--auto` 互斥（confirm-doc.mjs:125-144） |

### 2. 探索泳道（hybrid-governance-explore-hardening）

| 场景 | 落地行为 |
|------|---------|
| experiment/* 提交 | pre-commit 闭环配对门降级 advisory（报告不阻断；detached HEAD 走严格模式）；双源/台账/常驻面/敏感信息门不豁免 |
| experiment/* 推送 | pre-push 闭环扫描降级 advisory；**加固门**——推送目标为 refs/heads/main 时以 `check-loop --hardening` 运行 |
| 加固门判据 | 标记件（frontmatter `阶段: exploring` 或 `状态: exploring`）入 main 须：intent 状态 approved/done + 同名 plan 在场且 approved/done + L2/L3 另须同名 spec approved/done——任一未收口 hard 阻断（check-loop.mjs 加固门段 :1105-1141） |
| 漏标记 | experiment/* 分支暂存 intent 缺标记由 pre-commit「泳道完整性」门禁拦截（2026-10-01 drift-hardening 批增补，本批诚实边界的机器关闭）；残余暴露面仅剩绕过本地钩子的提交 |
| 起草豁免 | stage-gates：同名 intent 仍为 draft 且泳道 L0/L1（级别优先，缺失/非法回落 risk_level；**级别合法但为 L2/L3 时不回落——fail-closed 就严**）→ 放行 spec/plan 起草与确认（「先起草后确认」协作道语义）；incident 入口不豁免 |
| 探索作废 | 显式 superseded/cancelled（出列不加固） |

### 3. Trusted 自动泳道

| 场景 | 落地行为 |
|------|---------|
| 等级语义 | Strict(0, enabled=false)=AI 自治关闭，`--auto` 一律拒绝；Standard(1)=AI 可自批 L0/L1 draft→approved；Trusted(2)=可自批 approved→done（全闭环）——名称与数值双轨（trust-mode.mjs:4-14） |
| 缺文件 | trust-mode.json 读取失败回落 `{enabled:false, level:0, Strict}`——fail-closed（trust-mode.mjs:18-20） |
| 文件定位 | 本地状态文件，gitignore（不入库、无模板对应——per-repo 自主切换，克隆态恒 Strict） |
| 台账 | 免旗标放行行记 `source=ai-auto-trust-L2`；L2/L3 与 incidents 永不自动 |

### 4. L1 快车道

| 场景 | 落地行为 |
|------|---------|
| 液态草稿 | `.zcode/drafts/`（与 `.zcode/plans/`）gitignore——会话内草稿零 git 成本 |
| 一键固化 | `node .agents/scripts/solidify-task.mjs --topic "<主题>"`：迁移 + 批量确认 + 索引更新（solidify-task.mjs 头注释；落地时已修正文件名反引号笔误） |
| 口径 | new-task.md L1 行：液态草稿 → 实现 → solidify 固化；L1 极简 plan「改动面 + 验证方式」两节起步 |

## 数据流

- **提交路径**：`git commit` → pre-commit（配对门按分支选 strict/advisory → 泳道完整性门禁）→ commit-check
- **推送路径**：`git push` → pre-push（experiment/* advisory；目标 main 时 `check-loop --hardening` 加固门）
- **确认路径**：confirm-doc（TTY / --delegated / --batch / --auto×trust-mode）→ 台账 `.agents/confirmations.jsonl`（batch/seq/of/brief/source/quote）→ check-loop 检查 15 对账
- **起草路径**：fill-intent（6 字段双写 risk_level）→ fill-spec / fill-plan（经 stage-gates 起草门，含探索泳道豁免分支）→ confirm-doc 逐阶段确认门
- **CI 路径**：ci.yml 机器门复跑（hooksPath 补配 + check-loop + doctor + source-sync-check --gate + workflows-check）

## 系统改动（20490ad 落地清单，50 文件 +1878/−167）

| 组 | 文件 | 内容 |
|----|------|------|
| 门禁引擎 | check-loop.mjs / check-loop.test.mjs / check-loop-rev.test.mjs（成对） | 红线判低 + risk_level 泳道一致性 + --hardening 加固门 + 台账 batch/of 口径 |
| 确认门 | confirm-doc.mjs / confirm-doc.test.mjs（成对） | --batch 协作道批量（brief:true）+ --auto×trust-mode 免旗标 |
| 起草门 | stage-gates.mjs / fill-intent.mjs / fill-plan.mjs + 各 .test.mjs / fill-spec.test.mjs（成对） | 探索泳道起草豁免 + risk_level 双写 + 6 字段 |
| 快车道 | solidify-task.mjs（新增，成对） | 液态草稿一键固化 |
| 信任层 | trust-mode.mjs（新增，成对）+ trust-mode.json（gitignore 本地态） | 三级信任 fail-closed |
| 推送门 | templates/_githooks/pre-push + .githooks/pre-push（成对） | experiment/* advisory + main 加固门 |
| 命令文档 | new-task/plan/design/build/test.md（成对）+ modules/hosts/*/commands/wf-plan.md（5 宿主适配） | 风险泳道选道 / 快车道 / 5→6 字段口径 |
| 编排与模板 | pipeline-closing.md、workflow/intents/_TEMPLATE.md（成对） | risk_level 模板行 |
| 环境 | ci.yml（机器门步骤重排）、.gitignore（.zcode 两目录 + trust-mode.json） | |

落地收口三项（同提交）：solidify-task 文件名反引号改正（sync 收养登记）、gitignore 补齐、trust-mode.json 本地化。

## 约束遵守映射

- **双源纪律**：50 文件全部 templates/↔装副本 成对提交，solidify/trust-mode 新件经 sync 登记入台账（kit.json managed 89 份校验通过）✓
- **判据一手事实（batch-ledger-audit 判准）**：--batch 以 batch/seq/of 记写入时已知事实，不做 quote/时间戳反推 ✓
- **fail-closed**：trust 缺文件回落 Strict；stage-gates L2/L3 不回落；加固门未收口即拦 ✓
- **只增不松**：既有检查 1-18 判据未放宽（check-loop 套件全量回归绿）✓
- **装户兼容**：新字段纯增向后兼容（台账历史行不回填）；trust/快车道缺省关闭 ✓

## 风险评估（落地态已知边界）

| # | 边界 | 定性 |
|---|------|------|
| 1 | 归因歧义/豁免被蹭（协作道判低防线依赖自报红线 + drift-hardening 触达面判低补强） | 已知边界，双层防线声明于 README 与 drift-hardening spec |
| 2 | 探索标记绕过（--no-verify 绕本地钩子） | 残余暴露面 = 禁令纪律覆盖；CI 复跑不识别未标记件 |
| 3 | Trusted fail-open（level 2 时 L0/L1 免旗标） | 用户显式配置才生效；本仓 Strict；判级错误会放大（依赖判级准确） |
| 4 | 液态草稿仅 .zcode 生命周期内（跨会话依赖 solidify 及时固化） | 快车道纪律项，无机器强制 |

## 确认与复核

- 确认日期：2026-10-01（用户对话内「确认」代录，台账 source=chat-delegated）
- 复核：L2——independent-reviewer 复核本 spec 与 20490ad 落地行为一致性（防补档失真；抽样核对 ≥8 处判据锚点）
