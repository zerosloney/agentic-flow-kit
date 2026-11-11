---
name: wiki
description: 项目 wiki 整理与验证技能。负责将散落文档归位到 wiki/，并维护 INDEX.md、知识沉淀总览.html 及归档一致性。
---

# Wiki 整理与验证技能

## 目标
构建并维护结构化的项目知识库，确保磁盘文件、索引文件与可视化看板三方一致。

## 触发条件
- 用户指令：`整理 wiki` / `归类文档` / `建知识库` / `同步知识沉淀看板` / `新增文档到 wiki`。

## 范围与约束
- **收录范围**：
    - **In**: 主数据知识文档、全项目数据维护 SQL。
    - **Out**: `workflow/` 目录、MTO/采购/库存/UI 等非主数据知识文档、依赖锁文件、IDE 配置。
- **目录结构**：`wiki/<主题>/<关键词文件>`。
- **命名规范**：`<主题>-<关键词>[-范围/版本].ext`。
- **权威性**：`.md` 为内容源 $\rightarrow$ `.html` 为展示快照。冲突时以 `.md` 为准。
- **操作限制**：仅执行复制 (`Copy-Item`/`cp`)。删除原文件必须获得用户单独确认。

## 标准操作流程

### 1. 整理与归位 (批量/新建)
1. **主题判定**：读取文件首 8 行，根据内容判定主题。新主题需与用户对齐。
2. **目录创建**：创建 `wiki/<主题>/` 及对应的 `wiki/drafts-archive/YYYY-MM-DD_<主题>/`。
3. **文件迁移**：
    - 将文件复制到 `wiki/<主题>/` 并按规范重命名。
    - 将原文件副本复制到 `drafts-archive/` 留溯源。
4. **索引更新**：运行 `node .agents/scripts/gen-wiki-board.mjs`。
5. **描述补全**：在 `wiki/INDEX.md` 速览表的「用途」列为新主题补全描述，然后再次运行生成器。

### 2. 单篇文档新增
1. 判定主题 $\rightarrow$ 复制到 `wiki/<主题>/` $\rightarrow$ 运行生成器 $\rightarrow$ 运行验证脚本。

### 3. 错误归位修正
1. 移动文件至正确主题目录 $\rightarrow$ 运行生成器 $\rightarrow$ 运行验证脚本。`drafts-archive` 保持不动。

## 验证机制
每次改动后必须运行：
```bash
node .agents/scripts/verify-wiki-consistency.mjs
```
**验收标准**：
- `exit 0` 且输出 `✅ wiki 三方一致`。
- 检查项涵盖：磁盘 $\leftrightarrow$ INDEX $\leftrightarrow$ 看板 DATA $\leftrightarrow$ 数据维护台账 $\leftrightarrow$ 链接可达性。

## 维护须知
- **生成区**：`wiki/INDEX.md` 的计数/映射表及 `知识沉淀总览.html` 的 DATA 块为自动生成区，禁止手动修改。
- **人工编辑位**：仅维护 `wiki/INDEX.md` 的「用途」列及 `wiki/数据维护/README.md` 台账。
- **冲突处理**：wiki 与 `AGENTS.md` 或 `workflow` 冲突时，以后者为准。
- **提交规范**：调整 wiki 内容（知识文档新增/修改/删除/更名/归位、INDEX、看板、本技能文件）属 docs 级改动，**豁免工作流三件套**（不生成 intents/specs/plans、不走确认门），直接 commit (`docs(wiki): <动作>`)；规则单源 = 根 `AGENTS.md` §4「wiki 豁免」。删除文件仍须用户单独确认（见「操作限制」）。
