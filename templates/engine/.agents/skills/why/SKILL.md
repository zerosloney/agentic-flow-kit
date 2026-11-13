---
name: why
description: 追溯「为什么长这样」——并行查源码历史、流程留痕、领域文档、会话记录、issue/PR 与外部证据，逐条给指针；供动手改一段不理解的代码前使用。
---

# why — 为什么长这样

## 触发

- 「为什么这样设计 / 为什么这个 flag 没开 / 为什么选了这个方案」。
- 准备改一段不理解的代码，先要知道它为什么存在。
- 复核时对「这行不能删」的直觉不放心，需要证据。

## 核心

**不靠记忆，不靠猜。** 按证据类别并行查，每条结论带指针（`file:line` / commit / 文档 / issue / 指标）。区分 **measured / inferred / guess**；找不到也是答案，写「无记录」，不要编。

## 证据类别（并行查）

| 类别 | 本仓入口 |
|---|---|
| 源码与历史 | `git log -S<term>`（pickaxe）、`git log --follow -- <path>`、`git blame`、`xd://lsp` references |
| 流程留痕 | `workflow/{intents,specs,plans,incidents}`、`workflow/archive/`、`workflow/delegations.md`、`workflow/papercuts.md`、`workflow/regression-checklist.md` |
| 领域知识 | `wiki/`、`flow-kit run kb-search.mjs <term>` |
| 会话记录 | `history://`、`archive`（eval 全局）、`.agents/skills/session-resume/SKILL.md` |
| Issue / PR | `issue://<N>`、`pr://<N>`（有 GitHub 远端时） |
| 外部文档 | `microsoft_docs_search`、`web_search`、`read <url>` |
| 运行时 / 监控 | 可用的 MCP（chrome-devtools、context-mode 等）、日志、`workflow/metrics.md` |

## 步骤

1. **拆主体**：把问题拆成可检索的词——符号名、文件路径、功能名、决策关键词。一个词查不到就换同义词/中文/英文。
2. **本地证据**：跑 `node .agents/skills/why/scripts/why-evidence.mjs <term> [--path <file>]`，一次拿到 pickaxe、路径历史、workflow/wiki 命中、kb-search 摘要。
3. **外部证据**：按可用 MCP 并行查 issue/PR、外部文档、监控；没有就跳过，不假装查过。
4. **合成**：先给结论（为什么），再给证据链（每条 claim 带指针），最后列未知/冲突。
5. **标确定性**：`measured`（跑过/读到原文）、`inferred`（从证据推）、`guess`（没有证据）。预测与未观察到的原因一律 `guess`。
6. **时间线**（可选）：决策跨多个提交/文档时，按时间排一条链，标出转折点。

## 输出格式

- **结论**：一句话回答「为什么」。
- **证据链**：每条 = claim + 指针（`file:line` / commit / doc / issue）+ 确定性。
- **未知 / 冲突**：查不到、证据互相矛盾、或需要 owner 才能定的部分。
- **对改动的含义**：这段能不能动、动之前要满足什么。

## 本仓落点

- 接手/续作：`session-resume` 重建当前态后，用本技能补「为什么」。
- 修 bug：`diagnosing-bugs` 找根因前，先确认这段为什么存在。
- 复核：`review.md` 的「影响面证明」用 `blast-radius`；本技能补「历史意图」。
- 证据收集器：`.agents/skills/why/scripts/why-evidence.mjs`（只收集，不下结论）。

## 边界

- 本技能回答「为什么长这样」；`blast-radius` 回答「会碰坏什么」；`how` 回答「怎么运作」。三者不互相替代。
- 不把推测写成事实；没有证据就写「无记录」。
