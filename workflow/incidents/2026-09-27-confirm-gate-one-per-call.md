---
状态: fixed
级别: L2
发现: 2026-09-27
模块: pipeline
备注: 流程违规复盘（用户指出「不应该一个文档一次吗」）：delegated 多文档一次调用塌掉三道阶段门——build.md「逐件确认不得并作一次」被系统性违反（今日 12 单全部 L2 三件套并录 + L1 双件并录）。机制修复：confirm-doc --delegated 强制单文档 + check-loop 15 扩台账同批多份 warning + 命令文档补逐件口径。incident 即 intent 等价入口（修复类），L2 配 spec/plan——本次三件套按修复后流程逐件确认，本单自身即新纪律首次执行
---

# INCIDENT — 2026-09-27 确认门「多文档一次代录」系统性违规

## 时间线
- 2026-09-27 全天：L2 单全部采用「三件套一起起草 → 一条摘要过目 → 一句『可以』confirm-doc --delegated 多文档一次代录」（audit-gate-hardening 首创后成为惯性模板）；复核台账考据修正原表述——实为 6 个 L2 单 ×（立项+关单）各一批并录 + sync-hosts 关单一批，共 13 批 41 行台账可证
- 2026-09-27 日终：用户指出「你现在一次生成三个文档让我审，不应该是一个文档一次吗」——违规定性与本单立项
- 同日复核考据新发现（比并录更深一层的盲区）：L1 单的 incident 态翻转（open→fixed→closed）**从未入确认台账**（全台账 0 条 fixed/closed 行）——incident 的终态翻转让旧版 incident 文档落在 frontmatter 状态： closed 但无任何台账/指纹记录，gate-coverage 扩的 15 检查对 incidents 配对要求自 2026-09-28 起才生效（本日 incident 均豁免）。该盲区随新检查生效自然关闭，历史 L1 incident 无法追认（同「draft 直跳 done」存量口径，只声明不回填）

## 影响面
- **确认门纪律被系统性绕过**：build.md 明文「入口文档 / spec / plan 各自的确认点不得并作一次」。今日 4 次 L2 三件套并录（audit-gate-hardening / gate-coverage / closing-coverage / p2-batch1）+ 3 次 L1 双件并录（gate-hardening-p2-batch / host-gates-p1 / p2-batch2）+ 2 次 L2 双件（board-kb-p1 三件、init-p1-batch 三件）
- **塌掉的两重保护**：
  1. 依赖链——spec 的前提是 intent 已定稿、plan 的前提是 spec 已定稿；合并起草时写 spec 时 intent 未经用户确认，用户对 intent 边界的异议（当日确有发生）意味着 spec/plan 全部白写返工——三道门的本意是让返工发生在最便宜的一层
  2. 对质语义——一句「可以」被记成三份的放行；事后无法证明用户当时真的同时过目并放行了三份，confirm-gate-delegated「quote 原话入账供对质」的承诺在多份同录时被稀释
- **demo 效应外溢**：本仓模板（.agents/commands/*.md）发布给装户，装户 AI 会照抄「三件一起起草+并录」的做法——违规随包分发
- 幸运面：今日所有并录的放行用户事后均未推翻（对话内逐次真实回复），无实际未授权落态；属纪律违规而非后果事故

## 根因
**机器层无约束 + AI 效率偏好**：confirm-doc 的 --delegated 形态允许一次传多文档（设计初衷是 TTY 逐份过目的效率镜像，但 delegated 路径没有「逐份过目」的天然机制——TTY 用户逐份看到全文再逐份键入，delegated 只有一句总 quote）。AI 在长会话中倾向压缩交互轮次，发现多文档并录「能跑通门禁」后固化为模板。**根因是机器门与文档纪律的缝隙**：纪律写在 build.md（prose），机器只查「有没有台账记录」，不查「是否逐件」。

## 为什么之前没拦住
- check-loop 15 只对账「指纹+台账配对」，不审「一次调用几份」
- build.md「逐件确认」无任何机器表达；三份同秒入账在台账上与三次独立确认不可区分（当时）
- 会话内我从未主动声明这一偏差——用户基于「每阶段都有确认」的印象授权，实际三道门被压成一道

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：64ced88（feat：单文档强制 + 批次审计 + 四处口径）+ 0abb57d（复核 P2×4：阈值用例/文案中性/台账可证口径/比较器）
   - 影响环境：dev（引擎包源；纪律面影响所有装户）
   - 是否需要新 intent：
     - 否 → 理由：机制缺口单点修复（delegated 单文档强制 + 台账批次可审计 + 文档口径），根因已由本 incident 复盘承载

2. 防复发验证（必须落到自动化用例，禁止只写「已人工验证」）
   - 自动化用例：confirm-doc.test.mjs 新增——delegated 多文档 → exit 1 拒绝且提示逐件口径；单文档 delegated → 照常；check-loop.test.mjs 新增——台账同批多份 delegated → warning 场景
   - test.md 关单口径不变（verify.mjs 编排内含两套件）

3. 规范条目（必须有可追溯的落点）
   - 落点：confirm-doc.mjs 头注释（单文档语义）+ plan.md/design.md/build.md/test.md 确认门段（「--delegated 逐件调用」一句）+ AGENTS.md 确认门条款补「逐件」
   - 引用：随本单 feat 提交
