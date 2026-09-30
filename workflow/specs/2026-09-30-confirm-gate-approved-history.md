---
状态: done
级别: L2
日期: 2026-09-30
模块: pipeline
备注: spec 关联 intent / plan 的同名主题；判据单源（stage-gates.mjs），check-loop 检查 14 与 confirm-doc done 前置门共用命中判定
确认指纹: 5831e2c2cfaf2b2b
---
# SPEC — confirm-gate-approved-history

<!-- 与 intents/ 下同名入口文档配对；L2/L3 必须先有 ../intents/YYYY-MM-DD-<主题>.md approved -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->

## 功能行为

**场景一（正常关单放行）**：intent / spec / plan 任一处于 approved，且其 approved 态已进 git 历史（历史提交中曾出现行首「状态: approved」）→ `confirm-doc` 的 →done 正常落账（写盘 + 台账），与既有行为一致。

**场景二（主拦截——防「先 done 后提交 / 两跳同批」）**：文档 approved 态从未进 git 历史 → `confirm-doc` →done **拒绝**：非零退出（复用既有 `refused` 的 exit 2 信号）、台账零新增、零写盘、状态不变；stderr 提示先提交后重试。

**场景三（豁免与边界）**：
- 非 git 环境 / 无 HEAD（`rev-parse --git-dir` 或 `rev-parse --verify HEAD` 失败）→ 跳过（沿检查 14 口径，不误拦）。
- 正文行首含 `流程: legacy` → 跳过（沿全项目存量口径）。
- 正文含 `存量确认态豁免（` 声明 → 跳过（与检查 14 同标记；显式声明式逃生口）。
- git 命中调用失败（返回 null）→ 跳过（fail-open 边界，与检查 14 同口径）。
- draft→approved 及其他跳转（--to 终态 / incidents fixed·closed）不加此校验。

**场景四（两形态）**：TTY 与 --delegated 均执行该校验（校验位于共同前置段、两分支之前）。

**场景五（检查 14 单源化）**：check-loop 检查 14 的命中判据改为调用共享函数 `approvedTraceHit`；检查语义、级别（恒 advisory）、时机、文案、豁免策略（日期档 / 存量标记）零变化。

## 数据流

1. `confirm-doc` 主循环：读文档 → `resolveTransition` 得 target → 既有逐阶段前置门（draft→approved）之后，**新增**：`target === 'done'` 时调用 `doneGateFor(root, abs, doc)`。
2. `doneGateFor`：读正文（legacy 标记 / 存量豁免声明）→ `gitReady(root)`（两条 rev-parse）→ `approvedTraceHit(root, rel)`（`git log -1 --format=%H -G '^状态:[[:space:]]*approved' -- <rel>`）→ 三态判决（命中 sha / 空=缺失 / null=调用失败）。
3. 拒绝路径：stderr 提示 + `refused++` + continue（零写盘、零台账，与既有前置门同款）；放行路径：沿既有指纹 / 落账 / 写盘流程。
4. `check-loop` 检查 14：段级 git 环境门与日期档 / 标记豁免保留原样；文档级命中一行改调 `approvedTraceHit(ROOT, rel)`（行为等价：失败→null 不报、空串→报）。

## 系统改动

| 文件 | 侧 | 改动 |
|------|-----|------|
| templates/_agents/scripts/stage-gates.mjs | 包源 | 新增 `gitRun`（内部 helper）+ `gitReady` + `approvedTraceHit` + `doneGateFor`（命中判据单源；confirm-doc 与 check-loop 共用） |
| templates/_agents/scripts/confirm-doc.mjs | 包源 | done 前置门接线（主循环 target==='done' 分支）+ import doneGateFor |
| templates/_agents/scripts/confirm-doc.test.mjs | 包源 | 新增场景（放行 / 拒绝四断言 / 非 git 跳过 / legacy 跳过 / 存量豁免声明跳过）；含 git fixture helper（参考 check-loop.test 的 gitInit / gitCommitAll 手法） |
| templates/_agents/scripts/check-loop.mjs | 包源 | 检查 14 命中判据改调 `approvedTraceHit`（一行 + import；行为零变化） |
| templates/_agents/scripts/check-loop.test.mjs | 包源 | 检查 14 三条既有场景回归（无新增加固项——单源后两调用方结构一致） |
| templates/_agents/commands/test.md | 包源 | 关单清单加「approved 留痕提交」：关单前确认三件套 approved 态已提交（done 前置门校验）；done 后提交其余 |
| .agents/** 各 managed 副本 + kit.json | 装副本 | sync 自动刷新 sha 台账 |
| 宿主薄适配（test.md 对应件） | 装副本 | sync-hosts --apply 刷新 |

## 约束遵守映射

- **intent 非目标「不改 check14」**：其检查语义 / 级别（恒 advisory）/ 时机 / 文案 / 豁免策略（日期档、存量标记）全部不动；仅命中判据改从共享函数取（消除双份实现漂移风险）。行为零变化由 check-loop 全套件回归（含检查 14 三条场景）证明。
- **「判据单源」（复核 N3 教训）**：`-G` 命令行与「空=缺失 / sha=命中 / null=失败」三态语义唯一实现在 stage-gates.mjs；confirm-doc 与 check-loop 均为调用方，结构上不可漂移。
- **复用 confirm-doc 既有前置模式**：拒绝 = 非零退出 + 回退指引 + 零落账 + 零写盘（stage-gate 引入的同款哲学）；`refused` 信号复用。
- **fail 语义与非 git 口径**沿检查 14（跳过，不误拦）；诚实边界：本地环境（可删 .git / 手写文件）不可机器防，沿 2026-09-28 信任边界声明口径。
- **豁免面与信任边界（2026-09-30 复核 P2-3/P2-4 声明）**：
  - **刻意不设日期档豁免**（与检查 14 的差异，显式声明）：检查 14 对「日期 < check14Since(2026-09-26)」的 done 文档跳过；done 门**不设**此档——自报日期可被手填（2026-09-28 教训：生效日锚已改台账 ts），拿它做豁免即自举漏洞。存量误拦出口由 legacy 与「存量确认态豁免（」两条提供。
  - **声明标记强度不对等（声明）**：`存量确认态豁免（` 同时关闭检查 14（advisory）与 done 硬门——任何文档加一行即可绕过，属本地信任边界内不可机器防（与手改台账 / 伪造 git 时间戳同级），事后对质靠 git 历史与台账。
- **双源纪律**：改 templates/_agents/ 包源 → sync 刷装副本；测试双源同跑。
- **门禁自包含**：stage-gates.mjs 为既有共享判据模块；新增依赖仅 node 内置（child_process / fs / path）。

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| 门误拦（已提交但形态特殊被判缺失） | 低 | 判据与检查 14 完全同款命令行（`-G` 正则 `^状态:[[:space:]]*approved` 容忍非规范分隔符）；双向测试；存量豁免声明逃生口 |
| 非 git / git 失败环境被拦死 | 低 | `gitReady` / 命中失败 → 跳过（检查 14 同口径）+ spec 声明边界 |
| check-loop 改造引入回归 | 低 | 改动仅一行 + import；检查 14 三条场景 + 全套件回归 |
| 关单流程多一次提交 | 低 | 设计使然（留痕目的）；test.md 写明顺序，拒绝提示语给出具体命令 |
| 测试 fixture 需建 git 仓库 | 低 | 参考 check-loop.test 既有 gitInit / gitCommitAll 手法，复制最小可用版本 |

## 确认与复核

- 确认日期：2026-09-30（台账 ts 2026-09-30T06:53:21Z，source=chat-delegated，原话「可以」，batch cf492e）
- 复核：L2 独立复核已执行一次（independent-reviewer「临舟」，独立上下文，2026-09-30）——**0 P0 / 0 P1 / P2×6**。处置：P2-1（S26 台账读取加保护，防崩溃截断 S27–S29）已修；P2-5（test.md 措辞改「本次关单文档」）已修；P2-6 随 P2-1 恢复可观测；P2-2（git 封装两份实现）已在 stage-gates.mjs 加登记注释；P2-3 / P2-4（无日期档豁免、声明标记强度不对等）已由上方「豁免面与信任边界」显式声明。
