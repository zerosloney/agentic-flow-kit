# agentic-flow-kit

AI-Native 闭环工作流 + wiki 知识层脚手架。`flow-kit init` 一条命令为新项目装好整套项目级 AI 工作流引擎：8 个阶段命令、3 个子智能体角色契约、git 门禁钩子（闭环配对 / 敏感信息扫描 / 条件构建 / 规则面预算）、kb 跨语料检索、workflow 实时看板、intents→specs→plans→incidents 文档闭环、wiki 知识库三件套、**多人/多 worktree 台账并发治理**（并集合并 / 分片归并 / 特许修剪）。

**装完本地可跑**：日常闭环（门禁钩子 / check-loop / fill-* / confirm-doc / kb 检索 / 看板）走项目内 `.agents/scripts/`，零 npm 运行时依赖，Node ≥ 18 即可跑；升级 / 体检 / 装门禁（`sync` / `doctor` / `add-host` / `add-gate`）走 `npx agentic-flow-kit`。clone 后只差 `git config core.hooksPath .githooks`——init 会自动挂好。

## English

agentic-flow-kit installs a project-level AI workflow into a repository: stage commands, role contracts, git hooks, and an intent → spec → plan → incident trail. After `init`, day-to-day loop work (hooks, check-loop, confirm-doc, retrieval) runs from the in-repo `.agents/scripts/` with zero npm runtime dependencies; Node ≥ 18 is enough. Lifecycle operations — `sync` / `doctor` / `add-host` / `add-gate` — go through `npx agentic-flow-kit`.

The product is the hook, not another prompt pack. Five blocking surfaces, split across tools: check-loop blocks unpaired docs, unchecked acceptance criteria, missing confirmation trace, and release-time unclosed docs; secret scanning sits in pre-commit; the managed/owned ledger and dual-source drift are checked by `doctor` / `sync`, not by the push gate. Other hygiene checks are warnings, and a fresh install sets `audit: false` so only the blocking set stays in the way. Omit `audit` on an older ledger and the full check set stays on. The Chinese section above is the single source of truth for this split.

Hosts: `zcode`, `opencode`, `trae`, `omp`, `claude`, `cursor`, `codex`. Claude Code loads `.claude/commands` and `.claude/agents`. Cursor loads `.cursor/commands`. Codex reads the repo `AGENTS.md` and `.codex/skills/flow-kit`; the `.codex/commands` files are the same thin forwards for explicit reference.

```bash
npx agentic-flow-kit init --stack node --hosts claude,cursor
npx agentic-flow-kit doctor
```

## 60 秒路径

```bash
npx agentic-flow-kit init --stack node --hosts claude
git add -A && git commit -m "feat: bootstrap——安装 agentic-flow-kit 工作流引擎"   # 先入库装户产物：此刻无活跃入口，泳道门仅 advisory
# 按 .agents/commands/plan.md 写一份 L1 intent 与同名 plan（状态先保持 draft）
node .agents/scripts/confirm-doc.mjs workflow/intents/<文件>.md   # 终端里键入「可以」
# 改代码，git add，然后提交。配对没齐、验收没勾、确认指纹对不上，钩子会拒绝这次提交。
```

## 五条硬规则

新装的 `kit.json` 写 `audit: false` 与 `policyVersion: 12`（v1–v12 全锚，新装空台账零回溯负担）：check-loop 只阻断配对、验收勾验、确认留痕，外加发版提交树上仍未收口的文档。敏感信息在 pre-commit，双源和台账在 doctor / sync。`audit` 缺省（升级来的旧台账）保持全量卫生警告；自己装一份 dogfood 时可显式置 `audit: true`。豁免日期只在 `.agents/scripts/policy.mjs` 的 `policyVersion` 表里改（当前生效规则的可读视图在 `workflow/effective-policy.md`，policy 变更后重生成并随同提交）。

可选红线用 `add-gate`：`dotnet-ca`、`node-layer`、`py-import`、`generated-readonly`、`test-protect`。约定见 `modules/gates/README.md`。

**门禁信任档**（`.agents/kit.json` 的 `gateTrust`）：默认 `project` —— gate 安装锚失配只 WARN（装户对门有最终所有权，锚只提供可见性）。多仓或组织场景改成 `org`，失配即 `doctor` FAIL（exit 1），对齐托管策略的组织级强制。缺键或非法值一律回退 `project`，不会因写错而变严。

**待澄清标记**：起草 intent / spec / plan 时不确定的地方照实写一行 `- 待澄清：<你卡在哪>`，不要猜——「我不知道」是负责，猜是失职（与检查 2 的模板占位符语义相反：占位符是忘了填）。起草门不拦（零阻塞），但 `draft→approved` 确认时仍挂着未澄清项会被 `confirm-doc` 拒绝落账（2026-10-18 立项跳对称化起 intents 同口径挂门——intent 是后链全部文档的种子；存量无标记零回溯）。解决后把行首改成 `- 已澄清：`（保留行，留痕曾不清楚过）或删行。

**关于「确认门」的诚实边界**：确认门是**留痕机制，不是防伪机制**。`confirm-doc.mjs` 把确认事件写进 `.agents/confirmations.jsonl`（append-only，入 git），check-loop 据此对账——但台账是本地可写文件，**刻意手改台账仍可伪造**。门禁的实际作用是把「顺手绕过」抬到「主动伪造」（两者性质不同、可事后对质），而非关闭通道。引擎注释对此有完整声明（见包源 `templates/_agents/scripts/stage-gates.mjs` 头部信任边界段；装户径同份在 `.agents/scripts/stage-gates.mjs`）。委托代录（`--delegated`）的台账行如实记 `source` 与用户原话供事后对质，永不伪装 TTY 确认。

**台账并发（三形态，2026-10-12）**：台账是尾部追加形态，天然撞三种**正常协作**。引擎对每种各有机制，且一律按「正常协作不报红、篡改照拦」设计——门禁若因正常协作持续 hard 拦，唯一出路就是 `--no-verify`，那等于门禁自己废掉自己。

| 形态 | 机制 |
|---|---|
| 多人/多分支合并冲突 | `.gitattributes` 的 `merge=jsonl-union` → 并集去重，两侧行全保留、无冲突可解（此前人工解的常见错法是「整取一侧」——静默丢掉另一侧的确认行） |
| 单机多 worktree 并行 append | 确认行**默认**写分片 `.agents/confirmations.d/<doc>.jsonl`（2026-10-13 ledger-shard-default），各写各的；`--no-shard` / `CONFIRM_SHARDED=0` 回退主台账；里程碑可选跑 `compact-ledgers.mjs --execute` 并回主台账 |
| 所有者明令删某批文档 | **特许修剪**：同笔提交 `.agents/ledger-prune-manifest.json`（逐行 sha256 + 授权 + 理由），门禁逐行对账放行；无 manifest 的删/改/重排仍全拦 |

哈希链的域是「**同一 doc 的逻辑序**」而非文件物理序（生效日锚，缺键回退旧口径，存量零变化），因此上面三种协作都不打断它；就地改行、删行、插行三类篡改照拦。诚实边界：manifest 是可写文件，**刻意伪造即可让任意删行合法化**——与「台账本地可写」同级，本通道只把「顺手手改」抬到「提交一份可被 git 历史对质的凭据」。

> **存量装户迁移动作（升级后必做）**：`merge=jsonl-union` 属 `.gitattributes`，而该文件是**项目自持（owned）**、`sync` 永不覆盖——升级后**不会自动获得**。需手动在目标仓 `.gitattributes` 补一行 `.agents/*.jsonl merge=jsonl-union`。driver 是本机态配置、不跨机共享，`init` 会自动配；漏配则退化为文本冲突（**不静默丢数据，但需人工解**）。

> **存量装户迁移指引（级别 L0 退役，`level.all` 收敛为 `L1 L2 L3`）**：升级前已按 L0 定级的存量文档，`sync` 升级后把 frontmatter `级别: L0` 改为 `L1`，或在行首加 `流程: legacy`（存量豁免通路，跳过级别/配对检查）——不改会被 incident 级别枚举校验出 WARN「级别缺失」，且 `--batch` / `--auto` 自治门按 suspect 拒（fail-closed）。

> **存量装户迁移指引（policyVersion 升 12 + 生效规则视图）**：`kit.json` 属项目自持（owned）、`sync` 永不覆盖——`policyVersion` 升 12 由装户自选时机（v12 全锚生效日 = 发布当日 advisory 档 / 发布次日 hard 档，锚前存量不追溯）。升级后跑一次 `node .agents/scripts/gen-effective-policy.mjs` 把生成的 `workflow/effective-policy.md` 随同提交：该文件是生效规则的入库视图，`verify` 的 effective-policy 门对缺文件判漂移（新装由 init 首跑种子；存量不补跑则该门红一次，补跑即绿）。

## 快速开始

```bash
cd <你的项目根>
npx agentic-flow-kit init                        # 交互模式：宿主 → 技术栈 → 端口 → 显式确认安装
# 或直接给参数
npx agentic-flow-kit init --stack node --hosts zcode,opencode

# 体检（布局 / git 钩子 / managed 台账 / 索引漂移 / check-loop）
npx agentic-flow-kit doctor

# 只读校验（包内置 check-loop 引擎跑闭环结构检查；--strict 把 advisory 也判红，--json 机器可读）
npx agentic-flow-kit validate

# 包出新版后升级（未改动→覆盖；本地已改→跳过并报告，--force 才覆盖；owned 永不触碰）
npx agentic-flow-kit sync

# 后补宿主 / 装门禁（dotnet-ca：Clean Architecture 红线守卫，装后归项目）
npx agentic-flow-kit add-host opencode
npx agentic-flow-kit add-gate dotnet-ca
```

## 执行面：route（手动路由）+ run（自动流水线）

装完之后，CLI 不止管装，还管跑。**md 指令与 md 子代理仍装在装户项目里**（`.agents/commands/`、`.agents/roles/`），宿主读它们；执行代码也留在装户 `.agents/scripts/`，包只做**薄壳转发与判定面**——不复制、不改写、不解释装户的正文。

```bash
# 手动路由的机器面：定级 + 判据清单 + 泳道 + 下一阶段 + 该读哪个 md
npx agentic-flow-kit route --kind require --level L1 --files "src/a.ts,src/b.ts"
npx agentic-flow-kit route --files "src/db/migrations/001_init.sql" --json   # 机读面

# 自动流水线：薄壳转发装户 pipeline-run 状态机（参数与退出码原样透传）
npx agentic-flow-kit run start "给导入功能加审计字段"
npx agentic-flow-kit run next --delegated "可以"
```

| 命令 | 干什么 | 谁是单源 |
|------|--------|----------|
| `route` | 按改动文件给出建议档位、判据清单、泳道（协作道 / 防御道）、`kind` 对应的入口 md | 判据 = `.agents/scripts/level-criteria.mjs`；泳道 = `.agents/scripts/stage-gates.mjs` 的 `laneOfDoc` |
| `run` | `start` / `next` / `status` / `watch` / `abort` 五个子命令原样转发 | 状态机 = `.agents/scripts/pipeline-run.mjs`；驱动协议 = `.agents/commands/pipeline-run.md` |

**诚实边界（重要）**：级别是**意图面**的语义判定（「一处定义、多处消费」），机器判不了语义。机器只兜两件它真能兜的事——**就高不就低**（混档取高）与**路径下限**。路径下限登记在 `.agents/level-hints.txt`（装户自持、内容项目私有、`sync` 永不覆盖、**默认空**）；未配置时 `route` 按 L1 起步并提示补配置，**绝不假装判得出**。该清单写错会直接报错退出——写错配置比没配置危险：没配置会提示，写错会误判。

定级纪律最终仍由 lane-surface 触达面门在**提交面**兜底：`route` 漏判语义，钩子照样拦。


| 选项 | 说明 |
|------|------|
| `--stack` | `dotnet` / `node` / `python` / `go` / `none`（默认 none）——**门禁配置三处**：commit-check 条件编译检查（暂存对应扩展名时 commit 前自动构建）+ **质量检测**（`checks`：lint / 类型检查 / vet 等秒级确定性检查，存在对应配置文件（tsconfig / eslint / ruff / go.mod 等）才启用，没有则自动跳过；测试不放提交门——关单在 test.md 阶段门）、settings.json 自检验命令权限、AGENTS.md「项目适配区」命令预填 |
| `--hosts` | `zcode` / `opencode` / `trae` / `omp` / `claude` / `cursor` / `codex` 逗号多选（默认 zcode）。七个宿主一律入库（2026-10-05 起 zcode/omp 撤销 localOnly——换宿主不丢文件、CI 克隆面与本仓一致）；zcode 的会话级液态草稿（`.zcode/drafts/`、`.zcode/plans/`）是本机态、不该入库——init 不再自动写这条规则，请自行加进 `.gitignore`（本仓实例见根 `.gitignore`）。Claude Code 加载 `.claude/commands` 与 `.claude/agents`；Cursor 加载 `.cursor/commands`；Codex 读仓库根 `AGENTS.md` 与 `.codex/skills/`，`.codex/commands` 是同形薄转发 |
| `--board-port` | workflow 看板端口（默认 8933） |
| `--dir` | 目标项目根（默认当前目录） |
| `--force` | 覆盖已存在的同名文件（默认保守跳过） |

init 不问项目名 / 描述：`AGENTS.md` 只生成「AI工作流 + Wiki」两章骨架 + 「项目适配区」；技术栈经 `--stack` 传入只用于门禁配置（编译检查与自检验命令初值），密钥白名单等其余细节在 `.agents/hooks/commit-check.config.json` 里按项目填。

## 装了什么

```
.agents/            阶段命令×8 / 角色契约×3 / 门禁钩子 / 引擎脚本（检索·索引·看板·预算·聚合·判定流水）/ 技能×3 / settings.json / kit.json 台账
                    + level-criteria.mjs（级别判据机器单源）/ level-hints.txt（项目自持的路径下限清单，默认空）
.githooks/          pre-commit（通用门禁编排+项目门禁挂载点）/ pre-push（闭环断档）/ commit-msg / post-commit / pre-merge-commit
workflow/           intents/specs/plans/incidents 模板×4 + README 协议 + 台账三件（delegations/papercuts/regression-checklist）
wiki/               INDEX 骨架 + 知识沉淀总览 + drafts-archive
AGENTS.md           项目规范骨架（项目段占位待填）
modules/gates/      可选门禁模块（dotnet-ca：Clean Architecture 参考实现，装进项目后归项目）
```

**两态文件模型**：`.agents/kit.json` 记录 managed（引擎件，随包升级）与 owned（项目内容，永不覆盖）清单及 sha256；`doctor` 会校验漂移。已存在的文件 init 保守跳过（`--force` 覆盖）。

## CI 远端门与离线安装

**CI 远端门**：init 已把 `.github/workflows/kit-ci.yml` 写进装户仓（GitHub Actions：checkout 后复跑统一入口 `node .agents/scripts/verify.mjs`——七门 GATES 编排：语法自检 / 测试【有根 package.json 才跑】/ 编排脚本检查 / 常驻面预算 / 生效规则视图漂移 / check-loop 闭环硬门 / 台账不变量历史全扫，逐门 pass/fail、任一门红即红；门清单见 `node .agents/scripts/verify.mjs --list`）。本地 git 钩子可被 `--no-verify` 绕过，远端门兜底；该文件归装户自持（owned），`flow-kit sync` 永不覆盖，非 GitHub 装户可删。其他 CI（GitLab / Jenkins / Azure DevOps…）等价接入 = 同一入口命令 + 服务端分支策略：

```bash
node .agents/scripts/verify.mjs                    # 远端门本体（工程在子目录时加 --test-cmd "<项目测试命令>"）
npx agentic-flow-kit validate --strict --json      # 可选加一道：包内置引擎只读结构校验（warning 也判红，stdout 机器可读）
```

真正的「门」在服务端分支保护（Settings → Branches：要求 PR + 状态检查绿才可合并）——该配置带不进仓库文件，一次性人工动作，机器不校验。

**离线 / 内网安装**：本包零运行时依赖（package.json 无 `dependencies`），tarball 自包含，离线装机不拖依赖树：

```bash
# 外网机取包（或从 npm 镜像站直接下载 tgz）
npm pack agentic-flow-kit@<版本>                   # 产出 agentic-flow-kit-<版本>.tgz

# 内网机安装（二选一）
npm install -g ./agentic-flow-kit-<版本>.tgz       # 全局：之后直接用 flow-kit 命令
npm install ./agentic-flow-kit-<版本>.tgz          # 项目内：之后用 npx flow-kit init

# 批量内网：tgz publish 进内网 registry（verdaccio / nexus…），之后照常 npx agentic-flow-kit init
```

`npx <tgz 路径>` 直跑不经安装在部分 npm 版本有子进程 stdio 不回显的问题（实测 exit 0 但无输出），离线场景请走上述安装后调用。

**升级语义（sync）**：managed 文件三方比对（台账 sha / 磁盘 sha / 新版渲染 sha）——未改动 → 直接覆盖新版；本地已改 → 跳过并报告（`--force` 才覆盖，git diff 自查差异；跳过件的台账保持包侧基线，后续每次 sync 持续报告，不会在下次升级被静默覆盖——消除报告的办法：`--force` 覆盖，或把本地内容改回与新版一致）；改动恰好等于新版 → 视为已最新。包内新增文件自动安装；包内已删文件仅报告不删盘；缺失的 managed 文件自动恢复。INDEX / wiki 看板等生成器目标不比对 sha，收尾重跑生成器走锚点重写。门禁模块（add-gate 装入）归项目所有，sync 永不覆盖。add-host 对已存在的宿主文件保守跳过且不入台账——后续 sync 不升级（仅报告「已存在未入台账」），要纳入包管理用 `--force` 覆盖。owned 件归项目所有、sync 永不覆盖；其台账哈希仅记账不约束，sync 每次按盘面自愈刷新（手改后无须手工对账），add-gate 接线 local-pre-commit 后同步刷新其记账。

## 设计原则

- **权威单源**：角色行为只在 `.agents/roles/`，流程只在 `.agents/commands/`，宿主适配层是纯转发薄层——换宿主不换流程。
- **门禁即 git 钩子**：不依赖任何 agent 客户端自觉；项目专属门禁挂 `.agents/hooks/local-pre-commit`。
- **中文优先**：文档协议、命令、检查输出全中文；frontmatter 受限子集供机器断言。
- 抽取自真实项目长期运转的引擎（某真实项目），dogfooding 是后续路线（sync 升级 / add-host / add-gate / npm 发布）的一部分。
- **威胁模型（2026-09-27 init-p1-batch）**：勿在不可信仓库运行 `init` / `doctor` / `sync`——三命令在执行目标侧 `.agents/scripts/` 脚本（生成器 / 校验器）前有供应链防线：脚本内容与包源渲染值（LF 归一 sha）一致才执行，失配即显式跳过提示，不执行不下结论。**防线不覆盖 git 钩子面**：预植的 `.githooks/`、`.agents/hooks/` 仍会被保留挂载，并在你自己的首次 git 操作时执行——不可信仓库请先审查/清除预置件再 init。

## 当前能力

**能力清单的单一真相源是 `CHANGELOG.md`**——每个已发布版本带什么、为什么这么带，都在那里。本节只讲当前语义，不重复枚举版本特性（此前列举导致 README 与实际发布内容长期漂移，2026-10-08 已收敛到单源）。

当前语义四点：

- **门禁面**：check-loop 26 项检查 + 3x（分道：默认硬门 / `--hygiene` 卫生段 / `--all`，权威清单见引擎头部）+ `.githooks/` 五个钩子（pre-commit / pre-push / commit-msg / post-commit / pre-merge-commit），门禁逻辑不依赖 agent 客户端自觉。
- **闭环面**：intents → specs → plans → incidents 四态文档链 + 确认台账（`.agents/confirmations.jsonl` 及默认分片）+ 逐阶段前置门（起草门 / 确认门 / done 前置门）+ **台账并发三形态**（并集合并 / 分片写入与 compact 归并 / 特许修剪）与按 doc 逻辑序的哈希链（见上文「台账并发」段）+ 终态件同名家族滚动归档（关单即归档，kb 检索覆盖归档件）。
- **观测面**：`workflow/INDEX.md`（检索索引）、`workflow/DASHBOARD.md`（红绿灯仪表盘）、`workflow/metrics.md`（月度快照）、`workflow/effective-policy.md`（生效规则视图）与判定流水 `.agents/judgments.jsonl`（机制月度对账数据底座）——**观测面非门禁**，红灯是「看」的不是「拦」的。
- **执行面**：`route`（手动路由的机器面：定级 + 泳道 + 下一阶段 + 入口 md）与 `run`（自动流水线薄壳转发装户状态机）；判据单源在装户 `.agents/scripts/level-criteria.mjs`，md 改为引用它而非承载判据散文（见上文「执行面」段）。

版本号与已发布能力看 `package.json` 的 `version` 与 `CHANGELOG.md`；仓库当前工作流实况看 `workflow/INDEX.md`。
