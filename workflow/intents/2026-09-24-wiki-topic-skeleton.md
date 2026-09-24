---
状态: done
级别: L1
日期: 2026-09-24
模块: wiki
备注: 需求来源：2026-09-24 用户截图（装户 Shipyard wiki 手建 7 个主题目录：测试报告/产品需求/开发方案/数据维护/项目规范/项目计划/用户功能）并要求「wiki 的内容目录补齐这些目录」——模板 wiki 目前只有 drafts-archive 骨架，每次装完都要手建主题目录。2026-09-24 对话内随报随修。定性：模板骨架增补，不改生成器逻辑（通用主题目录已支持），L1。
---

# INTENT — wiki 模板预置主题内容目录骨架

## 背景与问题
`templates/wiki/` 只预置 `drafts-archive/` + INDEX + 总览页，主题内容目录（产品需求/开发方案/测试报告等）要装户按需手建——真实装户（Shipyard）几天内手建了 7 个目录，痛点是每个新项目都要重复手工补骨架。另外 git 不跟踪空目录，目录骨架必须带占位文件才能在 fresh clone 存活。

## 目标
- `templates/wiki/` 预置 7 个主题目录：产品需求 / 用户功能 / 开发方案 / 项目规范 / 项目计划 / 测试报告 / 数据维护
- 每目录一个 README.md（一两行用途说明；README 计入文件数是既有口径——「主题目录顶层全量登记」；数据维护的 README 说明其子目录批内台账不参与登记的引擎特例）
- 模板 INDEX.md 速览表预填 7 行（「用途」为人工列，生成器重生成时保留）

## 非目标
- 不改 gen-wiki-board.mjs / verify-wiki-consistency.mjs 逻辑（通用目录扫描已覆盖新目录）
- 不动既有装户的 wiki/（owned，sync 永不触碰；Shipyard 已手建的不回填）
- 不往本仓库自用 wiki/ 塞空目录（其内容按本仓库实际知识沉淀走）

## 约束
- 目录名与截图一致（中文名）；README 风格随 templates/wiki/drafts-archive/README.md 的简短说明体
- 模板 INDEX 速览表行序即装户初见顺序，按文档生命周期排（需求 → 功能 → 方案 → 规范 → 计划 → 测试 → 数据）

## 影响面
- 模块：wiki
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）
- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2

> 红线说明：纯模板骨架增补（新增文件），生成器与一致性校验口径零改动，故 L1。

## 验收标准（可测试）
- [x] 临时目录 init 后 wiki/ 出现 7 个主题目录且各含 README.md，INDEX 速览表 7 行用途与模板一致（证据：/tmp/fk-wiki-test init 实测目录清单在位；重生成后用途列逐字保留，commit d57d74f）
- [x] 临时目录内跑 gen-wiki-board.mjs 重生成 + verify-wiki-consistency.mjs 三方一致全过（证据：「✅ wiki 三方一致：文件 7 份 / 主题 7 个（含占位）/ 归档 1 份」+「数据维护台账登记完整」）
- [x] npm test 全绿（gen-wiki-board fixture 不回归）（证据：node .agents/scripts/verify.mjs 实跑「✅ 全部套件通过」）
- [x] 临时目录首跑 doctor 干净（证据：doctor 7 PASS ｜ 1 WARN ｜ 0 FAIL——WARN 仅为临时目录非 git 仓库，环境性）
