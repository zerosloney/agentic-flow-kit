---
状态: approved
级别: L2
日期: 2026-09-30
模块: pipeline
备注: 来源：stage-gate-machine 关单后「确认态缺失」×2 复盘（对话 2026-09-30）——把「approved 态须已进 git 历史」从事后审计升级为 done 前置硬门
确认指纹: 93a841478b30f8d8
---
# INTENT — confirm-gate-approved-history

<!-- 复制本模板为 YYYY-MM-DD-<主题>.md 后填写；plans/ 下同名文件与本文件配对 -->
<!-- frontmatter 受限子集（2026-09-13）：每行 键: 值；状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行 -->

## 背景与问题

**问题现场**：stage-gate-machine 关单后，check14 报「确认态缺失」×2——其 spec / plan 在 git 历史中从未出现行首「状态: approved」（首次提交即 done 态，cb6cd5d）。

**根因链（2026-09-30 复盘）**：
1. 直接原因：三件套 approved → done 期间从未提交，提交被推迟到关单之后一次性完成——顺序错误（正确顺序：approved 态先提交留痕 → 关单 → 提交其余）。
2. 规则存在但无机器强制：AGENTS.md「确认（approved）后立即 `docs(*)` 单独提交留痕」是文字纪律，被违反不拦。
3. 唯一的机器检查是事后审计：check14 只读 git 历史，最早在提交之后才能发现——发现即定局（历史不可改，禁 force push）。
4. 可拦截窗口被浪费：文档处于 approved 态、尚未 done 的时段，机器完全不发声。
5. 同一坑第二次踩：adopter-derivers（2026-09-28）同型先例（两跳同批提交），当时只做「残余 + papercuts」定性、未机制化 → 复发。

**结论**：拦截点应设在 confirm-doc 的「→done」跳转——那是「approved 态还在工作区」的最后一刻。

## 目标

- G1a（主门）：confirm-doc 对「→done」跳转加前置校验——git 历史中须出现过该文档的「状态: approved」行；不满足 → 拒绝落账（非零退出、台账零新增、状态不变）+ 回退指引（先提交 approved 态后重试）；满足 → 正常 done。
- G1b（范围与形态）：覆盖三件套（intent / spec / plan——均走两跳确认）；TTY 与 --delegated 两形态均执行该校验。
- G2（边界）：无 git / 非 git 仓库环境沿 check14 同款口径跳过（语义明确、不误拦）；draft→approved 跳转及其他确认跳转不受影响。
- G3（文档）：test.md 关单清单写明正确顺序（先提交 approved 态 → 关单 → 提交其余）；相关命令文档同步；sync-hosts --diff 0 漂移。
- G4（零回归）：confirm-doc 既有场景不回归；新增双向场景（满足放行 / 不满足拒绝 / 无 git 跳过）全绿；npm test + 四门全绿。

## 非目标

- 不改 check14（保持 advisory 事后审计，与前置硬门形成双保险）。
- 不回溯、不修改历史（存量 3 条「确认态缺失」告警——adopter-derivers + stage-gate-machine ×2——保留为机制落地前存量）。
- 不做自动提交：门只拒绝并给出指引，不代用户提交。
- 不动 draft→approved / fixed→closed 等既有跳转语义；不改 source/quote、并录审计语义。

## 约束

- 判据单源：git 历史判定逻辑与 check14 复用 / 同源，不造第二份实现在两处漂移（沿 2026-09-30 复核 N3 教训）。
- 复用 confirm-doc 既有前置校验模式（stage-gate 引入的同款哲学：拒绝 + 回退指引 + 零落账、零状态变化）。
- 双源纪律：改 templates/_agents/ 包源 → sync 刷装副本；测试双源同跑。

## 影响面

- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（确认门判据 / 阶段命令流程）→ 级别至少 L2

> 触及任一红线即为 L2 / L3，必须立 ../specs/YYYY-MM-DD-<主题>.md 写明如何满足，方可起草 plan。

## 验收标准（可测试）

- [ ] G1a：confirm-doc「→done」前置校验双向——历史含 approved 行 → 放行落账；历史不含 → 拒（exit 非零 + 台账零新增 + 状态不变 + 提示先提交）。confirm-doc.test.mjs 双向场景。
- [ ] G1b：三件套范围（intent / spec / plan）+ TTY / --delegated 两形态同校验。测试覆盖。
- [ ] G2：无 git 环境跳过、draft→approved 不受影响。测试覆盖。
- [ ] G3：test.md 顺序写明；sync-hosts --diff 0 漂移、source-sync-check --gate 0 差异。
- [ ] G4：npm test 全量 + doctor + check-loop / 四门全绿；confirm-doc 既有场景零回归。

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 warning。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内一句"可以"即确认）
- 确认范围：
- 复核：L2 推荐独立复核（独立上下文执行；结论回填本节）
