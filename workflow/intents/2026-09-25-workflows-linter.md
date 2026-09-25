---
状态: done
级别: L1
日期: 2026-09-25
模块: pipeline
备注: 源自 2026-09-25 双维度审查报告改进方向第 1 条（最高优先级）。用户对话内确认「从1开始改进」。沿用既有工具落地先例（gate-checklist / source-sync-check 同为 L1 纯新增脚本 + doctor 接线，无规则面改动）。
---

# INTENT — workflows 编排脚本机器 linter（「解析校验先行」从 prose 落地为机器门）

## 背景与问题
- 2026-09-25 双维度审查实证：`.agents/workflows/_TEMPLATE.md:62` 承诺「解析校验先行：role ∈ `.agents/roles/`、step ∈ `steps/`、after 引用存在且无环——任一不过即拒，不执行」，但全仓库无任何脚本解析 stages 表（唯一机器检查是 init.test.mjs 的文件存在性断言）——环、悬空 after、role 拼错、授权文件交叉全靠宿主 AI 自觉，而编排脚本的书写者与执行者是同一个 LLM，缺外部裁决者。
- doctor §2 布局清单（26 个关键路径）不含 `.agents/workflows/_TEMPLATE.md`——编排机制 2026-09-25 定稿后装户丢文件 doctor 不报。

## 目标
- 新脚本 `workflows-check.mjs`（templates/_agents/scripts/ 包源 + sync 装副本）：解析 `.agents/workflows/*.md`（排除 `_` 前缀机制文档）的 stages 表，error 级 exit 1：frontmatter 缺失 / concurrency 非正整数 / stages 表缺失 / id 空 or 重复 / after 引用不存在 / after 成环 / role 不在 `.agents/roles/` / step 不在 `steps/` / 三形态（role/step/gate）不互斥 / retries 非非负整数（空=0）。
- advisory 告警（不阻断）：gate 含 `{a,b}` 花括号展开（仅 bash 展开，PowerShell/cmd 字面失败）／两个 role stage 授权文件 token 完全相同且无 after 先序（并行 fan-out 同文件交叉写）。
- doctor 接线：§2 布局清单补 `.agents/workflows/_TEMPLATE.md`；新增 §6.8 跑本脚本（首次引入 WARN，沿用 wf-runtime 复盘「先 WARN 升级 FAIL」渐进路径；旧版装户 sync 前脚本不存在自然跳过）。
- 顺手修复本仓库自身被 lint 抓到的实锤：`pipeline-closing.md` gate-doc 的 `fill-{intent,plan}.test.mjs` 花括号展开改为显式 `&&` 串联。

## 非目标
- 不做执行器（不做 stage 调度 / 派单 / 重试执行——执行者仍是宿主 AI，本工具只做声明校验）。
- 不改编排 DSL 语义（三形态 / after / concurrency 口径以 `_TEMPLATE.md` 为准）；不新增 run journal / 用户门形态（审查改进方向 4、5 另立）。

## 约束
- 零依赖纯 Node（≥18）；双源纪律——包源改 `templates/_agents/`，`flow-kit sync` 刷装副本。
- 只报告不修复（B-b 决策口径，同 source-sync-check）；不动 `.agents/commands/`（规则面预算中性）。

## 影响面
- 模块：pipeline
- 数据库：无
- 前端页面：无

## 触达红线（对照 AGENTS.md）
- [ ] 规则 / 契约变更 → 否（纯新增校验工具，不改既有规则语义；同 gate-checklist / source-sync-check 先例定 L1）

## 验收标准（可测试）
- [x] linter 落位双源：`templates/_agents/scripts/workflows-check.mjs` + `.agents/` 装副本 sha 一致（sync 入台账），本仓库自扫 `node .agents/scripts/workflows-check.mjs` exit 0、0 error 0 warning（证据：commit 474eb81；自扫输出「编排脚本 3 份 ✅ 0 error / 0 warning」；kit.json managed +2）
- [x] error 面全覆盖（10 类）fixture 断言：frontmatter 缺失 / concurrency 非法 / 表缺失 / id 空与重复 / after 悬空 / after 成环 / 未知 role / 未知 step / 三形态全空与双填 / retries 非法（证据：workflows-check.test.mjs S2-S7/S11-S13，套件 14 场景全 PASS，npm test 随跑）
- [x] advisory 面 fixture 断言：gate 花括号展开告警；授权文件 token 相同且有 after 先序不告警、无先序告警；`_TEMPLATE.md` 不进扫描面（证据：S8 / S9 / S10 三场景 PASS）
- [x] doctor §6.8 接线生效（自跑出现该条目且 PASS）+ §2 布局清单含 `.agents/workflows/_TEMPLATE.md`（证据：commit 474eb81 后 doctor 输出「✅ workflows 编排脚本 lint 干净」「目录布局完整（27 个关键路径）」，整体 11 PASS / 0 FAIL）
- [x] `pipeline-closing.md` gate-doc 花括号修复为显式 `&&` 串联（templates + 装副本同步改），修复后自扫 0 warning（证据：commit 474eb81 双源同改；source-sync-check --diff 报「无差异 ✅」，自扫 0 warning）
- [x] `npm test` 全绿（新增 workflows-check.test.mjs 套件 + 既有套件无回归）（证据：18 个 node 套件 + bash 套件 34/0 全绿——`node .agents/scripts/verify.mjs` 1/2 全过；期间修复测试断言自身 E 码切片 bug 一次，非实现返工）
- [x] `source-sync-check --diff` 双源 0 差异（证据：commit 474eb81 后输出「包源 55 份 | 装副本 55 份，无差异 ✅」）

## 确认与复核
- 确认日期：2026-09-25
- 确认人：用户（对话内「从1开始改进」——审查报告改进方向第 1 条）
- 确认范围：机器 linter + doctor 接线 + 本仓库花括号 gate 修复；非目标不含执行器与 DSL 语义改动
- 复核：L1 不要求独立复核
