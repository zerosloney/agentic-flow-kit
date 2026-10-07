---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-07
模块: pipeline
备注: papercuts 清账批——5 项真刺行为修复 + 4 行已修补标注（用户点名升级，攒批）
确认指纹: a1500b0e3a84876f
---
# INTENT — papercuts-cleanup-batch

## 背景与问题

用户点名「拔掉攒着的小刺，papercuts 清账 · 攒批升级」（2026-10-07 对话）——按 papercuts.md 规则「第 2 次命中或用户点名时升级」，本批把台账中未修项攒一批处置。开工前逐项核实代码真实现状，发现**登记滞后于代码**：5 项真刺待修、4 行实际已修但台账未标注。范围盘点（逐行核实证据见 spec）：

**五项真刺（行为修复）：**
1. **sync 顺序**（papercuts 2026-09-29 行）：owned 台账哈希自愈 + 模板感知 + 台账重写全部先于生成器执行，而生成器重写 owned 生成目标（INDEX/看板）后**无二次记账** → wiki 树变更后 sync 一次 doctor §6.6 owned 漂移 FAIL（一次），再跑才自愈。拟修：三段整体移到生成器执行之后，一次 sync 自洽。
2. **检查 18 两表识别与 agg 口径分叉**（2026-09-29 行）：check-loop.mjs:1316 按 `## 委派结果|自做任务结果` 节标题识别；agg-delegations.cjs splitTables 按表头签名（被委派方列 / 日期+任务一句话）识别且注释明示「不依赖节标题」——节标题漂移时 check18 静默停解析该表，L2/L3 done 回流无告警。拟修：check18 改同表头签名口径 + 互引注释 + 节标题漂移回归场景。
3. **检查 14 确认态盲区**（2026-09-29 行）：done 判据只看 git 历史行首「状态: approved」，两跳同批提交的历史不出现该行 → 误报，而 confirmations.jsonl 台账已证明两跳均走。拟修：判据改「git 历史 或 台账含该文档 approved 行」（确认事件以台账为准），并回溯验证历史件零新增误报。
4. **检查 4 refRe 全角逗号**（2026-09-29 行）：refRe 字符类含 `，`——中文文档路径引用后紧跟全角逗号时被并入引用串 → 引用断档误报（本仓已实证 2 条 + 本行首版自中）。拟修：字符类移除全角逗号 + 双场景回归。
5. **pre-commit managed 快检工作树口径**（2026-09-30 行）：check-ledger.mjs 比对工作树而非提交集入库态——sync 刷新 kit.json 后分批提交时，提交树内 kit.json 的 sha 指向「工作区已改、未提交」内容 → clone/CI 跑 doctor 必红（e8445c5 实证 6 项不符）。拟修：提交集含 kit.json 时逐条 sha 与「入库后文件」（暂存版优先、否则 HEAD 版）比对，不符即拦。

**四行已修未标注（台账勘误，无代码改动）：**
6. 行 2026-09-28（confirm-doc batch 判据）：②机制侧根治已随 batch-ledger-audit 单落地（confirm-doc.mjs batch/seq/of 字段 + 检查 15 直读事实）——补标注。
7. 行 2026-09-23（spec 模板红线表）：模板已是通用行（「按本项目 AGENTS.md 实际红线逐行填」）——补标注。
8. 行 2026-10-04（fill-plan L1 节名 vs 检查 8）：check-loop.mjs:686 已兼容「改动面/任务拆解/改动方案」三节名——补标注。
9. 行 2026-10-04（节名单源）：以「消费方三节名兼容」评估处置（多点散布风险由消费方容错吸收）——补标注。

## 历史教训/防复发

- 检索：incidents/2026-09-29-p0-gate-noise-batch（本批 2/3/4 号刺的发现批）、incidents/2026-09-26-managed-ledger-adopt（check-ledger 前置单）、2026-10-07-verify-evidence（凭证语义——检查 14 修法不得与 done 前置凭证对账冲突）。
- 避坑：①门禁改动一律带回归测试（本仓先例：修哪查哪 + S 编号场景钉住）；②sync 动顺序须跑全套 + 装副本 sync 对齐（双源纪律）；③检查 14 改判据后回溯验证历史树零新增误报（papercuts 行明示要求）；④台账标注更新只写「已修/已处置 + 引证（单号/commit）」，不改症状描述（审计可见性）。

## 目标

- 五项行为修复全部落地并带回归测试，`npm test` 全套件通过，flow-kit sync 装副本对齐、doctor 全绿。
- 检查 14 修法附回溯验证记录（历史树重放零新增误报）。
- papercuts.md 九行处置标注更新（5 修 + 4 勘误），症状描述原文保留。

## 非目标（防止范围蔓延）

- **check-loop isMain 可 import 化重构**（2026-10-04 行）：结构性重构（1600+ 行顶层执行段 main 化）diff 巨大且回归面全量，与本批行为修复混批不可审——**单独立项**，本批仅在该行补「已点名、待立项」记录。
- 检查 17 弱映射（提交说明→主题名）：papercuts 已定性不做（release-draft-scope 评估），不动。
- 各「不再处理 / 保留即审计可见性」定性行：不动。
- 节名单源化的进一步收紧（共享常量模块）：三节名兼容已消除误报痛点，单源化收益递减，不做。
- confirm-doc batch 判据的进一步改动：已落地，不重开。

## 约束

- 引擎双源纪律：check-loop / check-ledger / sync 改动一律改 `templates/_agents/` + `src/`（sync 为包源纯 src 件），装副本走 `flow-kit sync` 成对提交。
- 门禁行为改动全带回归测试；检查 14 加台账分支不得弱化 git 历史判据（OR 并集，非替换）。
- 存量豁免标记（check-loop.mjs:928「存量确认态豁免」）不删（删既有代码 STOP 线）——修法生效后其服务对象自然消失，保留无害，退役条件写入 spec。

## 影响面

- 模块：pipeline
- 数据库：无
- 触达红线：规则 / 契约变更（检查 4/14/18 判据 + check-ledger 口径 + sync 段顺序）→ L2，spec 逐项论证

## 验收标准（可测试）

- [ ] sync 顺序：夹具含 wiki 生成目标变更 → sync **一次**后 doctor owned 零漂移（不再需要二次 sync）（证据：sync 测试新场景）
- [ ] 检查 18：夹具 delegations.md 节标题漂移（如「## 委派结果表」）而表头不动 → 检查 18 仍解析并出账（证据：check-loop 测试新场景）
- [ ] 检查 14：夹具两跳同批提交（git 历史无行首 approved 行）+ confirmations.jsonl 含 approved 行 → 不再 WARN；仅 git 或仅台账任一在 → 亦不 WARN；两者皆无 → 仍 WARN（证据：check-loop 测试新场景 ×3 态 + 回溯验证记录）
- [ ] 检查 4：路径引用后跟全角逗号 → 不再误报；真实引用断档仍拦（证据：check-loop 测试双场景）
- [ ] check-ledger：提交集含 kit.json 且台账 sha 指向未提交内容 → 拦；入库态一致 → 过（证据：check-ledger 测试新场景）
- [ ] papercuts.md 九行标注更新，症状描述原文未改（证据：diff 审查）
- [ ] `npm test` 全套通过 + `flow-kit sync` 后 doctor 全绿（证据：verify 凭证落账）

## 确认与复核

- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：intent 全文（含五项真刺范围圈定与 isMain 留单独立项的非目标决策）
- 复核：L2 防御道——实现后 independent-reviewer 复核（判据改动五处 + 回溯验证），时机在 plan 约定
