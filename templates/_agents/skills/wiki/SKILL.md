---
name: wiki
description: 项目 wiki 整理与验证技能。负责把项目内散落文档按主题归位到 wiki/，并维护 INDEX.md、知识沉淀总览.html、drafts-archive 归档一致性。当用户要求"整理 wiki/归类文档/建知识库/查文档归属"时使用。
---

# Wiki 整理与验证技能

## 1. 何时调用本技能

触发短语：
- "整理 wiki / 归类文档 / 建知识库 / 同步知识沉淀看板"
- "新增一篇文档到 wiki"
- "校对 wiki 与 INDEX 是否一致"
- "把 X.md 归到 wiki 的哪个主题"
- "wiki 草稿归档 / 把原文归档"

不要调用本技能的场景：
- 询问文档内容本身（直接 Read 文件即可）
- workflow/ 下文档（已明确排除）；`docs/`、`.trae/documents/` 均已于 2026-09-12 删除

## 2. 核心约定（与 AGENTS.md 一致）

- **范围**：主数据知识文档 + 全项目数据维护 SQL。MTO/采购/库存/UI 等非主数据知识文档原位不动，不入 wiki。
- **目录结构**：`wiki/<主题>/<关键词文件>`，一级目录 = 主题，二级由文件组成（无强制二级子目录）。子目录（成套产物，见 INDEX 命名规则）中的 md/html 知识文档 2026-09-17 起计入登记与看板（`*.visual-check.*`/`.json`/`.png` 工具产物不计入；`数据维护` 主题子目录例外，仍走 README 台账）。看板中 html 格式文档的文件名为可点击链接（相对看板解析）。
- **命名**：`<主题>-<关键词>[-范围/版本].ext`，例：`需求口径说明-正式.md`、`某系统-PRD-v3.0.md`。
- **权威**：红线与闭环以 AGENTS.md / workflow 为准；wiki 承载当前态知识（领域 / 表 / 编码 / SQL 台账）。wiki 当前文档优于 `drafts-archive/`（归档仅历史快照）。
- **双格式对（md + html 同内容）**：md 为权威内容源，html 为展示快照——内容冲突以 md 为准，改 md 后按需重出 html；速览表「用途」列标注权威关系。
- **索引生成（2026-09-13 起）**：速览表计数/映射表/看板 DATA 由 `node .agents/scripts/gen-wiki-board.mjs` 自动生成——人工只维护磁盘文件 + 速览表「用途」列；收录/删除/移动文件后必跑生成器（新主题用途列为 `<待补>` 时补描述后重跑）。写盘前可先 `--dry-run` 看差异（`--help` 打印用法，未知参数 exit 1）。
- **归档目录**：`wiki/drafts-archive/YYYY-MM-DD_<主题>/`，按整理批次日期+主题命名，保留原文件名。
- **排除**：`workflow/`、依赖锁文件、IDE 配置。

## 3. 标准操作流程

### 3.1 整理（新建/批量归位）

1. **识别范围**：列出候选文件后逐篇读首行判断主题——pwsh：`Get-ChildItem -Recurse -File -Include *.md` / `Get-Content <文件> -TotalCount 8`；POSIX：`find` / `head -8`。
2. **主题判定**：主题由内容自决，不预设分类。当前已沉淀主题：`产品需求 / 项目计划 / 开发方案 / 用户功能 / 项目规范 / 测试报告 / 数据维护`。新增主题前先与用户对齐。
3. **建目录**：pwsh `New-Item -ItemType Directory -Force wiki/<主题>`（POSIX：`mkdir -p`）；归档目录同理建 `wiki/drafts-archive/YYYY-MM-DD_<主题>`。
4. **复制并改名**：pwsh `Copy-Item 原路径 wiki/<主题>/<新名>`（POSIX：`cp`）；来源为仓库内原位文件时，同时按原名复制一份到 `drafts-archive/YYYY-MM-DD_<主题>/` 留溯源。
5. **生成索引**：跑 `node .agents/scripts/gen-wiki-board.mjs`（速览计数/映射表/看板 DATA 自动重生成）；新主题在速览表「用途」列补一行描述后重跑。
6. **自检**：跑第 4 节"验证脚本"，确认三方一致、目录无孤儿。

### 3.2 新增单篇文档（新产出直接落活跃层）

新产出的文档**直接归入 `wiki/<主题>/`**，不强制进 `drafts-archive/`——归档只承载整理前的历史原位文档（口径见 §3.1 第 4 步）。

```
1. 读文件首行判定主题
2. Copy-Item 原文件 wiki/<主题>/<主题>-<关键词>.<ext>   # POSIX：cp
3. node .agents/scripts/gen-wiki-board.mjs              （索引自动生成，无需手工改映射表/看板）
4. 跑 §4 验证
```

### 3.3 删除/归档 wiki 中错误归位

```
1. 从 wiki/<错误主题>/ 移到 wiki/<正确主题>/，若改名也同步
2. drafts-archive 不动（归档记录原貌）
3. node .agents/scripts/gen-wiki-board.mjs
4. 跑 §4 验证
```

### 3.4 重建看板

`wiki/知识沉淀总览.html` 的 DATA 块由生成器从磁盘 + 速览表用途列自动生成（2026-09-13 起）。看板与磁盘不一致时：先跑 `node .agents/scripts/gen-wiki-board.mjs` 再跑 §4 验证；仍不一致说明有人手改了生成区——以生成器输出为准。

## 4. 验证脚本（必跑）
一条命令完成全部校验（磁盘 ↔ INDEX ↔ 看板 DATA ↔ summary 统计 ↔ 幽灵目录 ↔ 活跃层 file:/// 断链守卫 ↔ 数据维护台账登记 ↔ 看板链接可达性）：

```bash
node .agents/scripts/verify-wiki-consistency.mjs
```

- 通过：输出 `✅ wiki 三方一致：文件 N 份 / 主题 N 个（含占位）/ 归档 N 份`，exit 0
- 失败：逐条列出不一致项，exit 1。除文件集合 / 计数外还覆盖：`wiki/数据维护/` 下子目录（含批次目录）未在 `wiki/数据维护/README.md` 登记、看板「打开目录」链接（`DATA.dir`，相对看板自身 `wiki/` 解析）指向不存在的目录
- 占位主题（磁盘有目录但 0 文件）只输出 `ℹ️` 提示、不算失败；当前 7 个主题均非空（`开发方案` 2026-09-12 起已有 2 份表设计 md+html）
- 改了 wiki 内容/INDEX/看板任一处后必须重跑；三者任何一处漏同步都会被拦下

## 5. 命名冲突与歧义处置

- **同名不同扩展**：例如 `数据字典-修复.sql` 与 `数据字典-修复.md` —— 文件名可重复，但 `INDEX.md` 与看板 `DATA` 用 `file` 字段存完整文件名（含扩展）以区分。
- **跨主题歧义**：用户说"X 放哪"拿不准时，读首行 + 第一段判断；仍无法判定就先与用户确认主题，不预设兜底主题、不自造归类。
- **二进制（xlsx/csv/sql/json）**：允许直接归位到对应主题；不要为它们新建 markdown 索引——需要说明用途时写进 `wiki/INDEX.md` 速览表的「用途」列（唯一人工维护位，用例描述一句话；该表计数与映射表、看板 DATA 均为生成区，会被 `gen-wiki-board.mjs` 重写）。`wiki/数据维护/` 下的脚本与批次目录则在 `wiki/数据维护/README.md` 台账加登记行（verify 会拦未登记目录）。

## 6. 已知边界

- **workflow/ 永不入 wiki**：闭环工作流目录是项目规范明文排除项。
- **非主数据知识文档不入 wiki**（MTO/采购/库存/UI 等）——有意决策（2026-09-13 显式化；债与扩展触发条件见 `wiki/INDEX.md` §范围边界决策）；数据维护 SQL 为全项目，不受此限。
- **dependency 锁文件 / IDE 配置**：不入 wiki（`package-lock.json`、`pnpm-lock.yaml`、`*.sln`、`*.esproj` 等）。
- **批量整理只动一份副本**：本技能只复制（`Copy-Item` / `cp`），不删除原文件；删除原文件需要用户在对话内单独确认（这是 STOP 线场景）。

## 7. 与 AGENTS.md 衔接

- 改动 `wiki/INDEX.md`、`wiki/知识沉淀总览.html`、`.agents/skills/wiki/SKILL.md` 属 docs 级改动，**豁免 intent**，走 Conventional Commits 直接 commit：`docs(wiki): <动作>`。
- 若同时改 wiki 内某个具体知识文档（含路径变更/改名），按该文档原主题级别立 intent / incident。
- wiki 不替代 AGENTS.md / workflow 的红线与闭环；与二者冲突时以 AGENTS.md / workflow 为准。wiki 与 `drafts-archive/` 冲突时以 wiki 当前文档为准。

## 8. 失败模式与回滚

- **忘跑生成器**：磁盘文件动了没跑 `gen-wiki-board.mjs` → §4 脚本报「仅在看板上 / 仅在磁盘上」差异 → 跑生成器即对齐。
- **手改生成区**：速览计数/映射表/看板 DATA 是生成产物，手改会被 verify 拦且下次生成被覆盖——用途列才是人工编辑位。
- **原文件误删**：本技能只复制（`Copy-Item` / `cp`），不删原文件；若用户单独要求删除原文件，必须先列目录确认（pwsh `Get-ChildItem` / POSIX `ls`）再操作。
- **主题命名反复**：以 §4 脚本 A 段为最终事实；速览表用途列的 `<待补>` 提示新主题未补描述。
- **全文检索**：找「哪个文件讲过 X」用 `node .agents/scripts/wiki-search.mjs <关键词>`（wiki 活跃层，多词 AND；不扫归档；默认跳过 json/csv、视觉校验产物与 >180KB bulk 文件，`--include-generated` 纳入）；跨语料（workflow 流程留痕 + wiki）用 `node .agents/scripts/kb-search.mjs "<词>"`。
