---
description: AI-Native 闭环总入口:6 阶段指令索引(Plan→Design→Build→Test→Deploy→Maintain)
---

# New Task · 闭环总入口

> 6 阶段指令索引。AI 读 AGENTS.md 后按阶段路由,不并阶段、不跳阶段。

## 1. 6 阶段指令索引

| 阶段 | 指令 | 触发短语 | 可委派子智能体 | 确认点 |
|------|------|---------|----------------|--------|
| **Plan** | [.agents/commands/plan.md](.agents/commands/plan.md) | "起个 intent" / "要做个 <功能>" | 无 | intent 要点确认 |
| **Design** | [.agents/commands/design.md](.agents/commands/design.md) | "起个 spec" / "intent 看过了" | `independent-reviewer`(L3) | spec 草稿确认(L3 加独立复核) |
| **Build** | [.agents/commands/build.md](.agents/commands/build.md) | "起个 plan" → "动手吧" | `implementer`(确认后、范围明确时) | plan 确认 + 动手前确认 |
| **Test** | [.agents/commands/test.md](.agents/commands/test.md) | "改完了" / "跑下 verify" | `ui-verifier`、`independent-reviewer` | 测试全过(L2/L3 独立复核)+ 关单；L1 结束 |
| **Deploy** | [.agents/commands/deploy.md](.agents/commands/deploy.md) | "可以上了" / "过 release 清单" | 无 | 仅 prod：用户确认 + release tag |
| **Maintain** | [.agents/commands/maintain.md](.agents/commands/maintain.md) | "线上出事了" / "记一笔 incident" | `implementer`(方案确认后) | 三件套要点确认 |
| **Review**(横切,不占 6 阶段) | [.agents/commands/review.md](.agents/commands/review.md) | "评审一下" / "过 review 标准" | `independent-reviewer`(L2/L3 必须独立复核) | 问题定性与合入时机确认 |

## 2. 风险定级(第 0 步,先定级再路由)

**第 0 步先取机器面下界(必跑,不是可选提示)**:

```bash
flow-kit route --files <预计改动面…> --kind require|fix|verify|review|deploy
```

- **不给 `--files` 就拿不到路径下限**——机器面此时只能按 L1 起步并在降级栏点名,等于白跑;
  故定级前先把**预计改动面**列出来(不必精确到最终 diff,给到目录/文件前缀即可)。
- 跑完**再**按 §4 逐条语义判级:机器只给「就高不就低 + 路径下限」,「一处定义、多处消费」仍要你判。
- **确实跳过**时必须写明理由(入口文档备注或当场告知用户)——判低的后果由两道门兜:
  起草面 `check-lane-surface` 命中路径下限无合格入口即拦,提交面同门再拦一次。
  **诚实边界**:机器**无法**发现你没跑 route——定级发生在改动面确定之前,没有可比对的记录面,
  详见 [ARCHITECTURE §5](../ARCHITECTURE.md) 与 CHANGELOG 1.7.16 B3 条。

动工前按下表定风险级 L1-L3(就高不就低;判据细则见下节「级别判断」,单源 level-criteria.mjs),级别即风险级,决定走哪条泳道——确认放事前,还是审计补事后:

| 泳道 | 级别 | 确认与审计口径 |
|------|------|---------------|
| **协作道**(敏捷优先,审计异步补) | L1 实现级 | 一份 plan 即入口(来源 / 目标 / 红线 / 改动 / 验证 / 验收),不另立 intent。独立复核不设同步前置,check-loop 与事后 review 兜底;确认/代录可 `--batch` 批量(仅 L1) |
| **防御道**(严谨优先,确认同步拦) | L2 规则/契约 / L3 数据与运行时结构 | 同步确认门:spec 确认通过方可起草 plan,plan 确认后方可动手;L3 加新会话独立复核,未确认不放行 |

> **两问定级**（2026-10-13 L0 退役,自源仓收敛系列 1 回灌）:结构面(schema / 迁移 SQL / DI / 认证管线)→ L3;契约或共享口径 → L2;两者都没有 → L1。不要按严重程度从 L1 往上滑。
> **落位**: L1 写在 plan frontmatter `级别`;L2/L3 写在 intent(intent 另以 `risk_level`=级别双写,`fill-intent.mjs` 自动写入,机器选道用)。
> **判低拦截**: 入口勾触达红线 → check-loop「红线判低」hard 拦 → 升到 L2/L3 并补同名 spec。
> **预判留痕**（§25 advisory）: 定级先做结构化预判（有结构化判定工具则对齐本仓判据，无则按两问自判），结果写进入口文档 frontmatter「预判: kind=<kind> level=<L1|L2|L3>」——与实际落位不符 check-loop 出 WARN 留账。kind 词表与对账机理见 `.agents/notes/engine-internals.md`（维护者面）。
>
> **L2/L3 起草期合并预览**：三件套起草按 [design.md §0](design.md) 一次呈现要点总览（逐件确认代录不变）。

> **提问分型**（源仓 2c342bf1 试挂）:向用户提问前先分类——答案能跑出来/查出来的（行为/时序/布局/输出/存量数据/eval 可分）是**可实验的**,预算内先原型/查库/跑 eval 让结果说话,禁停下来问;「任何实验都定不了」的产品或偏好判断才升级确认。与 STOP 线正交:可实验不豁免红线。

## 3. 路由判断

<!-- route-kinds: require=plan.md | fix=maintain.md | verify=test.md | review=review.md | deploy=deploy.md -->
<!-- ↑ 本行是 kind→入口指令的**机器单源**：`flow-kit route` 读它得出「该读哪个 md」，不再在包内自带一份映射。
     增删 kind 或改入口文件名只改这一行（判据单源 level-criteria.mjs 的纪律同源）。 -->

- **自动化驱动（并列入口,可选）**:一句话全程走 [pipeline-run.md](pipeline-run.md)——状态机驱动+工单协议+原话代录,与下述手动路由二选一,同一任务不混用
- **新需求 / 功能**:从 `plan.md` 进,立 **intent**(`workflow/intents/`)
- **修复类任务 / 事故**:从 `maintain.md` 进,立 **incident**(`workflow/incidents/`);incident 在 L1+ 即 **intent 等价物**(check-loop 认 incident≡intent),不必另立 intent。先检索同类历史(`node .agents/scripts/kb-search.mjs "<关键词>" --scope workflow --type incidents,plans`),有同类先读其历史三件套;再按级别走:
  - L1 → 立 incident 后进 `build.md` 起草并确认同名 Quick-Plan → `test.md`
  - L2/L3 → 立 incident 后进 `design.md` 起草并确认同名 spec,再进 `build.md` 起草并确认同名 plan → `test.md`
  - 仅当根因属系统性 / 门禁缺位(maintain.md 三件套「是否需要新 intent」选"是")才另立 `workflow/intents/` 同名 intent
- **改完代码要验证**:直接进 `test.md`（验证通过即关单；L1 到此结束）
- **合入前评审**:直接进 `review.md`(横切,P0/P1/P2 分级清单 + L2/L3 独立复核)
- **准备上线**:直接进 `deploy.md`（仅 prod；文档应已在 test 关单）

## 4. 级别判断(AGENTS.md 第 3 条)

> **判据单源 = [`.agents/scripts/level-criteria.mjs`](../scripts/level-criteria.mjs)**,本节**不复述判据**。
> 要看判据全文,或要机器可判的部分(路径下限 / 就高不就低 / 混档取高),直接:
>
> ```bash
> flow-kit route --files <改动文件…>      # 定级 + 下一阶段 + 该读哪个 md
> ```
>
> 单源导出:`LEVELS` `LEVEL_MEANING`(档位语义) / `L2_SURFACES`(四类触达面闭集) / `L3_SURFACES`(结构面) /
> `L1_NEGATIVES`(判低红线) / `SELF_CHECK`(自查句) / `assessLevel` `hintLevelFor` `parseLevelHints` `routeAdvice`。
>
> 路径下限清单(装户 owned,默认空):`.agents/level-hints.txt`,每行 `L2 <ERE>` / `L3 <ERE>`,登记「哪些路径一碰就至少是此档」。

**本表只承载流程**(「改什么」判据以单源为准,别在本表增删判据):

| 级别 | 单源语义(摘要) | 流程 |
|------|-----------------|------|
| L1 | 实现级改动(未命中 L2/L3) | 快车道:液态草稿(.zcode/drafts) → 实现 → 固化(`solidify-task.mjs`)——用户确认后带 `--delegated "<原话>"` 执行;无确认来源只迁移不落账;亦可一份 plan 即入口(不另立 intent) |
| L2 | 规则 / 契约(一处改、多处依赖) | 入口文档(intent / incident) + spec + plan 三件套 |
| L3 | 数据与运行时结构(结构面闭集见单源 `L3_SURFACES`) | 同 L2 + spec 新会话独立复核 |

> 混合改动按最高档定级(就高不就低);**L1 是默认档**——判级只回答「是否命中单源 `L2_SURFACES` 或
> `L3_SURFACES`」,负例(`L1_NEGATIVES`)命中即不得升档;自查句:`SELF_CHECK`。
> 机器兜得住的只有「就高不就低」与路径下限;「一处定义、多处消费」是**语义**判定,由你按单源逐条判,
> 漏判由 lane-surface 触达面门在提交面兜。先例:`workflow/specs/`、`workflow/intents/` 下同类历史(kb 检索主题词)。

## 5. intent 豁免(避免小改动也走完整闭环)

- **L1 新需求**:一份 plan 即入口,不另立 intent(不必 spec)
- **docs 级改动**(AGENTS.md / workflow/ 模板 / .agents/ 脚本与 commands / yaml):豁免 intent,走 Conventional Commits 直接 commit;若同时触及代码,按代码部分级别立 intent
- **bootstrap 类改动**(引入规则本身):豁免 intent,commit message 显式声明 `bootstrap`

## 6. 闭环兜底

- 门禁清单与判据以 `.githooks/` / `.agents/hooks/` / `check-loop.sh` 头部注释为准(本文件不复述、不写项数);hard-block = 配对断裂 / 回路断档 / 新建 done 未勾验。本地机器门只有本地钩子,禁 `--no-verify`(见根 `AGENTS.md`)。
