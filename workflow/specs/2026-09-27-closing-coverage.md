---
状态: done
级别: L2
日期: 2026-09-27
模块: pipeline
备注: 同名 intent：../intents/2026-09-27-closing-coverage.md（终态确认门补全 + managed sha LF 归一）
确认指纹: 8d6753bd157d36dd
---
# SPEC — closing-coverage

## 功能行为

### A. superseded/cancelled 终态确认门（confirm-doc `--to`）

**confirm-doc.mjs**：
- 新增可选参数 `--to <superseded|cancelled>`：放弃态跳转的显式目标选择（默认行为不变——无 `--to` 时 nextStage 前向单跳）；
- 合法表：**cancelled** 自 draft/approved/open/fixed（未确认过的 open/draft 只可 cancelled——谈不上被取代）；**superseded** 自 approved/done/fixed/closed（已被确认/闭环的结论被新档取代）；
- 非法：draft→superseded、open→superseded、终态→终态中除 done/closed→superseded 外的组合（如 done→cancelled）、`--to` 值非法 → 拒绝并列合法表；
- 落态路径复用既有机制：指纹（跳转前内容）+ applyTransition + 台账行 `{stage: superseded|cancelled, prev, source, quote?}`；TTY/delegated 两形态同语义。

**check-loop.mjs 检查 15**（原位扩展）：
- 配对：superseded/cancelled 已在 confirmed 集合（docs 2026-09-27 起 / incidents 2026-09-28 起，日期门不变）——本批后这两态有了合法产生通道，缺记录照旧 hard「确认未对账」；
- 终态绑定：目标集从 {done, closed} 扩为 {done, closed, superseded, cancelled}（ts 锚 ≥ 2026-09-28 + prev 复原保分隔符 + 缺 prev 降级 warning，全同既有口径）；放弃后的文档同样不得再改，修订走新 intent。

### B. managed/adapter sha 全链路 LF 归一

统一口径：文本件读取后 `replace(/\r\n/g,'\n')` 再 sha256（与 owned 2a40afb、rule-budgets「索引字节」约定对齐）。落点五处：
1. `src/sync.mjs`：managed 三态判定的 diskSha 读取（含台账外收养分支）——ledger 记 fresh sha（renderTree 本写 LF）→ 归一后跨 checkout 稳定；
2. `src/doctor.mjs` §4：managed 盘面 vs 台账比对读取；
3. `.agents/scripts/source-sync-check.mjs`：双侧文件 sha（包源 vs 装副本，CRLF/CRLF 或 LF/LF 或混合均不误报）；
4. `src/sync-hosts.mjs` bodySha：权威源/薄适配正文段 sha（frontmatter 剥离后正文归一）；
5. `src/doctor.mjs` §6.7 adapter 校验 bodySha：同口径。

行为影响：开发机跑一次 `flow-kit sync` 重记 managed 台账（13 份 CRLF sha → LF sha，走「改动恰好等于新版」分支自愈不改盘）；此后克隆 doctor §4 0 WARN。二进制面不涉及（managed/adapter 均文本件）。

### 文案

AGENTS.md（根 + templates/AGENTS.md）确认门条款补一句 `--to` 口径；maintain.md / test.md 如有放弃态表述则对齐（无则不动）。

## 数据流

- A：confirm-doc `--to` → frontmatter 状态/指纹 + 台账行；check-loop 15 按既有三键配对 + 终态绑定复原比对。与 done/closed 全同构，仅新增 stage 值。
- B：sync 记账（LF）→ doctor §4 比对（LF）→ source-sync-check 双侧（LF）→ sync-hosts / doctor §6.7 正文段（LF）。全部只动「读取哈希」侧，不动写盘字节。

## 系统改动

| 件 | 改动 |
|---|---|
| `templates/_agents/scripts/confirm-doc.mjs` + test | `--to` 参数、合法跳转表、拒绝对话；S 系列断言 + CLI 场景 |
| `templates/_agents/scripts/check-loop.mjs` + test | 15 终态绑定集扩为四态；场景 ≥3 |
| `src/sync.mjs` / `src/doctor.mjs`（§4、§6.7） / `src/sync-hosts.mjs` / `templates/_agents/scripts/source-sync-check.mjs` + 各自 test | sha 读取 LF 归一（五处）+ CRLF 不变性场景 |
| `AGENTS.md` + `templates/AGENTS.md` | 确认门条款补 `--to` |
| 装副本 / 薄适配 | sync + sync-hosts --apply 下发 |

## 约束遵守映射

- **检查项编号不增删改号**：15 原位扩展绑定目标集；gate-checklist PAIRS 不动。
- **双源纪律**：引擎件 templates/ → sync；AGENTS.md owned 手改 + 模板侧同文。
- **既有语义不动**：默认跳转（无 --to）、delegated 记账、ts 锚、保分隔符复原均不变。
- **常驻面预算**：AGENTS.md 当前 7153/7680，增量一句控制在预算内；命令文件不增。
- **sha 归一只动读取侧**：renderTree/写盘字节不变，发布物零影响。

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 15 终态绑定扩四态后误伤存量放弃档 | 低 | ts 锚 ≥2026-09-28 门住；本仓当前无 superseded/cancelled 新档（实现时核实，若有逐一验证） |
| `--to` 误用（该 cancel 的 superseded 了） | 低 | 台账 stage/prev/quote 如实记录可对质；跳转表把「未确认态只能 cancel」定死 |
| sha 归一后 sync 误判「本地已改」刷台账 | 低 | 三态判定里 diskSha(归一) vs fresh(归一) 相等 → 走「改动恰好等于新版」自愈分支（既有语义，2a40afb owned 侧同款已验证） |
| source-sync-check 归一后掩盖真实差异 | 低 | 只归一 CRLF（\r\n→\n），内容差异照常 byte 级暴露；测试含 CRLF-等价/内容差异双场景 |
| 回滚 | 低 | 单 feat 提交 revert 即回 |

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核（independent-reviewer，diff 固定后）
