---
状态: superseded
级别: L2
日期: 2026-10-09
模块: pipeline
备注: engine-quality-round2（B-D-A-E-C 五层质量提升批）
确认指纹: e367cd56a8cd2783
---
# SPEC — engine-quality-round2

## 功能行为

对装户/开发者可见的八项行为变化（S1–S8 对应 intent G-B1…G-C），其余为纯内部重构：

**S1 · sync-hosts 对账面扩展（G-B1）**
- 场景：包源仓（templates/_agents + modules/hosts 并存）跑 `flow-kit sync-hosts --diff`——除 modules/hosts/<宿主键> 外，**项目根下实际存在的 HOSTS.dir 宿主点**（如本仓 `.zcode/`）一并纳入对账；其正文与权威源不一致时报漂移，`--apply` 单向覆盖（frontmatter 保留）。
- 装户布局行为**逐字不变**（其 adaptersRoot 本就是项目根）。
- 输出自描述：`--diff`/`--apply` 头部新增「对账面：」行，列明参与比对的根及宿主（如「modules/hosts ×7 + 项目根宿主点 .zcode」）——防「N 对全对齐」式不可解释声明（bb69e19 教训）。
- 边界：项目根不存在任何 HOSTS.dir 目录时对账面不增（与今日行为一致）；`authorityMissing` 判定沿用「父目录存在才算缺失」。

**S2 · 编辑时快检入口（G-B2）**
- 场景：开发者/AI 改完常驻面文件（AGENTS.md 等）未提交时，跑 `node .agents/scripts/edit-face-check.mjs`——以 `CHECK_LOOP_ROOT=<仓库根>`（全扫模式）单源复跑 check-loop 判定（工作树内容，非 HEAD），并对常驻面文件做字节预算 advisory（LF 归一；声明「编辑时口径，提交门以 rule-budget.sh 为准」）。check-loop 有 hard/warn 或预算超限 → exit 非零。
- 边界：零复刻铁律——本脚本不实现任何门判定，只编排调用与汇总退出码。

**S3 · CI 红回溯点名（G-B3）**
- 场景：CI 机器门或测试失败时，failure 步骤解析 `confirmations.jsonl` 最近 7 天 done/closed 行，打印「最近关单文档（CI 红时复核优先）」清单。不改变 CI 通过/失败判定。

**S4 · 台账哈希链（G-D）**
- 写入侧：confirm-doc 每次追加台账行时，读台账最后一行，计算 `prevHash` = 末行 `hash`（末行无 hash 则为 `""`），`hash` = sha256(`prevHash` + 本行去掉 hash 字段后的规范化 JSON)。追加后整链连续。
- 校验侧（check-loop 15 新增子检查）：重算台账中**连续带 hash 行段**的链（prevHash 是否等于前一行 hash、hash 是否重算一致）；断裂 = **hard「台账链断裂」**（指出首个断裂行号）。无 hash 的历史行（v1.5.0 前写入）跳过不报——零回填零误报；孤立的带 hash 行（前一行无 hash）只验自身 hash 一致。
- 边界（诚实声明，写入代码注释）：整文件重写可重建完整链——不可机器防，兜底 = 台账文件自身的 git 历史（check-ledger-invariant 已扫台账 append-only 历史）；本链堵的是「就地改/删中间行」这一最高频伪造面。

**S5 · 检查 7 拆模块（G-A1）**
- `check-stage-index.mjs` 承载检查 7（阶段索引同步）：与 check-hygiene 同构——ctx 传入既有 helper（零复刻）、只返回 warnings 数组、gate-seg 段归属走局部收集器 + appendSegs、调用点保持在原输出顺序位。头部清单行逐字不动。

**S6 · exempt 停车场清理（G-A2）**
- wiki-search / verify-wiki-consistency 各补同名 `.test.mjs`（临时目录 fixture，不触真实 wiki/）；scripts-test-exempt.txt 移除这两行；ensure-board 行改「永久工具豁免」定性（需真实端口/进程环境，自动化覆盖无性价比）。

**S7 · 架构单源与缓做定性（G-E）**
- 仓库根新增 ARCHITECTURE.md：三层分发、闭环模型、门禁体系（20 检查索引）、双入口执行器、自我度量、质量底座、关键决策指针（policy 锚表 / 信任边界声明）。
- papercuts 追加两行缓做定性（MCP 化、fleet 视图）+ 一行 L2 快车道深水区（C）；CHANGELOG 记门禁 perf 缓做依据。

**S8 · 确认门合并预览纪律（G-C）**
- design.md / build.md / new-task.md 各加「三件套合并预览」节：L2/L3 起草期 AI 一次呈现三件草稿要点总览（目标/关键取舍/判据 diff），**逐件确认与逐件代录纪律不变**——只优化呈现顺序，不改机器门。stage-gates 零改动。

## 数据流

- S1：`sync-hosts` → diffHosts（多根归一：包源=[modules/hosts + 项目根宿主点×存在者]，装户=[项目根]）→ 漂移报告 / applyForward（按漂移条目自带 root 定位适配文件）。
- S2：edit-face-check → spawn check-loop（CHECK_LOOP_ROOT 注入）→ 解析 exit/输出摘要 → 预算 advisory 自算 → 汇总 exit。
- S3：CI failure → node 内联读 confirmations.jsonl → 过滤 7 天内 done/closed → stdout 清单。
- S4：confirm-doc → 读末行 → sha256 链字段 → append；check-loop 15 → 逐行重算 → 断链 hard。
- S5：check-loop 主流程 → runCheckStageIndex(ctx) → warnings 数组按序并入。

## 系统改动

| # | 文件 | 改动 |
|---|------|------|
| 1 | `src/sync-hosts.mjs` | diffHosts 多根归一（adapterRoots，向后兼容单根入参）；pairsFor 加 hostFilter；applyForward 按条目 root 定位；输出对账面行 |
| 2 | `src/sync-hosts.test.mjs` | +3 场景（项目根漂移检出 / apply 修复+frontmatter 保留 / 装户布局回归不变） |
| 3 | `templates/_agents/scripts/edit-face-check.mjs` + test | 新增（S2） |
| 4 | `.github/workflows/ci.yml` + `templates/_github/workflows/kit-ci.yml` | +failure 步骤（S3，双侧同改） |
| 5 | `templates/_agents/scripts/confirm-doc.mjs` + test | 写入侧链字段（S4） |
| 6 | `templates/_agents/scripts/check-loop.mjs` + test | 检查 15 验链子检查 + 检查 7 迁出接线（S4/S5）；头部清单行不动 |
| 7 | `templates/_agents/scripts/check-stage-index.mjs` + test | 新增（S5） |
| 8 | `templates/_agents/scripts/wiki-search.test.mjs` / `verify-wiki-consistency.test.mjs` / `scripts-test-exempt.txt` | 新增两测试 + 表更新（S6） |
| 9 | `ARCHITECTURE.md` / `workflow/papercuts.md` / `CHANGELOG.md` | 新增/追加（S7） |
| 10 | `templates/_agents/commands/{design,build,new-task}.md` | +合并预览节（S8）→ sync → sync-hosts --apply |

引擎双源纪律：3/5/6/7/8/10 改 templates/ → `flow-kit sync`；4 双侧直接改（owned）；9 仓库根直接写。

## 约束遵守映射

- **零运行时依赖**：全部 node 标准库（fs/crypto/child_process/path），无新包。
- **gate-checklist 契约**：check-loop 头部清单行逐字保留（D 的验链是检查 15 内部扩展、A1 是实现搬迁）——`gate-checklist.mjs --diff` 登记完整为 plan 判据。
- **判定零复刻**：edit-face-check 仅编排；check-stage-index 零复刻（ctx 传入 helper）。
- **向后兼容**：S1 装户布局逐字不变（测试回归钉住）；S4 无 hash 历史行跳过（测试钉住）。
- **测试不 weakening**：既有断言零改动；新增场景全部先红后绿（反证在 plan 判据）。
- **常驻面预算**：ARCHITECTURE.md 不在预算表（非常驻指令面）；commands 三文件加节后核 `.agents/commands/*.md` 单篇 8704B 与目录 65536B 预算。
- **L2 三段式闭环链**：docs approved 留痕 → 代码（分 B/D/A/E-C 组提交）→ 关单 docs。

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| S1 多根重构破坏装户既有行为 | 中 | 装户布局回归场景（既有 8 场景 + 新增 1）钉住；旧入参归一化兼容 |
| S4 链校验误报（规范化差异致重算不一致） | 中 | hash 计算用「写入时同一函数」（check-loop 复用 policy.mjs 导出，不复制实现）；测试覆盖 CRLF/字段序两个规范化面 |
| S4 引入后旧 fixture 台账（无 hash）大面积告警 | 低 | 判据只作用于连续带 hash 段；既有 234 断言全绿即证 |
| S2 CHECK_LOOP_ROOT 全扫在超大仓库慢 | 低 | 本仓规模实测秒级；脚本输出耗时供观察 |
| S3 failure 步骤读不到台账（fork 仓库无 workflow/） | 低 | 内联容错：文件缺失静默跳过 |
| S8 文档节推高 commands 预算 | 低 | 改后跑 rule-budget；超限先删再增（一进一出） |
| 回滚难度 | 低 | 按 B/D/A/E/C 分组提交，可单独 revert |

## 确认与复核

- 确认日期：2026-10-09（自治批次——授权链同 intent：用户 goal 指令放行五层方案内容）
- 复核：L2 独立复核已完成（2026-10-09，提交 9ca1675+6e96edf 后，independent-reviewer 独立上下文）——结论 P0=0、P1×1、P2×2，全部处置：P1-1 D 冒烟探针行残留实仓台账（首次内联探针崩在 appendLedger 后未还原）→ papercuts 定性 + stage=void 作废行经 appendLedger 链上追加；P2-1 验链坏行口径注释勘误 + 报文改物理行号（已修）；P2-2 faces 宿主计数改「实际生成配对>0」（已修，84 对不变）。授权链留痕完整性观察两点（放行对象出账外/同句 quote）为已声明结构性缺口。复核实测：npm test 全绿/eslint 0/登记完整/84 对 0 漂移/doctor 14 PASS。未验证：CI 远端实跑（push 后佐证）
- 复核：L2——实现完成后 test 阶段 independent-reviewer 独立复核
