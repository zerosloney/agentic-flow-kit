---
状态: done
级别: L2
日期: 2026-10-07
模块: pipeline
备注: 关联 intents/plans 2026-10-08-papercuts-cleanup-batch（L2 防御道，intent 已 approved；五真刺 + 四勘误）
确认指纹: ca545800eccfacf9
---
# SPEC — papercuts-cleanup-batch

## 功能行为

**修 1 · sync 一次自洽（src/sync.mjs）**：现状「owned 台账哈希自愈段（:152-167）→ 模板感知段（:169-189）→ managed 台账重写（:191-194）→ 生成器锚点重写（:196-217）」——生成器重写 owned 生成目标（workflow/INDEX.md / wiki/INDEX.md / wiki/知识沉淀总览.html）后台账无二次记账 → wiki 树变更后 sync 一次 doctor §6.6 owned 漂移 FAIL。修法：**owned 自愈段 + 模板感知段 + 台账重写三段整体移到生成器段之后**（生成器只在盘面重写文件，moved 三段不依赖 fresh map——自愈读盘面、感知经 srcTemplatePath 直读包源，移动安全）。输出顺序变为「分派报告 → 生成器 → owned 刷新/感知/台账重写 → doctor」。行为不变式：三段自身逻辑零改动，仅执行顺序变化；sync 幂等性不回归（连跑两次结果一致）。

**修 2 · 检查 18 表头签名识别（templates/_agents/scripts/check-loop.mjs delegationResultRows :1313-1331）**：现状按 `^##\s+(委派结果|自做任务结果)$` 节标题切段，节标题漂移（如「## 委派结果表」）→ 静默停解析。修法：改按**表头签名**识别两张表（与 agg-delegations.cjs splitTables :44-51 同构）——行切分后「含 `被委派方` 列的行」= 委派表头、「首列 `日期` 且含 `任务一句话` 列的行」= 自做表头；命中任一表头后收集其数据行（首列日期、跳过分隔行）直到下一个表头/`##` 节边界。**互引注释双向补齐**（check-loop 侧已有「与 splitTables 保持一致」句，补 agg 侧反向句）。其余判据（日期 ≥ 文档日期、含文件名/去 .md 名、delegationSince 豁免）零改动。

**修 3 · 检查 14 台账 OR 判据（check-loop.mjs :918-940）**：现状 `approvedTraceHit` 只看 git 历史（hit === '' 即 WARN）。修法：hit === '' 时**追加**台账判定——读 `.agents/confirmations.jsonl`（坏行容忍跳过，与检查 15 :1153 同读法），存在 `e.doc === rel && e.stage === 'approved'` 的行则不 WARN（确认事件以台账为准；git 历史判据保留为 OR 的另一半，不弱化）。台账读取在循环外单次完成（一次 IO，不逐文档重读）。WARN 文案不变。存量豁免标记（:928「存量确认态豁免」）**保留不删**：修法生效后其服务对象（两跳同批存量）自然消失，保留无害；退役条件 = 连续两个版本周期零命中（届时另行清理，本批不动）。

**修 4 · 检查 4 refRe 全角逗号（check-loop.mjs :464）**：字符类 `[A-Za-z0-9_./{},，*-]` 移除 `，` → `[A-Za-z0-9_./{},*-]`（花括号保留——`{{VAR}}` 占位引用形态仍需支持）。引用扫描遇全角逗号即终止引用串 → 引用断档误报消除；真实断档（引用不存在路径）判据不变仍拦。

**修 5 · check-ledger 入库态口径（templates/_agents/scripts/check-ledger.mjs）**：现状无参恒比工作树（:1/:49）。修法：无参运行时自适应——`git diff --cached --name-only` 含 `.agents/kit.json` 时进入**入库态模式**：台账每条 managed 条目的 sha 与「入库后文件」比对（`git show :<path>` 暂存版；暂存区无该文件（未暂存改动/新增未 add）→ `git show HEAD:<path>`；两者皆无 → 按盘面缺失报）；任一不符即拦（exit 1）。提交集不含 kit.json 时维持工作树口径不变（零行为变化）。报告行注明当前口径（「工作树」/「入库态（提交集含 kit.json）」）。
> **订正注记（2026-10-08 独立复核 P1 后）**：上段括号理由事实性有误——未暂存 ≠ 不在 index（`:rel` 对未暂存改动/新增未 add 均命中），HEAD 兜底唯一可达路径是暂存删除，兜底会把「提交树已无该件而台账仍跟踪」的提交门绕过误放行。实现落终态 = **暂存版=index，暂存删除即拦（gone）**；kit.json 暂存删除 = 退出性提交放行；触发口径拓宽为「暂存区非空即入库态」（窄口径堵不住只 add 件不 add 台账的姊妹漏洞）。权威口径以同名 plan「偏离留痕①」与实现注释为准。

**勘误 · papercuts.md 四行标注**：行 2026-09-28（batch 判据②）→ 补「已修（2026-09-28 batch-ledger-audit：batch/seq/of 写入时事实字段 + 检查 15 直读判定，向后兼容零回填）」；行 2026-09-23（spec 模板红线表）→ 补「已修（模板已通用化，无单号——2026-10-07 清账批核实）」；行 2026-10-04（fill-plan L1 节名）→ 补「已修（check-loop verifyEvidenceTruth 兼容 改动面/任务拆解/改动方案 三节名，2026-10-07 清账批核实）」；行 2026-10-04（节名单源）→ 补「已处置（以消费方三节名容错吸收多点漂移风险，2026-10-07 清账批核实）」；行 2026-10-04（isMain）→ 补「已点名（2026-10-07 清账批），待单独立项」。症状描述原文一律不改。

**边界与异常**：修 2 中 `##` 节边界仍作收集终止符（表在节内、跨节必换表头，安全）；修 3 非 git 仓 / 台账文件缺失 → 行为与现状一致（hit 为 null 不报、台账缺失视为无 approved 行——但此时 git 判据也拿不到 HEAD，整段本就跳过）；修 5 非 git 仓 → 维持现状（check-ledger 前置条件 git 可用）；五修互不依赖，任一单独成立。

## 数据流

- 修 1：包源渲染（fresh）→ 三态分派报告 → **生成器重写盘面** → owned 自愈（盘面→台账 sha）→ 模板感知（包源 vs 锚 vs 盘面）→ **kit.json 重写（含生成后盘面）** → doctor。此前：台账重写 → 生成器重写（盘面漂出台账）→ doctor FAIL。
- 修 2/3/4：check-loop 启动 → delegationResultRows（表头签名）/ confirmations.jsonl（单次读取）/ refRe（去全角逗号）→ warnings 判定。台账数据源 `.agents/confirmations.jsonl`（append-only，confirm-doc 写侧零改动）。
- 修 5：pre-commit → check-ledger 无参 → git diff --cached 判提交集 → 含 kit.json：`git show :<path>` / `git show HEAD:<path>` 逐条比对 → exit 0/1；不含：读盘面比对（现状）。

## 系统改动

1. **修改** `src/sync.mjs`：三段（owned 自愈 / 模板感知 / 台账重写）移至生成器段之后（约 60 行块整体搬移 + 注释更新）。
2. **修改** `templates/_agents/scripts/check-loop.mjs`：delegationResultRows 表头签名化；检查 14 台账 OR 分支（含 confirmations.jsonl 单次读取）；refRe 移除 `，`。三处互不嵌套。
3. **修改** `templates/_agents/scripts/check-ledger.mjs`：无参自适应入库态模式（git show :path / HEAD:path）+ 报告行口径标注。
4. **修改** `templates/_agents/scripts/agg-delegations.cjs`：仅补反向互引注释（行为零改动）。
5. **测试**：src/sync.test.mjs（S17：wiki 生成目标变更 → sync 一次 doctor owned 零漂移）；templates/_agents/scripts/check-loop.test.mjs（检查 18 节标题漂移场景、检查 14 三态场景〔git 无+台账有 / git 有 / 皆无〕、检查 4 全角逗号双场景）；templates/_agents/scripts/check-ledger.mjs 新增测试或并入现有套件（入库态两分支）。
6. **修改** `workflow/papercuts.md`：五处标注（勘误四行 + isMain 点名行）。
7. 实现后 `node bin/flow-kit.mjs sync`（check-loop / check-ledger / agg 为 managed，装副本成对刷新）+ `npm test` 全套。

无新增文件、无删除；confirm-doc 写侧与五项判据的其余逻辑零改动。

## 约束遵守映射

| 红线 / 约束 | 本 spec 如何满足 |
|---|---|
| 引擎双源纪律 | templates/_agents 三件 + sync 改包源 → flow-kit sync 装副本成对提交；papercuts.md 属 owned 项目留痕直改 |
| 门禁改动带回归测试（仓先例） | 五修各钉测试场景（S17 + 检查 18/14/4/ledger 新场景），关单前 npm test 全套 |
| 检查 14 判据不得弱化 | OR 并集：git 历史判据原样保留，台账仅作第二通道；回溯验证零新增误报（历史树重放对比改前改后） |
| 删既有代码 STOP 线 | 存量豁免标记保留（退役条件记录在案）；零删除 |
| 勘误不改症状原文 | papercuts 标注只追加处置结论与引证，不改写症状描述（审计可见性先例） |
| 确认门机器事实不可伪装 | 修 3 读台账判「存在 approved 行」，与检查 15 指纹对账并行不悖（指纹仍是 hard 门，本修仅消 advisory 误报） |

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| sync 三段搬移引入执行顺序回归（感知段依赖台账重写前状态？） | 低 | 三段间无数据依赖（逐段核对）；S17 + 既有 sync 全场景回归；doctor 收尾自检 |
| 检查 18 表头签名误收其他表数据行 | 低 | 双签名并集仅命中两张结果表；metrics 等表头不含「被委派方/任务一句话」；回归含负例 |
| 检查 14 台账 OR 被滥用于伪装（伪造台账行） | 低 | 台账 hard 门（检查 15 指纹对账）独立把关伪造行；本修只消 advisory 误报，攻击面无扩大（伪造台账行本来就要过指纹门） |
| check-ledger 入库态模式误拦（HEAD 无该文件的全新台账） | 低 | `git show HEAD:` 失败 → 按盘面缺失报（与现状同）；全新安装首次提交场景实测 |
| refRe 收紧后引用串截断变化引发新误报 | 低 | 全角逗号在本仓语料零实际引用使用（p0-gate-noise-batch 已扫描论证）；双场景回归 |
| 历史回溯验证脚本一次性成本 | 低 | git worktree 检出 2-3 个关键提交（e8445c5 前后 + 存量豁免三件所在树）对比改前改后检查 14 输出，记录进 plan 偏离留痕 |

## 确认与复核

- 确认日期：2026-10-08（对话原话「确认」）
- 复核：L2 推荐独立复核——independent-reviewer 已于实现后复核（2026-10-08，判定「需修复后提交」→ P1 当场修复后原路通过；处置记录见 plan「偏离留痕」与上方修 5 订正注记）
