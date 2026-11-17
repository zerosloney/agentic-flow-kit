---
name: wayfinder
description: 探索态决策地图——跨会话工作先把待决问题投影成地图（节点是问题不是交付物），一次解一个 frontier 节点，答案按去向落 ADR / 术语表 / intent / spec；供「工作大于一个会话 / 一串互相依赖的决定还没做」时使用。
---

# wayfinder — 决策地图：一次解一个待决问题

## 触发

- 工作跨 >1 个会话，且未决问题不止一个、互相依赖（先定 A 才能问 B）。
- 起草 intent 前发现问题不是一条诉求而是一串待决口径（此时 `grilling` 的单件拷问装不下）。
- 长跑 / 无人值守前需要知道「哪些决定还没做」（执行合同见 `autonomous-run`，本技能只管未决面）。
- 用户要求「先别写代码，把要决定的事列清楚」。

不触发：单会话可决的 L1 小改动（走 `new-task.md` 快速道）；已 approved 的 plan 执行期（按 plan 干活，偏离即停）。

## 核心

**节点是待决问题，不是交付物。** 地图产出决策，不产出代码。「实现 X」不是节点，「X 的口径按 A 还是 B」才是。
一次只解一个 frontier 节点（依赖已清的那些里最阻塞的一个）；解完立刻把答案送去它的真相源，地图只留指针。
探索态不等于停工：能跑出来 / 查出来的节点先跑探针，禁停下来问用户（分型单源 = `new-task.md` §1「提问分型」）。

## 工件与落点

| 工件 | 位置 | 写什么 |
|---|---|---|
| 决策地图 | `workflow/decision-maps/<YYYY-MM-DD>-<主题>.md` | 节点表（问题 / 为什么决不了 / 依赖 / 分型 / 答案形状或探针 / 状态 / 去向）+ frontier + 收图行 |
| 不可逆取舍的答案 | `workflow/adr/` | 走 `domain-modeling`，地图只引用 ADR 路径 |
| 术语口径的答案 | `workflow/glossary.md` | 走 `domain-modeling`，地图只引用术语行 |
| 需求与验收的答案 | `workflow/intents/`、`workflow/specs/` | 走 `new-task.md` / `stages.md` 主线起草与确认 |

- 真相源登记在 `workflow/artifact-sources.md`；地图**不复制**决策正文（单源纪律）。
- 地图不是四类文档：不走 `状态` 状态机、不经 `confirm-doc` 迁移、不进 `workflow/INDEX.md`。
  frontmatter `状态` 是地图本地枚举（open = 仍有未决节点 / closed = 全部已决或已弃）；节点状态 open / decided / dropped 同为本地枚举。
- 命名一律英文 kebab-case（沿 `workflow/README.md` 文档命名约定）。

## 步骤

1. **先检索**：`flow-kit run kb-search.mjs "<主题>" --scope workflow`（四类文档语料）+ 直接读 `workflow/decision-maps/`、`workflow/adr/`、`workflow/glossary.md`。
   命中同主题地图即修订原图，禁建第二份；跨会话续作先按 `session-resume` 重建当前态再读 frontier。
2. **列节点**：一行一个待决问题，写出「为什么现在决不了」（缺哪个事实 / 缺谁的裁定）、依赖节点号、答案形状（可判定的选项集）。
   节点多到一份上下文装不下 → 按 initiative 拆图（上下文预算口径同 `stages.md` Build §3 切片判据），不在一张图里堆两个 initiative。
3. **分型**：每个节点标 `实验`（能跑出来 / 查出来：行为、时序、存量、输出、eval 可区分）/ `裁定`（产品或偏好判断）/ `比选`（两个方案争不出高下）。
   实验类写最小探针命令，裁定类才升级为用户确认——分型判据不在此复制，见 `new-task.md` §1。
4. **定 frontier**：在依赖已清且未决的节点里取**一个**（最阻塞优先），写进地图 frontier 节；其余节点本轮不动。
5. **解节点**：实验 → 跑探针，证据落指针（输出 / path:line）；裁定 → 一次一个问题问用户（问法走 `grilling`），原话落既有确认 / 委派台账；比选 → 走 `arena`。
6. **回填去向**：答案按上表送真相源（ADR / 术语行 / intent / spec），节点改 `decided` 并写去向指针 + 依据；
   放弃的节点改 `dropped` 并写理由（禁静默消失）。地图里只留一行指针，不搬正文。
7. **收图**：全部节点 decided / dropped → 地图 `状态: closed`，写清主线入口（intent / spec 路径），后续会话按主线推进；
   地图留 git 不删除（`why` 与复盘要读当时的未决面）。仍有未决节点就继续第 4 步，一次一个。

## 与确认门的关系

- 地图本身**不是确认对象**，不新增硬门、不新增台账、不进常驻注入面。
- 裁定类节点的用户原话走既有 `confirmations` / `delegations` 台账；节点答案若改写已 approved 文档的**承诺面**（验收判据 / 红线 / 目标 / 改动方案），
  须让用户重新点头并跑 `flow-kit run confirm-doc.mjs <doc> --reconfirm --delegated "<用户原话>"`；禁手改 frontmatter 状态。
- 地图转主线后，intent / spec / plan 的起草与确认门一律照旧（`new-task.md` / `stages.md`），不因「已探索过」而豁免。

## 边界

- 不做实现、不写代码；地图节点不得是交付物或任务清单（任务拆解在 plan，判据见 `stages.md` Build §3）。
- 不复制 `grilling`（问法）/ `arena`（比选）/ `domain-modeling`（术语与 ADR）正文，只给指针。
- 不替代 `show-me-your-work`（那条记已做决策的轨迹）与 `pause-safely`（那条留可续现场）：本技能投影**还没做**的决定。
- 未决面清零就收图，不留「长期开放」的僵尸地图；口径变了就地修订节点，历史留 git。

> 思想来源：`mattpocock/skills` 的 wayfinder（决策地图 / 一次解一个待决问题）与 pstack `figure-it-out`（假设循环 + 决策留痕）、`principle-foundational-thinking`。本文件是本仓改写，不复制上游正文。
