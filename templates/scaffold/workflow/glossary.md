# 术语表（Glossary）— 领域口径唯一真相源

> 一个概念一个名字一个定义。何时写、怎么写见 `.agents/skills/domain-modeling/SKILL.md`（正文单源在技能侧，本文件只放数据行）。
> 真相源登记：`workflow/artifact-sources.md`。`wiki/`、spec、代码注释只引用本表，不另写定义。

| 术语 | 定义（可判定，一句话） | 代码里的名字 | 不是什么（反例） | 依据 |
|---|---|---|---|---|
| <术语> | <定义> | <类 / 字段 / 端点名> | <易混淆的相邻概念> | <spec / ADR / path:line> |

## 维护纪律

- **先检索后新增**：`flow-kit run kb-search.mjs "<术语>" --scope workflow` 命中即修订原行，禁新建同义行。
- **口径变更同批对账**：改写定义须同批更新引用它的 spec / ADR 与代码命名；触及已 approved 文档的承诺面时走 `flow-kit run confirm-doc.mjs <doc> --reconfirm --delegated "<用户原话>"`。
- **命名不一致按缺陷处理**：代码名与术语名不一致 → 登记 `workflow/papercuts.md`，不在本表造第二套名字。
- 本表是活文档不是归档：历史定义留 git，被取代的决策留 `workflow/adr/` 的 superseded 链。
