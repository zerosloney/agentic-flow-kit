# 门禁减重立项（gate-diet，2026-10-23）

> 目标：在**不降验证语义**的前提下压本地关单墙钟。当前全量墙钟 ~130–193s（并发池 j3 膝点，see
> verify.mjs 编排注释），关键路径 = backend-test。本文件是**立项基线与实验清单**——执行按 perf 技能
> 单变量纪律走（`.agents/skills/perf/SKILL.md`），每项实验独立提交、独立复测、过噪声带才算数。

## 1. 基线（2026-10-23，源 `.agents/verifications.jsonl` 216 行机器台账）

证据快照：`tmp/perf/gate-diet-baseline.json`（本机生成；下表为同数据摘要，12 逻辑核）。

| 门 | 近10均 | 峰值 | 场次 | 备注 |
|---|---|---|---|---|
| backend-test | **100s** | 214s | 69 | 关键路径；`dotnet test --no-build`（diet③ 已消双构建）；**负载敏感**：安静窗 91s vs 忙窗 146s |
| ledger-invariant | 90s | 107s | 55 | **历史数据**——diet⑥（2026-10-21）起该门已退出本地路径（`envSkipIds` 条件 `!TF_BUILD` 不分 scope/full 档），末次实执行 2026-10-21 04:57（head 8a5799f8）；本地全量/差分均 envSkips 记录跳过，执法面 = CI main 全量 + pre-commit --staged |
| engine-tests | 74s | 133s | 73 | npm test 53 套件并发 12；最慢三套件 check-loop.test 39–53s / check-ledger-invariant.test 30–45s / check-loop-rev.test 32–44s |
| secrets-scan | 30s | 36s | 73 | gitleaks 全仓全史扫描 |
| check-loop | 20s | 34s | 73 | — |
| frontend-build | 17s | 26s | 71 | 本地档已瘦身为 vue-tsc（diet④） |
| **全量墙钟** | **~130–193s** | 193s | — | j2 178 / j3 122 / j4 129 / j6 137（并发膝点实测在 3） |

**噪声带结论（先于任何优化）**：backend-test 同日两次全绿运行 91s ↔ 146s（差 60%）——共享 dev 库
（集成测试连真库）+ 同机并行会话是主要噪声源。**任何 <60s 的 backend-test「改善」都不可信**，复测须
安静窗 + ≥3 次取中位（number-vetting 口径）。这本身是立项发现 #0：**先消噪声源（专用测试库 TEST_DB_CONN，2026-10-23 库供给已落地 = `Deve_CSS_SuHao`，见 runtime-env §6.5），减重测量才有可信地基**。

## 2. 实验清单（按预期收益 ÷ 风险排序；一次一个变量）

| # | 假设 | 单变量改动 | 预期 | 风险/取舍 |
|---|---|---|---|---|
| 0 | 噪声源污染测量与稳定度 | 配置专用测试库连接（TEST_DB_CONN，runtime-env §6.5 已登记机制） | 集成测试不碰共享 dev 库：消除撞号/超时脆红（2026-10-22 三连红即此类）+ 噪声带收窄 | 需 DBA 供库；纯环境改动不动代码 |
| 1 | ~~backend-test 内部串行~~ → **改判**：Tests 独跑 1657 用例仅 3s，91–146s 几乎全是 IntegrationTests（605 用例，真库往返主导）——双进程并行收益 3–5s < 噪声带，不单独立项 | ~~双进程并行~~ | ≈5s | 无（结论见 §4） |
| 2 | ~~xunit 并行度未开满~~ → **折叠进 #0**：两 csproj 均无并行限制（默认集合并行已开），真约束是**真库数据互踩** | 依赖 #0 | #0 后另估 | 与 #0 合并评估 |
| 3 | ~~engine-tests 慢三套件重复 spawn~~ → **改判**：套件内可省 30s+（check-loop.test 12 处 spawn 为最长杆），但 engine-tests 被 backend 链在 j3 池**完全吸收**，墙钟零收益；待 backend 链 <60s 再启动 **→ 2026-10-23 复测：调度/分片旋钮已到拐点（并发 12、K=8），剩余杠杆是 135 个场景的 node 启动/夹具成本，需代码级改造（见 §4）** | 套件内 fixture spawn 共享 | 墙钟 0（段内 -30~50%） | 测试独立性 |
| 4 | secrets-scan 全史扫 | ~~gitleaks 基线 + 增量~~ | 30s → ~5s | **✘ 不采纳（2026-10-23 owner 委托裁定，"按推荐解法"）**：30s 收益不在关键路径（关键路径 = backend-test 100s）；且 2026-10-21 密钥口径本地退役后，secrets-scan 全史扫是**唯一**的历史泄露执法面——增量化对存量泄露失明，削的是安全语义不是耗时。保持全史扫 |
| ~~5~~ | ~~ledger-invariant 全量档本地执行~~ | — | — | **✘ 撤回（2026-10-23，前提证伪）**：diet⑥ 的 envSkipIds 条件（`!TF_BUILD`）本就**不分 scope/full 档**——ledger-invariant 末次实执行 2026-10-21 04:57（head 8a5799f8），此后本地全量/差分均 envSkips 记录跳过。立项基线误把台账**历史聚合值**（近10均 90s）读成现行行为。教训已固化：看板门表增「末次执行」列（40b6a9e7 后续提交），聚合均值不再掩盖「门已退役出本地路径」的事实 |
| 6 | 并发膝点复测 | 顺延至 #0 与 backend 链实质变化之后——当前变量未动，复测无信息量 | — | 纯测量，零代码 |
| 1' | （#0 解锁后的新杠杆）IntegrationTests 库隔离并行：每 collection 独立 schema/库，提 MaxParallelThreads 或分区并发 | 依赖 #0 供库形态 | 605 用例 90–140s，DB 往返主导——隔离后并行度才有意义 | 分区工作量真实存在；#0 落地后单独立项评估 **→ 2026-10-23 落地并实测（见 §4；隔离单位 = 库副本，进程级分区）** |

## 3. 验收与回滚

- 每项实验：基线 3 次 / 改动 / 复测 3 次（安静窗）/ 结论落账于本文件 §4；改善未过噪声带 → 回滚或记「未证实」。
- 门禁减重的红线：**门数不減、断言不減**（只减耗时不减语义）；任何「删门」类提议不在本立项范围
  （走机制退役流程，单源 mechanism-registry.md）。
- 总目标（软）：全量墙钟 193s 峰值 → **≤90s**（j3 池），以 #0–#3 全落地为前提（#4/#5 已裁定不动）。

## 4. 实验落账（执行时逐行追加）

| 日期 | 实验 | 基线 | 复测 | 结论 |
|---|---|---|---|---|
| 2026-10-23 | #4 secrets-scan 增量 | 30s（近10均） | — | **不采纳**：非关键路径 + 削唯一历史泄露执法面（安全语义 > 耗时）；owner 委托"按推荐解法" |
| 2026-10-23 | #5 ledger-invariant 全量档 | 误读的 90s | — | **撤回**：前提证伪——diet⑥ 已覆盖全档（envSkips 实证，末次实执行 2026-10-21）；基线误读历史聚合值，看板门表补「末次执行」列作防再犯 |
| 2026-10-23 | #1 双项目并行 | Tests 独跑 3s（1657 用例）/ Integration ≈90–140s（605 用例） | — | **不采纳**：max−sum ≈ 3–5s 低于噪声带；backend-test 权重 ≈ IntegrationTests，杠杆收敛到 #0（专库）→ 1'（库隔离并行） |
| 2026-10-23 | #2 xunit 并行度 | csproj 无并行限制（默认集合并行已开） | — | **折叠进 #0**：约束是真库数据互踩，非调度配置 |
| 2026-10-23 | #3 引擎慢三套件 | engine-tests 74s / check-loop.test 39–53s | — | **挂起**：套件内可省 30s+，但 engine-tests 被 backend 链（~112s）在 j3 池完全吸收，墙钟零收益；待 backend 链 <60s 再启动 |
| 2026-10-23 | #0 专用测试库（库供给落地） | IntegrationTests 对共享 dev 库（噪声带 60%） | 对 SuHao **605/605 全绿**（564→598→602→605 四轮收敛；详见数据维护台账 2026-10-23 行） | **完成**——1'（IntegrationTests 库隔离并行）具备评估前提 |
| 2026-10-23 | #1' 集成测试库隔离分区（进程级） | 串行 605/605：测试 53s / 墙钟 55s（专用库安静窗）；backend-test 门（单测+集成）≈59s | 3 分区：集成段 21.3–27.2s，wrapper（单测串行+分区并行）30.2–32.8s，3 轮全绿（1657 单测 + 605 集成） | **采纳**：进程内并行先实测挂死（共享 `MM_SYS_MaterialCode` / `MM_INV_InventoryRecord` 行 X 锁互等，SQL 默认无锁超时，4 线程 6 分钟不收敛）——隔离单位改为独立库副本，入口 `scripts/verify/backend/run-integration-partitions.mjs`，库供给见 runtime-env §6.5。附带发现：单测 `PurchaseOrderNoConcurrencyTests.并发取号_序号互不重复且连续` 在与分区并发负载下 2/3 轮红（既有脆点，非本次引入）→ wrapper 保持单测串行 |
| 2026-10-23 | #3 调度旋钮（run-tests 并发） | 并发 12：墙钟 91.2–92.6s，check-loop.test 64.4–65.6s | 并发 8：104–111.5s；6：110.2–115.3s；16：113.9–118s；20：110.5–130s | **不采纳改动**：12 已是拐点，升降均更慢（套件池 + 分片叠加超订）。并发 12 保留 |
| 2026-10-23 | #3 分片旋钮（check-loop.test K） | K=8 独跑：44.1–44.9s | K=6：47.8–56s；12：59.9–78s；16：51.9–55.7s | **不采纳改动**：K=8 已是拐点。run-tests 内 65s 与独跑 44.5s 的差 = 套件池争用，非分片不足 |
| 2026-10-23 | #3 verify 争用复测（K=4） | verify 全量 139.4s / engine-tests 133.9s（K=8） | 未取得 | **阻断**：secrets 门红（外部分支历史泄漏 `frontend/.npmrc`，非本轮改动）→ fail-fast。先处置密钥后再复测 |
| 2026-10-23 | #3 剩余杠杆判定 | 135 场景 × 每场景 1 次 `node check-loop.mjs` 启动 + git 夹具 | — | **需代码级改造**：in-process/resettable check-loop 或场景批处理，预计可省 10–20s；属多文件重构，另行评估 |
| 2026-10-27 | #7 ledger-invariant 历史扫描（体检 P0-A） | 全量档实测 479.1s；剖分为 293 次 `git log`（159.4s）+ 2397 次 `git show`（122.7s）+ 895 次 `git log -1 --format=%P`（14.7s）+ 其余 | **4.0s**（冷跑，exit 0，裁决输出与旧实现逐行一致） | **采纳**：① 一次 `git log -m --full-history --name-only` 建「路径→提交」倒排（0.8s，`-m` 必需——合并提交默认不输出文件列表，漏 280/293 路径；等价性已逐路径验证 293/293 一致）；② `cat-file --batch` 批量读 blob（2397 次 show 122.7s → 0.5s）；③ `rev-list --parents` 批量取父表；④ 顺手纠正上文 #5：本门**并未**退出本地路径——`verify-scope.LEDGER_TOUCH_RE` 使「触及 `confirmations.d/` 即回列」，而关单每单新建分片，故几乎每单都命中（近 30 天 76/110 绿行真跑了本门，占墙钟中位 37%、峰值 95%）。改后该门不再是关键路径，`envSkipIds` 是否保留留待下一轮裁定 |
| 2026-10-23 | #3 分片 LPT（实测权重） | 轮转独跑 43.4s；套件池配对 A 106–115s（check-loop 73–78.9s） | LPT 独跑 35–37.7s；套件池配对 B 103.7–112.4s（check-loop 69.9–79.9s） | **回退·未证实**：独跑改善超噪声带，但套件池墙钟仅快约 2.5s（< ±3s），check-loop 时间互有胜负——按 perf 红线不保留。权重/LPT 代码已回退；in-process 仍是唯一剩余杠杆 |
| （未开始） | #6 膝点复测 | | | 顺延至 #0/#1' 后 |
| 2026-10-24 | #3 SLOW_FIRST 保留依据补账（复核 D2） | 126d39fe 声明 78.86→65.07s（单轮、未过噪声带纪律） | 全量 3 轮：94.0 / 96.1 / 90.8s（中位 94.0s，exit 0 ×3） | **保留·补账**：套件数已 65→74（+7 技能自带套件、+verify-scope 等），与声明时点绝对值不可比，65.07 无法原样复测；三轮离散 5.3s 属负载噪声量级（同时段有并行会话）。无 A/B 对照不判优劣——如需严格裁决须临时移除 SLOW_FIRST 对照另立实验；本轮不据以回退（与上行分片回退同守「无证据不保留/不回退」对称纪律） |
| 2026-11-06 | 快照刷新（P0-5，测量非实验） | 旧窗口 2026-10-22~28（62 条，full 为主）：墙钟中位 127.0s / p90 308.4s / 峰值 841.1s | 新窗口 2026-10-30~11-06（193 条，含 scope）：中位 **33.4s** / p90 46.4s / 峰值 164.3s | **记录**：① 中位下降含窗口构成效应（旧 full 为主、新含 33% scope），不可直接相减；② 单门同口径可比：ledger-invariant 182.4→7.8s、backend-test 51.0→14.3s、secrets-scan 26.3→0.8s、check-loop 24.2→3.7s；③ 门表已变：engine-tests / workflow-metrics / workflow-index / engine-map / effective-policy 退出本地路径（现 16 门）；④ 关键路径转移到前端三门（frontend-build 16.8s / frontend-lint 11.1s / frontend-unit-test 5.2s）；⑤ 后续 P1 实验以本窗口为基线 |
| 2026-11-06 | 档位使用面测量（P0-1，更正） | — | 2026-10-29 起（unitOnly 标记可靠窗）all-gates 绿行 218：scope 裁门 76（wall 中位 20.8s）、默认档未裁门 136（37.0s）、显式 `--full` **6**（51.8s）；默认档+scope 占 **97.2%** | **记录·更正**：上一版把 10-29 前无 unitOnly 标记的默认档误判为显式 full（称 113 次 / 204.8s）——判据必须限定 10-29 后窗口，已更正；脚本缺省 diff 档（2026-10-22）行为面本就正确，`test.md` §1 口径修正属文档对齐；已加 ledger `mode` 字段（verify.mjs:670）供后续直接判定 |
| 2026-11-06 | 重档语义修复（P0-1 续测衍生，owner 裁定「直推 main 与 PR→main 都要集成执法」） | 修复前 `verify.mjs --full --list --verbose`：backend-test = `run-backend-tests.mjs --unit-only` | 修复后：`--full` = `run-backend-tests.mjs`（含集成）；默认档 / 中档仍 `--unit-only` | **已修**：门链加 `fullTier`（显式 `--full` 或默认档回落）分支返回未改写的 GATES；两处兜底回落同享（`scopeMode=null` 时置 `fullTier=true`）；`unitOnly` 标记判据由 `!explicitFull` 改 `!fullTier`。根因 = 2026-10-29 46326cf8 把 `--unit-only` 加进默认档时未排除 `--full`，致 CI main（`--full`）与 main 直推的 CI 侧无集成执法（pre-push `--select-range` 一直有，上一版记录误称「pre-push 无覆盖」）。CI 已备 `TEST_DB_ALLOW_DEV=1` 逃生（azure-pipelines.yml），修复后该逃生真正生效 |
| 2026-11-06 | P1-a vue-tsc 增量（frontend-build 门） | `vue-tsc -b` 3 轮 14.2 / 14.2 / 14.5s（无增量收益；tsbuildinfo 仅 8KB stub，无 program 段） | `vue-tsc --noEmit -p tsconfig.app.json --incremental`：冷 14.3s → 热 **6.6s**（node config 1.6s）；改后 `npm run type-check` 3 轮 7.4 / 7.3 / 7.2s | **采纳**：`frontend/package.json` type-check 改增量双配置（覆盖与 CI `vue-tsc -b` 等价：app + node）。正确性实证——注入新文件类型错误 → exit 2 点名；改动既有文件 → exit 2；还原 → exit 0。副作用：tsbuildinfo 8KB → 378KB（含 program 段）；并行会话同跑 verify 对同一 tsbuildinfo 有写竞态（与 `-b` 同性质，tsc 遇损坏 fail-loud） |
| 2026-11-06 | P1-b eslint --cache | 全仓 lint 3 轮 8.4 / 8.1 / 8.0s | 全仓 `--cache`：冷 8.9s → 热 **2.3 / 2.2s**；但 scoped lint（2 文件）无 cache 2.3 / 2.2s、加 cache 2.4 / 2.2s = 零收益 | **不采纳**：默认档 lint 已按变更面裁剪（近 25 轮实测 3.4–5.6s，2026-11-05 起），cache 对 scoped 无效；全仓 lint 只在 CI main（clean checkout 恒冷）与罕见本地 full 跑，收益面太窄，且引入缓存产物 + 陈旧风险。证据留此，若 full 档本地化再评估 |
| 2026-11-06 | P1-c check-loop 导入成本（addedDates 全史扫描） | kit 冷导入 3.6–4.3s，其中 `git log --diff-filter=A --format=@%aI --name-only`（全仓全史）3.0–3.6s；5 段本体合计仅 0.27s | 收窄到 `-- workflow` 后：git log 2.2s、kit 导入 2.4s、check-loop 整体 3.05s（原 4.0s） | **采纳（部分）**：`check-loop-kit.mjs` 的 addedDates 加 `-- workflow`（消费方全是 workflow 文档，语义不变）。**段并行不可行**：5 段合计 0.27s / 4.0s，且段体是 spawnSync 同步调用（并行需改 async + 共享 blockers/warnings 顺序变化）。**剩余 2.2s = 历史行走**：实测 `git log <range>..HEAD -- workflow` 仅 75ms（5 提交）——磁盘缓存（HEAD 增量合并）可再省 ~2s，但引入失效逻辑正确性风险，待 owner 裁定 |
| 2026-11-06 | P1-d vitest 默认池（frontend-unit-test 门） | `vitest run` 交错基线 8.1 / 7.8s（default≈forks） | `--pool=threads` 6.8 / 6.2s；maxWorkers 8→8.2s、4→8.5s、2→13.5s（加大无益）；改后 `npm run test:unit` 6.3 / 7.7 / 6.6s，247 用例全过 | **采纳**：`frontend/vitest.config.ts` 加 `pool: 'threads'`（12 核机上 ~−15%）。未做分片：单进程内已并行，`--shard` 需外部多进程编排，收益不抵复杂度 |
| 2026-11-06 | P1-e check-loop addedDates HEAD 增量磁盘缓存（P1-c 续，owner 裁定做） | kit 冷导入 3.6–4.3s；check-loop 3.05s（P1-c 收窄后） | 缓存命中 **0.93s** / HEAD 前进（range）**0.99s** / 损坏重建 3.1s；三种路径输出逐字节相同 | **采纳**：`.agents/cache/added-dates.json`（`{root, head, dates}`，tmp+rename 原子写）；失效键 = root + HEAD 祖先关系 + 缓存完整性；git 失败不写、沿用旧值。实测连续 verify 同行头率仅 **13.1%**——故必须做 range 增量而非「HEAD 未动才跳过」 |
| 2026-11-06 | P1-f ledger-invariant 增量窗口 | 7.6s = historyIndex 1.7s + parentMap 2.4s + refs 1.6s + warmBlobs 2.1s + 其余 0.8s | `--no-walk` 后全量 **5.5s**；增量窗口：HEAD 未动 **2.8s** / HEAD~1..HEAD **3.7s**；裁决等价（全量 vs 窗口问题集逐条相同，均 0 条） | **采纳**：① `parentMap` 加 `--no-walk`（rev-list 默认列全部祖先：200 sha → 4584 行 / 350ms；no-walk → 200 行 / 119ms，8 批 −1.9s）；② `.agents/cache/ledger-invariant.json` 记「上次绿跑 HEAD」，失效键 = root + baseline + 脚本 sha256 + HEAD 祖先关系；红跑不写，`--staged` 路径不读写。**残留地板 = historyIndex 1.7s**（路径枚举 + withHistory 依赖全史索引）——索引本身亦可 HEAD 增量缓存，待下轮 |
| 2026-11-06 | P1-g rule-budget 批量预取 | `--all` 4.1–6.8s（逐文件 2 次 cat-file spawn × ~40 文件 = 80 次）；`--staged` 0.30–0.44s | `--all` **0.29–0.52s**（一次 `--batch-check` 取尺寸 + 一次 `--batch` 取内容）；`--staged` 不预取（0.38–0.44s，与原状相同）；两档输出逐字节相同 | **采纳**：`.agents/scripts/rule-budget.mjs` 加批量预取（`__preSize`/`__preContent`，索引→HEAD→工作区优先级原样保留）；`--staged` 跳过预取——该档只查暂存触及条目，预取全表反而更慢，且过滤口径与主循环共用、不复制以防漂移 |
| 2026-11-06 | P1-h ledger-invariant 历史索引 HEAD 增量缓存（P1-f 续） | 空窗口下 2.6s，其中全史索引 `git log` 1.2s + 解析 0.5s | 索引命中 + 空窗口 **1.4s**；全窗口扫描 5.65s（vs 无缓存 6.43s）；输出 A===B 逐字节相同、问题集 A===C 相同 | **采纳**：`.agents/cache/ledger-history-index.json`（`{root, scriptHash, head, index}`）；HEAD 未动 → 零 git；前进 → 只走区间并追加（全史升序，区间提交更新 → 追加保序）；回退/损坏 → 全量。索引是「哪些提交存在」的事实、与裁决无关，故红跑也写。verify 实测 ledger-invariant **7.5s → 1.45s** |
| 2026-11-06 | P1-i wiki-consistency 门数缓存 | 门 ~1.0s（standalone）/ 5.4s（verify 并行负载）；其中 `checkNarrativeClaims` 511ms = 两次 spawn `node verify.mjs --list`（各 ~250ms：node 启动 + 模块加载） | 门 **0.55–0.57s**（−45%）；verify 实测 5.4s → **<1.2s**（跌出前六）；输出逐字节相同 | **采纳**：`gen-narrative-claims.mjs` 的 `collectSources` 加 `.agents/cache/gate-counts.json`（`{root, verifyHash, all, engine}`）——门数只取决于 verify.mjs 的 GATES 数组，按内容哈希失效；缓存缺失/哈希不匹配/写失败一律回落逐次 spawn（原语义，不新增失败面）。另：门体多轮 `readdirSync`+`statSync` 已改 `withFileTypes`（Dirent 直判，symlink 回落 statSync 保语义），但实测那部分不是瓶颈（~260ms） |
