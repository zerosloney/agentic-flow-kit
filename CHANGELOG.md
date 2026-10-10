# Changelog

已发布版本的摘要。**能力清单的单一真相源即本文件**——README「当前能力」节只讲语义并指向此处，不重复枚举（2026-10-08 收敛：两处各自枚举导致 README 长期停在 0.8.0 的过期特性清单）。

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
- feat(gate)：**门禁自我度量（门禁 ROI）**（2026-10-08 gate-roi-metrics）——补上「没有能力判断哪道门该留」这个缺口。① `gate-seg.mjs` 插桩共用件：在段边界记 `warnings.length` / `blockers.length` 与时间戳，由**长度差**推 `{id,label,warns,blocks,ms}`，**不动任何 `warnings.push` / `blockers.push` 调用点**（判定逻辑与文案零改动，回归面最小）；抽独立件是因为 check-loop 已 import check-hygiene，后者再反向 import 即循环依赖，两者都要插桩故判据须单源。**模块化插桩须用局部收集器 + `appendSegs` 并入**（自查抓到并实证复现）：check-hygiene 产出的是局部数组、执行期间全局长度不动，直接共用游标会让该模块各段恒记 0 且末段整段丢失，增量还会被误记到模块之后的第一个检查上。② check-loop **19 段插桩**（主流程 14 + check-hygiene 5）与 `--gate-stats` flag：落 `.agents/cache/gate-stats.jsonl`（append-only 运行时数据，已 gitignore、不进 kit.json managed 台账、刻意避开 papercuts 2026-10-05「探针临时件被 sync 收编」的事故面），IO 失败只出账不阻断。③ 新增 `agg-gate-stats.mjs` 聚合器：按检查 ID 出 命中/拦截/警告/累计与均耗时（默认按耗时降序），派生**噪声率 top**（警告数 ÷ 命中次数）与**死检查**（声明了但从未命中）两类决策依据，`--days N` 窗口（默认 30），坏行跳过不抛，空数据降级为「未采集」提示。④ `workflow/DASHBOARD.md` 增「门禁 ROI」节。**三条硬契约**：默认路径 stdout+stderr+退出码**逐字节不变**（统计默认静默，只在显式 flag 下落盘）；耗时口径**含子进程时间**（检查 11 调两个生成器 `--check`、检查 13 调 `sh rule-budget.sh`）——门禁真实成本本就要含子进程，不做剔除；**DASHBOARD 节刻意不铺运行数值**——该文件被检查 11 `--check` 覆盖，采集数据每跑一次门禁就变一次，铺进去等于每次采集必产一条漂移 WARN（与 audit-gate-hardening P3 的防噪红线正面冲突），故节内只放口径与采集/查看命令，数值走命令行。**首轮实仓数据（3 次运行，累计 77.4s）**：检查 8 验收标准对账 26.1s / 17 发版树未收口 21.5s / 14 确认留痕 19.2s / 13 常驻面体积预算 4.2s——四段吃掉 **92% 门禁耗时且样本内零命中**，其余 15 段合计 6.4s；噪声侧无一条超过 2 条。数据**推翻了立项时的预测**（原判「检查 4 和 11 噪声率最高」，实测二者仅 14ms / 213ms 且零命中）——聚合器自带「样本 <5 次只作线索不作决策依据」告警，本单据此**不拆任何门**。测试：gate-seg 15/0、agg-gate-stats 15/0、gen-workflow-dashboard 25→30/0、check-hygiene 10→15/0、check-loop 223→**231/0**（既有 223 条断言零改动即最强输出契约钉子 + 新增 8 条）；段归属实证：真实输出仅 1 条 WARN（三件套不全 = 检查 3），落盘数据唯一非零段即 `id=3 warns=1`，其余 18 段全零——无错记、无漏记；把插桩还原成修复前实现跑同一套测试 → 新增 5 条断言红 4 条（只入账 4 段、warns 全 0 而实际产出 2 条），确认断言非恒绿
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
