---
name: dream
description: 离线梦境（Dreaming）——对照 Anthropic 记忆架构的周期性记忆维护：运行 dream-run 审计、读报告、委托 independent-reviewer 核验 AI Judge 抽样、回写 papercuts/修正笔记、处置冷数据候选；供主智能体在会话内执行 Dreaming 持续运行链路时使用。
---

# dream — 离线梦境（Dreaming）持续运行链路

## 触发

- post-commit 出现 `[dream]` advisory（距上次审计 ≥7 天或无报告）。
- session-resume 重建时发现 `tmp/dream-report-*.md` 或 `tmp/dream-judge-brief-*.md`。
- 用户主动要求「跑梦境审计 / Dreaming」。

## 1. 运行审计

```bash
node .agents/scripts/dream-run.mjs              # dry-run：只读审计 + AI 抽样简报（默认）
node .agents/scripts/dream-run.mjs --execute    # 执行安全修复（仅终态件归档 + 索引重生成）
```

- 报告落 `tmp/dream-report-<date>.md`（gitignore）；AI Judge 简报落 `tmp/dream-judge-brief-<date>.md`。
- `--execute` 只做「终态件归档 + 索引重生成」，不改写任何文档内容。
- 不自动 commit / push（根 AGENTS.md 禁令）。

## 2. 读报告

读最新 `tmp/dream-report-*.md`，关注：

- A 终态件归档（archive-sweep，21 天窗口）；
- B 索引漂移与 wiki 三方一致；
- C 全量对账（check-loop，hard 6 段）；
- D 错类候选（agg-judgments --retire-candidates）；
- E 常驻面预算（rule-budget --all）；
- E2 冷数据候选（agg-kb-usage --stale-days 90）——访问/命中遥测 + 置信度衰减，见 §5；
- G 主张依据（`claims.mjs recheck`）——只报告原文还在不在，退出码恒 0，见 §6；
- H 经验回放（`session-log.mjs digest`）——把会话失败/纠正/拒绝聚成摘要；**无日志时明确写“无输入”**；
- I 记忆表示（`memory-wiki.mjs --check`）——`wiki/_memory/` 是否与 claims/incidents/session-logs 同步；
- J 注入层预算与上浮候选（`memory-tier.mjs audit/suggest`）——200 行 / 25KB 预算，候选只读；
- K 交付结果指标（`outcome-metrics.mjs`）——首次过门率、复核采纳率、逃逸缺陷、评测通过率；
- F AI Judge 抽样审计简报。断依据会附在简报里。

## 3. 核验 AI Judge 抽样

1. 读 `tmp/dream-judge-brief-*.md`；
2. 复制简报末尾「Judge 委托模板」给 independent-reviewer 角色核验；
3. 核验结论按 BLOCK / WARN / OK 处置：
   - **BLOCK**：对照原始证据修正 workflow 文档声明（改后不自动 commit）；
   - **WARN**：登记 papercuts 或补证据；
   - **OK**：无动作。

## 4. 回写

- 错类候选：按 `.agents/skills/papercut-fix/SKILL.md` 错题回路处置（≥3 次立规则，落点阶梯 类型→门禁→测试→冒烟→prompt）。
- 核验发现：修正笔记 / 登记 `workflow/papercuts.md`。

## 5. 处置冷数据候选

- 冷数据候选来自 `agg-kb-usage.mjs`（遥测口径：最近 90 天既未被 kb-search 命中、内容也未更新）。
- 处置阶梯（由主智能体/用户裁决）：
  1. 归档：`node .agents/scripts/archive-sweep.mjs --execute`（终态件，21 天窗口）；
  2. 更新：走 wiki 技能更新知识；
  3. 删除：**须用户单独指令**（根 AGENTS.md 不可逆操作红线）。

## 6. 记一条主张

未来会话会当真的规则或 wiki 事实，先落主张，再写进笔记：

```bash
node .agents/scripts/claims.mjs add --claim "一句话" --path <相对路径> --quote "文件里已有的原文"
```

- 依据必须是仓库里的原文（8 到 200 字），不是命令输出，也不是聊天复述。
- 屏幕上下次还能读到的状态不记。
- 账在 `workflow/claims.d/<YYYY-MM>.jsonl`，只追加。核对不改这些行。
- 报告里的 broken 只说明原文没了。读到之后登记，不当场改正文。

## 红线

- `--execute` 只做归档 + 索引重生成，不改写文档正文。
- 不自动 commit / push；删除 wiki 文件须用户单独指令。
- 本技能是执行链路：判断由 AI 执行，确定性脚本只做采样与证据收集（「确定性脚本管事实，模型管判断」）。
- `recheck` 不写账、不改正文。原文还在不等于主张为真。