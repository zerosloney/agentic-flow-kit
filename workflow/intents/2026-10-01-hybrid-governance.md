---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-01
模块: pipeline
备注: 混合治理批补档（回填）——实现已落地（20490ad 为主；pre-commit advisory / kit.json 台账 / owned 规则文本经 e6816e5 捆带先行入树，用户授权免档直提），本批补三件套作如实记录；drift-hardening intent 关单留痕所指「须补三件套」由此件兑现
确认指纹: bd16542074fbc2c4
---
# INTENT — hybrid-governance

## 背景与问题

上一会话（2026-09-30）实现「混合治理」四特性：46 个 tracked 修改 + 4 新增（scripts/commands/hooks/模板面成对；ci.yml、.gitignore、modules/hosts×5、kit.json 为单侧），实现完成、测试全绿，但三件套从未落盘。2026-10-01 drift-hardening 批独立复核 P1-1 揭示其存在（整文件暂存捆带事件），用户随后授权**免档直接提交**（20490ad，50 文件；提交信息明记授权；pre-commit advisory / kit.json 台账登记 / 四份 owned 规则文本则经 e6816e5 捆带先行入树——落地归属注记见同名 spec 前言），落地瑕疵同步收口（solidify-task 文件名反引号笔误改正、gitignore 补 `.zcode/plans/` 与 `trust-mode.json`），fresh-clone 终验全绿（check-ledger 归零，kit.json 预 landing 自愈）。

本批为**补档回填单**：实现与验证均已完成，缺的只是档。补齐三件套使闭环记录完整——这是 drift-hardening 关单留痕「该批须补三件套」的兑现件，也堵住「已落地特性无档可考」的检索断点。

四特性（按 20490ad 落地内容，均标 2026-09-30 hybrid-governance-*）：

1. **风险泳道（risk-lanes）**：intent frontmatter 增 `risk_level`（=级别，fill-intent 双写）；L0/L1 协作道（异步审计）vs L2/L3 防御道（同步确认门）选道口径；check-loop「红线判低」hard 拦；confirm-doc `--batch`（L0/L1 批量代录，台账 brief:true，batch/seq/of 一手事实）。
2. **探索泳道（explore-hardening）**：experiment/* 分支闭环门禁降 advisory（pre-commit 配对 / pre-push 闭环扫描）；intent `阶段: exploring` 标记；加固门——pre-push 对 refs/heads/main 以 `check-loop --hardening` 运行（转正须收口，未收口 hard 阻断）；stage-gates 起草门泳道豁免（L0/L1 draft intent「先起草后确认」；级别优先、缺失回落 risk_level、L2/L3 不回落 fail-closed）。
3. **Trusted 自动泳道**：trust-mode.json（本地状态文件，gitignore；缺文件 fail-closed 回落 Strict）三级 Strict(0)/Standard(1)/Trusted(2)；confirm-doc 非交互免旗标放行（level 2 时 L0/L1 单份 source=ai-auto-trust-L2）；L2/L3 与 incidents 永不自动。
4. **L1 快车道**：液态草稿（`.zcode/drafts/`）+ `solidify-task.mjs` 一键固化（迁移 + 批量确认 + 索引更新）。

## 历史教训/防复发

- 检索结果：`workflow/incidents/2026-09-28-batch-ledger-audit.md`（batch/seq/of 一手事实判据——本批 --batch 的产物与前置）；`workflow/incidents/2026-09-25-wf-runtime.md`（双源纪律）；drift-hardening 批复核 P1-1（整文件暂存捆带）
- 避坑指南：
  - 补档只如实记录已落地行为，**不趁机调整任何判据**（实现已提交，档与代码的偏差就是新的漂移）
  - 跨会话批次的教训：实现完成 ≠ 闭环完成——留档断点会让后续会话把在田改动误判为可捆带内容（本批 P1-1 的直接起因）

## 目标

- 三件套补齐并逐件确认落账（approved 态进 git 历史后方可 done）
- spec 按落地行为如实落档四特性判据（供后续检索与独立复核口径引用）
- plan 记录落地清单与已执行的收口项（反引号改名 / gitignore / trust-mode 本地化），勾验证据引用 20490ad 与 fresh-clone 实录

## 非目标

- 不改四特性判据与行为（只补档；发现行为缺陷另立 incident）
- 不重跑已完成的落地动作（20490ad 已含收口项）
- drift-hardening 批复核 P2×5（留后续，与其关单记录一致）
- trust-mode 提级（本仓维持 Strict）

## 约束

- 补档文档与 20490ad 落地内容逐条对齐，偏差即缺陷
- 本批自身走全 L2 门（三件套 + 逐件确认）——补档不再免档，授权直提仅适用于那次已发生的提交

## 影响面

- 模块：pipeline
- 数据库：无
- （无前端页面）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）$\rightarrow$ 级别至少 L2
  - 触及面：所补档的四特性本身即规则/契约面（frontmatter 协议字段 / 门禁判据 / pre-push 行为 / 确认门扩展）——档须如实承载 L2 级内容

> 触及任一红线即为 L2 / L3，必须立 ../specs/YYYY-MM-DD-<主题>.md 写明如何满足，方可起草 plan。

## 验收标准（可测试）

- [x] 三件套逐件确认落账（draft→approved→done，approved 态先进 git 历史后 done）（证据：approved 指纹 fe798caba773a625 / dcd24a1656845833 / 809f4ad1a38addd7；approved 态随补档提交 ddd6a07 进 git 历史，done 于其后落账）
- [x] spec 四特性判据与 20490ad 落地代码逐条对齐（抽样核对点 ≥8 处，含红线判低触发条件 / 加固门收口判据 / trust 三级语义 / solidify 用法）（证据：独立复核报告 A 节——实际核 12 锚点全部一致；唯一偏差 P1 归属口径已随关单编辑收口，判据本身零偏差）
- [x] plan 落地清单与 20490ad 文件清单一致（50 文件含 4 新增），收口三项（反引号改名 / gitignore / trust-mode 本地化）有记录（证据：独立复核报告 B 节 49→50 收口——kit.json 补行入 spec 系统改动表；三项收口复核确认属实）
- [x] 补档提交后 check-loop 全绿无新增告警（证据：INDEX 重生成后 check-loop exit=0，告警均为存量项——见关单提交前实录）
- [x] drift-hardening 关单留痕所指「须补三件套」断点兑现——本批 intent 与其呼应（证据：drift-hardening intent 关单留痕节 ↔ 本 intent 备注与背景互引，复核 C 节确认成立）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 hard-block。

## 确认与复核

- 确认日期：2026-10-01（用户对话内「确认」代录，台账 source=chat-delegated）
- 确认人：用户（对话内明确放行即确认）
- 确认范围：hybrid-governance 补档回填（三件套如实记录已落地四特性）
- 复核：已完成（2026-10-01，independent-reviewer 新上下文）——12 锚点判据全一致 / 叙事真实 / 零代码改动属实；1 P1（落地归属口径）+ 3 P2 用户定性**全收**，随关单编辑收口
