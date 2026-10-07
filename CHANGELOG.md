# Changelog

已发布版本的摘要。未打进 `package.json` 的改动见 README「当前能力」。

## 1.2.0

- feat(gate)：**测试绿机器凭证**（2026-10-07 verify-evidence，Anthropic AI-Native SDLC「make test before done」基准必修缺口①）——关单勾验的「测试绿」从声明式升级为机器事实三件：① verify.mjs 两步全绿后向 `.agents/verifications.jsonl` append 绿行（{ts, exitCode:0, suite, passed?, failed?, runId?}，计数 best-effort 抓「合计: PASS n / FAIL n」，check-loop 红不落账，IO 失败不阻断）；② confirm-doc 置 done 且文档含「验收标准」节且 policy v5 → 24h 窗口无绿行出 ⚠️ advisory（不拦，fail-open，升 hard 走后续 policyVersion 演进）；③ 检查 8 无 SHA 证据命中「测试绿」关键词且 intent 首次加入 git ≥ verifySince → 凭证对账（有绿行 verify 型豁免出账 / 无 warning）。窗口判定单源 `policy.hasFreshVerifyLine`（两消费方共用）；policyVersion **v5**（= v2 全键 + verifySince: 2026-10-07，装户升 v5 视同接受 v2 基线早期锚）；v1-v4 整体跳过零变化；测试 +7 场景（verify 落账 ×3 / confirm-doc 前置 ×2 / 检查 8 对账 ×2）

## 1.1.9

- feat(gate)：**模板下发感知**（2026-10-06 template-downstream，S18/S20 装户事故根因的机制修复）——workflow/ 等模板属 owned（init 一次性复制），源仓演进零下发通道，装户静默陈旧；新增感知层：owned 条目附加 `srcSha256` 锚（上次 sync/init 见过的包源 sha，LF 归一），sync 三方 sha 判定（disk/srcRecord/srcCur，判据单源 `profiles.templateDriftOf` 四态），唯一出账形态＝「源已演进且盘面未跟随」advisory（含文件清单，恒不 hard-block，锚见过即刷新＝单周期出账）；init 写初始锚（生成器目标 INDEX.md 类排除出感知面）；doctor §6.9 只读回显（两次 sync 之间持续提醒）；旧装户无锚静默跳过、下次 sync 写锚后生效不追溯；装户定制跟源永不出账（owned「预期被改造」语义不回归）；doctor 新节已登记 gate-checklist PAIRS（S10 门禁抓漏实证）

## 1.1.8

- docs(workflow)：**存量确认留痕清零**——adopter-derivers spec / stage-gate-machine specs+plans 补 approved 快照（指纹取台账 approved 行，机器可验证）+ 逐份重确认 done 重绑内容指纹；根因是早期确认链分跳执行但文件只在 done 态提交，git 无中间快照而检查 14 刻意只认快照（「工作区未提交的 approved 不算——这正是留痕语义」）。纯仓库自身工作流历史修正，不改包行为；此后推送仅剩设计内「证据豁免」出账

## 1.1.7

- fix(gate)：**检查 19 判据 B 入口 intent 读取 existsSync 守卫**（2026-10-06-check19-entry-enoent）——incident 闭环主题无同名 intent，「读空判级」惯用法（缺文件 → 级别空 → 不豁免，判定面不变）在 fail-loud fs 读（1.1.5 gitout-fail-open）下每次推送响亮出账 12 条 ENOENT 噪声；同文件同类读空点一并守卫（检查 5 `textOf` 助手 / 检查 6 AGENTS.md·new-task.md——实仓恒存在故属潜伏面，裸 fixture 实证揪出）；测试 +1 场景 2 断言（缺件无 ENOENT 出账 + 顺序倒置照报不放松）

## 1.1.6

- fix(gate)：**检查 2 日期显示格式字面量豁免**（2026-10-06-check2-datetime-literal-exempt，装户 Shipyard.Material 回流）——正文裸写 `YYYY-MM-DD` 一律判未填占位，误伤「描述日期显示格式」的叙述（`YYYY-MM-DD HH:mm(:ss)`：装户 cancel-export intent/plan 实证 2 条 advisory + loop-audit intent 现场复现）；`stripSamples` 行内剔除追加该形态（时间粒度后缀 = 格式描述非留白占位），真占位（裸 `YYYY-MM-DD` 无时间后缀）照拦、负例场景钉住；fixture 日期取确认门锚前（2026-09-26）避免检查 15 干扰检查 2 断言；只豁免实证形态，变体（斜杠日期 / 十二小时制等）实证再扩

## 1.1.5

- feat(gate)：**检查 18 委派台账对账生效日豁免**（2026-10-06-backflow-loop-audit-remediation，装户 Shipyard.Material 回流）——delegations.md 台账记法自始为「任务一句话」（装户全表 0 行含 workflow 文件名），原口径要求行含文件名且无生效日豁免，存量 L2/L3 永远无法满足、产出 113 条不可消退 advisory（违反「无判定依据的行不产出不可消除噪声」红线）；新增 `delegationSince` 锚：文档日期早于锚存量豁免、不回填（台账记法约定「任务一句话含文件名」自生效日起，见 delegations.md 头部），受管日期照报——豁免通道不得吞掉真漏点；测试 +2 场景（v4 豁免 / v4 受管照报），缺键回退由既有场景群覆盖（fixture 无 kit.json → v1 原全量对账，向后兼容不放松）
- feat(policy)：**POLICIES v4**——v3 键集 + `delegationSince: 2026-10-06`；装户经 kit.json `policyVersion: 4` 选入，kit 仓自身维持现状版本
- docs(commands)：**6 份命令文档补「装户边界」标注**（build/test/review/gate-checklist/sync-hosts/source-sync-check）——`src/`、`bin/flow-kit.mjs`、`templates/_agents/`、`modules/hosts/` 包源专属路径在装户仓不适用（引用即失败），顶部统一声明装户以 `.agents/` 装副本为准（装户全量审查发现照文档执行即撞墙且无边界说明）
- docs(gate)：**pre-push 头部 CI 注释两段式**——原「本仓 ci.yml 复跑四道门」仅 kit 源仓为真，下发装户后成虚指（装户无 CI、`source-sync-check --gate` 无包源恒 exit 1）；改为「源仓有 ci.yml / 装户仓无 CI、本地钩子即全部机器门」两段式，两种语境皆准；钩子逻辑零变化
- 已知边界（记录不处理）：装户 `workflow/` 模板为 init 一次性复制、不属 managed，源仓模板后续演进不达装户——曾致装户 fill-spec.test S18/S20 引入即失败（v1.1.3 装入当日，未被任何门禁捕获）；装户已手工对齐，下发机制改进另案

## 1.1.4

- feat(gate)：**检查 8 记录型提交豁免**（2026-10-06-v114-backflow-batch，装户 Shipyard.Material 回流）——验收证据引用 docs 系提交（冒烟报告 / approved 留痕 / 关单台账，subject 前缀 `docs(` / `docs:`）不触 plan 声明面不再硬拦「证据无关」，前提为**同文档存在可过检实现证据**（sha / process 型任一在场，两遍裁决：检查 8 先收集逐条证据再文档级聚合 `hasImplEvidence`）；仅引 docs 提交无实现证据维持 hard-block——豁免通道不得独立成立，防「只引 docs 提交洗白代码改动」；新增正反两场景钉住判据
- feat(policy)：**POLICIES v3**——v1 键集、`confirmDocsEffective` / `confirmIncidentsEffective` 后移至 2026-10-06（装户确认纪律全量执行日锚；首版 10-05 同日边界拦不干净，装户实测后修正）：确认台账机制上线日（09-27）与实际启用日脱节的装户，存量 approved/done 落入既有「存量豁免」口径，新档照常受管；装户经 kit.json `policyVersion: 3` 显式选入，kit 仓自身维持 v2
- fix(test)：**预算两场景超限样本自校准**——硬编码 8000B 样本随装户 AGENTS.md 上限（7680→8704B）上调而失效（199/2 假失败），改为从拷入预算表读 `AGENTS.md` 上限 +512（含 `--staged` 块作用域修正：agLimit 计算补入独立块，装户环境无 sh 走 SKIP 分支曾掩盖该缺陷，kit 环境补齐覆盖）

## 1.1.3

- docs(workflow)：delegations 补登两行自做记录——gitout-fail-open（一次通过）+ check8-digit-sha-misfire（返工×1，P1 探针临时件台账污染收口）；agg 刷月度快照 2026-10（15 任务 / 73% / incident 9）；委派台账 advisory 清零。**本版包内容与 1.1.2 一致（纯台账/文档面，无引擎改动）**

## 1.1.2

- fix(gate)：**检查 8 全数字短 SHA 误分类根治**（2026-10-05-check8-digit-sha-misfire，CI run 37293415820 两 node-20 腿复发根因）——`verifyEvidenceTruth` 的「纯数字串豁免」由形态抢先分类改为 **rev-parse 实证分流**：全数字短 SHA（≈(10/16)⁷≈4.4%/夹具，哈希随机产生）曾被 `/^\d+$/` 守卫误分类为时间戳文本致证据真相核验静默跳过；现纯数字串也先试解析——能解析成提交（含同名 ref/tag）走真相核验、解析失败维持时间戳豁免；非数字 forged 防伪线与时间戳语义零变化；`text/no-plan/external/process` 豁免分支补出账（按 type 进程去重，裁决可归因）
- fix(test)：**场景 5u 构造性钉子**——`git tag` 7 位全数字 ref 正例（修复前静默漏检，独立复核变异自验实证）+ 纯数字时间戳负例（豁免保持）；探针 A/B 修复前 10/10 复现 → 修复后 40 轮 0 次；`linesOf` fs 告警去重改按文件（合法缺失文件不再消耗他文件告警额度）
- docs(workflow)：L2 incident 三件套闭环（独立复核「修复后放行」+ P1 探针临时件台账污染收口——**临时件生命周期须罩住台账刷新**）；regression-checklist 防复发节追加「文本豁免须以实证兜底，禁以字符形态抢先分类」

## 1.1.1

- fix(gate)：**check-loop fail-open 根治**（2026-10-05-gitout-fail-open，CI run 37252874044 flake 根因）——`gitOut` 与证据核验/:628/:633 统一 `spawnGit` 通道：spawn 异常响亮出账（stderr 进程级去重恰一条，沿检查 16 fail-loud 先例）+ 瞬时类错误码（EAGAIN/EPERM/EMFILE/EINTR）单次重试，瞬时抖动不再被静默降级为「非 git 仓」跳过检查面；`linesOf` fs 读取失败重试 + 响亮出账（原静默按空文档降级）；:581 持续异常仍按伪造拦（fail-closed 保持）；`gitOut` 返回契约与非 git 仓跳过语义不变、14 处调用点零接触；新增 `CHECK_LOOP_GIT` 测试注入钩子（未设时行为逐字节一致）
- fix(test)：**测试夹具防瞬时失败**（flake 直接根因侧）——`gitRetry`（`r.error` 与 status≠0 重试一次、持续失败抛错响亮失败）+ `shortSha` 空值防线，替换 gitInit/gitCommitAll/6 处裸 rev-parse，绝不静默产出空 sha 假夹具；新增场景 5v 两块 5 断言（出账恰一条/持续异常 fail-closed/无证据无关误报/正常零出账/行为不变）
- docs(workflow)：L2 incident 三件套闭环（independent-reviewer 放行 + 4 项 P2 关单前收口；稳定性基线 50 轮 8 失败 → 加固后 20 轮 + 10 轮 0 失败）；regression-checklist 防复发节追加「spawn 基础设施异常须与业务失败区分并响亮出账」；papercuts/delegations 台账收口

## 1.1.0

- feat(pipeline)：**撤销 zcode/omp 的 localOnly 档位**（2026-10-05-host-gitignore-localonly-revoke）——七个宿主一律入库：init/add-host 不再向装户 .gitignore 追加宿主目录（换宿主不丢文件、CI 克隆面与本仓一致）；localOnly 字段保留为判定单源、分支代码不删（未来重开「本机专属宿主」档位免改结构）；zcode 会话级液态草稿（.zcode/drafts/、.zcode/plans/）改由装户自管 .gitignore（README 与本仓根 .gitignore 给实例）；存量装户的残留条目不做自动迁移（spec 风险面显式声明）
- fix(review)：**双轴审查批修复**——profiles.mjs localOnly 撤销注释口径勘误（「已同步删掉那两行」与 .gitignore 实际「净效果保留两行草稿规则」矛盾，按 intent 约束改写）；papercuts 补登两行处置定性（spec 改动清单/双源声明未回填任务 6——依不追溯改已关单文档先例以 papercuts 行为勘误口径；spec approved 代录原话未点名 spec——保留即审计可见性，今后 --delegated 原话须点名到件）
- docs(workflow)：host-gitignore-localonly-revoke L2 三件套闭环（intent/spec/plan done；独立复核 8/8 验收满足、P2 三项处置留痕；S7 断言翻转 + ROpt 可选读；templates 旧口径注释两件 sync 刷装副本）

## 1.0.2

- fix(board)：**审查发现批修复**（2026-10-04-review-fix-batch）——`/api/runs` 载荷键 `runs` → `cards`（对齐 intent 2026-10-04-board-run-panel 验收#1 文本；消费面仅自带前端）；`watchDir` 同步失败分支补广播 `watchdead` + 服务启动前补建缺失的 pipeline-runs 目录（全新装机 SSE 推送失效根因修复）；`/api/run` 读失败区分 ENOENT→404 与其他→500（留日志）；抽屉工单 tab 停机在确认门时渲染确认门要点（doc/points/ledger）；`safeRunPath` 加 export 并补路径穿越白名单正负例测试
- fix(gate)：**check-loop 测试面修复**——场景重号消除（原检查 4/检查 2 两场景改号 45/46，让位于 94188ee 证据真相场景 43/44）+ 新增场景 47 证据 SHA 触及声明文件的端到端正例（锚前自报日期豁免存量面，exit 0 只能经 type=sha 放行路径达成，补齐 spec 2026-10-04-plan-section-name-evidence §49 断言强度）；check-loop.mjs 引擎逻辑零改动
- docs(workflow)：AGENTS.md 提交纪律修订为三段式闭环链（approved 留痕 → 代码 → 关单随后；原「随代码同一提交」与确认门时序结构性冲突）+ papercuts 四行（恢复检查 14 定性行、确认日期占位一次性定性、plan 节名单源暂缓、check-loop 无主守卫待 import 化）

## 1.0.1

- feat(gate)：**plan 确认节模板样板豁免**（2026-10-03-plan-confirm-boiler）——检查 2 的 `boilerRe` 精确豁免 plan「确认与复核」节样板句，消除三个 plan（confirm-gate-one-per-call / p2-batch1 / release-draft-scope）的「模板未填」误报；真实未填占位（`日期: YYYY-MM-DD`）仍拦，正负例测试钉住
- docs(workflow)：L2 流程闭环（立项 / spec+plan 确认 / 实施 / 关单），papercuts「检查 6 模板占位符误报」升级项收口

## 1.0.0

- feat(pipeline)：**pipeline-run 跨宿主全自动闭环执行器**——start/next/status/watch/abort 状态机脚本 + 工单协议/run 事件流/修复环 cap3，五宿主薄适配命令封装；多轮复核修复收口（运行态副产物越权排除/占位符剔除跨行围栏/deploy 对象定位收紧/装户降级只 WARN 等）
- feat(gate)：**检查 8 过程证据判据**（check-evidence-process）——提交信息带 `pipeline-run <runId>` 严格形态标记的改动面外提交放行，forged/无标记不放松；pipeline-run 测试日期锚钩子（PIPELINE_RUN_TODAY）跨日红修复
- feat(gate)：**发版 draft 盲区评估收口**（release-draft-scope）——检查 17 补 open incident 不参与断言；papercuts 定性发版 draft 盲区由检查 17 覆盖、弱映射不做
- docs(workflow)：P2 池批二 / doctor-owned-drift-strict 等 incident 关单，委派与关单台账收口
- **正式 1.0.0**：闭环工作流、门禁与发布流程全面稳定

## 0.9.4

- fix(test)：**CI 全红修复批**（incidents/2026-10-02-ci-red-batch）——pre-push.test.mjs 挂钩后 `chmod 0o755`（Linux git 静默跳过不可执行钩子，v0.9.1 起 CI/Release 全红根因）+ 钩子路径双布局探测（templates `_githooks` / 装户 `.githooks`，治装户侧 ENOENT 崩溃）+ owned 台账 sync 盘面自愈（fc95150 手改 settings 未刷 sha 的 doctor FAIL）
- feat(settings)：deny 补禁 `--no-verify` 四处变体（commit/-n、merge、push）——宿主权限层堵 AI 绕钩子路径，CI 兜底前移一层（fc95150）
- 发版恢复双源对齐：v0.9.2/v0.9.3 的 Release 因上述测试缺陷未走到 npm publish，npm 侧自 0.9.1 起滞后——本版 tag 的 Release 走通后 npm 恢复与 git tag 同版

## 0.9.3

- feat(gate)：**口径收敛批**——plan 节数/节名四处单源（L1 Quick-Plan 三节 / L2-L3 四节，与 fill-plan 一致）；泳道判定单源 `laneOfEntry` 方案 C 分歧双严（协议锚 `riskLevelSince`，六消费点统一）；check 2 占位符样例豁免（误报 8→2）；7 项口径 P2 清零
- feat(gate)：**台账提交不变量**——`check-ledger-invariant` 双模式（CI 历史全扫 append-only 前缀单调 + pre-commit `--staged` 前置 + 行级校验五项）；CI 机器门升至五道（`fetch-depth: 0`）；README 硬规则 6「台账不可变」
- feat(metrics)：**台账炼漏斗**——`gen-workflow-metrics` 双表（闭环漏斗机器口径：收口/完整链/协议前/一次通过/返工件/中位周期，定义式单源 specs/2026-10-02-ledger-funnel-metrics.md）；三轴审查三改进（口径收敛/台账不变量/漏斗指标）全部落地

## 0.9.2

- feat(gate)：新增 check-loop **检查 20「引擎脚本测试覆盖」**——包源环境每个引擎脚本须有同名 `.test.mjs` 或登记豁免（warning 级；装户跳过）；豁免登记 `scripts-test-exempt.txt`（6 项，policy/stage-gates 被套件 import 覆盖，工具型如实登记待补测）
- 补 `trust-mode.test.mjs`（8 用例：三级语义 / 缺文件 fail-closed / `--auto` e2e——Strict 拒 / Trusted 放行 `ai-auto-trust-L2`）
- README 规范条目：新增引擎脚本默认必须带测试（2026-10-01 gate-script-test-coverage 批）

## 0.9.1

- fix(gate)：`solidify-task` 移除自动伪造 `--delegated` 原话（确认门契约）——无确认来源只迁移不落账；quote 须调用方显式传入并原样转发；失败/索引更新失败退出码传播
- fix(gate)：pre-push 加固门改按**目标分支**判定——`experiment/* → main` 直推不再绕过 `--hardening`
- 新增 `solidify-task.test.mjs`（16 用例）与 `pre-push.test.mjs`（6 用例真仓端到端）纳入 npm test
- README 硬规则 3 与 new-task L1 行补确认门规范条目（2026-10-01 v09-review-defects 复盘）

## 0.9.0

- 混合治理·风险泳道：intent frontmatter `risk_level` 选道（L0/L1 协作道 / L2/L3 防御道）+ check-loop「红线判低」hard 拦 + confirm-doc `--batch` 协作道批量代录（台账 batch/seq/of 一手事实）
- 混合治理·探索泳道：`experiment/*` 分支闭环门禁降 advisory + pre-push 对 main 的 `check-loop --hardening` 加固门（转正须收口）+ stage-gates「先起草后确认」豁免（L2/L3 不回落 fail-closed）
- 混合治理·Trusted 自动泳道：trust-mode 三级（Strict/Standard/Trusted，缺省 Strict fail-closed）；L2/L3 与 incidents 永不自动放行
- L1 快车道：液态草稿（`.zcode/drafts/`）+ `solidify-task` 一键固化（迁移 + 批量确认 + 索引更新）
- pre-commit 新增泳道完整性门禁（check-lane-surface）：触达面判低拦截（`lane-surfaces.txt` 项目配置，缺失跳过）+ 探索标记拦截

## 0.8.0

- opencode 命令与 trae 对齐为 `wf-` 前缀，前缀单源 `profiles.mjs` 的 `commandPrefix`
- pre-commit 增加 managed 台账快检

## 0.7.0

- 装户可扩展指标走 `.cjs`（`require(esm)` 在 Node 18 / 20.18 / 22.11 不可用）
- CI 矩阵加入 Node 20，并单独跑 `.agents/scripts/*.test.mjs`

## 0.6.0

- 确认门机器化：检查 8 / 15 的锚、并录审计改为台账上的 batch 事实

## 0.5.0

- `sync-hosts`、gate-checklist 配对表、枚举单源、check-loop 迁到 Node

## 0.4.0

- 看板从基端口起自动找空端口；`ensure-board.mjs` 取代 Windows 专用 ps1

## 0.3.1

- Windows 没有 sh 时，doctor 不再把 check-loop 误报成 hard-block

## 0.3.0

- init 序号菜单；已有 AGENTS.md 无骨架时文末追加；wiki 主题目录；关单 verify 编排

## 0.2.1

- owned 台账在 sync 时按盘面刷新哈希；跳过的 managed 文件持续报告

## 0.2.0

- `sync`、`add-host`、`add-gate`

## 0.1.0

- `init`、`doctor`、四宿主适配、`dotnet-ca`
