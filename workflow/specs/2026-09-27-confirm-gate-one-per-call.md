---
状态: done
级别: L2
日期: 2026-09-27
模块: pipeline
备注: 同名 incident：../incidents/2026-09-27-confirm-gate-one-per-call.md（确认门 delegated 逐件化——方向已于对话内确认）
确认指纹: 090186f151a496ac
---
# SPEC — confirm-gate-one-per-call

## 功能行为

### A. confirm-doc `--delegated` 单文档强制（机器门核心）

- `--delegated` 形态下 **docs 参数多于一份即拒绝**：exit 1，错误信息指明「delegated 代录须逐件调用（build.md『逐件确认』口径）——每份文档一次调用、每次带当次用户原话」；
- TTY 形态**不变**：仍允许多文档一次传入（用户亲手运行、逐份过目全文、逐份键入「可以」——该形态天然满足逐件语义，TTY 的多文档支持是既有能力，非违规通道）；
- 拒绝发生在参数校验层（文档处理循环之前），不产生任何部分落态、不写台账。

### B. check-loop 15 扩「台账批次可审计」（warning）

- 新增子检查（15 原位扩展，编号不动）：扫台账行，凡 delegated 路径（source=chat-delegated）的合法跳转行——按「同一次逻辑确认批次」聚组（判据：ts 差 < 2s 且 quote 完全相同）——组内多于 1 份 → warning「[WARN 确认并录] <quote 摘要> 一次代录 N 份——build.md 逐件确认口径」；
- **只报存量不改判定**：并录的台账行本身仍合法（指纹配对照常过），warning 是审计可见性（让「历史上并过几批」可数），不阻断 push；
- 生效口径：全量扫描（不按日期门豁免——存量并录如实可见正是本检查的目的；今日已关单的并录会持续显示，作为审计记录而非新违规）；
- revert-draft 注记行（stage 非 approved/done）：解析时跳过，不入批次聚合。

### C. 文档口径四处（prose 对齐）

- `templates/_agents/commands/{plan,design,build,test}.md` 的确认门段：在「--delegated "<原话>"」后补「**逐件调用**（一次一份——build.md『逐件确认』口径；confirm-doc 多份并录会被拒）」；
- 根 `AGENTS.md` + `templates/AGENTS.md` 确认门条款：同义补一句（预算内，各 +~40B）。

### D. 兼容与边界

- 既有台账中的多份并录（今日产生）：B 项使其以 warning 形态可见；不重写历史台账（append-only 审计件）；
- 极端合法场景「用户一句话明确放行多份」：须拆成 N 次调用、每次 quote 同文——机器不再信任单次多份，宁可多跑一次；
- check-loop 15 的既有配对/绑定判定零改动（B 是纯新增子检查）。

## 数据流

- A：CLI argv → --delegated 分支参数校验（docs.length > 1 → 拒）→ 既有单文档落态路径。
- B：check-loop 读台账 → 过滤 delegated 合法行 → 按 (quote, ts±2s) 聚组 → 组大小 > 1 → warning。

## 系统改动

| 件 | 改动 |
|---|---|
| `templates/_agents/scripts/confirm-doc.mjs` | delegated 单文档强制（参数校验层）+ 头注释 |
| `templates/_agents/scripts/confirm-doc.test.mjs` | 新增：delegated 双文档拒绝（exit 1 + 提示 + 无台账写入）；单文档 delegated 照常（既有 S11 回归） |
| `templates/_agents/scripts/check-loop.mjs` | 15 新增并录批次 warning 子检查 + 头注释口径 |
| `templates/_agents/scripts/check-loop.test.mjs` | 新增：同 quote 双份 2s 内 → warning；不同 quote → 不报；间隔 > 2s → 不报；revert 行不参与 |
| `templates/_agents/commands/{plan,design,build,test}.md` + AGENTS.md ×2 | 逐件口径句 |
| 装副本 | sync 下发（sync-hosts 不涉——commands 正文改了要 --apply） |

## 约束遵守映射

- **检查项编号不增删改号**：15 原位扩子检查；gate-checklist PAIRS 不动。
- **TTY 形态零变化**：多文档 TTY 支持保留（其语义本就逐件）。
- **台账 append-only**：不重写历史并录行；revert-draft 注记行是既有实践的延续。
- **双源纪律**：引擎件 templates/ → sync + sync-hosts --apply（commands 正文）。
- **常驻面预算**：AGENTS.md 现 ~7.4KB/7680，+80B 内；四命令文件各 +~60B（单文件 8192 内）。

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| AI 为绕过单文档限制伪造「不同 quote」多次调用 | 中 | quote 须为用户原话——伪造原话已是 confirm-gate 既有的不可机器防线（本地信任边界）；B 的聚组按 quote 相同判，异 quote 并录不可见属已知边界（诚实声明） |
| 存量并录 warning 长期挂告警列表 | 低 | 这是审计可见性而非待修项——check-loop advisory 列表本就含存量项（确认态缺失 ×6 先例）；README 审计边界不另声明（15 头注释承载） |
| 批次判据 ts±2s 过紧/过松 | 低 | warning 级不阻断；2s 覆盖脚本连跑的典型间隔（今日实测同批 <1s），人工分次自然超阈 |
| 回滚 | 低 | 单 feat 提交 revert 即回 |

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核（independent-reviewer，diff 固定后）
