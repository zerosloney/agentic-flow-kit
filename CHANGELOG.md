# Changelog

已发布版本的摘要。**能力清单的单一真相源即本文件**——README「当前能力」节只讲语义并指向此处，不重复枚举（2026-10-08 收敛：两处各自枚举导致 README 长期停在 0.8.0 的过期特性清单）。

## Unreleased

治理审查 P0/P1 收口批（kit 自研立法，非源仓回灌）。源起：对本仓做的一次深度代码实现分析
（8 个面、逐文件读码）列出 3 项安全缺口与 5 项正确性缺口，本批逐条落地。共性主题是
**「注释声称的口径与代码实际写的不一致」**——这类缺口不产生红，只在真出事时让「我以为有保护」
变成没有保护。

- fix(gate)：**敏感信息扫描不再复述密钥原文**（P0-1）。`commit-check.cjs` 命中 SECRET 后把
  **整行原始 diff** 打到 stdout——密钥于是同时进了终端回滚、CI 日志和复制粘贴历史，而这道门的
  全部意义就是阻止值扩散。改为只报 `文件:行号 键名=掩码`：掩码取前三字符 + `***（N 字符）`，
  判据（KNOWN 白名单 / SELF 自豁免）仍看整行不变，报告面收窄到位置。SECRET 正则补值捕获组，
  同时把负向先行里的类型/空值关键字改成**非捕获组**——它是捕获组时会把值组挤到 3，掩码取错组。
  测试：`commit-check-trigger.test.mjs` 补 R1–R5（真密钥命中 / hunk 行号跟随 / 白名单抑制 /
  SELF 自豁免及其反例 / 仅出现在删除行的密钥不拦），断言 `N 字符` 从被断言常量长度算出而非写死。
- fix(gate)：**TTY 确认补记机器改动面**（P0-3）。`confirm-doc.mjs` 的 TTY 分支落账漏了
  `scope{files,sha256}`，而注释声称三形态一律记入——TTY 恰是最常用形态（源仓台账约 400/406 行），
  于是最常用的那条路永久吃着「缺机器改动面」告警。check 15 的 scope 子项追问的是「放行那一刻
  盘上有哪些文件在动」，与谁点了确认无关。测试：新增 `tty-scope.test.mjs`（S1 真 TTY 落账带
  scope / S2 委托形态仍带 / S3 篡改 scope.sha256 → check-loop 报「台账 scope 失配」，干净确认后
  不再出「缺机器改动面」）。**测试教训**：check 15 在 hard lane，`--hygiene` 根本到不了它，
  S3 守卫一度是空转的（改坏的行不产生 blocker、断言因错误的原因通过）；且缺同名 plan 会先被
  检查 1 配对断裂淹掉。
- fix(gate)：**doctor 不再执行未校验的目标侧代码**（P0-2，三处）。§6.10 的 level-hints 体检是
  doctor 里唯一不过 `scriptGuard` 就 spawn 目标侧脚本的地方，也是唯一以 FAIL 级跑未校验代码的
  检查——一个被篡改的 `level-criteria.mjs` 永远返回 ok，就能把「配置错了」洗成「配置合法」。
  改为先过 guard，拒则返回 PASS + 显式「校验跳过」note（可见地不跑、不下合格结论）。另外
  `scriptGuard` 的 `!pkgRoot` 分支从 `{ok:true}`（无包源模板可比对 ⇒ 放任任意目标代码）改为
  `{ok:false}`，5 个调用点本就按 !ok 走 WARN-skip。测试：新增 `src/doctor-level-hints.test.mjs`
  （G1 guard 拒绝 → 不 spawn / G2 放行后仍能抓非法 ERE / G3 合法放行 / G4 旧签名兼容 /
  G5 无脚本时 guard 压根不调）。
- fix(gate)：**泳道完整性门新增检查 C——控制面无入口落地即拦**（P1-4）。`control-surfaces.txt`
  此前只有注释里的 P0-A 依据，没有任何代码读它。`.agents/scripts/`、`.githooks/`、`.github/`、
  `settings.json`、`engine-lock.json` 等 25 类路径命中清单且无任何活跃 L2/L3 入口 ⇒ HARD-BLOCK；
  实验分支与检查 A 同样降级 advisory（无活跃入口的既有 all-L1 档位语义不动，零影响存量场景）。
  实现为 `check-lane-surface.mjs` 的第三段，复用同一批 `stagedFiles`/`fmOf`/`requiredFor` 原语，
  不新开扫描。测试：`check-lane-surface.test.mjs` 38 → 40（C1 命中+无入口拦 / C2 有入口放行 /
  C3 清单缺失跳过 / C4 实验分支 advisory / C5 清单内自列（清单自指）/ C6 修法含收窄清单路径 /
  C7 普通路径不误触 / C8 包源模板前缀同样拦）。**修测试时暴露一个真 bug**：noEntryBlock 分支
  此前没走 experiment 降级，实验分支上的门禁改动会被硬拦，与检查 A 的处置不一致。
- fix(engine)：**TTL 落到 trust-mode**（P1-6）。`trust-mode.mjs` 记了 `enabledAt` 却没有任何
  消费方——「临时开一下」实际是永久有效，直到有人记得跑 `--disable`。新增 `parseTtlMs`
  （30m/8h/2d/裸数字=小时，不可解析 fail-loud，绝不「解析不了就当不过期」）、`--enable --ttl`
  写 `expiresAt`、`--status` 报 `expired`。**执行点单设在 `confirm-doc.readTrustConfig`**：到期
  把 `enabled` 折成 false（第一版只置 `expired` 不改 `enabled`，`!enabled` 守卫直接放行——
  是 T9 抓出来的）；不可解析的 `expiresAt` 同样按已到期算（fail-closed）；无 TTL 的老装户
  行为零变化。doctor §6.9b 直接读该文件（不 spawn，无供应链面）把唯一允许 AI 自治的开关
  变成可见项。测试：trust-mode 16/16（T9 到期拒录 / T10 未到期放行 / T11 无 TTL 永不过期 /
  T12a 非法 TTL 不落盘 / T12b 30m / T12c/d 关停即清 / T13 status）。
- fix(docs)：**workflows-check 形态口径与它自己的检查对齐**（P1-8）。E3 报文说「三形态各至少
  一行」而 E9 实际校验四形态（role/step/gate/human）；示例工作流同样只示范三个。改为四形态，
  示例补一行 `ship-gate`（human 形态）让示例自己覆盖全四种。
- fix(engine)：**级别/终态枚举从单源派生**（P1-5）。`pipeline-run.mjs` 自带第二份 LEVELS、
  `level-criteria.mjs` 自带第三份（而它自己被 new-task.md:77 称为判据单源）、`check-prejudgment.mjs`
  第四份终态、`archive-sweep.mjs` 第五六份、`wf-journal.mjs` 两份而全仓没有任何单源文件。
  其中 `pipeline-run.mjs:25` 的 `TERMINAL = ['done','superseded','cancelled','closed']` 与
  `doc.status.terminal`（不含 closed——closed 是 incident 态）**语义不同却长得一样**，是最危险
  的一份。改为 `import { LEVELS, DOC_STATUS, TERMINAL_STATUSES } from './workflow-enums.mjs'`
  （该文件自带 fail-loud 的键/值重复与缺键校验），并顺手把 KINDS 导出给 check-prejudgment 复用。
  **连带修复（真 bug）**：level-criteria.mjs 自此 import workflow-enums.mjs，而后者启动即读
  `.agents/workflow-enums.txt`——`src/executor.test.mjs` 与 `doctor.test.mjs` 的夹具原先只拷
  level-criteria.mjs，import 链一断，route/doctor 的 spawn 会以崩栈收尾而不是「缺判据单源」
  提示（fixture-scripts 头部说的假绿形态：崩栈被当成 FAIL 事实）。夹具改为连读取器 + 数据文件
  一起拷，并补 S8b 断言「判据单源在场但枚举数据缺失 → exit 1 且指向 sync」。
- chore(repo)：清掉两个调试期探针（`debug-closure.mjs` / `debug-deps.mjs`，根目录未入 files[]，
  但会让 `npm test` 首步 eslint 报 3 个 unused-vars 而整套假红）；engine-lock --update 入账
  （受检面 84 件，改动件 12 个；trust-mode.mjs 硬拦单位数 1 → 3，是新增两条 fail-loud 的加硬）。

### 台账合并与判据修复系列（自 Shipyard.Material 回灌·技术批，2026-10-20）

源仓 1.8.5 基线 38817459 之后 294 提交逐件甄别、两批采纳之一（批 2 为 pstack/matt 协议件）。五件：

- fix(gate)：**检查 23 证据路径提取扩展名交替改最长优先**（源仓 cca68879 整件）。原
  `mjs|js|ts|tsx|…|json` 中 js/ts 是 mjs/json/tsx 的前缀且交替无尾锚——`.json`/`.tsx` 判据表证据
  路径被截断成 `.js`/`.ts`，`existsSync` 恒 false，**证据永不可验**（源仓 po-close 关单实证）；
  kit 的 check-convergence.mjs 与源仓逐字同源、带着同一缺陷。改 `tsx|mjs|json|html|sql|vue|cs|md|ts|js`。
  测试：检查 23 新增 ②b 场景（.json 证据路径存在 → 不截断、无收敛误报）。
- feat(tool)：**regen-ledgers.mjs 四台账一键重生成 + .gitattributes 台账合并策略**（源仓 0bc69a24
  整件，kit 适配）。根因：INDEX/metrics/verify-evidence/delegations 是每任务必写的共享计数器，
  双分支并行合并必在计数行撞车（结构性）。`.gitattributes` 三生成物 `merge=ours`（真值源在别处，
  任取一侧 + 重生成 = 两侧并集的正确版本；stale 由检查 11 / verify 生成物一致性门兜底）、
  delegations.md 复用 `jsonl-union` 行级并集——driver 均为 init 既有本机配置，零新增。**kit 适配**：
  第四步走 kit 的 `agg-delegations.cjs` 打印回贴口径（源仓 --write 自动回写是其自有能力，kit 快照
  为人工回贴 + doctor §6.5 陈旧检测兜底），头注如实声明差异。测试：regen-ledgers.test 三场景。
- fix(test)：**pipeline-run.test 尾行并入「合计: PASS/FAIL」契约 + FAIL 计数器**（源仓 cda8c7ea 的
  pipeline-run 半件；kit 1.8.3 已修六套件，本件是 kit 仅剩的非契约尾行）。旧「N 组断言全过」双态
  尾行使该套件断言计数恒 0/0；套件本有软失败包裹，补 FAIL 计数零结构改动。
- feat(tool)：**run-tests 逐套件耗时回放 + Top3 慢套件汇总**（源仓 2555f16b① 的观测半件）。OK/RED
  行附 `X.Xs`、末行汇总 Top3。同批默认并发 `clamp(4..12)` **不采**（甄别在案）：源仓前提是
  check-loop.test 分片后地板 73.8s→28.9s，kit 未分片、地板未变，且 Windows spawn 密集有 EBUSY
  偶发红前科——默认 6 既有定案维持，注释留判据。
- feat(docs)：**test.md §4 独立复核补「意见级落账」接线**（源仓 2555f16b③）。reviews.d 建账
  （1.8.3）无落账动作 = 台账零数据（源仓实证：建账两日零落账系执行缺口）。权威源经 sync-hosts
  --apply 同步五宿主 wf-test.md。
- **甄别（不采在案）**：e83bf7f7（fileURLToPath 三套件）kit 1.8.5 已修同款；bc65fd8c（夹具 git
  身份 env 注入）kit 无 git config 子进程模式、无同源成本；2555f16b②（L1 plan 随首个实现提交）
  kit 本已同口径、源仓在向 kit 收敛；34b7a44f + c88ee652（gate-diet：pre-commit 六门降 advisory、
  体积预算恢复硬拦、钩子内并行）源仓多门钩子架构向 kit 单 check-loop 硬道形态收敛，kit 无此面、
  体积预算 kit 本就 --staged 硬拦；存量日期批注清理 ×4 属源仓 owner 风格裁定（kit 日期批注是判据
  事故锚承载体，不跟）；a2a90147（命令式重构）风格整建留案；6cc028aa/8ffa6e29/a5ea50aa 宿主台账
  数据操作无 kit 落点；44390bde（关单活文档一致性门）维持前批甄别挂起（待资产定位器泛化决策）。
- engine-lock --update 入账（受检面 84→85 件：regen-ledgers.mjs 新入；另 check-convergence.mjs /
  run-tests.mjs 改动件）。测试：npm test 82 套件 0 失败（含并行 P0/P1 批新增套件）；eslint 0 error；
  引擎完整性门自洽绿。

### pstack / matt 协议件系列（自 Shipyard.Material 回灌·协议批，2026-10-20）

源仓 d3775f9b「AI-Native 引擎面 20 笔」合入批逐件甄别，九件采纳——全部为协议 / 模板文本面，
无新机器门；三件带试挂观察语义（顺事回灌 / 提问分型 / 特性地图保活），命中不足再退：

- feat(docs)：**plan 任务拆解增「依赖」行 + build.md frontier 判据**（源仓 5248747e，blocking
  edges）：显式声明阻塞关系后「依赖行所指任务已勾选」即可开工——无未决阻塞的任务集 = frontier，
  可并行派发（多 worktree / 委派「新开+合并范围」）；纯顺序链依赖行退化为「任务 N-1」零额外成本。
- feat(docs)：**独立复核跨模型优先 + reviewed by 署名**（源仓 a8f1f88e）：优先指派与执行方不同
  代/不同家族的模型（同模型新会话有共模盲区）；复核结论首行署名模型名（「无问题」也须留名）。
- feat(docs)：**test.md 关单步增「顺事回灌」**（源仓 c90b025b，试挂 advisory）：非事故关单时列
  0-3 条环境改进候选走 papercuts 挂债——补「顺事后回灌」（incident 复盘是坏事后回灌）；不设门。
- feat(docs)：**maintain.md 增修复强度阶梯 + 攻击前提**（源仓 48b65997 + 2c342bf1 半件）：落点序
  ≠ 强度序（架构收口/钩子/CI > 自动化用例 > 规范文本，落文本须写明「为什么更强层级拦不住」）；
  同一前提下两种修法都过不了同一道验证时停下测前提本身（防换皮修复）。
- feat(docs)：**new-task.md 增提问分型**（源仓 2c342bf1 半件，试挂）：可实验的（答案能跑出来/查
  出来）先让结果说话禁停下来问，只有「任何实验都定不了」的产品/偏好判断才升级确认；与 STOP 线正交。
- feat(docs)：**review-method 增「派发前自检与轴隔离」节**（源仓 520b281a）：基准自检先行（坏
  引用/空 diff 派发前失败）、Spec 源发现序（找不到时显式报「无 spec 可依」禁静默跳轴）、双轴
  可分派两个只读子代理并行走查。
- feat(docs)：**review.md 增「PR 体三件套」节**（源仓 f82875b3）：Summary=最小视觉 / Evidence=
  Before-After 对照 / Merge Danger=门向+影响面一词；写不出「双向+局部」即触发定级复核。适配：
  Blast Radius 例词避开判级单源保留词（level-criteria S8 拦下后改「跨模块」）。
- feat(docs)：**regression-checklist 增「执法者」列 + 规则 7**（源仓 516175e1）：防复发行指认
  「复发时谁会红」，无执法资产标 `[prompt-only]` 并挂 papercuts 债；存量不回填随触碰补配对；
  条目级退役复用机制退役逻辑。
- feat(docs)：**verify-ui 特性地图机制**（源仓 bc7a0f14）：`features/` 用户 POV 四段（到达路径/
  驱动/可观察终态/Gotchas），选点按地图取覆盖、Never weaken the journey、结论附「特性地图覆盖
  M/N」。**种子 5 件不带回**（源仓采购域装户数据），地图随包机制、种子装户自建。
- **撞门在案 ×2**：①常驻面预算双红（test.md 9814B / new-task.md 9290B 超 9216）——先压缩回灌
  标注措辞，再沿 10-16 先例 512B 步进上调单篇 9216→9728（目录合计 65077B 未超不动）；②判级
  单源门（level-criteria S8）拦下 review.md 使用保留词「共享契约」——改「跨模块」，判据词表
  单源纪律零妥协。
- **甄别（不采在案）**：a2a90147（commands 命令式重构 11 处）——风格整建，kit 命令文风自成一体，
  留案待装户侧反馈；bc7a0f14 的种子特性文件、516175e1 的存量行回填——装户数据不带回。
- 权威源改动（test/build/maintain/new-task/review 五命令）经 sync-hosts --apply 同步五宿主；
  engine-lock --update 入账（受检面 85 件不变，rule-budgets.txt 改动件）。测试：npm test 82 套件
  0 失败；eslint 0 error；引擎完整性门自洽绿。

## 1.8.7

告警聚合口径批（kit 自研立法，非源仓回灌；治理审查 B 项收口）。审查依据源仓 9 天判定流水遥测
（250 次运行）：「测试绿缺凭证」一条 WARN 占全部告警 61%（1062/1738 事件），文档密集改写期峰值
14.8 条/运行——单文档多证据项逐项出账 + 全量扫描复读同一批在飞文档，复读刷屏稀释 WARN 信号价值。
92.4% 运行带 WARN（红是常态）本身即是告警疲劳土壤。**判据零变化**——同一批文档/证据项照常检出，
只改输出形态：

- fix(gate)：**`check-loop.mjs` 检查 8「测试绿缺凭证」聚合出账**。三段式：① 单文档多「测试绿」
  证据项只计一份（Map 按 rel 去重，不再逐项刷屏）；② 跨运行**当日去重**——同文档当日只逐份点名
  一次，状态面放 `os.tmpdir()` 按 ROOT 派生键（本地机判、不进装户仓、无 gitignore 依赖；fail-open：
  读失败按空集=全部点名，落失败不影响裁决与输出——advisory 层不因状态面故障改行为面）；③ 被去重
  静默的文档**聚合成一条计数行点名**（「另有 N 份在飞文档同日已点名、去重静默（前 5 名）」）——
  静默必须被计数行点名，防「没输出」被误读为「已修」，去重不吞债。状态面只留当日条目，隔日自洁。
  「测试绿缺凭证」四字连续的文案锚点在明细行与聚合规行双侧保留（既有测试锚定零改动）。
  测试：新增聚合口径两场景（单文档多项首跑只出一份明细 / 同日二跑明细静默+聚合计数行点名），
  既有 343 断言原样绿。硬拦面与本批无关未动（硬拦触发率 12.8%、判据全带事故锚——审查结论维持）。
- engine-lock --update 入账（受检面 84 件不变，改动件 check-loop.mjs）。
  测试：npm test 79 套件 0 失败；eslint 0 error；引擎完整性门自洽绿。

## 1.8.6

立项质量批（kit 自研立法，非源仓回灌）。前置分析：「草稿 → 立项 → 转 spec」三跳中立项跳最薄——
spec/plan 确认有待澄清门而 intent 确认没有；工程品味条款（简洁 / 反过度设计类）整条起草链无落点。
两件落地，均属「给既有时刻喂一条线」，无新文件、无新层。

- feat(gate)：**待澄清门扩到 intents（立项跳对称化）**。confirm-doc 的 clarify 挂载点从 specs/plans
  扩到 intents（判据单源 `stage-gates.mjs#openClarifications` 不变——纯正文标记行扫描，文档类型无关）。
  **推翻旧判例**「澄清天然发生在需求单处」（S19c 旧断言随之退役）：intent 是后链全部文档的种子，
  立项时被含混带过的不确定项到 spec/plan 跳已无人能补标。存量 intent 无标记零回溯（标记驱动而非
  日期驱动，不占 policyVersion）；incidents 生命周期无 approved 态、不在门面。stage-gate 与 clarify
  拆为两个独立 if——前置门仍只适用 specs/plans（入口文档无「前置」概念），文案锚点「未过逐阶段前置门」
  子串原样保留。intents/_TEMPLATE.md 补待澄清起草指引；README 范围表述同步。测试：S19c 重写为
  intent 三态（挂未澄清项 exit 2 + 点名内容 + 未落盘 / 已澄清放行 / 无标记存量口径放行）。
- feat(docs)：**AGENTS.md 项目适配区新登「工程原则」节**——内容质量引导融入起草链的装户落点
  （外部对标：GitHub Spec Kit 的 constitution 是同位物，kit 侧定为装户自填自持、不入 managed 同步面）。
  品味条款示例四条（简洁优先直接用平台能力不另包一层 / 新依赖须证不可替代 / 禁 speculative 功能 /
  spec 写 WHAT/WHY 不写 HOW）；消费方三处：起草 intent / spec 自查、spec「约束遵守映射」表（表头改
  「红线 / 工程原则」）、独立复核 Standards 轴。**与红线的区别显式声明：违反红线 = 判低升档（机器）、
  违反本节 = 复核意见（人工判）——本节不进任何机器判据**。design.md 起草指令同步点名（权威源经
  `flow-kit sync-hosts --apply` 同步五宿主 wf-design.md）。
- **撞门在案**：工程原则节使 templates/AGENTS.md 实测 8546B 超 8192 预算（src/rule-budget 套件
  R-file/R-render 双红）——先压缩新增段措辞，再沿 2026-10-07 同文件先例（合法结构增长）512B 步进
  上调 8192→8704，理由行随表入档。
- engine-lock --update 入账（受检面 84 件不变，改动件 3 个：confirm-doc.mjs / design.md /
  rule-budgets.txt；confirm-doc.mjs 硬拦单位数随新拒绝路径 +1）。测试：npm test 79 套件 0 失败；
  eslint 0 error；引擎完整性门自洽绿。

## 1.8.5

自 Shipyard.Material 回灌「时序与校准系列」增量（源仓 1.8.4 基线 76294817 之后引擎提交逐件甄别，
三个提交各取其半件/整件采纳）。取 patch 位——一条测试 harness 缺陷收口 + 一处关单时序协议修正 +
一组校准方法论升级，无新门、无行为面变更。源仓 44390bde「关单活文档一致性门」为有锚新门但需适配
设计（资产定位器泛化 + 单体 check-loop 接线），体量与决策单独成批，甄别在案、本批不带。

- fix(test)：**两个测试 harness 的 CLI 路径改 `fileURLToPath`**（源仓 fdded128 整件）。手搓
  `new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')` 解码在 Windows 非 ASCII
  worktree 路径下被 URL 百分号编码坑坏——子进程 `Cannot find module` 静默红（源仓中文路径 worktree
  实证；kit 主仓 ASCII 路径对照绿，属同源潜伏缺陷）。kit 侧全仓扫得两处：模板件
  `check-scope.test.mjs` 与源仓逐字同源；kit 自有件 `src/jscpd-drift.test.mjs` 同根因一并修。
  源仓另两个套件（compact-ledgers / git-merge-jsonl）kit 已是 `fileURLToPath` 写法，无需动。
- fix(docs)：**build.md §5 plan 关单时序统一**（源仓 e0a53288 的 build.md 半件，适配采）。原「plan
  状态 → done（实现完成）」与本文件 §4「`done` 只在关单出现」自相矛盾，也与 test.md §6「同族收尾时
  plan 一并置 done」时序打架——build 阶段置 done = 绕过 test 验收勾验与 confirm-doc 确认门、触发
  检查 15 指纹对账。改法：plan 保持 `approved`，done 在 test.md §6 验收勾验后经 confirm-doc 置
  （intent / spec / 修复的同名 plan 亦在 test 一并收口）。权威源改动经 `flow-kit sync-hosts --apply`
  单向同步五宿主薄适配（claude/codex/cursor/opencode/trae 的 wf-build.md）。同提交其余不采（甄别在案）：
  pre-push 门数
  注释 7→8 与 AGENTS.md 引擎面枚举补齐是源仓自身漂移修复，kit 的 pre-push 无门数注释、test.md
  「七门」与实际七门一致，无对应面。
- feat(docs)：**校准集「双臂盲评 + 方差复跑 + 月度留痕表」口径**（源仓 24178a42 的黄金集半件，
  适配采——1.8.3 已采「校准集」节的本体升级）。A 臂（默认）装载本技能复核、B 臂（对照，月度抽
  5–8 条）同样题面给干净会话只给样本内联上下文——**Δ = A 命中差 − B 命中差**才是「上下文注入起
  作用」的证据（两臂同样准 = 校准力来自样本内联；两臂同样差 = 已知答案不可判，两种情形都记留痕表
  「臂」列不互相冒充）；可疑判定**方差复跑**（同会话原样再评，翻转计题面歧义不计校准差、另开
  papercut 修题面）；校准债（命中差连续两月 >20%）前提是先剔方差翻转的判定；月度留痕表列架随
  SKILL.md 下发（月份｜参评样本数｜臂｜命中/误报/漏报｜Δ｜方差翻转次数｜与 reviews.d 互参谋注）。
  同批采纳 mechanism-registry 维护纪律补笔：**数据面机制「现役」≠「有数据」**——未产生数据的月记
  「无跑数」，退役阈值只数有数据月（年轻遥测不造假候选，口径同 `agg-judgments
  --retire-candidates`）。同提交其余不采（甄别在案）：agg-delegations 未记分列——kit 的
  `agg-delegations.cjs` 是「产出接受率」谱系、无返工原因列机制，其锚 `2026-10-11` 是源仓台账数据，
  无落点；解散 engine-internals——kit 的 notes 件存在且被 new-task.md / rule-budgets.txt 正常引用，
  非悬空引用；`.gitignore` 忽略 research/ 属宿主面。
- **甄别（不采在案）**：f00f5abf / 5b111320（gitleaks 基线豁免、叙事门数改条件口径）——kit 无
  gitleaks 机制，kit 门数恒七门无叙事漂移面，改动全在宿主数据文件；8adcdab3（集成清理超时 + E2E
  冒烟选择器收口）——源仓 C# 测试栈特化；f2abcda9（check-loop-rev 断言随 s06 退役）——挂起随
  44390bde 单独批；其余源仓提交为业务（purchase/inventory）与宿主台账数据，非引擎件。
- engine-lock 受检面 84 件不变——本批改动件（模板 test 件、命令/技能/登记册文档面）均在受检面外，
  基线无哈希变更。测试：npm test 79 套件 0 失败；eslint 0 error；引擎完整性门自洽绿。

## 1.8.4

自 Shipyard.Material 回灌「性能系列」（源仓 76294817「门禁层并行编排 + 台账门/语法门批量化」整件，
判据与输出语义不变、纯提速；1.8.3 甄别时按体量单独成批）。源仓实测：全量 verify 本机 318s→125s、
台账不变量门 51.3s→23.6s、语法门 8.1s→4.2s。kit 门表七门体量小于源仓 18 门，收益按装户历史规模
线性放大——机制随编排器分发，装户增门即受益。

- perf(gate)：**`verify.mjs` 并行编排**。串行 for+spawnSync 改工作池并发：`--jobs N` / `--serial`
  （缺省 clamp(2..4, floor(cpus/4))，`--jobs 0`/非整数 fail-loud exit 2）；guardian 门
  （scripts-syntax）串行先跑、未过即止（引擎脚本不可解析时其余门无意义，夹具根下不并行铺开）；
  **deps 依赖边机制**随门表下发（kit 七门当前无边——源仓用于 backend-test 待 backend-build 防
  MSBuild obj/bin 文件锁，装户增门可用）；fail-fast 保留：任一门红 → 停排新门 + Windows
  `taskkill /T /F` 树杀在跑门（shell:true 下 kill 只杀 cmd.exe 壳不杀孙进程）；单门输出缓冲
  整块回放 + 超 32MB 上限即树杀判红（与旧 maxBuffer 同口径，不静默截断）；「未执行门」清单改按
  「已出裁决」算，**被树杀的已中止门同样状态未知、一并点名**（kit 对源仓的口径补强——源仓只列
  未启动门，已中止门逐门 ⏹ 行之外不在汇总清单里）；装户仓跳过测试门（⏭ 2/7）语义原样保留。
  绿行新增 `wallMs`（并发后 `totalMs`=各门之和已非等待成本，两者并存续接历史口径）+ `durations`
  逐门毫秒；stdout 增「门禁成本：墙钟 Xs｜各门合计 Ys｜最慢三门」行。测试：场景 15a-15c
  （--jobs 2 / --serial / --jobs 0 fail-loud），既有 14 场景在并发编排下全部原样通过（断言均为
  包含式，fail-fast/未执行门/凭证计数/装户跳过语义无回归）。
- perf(gate)：**`check-ledger-invariant.mjs` git 批量化**。历史全扫原为逐提交 `git show <sha>:<path>`
  + `git log -1 %P`（O(提交数) 次进程创建，Windows 单次 ~68ms，随历史线性膨胀）；改为一次
  `git log --full-history` 同取 sha+父（historyEntries 按 rel 缓存并回填 parentMap）+ 每路径一次
  `cat-file --batch` 预取全部 blob（blobCache，O(路径数)）。**判据与输出逐字不变**（46 场景原样
  绿）；cat-file --batch 非零属真错误（仓库不可读/spawn 失败），响亮抛出而非静默置 null——静默
  会让每个 blobOf 都判「对象不可读」，把环境抖动伪装成满屏「台账删除」假硬拦。
- perf(gate)：**`check-scripts-syntax.mjs` 工作池并发**。node --check 无原地解析 ESM 的 API，逐文件
  起子进程改 min(8, cpus-2) 并发；判红集合不变，判红输出按路径排序（并发下不回放乱序）。
- `engine-lock.json --update` 入账（受检面 84 件不变，3 个改动件）。测试：npm test 79 套件 0 失败
  （verify 套件 32→35）；eslint 0 error；引擎完整性门自洽绿。
- 源仓同批的 metrics「门禁成本表取 wallMs 优先」不采（甄别在案）：kit 的 metrics.md 无门禁成本表
  （源仓第六表面），verifications.jsonl 绿行的 wallMs/totalMs/durations 已随本批入账，装户读方
  按需自取。

## 1.8.3

自 Shipyard.Material 回灌「度量与协议系列」增量（源仓 2026-10-16 基线 2ff869a9 之后十三个引擎相关
提交逐件甄别，六件采纳 / 七件不采）。取 patch 位——两条缺陷修复 + 一组协议口径 + 两处度量扩展，
无新门；性能线（源仓 76294817 门禁并行编排）体量大，移至 1.8.4 单独回灌。

- fix(tool)：**`solidify-task` 草稿目录纠正**（源仓 8deb032b 的 solidify 半件）。原 `.zcode/drafts`
  自引入起从未存在（宿主保存工作流草稿的实际目录是 `.zcode/workflow-drafts`）——脚本一跑即
  「草稿目录不存在」fail，同源缺陷 kit 原样带着。测试 fixture 同步 9 处。同提交其余不采（甄别在案）：
  dwf 加载契约门在源仓 `check-loop-sections/s05` 布局（kit 无该布局，1.8.2 已同因不采）；两个
  `.dwf.ts` 修正是源仓 `.zcode/workflows/` 自有工作流件；AGENTS.md 引擎面收口属宿主根文档。
- fix(test)：**六个套件汇总行对齐 run-tests 解析口径**（源仓 dbfa0f21 的汇总行半件）。kit 的
  `run-tests.mjs` 只认 `合计: PASS n / FAIL n`（无该行按 0 计），而 check-ledger-invariant /
  check-lane-surface / solidify-task / lane-surface-audit / pre-push / trust-mode 六套件是历次回灌
  带来的源仓风格 `✅ all passed（N passed）`——聚合断言计数恒 0/0。逐套件一行修齐。同提交的
  SCEN 自分片不采：kit 套件规模远小于源仓 54s 场景，且 run-tests 已有套件级并发，自分片只增复杂度。
- feat(metrics)：**独立复核效果台账（reviews.d）+「复核效果」第三表**（源仓 ae59faa3）。
  `workflow/reviews.d/<YYYY-MM>.md` 一行 = 一次独立复核事件（八列：日期/对象/复核员/意见数/采纳/
  拒绝/误报/备注），自洽不变式 采纳+拒绝+误报=意见数——`gen-workflow-metrics` 的 `scanReviews()`
  读分片，字段非法 / 自洽破坏 fail-loud 点名分片，目录缺失 = 合法零数据出占位行；月度聚合出
  采纳率/误报率（区分「门禁制造返工 vs 拦下问题」的意见级信号）。同批采纳其捆绑的**中位周期渲染
  修正**：真实亚小时周期不再被 `toFixed(1)` 印成 `0.0`（改写 `<0.1`；恰好为 0 仍 0.0，null 仍 —）
  ——「取不到」与「极快」不得同形。kit 适配：分片头注是宿主数据，列格式与自洽约束写进
  `review.md` 落账子项 + `workflow/README.md`「量化」条目；回吸分段标记与表头文本解耦（短标记
  `## 闭环漏斗` / `## 复核效果`，表头措辞演进不再破坏旧文件回吸）。测试 R1-R3b + L8。
- feat(metrics)：**spec 体积观察第四表 + spec 生命周期口径**（源仓 848bc788）。口径（Böckeler 三层
  分类取 spec-anchored + 长期维护）落 `workflow/README.md`：spec 是持续对照的事实源、交付后不失效，
  代码触及 spec 覆盖行为须对照（含归档件），漂移要么改回代码要么同提交回改 spec、有争议立 incident；
  **归档是容量治理不是失效**（只移出活跃扫描面，事实源地位与原地修订权不变）。`gen-workflow-metrics`
  新增活跃/归档 specs 的份数 / 行数中位 / 最大 / 验收条数中位 / 最大（排除 _TEMPLATE；目录缺失 =
  合法零数据；整表确定性再生）。advisory 上限显式延后（先观察后设限）。测试 S1-S2。
- feat(docs)：**机制台账「模型代际触发」维度**（源仓 6d18dcd8 的台账半件）。维护纪律新增：主力模型
  代际变更（主版本/家族更换）后的下一次月度对账按能力假设五组（A 纪律假设 / B 能力边界 / C 机器判据 /
  D 宿主生态 / E 测量自举）逐件重评，重评不改状态列（退役仍走既有阈值）；A 组不因代际主动拆门、
  B 组须主动重评、信任边界与安全主干代际不撤门。kit 适配：A-E 组内机制清单属装户自有（源仓枚举的是
  其仓机制），改为分组判据 + 首次对账归类指引；同批登记「复核效果台账」示例行。源仓 delegations
  模型代际基线注不采（kit 无该台账模板面，属装户数据）。
- feat(docs)：**review-method 技能「校准集」节**（源仓 87ddb7c5 的 SKILL 半件，适配采）。建集方法
  （正例=应报缺陷 / 负例=应放行、每条带「为何需本仓上下文才可判」、答案锚定闭环时定性、宁缺毋滥）
  与使用法（上岗盲评自检、月度对账与 reviews.d 互参、命中差连续两月 >20% 登记校准债）随 kit 分发；
  **25 条样本库不带回**——源自源仓已闭环 incidents，属装户数据，kit 措辞显式声明「装户自建、
  kit 不随包分发」。
- **甄别：[NEEDS CLARIFICATION] 模糊点显式阻断标记不采**（源仓 6a7d9ab3）。kit 已有同位**更强**
  机器面——plans/specs 模板的 `- 待澄清：` 标记（2026-10-12 needs-clarification）起草零阻塞、
  draft→approved 确认时 confirm-doc 挂未澄清项直接拒绝落账（S19b exit 2）；源仓该件是纯文档约定
  （grep 自检），移植即同位双机制，违反单源纪律。
- **甄别（不采在案）**：源仓 34cd1dc1 台账不变量复位——基线前移值与特许重排属装户 owner 声明的
  数据操作，matchRebuild 放宽依赖 kit 未分发的 ledger-rebuild-manifest 机制，无落点；c71e3111 +
  223d4d4e + 9de5b680 依赖审计门换源→三门退役→威胁情报登记——kit 门表从未有 nuget/frontend 审计门
  （退役判据「内网镜像不代理漏洞数据面→判据既可假绿也可假红」留作装户判例）；e93c64cb AI-Native
  范式对标笔记是对源仓自身的评估，kit notes 模板是机制文档；a604c3cf 段数预算 26→23 登记依附源仓
  sections 布局（底层合并 1.8.2 已甄别不采）；其余为宿主台账数据提交。
- `review.md` 权威源改动经 `flow-kit sync-hosts --apply` 单向同步五宿主薄适配
  （claude/codex/cursor/opencode/trae 的 wf-review.md）；`engine-lock.json --update` 入账
  （受检面 84 件不变，2 个改动件）。测试：npm test 79 套件 0 失败（metrics 套件 23→35）；eslint 0 error。

## 1.8.2

自 Shipyard.Material 回灌「减重系列」增量（源仓 2026-10-15/16 九个引擎提交逐件甄别）。取 patch 位——
均为源仓既有能力的对齐回灌，非 kit 新能力设计；两处行为变更（构建门后移、特性分支不归档）见下。

- **甄别：规则段合并 26→23 不采**（源仓 95352f55）。该重构的动机是源仓 `check-loop-sections/` 目录
  在 `#count` 条目数预算下的减重，kit 无该目录布局（检查段执行体在单体 check-loop.mjs 与
  check-hygiene 模块内，见 ARCHITECTURE §8.1）；且源仓「编号承重不重排、留疤不回收」——两侧编号空间
  保持同构，未来源仓提交按旧编号引用无需映射表。宿主数据（分片清理 33 个 jsonl、台账归并、wiki html）
  不带回。**采纳其 §17 无 version 快径**：当前树 package.json 无 version 字段（装户非 node 仓 / 快照树）
  → §17 整段跳过，省去全历史 git log+show 扫描（无 version 则「版本变化提交」永不存在）。适配点：
  源仓 s17 为独立模块函数用 `return` 快返，kit 单体函数内改 if 包裹，保后续段照常执行。
- feat(gate)：**条目数预算 `<N>#count`**（源仓 d6dd5032）。`rule-budget.mjs` 上限字段支持
  `<N>#count` = 匹配文件**条数**上限（区别于字节），`--staged` 门控与 glob 形态同字节口径；
  旧格式行零影响，`#count` 行对旧读者因上限非纯数字被跳过（fail-open 不误拦）。补同名直测黑盒套件
  T1-T8（字节语义不回归 / 超限与压线 / 混合表互扰 / 缺表 exit 0 / staged 门控 / glob 条数），
  `scripts-test-exempt.txt` 中 rule-budget.mjs 登记随之撤除。**kit 模板未预设条目数锚行**——kit 无源仓
  `check-loop-sections/` 面，规则面锚对象属装户自有决策（格式说明随表下发）。
- feat(tool)：**`agg-judgments --retire-candidates`（规则死亡机制）**（源仓 ee77a25e）。连续 N 个
  **有数据月**零命中（WARN+BLOCK=0）的规则列为退役候选，按全历史命中升序输出；断档月不按零命中计
  （防漏跑误判），数据月不足窗口不产候选（年轻遥测防假候选）。测试 S4-S7。
- feat(tool)：**`mechanism-retire-watch.mjs` 机制退役催办**（源仓 L5 自举接线批，kit 补采）。读机制
  台账「退役阈值」+ judgments 聚合，阈值触达/待退役逾期自动产动作项；**缺月不算零命中**（日历窗口
  内有缺月即交人工判）。纯函数 evaluate 套件 S1-S8。kit 适配：台账路径平铺 `.agents/mechanism-registry.md`。
- feat(tool)：**`closeout-l1.mjs` L1 关单一把编排**（源仓 93c95ce1）。预检快筛（级别/状态/勾验/绿凭证）
  → `--delegated` 原样转发 confirm-doc（强门全在彼处）→ INDEX 重生成 → 提交清单；L2/L3 与 incidents
  不受理（不做捷径）。**kit 修源仓一处缺陷**：源仓提交清单拼 `<基名.md>.jsonl`，与写入口径
  `confirmations.d/<基名去.md>.jsonl` 错位（其测试只盖纯函数未暴露）——kit 抽 `shardOf` 纯函数修正
  并以 A7 断言钉死。verify 预检镜像 kit done 前置口径（policy v6+ 按 verifyDocSince 绑定本单绿行）。
- feat(tool)：**`gen-workflow-metrics` 增归档积压提醒**（源仓 60d1e9e2）。月度 stdout 报「候选 N 篇 /
  M 族（21 天窗）」，判定单源 `archive-sweep.analyze`（禁第二套口径）；`loadLedgerTs` 导出供复用；
  异常 fail-open 静默——观测提醒不挡快照。
- feat(docs)：**`notes/engine-internals.md` 维护者单页**（源仓 bafa4f55 终态）。收深水区：预判对账机理、
  kind 词表单源、规则生灭机制（退役候选 + 条目数一进一出）；`new-task.md` 增「预判留痕」指针行
  （使用者面只留两问定级 + 路由表）。预算随动：`commands/*.md` 单篇 8704→9216B（512B 步进，实测 8914B）。
- fix(gate)：**合入与关单六处缺口**（源仓 13f67ef7）。① `check-lane-surface --merge`：合并提交时
  检查 A 跳过（git merge 自动提交窗口 MERGE_HEAD 已不可靠，pre-merge-commit 显式传旗标；冲突解决后
  手动 commit 仍由 MERGE_HEAD 探测兜底）；② **confirm-doc 特性分支默认不归档**（分支上先关单再合并
  时 diff 只剩 archive/ 路径、增量门只认活跃直路径；main/master/develop 与游离 HEAD 维持归档；
  `CONFIRM_DOC_ARCHIVE=1` 可强制）；③ §23 解锁序改为「改正文 → 状态改回 approved → confirm-doc
  重录指纹 → 再标 done」，路径面放行 `.vue` 与中文目录（`PATH_RE` 单字符类 + 前缀锚，防回溯）；
  ④ `verify --stub-gate`：单门夹具走生产尾段（落凭证），必须配 `CHECK_LOOP_ROOT`（禁在真实仓落无关单
  凭证）；⑤ `ledger-shards --append --section`：带节标题的行插入对应节而非落到文末自表；⑥ pre-push
  每本地日跑回路日检（退役催办 + papercut 报债，advisory，摘要落 `.agents/cache/loop-watch.jsonl`）。
  另**补 kit 缺失的合并态台账对账**：`--staged` 路径此前只有前缀判据，多父合并（暂存=父母并集）必然
  误拦——移植 `mergeUnionProblem`/`mergePruneProblem` 集合对账（签名自 sha 改收 parents 数组，历史
  全扫与 `--staged` 共用同判据），补 M12 夹具（删双父共有行仍拦）。
- feat(gate)：**构建门自 pre-commit 后移 pre-push**（源仓 2ff869a9）。`commit-check.cjs` 增
  `--no-build`（常规提交只做敏感扫描）与 `--range <old> <new>`（推送范围文件面；全零 old = 新分支
  首推取全量构建语义；范围模式跳过敏感扫描——逐提交时刻已扫）；pre-commit 常规提交传 `--no-build`、
  合并提交仍 `--full`；**pre-push 整体 node 化**（保留 kit 加固门：源仓已于 2026-10-10 退役该门，
  kit 维持自身决策不跟）并按推送范围跑构建门（experiment/* 目标降级 advisory）。测试：
  commit-check-trigger S10-S13、pre-push 构建门三态断言。
- 源仓差异不跟（甄别在案）：绿行 suite 名 kit 维持 `'npm test'`（源仓为 `'all-gates'`，各自与
  `gen-verify-evidence` 消费口径自洽）；papercut 报债复用 kit 既有 `papercut-debt-sensor --json`，
  不移植源仓 `papercut-debt-report.mjs`（kit 无该件、能力等价）。
- `engine-lock.json` `--update` 入账（受检面 82→84 件：新增 closeout-l1 / mechanism-retire-watch；
  18 个改动件）。测试：npm test 79 套件 0 失败；eslint 0 error。

## 1.8.1

自 Shipyard.Material 回灌引擎增量（源仓 2026-10-15 三引擎提交逐件甄别同步；宿主数据与 kit 不适用件
不带回，甄别记录见第 3 条）。取 patch 位——一个门的 advisory 噪声削减 + 一个方法层文档件，无新能力面。

- fix(gate)：**检查 25 终态跳过（不可消除噪声削减）**（源仓 06b8c79b「§14/§25 不可消除噪声削减」的
  §25 半，判据逐字对齐 s25-prejudgment）。终态文档（done/superseded/cancelled/fixed/closed——doc 终态
  与 incident 终态的并集，workflow-enums 无单一键覆盖该并集，故与源仓同款内联声明）跳过形态/词表类
  告警（「预判字段不可解析」三种：整体不可解析 / kind 不在词表 / level 不在枚举）；**类型/级别比对
  保留**——那是路由审计的本体信号，judgments 灰度对账照常采集。动机：终态件受检查 15 内容绑定不可
  修订，此类 WARN 永不可消，违反「不可消除噪声」红线。测试：check-loop §25 场景 ④⑤ 夹具改 approved
  活文档态（done 自本版起不再产形态类告警）+ 新增 ⑥ 终态跳过场景，341/0。
- feat(skill)：**review-method 技能——复核走查方法层单源下沉**（源仓 dbbc1998）。新增
  `templates/_agents/skills/review-method/SKILL.md`：复核三层单源分工（拦什么 = review.md P0/P1 表 /
  以什么身份 = independent-reviewer / 怎么走查 = 本文件）、Standards×Spec 双轴独立报告禁合并排序、
  坏味道清单为判断项非硬违规（成文标准优先压制）、结构化修复动作、合入标尺防 P2 纠缠。
  `commands/review.md` 方法行自「参考 `code-review` 技能」改指仓内单源——摆脱宿主全局技能依赖，
  宿主有全局 `code-review` 技能时可叠加。render 目录级整拷，装户径零适配（无占位符、无实例路径）。
- 源仓同批**不同步件甄别记录**：① 06b8c79b 的 §14 半（豁免锚改 `check14HardSince` 优先、advisory
  窗口并入存量豁免）——kit §14 恒 advisory（policy.mjs v9–v12 注释明载未引入 hard 档与该键），源仓
  patch 自带兼容口径即「无 check14HardSince 的 policy 维持原 advisory 口径、该档 WARN 是唯一执法面
  不豁免」，kit 正属该情形且 §14 既有测试钉死现行锚（check14Since）；② 796c3fb6 gitleaks 基线同口径
  重生成 1221→1227——gitleaks 门整体未回灌 kit（无 check-secrets.mjs，verify GATES 无 secrets-scan），
  `.gitleaks-baseline.json` 与 1227 口径叙事均为宿主数据；③ d4cf9bc7 委派台账补账——Material 宿主
  台账数据，非引擎件。
- `engine-lock.json` `--update` 入账（受检面 82 件不变；1 改动件 = check-prejudgment.mjs）。

## 1.8.0

协议级回灌收口（B1–B10b，自 Shipyard.Material 参考实现）：引擎通用能力整体对齐参考仓——门禁面、判定面、
台账面、观测面、执行面五线同批演进，取 minor 位。本条按能力面组织（不逐批流水账）；各件适配点与源仓
沿革留痕在包源仓 git 历史，装户径不引实例路径。

- feat(gate)：**门禁去 sh 化 + pre-commit node 化（B2）**——动机：Windows CI / 无 git-bash 装户侧
  sh 门会静默跳过。① 移植 `templates/_agents/scripts/rule-budget.mjs`（唯一适配：预算表路径
  `.agents/config/rule-budgets.txt` → kit 平铺 `.agents/rule-budgets.txt`；--all/--staged、退出码、
  git cat-file 字节口径、缺表 exit 0 逐字对齐），删除 sh 版；`check-hygiene` 检查 13 改 node 直跑
  （删「无 sh 环境静默跳过」分支，恒可跑）。② 移植 `hooks/check-pairing-incremental.mjs` /
  `hooks/check-wiki-ledger.mjs`（逐字），删除对应 .sh。③ 新增 `hooks/check-index-incremental.mjs`
  （workflow/INDEX.md 漂移增量硬拦：暂存触及 workflow 四目录/归档/INDEX.md 时跑 `gen-workflow-index
  --check`）+ 同名直测 9 断言。④ `.githooks/pre-commit` / `pre-merge-commit` 整体 node 化
  （CommonJS、无扩展名、shebang 即 node，门脚本缺失 fail-closed）：门序 = 闭环配对(增量) →
  泳道完整性(增量) → wiki 台账(增量) → 索引漂移(增量，新) → 常驻面体积预算(增量) → 确认台账不变量
  (暂存触台账，kit 独有：主台账 ∪ `confirmations.d/<doc>.jsonl` 分片触发面与专有文案) → 项目门禁
  挂载点 → 敏感信息扫描+条件构建（`commit-check.cjs`，MERGE_HEAD 补 `--full`）。适配点：源仓
  「叙事承重(增量)」门不移植（kit 无对应叙事单源）；`local-pre-commit` **保持 sh 挂载点形态**
  （add-gate 生态按行写 sh——sh 缺则 bash 执行、存在即执行、缺失 advisory）；experiment/* advisory
  文案沿 kit（转正由 pre-push 加固门兜底）；泳道完整性/预算门自「旧装副本缺失自然跳过」改
  fail-closed。⑤ 判据随动：`check-engine-integrity.mjs` 的 `hardUnits` 钩子分支并计 CJS 硬拦形态
  `process.exit(非零)` 与 sh 形态 `exit 1`（sh 侧计数不变、exit(0) 不计；node 版 pre-commit 计 6 ≥
  冻结值 4 无收缩）——本门文件头「改判据基线并走评审」的合法演进路径，与 CHANGELOG 同批留痕；
  `scripts-test-exempt.txt` 登记 `rule-budget.mjs`（判定器，check-loop.test 场景 28-30 间接覆盖）；
  `engine-lock.json` `--update` 入账（受检面 60→65 件）。⑥ 文案随动：`maintain.md` + 5 宿主
  `wf-maintain.md`（预算门 `sh … --staged` → `node … rule-budget.mjs --staged`）、`edit-face-check` /
  `agg-gate-stats` / `gate-seg` / `gen-workflow-dashboard` / `gen-workflow-metrics` / `fixture-scripts` /
  `check-lane-surface` 引用与注释、两份 `.gitattributes`（删随 .sh 注销的 eol 行）。负例探针：
  干净合规树 `--staged` exit 0；预算限值压小后 `--staged` exit 1 并点名超限件。

- feat(tools)：**独立工具件四件入库**——① `rewrite-file.mjs`：按行字面替换 + `--expect` 命中数对账 +
  写后回读校验 + 同目录临时文件原子写——堵 `node -e "s.replace(A,B)"` 对 **CRLF 检出文件**用 `\n`
  锚串定位时**静默无操作**却照样打印「落盘 OK」的假成功形态（假成功比响亮失败危险：台账/文档被以为
  改了；0 命中即非零退出且不写盘；另防 find === replace 无操作与目标文件不存在静默建空文件；
  `--dry-run` 预览、`--allow-multi` 显式声明多命中）。② `git-core.mjs`：引擎 git 调用单源——spawn
  参数数组不走 shell、win32 `git.exe` 显式解析、`CHECK_LOOP_GIT` 测试注入钩子、瞬时类错误
  （EAGAIN/EPERM/EMFILE/EINTR）单次重试且重试终败响亮出账、只读查询记忆化（带 error 的基础设施失败
  不缓存）、maxBuffer 32MB；收编 check-loop 与 stage-gates 的「同口径两份实现」。③
  `check-scripts-syntax.mjs`：守护者受守护——对 `.agents/scripts` 与 `.agents/hooks` 全部 .mjs/.cjs
  逐个 `node --check`，任一不可解析判红（先例教训：一处 SyntaxError 带病进 CI，全链门静默失效）；
  检查目录缺失或可检文件数为 0 一律判红（fail-closed，防「改坏/删脚本即去门」）；只读裁决、零依赖
  独立调度，verify GATES 首门。④ `run-tests.mjs`：装户侧引擎测试统一入口——`.agents/scripts/
  *.test.mjs` 并行执行（默认并发 6）、每套件输出缓冲完成即回放、stderr 红套件尾部回放、聚合计数与
  机器可读汇总行；与包源 `npm test` 同构（逐个 node 直跑，不引 node:test）。四件均同名带测。

- feat(gate)：**越界门与触达面审计（B3）**——两件 advisory 级工具进包。① 移植
  `templates/_agents/scripts/check-scope.mjs`（+ 同名直测 8 断言）：plan「改动面 / 任务拆解 / 改动方案」
  节声明清单 ↔ git 变更集双向对账——越界件（改了未声明）advisory 报告、`--strict` 时 exit 1、
  plan 不可读 exit 2（fail-loud），补 check-loop 检查 8 单向交集不拦夹带的缺口；白名单逐字保留
  （workflow 四目录 / INDEX.md / confirmations.jsonl / confirmations.d/ 分片 / package-lock.json——
  kit 装户台账同名）；接线：`build.md` §1.3 自验步点名 `node .agents/scripts/check-scope.mjs
  workflow/plans/YYYY-MM-DD-<主题>.md`，随 sync-hosts 下发 5 宿主薄适配。② 移植
  `templates/_agents/scripts/lane-surface-audit.mjs`（+ 同名直测 5 断言）：L2 触达面闭集防漂移审计
  （恒 exit 0）——近窗口 L2/L3 任务反复触及却无面清单命中的目录 = 候选漏登面；适配 4 处：面清单路径
  改 kit 平铺 `.agents/lane-surfaces.txt`（主体 + 提示消息）、审计登记行落该文件头注释、面清单解析
  注释改 kit 口径（kit 无 engine/product 段协议，段标题行同为注释不参与命中）、判据提醒改指 kit 单源
  「level-criteria.mjs 的 L2_SURFACES」。两件均同名带测、不入 scripts-test-exempt；
  `engine-lock.json --update` 入账（受检面 +2 件）。

- feat(metrics)：**judgments 判定流水体系**——① `judgment-ledger.mjs`：check-loop 每次真实运行追加
  一行 per-rule 计数（ts / mode / rev / blockers / warnings / 按标签分规则计数）到
  `.agents/judgments.jsonl`（本地 gitignore——「本机机器事实不跨机共享」口径，同 verifications.jsonl）；
  **fail-open**：落账失败只打 stderr，不改门禁裁决（观测面不得挡住裁决面）。② `agg-judgments.mjs`：
  月度 × 规则聚合查询。③ `templates/_agents/mechanism-registry.md`：机制使用量台账单源（装户自持，
  sync 永不覆盖）——每个门禁机制登记「触发统计口径 + 退役阈值 + 状态」，**一进一出**（新增机制须点名
  它替代/合并的既有机制），月度对账由「人工 grep check-loop 输出」改查判定流水；达到阈值的行改
  「待退役」并填处置期限，退役当日删机制代码 + 测试 + 表更新同一提交完成（不留死代码）；
  check-loop 检查 22 对本表做 WARN 级格式校验（列数 / 状态枚举 / 待退役处置期限，纯 WARN 永不 hard，
  对账纪律靠表头「维护纪律」人工执行）。语义：给「advisory→hard 升格」与「机制退役」两条治理动作
  提供 per-rule 判定数据底座。

- feat(verify)：**绿凭证入库与生效规则视图**——① `gen-verify-evidence.mjs`：verifications.jsonl 是
  gitignore 的本地台账（跨机不可见），本生成器把全绿行按 headShort 去重渲染进仓内
  `workflow/verify-evidence.md`——绿凭证从易失升为随库持久、跨机可对质；**追加保全**（仓内既有行不因
  本地台账缺失被抹掉，同 headShort 取更新 ts——「重跑刷新凭证」语义）；一行 = 「验证时刻的工作树过
  verify 全量门禁全绿（门数/套件计数）」，归因提醒：短 SHA 只是**基线提交**，不等于被测内容，关单应
  「先提交、后跑门」；非证据链签名（本地台账可伪造的诚实边界不变），入库摘要只是把「曾有凭证」从
  易失升为难失。② `gen-effective-policy.mjs`：把 policy.mjs 单源渲染为人可读的
  `workflow/effective-policy.md`（当前生效 policyVersion、逐锚生效日 / 消费检查项 / hard·advisory·
  未到期分级现状，锚时 > 今日标注「待升级」）——「存量豁免 vs 受管」的合成语义此前只活在 check-loop
  源码里，规则空间永久二分且不可读；判定单源仍是 policy.mjs POLICIES / loadKitPolicy（本脚本只读
  只渲染，不写日期、不读第二份配置）。③ 接线：verify 全绿尾部自动重生成 verify-evidence.md
  （绿事实与仓内摘要同刻生成，消除「本地台账已绿、committed 摘要滞后」双真相分叉；生成失败响亮告警
  不推翻绿裁决）；`effective-policy --check` 进 verify 门序——policy 变更后必须重生成并随同提交。

- feat(verify)：**verify 重写为七门 GATES 编排**——`verify.mjs` 改门表驱动（序即执行序、遇红即停）：
  scripts-syntax（语法自检）→ engine-tests（npm test；当前目录无根 package.json 显式跳过且**不落
  测试绿凭证**——跳过≠通过，凭证语义 = 测试真跑绿，防假绿，提示 `--test-cmd`）→ workflows-check
  （编排脚本检查）→ rule-budget --all（常驻面预算）→ effective-policy --check（生效规则视图漂移）→
  check-loop（闭环硬门）→ ledger-invariant（确认台账不变量历史全扫）。逐门 pass/fail、fail-fast、
  尾部输出**未执行门清单**（fail-fast 后序门状态未知≠通过——「没跑」与「过了」可区分）；任一门红落
  失败行（suite=门 id）供根因分析，消费方只认 exitCode===0；绿凭证行新增 gates / headShort 字段
  （非 git 环境解析失败则省略、不伪造）；计数捕获只认编排器权威行 `[run-tests] 合计:`。本地 verify
  与装户远端门（kit-ci.yml 同一条命令）行为 100% 一致（单源口径，防两处编排漂移）。诚实边界：七门
  照搬源仓 engine cohort——product cohort（frontend/backend 门）是源仓项目私有不搬；lane-surface-ci
  门留后续批次评估；源仓 `--engine` 增量语义不移植（本表已全为引擎段，「部分绿 ≠ 全量凭证」的分野
  不存在）。`--list` 按执行序打印门 id；`--doc` 绑定（归一基准 = ROOT，与 confirm-doc / 检查 8
  三处同源）与 `--test-cmd` 夹具注入缝保留。

- feat(gate)：**policy v9–v12 与 check-loop 硬门/卫生分道（B6b-1）**——① `policy.mjs` 版本 9–12：
  构造式改 **merge 链（基线 + 显式差异）**，kit v1–v8 键史原样保留——消除「全量手抄日期键、漏抄即
  静默改语义」的脆弱点（v2 注释自警同源）；键名与源仓逐字一致。v9 = `incidentRegrSince`（检查 3x）/
  `specVerifSince`（检查 21）/ `attributionSince`（检查 24）；v10 = `convergenceSince`（检查 23
  advisory 档）；v11 = `convergenceHardSince`（检查 23 hard 档）；v12 = `reviewerSince`（检查 1
  独立复核上下文标识）。kit 无源仓 check14HardSince / verifyHardSince——该两处消费段 kit 恒 advisory，
  未落地不引入。锚日期 = kit 落地日口径：发布当日 = advisory 档锚，发布次日 = hard 档锚（当日在途件
  不追溯，沿源仓「发布次日」先例）。缺键（v1–v8）→ 对应消费段整体跳过，存量零新增告警。② check-loop
  **分道**（机读单源 LANE_OF，判据零变化只归属运行面）：默认只跑**硬门**（关单 / pre-push 面：配对
  判低 / 复盘三件套+回路 / 3x 防复发证据 / 验收对账 / 确认留痕 / 指纹链 / 发版收口 / 收敛对账 hard
  档）；`--hygiene` 只跑**卫生段**（索引 / 宿主 / 词表 / 预算 / 委派等 WARN 面，不进关单——要看时
  另跑）；`--all` 两段都跑（= 分道前的裸跑全量）。③ init 新装 `policyVersion: 12`（全锚——新装空
  台账零回溯负担；存量装户 kit.json 属 owned、sync 不动，升级时机自选）。

- feat(gate)+feat(tpl)：**check-loop 检查 21–26 + 3x 六段与新判据（B6b-2）**——编号空间 1–20 扩为
  **1–26 + 3x**（gate-checklist 配对登记表随动；3x 编号沿源仓写法、不入按号配对面）：21 spec 验证
  落地核查（L2/L3 done spec 的「测试用例/验证计划/验证方式」节无测试文件/验证命令引用 = warning）；
  22 机制使用量台账格式校验（见上条）；23 判据级收敛对账（L2/L3 done spec「验收判据」表逐判据 × 证据
  对账——advisory 档证据无效 = warning，hard 档路径不存在 / 命令不在全量门 / 无对应全绿凭证行 =
  hard-block；人工执行 + 空证据合法）；24 incident 归因字段核查（新建件「来源 / 影响环境」必填且在
  枚举 = warning，legacy 回填件与存量豁免）；25 路由预判一致性（frontmatter「预判: kind= level=」
  在场才检，与实际落位 / 级别不符 = warning 留账；缺字段零告警——advisory 灰度，不做强制前置）；
  26 闭环漏斗「协议前」占比动作阈值（metrics 漏斗表日历相邻两月协议前占比均 >30% = warning，要求
  一轮归因；收口 = 0 的月不判、单月波动不触发）。**3x**：incident 防复发验证证据门（fixed/closed 且
  git 建档日 ≥ 锚、正文无自动化用例/回归清单引用 = hard-block）。各锚前建档件存量豁免。

- feat(gate)+feat(tpl)：**L0 退役、L1 直达与模板字段并集**——① 级别收敛三档 **L1/L2/L3**（L0 退役，
  自源仓收敛系列 1 回灌）：`workflow-enums.txt` 级别三档；L1 = 实现级改动，**一份 plan 即入口**
  （协作道不另立 intent：级别恰为 L1 的 plan 无同名 intent/incident 不拦；级别缺失 / L2/L3 落单照拦）；
  plan 配对升**全级别强制**（原 L0 协作道豁免随级别退役删除）；L1 勾触达红线 → 「红线判低」hard
  （协作道不受理 STOP 级改动，就高不就低）。② 模板字段并集：`intents/_TEMPLATE.md` 增可选字段
  「预判: kind=<require|fix|verify|review|deploy> level=<L1|L2|L3>」（定级时结构化预判、结果如实留账，
  与实际落位不符由检查 25 出 WARN；缺字段零告警——存量宽容不回填）；`incidents/_TEMPLATE.md` 增归因
  两键「来源」「影响环境」（供来源×环境交叉表机器复算，替代逐件人工判读；新建件必填、锚前存量不回填、
  未触达运行环境写 none）。③ 存量装户迁移：frontmatter `级别: L0` 改 `L1`，或行首加 `流程: legacy`
  （存量豁免通路，跳过级别/配对检查）——不改会被级别枚举校验 WARN「级别缺失」，`--batch` / `--auto`
  自治门按 suspect 拒（fail-closed）。

- feat(gate)：**台账不变量深水区（合并感知 / 补登追认 / DAG）**——`check-ledger-invariant` 深水判据自
  多 worktree 合并丢行事故后的实战实现逐字回灌，把「台账本地可写」的伪造面从事后对质级升为机器可
  检出级（能力评审审计维度扣分项）：① **合并感知删片**：分片删除的合法性对账取分片内容**各父提交
  并集**——合并解析收口删片时，分片可能只在第二父侧（单看首父会把合法收口误判成「增删同提交」）；
  「分片删除丢行」（行未并入主台账）仍 hard 拦。② **终态补登追认**：合并删片缺行、但缺失行已原样
  回 append 到终树主台账（补偿行 = 新 ts + note 引原 ts）→ 视为丢失已追认放行——历史事实不可改写，
  终态无丢失即审计实质成立。③ **补登语义身份比对**：补偿行与被删行的等价判定用语义三元组
  `{doc, stage, fingerprint}`——补偿行本就允许改 ts 加 note，逐字节比对会漏掉全部合法补偿行。
  ④ **DAG 感知与历史基线**：多父提交不按线性链假设；全历史扫描支持基线比对（基线 = HEAD 豁免过且
  loud 出账、无基线的改写拦）。主台账自身永不因归并被删。

- feat(ledger)：**三活文档月分片（B8）**——`ledger-shards.mjs`：`workflow/{regression-checklist,
  delegations,papercuts}.md` 三个 append-only 活台账按月分片 `workflow/<ledger>.d/<YYYY-MM>.md`——
  此前每次追加全量重写整文件，blob 膨胀与多 worktree 合并冲突面是「全历史」（源仓实测单文件
  14.0 MiB 级）；月边界 = 天然分片键（数据行首列日期），同月并发冲突面缩到当月、跨月并发零冲突。
  读侧 = 主台账 ∪ 全部分片（按文件名排序，月序即时间序）；写侧 = 追加进当月分片；主台账保留头部
  说明 / 维护规则 / 表头等人类阅读面，数据行迁入分片。表头签名对齐 kit 模板形态（delegations 两表
  末列「合入结论」；分片同时带节标题——check-loop 检查 18 走表头签名、wf-journal 按「## 委派结果」
  节门读行，节标题 + 表头都带则两边读侧全兼容；两表归属判据 = 原节标题，不用列数——末列可缺省、
  列数无法区分）。CLI 三态：`--check` 巡检（主台账残留数据行 / 分片可读性）/ `--split` 按月迁移
  （幂等）/ `--append` 追加。消费方（papercut-debt-sensor / wf-journal / agg-delegations 等）读侧
  自动合并，无分片时等价原读法、传感器零额外逻辑；regression-checklist 只迁「防复发验证」节
  （其余模块节是稳定参考内容，节标题限定）。

- feat(gate)+feat(kb)：**归档体系（archive-sweep + 关单即归档 + kb 归档检索）**——① `archive-sweep.mjs`：
  终态件滚动归档。归档单位 = **同名家族**（intent/spec/plan/incident 同进同退：任一成员非终态 /
  未满窗 / 被活跃引用 / 无日期，整族留守——检查 1 的结构配对是「家族双向在场」审计，单篇准入产生
  数十处配对断裂的返工实证）；终态时间**三级锚** = 确认台账终态行 ts（精确）→ 内容 last-touch
  （回退）→ 文件名日期（回退级曾用 git last-touch，被批量 frontmatter 迁移系统性污染——数百文件
  last-touch 集体刷成当日、21 天窗口恒不满足、活跃目录只进不出；修法 = 改「最后一次**正文**变更」，
  frontmatter-only 提交不刷新——其不改变文档实质内容与归档安全性）；落点
  `workflow/archive/<家族最晚终态月>/<类型>/`（git mv；缺省 dry-run，`--window 21 --execute` 执行）。
  ② **关单即归档**（confirm-doc 接线）：确认终态时自动归档本次确认涉及的家族——archive-sweep 是
  手工工具、无人跑则活跃目录只进不出；判定单源 = archive-sweep.analyze（禁第二套口径）；只归档本次
  确认涉及的家族，不越权清理历史积压（积压仍走手工批次 + 21 天窗口）。③ **kb 归档检索**：kb-search
  语料面扩 `workflow/archive/<批次>/<type>/`——归档件退出活跃目录但不退出检索面（防复发不丢历史）。
  归档不产生配对断裂：INDEX / check-loop 配对门 / kb 活跃语料只扫四目录直下；check-ledger-invariant
  已归档感知（台账行原路径未命中再探 archive）。

- feat(gate)：**冲突自愈（B9）**——`resolve-merge-conflicts.mjs`：台账与派生生成物合并冲突一键自愈器。
  第一道防线是 `.gitattributes` 的 `merge=jsonl-union`（台账类冲突确定性并集，两侧行全保留）；driver /
  gitattributes 行漏配退化成文本冲突、或 INDEX.md 这类生成物仍要人工解时，本工具一键消化**派生面**，
  把人留在业务冲突上：扫描 unmerged（UU/AA/DD/AU/UA 等）文件——`workflow/INDEX.md` 冲突 →
  `checkout --ours` 后调 gen-workflow-index 全量重生成并 `git add`；`.agents/*.jsonl` 台账冲突
  （主台账 + `confirmations.d/` 分片同判据面——分片是确认行默认写入口径）且双方内容都在（UU/AA）→
  并集合并后 `git add`；删除 / 改删型（DD/AU/UD/UA/DU）**不做任何写入**（自动并集会复活被删文件或
  凭空建空文件），仅提示人工裁决。恒 exit 0 出处理清单。

- feat(loop)：**papercut 债务回路（B10a）**——把 `workflow/papercuts.md` 未升级存量债驱动到 0 的
  传感器-控制器-执行器闭环。① `templates/_agents/loop/papercut-debt/DESIGN.md`：回路**设计单一
  真相源**（改口径先改本文件，脚本只实现）——设定点 = 未消债 → 0；已消债判定 = `✅` 真修完 **或**
  `⏸ 暂缓（日期）：理由`（人读过、判失效）——「标个符号清零」的路堵死；环境约束类 `[env]` 条目
  不进债池单列（环境自愈不由回路轮询发现）；首轮「⏸ 不消债 → 完成判据恒不达成 → 回路空转」的设计
  教训单源保留。② `papercut-debt-sensor.mjs` 存量债传感器：只读、零子进程（托管 Node 环境 spawnSync
  对任意 exe 可返 EBUSY，依赖 git 历史的传感器在该环境不可用）；分片感知（读侧走 ledger-shards
  自动合并，无分片时等价原读法）。③ `papercut-debt-controller.mjs` 回路控制器：把测量变成「本轮修
  哪一条」——排序键 = 命中次数降序 → 日期降序 → 原行序（确定性、无随机、无 LLM 判断）；scope gate =
  拟修明确指向代码面 / 数据库的条目本轮跳过照列，供人工决定单独授权；单轮只取 1 条（独立复核有
  成本，一次给 3 条审不动）。④ `skills/papercut-fix/`：执行器技能（单条目标、禁顺手修相邻条目、
  文档面 scope、禁凭台账描述臆测现状——先读权威文件验证症状、禁 `node -e` 脚本批量替换）。
  kit 不为回路接线 CI / 定时：执行器为对话内手动触发（沿源仓口径）。

- docs(readme)：**存量装户升级指引**——升级到本版的三项一次性动作（README「存量装户迁移指引」汇总）：
  ① `.gitattributes` 手动补 `.agents/*.jsonl merge=jsonl-union`（owned，sync 永不覆盖；漏配退化为
  文本冲突，不静默丢数据）；② 存量 `级别: L0` 改 `L1` 或标 `流程: legacy`（L0 退役）；③ `kit.json`
  的 `policyVersion` 升 12，并跑一次 `node .agents/scripts/gen-effective-policy.mjs` 把生成的
  `workflow/effective-policy.md` 随同提交——kit.json 属 owned、sync 不动 policyVersion，升级时机
  自选；不跑生成器则 verify 的生效规则视图门对缺文件判红一次（新装由 init 首跑种子，存量补跑即绿）。
  v12 全锚生效日 = 发布当日（advisory 档三锚）/ 发布次日（hard 档三锚），锚前存量不追溯。

- **不回灌清单（摘要）**——下列源仓件本批评估后**不回灌**，一句理由（完整版见 ARCHITECTURE §8
  「不回灌清单」）：`check-query-contract` / `check-schema-residue` / `check-audit-fields` /
  `check-delete-guard` / `check-notify-guard` / `check-local-gates`——dotnet 工具链专用，kit 由
  doctor + add-gate 生态等价覆盖；`ci-push-before`——Azure DevOps 编排，kit 远端门形态 = kit-ci.yml +
  「同入口命令 + 服务端分支策略」等价接入；`gen-narrative-claims` + `check-narrative-incremental`——
  实践手册承重面，kit 无消费方，等价覆盖 = 检查 11/16 + index-incremental 门 + effective-policy 门；
  `skills/shipyard-workflow-closeout`——源仓品牌关单序列，kit 由 gate-checklist 命令承担；
  CodeBuddy 宿主适配——kit 七宿主清单不含该宿主；`check-loop-sections` 目录化拆分——kit 保持
  单体 check-loop.mjs + 模块化检查件形态（分道由 LANE_OF 承担）；`engine.json`——kit 的 kit.json 等价。

  **测试**：npm test 76 套件 0 失败（回灌起点 65 套件；新增判定器均有同名直测，或在
  scripts-test-exempt 登记并注明间接覆盖）；eslint 0 error；`npm pack --dry-run` 成功（prepack 跑
  check-pack-eol）；`sync-hosts --diff --strict` 零漂移；fresh init 端到端：doctor 全绿、
  `verify --list` 七门、`check-loop --all` 空台账跑通、`level.all = L1 L2 L3`、新装
  `policyVersion: 12`；`check-engine-integrity --update` 终次重锚（受检面 82 件，硬拦单位总数
  213 → 218 无收缩）后本地层全绿。

## 1.7.17

- feat(ledger)：**确认行分片升为默认写入口径**（2026-10-13 ledger-shard-default，协议对齐 Shipyard.Material
  参考实现——两仓 10 月初分叉后首次协议级回灌）。此前分片是 `--shard` 的 opt-in 并发开关；本版翻转默认：
  `confirm-doc` 落账**默认**写 `.agents/confirmations.d/<doc基名>.jsonl`，`--no-shard` / 环境变量
  `CONFIRM_SHARDED=0` 显式回退主台账 `.agents/confirmations.jsonl`。理由：多 worktree / 多人并行的
  「同文件 append 互相覆盖」不是小概率特例而是协作常态，防呆位应在默认侧——漏配旗标的代价是静默丢确认行。

  **① 顺带修复存量缺陷（CLI `--shard` 此前从未生效）**：三个 `appendLedger` 调用点把 `shard: shardWrite`
  写进了 **entry 数据对象**，而 `appendLedger(root, entry, { shard })` 的开关契约在第三参 options——
  旗标被当作数据字段混入台账行（多出一个无语义的 `shard` 键），分片开关恒为 false。本版把三处调用
  改为第三参传 `{ shard: shardWrite }`（测试 S42① 原本就过不了，实证缺陷存在）。

  **② doc 链前提的降级语义（存量装户零变化）**：分片与主台账分属不同文件，只有 doc 链
  （`policy.ledgerDocChainSince`，policyVersion 8）能跨来源接续。显式 `--shard` 缺锚仍**参数期直接拒**
  （原口径不变）；**默认分片**缺锚则自动回退主台账并在 stderr 出 ℹ️ 升级指引（升 `.agents/kit.json`
  的 `policyVersion: 8`）——存量装户（v1-v7）升级模板后行为逐字不变，不会被新默认打断。

  **③ `init` 新装 `policyVersion: 2 → 8`**：分片默认的前提是 doc 链激活，新装不给锚则旗舰默认永不生效。
  v8 含全量锚（verify/scope/doc-chain），新装空台账零回溯负担；存量装户 `kit.json` 属 owned、`sync`
  不动，按 ② 的降级语义自行选择升级时机。

  **④ union 驱动覆盖分片目录**：`.gitattributes` 模板补 `.agents/confirmations.d/*.jsonl
  merge=jsonl-union`——`.agents/*.jsonl` 的 gitattributes glob 不跨目录层级，漏配则并行分支合并分片
  仍走文本冲突（人工「整取一侧」= 静默丢确认行）。存量装户迁移指引同步更新（该文件 owned，须手动补行）。

  **⑤ `--staged` 不变量前置扩到分片**：分片成为默认后，暂存面常态含 `confirmations.d/*.jsonl`——
  `pre-commit` 触发 grep 扩到分片路径，`check-ledger-invariant --staged` 补分片三态判据：纯追加放行 /
  前缀破坏拦（报文点名「分片重写」）/ 删除仅当每行都已并入**暂存主台账**才认领 compact 归并
  （否则「分片删除丢行」拦），与历史全扫的分片判据同构，把「顺手重写分片」的检出从事后 CI 提前到提交时刻。

  **测试**：`confirm-doc.test.mjs` 新增 S42 六态（默认写分片 / `--no-shard` / `CONFIRM_SHARDED=0` /
  存量回退+指引 / 显式 `--shard` 拒 / 双旗标互斥）；`check-ledger-invariant.test.mjs` 新增 S13-S17
  五态（新分片首入库 / 纯追加 / 重写拦 / compact 归并删放行 / 丢行删拦）；`fresh-init.test.mjs`
  断言新装 `policyVersion: 8`。

## 1.7.16

- feat(cli)+refactor(criteria)：**包从「引擎骨架」升级为「引擎执行器」——`route` 手动路由 + `run` 自动流水线**
  （2026-10-13 flow-kit-route）。此前包 CLI 只有 init / sync / sync-hosts / add-host / add-gate / doctor /
  validate 七条**生命周期**命令：装完之后引擎只能由宿主 AI 顺着 md 自己走，包没有执行面。
  本版给包补上执行面，但**执行代码一步都不搬家**（决策：executor-home = shell）。

  **① 级别判据的机器单源**——新增 `templates/_agents/scripts/level-criteria.mjs`。
  背景：风险级别 L0-L3 此前只以**散文**形态存在于 `.agents/commands/new-task.md`「级别判断」节
  （L2 四类触达面 / L3 结构面 / 判低负例 / 自查句），后果有二：定级是纯自由心证，AI 每次判级都可能不同，
  门禁无从校验「判低」是否守约；想让 CLI 接管路由，就没有可执行的判据可调，只能复读 md。
  本文件把**能被机器判定的部分**代码化成单源，`new-task.md` §4 改为引用它——md 不再承载判据散文
  （删的是散文，留的是流程表与「本表只承载流程」的纪律）。
  **诚实边界（写在文件头，也写在 CLI 输出里）**：机器只兜两件事——**就高不就低**（混档取高）与**路径下限**；
  「一处定义、多处消费」是**语义**性质，机器判不了，对该面只输出判据清单与自查句、不产出断言。
  漏判由 lane-surface 触达面门在提交面兜底。

  **② 路径下限清单** `.agents/level-hints.txt`（**owned**，`sync` 永不覆盖，登记进 `profiles.mjs` 的 `isOwned()`）。
  格式每行 `L2 <ERE>` / `L3 <ERE>`，ERE 为 grep -E 兼容正则、匹配仓库相对路径。
  **默认空**（刻意）：内容是项目私有的，按自己的代码布局登记——照抄别人的清单等于没登记。
  缺文件或清单为空 → 纯语义定级，判据面全程静默不阻断。
  与 `lane-surfaces.txt` 的分工写进文件头：那是**提交面**的触达判据，本清单是**意图面**的档位提示，两者不同档。
  **非法档位 / 正则语法错一律 fail-loud 抛 `LEVEL_HINTS_INVALID`**——写错配置比没配置危险：没配置会提示补，
  写错会误判。报错带清单路径与行号。

  **③ `flow-kit route`（手动路由的机器面）**——新增 `src/executor.mjs`。给出建议档位 + 判据清单 + 泳道 +
  `kind` 对应的入口 md 路径（`require→plan.md` / `fix→maintain.md` / `verify→test.md` /
  `review→review.md` / `deploy→deploy.md`），支持 `--json` 机读面。
  **判据单源在装户面**（随模板下发、随 sync 升级），包 CLI 解析 `--dir` 后**动态 import**，不在包内拷一份——
  避免包/装户双源漂移。缺单源时 fail-loud 指向 `sync`。
  泳道取法**沿装户 `stage-gates.mjs` 的 `laneOfDoc` 单源**，薄壳不按档位写死 low/high；单源缺失或返回非法值时
  fail-soft 回落并在输出里标明 `laneSource: fallback`（不假装取到单源）。
  枚举值域优先读装户 `workflow-enums.txt`，缺失回退判据单源自带表且不阻断（定级面不该因词表缺失整个挂掉）。

  **④ `flow-kit run`（自动流水线薄壳）**——转发装户 `pipeline-run.mjs` 状态机的
  `start` / `next` / `status` / `watch` / `abort`，**参数与退出码原样透传**；不复制状态机逻辑（零迁移、
  不动 sync 台账、存量装户零影响）。薄壳纪律三条，测试锁死：**绝不 spawn AI 会话、永不伪造用户原话、
  永不带 `--no-verify`**。参数纪律两处修正：`--dir` 是包面寻址参数，**被薄壳消费、不透传**给状态机
  （此前会漏传，装户状态机收到不认识的 `--dir`）；用法校验**先于**脚本存在性校验（反过来会拿「没装」
  盖住「怎么用」）。`--k=v` 与 `--k v` 两种写法等价（此前 `--dir=<path>` 被静默忽略）。

  **⑤ 过期指针清扫（改写 §级别判断 的连带面）**——该节改为引用单源后，指向它「去看判据」的地方全部失效。
  一处不扫，日后 AI 顺着失效指针读到的就是**只有流程、没有判据**的空壳章节。连带修四处：
  `design.md` 与 `fill-intent.mjs` 两处判据指针、`pipeline-run.mjs` 的 triage 工单（「读 new-task.md §级别判断
  判级闭集」——这条正驱动着自动流水线的语义面，改漏即等于 route 的语义判断失据）、
  `check-lane-surface.mjs` 的门禁失败报文与 `lane-surfaces.txt` 头注释。
  测试把扫描面扩到**整个装户面**（`.mjs`/`.txt`/`.md`/`.json`，排除测试自身）——首轮只扫 `commands/*.md`
  就漏掉了后三处，说明面窄了就是假护栏。

  **新增测试 2 套件 131 场景**：`level-criteria.test.mjs`（69）、`executor.test.mjs`（63）。
  后者用**哨兵 stub** 测「薄壳真的在问装户」：把装户 `laneOfDoc` 写成「L2 返回 low」（与常规口径相反），
  薄壳若自带实现就会露馅。套件同时以子进程隔离 `process.exit`，才能测退出码与 stdout。
  `level-criteria.test.mjs` 另含**单源纪律回归**：`new-task.md` 不得再出现触达面/负例/自查句散文、
  装户面不得再出现指向 §级别判断 的过期指针、模板 `level-hints.txt` 须默认无有效条目——
  防止判据日后又长回 md 里。

  **宿主薄适配同步**：`design.md` / `new-task.md` 两份权威源改动 → 10 份薄适配正文漂移，
  经 `sync-hosts --apply` 单向同步归零（薄适配 frontmatter 不动）。

  **文档收口**：README 新增「执行面：route + run」段（含单源归属表与诚实边界），「当前能力」补第四点；
  ARCHITECTURE §5 双入口执行器补包 CLI 转发面与判据单源说明。

- feat(gate)+chore(ci)：**门禁本体完整性门从死代码接成真机器门 + 受检面补两项**（2026-10-13 engine-integrity-live）。
  背景（复核结论）：`check-engine-integrity.mjs` 是本仓唯一能防「改弱门禁本体」的检查，但它**从未真正作为门跑过**——
  ① 基线 `templates/_agents/engine-lock.json` 从未入库（`git log --all` 无该路径），本地基线层与跨提交锚层双层静默跳过，
  只剩「硬拦单位数不收缩」计数；② `ci.yml` / `.githooks` / `npm test` 三处都没有调用点（git grep 只命中
  `render.mjs` 注释与它自己的单测）。即文件头宣称的「改内容须有活跃 L2/L3 入口点名 + 确认台账留痕」两层判据实际不生效。
  本版两处收口：
  ① **基线入库 + 接线**：`--update` 生成 60 件基线（逐项 sha256 + 硬拦单位数，0 CR、无 BOM）；
     `.github/workflows/ci.yml` 新增独立 job `engine-integrity`，跑 `--against-ref HEAD~1`（`fetch-depth: 2`），
     把「盘面↔入库基线」与「跨提交锚」两层判据接成机器门。锚层参照物读自 git 对象库，兜「同时改弱门禁并 `--update`
     重写基线」这一自洽形态（本地层对该操作自洽，CI 会全绿）。诚实边界：HEAD~1 在多提交 PR 上不等于 merge-base；
     `--no-verify` / 删掉本脚本 / 不启用本 job 仍可绕过——沿文件头本地信任边界口径。
  ② **受检面补两项**（`gateFiles()`）：`.github/workflows/*.yml`（本门的调用点就在编排里，不纳入等于门可被无声关闭）
     与 `templates/_agents/level-hints.txt`（定级路径下限输入面，语法错 fail-loud 抛 `LEVEL_HINTS_INVALID` 改判级结论，
     此前漏在防改锚之外）。
  实测：两处新面各做一次负例探针（各改一个字节 → `[控制面改动无入口]` hard-block exit 1），按字节复原后回到
  `盘面与基线一致`；完整性门单测 28/28，lint 与 pack / fresh-init / jscpd-drift 三套件全绿。
  **诚实记录**：本批按用户明令直提，**未**立 §改动面 点名受检件的 L2 入口文档——故从下一批起，触及受检面
  （含本门脚本、ci.yml、engine-lock.json、level-hints.txt）若无活跃 L2/L3 入口点名，会被本门以
  `控制面改动无入口` 拦下。这是设计代价，不是缺陷。

- fix(executor)+feat(gate)+refactor(gate)：**执行器三处缺陷收口 + 移除门禁的「立 L2 入口」退路**（2026-10-13）。
  承接上一条记录里我复核出的 4/5/6 三项缺陷，外加一条结构性发现：

  **④ level-hints 写错只在跑 route 时才炸，无体检面。** 非法档位/ERE 此前只在 `flow-kit route` 时抛
  `LEVEL_HINTS_INVALID`，而 route 是可选调用 → 写错的清单能静默存活很久。故 `level-criteria.mjs` 新增
  `--check` 入口（判据单源仍只有 `parseLevelHints` 一份），doctor 新增导出 `checkLevelHints()` 与 §6.10 消费
  它（spawn 装户单源跑 `--check`，doctor 不复刻解析器）；三态：旧装户无单源 skipped / 合法（含默认空）ok /
  非法 FAIL。doctor.test 新增 4 场景直测，并登记进 gate-checklist 登记表（§6.10 doctor 独有——
  提交面判低不在 check-loop 20 项内）。

  **⑤ 判低只在提交面 advisory、且两份清单无机器对账。** `check-lane-surface.mjs` 接入 level-hints：命中档位与
  触达面隐含的 L2 取高得「应然档」，要求活跃入口**级别 ≥ 应然档**（不再是「有个 high 入口就行」），suspect
  （级别缺失/非法/分歧）一律不够格；hints 语法错 fail-closed；hints 命中但触达面清单空 → advisory 点名
  「意图面登记了、提交面无兜底」。新增 6 条 S-hints 场景回归锁。

  **⑥ `flow-kit route` 四种「缺失」策略混用、降级只对一个消费方可见。** 收成单一 `degradations[]` 出口
  （文本面「⚠️ 降级运行」+ `--json` 的 `degraded`/`degradations`）：`enums-fallback` / `lane-source-fallback` /
  `level-hints-empty` / `under-hint-proposed`。判据单源缺失仍 fail-loud（配置面坏了不定级）；软回落一律登记、
  不阻断定级。executor.test 新增 7 条降级断言，并把夹具补齐枚举单源（否则 `enums-fallback` 恒真、断言成假护栏）。

  **⑦（结构性发现 → 已按决策清理）「立 L2 入口」这条退路在本仓不可达。** check-engine-integrity 原有两档
  豁免——本地层「正文提及即认」、锚层「活跃 L2/L3 入口在 §改动面 点名」——参照物是 `<root>/workflow/
  {intents,incidents}`。但 1.7.15「卸掉同仓双身份」后**包源仓已无该目录**，门消息让维护者去「立 L2 入口」而立
  不了：不可达的能力等于误导。故整体移除（实现 + T4b/T4c/T4d + 锚层严格档 T7e，共删约 65 行）：本仓只认
  `--update` 一条显式演进路径，语义更少、更可核对；消息标签随之由 `控制面改动无入口` 改为
  `控制面改动未入基线`，修法只留 `--update` + CHANGELOG 同批。新增 T4e/T7c 两条断言**锁死**「即便有人手工
  造出入口文档点名该件也不放行」——否则一个 mkdir 就能把门重新打开。
  **诚实代价**：跨提交锚只比对**硬拦单位数**、不比 sha，故「改写某检查语义但保住 exit 1 计数 + --update」
  这一形态两层都绿。补法是让锚层也比对 sha，代价是每次合法演进都需一份显式凭据（改判据面，本次未决）。

  验证：npm test 全量 61 套件 / 0 失败；完整性门单测 27/27；四个改动套件（executor 70 / lane-surface 27 /
  doctor 54 / level-criteria 69）全绿；eslint 0 errors。

- fix(executor)：**执行器评审发现的 2 Major + 4 项一并收口**（2026-10-13 executor-review）。
  以 v1.7.15 为固定点对执行面做双轴评审（Standards + Spec，子代理并行），下列问题**均由实跑复现**，
  非推断；每条都补了回归锁。

  **① Major：随包下发的示例格式会把新机制静默关掉。** `parseLevelHints` 取整行剩余部分作 ERE
  （`(\S.*)$`），而 `level-hints.txt` 示例教用户「取消注释」且示例行自带行内 `# 注释`——注释被编进
  正则后，若 ERE 含 `$` 锚点则该条**永不命中**且不报任何错：`flow-kit route` 的路径下限与 pre-commit
  的提交面兜底同时静默失效，而 `--check` 还报「N 条有效」。两侧都改：parser 对「空白后的未转义 #」
  fail-loud（`\#` 与 `^src/#old/` 放行，路径里的 # 仍可匹配）；模板示例注释全部移到独立行并写明
  「ERE 与注释必须分两行」，顺带补上文件末尾换行。

  **② Major：L0 档 hints 让纯文档提交被硬拦。** `requiredLevel = maxLevel(触达面?'L2':'', hintLevel)`，
  而 parser 原接受 `L0`——写 `L0 ^docs/` 会让 `docs/readme.md` 这类提交触发 `[触达面判低]` BLOCK，
  修法还让人「升级至 L0 及以上」（L0 即最低档）。本清单语义是「一碰就**至少**是 L2/L3」的下限，
  L0/L1 不构成任何门槛，登记了只会让门对无关改动出手。故只收 L2/L3，低档按写错配置 fail-loud
  并在报文里说明理由。

  **③ 门禁复刻了判据单源的匹配逻辑（双源漂移，硬规则违反）。** `check-lane-surface.mjs` 手写了一遍
  「路径归一化 + 多条命中取高档」，与 `level-criteria.mjs` 的 `hintLevelFor` 同形但独立演进；同一 commit
  的 doctor 段还写着「不复刻解析器（复刻＝判据双源漂移）」。改为 import 复用 `hintLevelFor`，
  死字段 `missing` 一并删除（「缺配置」与「空清单」两态在门侧无区别，route 侧则登记为不同 degradation）。

  **④ route 文本面把同一事实打两遍。** `routeAdvice` 原兼报「hints 未配置」与「建议档低于下限」两条
  **状态**信息，而降级块（`degradations`）讲的是同一件事。口径收为**判据归 routeAdvice、状态归降级块**，
  单一出口；降级块补齐被移出的可读文案。

  **⑤ 泳道回落文案掩盖真实故障。** `catch {}` 吞掉原因，「装户脚本存在但 import 失败」被诊断成「未安装」，
  排障方向直接被带偏。`laneOfDoc` 现返回 `reason`，区分「文件不存在 / 存在但 import 失败（带真实错误）
  / 未导出可用 laneOfDoc」三种。

  **⑥ doctor 把体检脚本跑不起来误报成「配置有误」。** `checkLevelHints` 区分 `r.error`（无法执行体检脚本）
  与 `status===null`（异常终止），不再输出「配置有误 + 空白 detail」。

  **⑦ CLI 边界丢弃错误码（Informational，顺手收）。** `init`/`validate`/`route` 三处 catch 只打
  `e?.message`，把 `e.code`（如 `LEVEL_HINTS_INVALID`）扔掉；新增 `errText()` 统一输出 `[CODE] message`。

  验证：npm test 全量 61 套件 / 0 失败；level-criteria 76/0（新增 6 条 parser 回归锁）、
  check-lane-surface 29/0（新增 L0 fail-closed 与反斜杠归一两条）、executor 70/0、doctor 54/0；
  两条 Major 均用评审时的原始复现脚本实跑确认「静默失效 → fail-loud」「假阳性硬拦 → 配置层拦下」；
  eslint 0 errors。

  **未做（留待单独决策）**：判据散文仍存活于 `design.md` 与 `fill-intent.mjs`（后者把 L2 列成五项，
  单源是四项），而单源纪律的回归测试只锁 `new-task.md` 里 3 个字面串——换个措辞就能长回来。
  修它要删 md 正文并跑 `sync-hosts --apply` 同步 5 份宿主薄适配，属跨文件内容决策，未塞进本批。

- docs(gate)+fix(criteria)：**勘误上一条 + 判据散文清扫，单源纪律护栏从 3 个字面串扩到判级面**（2026-10-13）。
  **勘误（B6）**：上一条末尾的「未做」记录中，那句「无活跃 L2/L3 入口点名会被本门以 `控制面改动无入口`
  拦下」**已随入口退路移除而失效**——该标签与那条退路都不再存在（见同节 ⑦）。本条为勘误，
  原记录按历史如实保留不回改。

  **判据散文清扫（补做上一条声明的「未做」）**：`design.md` 的级别判断节、`fill-intent.mjs` 的触达红线
  勾选项、`new-task.md` 的泳道表 L3 行，各存了一份判据闭集的复述——其中 `fill-intent.mjs` 把 L2 列成
  **五**项而单源是四项（判低即错判的原料）。三处一律改为**只留流程映射 + 指向单源**
  （`L2_SURFACES` / `L3_SURFACES`），逐条判据只在 `level-criteria.mjs` 一处。
  经 `sync-hosts --apply` 同步 5 份宿主薄适配（76 对正文对齐、0 漂移）。

  **护栏加宽**：原单源纪律回归只断言 `new-task.md` 里 3 个字面串——换个措辞就能在别处重新长回来，
  这正是「换措辞即复发」的成因。改为按**单源词条**扫判级面（命令 md + 起草工具脚本），词条只允许出现在
  单源与其测试中。**加宽后当场抓出第三个漏网文件**（`new-task.md` 的泳道表 L3 行仍带结构面词条）——
  即上一批我以为已清干净的散文，实际还有残留；这也是「首轮只扫一面就是假护栏」的又一次实证。

  验证：level-criteria 79/0（含新增 4 条判级面扫描断言）；sync-hosts 同步后 0 漂移。

- docs(engine)：**ARCHITECTURE 四处「文档说谎」按事实重写**（2026-10-13）。
  §1「引擎 **~23k 行**」实测 **11,588 行**（src 2,280 + templates/_agents/scripts 9,308，不含测试）——
  **差了近一倍**；§4「20 项检查，**237 断言**」断言数为演进派生量；§4「ci.yml：**五道机器门** +
  **shipped 装户视角** + **CI 红回溯点名**」与实际编排不符（无 shipped 步骤、无红回溯点名）；§5
  「状态机六阶段（**882 行**）」实测 830 行。
  **改法不是把数字换成新值**——那只是推迟下一次漂移（本文件 §1 早就批过「硬编码必漂移」，自己却硬编码）。
  改为**写口径 + 指向权威源**：行数标明口径并注明「不是判据」；断言数指向 `check-loop.mjs` 头部清单；
  CI 段按实际 job 逐个点名（含 `jscpd-drift` 为**手动触发的 advisory、不在 push/PR 路径**这一事实）；
  行数从状态机描述里删掉。保留「20 项检查」——它是 check id 空间（1-20），由 gate-checklist 消费，
  不是随手变的派生量。
  全文复查：`五道机器门 / shipped / 882 / 237 断言 / ~23k` 在 ARCHITECTURE 与 README 中已清零
  （CHANGELOG 内的历史叙述按历史如实保留）。已确认无任何测试读 ARCHITECTURE.md，不影响套件。

- fix(gate)+docs(engine)：**B3 —— `flow-kit route` 从「可绕旁路」升为流程强制，并写下它的天花板**（2026-10-13）。
  复核发现：装户面唯一提及 route 的地方只是 `new-task.md` §4 的一行 bash 提示，**无任何必跑语义**，
  而宿主 AI 可以全程不跑它——判级仍是纯自由心证，闭环零反馈、零遥测。
  **改法（流程层，因为这是当时唯一有把握的一手事实）**：`new-task.md` §2 升出「第 0 步先取机器面下界」
  必跑块——必须带 `--files <预计改动面>`（不给文件就拿不到路径下限，机器面只能按 L1 起步并在降级栏
  点名，等于白跑）；确实跳过必须写明理由；并点名兜底门 `check-lane-surface`。经 `sync-hosts --apply`
  同步 5 份宿主薄适配。新增 5 条回归锁（必跑标记 / 不给 --files 拿不到下限 / 跳过须写理由 /
  点名兜底门 / 诚实边界声明），防止日后被改回「一行可选提示」。
  **诚实边界（同时写进 ARCHITECTURE §5）**：机器**无法发现它没被调用**——定级发生在改动面确定之前，
  盘面没有可比对的记录面，因此「跑没跑 route」不存在一手事实（判据原则：只用一手事实）。故本次只把
  **接线强度**提到「流程强制 + 提交面兜底」，**路径下限在提交面是硬约束、在定级时刻仍只是流程纪律**。
  要把它变成机器可判，须先有改动面（让起草期先产出改动面清单，或让 route 落一份可对账的判级记录）
  ——那是改判据面的产品决策，**未决**，不在本批范围。

- fix(cli)+fix(gate)+chore(ci)：**B4 跨宿主漂移接成机器门 + B5 路由映射归装户单源**（2026-10-13）。
  **B4**：跨宿主正文漂移此前只剩人工跑一次 `sync-hosts --diff`，CI 里**无任何调用点**——而改权威源要同步
  N 份薄适配，人工 grep 易漏（本次评审前实仓就带着 10 份漂移，靠一次 `--apply` 归零）。现给
  `sync-hosts` 加 `--strict`：`ci.yml` 的 `engine-integrity` job 增一步 `sync-hosts --diff --strict`。
  默认 `--diff` 仍恒 exit 0（人工跑不因漂移失败，报告器语义不变）。
  **口径**：strict 只判「跑一次 `--apply` 就能归零」的两项（正文漂移 + 权威源缺失）；**孤儿薄适配不判红**
  ——`--apply` 按设计不删它（可能是宿主特化/历史残留），算红就是一条机器无法自愈的假红，按本仓
  「假阳性即噪声」纪律不能设成门（仍照常报告并给出处置提示）。新增 6 条回归锁（含「默认 --diff 恒 0」）。

  **B5**：`STAGE_ENTRY` 与 kind 闭集此前**硬编码在包内**，而权威阶段表在装户 `new-task.md`——装户改入口
  文件名而不动包，`route` 就会把 AI 指向一个不存在的 md（双源漂移）。现把权威表落到 `new-task.md` §3 的
  一行机器可读注释 `<!-- route-kinds: require=plan.md | fix=maintain.md | … -->`，包 CLI 读它得出
  kind→入口与 kind 值域；读不到才回落包内默认表并登记 `route-table-fallback` 降级（老版本装户无该行，
  不静默假装取到单源）。JSON 面新增 `routeTableSource` 供消费方分辨。包内默认表降级为纯兜底。
  新增 5 条回归锁，其中一条直接锁「装户改入口名 → 包必须跟随」。

  **B5 收尾（同批自纠）**：B5 说「包内不再自带一份映射」，但 `flow-kit --help` 的 route 选项行仍是
  手写的 `require|fix|verify|review|deploy`——同一批漏掉的第二份。现把 `route-kinds` 解析器抽成
  `executor.mjs` 的 `parseRouteTable` 单函数（装户 `loadRouteTable` 与包源 help 共用），新增导出
  `routeKindList(pkgRoot)` 读包源权威 md 派生值域，help 改为插值 `${ROUTE_KIND_LIST}`（同 `GATE_LIST`
  纪律：列表一律从权威面派生）。新增回归锁「help route kind 列表等于 new-task.md route-kinds 单源」，
  并用负例探针实测（临时把包源 kind 改成 `require|ship` → help 立刻跟随，复原后一致）。

  验证：npm test 全量 SUITES 61 / FAILED 0；executor 75/0、sync-hosts 43/0；eslint 0 error；
  实仓 `sync-hosts --diff --strict` exit 0；CI YAML 解析通过。

## 1.7.15

- chore(ci)：**恢复 npm 发布管线并补发**（2026-10-12）——Release 工作流（`.github/workflows/release.yml`）在 v1.7.1「装户端内容清理」时随 `.github/` 一并删除后未重建。此后 v1.7.1~v1.7.14 的 tag 正常推送到 GitHub，但无任何 workflow 监听，**发布静默失效约 14 个版本**——npm `latest` 停滞在 1.7.0，git 与 npm 双源脱节。本版恢复该工作流（与删除前逐字一致：`push: tags v*` → tag 与 package.json 版本一致性 fail-fast → `npm test` → `npm publish --provenance`），因工作区有并发在途改动，release.yml 单独先行提交（889c8a1），本提交仅随动版本号与本条目。
  **诚实边界**：npm 不允许补发历史版本号，**1.7.1~1.7.14 在 npm 上永久缺失**；本版 1.7.15 的 tarball 一次性包含 git 侧 1.7.1~1.7.14 的全部改动——CHANGELOG 各版本条目仍是那些改动的真实记录，npm 版本号与 CHANGELOG 版本号从此恢复同步。`--provenance` 需 `id-token: write`（workflow 已含）+ public 包，均满足。

- refactor(layout)：**卸掉「同一仓库同时是包源又是装户」**（2026-10-12）。包源仓只保留 `templates/_agents` + `modules/hosts`。装到别的项目（`init` / `sync` / `doctor` / `add-host` / `add-gate` 写入目标仓 `.agents/`）不变。

  **去掉的同仓兼容枝**
  - 删除 `source-sync-check`（脚本、测试、命令、五份宿主薄适配 `wf-source-sync-check.md`、编排 `source-sync-repair`）。`pipeline-closing` 去掉 `gate-sync`，静态门剩 npm test 与 doctor。
  - `templates/_githooks/pre-commit` 去掉「`templates/_agents` 与 `.agents` 同时在」才跑的双源块，以及同一条件下的 `check-ledger.mjs` 块。脚本与测试一并删除：工作树对账由 doctor §4 自己做，无其他调用方。确认台账不变量（`check-ledger-invariant.mjs`）仍在钩子里。
  - `sync-hosts` 只认包源：缺 `templates/_agents` 或 `modules/hosts` 即拒绝，不再把 `.agents` 当权威源，也不再扫项目根宿主点（`.zcode` 等）。
  - `check-engine-integrity` 只扫包源面，基线固定 `templates/_agents/engine-lock.json`。无 `templates/_agents` 的根（含 `--update`）拒绝，且不创建 `.agents/`。
  - `gate-checklist` 的 check-loop、`gen-workflow-metrics` 的枚举文件改为脚本相对路径（拷进装户 `.agents/scripts/` 后仍指向同级兄弟），不再先找 `.agents` 再回退包源。

  **装户侧仍在的产品行为**
  - doctor §6.7 仍检查装户薄适配正文漂移；包源仓（同时有 `templates/_agents` 与 `modules/hosts`）仍跳过。漂移修复改为 `flow-kit add-host <宿主> --force`。`flow-kit sync` 不更新宿主适配，`sync-hosts` 不在装户根运行。
  - `control-surfaces.txt` 仍同时列出 `templates/_agents` 与 `.agents` 前缀：一份清单随模板下发，包源仓与装户仓各命中自己的前缀。

- feat(gate)：**台账并发与授权修剪（第一至三步）**（2026-10-12 ledger-loader-p1 / ledger-merge-driver / ledger-doc-chain）。
  背景：确认台账 `confirmations.jsonl` 是「尾部追加 + 多人/多 worktree 并行」形态，但原设计与实现隐含
  **单写者顺序追加**前提。三种正常协作都会打断它，而当时唯一的修法是 `--no-verify`——门禁被自己的误拦
  逼退，治理失效。本次分三步偿还该技术债，**每步独立可验证，判据面零扩张**（20 项检查编号不变，扩容门仍 6 项）。

  **① 台账读取单源化（Step 1，纯重构）**——新增 `ledger-loader.mjs`，把此前 6 处生产代码各自
  `readFileSync`+`JSON.parse` 的复刻读法收成单源（`stage-gates` / `check-loop` ×3 / `check-metric-claims` /
  `gen-workflow-dashboard` / `gen-workflow-metrics`）。两个视图：`readLedgerLines`（原始文本行，给按行计数）
  与 `readLedgerRows`（解析后行，坏行跳过）。**刻意不去重**——去重会改 `gen-workflow-metrics` 漏斗的
  `ledgerRows` 计数口径，属口径变更，须随分片功能同批生效。刻意保留两处直读并注释锁死：检查 15 哈希链
  （需物理行号对齐 + 物理顺序）、`check-ledger-invariant`（审盘面字节而非台账语义）。新增套件 21 场景。

  **② 台账并集合并驱动（Step 2）**——新增 `git-merge-jsonl.mjs` + `.gitattributes` 的
  `.agents/*.jsonl merge=jsonl-union` + `init` 自动配 driver。合并降级为确定性**并集去重**，两侧行全保留、
  无冲突可解。此前人工解冲突的常见错法是「整取一侧」——静默丢掉另一侧的确认行，门禁事后无从发现。
  **故意不给 `.jsonl` 加 `text eol=lf`**：加 text 规则会让下次提交 git 重新规范化换行 → 台账 blob 字节变化
  → append-only 前缀不变量判为「台账重写」而硬拦自己的提交。换行归一由 driver 自身负责。
  新增套件 17 场景，含「union 不破坏哈希链」互证（去重按整行文本、行内字段不改写 → `JSON.stringify` 键序
  不变 → `ledgerChainHash` 重算不变——这条被破坏会导致台账链整片失效，已在驱动头部标「勿破坏」）。

  **③ 哈希链链域改造：物理序 → 按 doc 的逻辑序（Step 3）**——`policy.mjs` 加 v8 生效日锚
  `ledgerDocChainSince` 与两个单源函数 `ledgerDocChainActive` / `ledgerDocChainPrev`；写入侧
  `confirm-doc.appendLedger` 与校验侧 `check-loop` 检查 15 双侧改口径。台账行的天然主键是 `doc`，
  **同一 doc 内的先后有语义、doc 之间的先后没有语义**——原判据把「文件里恰好排在前面」当成了语义。
  **按行分域灰度**：锚前行（存量）维持物理链判定、缺键（v1-v7）写入与校验双侧都走旧口径 → 存量零变化、
  零新增告警；`byDoc` 对两种域的行都更新，保证跨域衔接不断链。粒度取**时刻**而非日期（沿 `scopeSince` /
  `verifyDocSince` 的教训）。防伪能力实测未削弱：就地改行 / 删中间行 / 插行三类篡改在 doc 链下一律仍被抓
  （删除某 doc 的**末行**抓不到是链式防伪的固有上限，物理链同样如此，兜底仍是历史全扫）。新增套件 20 场景。

  **存量装户迁移动作（必读）**：② 的 `.gitattributes` 规则属 **owned**（装户自持、`sync` 永不覆盖），
  故**存量装户 `sync` 后不会自动获得 `merge=jsonl-union`**——需自行在目标仓 `.gitattributes` 补一行：
  `.agents/*.jsonl merge=jsonl-union`。driver 是本机态配置、不跨机共享（漏配则退化为文本冲突，
  **不静默丢数据但要人工解**），与 `core.hooksPath` 同款性质。

  **④ 台账特许修剪通道（Step 4）**——新增 `ledger-prune.mjs` 判据单源 + `.agents/ledger-prune-manifest.json`
  凭据格式；`check-ledger-invariant` 的 `--staged` 与历史全扫两条前缀破坏路径接入，`check-loop` 检查 15 接入
  链段重启凭据。**背景**：append-only 之上此前**无任何合法删行出口**——所有者明令删除某批 workflow 文档时，
  台账对应行不删则行级④「doc 在当前树存在」持续报红，退路只剩手改台账（即 `--no-verify`）。这不是「缺个功能」，
  而是一条把使用者逼向绕过的死路。判据四条缺一不可：manifest 存在且 removes 非空；每哈希恰命中一行；
  新内容 == 旧内容 − manifest 所列行（保序）；被删行 doc ∈ manifest.docs。**无 manifest 的删/改/重排仍全拦**
  ——append-only 红线对其余一切场景不变。**诚实边界**：manifest 是可写文件，刻意伪造即可让任意删行合法化，
  与「台账本地可写」同级（见 README 确认门诚实边界）；本通道不宣称防伪，只把「顺手手改」抬到「提交一份带授权
  与理由、可被 git 历史对质的凭据」。删除某 doc 的行会让其后继行的哈希链断裂，本批同时给链校验开
  「prevHash ∈ manifest 声明的被删哈希 ⇒ 合法链段重启」的口子，否则修剪后的台账会被检查 15 永久判断链。
  新增套件 19 场景（四条判据逐条 + 真 git `--staged` 端到端放行/拦截 + 历史全扫认领）。

  **⑤ 行级校验 ts 口径修正 + 分片覆盖（Step 5，②的必要补丁）**——`check-ledger-invariant` 行级校验①由
  「ts 全表非降序」收窄为「**同一 doc 内**非降序」，跨 doc 物理序乱序改为计数出账、不阻断；行级取数改走
  `ledger-loader` 视图（主台账 + 分片），**分片内的行不再逃逸行级校验**。
  为什么必须改：②的并集合会把「别的 doc 的新行」追加到本文件尾部，而那些行的 ts 可能早于本文件末行的 ts
  → 必然触发原判据。这是正常协作形态不是篡改；让门禁因正常协作报红，只会逼出 `--no-verify`。
  **未放松的部分**：同 doc 内的 ts 倒挂仍 hard 拦（该 doc 的确认时序倒挂是真问题），跨 doc 的插行/改行由
  检查 15 哈希链兜（doc 链对每个 doc 独立接续，见 ③）。视图序 = 主台账在前、分片在后，故既有
  `.agents/ledger-line-exempt.json` 的行号**不因引入分片而漂移**（有回归用例锁死）。新增套件 10 场景。
  既有套件 `check-ledger-invariant.test.mjs` 的 S5 断言措辞随口径修正由「非单调」改为「追加时序倒挂」
  （两行同 doc，判定行为不变）。

  **⑥ 分片写入与 compact 归并（Step 6）**——补上前五步留下的最后一块：**单机多 worktree 并行**场景
  （两个 worktree 同时 append 同一台账文件会各自读到同一末行 → 同 prevHash → 后写者覆盖前写者；git 并集合并
  要到 push 才介入，管不到 push 之前）。新增 `compact-ledgers.mjs` 归并器，`confirm-doc` 加 `--shard`
  写入开关（**默认仍写主台账，分片是有意的并发开关，不设零影响**）。

  - **`--shard` 与 doc 链口径绑定**：分片与主台账是不同文件，只有 doc 链（③）能跨来源接续。旧物理链口径下
    分片行会与主台账断链，故缺锚时**参数期直接拒**（友好报错指向 `policyVersion: 8`），而不是让用户写完
    台账再被门禁拦。写入侧取前驱走**台账视图**而非单个文件——否则该 doc 的历史行在主台账时，分片会从 `''`
    重启而断链。
  - **compact 三条安全设计**：默认 dry-run（必须显式 `--execute`）；同目录临时文件 + rename 原子覆写（中途
    崩溃 = 主台账原样、分片未删、可安全重跑）；并集按整行文本去重（幂等）。任一分片读失败立即中止。
    归并严格保持 append-only 前缀不变式：主台账既有行保序不动，分片行只追加末尾。
  - **检查 15 改走 loader 的带来源行号视图**：分片里的行**同样受链校验**——否则 `--shard` 等于给台账开了
    一个防伪盲区（门禁看得见分片行、却不验它们的链）。断裂报文定位从「单文件物理行号」改为 `rel:行号`
    （跨来源后单一行号已无法定位）。此处曾是多源化的「刻意例外」，该理由随分片引入失效，注释已订正。
  - **分片纳入历史全扫 + 删除豁免**（`check-ledger-invariant`）：分片同受 append-only 前缀不变量约束；
    但**分片被 compact 删除是合法形态**，不能照抄主台账那条「删文件即 hard fail」。豁免判据：该分片被删时的
    内容**每一行都已出现在同提交的主台账里**（并集归并的必然结果）→ 认领为 compact 归并；否则（行未并入 =
    丢行）仍 hard fail。分片路径清单取自 git 全历史枚举（compact 删掉后仍扫得到）。
  - `pipeline-run` 的 `RUNTIME_OWNED` 补 `.agents/confirmations.d/`，否则 `--shard` 的确认行会被沙箱越权
    检查误判为「宿主改了台账」。
  - 新增套件 17 场景（跨来源链衔接 / dry-run 不动盘 / 前缀不变式 / 幂等 / 删除豁免 vs 丢行拦截）。

  **本批遗留**：①夹具拷贝白名单陷阱——见下方「遗留①已偿还」段（已根治）。②文档收口（README 确认门口径 /
  ARCHITECTURE §3 / `workflow/README.md` 硬规则 6 扩写分片与修剪通道）尚未做。③CHANGELOG 未记版本号变更
  ——1.7.15 本就是未发布批次（HEAD 为 1.7.14），故本批内容并入该节而非新开版本。
  （2026-10-13 更正：本节已随恢复的发布管线发布到 npm 1.7.15；其后的引擎执行器改动另开 1.7.16 节。）

  **遗留①已偿还（2026-10-12 fixture-closure-rootfix）——夹具拷贝白名单陷阱根治**
  背景：上文①原判「只做逐处补齐」。补齐是止血不是根治——那份白名单必须与被测脚本真实的依赖闭包一致，
  两者互不校验，而**滞后表现为静默绿**：漏拷 → ESM resolve 失败 → 被测脚本根本没跑 → 断言面为空 → 套件判绿。
  假绿比红危险（门禁没跑却报告「门禁全绿」）。本次做两件事，各自独立成立：

  - **闭包自动解析，删掉手工清单**：新增 `templates/_agents/scripts/fixture-scripts.mjs`（夹具工具件），
    从入口递归求**同目录依赖传递闭包**并整闭包拷入夹具。依赖发现取三种形态：静态 `import/export from`、
    动态 `import()`、**裸文件名字面量**（`path.join(here, 'kb-search.mjs')` 这类 spawn 依赖——`wiki-search.mjs`
    只靠这一条挂住 `kb-search`；`check-hygiene` 靠它挂住 `rule-budget` 门与两个生成器）。裸文件名只在解析到
    同目录真实文件时计入，故跨目录字面量天然排除。**取舍口径：宁可多拷，不可漏拷**——多一个文件不会让测试变假绿。
    改造 9 个调用点（`check-loop.test` / `edit-face-check.test` / `ledger-prune.test` / `ledger-ts-monotonic.test` /
    `compact-ledgers.test` / `wiki-search.test` / `check-loop-rev.test` / `agg-delegations.test`），
    **维护面归零**：日后给任一引擎脚本加 import，夹具自动跟随。
    （未取「整目录拷贝」——60+ 脚本 × 每场景一 tmpdir 的 I/O 与耗时不可接受，且会丢失「本测试需要哪些脚本」这条信息。）
  - **漏拷防线（不依赖上一条，独立成立）**：`assertFixtureScripts` 在目标目录**独立复扫**全部脚本的依赖，
    任一解析不到即抛错并报**全量**缺失清单。纵深防御：即使将来有人又手写枚举（或绕过 helper 直接拷），
    漏拷会在建夹具那一刻响亮炸掉，而不是几十个场景之后以「门禁静默不跑」的形式悄悄绿掉。
  - **实现上踩过一个坑（值得记）**：注释剥离**不能用正则**。正则版把 `confirmations.d/*.jsonl` 这类**注释里**
    的 `/*` 当块注释起点，跨注释一路吃到下一个真 `*/`，把后面的 import 整段吃掉（`check-ledger-invariant`
    实测 12141 字符被砍到 4198，43 行的 import 直接消失 → 闭包漏依赖 → 绕回假绿）。改为逐字符状态机，
    只认三种真形态，字符串内容不抹（我们要的就是字面量里的文件名）。另收一条边界：点开头的隐藏名不作依赖
    （`check-loop.mjs` 里 `.replace(/\.mjs$/, '.test.mjs')` 的 `'.test.mjs'` 是**后缀字面量**不是文件名，
    按名解析必然扑空，会对每个夹具误报「漏拷」）。两条都有回归用例锁死。
  - 新增套件 `fixture-scripts.test.mjs`（12 场景：多层传递依赖 / `node:` 内建与长路径排除 / 注释不误收 /
    后缀字面量不误报 / spawn 依赖收进闭包 / 缺失即炸且报全量清单 / 闭包自洽 + 真跑一次确认不是「文件齐了但跑不起来」）。
    **命名取 `fixture-scripts.mjs` 而非 `_fixture-scripts.mjs`**：仓库 `.gitignore` 有 `_*.mjs` 规则（一次性
    诊断脚本用），带下划线会同时被 **git 与 npm 打包**排除——而 `files` 白名单外的忽略项会被 npm 拿来当
    排除清单，等于**发出去的包缺这个工具件**，装户跑引擎套件直接 `ERR_MODULE_NOT_FOUND`。检查 20
    （脚本测试覆盖）也因此自动满足（有同名套件），无需登记 `scripts-test-exempt`。

## 1.7.14

- feat(gate)+feat(gates)：**补组织级强制位 + 起草期歧义表达**（2026-10-12，对照「AI-Native SDLC 成熟度」调研
  短板表 P1 两项）。两处都是**补表达不补门禁数量**：20 项检查编号零变动，扩容门仍 6 项。新增 1 套件
  （stage-gates.test.mjs），撤除 1 条 scripts-test-exempt 登记。

  **① 起草期待澄清标记（needs-clarification）——补 spec-kit 的零阻塞歧义表达**
  外部对标：spec-kit 在模板内置 `[NEEDS CLARIFICATION]`，起草期强制显式标记歧义、禁臆测（不阻塞起草）。
  本项目此前的歧义处理只有一种形态——**停下来问**（确认门停机）：那是「事后阻塞」，AI 停住等人，
  而人在上下文里未必答得上（他刚提的需求，细节是 AI 算出来的）。
  做法（判据落 stage-gates.mjs = 起草前置判定的单源，confirm-doc 消费）：
  - 形态：正文行 `- 待澄清：<问题>`；同义前缀 `需澄清` / `待确认细节`；全/半角冒号；列表符 `-`/`*` + 前导空格
  - **`- 已澄清：…` 不算未澄清**——同前缀改字即声明解决，**保留该行**（留痕「曾不清楚过」，供事后对质）
  - **起草门不阻断**（这才是零阻塞的意义）；仅 `draft→approved` 确认门点名拒绝。intents 不受约束
    （澄清天然发生在需求单处）
  - **与检查 2（模板占位符）刻意区分**：占位符 = 忘了填（失职），本标记 = 我不知道（负责）。复用同一
    正则即把负责判成失职，故两条判据互不复用
  - 与「逐阶段前置门」**分开出账**：合并会让拒绝原因指向「前置」而前置其实是好的，作者查错地方
  - 诚实边界（已在源码与测试中钉住）：跨行 HTML 注释块 `<!--\n- 待澄清：x\n-->` 的中间行会被抽出——
    逐行过滤只认整行/行尾注释。**方向保守**（多拒不漏放），且跨行注释在 workflow 文档零先例，为不存在的
    形态加状态机属过度工程
  测试：`stage-gates.test.mjs`（新套件 15 断言：CLARIFY_RE 形态矩阵正例 5 / 负例 4、HTML 注释不计、
  跨行注释已知边界如实钉住、CRLF、空输入、clarifyGateFor 三态 + 行号点名）+ `confirm-doc.test.mjs`
  S19b/S19c（4 断言端到端：拒绝 exit 2 + 点名行号与内容 + 零落盘零新增台账 + 文案不误指前置门 /
  改前缀放行 / 删行放行 / intents 不受影响）。**scripts-test-exempt.txt 撤除 stage-gates.mjs 登记**——
  理由：该模块此前靠 check-loop.test 间接覆盖，但新加的两条判据**check-loop 侧无对应检查**，间接覆盖
  天然盖不到，故必须直测。

  **② 门禁信任档 gateTrust（gate-trust-level）——给多仓/组织场景一个真实强制位**
  背景：调研结论「gate 装户可改、hard 项缺防改」在 1.7.11 已补 `srcSha256` 安装锚 + doctor §6.6b 永久可见，
  但**只可见不阻断**（装户对门有最终所有权）。外部对标：Claude Code 的 managed policy +
  `allowManagedHooksOnly`（组织级强制 + 可屏蔽项目自定义 hook）——业界已有「组织级不可绕」这一层。
  做法（判据单源 src/doctor.mjs，`GATE_TRUST_LEVELS` / `GATE_TRUST_DEFAULT` / `gateTrustOf`）：
  - `kit.json` 新增 `gateTrust`：`project`（默认）失配 WARN（= 1.7.11 现状，**零行为变化**）/
    `org` 失配 FAIL（doctor exit 1）
  - **不把默认改成 org**：本仓诚实边界声明写明「门禁关不掉通道」（台账可写、哈希链防不住整文件重写）。
    把可见性升成强制而不同步补上「组织侧锚源的不可篡改性」，等于宣称一个关不掉的通道能关——比 WARN 更不可信
  - **非法值 / 缺键（旧台账）一律回退 `project`**：绝不因写错一个字符串自动升到组织级强制（配置事故）
  - **文案主干逐字相同**：升档只改级别 + 追加一句档位说明，不改判据、不改修复指引
  - 判据落 src/ 而非 templates/_agents/scripts/policy.mjs：kit.json 是包源 CLI 写的台账，装副本不消费
    这项——放 policy.mjs 会让装副本带一个自己不用的判据，两处真值反而更多
  测试：`doctor.test.mjs` 场景 30a 改写（断言**分级存在**而非写死单档：`add(lv, …)` + `lv = orgMode ? 'FAIL' : 'WARN'`）
  + 场景 37-42 新增（8 断言：显式两档 / 缺键·null·undefined·无 kit 回退 / 非法值四类回退 / 默认常量同源 /
  端到端四组 kit.json → checkGateAnchors 回读该档且失配仍检出）；50 断言绿。

  附带：README「五条硬规则」节补两段（gateTrust 两档 + 待澄清标记用法）；init.mjs 写 kit.json 时
  `gateTrust: GATE_TRUST_DEFAULT`（取常量不写字面量，与 §6.6b 同源）。
  实测：npm test 54 套件 0 失败；新套件 stage-gates 15/0、doctor 50/0、confirm-doc 66/0、check-loop 285/0；
  rule-budget 5/0（AGENTS.md 7829B ≤ 8192B，commands 目录 63918B ≤ 65536B——两处余量未动）；
  eslint exit 0；fresh-init 装户冒烟 doctor 16 PASS 0 WARN 0 FAIL，gateTrust 两档与待澄清门端到端实测
  （project → WARN / org → FAIL exit 1 / 挂未澄清项 → exit 2 点名第38行 / 改前缀后放行落态）。
  版本 1.7.14

## 1.7.13

- feat(metrics)+feat(scripts)：**补上外部证据点名的两处缺口**（2026-10-12，对照「AI-Native SDLC 成熟度」调研）——
  两项都**不加门禁项**：第一项是观测项（缺的不是拦，是量），第二项刻意不挂门（jscpd 需联网取包，
  进门禁路径等于给断网/攻击制造绕过口）。新增 2 套件，共 73 新断言。

  **① 产出接受率（merge-accept-rate）——补 METR 可合入性度量**
  外部证据：METR 2026-03 研究（296 个 agent 生成的 SWE-bench Verified 通过 PR 交真实维护者盲评，
  **合并判定比自动评分低约 24 个百分点**，约一半不会被合入）——通过自动评测与「人愿意合」是两个维度。
  本仓此前的度量面只覆盖**过程质量**（一次通过率 / 设计返工 / 门禁噪声 / 主兜底），**产出是否被接受
  零度量**——`independent-reviewer` 角色契约在，但复核结论不进任何机器台账。
  做法（扩既有单源，零新体系）：`workflow/delegations.md` 两张表加**末列**「合入结论」
  （`合入` / `返工后合入` / `未合入` / 留空）；`agg-delegations.cjs` 加 `parseVerdict` 纯函数 +
  `metrics` 加 `verdictRecorded / accepted / rejected / acceptRate` + `fmtAccept` 展示函数。
  四条口径决定（全部有反例钉子）：
  - **留空 = 未记录，不计入分母**——存量行零回填是硬约定；「未记录 ≠ 未合入」，混进去即凭空造低接受率
  - **样本 <5 不出率**（`ACCEPT_MIN_SAMPLE`，沿 agg 既有护栏）——小样本比率是噪声不是信号，
    且一旦进门禁就产出不可消退告警；`fmtAccept` 显式打印「样本 2/5」而非打 0%
  - **不进 `gateMonth`**——扩容门仍是 6 项，接受率不参与 `monthOk`（钉死断言：`items.length === 6`）
  - **合入结论由人工/独立复核写入，机器不判真伪**——同 `--delegated` 信任边界，delegations.md 头部声明
  消费侧：`gen-workflow-dashboard.mjs` 的 `qualityRows` 表头 + 行并列接受率（判据仍全部 reuse agg 纯函数，
  零重复）。月度行另打一行接受率分项说明（已记录/合入/未合入/留空不入分母）。
  测试：`agg-delegations.test.mjs` 场景 8（11 断言，核心反例 = **一次通过率 100% 而接受率 90%**——
  混列必被前者盖过后者）与场景 9（存量五列表兼容零误判 + 六列表末列解析 + 快照行含接受率列）；42 断言绿。

  **② jscpd 重复率漂移消费端（jscpd-drift-gate）——把 1.7.7 固化的基线接上消费方**
  背景：`scripts/jscpd-baseline.json`（111 文件 / 24810 行 / 209 克隆块 / 重复 7.49%，锚 commit
  9e0cbc5）自 1.7.7 落地起**全仓无任何代码读它**——死数据。外部证据：GitClear 2025（2.11 亿行变更，
  2020-2024）显示重构行占比 25%→<10%、复制粘贴行 8.3%→12.3%、重复块约 4 倍增长——重复率是 AI 编码
  最确定的退化信号之一。1.7.9 已在 `incidents/_TEMPLATE.md` 根因节埋「克隆分叉」采集点（证据采集在案），
  **消费端一直缺失**。新 `scripts/jscpd-drift.mjs`：读基线 → 干净 worktree 跑基线自带复现命令 → 比对
  `duplicatedLinesPct` → advisory 报告（抬升 >1pct WARN / >3pct 提示立 intent 收敛并指回克隆分叉采集点）。
  四条设计决定：
  - **默认实测面 = HEAD，不是基线 commit**——扫基线 commit 必得 Δ=0，那是自我复读不是漂移检查
    （`pickRef` 纯函数专钉这条判据）；`--verify-baseline` 才复扫基线做口径自查，与漂移判定分离
  - **不挂门禁**——jscpd 需 `npx --yes` 联网 + worktree + 全仓扫描，入门禁路径即引入网络依赖绕过口；
    恒 exit 0，报告器不是门
  - **基线坏了 fail-loud（exit 1）但不阻断**——判据的输入坏了却静默跳过 =「登记了却没查」不可见
    （六键齐 + 数值有限非负 + commit 锚 + 复现命令，逐项点名缺哪个）
  - **实测取不到 → `unknown`，既不判 OK 也不判红**——拿不到数据不是「没退化」的证据（沿 1.7.8 方案 B
    灰度第一档口径）；`parseReport` 逐路径探测跨版本字段（5.4.1 实测为 `statistics.total.percentage`，
    早期为 `duplicatedLinesPct`，本次实测踩到并修）
  测试：新增 `src/jscpd-drift.test.mjs`（第 53 套件，31 断言：真实基线可解析 / 六类 fail-loud /
    parseReport 跨版本路径含 5.4.1 实测形态 / compareDrift 四态含反例「取不到数据不谎报 OK」/
    pickRef 判据 / --no-run 端到端 / 阈值与未知参数校验）。**不真跑 jscpd 不联网**（真跑慢且依赖网），
  真跑路径由 CI 的 `workflow_dispatch` 手动 job 覆盖（新增 `jscpd-drift` job：基线快检 → 漂移检查 →
  报告入 run summary，**恒不红**；`fetch-depth: 0` 因 worktree 依赖完整历史）。
  实测真跑（win32 本机）：Δ +0.28pct（7.49% → 7.77%，114 文件 / 228 克隆块），未过 warn 阈值；
  首次真跑即咬出 `parseReport` 字段路径错误（取不到 duplicatedLinesPct）——**机器化的价值再次实证**。

  实测：npm test 53 套件 0 失败；新套件 agg-delegations 42/0、jscpd-drift 31/0、gen-workflow-dashboard 30/0。
  版本 1.7.13

## 1.7.12

- feat(gate)+fix(tpl+ci)：**第一性原理序列 1-6 批**（2026-10-11，对照当日评审重排）——
  ① **实例引用不变量门**（新增 src/instance-ref.test.mjs，第 52 套件）：包源随包下发件（引擎脚本 +
  命令/角色/协议文档）禁止引用实例专属带日期文档路径（incidents/specs/intents/plans/20xx-* 与
  papercuts 日期条目）——机器输出是证据性的，装户径路径悬空摧毁门禁可信度。清理 14 处：3 处运行时输出
  （check-lane-surface.mjs 阻断消息改指 new-task.md §级别判断、check-loop.mjs 并录 WARN 改指根
  AGENTS.md 确认门节、gen-workflow-metrics.mjs 漏斗表头去 specs 指针）+ 8 处注释出处改写 + 3 组命令
  文档「相关留痕」节收敛为「包源仓 git 历史」+ 2 处用法示例改 &lt;日期&gt; 占位。门立时咬出 4 处漏网
  （build.md:41 papercuts 指针、doctor.mjs 两处 WARN/注释、build.md:89）——机器化的价值实证。
  ② **CI 双平台矩阵**：ubuntu → ubuntu+windows（node 18/22 × 2）——纯包源后 CI 是本仓唯一机器门，
  win32 分支（git.exe/路径/spawn）此前零机器验证，平台分叉事故在案（check-loop.mjs 平台注记）。
  ③ **bodySha 单源化**：doctor §6.7 checkAdapterDrift 内联第二份 splitFm/bodySha 收敛为 import
  sync-hosts 导出（splitFm 保持模块私有）——消灭「注释约束同口径」的漂移面。lint 抓到 splitFm
  未使用导入（首版多导出），顺手修正。
  ④ **build.md 包源专属三节删除**（§4-6 改权威源/doctor/包源后必跑）：三节提醒的属性（薄适配同步、
  双源一致）在唯一适用仓已有机器强制（pre-commit 双源门 + doctor §6.7），正文与 sync-hosts.md/
  source-sync-check.md 专题文档重复——装户 AI 每次读 Build 少消化三节无关指令（约 1.7KB），§7/§8
  重编号为 §4/§5。
  ⑤ **deploy 观察期决策规则 + plans 验证层标注**：deploy.md §6 补「异常判据（错误日志/异常告警/
  关键业务流失败任一出现即触发回滚，不等 24h；无异常满 24h 方可闭环）」——观察期从形式存在升级为
  功能存在；plans/_TEMPLATE.md 验证方式补「每条验收标准标注验证层（单元/集成/E2E/人工实测），
  关单证据按层对质」——证据声明可证伪。
  ⑥ **checkTemplateDrift 直测补齐**（doctor.test.mjs 场景 31-36）：三态判定（synced/stale-drift/
  custom-synced）+ 无锚静默 + 生成器目标排除 + 无对应模板跳过——此前唯一无直测的导出 check（评审
  预检勘误：doctor 并非「无直测」，checkOwnedDrift/AdapterDrift/LedgerCoverage/Snapshot/GateAnchors
  共 30 场景早在案）。
  附带修复：doctor §6.6 FAIL 消息内 `node bin/flow-kit.mjs sync` → `npx agentic-flow-kit sync`
  （装户无 bin/，S2 同类）；build.md:41 owned 同步条目标注「仅包源/dogfood 双形态仓适用」。
  ⑦ **确认口径随动收口**（2026-10-09 scope 变更的文档遗漏）：build/test/plan/design 五处残留退役
  纪律「逐件配逐件原话 / 不复用同句 / 逐件调用+逐件原话 / 禁复用同句」→ 统一为「逐件确认不变（手动
  路由每阶段一道确认门，禁并录）+ 摘要为人类可读留痕可复用——分辨力由落账自动记录的改动面
  scope{files,sha256} 与文档指纹承担」；引擎脚本内的退役说明注释（check-loop/confirm-doc 记录旧判据
  四类失效）保留不动。口径本质：手动路由 = 每阶段过确认门再进下一阶段；pipeline-run = 人件门（关键
  不清楚处）确认后继续。
  实测：npm test 52 套件 0 失败；instance-ref 门扫 106 份零引用；sync-hosts 81 对全对齐；fresh init
  冒烟首提过门、doctor 16 PASS 0 WARN 0 FAIL、四项新内容装户面在位。版本 1.7.12

## 1.7.11

- test(src)：**纯包源预算自检门**（2026-10-11 budget-self-check）——关闭「纯包源仓不跑装户预算门」盲区：
  常驻面预算单源 templates/_agents/rule-budgets.txt 此前只在装户侧强制（pre-commit --staged 硬拦 /
  check-loop 13 --all warning），v1.7.1 起本仓纯包源两处皆不跑——bb69e19/418960a 重构净增 78B 把
  .agents/commands/ 推到 65581B > 65536B 包源侧零暴露（同日 S1 冒烟实测发现，装户首提被硬拦）。
  新增 src/rule-budget.test.mjs：同一张预算表映射到包源路径核对（run-tests 盘面 glob 自动挂载）——
  字节 = LF 归一（等价 fsize 的 git cat-file 口径）、目录合计 = 扁平 glob 不入子目录（rule-budget 脚本
  同口径勿两处漂移）、AGENTS.md 按全部技术栈 profile 渲染取 max（单源复用 STACKS/renderContent，
  BOARD_PORT 按最坏 5 位端口）；预算表缺失 / 解析 0 行 / 映射目标失踪 / 文件 glob 零命中 fail-loud
  （装户侧这些是 skip，包源侧是打包回归），装户侧专属面 SKIP 注记。实测：npm test 51 套件 0 失败；
  负向证明：目录限额临时压到 65000 → 套件 FAIL（超 497B + 处置指引）exit 1，复原回绿。版本 1.7.11

## 1.7.10

- fix(tpl+docs)：**装户第一公里两处修复 + 冒烟暴露的预算超限回归**（2026-10-11，对照当日多维评审 S1/S2）——
  ① **test.md 静态门 doctor 命令装户环境修正**（S2）：`node bin/flow-kit.mjs doctor` 在装户仓必报错
  （装户无 bin/，实测 Cannot find module）→ 改 `npx agentic-flow-kit doctor`，与 README 快速开始同口径。
  ② **README 60 秒路径补首装提交步**（S1）：init 后先 `git add -A && git commit -m "feat: bootstrap——…"`
  （此刻无活跃入口，泳道门仅 advisory），再立 intent——修复裸 git add 全暂存装户产物 × 活跃 L1 入口 →
  泳道完整性硬拦首提（fresh init 实测复现）。提交类型须在 feat/fix/docs/style/refactor/perf 内
  （commit-msg 机器校验——首版示例 chore: 实测被拦后改 feat:）。
  ③ **常驻面目录合计超限回归**（②冒烟暴露）：装户首提被预算门拦（.agents/commands/ 合计 65581B > 65536B）
  ——bb69e19/418960a 重构净增 78B，纯包源仓不跑装户 pre-commit 预算门故未暴露；沿 71e0b0e「不调预算」先例
  压缩 build.md/test.md 四处版本括号（-84B，出处权威在 CHANGELOG），恢复 ≤65536。
  ①③ 共十份宿主薄适配（wf-test/wf-build ×5 宿主）经 sync-hosts --apply 随动（frontmatter 不动，81 对全对齐）。
  实测全链路（fresh init 冒烟）：init → bootstrap 首提 → fill-plan（L1 草稿豁免）→ confirm-doc --delegated
  → 代码改动提交 → doctor，全 exit 0；npm test 50 套件 0 失败。

## 1.7.9

- feat(tpl)：**事故复盘根因节加克隆分叉证据收集提示**（2026-10-11，P4 判据触发器）——incidents/_TEMPLATE.md
  「根因」节补一行 HTML 注释：根因若与重复/未收拢代码有关（改 A 处漏了同源 B 处、克隆分叉），写明涉及的两处
  位置——这是调研「收敛须有消费方与事故证据才启动」判据的直接采集点（此前事故复盘不问这一问，证据只能靠
  碰巧撞见；每次复盘都被问一次，证据出现即立项收拢）。注释形态：不入沉淀抽取与落点空壳计数（占位/注释口径
  本就剔除），无关联时无视本行零成本。P4 主动收敛**维持留白**（209 个克隆块暂无消费方/事故证据），基线对照
  scripts/jscpd-baseline.json（111 文件 / 重复 7.49%）。版本 1.7.9

## 1.7.8

- feat(gate)：**gate 防改锚**（2026-10-11，P3-1——对照 2026-10-10 调研「gate 装户可改、hard 项缺防改」结论）——
  add-gate 给逐字拷贝安装的 gate 脚本在 owned 条目写 `srcSha256`＝安装时刻包源 sha（LF 归一，复用
  template-downstream 先例的锚字段）：sync 对 `sha256` 按盘面自愈（手改不留痕），但 gate 条目在装户 sync
  中解析不到包源模板、`srcSha256` 锚恒定——doctor 新增 §6.6b「gate 安装锚」校验，盘面 ≠ 锚 → WARN 永久
  可见（不阻断：装户对门有最终所有权，锚只提供可见性；重锚 = `flow-kit add-gate <门名> --force`；旧装户
  无锚静默跳过，重装后生效）。已存在被跳过的文件锚盘面现状、与包源不一致时 WARN 差异；local-pre-commit
  是合并接线件，不写锚、校验显式排除（防恒失配误报）。测试：新增 src/add-gate.test.mjs（4 场景 20 断言：
  首装锚＝包源 sha / 幂等 / 手改原锚保留 + 端到端抓改 / --force 重锚）；doctor.test.mjs +7 场景（完好 /
  篡改 / 缺失 / 无锚跳过 / local-pre-commit 排除 / 解析失败 / WARN 渐进路径）
- feat(tools)：**检查 8 场景对账双向补全**（2026-10-11，P2 批次——THEN 断言机器可抽 + 引用断链反向对账，
  均灰度第一档 warning、不进 hard、不加版本锚，沿 1.7.5 方案 B 口径）——
  ① `extractThenByScenario` 纯函数（check-loop.mjs）：按场景声明分块抽 THEN 断言行（`- THEN` 行首为准，
  `THEN:`/`THEN ` 变体兼容，GIVEN 行内 "THEN" 字样不误抽）；检查 8 对缺 THEN 的场景聚合出一条
  `[WARN 场景无断言]`——写了场景没写断言 = 空壳场景，机器从此可见；spec 读取失败跳过不误报（fail-open）
  ② 反向对账：intent「验收标准」引用了 spec 未声明的场景 ID → `[WARN 场景引用断链]`（spec 无场景节时
  引用同样悬空）——与既有「场景未覆盖」正向互补，共用同一次遍历解析不重复解析
  ③ spec 模板验收场景节补 THEN 机器对账说明一句。独立 check-spec-chain 脚本**未建**：plan 模板无需求
  编号约定、无对账面，按 YAGNI 收进检查 8（跨工件一致性对账的 analyze 位点）
  测试：check-loop.test.mjs 285/0（+11：纯函数四态 / 聚合列 ID / 无节零变化 / S9 断链 / 引用一致零告警 /
  无节引用仍断链）
- 备注：**宿主 5 份薄壳本批零改动**——薄壳架构既存（sync-hosts B-b：基座 templates/_agents/commands 正文
  单向同步宿主 wf-*.md，frontmatter 各自维护），THEN/断链规则落在 spec 模板与 check-loop，宿主无需随动；
  P2-3 指令预算经核实**已覆盖**（rule-budgets.txt 2026-10-06/07 已纳 AGENTS.md 8192B 与
  .agents/commands/*.md 8704B、目录合计 65536B，pre-commit 硬拦；宿主薄壳体积由 sync-hosts 正文 sha +
  doctor §6.7 把关）——不加重复防线
- 测试：run-tests 50 套件全绿（新增 add-gate.test.mjs）；版本 1.7.8

## 1.7.7

- feat(tools)：**test-protect 测试保护门入库 + 沉淀闭环三类机器对账补全**（2026-10-11，P0/P1 落地批次——对照 2026-10-10「AI-Native SDLC 闭环交付最佳实践」深度调研的建议项）——
  ① **test-protect 门入库**（modules/gates/test-protect，此前已实现未跟踪）：fix/调试提交里测试文件与被测代码同框 → exit 1（测试是「bug 已修」的证据，证据与结论同一次改动 = 自证）；`FLOW_KIT_ALLOW_TEST_EDIT=1` 显式豁免；纯测试提交合法。gates.test.mjs 补 3 用例（同框拦 / 豁免放行 / 纯测试过），gates README 模块表补行；顺手清理该脚本两个未使用 import（lint 绿）
  ② **P1-1 检索留痕**（kb-search）：每次实际检索后向 `.agents/notes/kb-search-ledger.jsonl` 追加一行 JSON（ts/query/scope/hits/top，append-only）——KB 沉淀↔检索形成可审计闭环（此前只有 console 输出零落账）；`--no-ledger` 显式退出；写失败仅 stderr WARN，不影响检索输出与退出码。kb-search.test.mjs +7 用例（留痕格式 / 追加不覆盖 / --no-ledger / 无命中也留痕 / 目录自建）
  ③ **P1-2 草稿超龄**（gen-wiki-board）：`drafts-archive/<YYYY-MM-DD-主题>/` 落盘超 14 天未归类 → stdout `[WARN 草稿超龄]`（advisory 同 B1 档，只提醒不阻断；恰 14 天不提醒、超过才提醒；目录名无日期前缀静默跳过；`FLOW_KIT_TODAY` 环境变量仅供测试/演练覆盖「今天」；归档计数与看板生成物零影响）。gen-wiki-board.test.mjs +2 场景（超龄命中 / 边界与无日期前缀不误报）
  ④ **P1-3 落点真实性**（check-loop）：沉淀追踪（incident 检查 3 / intent 检查 8 两侧对称）从「存在」升级「存在且非空壳」——落点文件存在但无 `来源` frontmatter 且非占位正文不足 3 行 → `[WARN 落点空壳]`（占位口径逐字对齐 sectionHasBody，标题行不算正文防凑数；`sedimentLandingIsShell` 纯函数 export 供直测；读取失败按空壳出账并注明）。既有 `[WARN 沉淀断档]`（不存在）回归不变。check-loop.test.mjs +11 用例（两侧空壳命中 / 来源豁免 / 正文豁免 / 断档回归 / 读取失败 / 纯函数边界）
  ⑤ **jscpd 复杂度基线固化**（scripts/jscpd-baseline.json）：干净 worktree 口径（仅 git 跟踪文件）111 文件 / 24,810 行 / 重复 1,858 行 = 7.49%，锚 commit、含复现命令——advisory 只可见不阻断，后续演进对照此基线，故意抬升须更新本文件并注明原因
- 测试：run-tests 49 套件全绿；kb-search 44/0、gen-wiki-board 35/0、check-loop 274/0、gates 15/0；版本 1.7.7

## 1.7.6

- feat(tools)：**B2 关单自动沉淀 + B3 wiki 来源血缘双向链接**（2026-10-10，KB 检索层与 wiki 收敛第二批）——
  ① **B3 来源血缘**（先于 B2 落地——B2 生成的 `来源` 字段须先有消费方）：wiki 文件 frontmatter 记
  `来源: workflow/<intents|incidents>/…` 指回源归档；`verify-wiki-consistency.mjs` 第 9 项校验存在性
  （活跃层断链 → 拒绝，草稿未落地 → 仅提示「草稿中间态」不阻断——归类前来源本就不存在）
  ② **B2 draft-sediment.mjs**：关单时 `node .agents/scripts/draft-sediment.mjs workflow/<intents|incidents>/<本单>.md`
  自动抽高价值节（intent：影响面/触达红线；incident：影响面/根因/为什么之前没拦住/复盘三件套）→ 渲染
  带 `来源` frontmatter 的草稿落 `wiki/drafts-archive/<日期-主题>/<主题>.md` → 回写源文件 `沉淀` 字段
  （已有非空人工登记不覆盖，`沉淀: 无` 视为豁免位可写）→ 重跑 gen-wiki-board（归档计数随动，否则
  verify-wiki-consistency 的 summary.archive 比对拦提交）。占位行（`<…>` / 注释 / 引用）剔除——与
  check-loop `sectionHasBody` 同口径，全占位单拒抽（内容无沉淀价值）。主题取法**标题行优先于文件名**
  （`# INTENT — 权限收敛` 胜过文件名尾段 `perm`）。`--dry-run` 预览不写盘。草稿是**中间态**：只读不增量、
  不参与文件级登记（仅计归档总数）、不进 kb-search 索引——人工归类到 `wiki/<主题>/` 后跑生成器 + 验证
  ③ 模板随动：test.md §6 关单加沉淀步骤；wiki SKILL.md 加来源/沉淀双向链接与关单自动沉淀约定，并修
  **命名漂移**（`drafts-archive/YYYY-MM-DD_<主题>` 下划线 → `<日期-主题>` 连字符，与 drafts-archive/README
  及本批脚本一致）；AGENTS.md Wiki 节同款补述；两模板 `沉淀` 字段注释指向新脚本
- fix(tpl)：**模板自带 wiki INDEX/看板与磁盘对齐**——templates/wiki 的映射表节此前是「（生成区…维护）」
  占位、看板 DATA 为 total 0 的初始态，--check 与 verify-wiki-consistency 均报漂移（HEAD 前既有，
  git stash 对照确认）。跑生成器对齐：映射表 7 节填实、看板 DATA total 7 / archive 1；用途列与锚点外
  内容原样保留。模板自此过自己的门（装户 clone 即一致，不再首轮就漂移）
- 测试：draft-sediment.test.mjs 41 场景全绿（4 纯函数直测 + dry-run 不写盘 / 实跑落草稿并回写沉淀 +
  重跑看板 / 事故口径四节 / 状态守卫 / 占位拒抽 / 路径越界）；kb-search 37/0、verify-wiki-consistency 6/6
  保持；版本 1.7.6

## 1.7.5

- feat(gate)：**KB 检索层与 wiki 知识库三处接缝收敛**（2026-10-10，对照建议第一批 small：B1 + wiki INDEX
  漂移 + A1）——前提判断：`workflow/ 永不入 wiki` 红线是对的（过程真相 vs 稳定提炼物的失效语义不同），
  收敛的目标是**让接缝变便宜**，不是消掉接缝。三处：
  ① **B1 沉淀追踪**（堵知识流失）：done intent 含高价值节（影响面/触达红线）或 closed incident 复盘三件套
  齐全时，frontmatter 须记 `沉淀: <相对仓根路径>`；缺登记 → `[WARN 未沉淀]`，路径指向文件不存在 →
  `[WARN 沉淀断档]`，`沉淀: 无` = 显式豁免。**刻意 warning 不 hard + 不加 policyVersion 锚**（沿场景覆盖
  子判据同款口径：字段缺失 = 零行为变化）。此前 intent/incident 与 wiki **零关联机制**——沉淀全靠
  两句人肉提示（closeout / 月度聚合），归档后复盘内容再无人见。新增导出 `sectionHasBody` 纯函数
  （节体非空判定：占位/注释/引用行不算，防模板未填段误判）
  ② **wiki INDEX 漂移检查**（补对称缺口）：workflow/INDEX.md 早有 doctor §6 + check-loop 11 双路机器校验，
  wiki 侧（速览计数/合计行/映射表/看板 DATA 四处生成区）**此前一路都没有**——装户手改生成区或忘跑
  生成器只有肉眼能发现。`gen-wiki-board.mjs` 加 `--check`（镜像 gen-workflow-index：不写盘、行尾归一
  比对、漂移 exit 1 + 差异预览）；doctor 新增 §6b（scriptGuard 供应链校验 + 存在性先行，旧装户无脚本
  静默跳过不产噪音）
  ③ **A1 kb-search wiki 侧节级提取 + 主题路径加权**：wiki 长文此前是全文 `includes`（召回差、命中行
  无上下文），现与 workflow 侧同构——节级提取（frontmatter + H1 + 白名单节 `WIKI_SECTIONS`，命中带
  `[节名] L行`）、**短文兜底**（无任何 `## ` 时正文全收，防纯标题文档零命中）、主题目录命中查询词 ×1.2
  （主题归属是 wiki 最有价值的结构特征，此前打分完全没用上）。行结构二元组升三元组（schema v2，
  CFG_FP 指纹自动作废旧缓存）
- chore(repo)：模板随动——intents/incidents `_TEMPLATE.md` frontmatter 加 `沉淀` 字段及注释；版本 1.7.5

## 1.7.4

- feat(gate)：**检查 8 加「场景覆盖」子判据 + specs/intents 模板加「验收场景」节**（2026-10-10，
  对照 OpenSpec spec-driven acceptance / 建议 4 方案 B）——同名 spec 写了 `## 验收场景` 节
  （GIVEN/WHEN/THEN，每条带 ID：S1、S2…）时，done intent 的「验收标准」须**逐场景 ID 引用**
  （`- [x] 场景：S1 <判据>（证据：…）`）；缺引用只出 `[WARN 场景未覆盖]`。**刻意三档保守**：
  ① warning 不 hard——沿本仓「先 WARN、装户吃过警告后升 FAIL」既有灰度路径（检查 8 自身的新建
  hard、检查 15 / 检查 18 同款演进），新判据先观察存量装户告警噪音；②**不加 policyVersion 新锚**——
  「spec 无场景节 = 原判据零变化」本身即向后兼容开关，`scenarioIdsOf` 返空则整个子判据短路，无需
  再开版本门；③场景 ID 只在节内识别（遇下一个 `## ` 收口，正则 `^\s*(?:###|-)\s*\**S(\d+)`，
  按出现序去重），`_TEMPLATE.md` 因 `docFiles` 的数字前缀过滤本就不入扫面。新增导出 `scenarioIdsOf`
  纯函数（不可读 → 空数组 fail-open）。测试 +6 场景（纯函数 3 + 端到端 3：全引用绿 / 缺引用 warning
  不阻断 / 无场景节零变化），全套件 48/0
- chore(repo)：版本 1.7.4

## 1.7.3

- docs(repo)：**修两处文档漂移 + 补宿主接入指南**（对照建议 5，2026-10-10）——① ARCHITECTURE 两处
  「46 测试套件」与盘面实测 48 不符：套件数是盘面派生量（两面 glob 枚举），**改为不硬编码、指向
  `npm test` 的机器可读汇总行 `[run-tests] 合计: SUITES n / FAILED m`**（沿本仓「派生量不入单源」
  纪律——硬编码必漂，1.7.0 的汇总行就是为机器消费建的权威源）② README 英文段「Five rules always
  block a bad push: … and the managed/owned ledger」与中文「五条硬规则」口径冲突：台账/双源是
  doctor / sync 校验面、**不拦提交**——按中文单源重写为「五个拦截面分布在不同工具」并显式声明
  中文段为单源 ③ 新增 `modules/hosts/README.md`（仿 `modules/gates/README.md`）：薄适配两层约定
  （agents 无前缀 / commands 带 commandPrefix，单源 `profiles.mjs#HOSTS`）、七宿主表（含 codex
  `skills/` 子层）、`sync-hosts --diff/--apply` 对账口径、「加一个新宿主」五步（注册 HOSTS → 建薄
  适配 → 权威源不动 → sync-hosts 自查 + npm test → README/HELP 随动）
- chore(repo)：版本 1.7.3

## 1.7.2

- feat(tools)：**`flow-kit validate` 只读校验入口**（2026-10-10，对照 OpenSpec validate 形态）——装户此前想单独跑结构检查只能挂全套钩子或跑全量 doctor。新增命令：包**内置** check-loop 引擎（`runCheckLoop({root})`，isMain 守卫 import 零副作用）对装户盘面跑闭环 20 项检查，`spawnGit` 以 `cwd:ROOT` 落在目标仓——tracked 过滤按目标仓 HEAD 算，与 git 钩子所见提交面一致。**不执行装户侧 `.agents/scripts/*`**（判定引擎随包版本走，与 doctor 的 scriptGuard「先验后跑装户脚本」两极互补）；缺 `.agents/` 先给 init 指引再红。输出契约：check-loop 的 HARD-BLOCK/WARN 两段式原样走 stderr（消费者 pre-push 不受扰），stdout 只承载汇总行 / `--json`（`{target,strict,checkLoopExitCode,exitCode,blockers,warnings}`）；`--strict` 把 advisory warning 也判红（判据单源 `validateExit` 纯函数）。不暴露 `--rev`（与 root 注入互斥，提交时点判定属钩子链职责）。测试 13 场景（纯函数 5 + 端到端 8：绿/红/strict 判红/指引/用法错）
- docs(readme)：**补装户 CI 接入与离线安装两节**（2026-10-10）——CI：init 本就把 `kit-ci.yml` 写进装户仓（此前只在 init 输出与文件头注释里，README 无从发现）；新节写明远端门语义（复跑 `verify.mjs`、owned 永不覆盖、非 GitHub 可删）、其他 CI 等价接入 = 同入口命令 + 服务端分支策略、并给出 `validate --strict --json` 作独立一道门。离线：包零运行时依赖（package.json 无 `dependencies`），`npm pack` tarball 自包含——外网 `npm pack` 取包 → 内网 `npm install -g`（或项目内）/ publish 进内网 registry，全路径**实测**（pack 产物无 dependencies 字段、tarball 装后 `flow-kit version` 正常）；`npx <tgz>` 直跑在本机 npm 实测 exit 0 但子进程 stdio 不回显，文档明示走安装后调用
- chore(repo)：validate 随动——README 快速开始补 validate 行、cli HELP/示例/头注同步；版本 1.7.2

## 1.7.1

- chore(repo)：**装户端内容清理——仓库回归纯包源形态**（2026-10-10）——本仓此前同时是引擎骨架**和**一个自装实例（dogfood）：删 `workflow/`（301 份实例文档）/ `wiki/`（11）/ `.agents/`（118 装副本+台账）/ `.zcode/` / `.githooks/`（5）/ 根 `AGENTS.md` / `.github/`，共 441 份，另清 `.agents/cache/`、`ppk.log` 等散落残留与悬空 `core.hooksPath`。验证：fresh `flow-kit init` 自举正常（doctor 13 PASS / 1 WARN 为看板端口占用，环境性），`npm pack` 266 份只发四区——删除的件全由 init 重生成，无损失。**装户侧机器门（门禁链 / check-loop / 泳道门）本就不在包源仓运行**：其豁免出口是 `workflow/intents` 的 L2/L3 入口，纯包源仓刻意不携带该语境，引擎仓控制面保护改由 `npm test`（47 套件）+ 评审 + 本 CHANGELOG 承担（约束写入 `check-lane-surface.mjs` 头部）
- fix(engine)：**包源径回落——五处只认 `.agents/` 装副本径的解析在清理后失效**（2026-10-10）——根因同一类：脚本在两处运行（包源 `templates/_agents/` / 装户 `.agents/`），而清理后仓内只剩包源侧。`gate-checklist.mjs` 的 check-loop 解析序改为 `.agents/` → 脚本同级（**生产行为缺陷**，非仅测试）；`gen-workflow-metrics.mjs` 枚举单源补包源径候选；`check-ledger.test` S9 / `source-sync-check.test` S5 无装副本时按既有口径 SKIP；`trae-hooks.test` 的 commit/push 放行场景改用**通过型桩门禁**临时目录当 cwd（保住全部 token 边界覆盖，「门禁未执行」deny 路径由 ③ 保留）
- feat(gate)：**check-engine-integrity 基线双路径**（2026-10-10）——受检面收集本就双布局（`templates/_agents/scripts` 与 `.agents/scripts` 等都扫），但基线文件路径只有装户命名空间，纯包源仓里基线恒「未启用」、跨提交锚（`git show <ref>:<lock>`）恒缺失，退化为恒真通过。基线解析改为按**仓库布局**定落点（`.agents/` 在 = 装户径；否则 = 包源径），跨提交锚两候选径都试。修了自己首版的缺陷：两候选皆无时默认装户径会让 `--update` **重建刚删掉的 `.agents/`**（死循环），现按布局回落。`control-surfaces.txt` 配置段双面列齐（脚本/钩子/CI 段本就双面，配置段原只列 `.agents/` 侧 7 个 .txt 件）
- fix(render)：**`engine-lock.json` 排除下发**（2026-10-10）——`render.mjs` 两处模板遍历原只排除 `.agents/cache`。包源径基线的键是 `templates/_agents/scripts/…`，装户盘面是 `.agents/scripts/…`——**一旦把包源基线入库，sync 会下发进每个装户的 `.agents/`，命名空间错配致全员误报「门禁件消失 / 未入基线」**（全局假 BLOCK）。两处遍历（`renderTree` 落盘 + `listTree` 枚举，doctor 台账覆盖率复用同源）均排除 `.agents/engine-lock.json`，`init.test` ⑨ 块钉住。**纯包源基线仍不入库**：豁免出口（L2 入口）在无 workflow/ 时无处可立，约束写入 `resolveLock` 注释
- ci(repo)：**重建引擎仓自身最小 CI**（`.github/workflows/ci.yml`，2026-10-10）——原 `ci.yml` 随 `.github/` 一并清理（其步骤依赖已删的 `.agents/scripts/`，不可复用）。新版 = `npm install` + `npm test`（含 lint），Node 18/22 矩阵守 `engines >=18` 地板。**有意不接 `check-engine-integrity`**：其收缩判据的合法出口是 L2 入口点名，纯包源仓无此机器，接进来任何控制面维护都会 hard-block 且无豁免。装户侧远端门仍是随包下发的 `templates/_github/workflows/kit-ci.yml`，两份职责分开
- docs(repo)：**过期自指表述修正**（2026-10-10）——README「本仓库显式 `audit: true`」（本仓已无 `kit.json`）改为 dogfood 时可显式置；`stage-gates.mjs` 引用改包源径；ARCHITECTURE 三层分发图 `.agents/（装副本 —— 本仓自己也是装户）` → `装户仓才有；本仓为纯包源，不持装副本`。（CHANGELOG 历史叙述不改——记录即事实）

## 1.7.0

- feat(gate)：**台账 scope —— 授权的机器事实**（2026-10-09 审查 A1 干净版）——委托代录的授权凭据原是 `--delegated` 的用户原话：**自由文本机器不可校验，AI 可零成本复用**（本仓实测「可以」133 次、「确认」60 次，406 行台账仅 6 行 tty），整条授权链的源头不可核对，而下游哈希链/指纹对账/内容绑定全建在空地基上。本版**换掉凭据本身**而非加一道校验：落账自动记 `scope{files,sha256}` = 被确认文档 + `git status --porcelain` 实测的未提交改动集，**机器派生、AI 无输入面**（写入侧 `confirm-doc.machineScope`，三形态 TTY/委托代录/AI 自治一律记）。归一与摘要单源 `policy.scopeDigest`（写入侧与检查 15 校验侧共用，防口径漂移 N3 教训同款）。`quote` 随之降级为人类可读留痕、**不再承担分辨力职责**——AGENTS.md「每次传当次原话、不复用同句」纪律据此退役（一条纪律存在的全部理由消失就该退役，而非留作仪式负担）。检查 15 新增 scope 子项（policy v7 `scopeSince` **时刻**锚，沿 v6 verifyDocSince 同款教训——日期粒度会把当日 04:29Z 已落的旧口径行误纳入受审）：缺 scope → warning（灰度第一档）；scope.files 重算 sha256 不符 → hard（「改了 files 没改摘要」，兜住整文件重写重建链后的二次篡改）。**向后兼容**：缺键 v1-v6 子项整体跳过，存量 406 行零新增告警；实仓 check-loop 9 条 WARN 与基线逐条一致。诚实边界：scope 证「放行时盘面上哪些文件在动」，**不证「这些改动语义正确」**——后者由 fingerprint（文档内容绑定）+ commit diff（事后对质）承担，不越界宣称
- fix(tools)：**npm test 漏跑 `src/sync-hosts.test.mjs`**（2026-10-09 审查 P0-1）——`run-tests.mjs` 的 `nodeSuites` 硬编码 8 项 `src/` 套件，该套件（19KB，全仓第三大）自 2026-09-25 挂载起从未被 `npm test` 执行；CI 也盖不住（`ci.yml` shipped 步骤只 glob `.agents/scripts/*.test.mjs`）。而 `commands/sync-hosts.md`「npm test 含 sync-hosts.test.mjs 8 场景」随模板下发 5 个装户宿主——**装户被告知的契约是假的**。检查 20 只扫 `templates/_agents/scripts/` 面，结构上抓不到 `src/` 漏挂。修法：**src/ 侧改盘面 glob 枚举**而非补一行（新增 src 测试文件不可能再被静默漏挂，枚举漂移交给盘面不靠人记得补）；附带给编排器一条机器可读汇总行 `[run-tests] 合计: SUITES n / FAILED m`。补挂后单跑 42/0 无腐坏，**文档那句随修复自动变回真话、无需改文档**
- fix(gate)：**测试绿凭证落的是错的事实**（2026-10-09 审查 P0-2）——`verify.mjs` 凭证计数原为 `pop(通配「合计: PASS n / FAIL n」)`，而全仓 46 套件**每个都打印自己那行同形文本** → 取到的是字母序最后一个套件的场景数（本仓实况 `workflows-check.test.mjs` 的 15），落进自称「一行机器事实」的 `passed` 字段。改为**只认编排器专属前缀行** + 套件口径（非本编排器口径的 `--test-cmd` 抓不到即省略计数键，**宁缺勿错、不回退到错的事实**）。两条回归锁在案：权威行与同形行并存取权威（45≠15）；仅有同形行则省略计数键。ARCHITECTURE「75+ 测试套件」同步证伪为 46
- docs(workflow)：**AGENTS.md 确认门纪律段重写**（A1 配套）——委托代录 `quote` 语义由「用户原话」改为「授权摘要」，新增「改动面 scope」条，退役「不复用同句」纪律并写明退役理由（分辨力已由 scope+指纹承担）；防伪条补 scope 摘要失配 hard。templates/AGENTS.md 双写（包源），根 AGENTS.md 为 owned 文件直改

## 1.6.0

- feat(gate)：**台账哈希链**（2026-10-09 engine-quality-round2/v2 D）——confirmations.jsonl 此前已知信任边界=本地可写、检查 15 不验签、静默手改不可机器检。写入侧 appendLedger（三调用方单点）每行追加 `prevHash`（末行 hash，历史行/空文件 → ''）与 `hash`（`policy.ledgerChainHash` 单源计算=sha256(prevHash+JSON.stringify(row))）；校验侧检查 15 新增子检查——连续带 hash 行段 prevHash 接续 + 重算一致，断裂 = hard「台账链断裂」（首断物理行号）。**向后兼容**：无 hash 历史行零回填零告警（链段重启口径与写入侧一致）。**断言非恒绿反证**：禁用验链判据 → 场景 21a 当场红。边界诚实声明：整文件重写可重建链不可机器防（兜底=台账自身 git 历史），同信任域锚文件评估增量≈0 缓做（papercuts 在案）。实仓冒烟：写入→自洽→中间行篡改→hard 抓到→还原即净；生产台账全链验算 0 断裂
- fix(tools)：**sync-hosts 包源布局多根对账**（2026-10-09 B1）——包源布局薄适配根恒为 modules/hosts，项目根 HOSTS.dir 宿主点（本仓 .zcode/）不在扫描面：bb69e19「81 对全对齐」声明漏其三份（复核 P2-3 实证）的机制根因。diffHosts 多根归一（adapterRoots，旧单根入参向后兼容）+ pairsFor hostFilter（只扫实际存在宿主点）+ applyForward 按条目 root 定位 + **对账面自描述行**（防不可解释的 N 对声明）。实仓 81→84 对 0 漂移；装户布局回归钉住（42/0）
- feat(tools)：**edit-face-check 编辑时快检**（2026-10-09 B2）——常驻面机器约束此前只在 git 钩子层生效（check-loop 仓库模式只扫 HEAD），编辑期零反馈（实测砍掉阶段索引到提交才被检查 7 报警）。工作树面 CHECK_LOOP_ROOT 全扫（判定零复刻单源）+ 预算 advisory；exit 语义 hard→2/预算超限→1/WARN 明细透传不进 exit（绝对计数会让存量仓库恒非零）
- feat(tools)：**fill-intent 历史坑强制注入**（2026-10-09 W2）——「历史教训/防复发」节检索占位此前靠 AI 自觉执行（pipeline-run 工单已注入，手动路由没有）：生成时自动 kb-search（--type incidents,plans，3s 超时）注入命中行；零命中/不可用 fail-open 保留占位+手工命令注释行。复核 P1-1 修正：模块名入关键词（spec S2 口径）
- fix(gate)：**check 8 凭证对账补 verifyDocSince 追溯窗口**（2026-10-09，用户拍板 D）——v6 凭证按 doc 绑定机制对**上线前** done 的单追责产 9 条不可消退 advisory；done ts ≥ verifyDocSince（值升级为时刻 2026-10-08T09:37:35Z——日期粒度把同日早时刻误纳入）才启用精确匹配，早于者退回 v5 全局布尔——不伪造凭证、不放宽 24h 窗口，与检查 15/18 生效日锚同构。断言非恒绿反证在案
- refactor(gate)：**检查 7 拆模块**（A1）——阶段索引同步迁 check-stage-index.mjs（check-hygiene/check-metric-claims 先例），头部清单行逐字不动、gate-checklist 登记完整、gate-seg 段归属按局部收集器口径
- feat(tools)：**CI 红回溯点名**（B3）——ci.yml/kit-ci.yml failure 步骤列出最近 7 天关单文档；**registry fallback**（W3）——npm ci 优先 lock + 末级官方源兜底（镜像故障不阻塞 CI）
- feat(tools)：**metrics 趋势序列 + 确认负担**（W4）——.agents/cache/metrics-history.jsonl 每日一行幂等；metrics.md 增「趋势（环比昨日）」与「确认调用 N 次（环比）」行（void 不计）——确认负担从无量化到有数据（治理效率议题的数据前提）
- chore：scripts-test-exempt 停车场清理（verify-wiki-consistency/wiki-search 补测移出 3 场景各、ensure-board 永久定性）+ ARCHITECTURE.md 架构单源 + check-loop advisory 10→1（余 1 条三件套不全用户拍板保留）+ 两起关单勾验事故 superseded 重立留痕（round2-v2/round3-v2——confirm-doc 前 grep 自检归零制度化）+ lint 工具链（eslint 9 入 npm test 首步，1.5.0 前实装本版补充豁免表收敛）

## 1.5.0

- feat(tools)：**lint 工具链**（2026-10-08 engine-quality-batch）——补上引擎 18k 行纯 JS「无任何 lint 配置」的缺口（test.md 质量门口径里的 lint 项在本仓一直是空转的）。eslint 9 + `@eslint/js`（flat config，`eslint.config.mjs`）**仅 devDependency**——零运行时依赖红线不破（`files` 打包面不含 node_modules，装户 init 后环境无 eslint 也无任何运行时 import 变化）。范围 = 包源四区（`src` / `bin` / `templates/_agents/scripts` / `modules`+`scripts`），ignores = `.agents/`（managed 装副本）/ `modules/hosts/`（薄适配生成物）/ `workflow/` / `wiki/` / `**/cache/**` / `**/*.min.js`（`marked.min.js` 第三方产物——首轮 92 处报错里 29 处源于未排除它）。`npm test` 首步跑 lint（`src/run-tests.mjs`）：eslint 未装（裸 checkout 未 `npm install`）**显式打印 skip 后继续**（可诊断性容错），已装但报错则 fail-closed 计失败——两分支均有冒烟实测。CI（`.github/workflows/ci.yml`）补 `npm install` 步骤置于五道零依赖机器门之后、`npm test` 之前。**存量清零 40 处**：28 处 unused（测试死赋值 + 引擎死代码——`SCRIPT_DIR` / `createRequire` / `fileURLToPath` / `LEDGER` / `fail` / `eq` / `scopeExplicit` / `diffMode` 等，逐处 grep 确认调用面后删）+ 4 处空 `catch {}` 补意图注释（「降级必须保留原因」纪律）+ 2 处正则多余转义 + **1 处零宽空格 U+200B**（`gen-workflow-metrics.mjs:51` 实证，肉眼不可见）。豁免纪律：用行内 `// eslint-disable-next-line` 最小标注，禁文件级禁用
- refactor(tools)：**pipeline-run 三层拆分**（2026-10-08 engine-quality-batch）——单文件 1001 → 882 行，按职责层拆出两个模块：`pipeline-run-docs.mjs`（文档纯函数 6 个：`fmGet` / `placeholdersIn` / `sectionBody` / `validateDraftContent` / `closeoutComplete` / `summarizeDoc`——零 IO 零 process 依赖）与 `pipeline-run-run.mjs`（run 存储层 8 个 + `nowIso` / `today` / `pad` 时间工具）。**单向依赖 CLI → run → docs**，docs 与 run 互不 import。**契约零变化**：CLI 五子命令入参 / stdout+stderr / exit 码 / `PIPELINE_RUN_ROOT|BIN|GIT_BIN|TODAY` 四注入点逐字节不变；对外导出面（`stageBar` / `parseKV` 留主文件 + `placeholdersIn` / `validateDraftContent` / `closeoutComplete` 经 re-export）不变，`workflow-board-server.mjs` 零改动即兼容。**测试断言双侧 diff 为零**、29 组全过；五子命令拆分前后输出归一 runId/时间戳后**逐字节一致**（独立复核以 `git archive` 取拆分前单文件对照）
- fix(tools)：**fill-intent 内嵌模板串转义 bug**（2026-10-09）——`fill-intent.mjs:34-35` 的骨架模板串里 `$\rightarrow$` 的 `\r` 被 JS 解析为**回车转义**吞掉，生成草稿含坏字符 `$ightarrow$`；实证 7 份历史 intent 被污染。修为 Unicode 箭头 `→`（3 处），sync 后探针生成骨架零坏字符验证。根因属「模板串误用 LaTeX 记号」，非模板继承（`templates/workflow/` 与 `_TEMPLATE.md` 干净）
- fix(gate)：**check 8 凭证对账补追溯窗口**（2026-10-09，用户拍板 D）——v6 的凭证按 doc 绑定机制（2026-10-08 17:37 上线）对**上线前** done 的单追责，产 9 条不可消退 advisory：4 单（`verify-evidence` / `workflow-dashboard` / `selfmeasure-and-modularize` / `gate-roi-metrics`）关单时 `--doc` 机制尚不存在、也无从补证（补跑只证明当下全绿、回溯不了关单当时，与门禁要消灭的自证同构）。修法：`done ts ≥ verifyDocSince` 的单才启用精确匹配，早于者退回 v5 全局布尔——**不伪造凭证、不放宽 24h 窗口**，与检查 15/18 生效日锚同构。`policy.verifyDocSince` 值从日期 `'2026-10-08'` 升级为**时刻** `'2026-10-08T09:37:35Z'`（日期粒度会把机制上线同日的更早时刻误纳入——`selfmeasure` 00:22Z / `gate-roi-metrics` 03:25Z 实证）。**断言非恒绿反证**：把锚点临时设为未来（2099）→ 既有断言「窗口内无凭证→出 WARN」**当场转红**（234→233/1），恢复即绿。fail-open 边界：台账不可读/无该 doc 记录 → 一律退「不在窗口」（本仓一贯的不误报优先）
- chore：check-loop advisory 10 → 1——9 条缺凭证由上述窗口消除；余 1 条「三件套不全」（`2026-10-08-checkloop-importable` 缺「是否需要新 intent」子项）用户拍板**接受为存量**：该 incident 三件套内容实质完整（规则面/自动化面/流程面齐全），仅未写检查期望的显式子项，且已 `closed`（内容绑定禁回填）

## 1.4.0

- fix(gate)：**测试绿凭证按单绑定**（2026-10-08 verify-doc-binding，AI SDLC 演进方向 1 切口②）——凭证与被证明对象此前**零绑定**：`verifications.jsonl` 的行只有 `{ts,exitCode,suite,passed,failed}`，**没有任何字段能承载「它是为哪一单落的」**，而 confirm-doc 置 done 前置与检查 8 对账都只问 `hasFreshVerifyLine()` = *全仓任意一份 24h 内绿行* → **跑一次 verify 就能给全仓任意一单的「测试绿」声明背书**（本仓 8 行凭证实证无一指明对象）。修法三件：① `verify.mjs` 增 `--doc <path>`，落账行增 `doc`（**相对仓库根的 posix 相对路径**，resolve+relative+分隔符归一，故反斜杠 / posix / 绝对路径三种写法落同一值；基准取 ROOT 而非 cwd —— CI / 钩子 / 夹具注入下 cwd 常在仓库根外，基准三处必须同源）；**不带 `--doc` 仍落行但无 `doc` 键**（`kit-ci.yml` 无单次上下文，强制必填会打断远端门；这样的行不给任何单背书）；② `policy.hasFreshVerifyLine(lines, now, doc)` 增第三参，`doc` 非空时要求 `e.doc === doc`（**精确等值**，不做前缀/子串匹配——放宽即给跨单背书开后门），`doc` 缺省则**逐字维持 v5 行为**；③ 两个消费方改为按本 doc 过滤（检查 8 的 `verifyFresh` 由「循环外算一次全局布尔」改为按 doc 查，台账内容仍循环外读一次缓存，**零新增子进程、门禁成本零增加**）。**向后兼容**：`POLICIES[6]` = v5 全键 + `verifyDocSince`，两消费方**仅 v6+ 才按 doc 过滤**，缺键（v1–v5）维持原全局行为，存量装户零新增告警（沿 `2026-10-06` `delegationSince` 补锚先例）。**存量不回填**：无从判定那 8 行是为哪单而跑，无据补数即造数。**实测证据**：本仓升 v6 后 4 个存量 intent 新增 8 条 `测试绿缺凭证` WARN——逐条对质确认这 4 单关单时**确实各自跑过 verify 且全绿**，但凭证从未指名，门禁当时**在原理上无法区分**「本单的绿」与「别的单的绿」；这是「无法验证」的诚实判定而非造假，用户拍板**保留不补跑**（补跑只证明当下全绿、回溯不了关单当时全绿，事后追认与本单要消灭的自证同构）。测试：verify.test 12→17/0、confirm-doc.test 54/0（新增 S40 四条含 **v5+他单绿行→静默**的兼容反例）、check-loop.test 231→**234/0**（既有 231 条断言**零改动**，文案锚点子串「测试绿缺凭证」/「无测试绿凭证」+`verify.mjs` 全部保持连续）；policyVersion 5→6
- feat(gate)：**门禁自我度量（门禁 ROI）**（2026-10-08 gate-roi-metrics）——补上「没有能力判断哪道门该留」这个缺口。① `gate-seg.mjs` 插桩共用件：在段边界记 `warnings.length` / `blockers.length` 与时间戳，由**长度差**推 `{id,label,warns,blocks,ms}`，**不动任何 `warnings.push` / `blockers.push` 调用点**（判定逻辑与文案零改动，回归面最小）；抽独立件是因为 check-loop 已 import check-hygiene，后者再反向 import 即循环依赖，两者都要插桩故判据须单源。**模块化插桩须用局部收集器 + `appendSegs` 并入**（自查抓到并实证复现）：check-hygiene 产出的是局部数组、执行期间全局长度不动，直接共用游标会让该模块各段恒记 0 且末段整段丢失，增量还会被误记到模块之后的第一个检查上。② check-loop **19 段插桩**（主流程 14 + check-hygiene 5）与 `--gate-stats` flag：落 `.agents/cache/gate-stats.jsonl`（append-only 运行时数据，已 gitignore、不进 kit.json managed 台账、刻意避开 papercuts 2026-10-05「探针临时件被 sync 收编」的事故面），IO 失败只出账不阻断。③ 新增 `agg-gate-stats.mjs` 聚合器：按检查 ID 出 命中/拦截/警告/累计与均耗时（默认按耗时降序），派生**噪声率 top**（警告数 ÷ 命中次数）与**死检查**（声明了但从未命中）两类决策依据，`--days N` 窗口（默认 30），坏行跳过不抛，空数据降级为「未采集」提示。④ `workflow/DASHBOARD.md` 增「门禁 ROI」节。**三条硬契约**：默认路径 stdout+stderr+退出码**逐字节不变**（统计默认静默，只在显式 flag 下落盘）；耗时口径**含子进程时间**（检查 11 调两个生成器 `--check`、检查 13 调 `rule-budget`，当时为 sh 调用、2026-10-13 起 node 直跑）——门禁真实成本本就要含子进程，不做剔除；**DASHBOARD 节刻意不铺运行数值**——该文件被检查 11 `--check` 覆盖，采集数据每跑一次门禁就变一次，铺进去等于每次采集必产一条漂移 WARN（与 audit-gate-hardening P3 的防噪红线正面冲突），故节内只放口径与采集/查看命令，数值走命令行。**首轮实仓数据（3 次运行，累计 77.4s）**：检查 8 验收标准对账 26.1s / 17 发版树未收口 21.5s / 14 确认留痕 19.2s / 13 常驻面体积预算 4.2s——四段吃掉 **92% 门禁耗时且样本内零命中**，其余 15 段合计 6.4s；噪声侧无一条超过 2 条。数据**推翻了立项时的预测**（原判「检查 4 和 11 噪声率最高」，实测二者仅 14ms / 213ms 且零命中）——聚合器自带「样本 <5 次只作线索不作决策依据」告警，本单据此**不拆任何门**。测试：gate-seg 15/0、agg-gate-stats 15/0、gen-workflow-dashboard 25→30/0、check-hygiene 10→15/0、check-loop 223→**231/0**（既有 223 条断言零改动即最强输出契约钉子 + 新增 8 条）；段归属实证：真实输出仅 1 条 WARN（三件套不全 = 检查 3），落盘数据唯一非零段即 `id=3 warns=1`，其余 18 段全零——无错记、无漏记；把插桩还原成修复前实现跑同一套测试 → 新增 5 条断言红 4 条（只入账 4 段、warns 全 0 而实际产出 2 条），确认断言非恒绿
- feat(gate)：**DASHBOARD 生成物漂移门**（2026-10-08 selfmeasure-and-modularize）——`gen-workflow-dashboard.mjs` 新增 `--check`（不写盘，与磁盘不一致 exit 1 + 差异行号 + 修复命令）；check-loop 检查 11 从「仅 workflow/INDEX.md」扩为「生成物漂移（INDEX + DASHBOARD）」，两物各自独立出账并指名修复命令。**双归一是门禁可用性的前提**（照 `gen-workflow-index.mjs:180` 2026-09-30 同坑先例）：① 行尾 CRLF→LF（fresh clone 检出 CRLF 会假阳性「漂移」）；②「生成于 <ISO>」行抹平（每次运行必变，不归一则门禁恒红 = 不可消退噪声，违反 audit-gate-hardening P3）。**装户跳过语义**：生成器脚本不存在（旧装副本）或 `workflow/DASHBOARD.md` 不存在（从未生成过看板）→ 跳过不报，新装用户不得因未生成过看板而每次 push 吃 WARN。测试 +14（归一三态纯函数直测 + 端到端缺失/一致/漂移/不写盘四态 + check-loop 端到端两场景）
- feat(gate)：**台账门禁噪声返工归因拆分**（2026-10-08 selfmeasure-and-modularize）——`delegations.md` 结果列新增取值 `返工×N（门禁噪声）`，`agg-delegations.cjs` 的 `parseResult` / `metrics` 双列累计（`reworkSum` 只吃设计返工、`reworkNoiseSum` 吃噪声），扩容门第 3 项「月度返工次数 = 0」改为**只对设计返工判 0**、门禁噪声返工在同条描述里单列可见。动机：本仓 DASHBOARD 自报质量门连续两月红（一次通过率 55% / 61%，门槛 ≥90%），根因是两档混列——门禁噪声（预算超限 / 双源漏刷 / 节名不一致 / 门禁误报）与设计返工同判一项，指标永远红且不指示改进方向。**存量行零回填**（旧四档解析逐条不变，与 batch/seq/of 纯增字段先例同款）；`avgRework` 仍含噪声 → `delegations.md` 快照表结构零改动。防标签滥用：该取值由作者手写、机器无法判真伪（同 `--delegated` 信任边界），口径与边界写入台账头部，判据拿不准时写 `返工×N`。测试 +7（含反例：设计返工 1 + 噪声 1 → 门 3 仍 ❌）
- refactor(gate)：**check-loop 卫生类检查拆模块**（2026-10-08 selfmeasure-and-modularize）——检查 2 / 9 / 11 / 12 / 13 迁入新模块 `check-hygiene.mjs`（`runCheckHygiene(ctx)`），check-loop.mjs 1473 → 1383 行。先例 = `check-metric-claims.mjs` 承载检查 16；耦合高的检查 1/5（共享文档循环）、8（证据核验）、15（指纹对账）留后续批次（拆它们需先解耦，不与本批混——`2026-10-08-checkloop-importable` 教训：1600+ 行变换与行为修复混批不可审）。**判定零复刻铁律**：ctx 传入既有 helper（`docFiles` 的 tracked 过滤 / `fmGet` 的 frontmatter 受限子集 / `linesOf` 的读异常出账），模块内不得重新实现。**输出契约不变量**：原顺序 2 → 9 → 11 → 12 → 13（warnings 按插入序输出、行序是稳定契约），拆成一次调用后由模块内保证，测试钉住。新增 `check-hygiene.test.mjs` 10 断言（五检查正反 + ctx 降级 + 装户跳过 + 输出顺序）；**拆分前后 CLI stdout+stderr 逐字节对账 diff 为空**（作关单证据）
- docs：README / CHANGELOG 能力清单**收敛到 CHANGELOG 单源**（2026-10-08）——删 README「当前能力（已发布 0.8.0）」节的逐条特性枚举与「仓库里还没打进版本号的增量」段（所列项全部已随 1.1.x / 1.2.x 发布）、删「活跃层 09-23~09-28 未改成 done」陈旧段（实盘活跃层 0）、删 CHANGELOG 首行反向互指。两处各自枚举导致 README 长期停在 0.8.0 快照
- docs：README 确认门表述改为**留痕而非防伪**（2026-10-08）——与 `.agents/scripts/stage-gates.mjs` 头部已声明的信任边界对齐（本地可写台账可伪造，门禁把「顺手绕过」抬到「主动伪造」而非关闭通道）
- chore：重跑 `gen-workflow-metrics.mjs` 刷 `workflow/metrics.md` 2026-10 行真值（此前该行与 2026-09 行逐字相同 = 198 篇 / 1018.2 KB，实盘已 264 篇 / 1.35 MB）。**metrics.md 仍不挂漂移门**——沿 `gen-workflow-metrics.mjs:9` 既定设计（快照是历史记录，逐字节校验会常红）

## 1.3.0

- fix(gate)：**检查 8 纯数字证据 × git 通道坏死 → fail-closed**（v1.3.0 Release CI ubuntu 实证）——fixture 短 sha 恰全数字（`--short` 7 位 ≈4%/run）时，rev-parse 实证分流在 CHECK_LOOP_GIT 整体坏死下不可能，纯数字 text 豁免曾把「持续异常仍 fail-closed」场景漏成 exit 0（win32 sha 含字母走 forged 故本地恒绿——平台概率差异）；修复：rev-parse 因 spawn 异常失败（非 git 正常回答）时禁用 text/external 两类豁免，按伪造拦（与「本地核验不了就按伪造拦」注释语义对齐）；通道健康时纯数字假 sha → text 豁免语义保持（misfire 防线不回归）；测试 +2 断言双向钉住
- feat(gate)：**装户 GitHub Actions CI 远端门下发**（2026-10-07 adopter-ci-github，Anthropic AI-Native SDLC 基准必修缺口②）——新增 `templates/_github/workflows/kit-ci.yml`（owned 薄模板）：push(main)/PR 时在 GitHub runner 复跑统一入口 `node .agents/scripts/verify.mjs`（测试【有根 package.json 才跑】+ check-loop），YAML 零门禁逻辑（本地/远端单源防口径漂移）；新装 init 直装、存量装户 sync 出「新增 owned 起步文档」提示自取；文件头声明 owned 自持 / 非 GitHub 装户可删（等价门 = 同入口命令 + 服务端分支策略）/ branch protection 属服务端人工一次性配置（机器不校验）。契约两处：`isOwned` 增 `.github/` 前缀（CI 配置归装户自持，sync 永不覆盖）；`srcTemplatePath` 由 `.agents/` 特例泛化为通用点前缀翻译（`.github` 新增命中感知锚，`.agents` 严格不变）；测试 +10 断言（S16 感知三态/newOwned/fresh-init 落盘锚）
- feat(gate)：**papercuts 清账批**（2026-10-08 papercuts-cleanup-batch，用户点名升级）——五项真刺行为修复 + 台账十处处置标注：① sync 记账三段（owned 自愈/模板感知/台账重写）移到生成器之后，wiki 变更后一次 sync 自洽（S17）；② 检查 18 两表识别与 agg splitTables 表头签名同口径（节标题漂移不再静默停解析，双向互引注释）；③ 检查 14 确认态判据改 OR 并集（git 历史 ∪ confirmations.jsonl 台账 approved 行，git 判据不弱化；回溯三历史树 worktree 重放零新增误报、真实历史树消 3 条存量误报）；④ 检查 4 refRe 字符类移除全角逗号（中文路径引用后跟「，」不再误报断档）；⑤ check-ledger 无参自适应入库态（暂存区非空即入库态、暂存版=index、暂存删除即拦——堵分批提交「提交树内 kit.json 预 landing」CI 必红 + 只 add 件不 add 台账姊妹漏洞，独立复核 P1 修正 HEAD 兜底绕过后终态）
- feat(tools)：**workflow 仪表盘**（2026-10-08 workflow-dashboard）——`gen-workflow-dashboard.mjs` 一键生成 `workflow/DASHBOARD.md`：头部红绿灯（质量门复用 agg-delegations 判据 + 关单时长带 P50≤1 且 P90≤10 天）+ 关单时长新指标（done intents 立项日 → confirmations.jsonl 最早 done 行，P50/P90/max，存量单无台账行诚实跳过）+ 质量月度行；观测面非门禁（红灯看不拦，gen-workflow-metrics 教训）；`agg-delegations.readLedger` 使能导出（root 显式参数 + soft，原签名行为不变）
- feat(gate)：**check-loop 可 import 化重构**（2026-10-08 checkloop-importable，papercuts 2026-10-04 isMain 行用户点名单独立项）——isMain 主守卫 + CLI 入口收敛；约 1280 行顶层流程包进 `export function runCheckLoop(opts)`（opts = {root?, rev?, hardening?}，root 显式参数优先；返回 `{exitCode, blockers, warnings}`，输出打印照旧——CLI 行为 stash 同状态逐字节不变）；纯零件导出 delegationResultRows / versionGreater / fmStatus / bindingSha256 + `check-loop-unit.test.mjs` 直测 10 断言；端到端 219 断言套件全量保留为行为回归网；独立复核 diff -w 视图零 P0/P1/P2。20 个检查逐个拆独立模块留渐进程序（check-metric-claims.mjs 先例）

## 1.2.2

- fix(hosts)：**sync-hosts 支持装户布局**（2026-10-07 papercut，装户回流批）——目标根由恒 `pkgRoot`（= 包安装目录）改为 `--dir` > cwd > pkgRoot，并按目标根自动判布局（包源 `templates/_agents` ↔ `modules/hosts/<宿主键>/`；装户 `.agents` ↔ 项目根下 `<宿主点目录>/`，新增 `hostDirOf` 处理点目录命名）。**修前装户跑 `flow-kit sync-hosts --apply`（doctor §7.x 的提示）会去改包源仓、装户自己的适配层纹丝不动**；另：未安装宿主（目录不存在）不再计 `authorityMissing`（此前装户 `--apply` 恒 exit 1 且刷 45 行噪声）。测试 +1 场景（装户布局 `--dir`/cwd/apply，35→36 断言）
- fix(hosts)：**补回流 1.2.1 遗漏的薄适配**——1.2.1 改了 `templates/_agents/commands/test.md` 但未跑 `sync-hosts --apply`，包源 5 份 `modules/hosts/*/commands/wf-test.md` 与本次 `wf-sync-hosts.md` 一并补同步（包源 81 对全对齐）
- docs(commands)：`sync-hosts.md` 补装户跑法（双布局说明 + `--dir`）

## 1.2.1

- fix(gate)：**verify 装户仓跳过语义**（2026-10-07 papercut，装户回流批）——装户仓（根目录无 `package.json`，工程在子目录）默认 `npm test` 恒 ENOENT 卡死关单编排；改为无显式 `--test-cmd` 且 cwd 无 package.json 时**显式跳过步骤 1**（⏭ 提示装项目口径或 `--test-cmd`）且**不落测试绿凭证**（跳过即无「测试绿」事实，防假绿——与 1.2.0 凭证语义自洽，confirm-doc 前置/检查 8 对账零改动兼容：装户仓关单将得到 advisory 引导）；测试 +1 场景三态钉住
- docs(skill)：**verify-ui 技能卡增强**（装户实测经验回流）——浏览器选择（较新 Chromium headless）、登录态注入+整页重载（hash 路由 hardGoto）、不留脏数据纪律（按 ID 精确删除禁模糊匹配）、关键坑（HTTP 避自签证书 / MCP profile 残留锁）；`<待填>` 占位改引用 owned 的 `runtime-env.md`（managed 件不承载项目特定值，sync 覆盖无害）

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
