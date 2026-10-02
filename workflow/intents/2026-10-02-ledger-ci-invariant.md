---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-02
模块: pipeline
备注: 三轴审查改进 2——confirmations.jsonl 提交不变量：CI 历史全扫（append-only 前缀单调 + 行级校验）+ pre-commit --staged 前置，本地伪造从「事后对质级」升为「机器可检出级」
确认指纹: e41be6b3d28907cd
---
# INTENT — ledger-ci-invariant（台账提交不变量）

## 背景与问题

2026-10-02 能力成熟度评审（34/40）定位「审计不可抵赖性」唯一扣分项：**台账无签名、本地可写**——刻意伪造 confirmations.jsonl（改行/删行/伪造指纹一致的行）只能事后对质、不可机器检出（check-loop 检查 15 只对账「文档 frontmatter ↔ 台账末行指纹」，伪造者同时改两侧即可绕过；且检查的是工作树，不校验台账自身的历史完整性）。

评审给出的改进路径：把台账变成**提交不变量**——CI 校验「行数随提交单调增 + 指缀重算」，任何对历史行的删改在服务端可见。这与「本地钩子可绕、CI 是机器门」的既有分层一致（AGENTS.md 门禁与提交节明文）。

现状盘点：台账 207+ 行、纯追加（confirm-doc appendLedger 是唯一合法写入方）、随多笔提交演进——append-only 前缀不变量在全部历史上成立（待实现时全扫验证）。

## 历史教训/防复发

- 检索结果：`incidents/2026-09-28-batch-ledger-audit.md`（台账判据要用一手事实）；`incidents/2026-10-01-v09-review-defects.md`（solidify 曾自动伪造 quote——伪造面真实存在过）；2026-10-02 三轴审查报告（审计维度 4/5 扣分依据）
- 避坑指南：
  - 不变量判据用**文件内容前缀单调**（旧内容必须是新内容的逐字节前缀）而非仅行数——行数不减仍可改写历史行内容
  - 历史全扫模式避免 CI 事件管道差异（push before/pr base 取值不稳）——直接扫该文件全部提交历史，判据更强且实现更简
  - 新引擎脚本必须带兄弟测试（检查 20 已生效）

## 目标

- 新增 `check-ledger-invariant.mjs`（双模式）：
  - **历史全扫**（CI 用）：遍历 `.agents/confirmations.jsonl` 的全部提交历史，验证每次变更都是**前缀扩展**（旧内容 ⊂ 新内容逐字节前缀；允许纯新增行，禁止删改历史行）；并对最终树做**行级校验**（ts 非降序 / fingerprint 64-hex / chat-delegated 行必有非空 quote / doc 路径形如 workflow/{intents,specs,plans,incidents}/*.md 且在树中存在）
  - **--staged 前置**（pre-commit 用）：暂存版本必须是 HEAD 版本的前缀扩展——本地提交时刻即拦「顺手重写台账」
- CI 机器门（ci.yml）接入历史全扫；pre-commit 接入 --staged（guard 存在性，装户旧副本自然跳过）
- 违例输出：指明违规提交/行、违反的不变量类型与修法指引（不裁剪历史——台账一旦进历史即不可改，误写只能追加补偿行）

## 非目标

- 不做台账签名（GPG/密钥——引入密钥管理是独立决策，另批评估）
- 不做行级「重放」检测（同 doc 同 stage 多行 = 重确认机制合法，check 15 已按末行生效）
- 不改 confirm-doc 写入逻辑与 schema（纯增量校验面）
- 不把 pre-commit --staged 设为对 .gitignore/装户无台账环境的硬依赖（无台账/无变更即静默过）

## 约束

- 双源纪律：新脚本与测试落 `templates/_agents/scripts/` + sync；ci.yml 与 pre-commit 接线同源修改
- 只增不松：纯新增校验面，零既有判据变化
- 历史不可变原则宣示：本门生效后，台账历史行的任何「修正」需求都走追加补偿行而非改写（写入规范条目）
- CI 兼容：runner 浅克隆（fetch-depth）需保证能扫全历史——ci.yml 相应配置完整克隆或对台账文件做深度取史

## 影响面

- 模块：pipeline
- 数据库：无
- （无前端页面）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）$\rightarrow$ 级别至少 L2
  - 触及面：CI 机器门清单（新增一道）+ pre-commit 门禁编排 + 台账历史不可变规范条目

> 触及任一红线即为 L2 / L3，必须立 ../specs/YYYY-MM-DD-<主题>.md 写明如何满足，方可起草 plan。

## 验收标准（可测试）

- [x] 真仓历史全扫通过：台账全部提交历史前缀单调、行级校验零违例（证据：`node .agents/scripts/check-ledger-invariant.mjs` exit 0——预检实证 90 个台账相关提交 / 现 207 行；真阳性回退注记行兼容后全绿）
- [x] 篡改注入 fixture 全部检出：删历史行 / 改历史行内容 / 非前缀改写 → 历史模式 exit 1 并指明违规提交；ts 乱序 / 伪造指纹（非 64-hex）/ chat-delegated 空 quote / doc 路径不存在 → 行级校验 exit 1（证据：check-ledger-invariant.test.mjs S2/S3/S4/S5/S6/S7/S8——真 git 仓注入，12/12 全过）
- [x] --staged 模式：暂存为 HEAD 前缀扩展 → 过；删改历史行 → 拦（证据：S9 合法过 / S10 删行拦「台账重写」；本批自身提交（0a11893 等）经真实 pre-commit --staged 路径放行即活体实证）
- [x] ci.yml 机器门含该步且克隆深度满足全扫；pre-commit 接线 guard 存在性（证据：ci.yml `fetch-depth: 0` + 机器门五道含 check-ledger-invariant；templates/_githooks/pre-commit guard + 暂存触发块；装副本 sync 一致、source-sync-check --gate exit 0）
- [x] 合法追加回归：模拟一次合法 confirm-doc 追加提交 → 历史全扫与 --staged 均放行（防误拦）（证据：S1 历史追加过 / S9 staged 过 / S12 回退注记行过）
- [x] 全量回归：npm test 全绿（含新套件，检查 20 合规）+ verify.mjs 全绿（证据：npm test「✅ 全部套件通过」；verify 2/2 全绿——2026-10-02 实录）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 hard-block。

## 确认与复核

- 确认日期：2026-10-02（用户对话内「确认」×3 代录，台账 source=chat-delegated）
- 确认人：用户（对话内明确放行即确认）
- 确认范围：ledger-ci-invariant（历史全扫 + --staged + CI/pre-commit 接线 + 不可变规范条目）
- 复核：已完成（independent-reviewer 新上下文）——0 P0 / 0 P1 / 1 P2，建议放行；P2（删除提交 `continue` 可作「删除→重加」绕基线）收口升级为**任一提交删除台账即 hard fail**（`6ad4446`）；前缀不可绕面 / 行级完备性（含回退注记行兼容）/ fixture 真实性（真 git 仓）/ 五道门接线 / 范围纪律均核实；已知边界（--follow / 克隆深度 / force-push）声明于 spec 确认节