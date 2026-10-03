# 回归清单（活文档）

> 用途：deploy 清单「回归必过」与 incidents 复盘「防复发验证」的统一落点。
> 本清单是**活文档**：随模块上线补充、随 incident 追加、随功能演进修订；代码演进后以本清单与实际行为为准。

## 维护规则

1. **deploy 前**：过本清单中「涉及模块」的全部条目 + 跑自动化测试（项目防复发用例）
2. **incident 后**：防复发条目追加到「防复发验证」节，不留在 incident 文档里；能自动化的落测试用例
3. **模块上线/走查后**：为该模块补关键路径条目
4. 条目过时（功能下线/行为变更）时删除或改写，不保留失效条目
5. **新增防复发条目落点优先级**：自动化用例 > 脚本化断言 > 人工步骤（仅剩视觉/交互断言无法脚本化时）

## 回归必过

| 模块 | 条目 | 依据 |
|------|------|------|

## 防复发验证

| incident | 条目 | 落点 |
|----------|------|------|
| 2026-09-23-cjs-ext-in-typemodule | 在 `"type":"module"` 的 Node 项目装包后 commit：pre-commit 链须通过（commit-check 不崩） | 本仓库真钩子常开（每份提交自动重验） |
| 2026-09-24-review-fixes | 生成器/聚合器新增「锚点缺失」类分支必须 fail-loud 并配 fixture 用例；delegations 台账解析、wiki 生成器锚点、sync 跳过件行为随 npm test 回归 | agg-delegations.test.mjs（三场景）/ gen-wiki-board.test.mjs 场景 4-5 / sync.test.mjs S11 |
| 2026-09-24-p4-sweep | 字面量数据（标题/预算路径/命令）当正则或裸子串匹配前先加 token 边界或字面量转义；钩子异常分支先分流（ENOENT≠违例、脚本崩溃≠无违例）再报 | gen-workflow-index.test.mjs 场景 5/6 + agg-delegations.test.mjs 场景 1（npm test 随跑）；commit-msg 随本仓库每次提交重验 |
| 2026-09-24-metrics-glob-vocab | 自实现 mini 解析器（glob 等）必须校验词表边界——出表形态警告跳过，不做丢弃前缀的放宽匹配 | gen-workflow-metrics.test.mjs 场景 4（npm test 随跑） |
| 2026-09-24-npm-pack-cache-leak | 运行时生成件 `templates/_agents/cache` 不得进 npm 发布包——files 负向排除 + prepack 清除两道防线须在位，发布前 `npm pack --dry-run` 复核包清单无 cache | pack.test.mjs P1/P2（npm test 随跑）；npm 10/11 双版本 pack 实测 |
| 2026-09-25-wf-run-review-fixes | 跨进程传 prompt 一律 stdin 协议（Windows 批处理 shim + 多行内联必须 fail-fast 不静默截断）；fake provider 测试矩阵须含真实 .cmd/.bat shim 形态（测试环境与真实威胁形态同构）；台账列内容半角 ｜ 全角化；错误路径必须 settle 在跑任务再退；行格式正则断言必须带负例（/^|…/ 恒真教训） | wf-run.test.mjs ①负例 + ⑧-⑫（npm test 随跑） |
| 2026-09-25-wf-runtime | 包源改 owned 文件（含 AGENTS.md 常驻指令、AGENTS.md 引擎双源纪律段等）必须手动同步仓库根装副本（sync 只动 managed，owned 走 kit.owned 跳过）；workflow/INDEX.md 状态变更后必跑 `node .agents/scripts/gen-workflow-index.mjs` | 本仓库真钩子常开 + 每次修改 AGENTS.md 后手核对 + gen-workflow-index.mjs `--check` 验证漂移 |
| 2026-09-25-doctor-owned-drift | doctor 必须校验 kit.owned 列表盘面 sha vs 台账 sha 不一致（drift + gone 双信号）且严化为 FAIL（首次引入 WARN 2026-09-25 / 严化 FAIL 2026-09-25-strict）；checkOwnedDrift 函数必须独立 export 供测试套件直接 import；新增校验必须配套 fixture 测试覆盖（场景含对齐/手改/缺失/无 owned/kit.json 不存在/解析失败/多 owned 部分漂移/源码层 WARN→FAIL 严化断言） | doctor.test.mjs 场景 1-7 + 8a-8c（npm test 随跑） |
| 2026-09-26-managed-ledger-adopt | 装户面 managed 类文件必须全部登记在 `kit.json` 台账内——盘上有、台账无即升级通道断裂（包源改装副本不跟）；新增 managed 类文件禁手动双写绕过登记，须经 init/sync 登记；sync 对台账外文件仅在「磁盘内容 == 新版渲染 sha」时收养，本地真改动仍跳过不登记 | sync.test.mjs S14（收养三态，npm test 随跑）+ doctor.test.mjs 场景 15-18（覆盖率差集，npm test 随跑）|
| 2026-09-26-check-loop-review-fixes | 门禁判定工具须保「对自家仓库自查零误报」基线——迁移安全网只保与旧版语义对齐、不保判定正确（基线本身错则全绿照旧）；判定口径改动必须配正反例成对回归场景（证据续行 / `fill-{}` 花括号 / `fill-*` 通配 / `<主题>`.md 命名示意四类自家通写法） | check-loop.test.mjs 场景 40-47（npm test 随跑） |
| 2026-09-28-claim-exceeds-fix | 结论文档跨文档引用的量化值（台账行数 / advisory 数 / 文档份数）单源定义、取数标明时点；凡写「N 处同步／已全部更正」须附可重跑的取值命令（无命令的「已同步」不算完成）；修复收益措辞须回到事实源重取——用连续量（成本高低）不用离散态（通道关闭），不得沿用立项时目标措辞 | workflow/README.md「结论文档表述纪律」节（2026-09-28 起）；**已机器化**：check-loop 检查 16 对账签名 `\\{{指标名}}` + 登记表 `.agents/metric-claims.txt`（附实时值）。**边界（据实）**：只查显式签名、不全文扫数字（假阳性恒 0，沿 P3 红线），覆盖面取决于是否登记——可选强化、非强制 |
| 2026-09-28-metric-claim-gate | 量化断言机器门须保**假阳性恒 0**：形态收窄为小写点分签名，装户模板占位符（全大写 SCREAMING_CASE，如构建命令 / 看板端口 / 项目名）不得误报；终态文档不扫；无签名零告警；登记表缺失静默跳过；未登记指标与无取数器须 fail-loud（「登记了却没查」是可机器捕获的假阴性） | check-loop.test.mjs 检查 16 八场景（npm test 随跑）；变异自验：去掉形态收窄 → 恰 1 条（全大写不误报）变红 |
| 2026-09-28-adopter-derivers | 装户取数扩展面须**整条链路归 owned**（`.agents/metric-claims.txt` + `.agents/metric-derivers.cjs` 缺一即落 managed → sync 永久漂移 + check-loop 因供应链防线静默停摆）；装户模块**载入/取数失败绝不静默降级**（否则「模块坏了」被伪装成「忘了登记」，装户永远查不到真因）；模块缺失是正常态（零告警）——须与「模块坏」行为可区分；取数器契约为**同步**函数、返回有限数字；`ctx.glob` 的 `**/` 含零层且跨段、`*` 不跨 `/`、剪枝 `node_modules`/`.git`、**按 realpath 防软链接成环** | check-loop.test.mjs 检查 16 装户组 26 场景（npm test 随跑）；`isOwned('.agents/metric-derivers.cjs')` 断言；**真装端到端**（临时 `flow-kit init` → 写模块 → 取数正确 → sync/doctor 零漂移）。变异自验：静默吞掉载入失败 → 恰 2 条变红；移除 realpath 防环 → 成环用例恰 1 条变红 |
| 2026-09-28-adopter-derivers（补测登记，**2026-09-28 追加**） | **软链接成环防环的平台判据**：防环走 `fs.realpathSync` + visited（Node 原生跨平台），**不依赖 `sh`**——故「本机无 `sh`」不构成 POSIX 未验证的理由。用 **`dir` 型 symlink（POSIX 语义的目录软链接）** 实测：取数恰 1、234ms、exit 0、无 hard-block，与 Windows junction（213ms）一致 | check-loop.test.mjs 用例「dir 型 symlink 成环（POSIX 语义）→ 防环生效，计数恰 1」——**断言精确计数 1**（非仅「有限值」），变异自验：移除 visited 防环 → 恰该 1 条变红。**注**：本条结论**不改已关单的 incident/spec**（那会触发 `[确认内容漂移]` hard-block，且破坏「确认指纹＝当时内容」的对质能力）——按用户 2026-09-28 拍板，登记于本活文档 |
| 2026-09-28-adopter-derivers（跨版本登记，**2026-09-28 追加**） | **装户模块必须 `.cjs`（CommonJS），不得 `.mjs`**：引擎用 `require()` 同步载入，而 `require(esm)` 仅 Node ≥20.19 / ≥22.12 可用——**实测 18.20.5 / 20.18.0 / 22.11.0 全部 `ERR_REQUIRE_ESM`**，而 `engines: >=18.0.0`、CI 矩阵跑 18/22，故首版 `.mjs` 契约**在 CI 目标版本上完全不可用**（fail-loud 正常、不崩，但功能不工作）。`.cjs` 在全版本可用且仍同步。**教训：「本机能跑」不只指数组环境（装户），也包括 Node 版本线——本机 v24 掩盖了该缺陷** | 跨版本实跑（真下 node 18.20.5 / 22.11.0 二进制）：`check-loop.test.mjs` **三版本同为 118/1**、check-loop exit 0、装户 `.cjs` 取数 ✅；CI 四道门在 Node 18 全绿。用例「残留旧 `.mjs` → 明示迁移指引」钉住兼容提示 |
| 2026-09-29-check16-inline-debt | 检查 16（及后续新增检查项）**门禁框架与指标子系统分文件**（`check-metric-claims.mjs` 独立演进，ctx 显式注入依赖）；**签名扫描面与取数面同口径 tracked-only**（`docFiles` 单源定义，未跟踪半成品不进扫描也不进取数——`isTracked` 判据为 `ls-tree HEAD`，**「纳入」须 commit 而非仅 add**）；过滤链（.md ∧ 数字前缀 ∧ tracked）全仓仅 `docFiles` 一处，禁再复制；确认门测试逃生门须**双信号**（`CONFIRM_DOC_TEST_TTY` ∧ `NODE_ENV=test`）——单环境变量在 AI 会话内属顺手可绕 | check-loop.test.mjs 场景 91 双向口径用例（未跟踪不出账 / commit 后出账，npm test 随跑）+ confirm-doc.test.mjs S18e（仅设 TTY 变量 → exit 1）；迁移等价门：check-loop 全量输出与迁移前逐字节 diff 为空 |
| 2026-09-28-adopter-derivers（CI 矩阵与 shipped 盲区，**2026-09-28 追加**） | **CI 须同时覆盖 `templates/`（包源）与 `.agents/`（shipped 装副本）两侧套件**：`npm test` 只 glob `templates/**`（见 `src/run-tests.mjs`），而装户实际拿到的是 `.agents/`——**同一份字节、不同路径上下文**，故包源绿 ≠ 装户可用（本单 P1 即由此漏过 CI）。**凡 shipped 产物用相对路径定位资源，必须按「所在位置」探测而非「固定上溯级数」** | `.github/workflows/ci.yml`：矩阵加 `node: 20`（20.19 是 `require(esm)` 分界版本）+ 新增「shipped 套件」步骤逐跑 `.agents/scripts/*.test.mjs`（**20 个套件全绿**）。**该步骤上线即抓出 3 处真实缺陷**：① `doctor.test.mjs` 包源守卫 `exit 1` 被误判为失败（改 SKIP + exit 0）② `workflows-check.test.mjs` S14 真实仓库自扫在装户径恒红（改「环境不适用则 SKIP」）③ **`gen-workflow-metrics.mjs` 硬编码上溯 3 级取枚举 → 在每个装户安装里都解析不到**（改逐级探测） |
- 关单顺序：勾验收补证据后、confirm-doc done 前必须重跑 check-loop（2026-10-03 check-evidence-process：pipeline-run 关单时 verify 跑反顺序致 37b552a 证据无关 hard-block 关单后才暴露）；验收证据引用执行器驱动提交（改动面外）时，该提交信息须带「pipeline-run <runId>」标记方可作过程证据放行（新判据见 check-loop 检查 8）
