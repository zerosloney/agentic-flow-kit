# 量化证据台账（委派 + 自做任务）

> 目的：把「一次完成率 / 平均返工次数 / 主兜底占比 / 月度故障数」从感觉变成数字——**数字达标之前不扩并发**（门槛见 §并发扩容门槛）。
> 记法（主智能体顺手写一行，不增加用户负担）：
> - **委派结果表**：每次向子智能体/执行模型委派后追加一行。
> - **自做任务结果表**：主智能体自己完成的 **L1+ 新需求任务**，闭环时（intent→done）追加一行；**修复类不重复记**——incident 本身即故障信号，聚合脚本按月扫 `workflow/incidents/` 计数。
> - 结果列取值：`一次通过`（静态门首跑全过且复核无 P0/P1 返工）/ `返工×N`（回炉 N 次）/ `主兜底`（executor 失败、主智能体接手——委派口径专用，计返工信号）/ `返工待修`（未闭环，不计入率，单列提示）。
> 聚合：`node .agents/scripts/agg-delegations.cjs` → 输出各月指标 + 扩容门判定 + 可粘贴快照行，粘贴进 §月度聚合快照（每月一行）。聚合时顺路按「三类清理清单」巡检 AGENTS.md：代码/配置已可推导的删；只针对一次需求的细节移 wiki 或删；已被脚本/hook/测试自动保证的只留入口。
> 口径说明：合并冲突率不适用（单人串行 + 每阶段确认）；人工复核负担以「复核类委派的返工行」近似（见结果列 + 备注）。
> 调整某角色的模型指派前，先从 `workflow/incidents/` 取 3 个已定性 bug 丢给候选模型做回归对比，再拍板。

## 委派结果

| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 |
|------|----------------|------------|------|------|
| 2026-09-23 | general-purpose(子代理) | agentic-flow-kit 抽包：15 份工作流文档清洗为通用模板（7 命令占位符化 + 2 角色去项目举例 + 6 适配层清洗） | 一次通过 | 项目 token 零残留扫描通过；通用脚本引用保留完好；主智能体复核清洗范围无偏离（intent 2026-09-23-agentic-flow-kit-npx-package，2026-09-23 自发起仓库迁入） |
| 2026-09-24 | Explore(子代理) | 全项目审查扫描：引擎脚本/门禁钩子/宿主模块/文档协议对照，产出 A-F 分级发现清单 | 一次通过 | 关键指控（台账吞数据/锚点静默跳过/ENOENT 崩栈）经主智能体逐条实证复核成立，据此立 incident 2026-09-24-review-fixes |

## 自做任务结果

| 日期 | 任务一句话 | 结果 | 备注 |
|------|------------|------|------|
| 2026-10-07 | 2026-10-07-adopter-ci-github：装户 GitHub Actions CI 远端门下发——templates/_github/workflows/kit-ci.yml（owned 薄门，统一入口 verify.mjs）+ isOwned `.github/` 前缀 + srcTemplatePath 点前缀泛化（.agents 特例推广，感知锚覆盖新面）+ AGENTS.md 门禁节口径行两处（rule-budgets 7680→8192 双源成对），Anthropic AI-Native SDLC 必修缺口②，TFS 装户手放 azure-pipelines 方案留对话档 | 返工×2 | 三件套 done（delegated 台账在档）；返工点：① pre-commit 规则面预算拦 AGENTS.md 7969B>7680——按 53d3105 先例 512B 步进上调预算；② rule-budgets 只改装副本被双源门拦——补 templates/_agents 包源侧成对；独立复核零 P0/P1，P2-1（分支策略提示断言）+P3-1（isOwned 存量正例）当场补断言；npm test 全套 36 套件 exit 0（含与并行会话 1.2.2 提交的一次瞬时撞态复跑确认）；fresh-init/S16 共 +10 断言；主智能体自做 |
| 2026-10-07 | 2026-10-07-verify-evidence：测试绿机器凭证——verify.mjs 全绿落账 verifications.jsonl + confirm-doc done 前置 advisory（24h 窗口）+ 检查 8 凭证对账（无 SHA「测试绿」声明须对账），窗口判定单源 hasFreshVerifyLine，policyVersion v5，Anthropic AI-Native SDLC「make test before done」必修缺口①，随 v1.2.0 发版 | 一次通过 | 三件套 done（delegated 台账在档）；测试 +7 场景（verify 落账 ×3 / 前置 ×2 / 对账 ×2）；实仓冒烟台账行 {passed:15,failed:0}；关单时新前置首次真实使用即静默通过（当天绿行对账）；独立复核 PASS 零 P0/P1，P2-1（PIPELINE_RUN_ID 无生产方）当场修复 runNode env 注入；v1-v4 装户零变化、存量零回溯；主智能体自做 |
| 2026-10-06 | 2026-10-06-template-downstream：模板下发感知机制——owned 模板 srcSha256 锚 + sync 三方 sha 判定（判据单源 templateDriftOf 四态，唯一出账=源演进且未跟随 advisory）+ doctor §6.9 只读回显 + init 初始锚 + 前缀翻译（_agents→.agents，感知面 13 件），S18/S20 装户事故根因，随 v1.1.9 发版 | 返工×1 | 三件套 done（delegated 台账在档）；返工点：① doctor 新节未登记 gate-checklist PAIRS 被 S10 拦（门禁按设计抓漏）补登记；② 复核 P2-1 前缀翻译缺失当场修复单源点并补 S15⑥ 断言；③ debug 误跑 sync 未传 --dir 致 fixture 件短暂落仓，清理 amend 出历史；独立复核七承诺全过零 P0/P1；npm test 全套件通过（关单后复跑复绿实证）；主智能体自做 |
| 2026-10-06 | 2026-10-06-check2-datetime-literal-exempt：装户回流——检查 2 日期显示格式字面量豁免（YYYY-MM-DD HH:mm(:ss) 行内剔除再判，真占位照拦），随 v1.1.6 发版 | 一次通过 | 三件套 done（delegated 台账在档）；复制双侧 + sync 刷台账一次通过（run-tests FAIL 0 / gate 绿 / 两仓 2 份零 diff）；装仓同日先行关单验证 207/207、WARN 31→29 |
| 2026-10-06 | 2026-10-06-backflow-loop-audit-remediation：装户（Shipyard.Material 2026-10-06-loop-audit-remediation）回流批次——检查 18 delegationSince 生效日豁免 + POLICIES v4 + commands 装户边界标注 ×6 + pre-push CI 注释两段式，随 v1.1.5 发版 | 返工×1 | 三件套 done（delegated 台账在档）；返工点：① 手动双侧复制漏刷 managed 台账 → trae-hooks 4 FAIL（pre-commit 模拟拦 commit），flow-kit sync 刷台账收口；② build.md 标注后 8386B 超单篇预算 8192 被拦，rule-budgets 单篇 8192→8704（512B 步进、与装户同值）双源成对；③ sync-hosts 30 对薄适配漂移 --apply 收口；终态两仓 9+1 份零 diff、run-tests FAIL 0、gate 绿 |
| 2026-10-05 | 2026-10-05-check8-digit-sha-misfire：检查 8 全数字短 SHA 误分类根治——纯数字串豁免改 rev-parse 实证分流（全数字短 SHA≈4.4%/夹具曾被误分类为时间戳文本致证据核验静默跳过）+ 豁免分支出账 + linesOf 按文件去重 | 返工×1 | incident/spec/plan 三件套 done（delegated 台账在档，指纹逐件对上）；返工点：L2 复核抓 P1——探针临时件 _probe-tmp.mjs（gitignored）在盘期间被 sync 收编进 kit.json 台账，fresh clone doctor 会 FAIL，删临时件 + sync 出册收口（教训：临时件生命周期须罩住台账刷新）；探针 A/B 修复前 10/10 复现 → 修复后 40 轮 0 次（构造性钉子场景 5u：git tag 全数字 ref）；随 v1.1.2 发版；主智能体自做 |
| 2026-10-05 | 2026-10-05-gitout-fail-open：check-loop gitOut/fs/夹具三层 fail-open 根治——spawn 异常响亮出账（stderr 按 type 去重）+ 瞬时类重试（spawnGit 统一通道）+ 夹具 gitRetry/shortSha 防瞬时失败，治 CI flake | 一次通过 | incident/spec/plan 三件套 done（delegated 台账在档）；探针 A/B 修复前 10/10 复现 → 修复后 40 轮 0 次（装副本/包源 201/0 与 199/0 差 2 为 metric-derivers 环境自适应分支）；L2 独立复核放行 + 4 项 P2 关单前收口（出账时机对称化/夹具 git add 入统一通道/计数订正/断言补注）；随 v1.1.1 发版；主智能体自做 |
| 2026-10-05 | 2026-10-05-host-gitignore-localonly-revoke：撤销 zcode/omp localOnly 档位——七宿主一律入库（init/add-host 不再向装户 .gitignore 追加宿主目录，草稿目录改装户自管） | 一次通过 | intent/spec/plan 三件套 done（delegated 台账 6 行在档，指纹逐件对上）；独立复核 8/8 验收满足、P2×3 全处置（P2-1 本单顺带、P2-2 闭合、P2-3 既有缺口不扩）；S7 断言翻转 + ROpt 可选读 + templates 注释两件 sync 刷装副本（kit.json sha 对齐）；随 v1.1.0 发版（tag + npm publish 双绿）；主智能体自做 |
| 2026-10-04 | review-fix-batch：双轴审查 13 项发现批修复（cards 键名对齐 intent 验收 / watchdead 广播+目录兜底 / 404·500 区分 / 确认门要点渲染 / 场景重号消除+type=sha 端到端正例 / safeRunPath 白名单测试 / AGENTS.md 三段式口径） | 返工×1 | incident 2026-10-04-review-fix-batch（L2，spec/plan 同名 approved+done delegated）；返工点：初版场景 47 用 import 直测——check-loop.mjs 无主守卫，import 即全量跑门禁并 exit，套件空心化（exit 0 断言全没跑），自测探针当场抓到回炉改端到端正例并回退 export（记 papercuts）；npm test 全绿（check-loop 196 断言）、浏览器实测三态（确认门要点/工单回归/空态）、doctor 13 PASS |
| 2026-10-04 | plan-section-name-evidence：check-loop 证据校验兼容 L1 plan「改动方案」节（verifyEvidenceTruth 节名正则扩一项，消除「真实提交被误判证据无关」的验收证据误报） | 一次通过 | incident 2026-10-04-plan-section-name-evidence（L2，门禁判据面；spec/plan 同名 approved+done delegated）；正/负例测试场景 43/44 钉住；npm test 全绿；发现过程记 papercuts 2026-10-04 fill-plan 行（d8d3d7d） |
| 2026-10-03 | plan 确认节模板样板豁免（检查 2 boilerRe 精确豁免确认节样板句，三 plan 占位符 WARN 清零） | 一次通过 | incident 2026-10-03-plan-confirm-boiler（L2，门禁判据面）；spec+plan 确认门逐道走（delegated）；npm test 全绿，真实仓三 WARN 3→0 |
| 2026-10-03 | check-evidence-process：检查8证据核验新增过程证据判据（runId 严格形态标记放行，+3 回归场景+防复发行） | 一次通过 | intent 2026-10-03-check-evidence-process（L2，门禁判据面）；随批修 pipeline-run 测试跨日红（PIPELINE_RUN_TODAY 钩子，挂 p2-pool-batch3）；check-loop 测试 190/0、真实仓 exit 0 |
| 2026-10-02 | pipeline-run 跨宿主全自动闭环执行器（状态机脚本+工单协议+run 事件流+命令封装五宿主） | 一次通过（演练修 3 缺陷） | intent 2026-10-02-pipeline-run；测试 18 组双侧绿；演练矩阵（L0/verify-only 本仓真实 + L1/L2/incident 沙箱真实工具链）抓 3 真缺陷当场根因修（d176321）：untracked 目录折叠误报、运行态副产物误拦、verify 后代码提交缺口 |
| 2026-10-06 | 自做（主智能体，用户交办） | v1.1.4 回流批次三件（policy v3 + 检查 8 记录型提交豁免 + 预算 fixture 自校准；intent 2026-10-06-v114-backflow-batch-r2，前组同主题 done 后双字段/改动面对齐走补偿行） | 一次通过（套件抓出 2 处 fixture 缺陷当场修：--staged agLimit 作用域、fixture 父目录） | 静态门：npm test 865 PASS / 0 fail、双源 --gate exit 0、check-loop 全绿；发版提交 f760c42 |
| 2026-09-24 | 关单 verify 固定编排脚本（npm test + check-loop 一键过门） | 一次通过 | intent closeout-verify-script；fixture 6 断言 + 真实双步绿路径实跑首跑全过 |
| 2026-09-25 | workflows 编排脚本机器 linter（解析校验先行落地）+ doctor §6.8 接线 | 一次通过 | intent 2026-09-25-workflows-linter；fixture 14 场景 + 真实仓库 baseline 断言；期间修复测试断言自身 E 码切片 bug 一次（非实现返工），实现一次通过 |
| 2026-09-25 | gate-checklist 关键词匹配退役→显式配对登记表 + --json/死代码修复 | 返工×1 | intent 2026-09-25-gate-checklist-registry；实现返工 1 次——实跑暴露小节号无尾随点解析 bug（doctorCount 8/12），正则二次修正后 14 场景全绿；真实仓库登记完整 0/0 |
| 2026-09-25 | 状态/级别枚举单源化（workflow-enums.txt + 10 处消费方归一） | 返工×1 | intent 2026-09-25-enum-single-source；实现返工 1 次——case 变量模式串 POSIX 不成立（| 是语法层 alternation，参数展开不出），实跑 69 份误报暴露后改 in_set 内建成员测试；CRLF 防御（enum_val 去 \r + 双场景）顺手落地；终态 37/0 + 20 套件全绿 |
| 2026-09-26 | 编排执行面补强（human 确认门第四形态 + wf-journal run journal） | 一次通过 | intent 2026-09-26-orchestration-journal-human；linter 15/0 + wf-journal 9/0 + 21 套件全绿首跑全过；端到端 add×3+status 实跑分层正确，演示数据已清理 |
| 2026-09-26 | check-loop sh→node 全量迁移（14 检查项 + 37 场景移植 + 5 消费方接线 + shim） | 返工×2 | intent 2026-09-26-check-loop-node；实现返工 2 次——①检查 4 漏 workflow 根级 *.md（fixture 移植实跑暴露）②.mjs 头部清单编号错位（5 并入 1 致 #7 空缺，gate-checklist 登记断档即时抓住）；终态基线快照逐行一致 + 22 套件全绿 + 净减 ~1850 行 |
| 2026-09-26 | 确认门机器化（confirm-doc TTY 脚本 + 指纹台账 + check 15） | 一次通过 | intent 2026-09-26-confirm-gate-machine；本单为流程违规复盘的机制修复，三件套逐件对话确认（bootstrap）后开工；confirm-doc 10/0 + check-loop 41/0 + 23 套件全绿首跑全过 |
| 2026-09-27 | check-loop 自查误报批修复（审查 P1×2+P2×2+P3×4 + 8 回归场景 + 适配层引用断线修复） | 返工×2 | incident 2026-09-26-check-loop-review-fixes（随报随修回溯单）；实现返工 2 次——①引用正则字符类漏逗号（`fill-{intent` 截断，场景 42 实跑红）②适配层首版脚本行尾 LF 化 + 漏 omp 宿主（sync-hosts --diff 对账暴露，改 applyForward 同款拼装重写 12+3 份）；主智能体双轴审查（子智能体供应商不可用降级亲审）+ 修复同会话；警告 32→10、check-loop 套件 49/49、doctor 12 PASS |
| 2026-09-27 | sync-hosts 适配层欠账清零（12 对 apply + 6 份新建，34 对全对齐） | 一次通过 | intent 2026-09-27-sync-hosts-adapter-backlog（incident 2026-09-26-check-loop-review-fixes 备注的遗留立项）；方向分析先行——行尾归一化 sha 比对权威源 git 全历史 12/12 命中排除手改，apply 安全；欠账根因（改权威源命令后未跑 --apply）随每次 sync-hosts --diff 非零漂移可见 |
| 2026-09-27 | 确认门对话委托代录模式（--delegated + 台账 source/quote 如实记账） | 一次通过 | intent 2026-09-27-confirm-gate-delegated（L2）；用户 5 次要求代跑被 TTY 门拒 → 问设计合理性 → 拍板「2选2」改设计；confirm-doc 13/13 + check-loop 50/50；三件套双跳用户 TTY 亲跑闭环，委托模式正式首用为同日 backlog 关单 |
| 2026-09-27 | 门禁体系加固批（审查复核 6 项：done 内容绑定 + 双源门禁接 pre-commit + 引用扫描收窄 + 配对补 spec + 边界声明） | 一次通过 | intent 2026-09-27-audit-gate-hardening（L2）；check-loop 56/0 + source-sync-check 19/0 + verify.mjs 全绿首跑全过；L2 独立复核（independent-reviewer 子代理）实证指纹互逆性 + 复跑全套，判「有条件通过」0 P0/P1（条件=用户关单追认绑定生效日切换 2026-09-28）；T2/T4 拦截探针实测留证；advisory 10→6 |
| 2026-09-27 | 机器门覆盖面补齐（incidents 确认门 + CI 服务端四道门 + quotepatch） | 返工×1 | intent 2026-09-27-gate-coverage（L2）；首提交 4652309 全绿，L2 独立复核临时克隆实证抓出 P1（CI 门在 runner 克隆必红：hooksPath / .zcode gitignore 冲突 / owned CRLF 漂移三根因）→ 2a40afb 返工收口（owned sha LF 归一 + .zcode 入库 + CI hooksPath）后克隆复跑四道门 + npm test 全绿；quotepatch 非 ASCII 探针实测；confirm-doc 15/0 + check-loop 62/0 |
| 2026-09-27 | 闭环收尾批（--to 终态确认门 + managed sha 六处 LF 归一） | 返工×1 | intent 2026-09-27-closing-coverage（L2）；实现返工 1 次——首版只归一读取侧，fresh sha 仍 CRLF（sync 23 份「本地已改」暴露），补 render.mjs 写盘归一后六处口径闭合、克隆 managed WARN 13→0（复核基线对照实证）；期间误触发 soft reset 摘掉立项提交，ORIG_HEAD 即时恢复零丢失（commit-msg 门禁拦 "wip" 试提交后清理命令时序错误的连锁，全程无内容损失）；L2 独立复核判「通过」0 P0/P1，P2-1 措辞随 a526a7f 收口；confirm-doc 19/0 + check-loop 65/0 + source-sync-check 21/0 |
| 2026-09-27 | init 安装器 P1×4 收口（执行位 / init 时序 / 供应链防线 / 记账归一） | 返工×1 | intent 2026-09-27-init-p1-batch（L2）；首提交 7903325 实测三件套全过（fresh init exit 0 / 预植恶意脚本 ×3 命令 0 标记 / CRLF 合并 owned 26 份无漂移），L2 独立复核重演实验后抓条件①（spec 承诺的测试场景未落地——实现时漏写）→ f6ffc3e 补 init.test ⑦节 5 断言 + README 威胁模型收窄（复核实测预植 .githooks 会被挂载执行，原文表述夸大）+ doctor §6.5/§6.8 存在性先行 + sync unchanged 补 chmod；init.test 28/0 + verify 全绿 |
| 2026-09-27 | 看板+kb 审查 P1×4 收口（告警单源化 / 单包崩溃 / 扩容门对齐 / kb revive 校验） | 一次通过 | intent 2026-09-27-board-kb-p1（L2）；d8dd6d4 一次落地（看板 hard-block 单源 check-loop + 双跑断言固化 10 场景 / 畸形请求 400 实测 / Host 403 / 扩容门对齐 delegations.md 反例实测 ❌ / kb 结构损坏 30 场景 + 测试注入式缓存）；L2 独立复核判「通过」0 P0/P1，P2×2（延迟 35 倍低估）随 1f7b9ed rider（60s TTL 实测 10.8s→376ms + 击键去抖）；board/agg/kb/metrics 四套件 10+14+30+16 全绿 |
| 2026-09-27 | 宿主门禁 P1×3 收口（dotnet-ca BRE 豁免 / CONTROLLERS_DIR fail-open / trae 强推 token 化） | 返工×1 | incident 2026-09-27-host-gates-p1（L1，修复类不重复记自做——此行为测试基建补记：两新套件 gate-dotnet-ca 5/0 + trae-hooks 19/0 进 npm test 常驻）；实现返工 1 次——测试夹具三修（CONFIG 整行正则替换 / Controllers 目录创建时序 / 断言误中提示语），门禁本体一次落对；L1 快速独立复核判「通过」0 P0/P1，P2×3（-vf 组合短旗标 / 跨 && 误并 / exempt 字符串拼接）随 a06e77d 全收 |
| 2026-09-27 | P2 池批一（init 装户安全 + managed sha 收尾） | 返工×2 | intent 2026-09-27-p2-batch1（L2）；c2c6316 后 L2 独立复核初判「不建议关单」——P1×3（EOL 断言读 HEAD 与 pack 读工作树错位被本提交自身证伪 / --force 追加特例缺口 / papercuts 编辑后未 sync 致 doctor FAIL）+ P2×3 → 57760ce 全收（EOL 改工作树就地归一 159 份零 CR / 追加特例端到端实测 / 台账刷齐 + protectedSkipped 补记）；教训：EOL 断言口径两轮才对（HEAD→工作树→就地归一）；init.test 31/0 + 全套 24 套件绿 |
| 2026-09-28 | 量化断言机器门 L2 独立复核（check-loop 检查 16，基准 c96a250 → c9e7ce3） | 返工×1 | incident 2026-09-28-metric-claim-gate（L2）；复核者在 detached worktree 内独立验证、**未改动主工作区**——确认 5 项断言中 4 项成立（零假阳性 / 形态收窄承重 / **检查 1-15 逐字节未动** / 测试该 1 项为 sh 环境预存 / 语法错守卫有牙），并抓出**实现方未自知的 P1×1 + P2×4**：① 转义按整行生效可藏真断言（实证：同行带反斜杠 0 告警 / 不带 2 告警）② 形态不符静默漏过 ③ `docs.count.*` 与扫描面口径不一（盘面 60 vs HEAD 59）④ 登记表误按 managed 记账（与其项目自持设计矛盾，装户加行即永久漂移）⑤ 登记表示例引用不存在的指标名——全部采纳修复 + 4 条回归场景（89→92）；**复核方法论价值**：其独立发现「c9e7ce3 自身 hard-block 自己的门」（新 spec/plan 缺同名入口文档），暴露实现方当时以「续作」为由跳过 incident 的判断错误 |
| 2026-09-25 | 会话内原生子智能体 fan-out 取代 headless runner（orchestrate 命令） | 返工×1 | intent 2026-09-25-orchestrate-in-session（回填 2026-09-29）；08f6207 落地关单后用户对话纠偏改形态为目录约定（d9a7620）；无独立复核记录（09-25 早于复核模板） |
| 2026-09-25 | 脚本化子智能体编排（workflow 脚本 + headless runner） | 返工×1 | intent 2026-09-25-subagent-orchestration（回填 2026-09-29）；3ce4ef9 关单后独立复核抓 P0×1（Windows 批处理 prompt 截断）+ P1×4，6d6e239 全修（incident 2026-09-25-wf-run-review-fixes）；runner 形态整体废止（08f6207）计入 orchestrate-in-session 行，不重复计 |
| 2026-09-25 | 编排脚本 + steps 扩展点，AGENTS.md 全宿主自动加载零适配 | 返工×1 | incident 2026-09-25-wf-runtime（回填 2026-09-29）；d9a7620 关单后回溯收口 27da05c（装副本 AGENTS.md 双源漂移 + 验收未勾 + INDEX 未刷新）；doctor owned 漂移校验（7ccc7b9/75707c3）为未立项后续加固不计返工 |
| 2026-09-26 | managed 文件台账收养分支 + doctor 台账覆盖率检查 | 一次通过 | incident 2026-09-26-managed-ledger-adopt（回填 2026-09-29）；03648df 立项 → 9d39413 实现 → 942c03f 关单；无独立复核（当时 L2 不强制，spec 节载明）；关单后无同主题修复提交 |
| 2026-09-27 | 确认门逐件化：--delegated 单文档强制 + 并录审计 | 一次通过 | incident 2026-09-27-confirm-gate-one-per-call（回填 2026-09-29）；独立复核 0 P0/P1，P2×4 关单前全采纳（0abb57d）；并录判据方向性替换另立 batch-ledger-audit 单不计本单；关单后无同主题修复提交 |
| 2026-09-28 | 装户可扩展指标取数器（内置硬编码 + 模块可选载入，fail-loud） | 返工×1 | incident 2026-09-28-adopter-derivers（回填 2026-09-29）；independent-reviewer 复核 P1×1（shipped 套件 src/ 路径在装户崩）+ P2×4 全采纳（08768eb 收口）；关单后无同主题修复提交 |
| 2026-09-28 | 并录审计改读调用事实 batch/seq/of（弃时间戳猜测） | 一次通过 | incident 2026-09-28-batch-ledger-audit（回填 2026-09-29）；verifier 复核 0 P0/P1，P2×4 关单前全采纳（acf93b6 + 583f31a）；关单后无同主题修复提交 |
| 2026-09-28 | 检查 8 生效日锚改 git 首次加入日期 | 返工×1 | incident 2026-09-28-check8-git-anchor（回填 2026-09-29）；verifier 复核 P1×1（「锚不可手填」表述不实——git commit --date= 可伪造 author date）+ P2×2 采纳（87bb788 表述更正）；关单后无同主题修复提交 |
| 2026-09-28 | 检查 15 生效日锚由自报日期改台账 ts | 一次通过 | incident 2026-09-28-confirm-gate-effective-date-anchor（回填 2026-09-29）；verifier 复核 0 P0/P1，P2×4 关单前全采纳（92cdf03）；关单后无同主题修复提交 |
| 2026-09-28 | pre-commit 补 managed 台账快检（拦 sha 预 landing） | 一次通过 | intent 2026-09-28-ledger-precommit-gate（回填 2026-09-29）；independent-reviewer 复核 0 P0/P1，P2-2/P2-3 关单前采纳（9894de7）、P2-1 为 spec 已声明取舍；关单后无同主题修复提交 |
| 2026-09-28 | opencode 命令薄适配统一 wf- 前缀（与 trae 对齐） | 返工×1 | intent 2026-09-28-opencode-cmd-wf-prefix（回填 2026-09-29）；ff3c721 还原误带入 doctor.test 的 opencode rename 预期（main CI 红）；无独立复核记录（spec 仅推荐）；关单复验为主智能体自抽 7 条证据 |
| 2026-09-29 | 检查 16 内联债拆出 check-metric-claims + 扫描口径 tracked-only + TTY 逃生门声明 | 一次通过 | intent 2026-09-29-check16-inline-debt（回填 2026-09-29）；independent-reviewer 复核 7 项全 CONFIRMED 0 P0/P1，P2×2 关单前采纳（ad2117a）；关单后无同主题修复提交 |
| 2026-09-29 | 委派台账对账检查（L2/L3 done 无台账行 → 警告） | 一次通过 | intent 2026-09-29-delegation-ledger（回填 2026-09-29）；初复核 P2×1（正例未锁整行）关单前收紧（7e8ee74），终复核 0 P0/P1/P2；关单后无同主题修复提交 |
| 2026-09-29 | pre-push 扫描被推送 sha 的 workflow 树 | 一次通过 | intent 2026-09-29-push-scans-tree（回填 2026-09-29）；复核 0 P0/P1，P2×2 关单前采纳（fcf82c7）；关单后无同主题修复提交 |
| 2026-09-29 | 发版树上 approved 未收口 hard-block（policy v2 版本锚） | 一次通过 | intent 2026-09-29-release-unclosed（回填 2026-09-29）；复核（基准 894cf8c→fc1ceff）0 P0/P1/P2；实现至关单间无修复提交 |
| 2026-09-29 | node 构建门认 scripts.build、--help 列全门禁目录 | 一次通过 | intent 2026-09-29-stack-build-when（回填 2026-09-29）；复核 0 P0/P1，P2×2 关单前采纳（7045ea8）；关单后无同主题修复提交 |
| 2026-09-30 | stage-gate-machine：流程闭环逐阶段机器化（起草门 / 确认门 / 检查19 审计） | 返工×3 | intent 2026-09-30-stage-gate-machine（回填 2026-09-30）；七轮独立复核 R2/R4/R5 各 1 项 P1（均「修上一条时引入」）→ 形态矩阵 13 例 + 反向注入验承重收口，终轮 0 P0 / 0 P1 / 0 P2；主智能体自做 |
| 2026-09-30 | confirm-gate-approved-history：done 前置门（approved 态须已进 git 历史） | 一次通过 | intent 2026-09-30-confirm-gate-approved-history（回填 2026-09-30）；独立复核 0 P0 / 0 P1，P2×6 全处置（S26 崩溃保护 + 统一台账 helper / test.md 措辞 / git 封装登记 / 两项信任边界声明）；本单为首个实践——approved 留痕提交 0189631 先于 done，关单经自建门放行；主智能体自做 |
| 2026-09-30 | p0-gate-noise-batch：门禁噪声修复批（check18 判据对齐 / check14 生效日后移 / 快照回写门禁化 / pre-push 注释对齐 / 台账补缺） | 返工×1 | intent 2026-09-29-p0-gate-noise-batch（回填 2026-09-30）；初复核 0 P0 / 0 P1 / P2×5 + 增量复核 0 P0 / 1 P1 / P2×5（F2/F3 修订后）——P1-1 提交树 kit.json 预 landing 属提交态边界（非实现缺陷），处置 = 完整提交 + clone 复验；修订轮含 F2 测试矩阵补缺（注入验承重）+ F3 方向词 + 词表误报改写；主智能体自做 |
| 2026-09-30 | adopter-surface：装户表面收口（README / CHANGELOG / 审计归档 / audit 档 / 检查 17 / 宿主薄适配 / fresh init / 三门禁） | 一次通过 | intent 2026-09-29-adopter-surface（回填 2026-09-30；实施 2c83677 完成于 09-29，本日补关单前独立复核与收口）；独立复核 0 P0 / 0 P1 / P2×4——6 组反向注入验承重、P2 全处置；主智能体自做 |
| 2026-10-01 | drift-hardening：泳道完整性门禁（触达面判低拦截 + 探索标记拦截） | 返工×2 | intent 2026-10-01-drift-hardening（L2）；实现返工 2 次——①pre-commit 接线误用 run_gate（sh 把 node 当脚本解释，trae-hooks 套件实跑抓到）②整文件暂存捆带工作区 in-flight hybrid 批内容（独立复核 P1-1，定性 fix-forward 留痕 intent 关单节）；复核 0 P0 / 3 P1 / 5 P2，P1 全采纳（c51555e 收口）；套件 19/19 + verify 全绿 + experiment 分支本仓实录拦截；主智能体自做 |
| 2026-10-01 | hybrid-governance 补档：四特性回填三件套（实现已随用户授权免档直提 20490ad 落地） | 一次通过 | intent 2026-10-01-hybrid-governance（L2 回填批，零代码改动）；独立复核 12 锚点判据全一致 / 叙事真实，1 P1（落地归属口径）+ 3 P2 全收随关单编辑收口；勾验证据引用 20490ad / fresh-clone 实录 / 复核报告；主智能体自做 |
| 2026-10-01 | M4 dogfooding 补关单（当年 L2 完成未关档） | 一次通过 | intent 2026-09-23-m4-dogfooding（回填 2026-10-01，v0.9.0 发版门检查 17 触发）——验收 5 条当年已全勾验，本仓即 init 装户，dogfooding 由后续全部闭环批（含 2026-10-01 两批）持续验证；主智能体自做 |
| 2026-10-01 | v09-review-defects 修复批（确认门伪造 + 加固门直推绕过） | 一次通过 | incident 2026-10-01-v09-review-defects（L2，spec/plan 同族）；修复 7e6bc39 + P2 收口 b1237ce；独立复核 0 P0 / 0 P1 / 3 P2，P2-2/P2-3 顺手收口；套件 solidify 16/16 + pre-push 6/6 真仓端到端 + verify 全绿；主智能体自做 |
| 2026-10-01 | gate-script-test-coverage：引擎脚本测试覆盖门（检查 20 + trust-mode 补测 + 豁免机制） | 一次通过 | intent 2026-10-01-gate-script-test-coverage（L2）；检查 20 四场景 fixture + trust-mode 8/8（含 --auto e2e 双向）+ 6 行豁免登记（零存量告警）+ gate-checklist 0 断档；独立复核两轮 0 P0/0 P1/2 P2，P2-1 收口 2fd70ae；npm test 全绿；主智能体自做 |
| 2026-10-02 | caliber-convergence：口径收敛批（plan 单源 + 泳道方案 C 分歧双严 + check2 样例豁免 + 7 P2） | 返工×1 | intent 2026-10-02-caliber-convergence（L2）；实现 6d0e9fb（36 文件）；复核初判「修复后放行」——P1×2（加固门 suspect 逃逸 spec / 5 宿主交付面未 sync）+ P2×2 全收随 2989d9c；真仓占位符误报 8→2（余 2 真阳性）；check-loop 187/0（含 H7）+ confirm-doc 48/0（含 S31b/c）+ sync-hosts 76 对；顺手修 solidify 测试跨天脆断；主智能体自做 |
| 2026-10-02 | ledger-ci-invariant：台账提交不变量（CI 历史全扫 + pre-commit --staged + 行级校验） | 一次通过 | intent 2026-10-02-ledger-ci-invariant（L2）；实现 0a11893 + P2 收口 6ad4446（删除台账即 hard fail）；预检 90 提交前缀零违例（append-only 事实成立）；fixture 12/12 真 git 仓六类篡改全检出 + 三正例防误拦；CI 五道门 + fetch-depth:0；README 硬规则 6；复核 0 P0/0 P1/1 P2 建议放行；主智能体自做 |
| 2026-10-02 | ledger-funnel-metrics：台账炼漏斗（机器口径一次通过/返工/周期入 metrics.md 双表） | 一次通过 | intent 2026-10-02-ledger-funnel-metrics（L2）；实现 dcb7d1f + P2×3 收口 ad42ca8（incident 确认阶段按件型=fixed、终态≥2 入返工定义、边界声明——重推导 108=96 完整链+12 协议前、2 返工）；fixture 七形态 24/0 + 体量零回归 + 检查 16 零接触；双月回填 09/10；复核 0 P0/0 P1/3 P2 建议放行；主智能体自做 |

## 月度聚合快照

（`node .agents/scripts/agg-delegations.cjs` 输出的可粘贴快照行落这里，每月一行）

| 月份 | 有效任务 | 一次通过率 | 平均返工 | 主兜底 | incident | 扩容门 | 备注 |
|------|----------|-----------|----------|--------|----------|--------|------|
| 2026-09 | 40 | 55% | 0.57 | 0% | 22 | ❌ 未达标（连续性中断）：2+3+5 | 样本含待修0 |
| 2026-10 | 15 | 73% | 0.33 | — | 9 | ❌ 未达标（连续性中断）：1+2+3+5 | 样本含待修0、未知1 |

## 并发扩容门槛

连续两个月一次完成率 ≥ 90%、月度返工次数为 0 且无主兜底信号，才考虑扩大并发委派；任一不达标维持单并发。门槛判定由聚合脚本输出，两处同步修改。
