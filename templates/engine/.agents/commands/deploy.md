---
description: Deploy 阶段:合入清单(静态门 + 配对检查 + 回归 + DB + 授权 + PR 审查合并)
stage: Deploy
triggers:
  - "跑下 release"
  - "可以上了"
  - "准备上线"
approval_required: true
next: .agents/commands/maintain.md(仅事故时)
---

# Deploy · 合入清单

L1 已在 `.agents/commands/new-task.md` §L1 快速道关单，不打开本文件。本文件从 L2/L3 合入起。
**口径（owner 2026-10-29）**：不走 tag/24h 观察仪式——合入 = PR 创建 $\rightarrow$ 审查 $\rightarrow$ 回归 $\rightarrow$ 合并 $\rightarrow$ 归档（release tag 与发布观察台账已退役，历史查 git）。

## 1. 静态门 (Static Gates)
1. `flow-kit run verify.mjs --full`（口径见头注）全绿 $\rightarrow$ 记录证据；任一失败 $\rightarrow$ **HALT** $\rightarrow$ 回 `stages.md` Build 章。环境细节见 `.agents/notes/runtime-env.md` §1, §2

## 2. 文档闭环 (Documentation Audit)
1. **配对检查 (L2/L3)**: `intents/`(或 `incidents/`) $\leftrightarrow$ `specs/` $\leftrightarrow$ `plans/` 三件同名齐全，状态全 `done`
2. **修复类专项**: incident 三件套 [结构性修复 / 防复发验证 / 规范条目] 完整 $\text{AND}$ 状态 `closed`；根因属门禁/规范缺位 $\rightarrow$ 已立新 intent 追踪
3. **裁定回填核对**: 有裁定回填改动过 done 文档 $\rightarrow$ 已同批补录重确认补偿行（`maintain.md` §4.4）$\rightarrow$ 否则 pre-push 指纹硬门拦截
4. **合入收口自查**: **合并前**核对 `workflow/` 四目录无本批应关未关的在途件（合并树上仍 `draft`/`approved` 即先关单再合入）
**Output**: 闭环审计通过证据

## 3. 回归与数据库 (Regression & DB)
1. **路径验证**: `workflow/regression-checklist.md` 涉及模块关键路径全过
2. **自动化验证**: 项目测试用例全过 (禁跳过失败用例)；历史同类 incident 防复发条目逐条过
3. **DB 变更 (L3 专项)**: 迁移 SQL $\leftrightarrow$ 实体映射一致；记录 [备份点] + [回滚 SQL 路径]；**回滚 SQL 必须在 dev 演练执行过** (未演练 $\rightarrow$ 视为无预案 $\rightarrow$ **HALT**)

## 4. 合入授权与 PR (Authorization & PR)
1. **用户授权**: 仅接受用户本人在对话内一句 "上" 或同义确认
2. **PR 创建**: 面板评审触发口径以 `.agents/commands/pr-review.md` 为准（满足其触发规则才跑），再 `flow-kit run pr-create.mjs create --source <分支> --target <目标> --title "<Conventional Commits 中文>" --body-file <file>`——描述带 Test 三件证据（Summary / Evidence / Merge Danger，形态见 `review.md`）；自动评审门已退役（2026-11-09），pr-create 仅转调 tfs-pr；手动面板跑过时在 Evidence 追加一行 `面板评审：<runId>（Important n / Nit n / Pre-existing n）`
3. **审查**: 按 `.agents/commands/review.md` 分级评审（逻辑 → 安全 → 对照 spec/plan）——审查不通过不合并
4. **合并留痕**: 记录 PR 号 + 合并 commit SHA；发布流水线执行（若有）由用户在平台人工审批
**Output**: PR 审查记录 + 合并 SHA

## 5. 归档与异常回落 (Closeout & Fallback)
1. **归档**: 终态家族归档由 `confirm-doc` 关单自动完成，本阶段核对归档发生
2. **异常回落**: 上线后异常 $\rightarrow$ `workflow/incidents/` $\rightarrow$ `maintain.md` (止血方案用户拍板；禁跨智能体协作推送修复)

## 🚫 禁止项
| 操作 | 后果 | 例外 |
|---|---|---|
| 无演练回滚 | → 视为无预案 | 必须在 dev 验证回滚 SQL |
| 绕过 test 关单 | → 拦截合入 | 文档先在 test 阶段置 done |
| 审查未过合并 | → 违反门禁前置 | P0 未清零禁合并 |
| 委派回滚决策 | → 违反安全策略 | 回滚决策必须主 Agent + 用户 |

## 🛠️ 辅助工具
版本回退 = 平台侧 revert 合并 PR/commit
