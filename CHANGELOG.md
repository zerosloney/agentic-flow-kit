# Changelog

已发布版本的摘要。**能力清单的单一真相源即本文件**——README「当前能力」节只讲语义并指向此处，不重复枚举（2026-10-08 收敛：两处各自枚举导致 README 长期停在 0.8.0 的过期特性清单）。

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
    只靠这一条挂住 `kb-search`；`check-hygiene` 靠它挂住 `rule-budget.sh` 与两个生成器）。裸文件名只在解析到
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
  字节 = LF 归一（等价 fsize 的 git cat-file 口径）、目录合计 = 扁平 glob 不入子目录（rule-budget.sh
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
