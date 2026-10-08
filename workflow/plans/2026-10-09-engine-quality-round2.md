---
状态: superseded
级别: L2
模块: pipeline
确认指纹: a5a84d6db1a42537
---
# PLAN — engine-quality-round2

对应入口：../intents/2026-10-09-engine-quality-round2.md
对应 spec：../specs/2026-10-09-engine-quality-round2.md

## 改动方案

- `src/sync-hosts.mjs`：diffHosts 多根归一（新入参 adapterRoots=[{root, hostDirOf, hostFilter?, label}]，旧单根 adaptersRoot/hostDirOf 归一为单元素数组=向后兼容）；pairsFor 加 hostFilter 参数；applyForward 按漂移条目自带 root 定位适配文件；syncHosts 包源布局构造两根（modules/hosts 全宿主 + 项目根 HOSTS.dir 存在者）；--diff/--apply 输出「对账面：」自描述行
- `src/sync-hosts.test.mjs`：+3 场景（包源 fixture 项目根 .zcode 漂移检出+自描述行 / --apply 修复且 frontmatter 保留 / 装户布局行为回归不变）
- `templates/_agents/scripts/edit-face-check.mjs`（新增）：spawn check-loop（CHECK_LOOP_ROOT=仓库根）→ 非零即非零；常驻面文件（AGENTS.md + rule-budgets.txt 表内文件的工作树字节，LF 归一）advisory 对比预算表；输出耗时与结论；exit 语义 = check-loop hard→2 / warn 或预算超限→1 / 全绿→0
- `templates/_agents/scripts/edit-face-check.test.mjs`（新增）：临时目录 fixture——构造 CHECK_LOOP_ROOT 场景跑真 check-loop；工作树破坏（删阶段索引行）→ 报警
- `.github/workflows/ci.yml` + `templates/_github/workflows/kit-ci.yml`：machine-gate 步骤加 `if: failure()` 尾随步骤——node 内联读 .agents/confirmations.jsonl 过滤 7 天内 done/closed 行，打印「最近关单（CI 红复核优先）」；台账缺失静默跳过
- `templates/_agents/scripts/confirm-doc.mjs`：追加台账行前读末行 → `prevHash`=末行.hash||''，`hash`=sha256(prevHash+JSON.stringify(行去 hash))；复用 createHash 既有 import
- `templates/_agents/scripts/policy.mjs`：导出 `ledgerChainHash(row, prevHash)` 单源函数（confirm-doc 写入与 check-loop 验链共用——判定零复刻）
- `templates/_agents/scripts/check-loop.mjs`：检查 15 段追加链校验（连续带 hash 行：prevHash 接续 + hash 重算一致；断裂=hard「台账链断裂」指明行号；无 hash 行跳过）；检查 7 段替换为 import check-stage-index 调用（调用点位置不变=输出顺序契约）
- `templates/_agents/scripts/check-stage-index.mjs`（新增）+ test：runCheckStageIndex(ctx) 返回 warnings 数组；局部收集器 + appendSegs（selfmeasure 先例）
- `templates/_agents/scripts/wiki-search.test.mjs` / `verify-wiki-consistency.test.mjs`（新增）：临时目录 fixture；`templates/_agents/scripts/scripts-test-exempt.txt` 移除两行、ensure-board 行定性「永久工具豁免（需真实端口/进程；自动化覆盖无性价比，2026-10-09 engine-quality-round2 评估）」
- `ARCHITECTURE.md`（新增，仓库根）：三层分发 / 闭环模型 / 门禁 20 检查索引 / 双入口执行器 / 自我度量 / 质量底座 / 决策指针
- `workflow/papercuts.md`：+3 行（MCP 化缓做 / fleet 视图缓做 / L2 快车道深水区留拍板）；`CHANGELOG.md`：perf 缓做依据记入下版条目草稿
- `templates/_agents/commands/{design,build,new-task}.md`：各加「三件套合并预览」短节（起草期一次呈现要点总览；逐件确认代录不变）；改后 `flow-kit sync` + `sync-hosts --apply`

## 任务拆解

1. **T-B · B1/B2/B3（缺口修补）**
   - 步骤：sync-hosts 多根改造 + 测试 → edit-face-check + 测试 → ci.yml 双侧 failure 步骤
   - 判据：sync-hosts.test 新场景全绿且既有场景零改动全绿；edit-face-check 正常面 exit 0、构造破坏面报警（测试内实现）；两份 yml 均含 failure 步骤（grep 断言）
   - 风险：中（多根重构触装户行为——回归场景钉住）
2. **T-D · 台账哈希链**
   - 步骤：policy 导出链函数 → confirm-doc 写入 → check-loop 15 验链 → 双侧测试（写入字段/篡改 hard/历史行兼容/CRLF 规范化）
   - 判据：confirm-doc.test 新场景全绿；check-loop.test 新增「中间行篡改→hard」+「无 hash 存量→零告警」两场景；**反证**：把验链判据临时改恒绿 → 新场景红（断言非恒绿）；既有断言零改动
   - 风险：中（规范化不一致会误报——hash 函数单源共用即消）
3. **T-A · A1 拆检查 7 + A2 补测清_exempt**
   - 步骤：check-stage-index 模块化接线（gate-seg 段归属按 selfmeasure 口径）→ wiki-search/verify-wiki-consistency 测试 → exempt 表更新
   - 判据：check-stage-index.test 全绿；gate-checklist --diff 登记完整；check-loop 头部清单行 vs 改前逐字一致（git diff 断言）；两新测试全绿；检查 20 无新增 WARN
   - 风险：低（先例成熟）
4. **T-E/T-C · 文档面**
   - 步骤：ARCHITECTURE.md → papercuts 3 行 → CHANGELOG 草稿 → commands 三模板加节 → sync + sync-hosts --apply → rule-budget 核预算
   - 判据：ARCHITECTURE.md 在根且节齐全；papercuts 含三行；三模板含「合并预览」；sync-hosts --diff 0 漂移；预算 exit 0
   - 风险：低（纯文档；预算超限按一进一出处理）
5. **T-F · 收尾**
   - 步骤：独立复核（L2 强制）→ 全量验证矩阵 → 勾验关单 → docs 提交
   - 判据：复核无 P0/P1；npm test / eslint / doctor / source-sync / rule-budget 全绿；三件套 done

## 执行顺序

T-B → T-D → T-A → T-E/T-C → T-F。依赖：T-D 的 policy 链函数被 check-loop 消费（T-D 内部闭环）；T-A 与 T-B/T-D 相互独立；T-E/T-C 依赖前面定型（ARCHITECTURE 写终态）；T-F 收尾。提交分组：docs(workflow) approved 留痕 → B → D → A → E+C（chore/docs）→ 关单 docs。

## 验证计划

- 静态门：`npm test`（含 lint 首步）全量 exit 0；`npx eslint .` 0 error
- L2 契约比对：`gate-checklist --diff` 登记完整；check-loop 头部清单 vs HEAD 逐字一致；`source-sync-check` 0 漂移；`sync-hosts --diff` 0 漂移（含新对账面）；`doctor` 0 WARN 0 FAIL；`rule-budget --all` exit 0
- 独立复核：independent-reviewer 只读复核（对照三件套 + diff），结论落 spec「确认与复核」
- 关单：`verify.mjs --doc` 绿凭证绑单 → 逐条勾验收 → confirm-doc 逐件 done

### 偏离留痕（对 spec / 惯例的已声明裁量）

1. **三件套 delegated 同句**（goal 原话 ×3 件）：自治批次用户仅下达一句 goal 指令，逐件原话无可引用的差异化措辞——台账 quote 同句但 batch/seq/ts 可区分，授权链在 intent「确认与复核」节声明，供事后对质。此为 papercuts 2026-10-05「原话点名到件」纪律在自治批次的已知妥协，如实留痕。
2. **B2 预算 advisory 独立实现**：常驻面工作树字节对比不入 rule-budget.sh（其口径走 git index/HEAD）——edit-face-check 自算 LF 字节，声明「编辑时口径，提交门以 rule-budget.sh 为准」，非判定复刻（判据不同面）。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现——禁从 draft 直跳 done。
- 确认结果：approved（2026-10-09 自治批次，授权链同 intent——goal 指令放行五层方案，本 plan 即其任务拆解与改动清单）；done（关单时随入口文档置终态）
- 确认门记录：plan 草稿全文 = goal 方案的任务化（B-D-A-E-C 五层 → T-B/T-D/T-A/T-E/T-C 五任务组），改动清单即上文
- 复核：L2——实现完成后 test 阶段 independent-reviewer 独立复核
