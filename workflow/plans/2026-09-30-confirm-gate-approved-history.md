---
状态: done
级别: L2
模块: pipeline
确认指纹: a3bc98f1c4441d86
---
# PLAN — confirm-gate-approved-history

<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 极简形态（2026-09-13 瘦身，L1 默认）：单/少文件微改动只填「改动面」+「验证方式」两节——改动面逐条列改哪个文件做什么（判据细节直接写进条目），验证一行静态门 + 按需 UI 实测；任务拆解/执行顺序仅 L1 多文件多步骤时保留 -->

对应入口：../intents/2026-09-30-confirm-gate-approved-history.md
对应 spec：../specs/2026-09-30-confirm-gate-approved-history.md

## 改动面（L1 极简形态主节；L2/L3 可作任务拆解的汇总或删本节）

- `templates/_agents/scripts/stage-gates.mjs`：新增 `gitRun`（内部 helper）/ `gitReady` / `approvedTraceHit` / `doneGateFor`——命中判据单源（check-loop 检查 14 与 confirm-doc done 门共用）
- `templates/_agents/scripts/confirm-doc.mjs`：主循环接线 done 前置门（target==='done' 分支，与既有 draft→approved 门同款：拒绝 = 非零退出 + 零落账 + 零写盘 + 回退指引）+ import
- `templates/_agents/scripts/confirm-doc.test.mjs`：新增场景（放行 / 拒绝四断言 / 非 git 跳过 / legacy 跳过 / 存量豁免声明跳过）；含 git fixture helper
- `templates/_agents/scripts/check-loop.mjs`：检查 14 命中判据改调 `approvedTraceHit`（一行 + import；行为零变化，豁免策略/文案/级别全不动）
- `templates/_agents/scripts/check-loop.test.mjs`：检查 14 三条既有场景回归（无新增）
- `templates/_agents/commands/test.md`：关单清单加「approved 留痕提交」步骤（关单前确认三件套 approved 态已提交；done 后提交其余）
- `.agents/**` 各 managed 副本 + kit.json + 宿主薄适配：sync / sync-hosts 自动刷新

## 任务拆解（L2/L3 必填；L1 仅多文件多步骤时用，单任务微改动删本节）

1. stage-gates.mjs 新增共享判据（gitRun / gitReady / approvedTraceHit / doneGateFor）
   - 判据：四函数导出；`approvedTraceHit` 三态（空串 / sha / null）在临时仓手工验证正确；`doneGateFor` 各豁免分支返回 `{ok:true, skipped}`；node 加载无语法错
   - 风险：低（纯新增，无既有调用方受影响）
2. confirm-doc.mjs 接线 done 前置门
   - 判据：主循环 `target === 'done'` 分支调用 `doneGateFor`；拒绝路径复用 `refused` 信号（exit 2）、零台账、零写盘、文案含回退指引
   - 风险：低（与既有 draft→approved 门同款模式）
3. confirm-doc.test.mjs 新增场景 5 类
   - 判据：新场景全绿 + 既有 S1–S24 零回归；git fixture = init + user config + commit（参考 check-loop.test 既有手法）
   - 风险：中（git fixture 需最小可用；Windows 下 git 可执行名与 check-loop 同口径 git.exe）
4. check-loop.mjs 检查 14 判据改调共享函数
   - 判据：检查 14 三条既有场景（「无 approved 历史 → WARN」「留痕 → 无告警」「非 git → 跳过」）全绿；全套件回归
   - 风险：低（一行 + import；行为等价：失败→null 不报、空串→报）
5. test.md 文档更新 + 宿主同步
   - 判据：sync-hosts --diff 0 漂移；source-sync-check --gate 0 差异
   - 风险：低
6. 双源 sync + 全量验证
   - 判据：npm test 全绿 + doctor + check-loop 实跑（存量告警面无新增）+ 四门全绿
   - 风险：低

## 执行顺序（L2/L3 必填；L1 单文件微改动删本节）

1 → 2 → 3 → 4 → 5 → 6；依赖：1 为 2 / 4 前置（共享函数先落）；2 与 3 成对（实现 + 测试）；4 独立于 2（改的是 check-loop 侧）；5 独立；6 收尾。

本单自身按新流程实践：三件套 approved 态**先提交留痕**（提交计划随 build 阶段报你确认）→ 实施 → 关单 → 提交其余——即本单机制要保证的「先 approved 后 done」顺序，自己先做到。

## 验证方式

- 静态门：`npm test`（全量套件）；confirm-doc.test 新场景双向 + check-loop.test 检查 14 回归
- 规则面对账（L2 追加）：check-loop 实跑——「确认态缺失」存量 3 条（adopter-derivers + stage-gate-machine ×2）不新增、总数无回归；双源 `source-sync-check --gate` 0 差异；`sync-hosts --diff` 0 漂移
- 手工冒烟：临时 git 仓——① 提交过 approved 态 → confirm-doc done 放行；② 从未提交 approved（首提交即 done 形态）→ done 被拒（exit 2 / 零台账 / 状态不变）

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-09-30 用户对话内确认，原话「我已确认」，代录 batch 35b4be；台账 ts 2026-09-30T06:55:46Z）；done（待关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 独立复核已执行（**0 P0 / 0 P1 / P2×6**，independent-reviewer「临舟」，2026-09-30）；处置与声明见同名 spec「确认与复核」与「约束遵守映射」节
