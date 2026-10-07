---
状态: approved
级别: L2
模块: pipeline
确认指纹: c99bec2e8b2986b6
---
# PLAN — papercuts-cleanup-batch

对应入口：../intents/2026-10-08-papercuts-cleanup-batch.md
对应 spec：../specs/2026-10-08-papercuts-cleanup-batch.md

## 改动方案

- `src/sync.mjs`：owned 自愈段（:152-167）+ 模板感知段（:169-189）+ managed 台账重写（:191-194）三段整体移至生成器锚点重写段（:196-217）之后；注释更新执行顺序说明（判据细节见 spec 修 1）。
- `templates/_agents/scripts/check-loop.mjs`（三处互不嵌套）：① `delegationResultRows`（:1313-1331）改表头签名识别（委派表=含「被委派方」列 / 自做表=首列「日期」且含「任务一句话」列，`##` 节仍为收集终止符）+ 与 agg splitTables 双向互引注释；② 检查 14（:918-940）`hit === ''` 分支追加台账 OR（`.agents/confirmations.jsonl` 单次读取于循环外，坏行容忍，判据 `e.doc === rel && e.stage === 'approved'`）；③ refRe（:464）字符类移除 `，`。
- `templates/_agents/scripts/check-ledger.mjs`：无参自适应——`git diff --cached --name-only` 含 `.agents/kit.json` → 入库态模式（`git show :<path>` 暂存版优先 / `HEAD:<path>` / 皆无比盘面缺失）逐条比对不符即拦；否则工作树口径不变；报告行标注口径。
- `templates/_agents/scripts/agg-delegations.cjs`：splitTables 头注释补反向互引句（行为零改动）。
- `workflow/papercuts.md`：五处标注（batch 判据②已修 / 红线表已修 / L1 节名已修 / 节名单源已处置 / isMain 已点名待立项），症状原文不改。
- 测试：`src/sync.test.mjs` S17（wiki 生成目标变更 → sync 一次 doctor owned 零漂移）；`templates/_agents/scripts/check-loop.test.mjs`（检查 18 节标题漂移 + 负例、检查 14 三态、检查 4 全角逗号双场景）；check-ledger 入库态测试（子进程 git fixture，暂存一致过 / 指向未提交拦）。

## 任务拆解（L2/L3 必填）

1. **修 1 sync 搬移 + S17**
   - 判据：夹具含 wiki/INDEX.md 类生成目标变更 → sync **一次**后 checkOwnedDrift 零漂移；既有 S1-S16 全场景不回归。
   - 风险：中（核心升级路径顺序变化——逐段核对无数据依赖 + 全场景回归兜底）
2. **修 2 检查 18 表头签名**
   - 判据：节标题漂移（「## 委派结果表」）而表头不动 → 仍解析出账；表头也漂移（真换表）→ 静默（负例）。
   - 风险：低（识别口径单一函数）
3. **修 3 检查 14 台账 OR**
   - 判据：三态——git 无+台账有 → 不 WARN；git 有 → 不 WARN；皆无 → WARN。文案与 advisory 性质不变。
   - 风险：中（确认门安全域邻接——指纹 hard 门（检查 15）零改动，本修仅消 advisory；回溯验证兜底）
4. **修 4 检查 4 refRe**
   - 判据：路径后跟全角逗号不误报；真实断档仍拦。
   - 风险：低
5. **修 5 check-ledger 入库态**
   - 判据：提交集含 kit.json 且台账 sha 指向未提交内容 → 拦（exit 1）；入库态一致 → 过；提交集不含 kit.json → 行为与现状逐字节一致。
   - 风险：中（提交门 fail-closed 面——场景全覆盖 + 既有 ledger 测试回归）
6. **回溯验证（检查 14）**
   - 判据：git worktree 检出关键历史树（e8445c5 前后 + 存量豁免三件所在树），改前/改后 check-loop 检查 14 输出对比——零新增误报（允许既有误报消失）。
   - 风险：低（只读验证）
7. **勘误标注 + 装副本对齐 + 留痕提交**
   - 判据：papercuts 五处标注 diff 审查通过；`flow-kit sync` 后 doctor 全绿；`npm test` 全套 exit 0；independent-reviewer 复核零 P0/P1；三段式提交。
   - 风险：低

## 执行顺序（L2/L3 必填）

1 → 2 → 3 → 4 → 5 → 6 → 7（1 与 2-5 无依赖，按序做便于分段回归；6 依赖 3 的落地；7 收口）。

## 验证计划

- 静态门：`npm test` 全部套件（templates/ + shipped `.agents/` 双套件）。
- L2 追加（契约 / 口径对账）：五修各判据测试（S17 / 检查 18 双例 / 检查 14 三态 / 检查 4 双例 / check-ledger 三分支）；检查 14 回溯验证记录（worktree 重放对比，记入本 plan 偏离留痕）；sync 连跑两次幂等；装副本 sync 后 doctor 全绿。
- 无前端、无 UI、无 schema（相关行不适用）。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节；done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-10-08 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 独立复核——independent-reviewer 复核五处判据改动与测试覆盖（任务 7，提交前）
