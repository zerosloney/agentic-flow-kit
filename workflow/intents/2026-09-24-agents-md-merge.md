---
状态: done
级别: L1
日期: 2026-09-24
模块: pipeline
备注: 需求来源：2026-09-24 用户要求——init 对 AGENTS.md「需要判断有没有对应内容，如果有跳过，没有需要补上」（很多项目已有自写 AGENTS.md，现一刀切跳过导致 kit 工作流入口文档缺失）。2026-09-24 对话内随报随修。定性：安装器对单个 owned 文件的智能化跳过（追加补齐），不改渲染器对其余文件的行为、不改 CLI 参数面，L1。
---

# INTENT — init 对已存在 AGENTS.md 按骨架标记判断跳过或追加补齐

## 背景与问题
`flow-kit init` 对已存在的 AGENTS.md 一刀切保守跳过。但 AGENTS.md 是业界通用约定（Codex/Claude 等都读），目标项目常有自写的一份——跳过导致 kit 的工作流骨架（AI工作流/Wiki/项目适配区）缺失，工作流文档装了却没有入口说明书。用户要求：有对应内容跳过，没有补上。

## 目标
- 模板 AGENTS.md 顶部落骨架标记 `<!-- flow-kit:agents-skeleton -->`（新装/补齐后的文件都含它，探测以此为准）
- init 遇已存在 AGENTS.md：含标记 → 跳过（现状）；无标记 → 渲染模板后**文末追加**（原内容逐字保留），入 kit.json owned 台账，跳过清单不再误列
- 交互头部与 --help 同步该行为说明

## 非目标
- 不做节级智能合并/去重（追加即完整骨架，原内容不动，冲突由项目自行删改）
- 不改 renderTree 对其余文件的行为、不改 sync（owned 永不触碰）、不改 --force 语义（仍为整文件覆盖）
- 不回填既有装户（本仓库与 Shipyard 的 AGENTS.md 属 owned，维持现状）

## 约束
- 探测用标记字符串而非猜标题（避免误伤项目自写的同名「AI工作流」节）
- 渲染复用模板同源占位符替换（提取 renderContent 供 renderTree 与补齐共用，不复制逻辑）

## 影响面
- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）
- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2

> 红线说明：AGENTS.md 模板加一行 HTML 注释、init 对既有文件行为从「跳过」细化为「无标记才追加」——增量放宽，原有场景（无 AGENTS.md / 带 --force）行为不变，故 L1。

## 验收标准（可测试）
- [x] 合并场景：预置自写 AGENTS.md 的临时目录 init 后，文件 = 原内容 + 空行 + 含标记的完整骨架，原内容逐字在位（证据：/tmp/fk-agents-a 实测——head 三行原文原样、tail 为骨架「项目适配区」节、控制台「文末追加补齐（原内容保留）」行，commit 446f0a2）
- [x] 跳过场景：预置含标记 AGENTS.md 的临时目录 init 后文件不变，控制台报「已存在且含工作流骨架」（证据：/tmp/fk-agents-c 实测——专属提示单行，末尾「未覆盖」汇总不再重复列）
- [x] 纯函数测试：hasAgentsSkeleton / mergeAgents 断言（标记探测、尾部空白折叠、空原内容）入 npm test 套件（证据：src/init.test.mjs 累计 20/20 PASS）
- [x] 既有场景不回归：无 AGENTS.md 正常生成、npm test 全绿（证据：node .agents/scripts/verify.mjs 实跑「✅ 全部套件通过 + ✅ 全绿——可以关单」）
