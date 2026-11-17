---
name: domain-modeling
description: 领域建模——把术语与不可逆取舍落成单源工件（workflow/glossary.md 术语表、workflow/adr/ 决策记录），供 Design 章口径分歧、或同一概念出现多个叫法时使用。
---

# domain-modeling — 一个概念一个名字

## 触发

- 新术语第一次进入代码或文档。
- 同一概念出现 ≥2 个叫法（如「供应商 / 供方 / vendor」），或同一名字在不同模块指不同东西。
- 命中 L2 触达面的编码权威 / 共享契约 / 全局横切口径（`.agents/commands/new-task.md` §1）。
- 要做不可逆取舍：schema、身份口径、契约形状、存量数据迁移。

## 核心

**口径分歧不是文案问题，是模型问题。** 改注释不改模型，下一个会话还会再分歧一次。术语与决策必须有唯一真相源，其他地方只引用。

## 工件与落点

| 工件 | 位置 | 写什么 |
|---|---|---|
| 术语表 | `workflow/glossary.md` | 一行一术语：定义（可判定）+ 代码里的名字 + 反例（不是什么）+ 依据 |
| 决策记录 | `workflow/adr/<YYYY-MM-DD>-<主题>.md` | 背景 / 决策 / 备选与取舍 / 后果 / 状态（proposed → accepted → superseded） |

- 真相源登记在 `workflow/artifact-sources.md`；`wiki/` 与 spec 只放链接或引用，不复制定义正文。
- ADR 被取代不删除：改状态为 `superseded` 并指向新 ADR，保留当时的取舍依据（`why` 技能要读它）。
- 命名一律英文 kebab-case（沿 `workflow/README.md` 文档命名约定）。

## 步骤

1. **先检索**：`flow-kit run kb-search.mjs "<术语>" --scope workflow` + `workflow/glossary.md` + `wiki/INDEX.md`。命中即修订原行，禁新建同义行。
2. **定名**：一个概念选一个名字，写出可判定定义与反例；代码里的类 / 字段 / 端点名一并登记，命名不一致按 papercut 登记（不在术语表里造第二套名字）。
3. **质询前提**：定义有解读风险（如「展示口径 vs 存储口径」）→ 走 spec「前提质询」表，逐条反问对立解读并写选定依据；`confirm-doc` 会拦空表与占位。
4. **记决策**：不可逆取舍写 ADR，备选至少一个且写清为什么没选；只写「决定用 X」不算决策记录。
5. **回填**：spec「歧义清单」的数据口径维引用术语表行；「约束遵守映射」引用 ADR；plan 改动面列出被触达的术语消费方。
6. **对账**：改动完成后核对代码命名与术语表一致；不一致要么改代码要么改术语表（同批），不留两份真相。

## 与确认门的关系

术语定义或 ADR 决策若改写了已 approved 文档的**承诺面**（验收判据 / 红线 / 目标 / 改动方案），须让用户重新点头并跑 `flow-kit run confirm-doc.mjs <doc> --reconfirm --delegated "<用户原话>"`；禁手改 frontmatter 状态。

## 边界

- 不建第二个术语源：禁在根 `AGENTS.md`、`notes/`、代码注释里另写一份定义（单源纪律）。
- 不做接口形状评估（`codebase-design`）、不做需求拷问（`grilling`）、不做实现。
- 术语表与 ADR 是活文档，不是归档：口径变了就地修订，历史依据留 git 与 superseded 链。

> 思想来源：`mattpocock/skills` 的 domain-modeling（GLOSSARY / ADR 约定）与 pstack `principle-model-the-domain`。本文件是本仓改写，不复制上游正文。
