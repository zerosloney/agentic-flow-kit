# 引擎维护者面（engine-internals）

> 使用者只需 `.agents/commands/new-task.md` 的两问定级 + 路由表；本页收深水区：预判对账机理、
> kind 词表单源、规则生灭机制。环境事实单源在 `.agents/notes/runtime-env.md`（本页不涉及）。
> 本页属引擎面（`.agents/notes/`）。

## 预判留痕与 kind 词表（check-loop §25，2026-10-12 源仓建；kit 2026-10-13 B6b-2 回灌）

定级先做结构化预判（有结构化判定工具则对齐本仓判据，无则按两问自判），结果如实写进入口文档 frontmatter「预判: kind=<kind> level=<L1|L2|L3>」——与实际落位不符时 check-loop 出 WARN 留账（月度对账再议升格）。

**kind 词表**（单源 `pipeline-run.mjs` KINDS——§25 执法面 check-prejudgment.mjs 同款内联声明，注释互引、改任一侧须同步；任何列举处系摘录，增删以单源为准；非任务类型词）：`require`（新需求，落 intents）/ `fix`（修复，落 incidents）/ `verify` / `review` / `deploy`。intents 只判 `require`、incidents 只判 `fix`；plans/specs 是两道共用件，不判类型只比对级别。终态文档（done/superseded/cancelled/fixed/closed）跳过形态/词表类告警——终态受检查 15 内容绑定不可修订，此类 WARN 永不可消；类型/级别比对照常。

## 规则生灭机制（2026-10-15 减重立项：锚日只升不降的对冲面）

- **生**：新检查以 advisory 灰度进入 → `effective-policy.md` 锚表按 policyVersion 升 hard。
- **死**（退役候选）：`node .agents/scripts/agg-judgments.mjs --retire-candidates`——连续 6 个有数据月零命中（WARN+BLOCK=0）的规则列为候选；月度对账按 `.agents/mechanism-registry.md`「退役判据」列逐条裁决（安全主干/级别闭环主干等「不退役」行除外，附加停滞条件由人判）。
- **一进一出**：条目数预算指令 `<N>#count` 随 `rule-budget.mjs` 下发（`.agents/rule-budgets.txt` 填 `<路径> <N>#count` 即生效——匹配文件数上限，超限硬拦）。源仓以该指令锚定 check-loop 段数（26，段合并后 23）；kit 检查段执行体在单体 check-loop.mjs 与 check-hygiene 模块内、无独立目录面，故模板不预设锚行——装户可自行为规则面（如 `.agents/rules/`）设锚。段编号承重不重排（§N 被锚名/机制台账跨文件引用），退役 = 段体删除，编号留疤。
