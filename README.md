# agentic-flow-kit

AI-Native 闭环工作流 + wiki 知识层脚手架。`flow-kit init` 一条命令为新项目装好整套项目级 AI 工作流引擎：8 个阶段命令、3 个子智能体角色契约、git 门禁钩子（闭环配对 / 敏感信息扫描 / 条件构建 / 规则面预算）、kb 跨语料检索、workflow 实时看板、intents→specs→plans→incidents 文档闭环、wiki 知识库三件套。

**装完即自包含**：引擎文件拷贝进项目（零 npm 运行时依赖，Node ≥ 18 即可跑），clone 后只差 `git config core.hooksPath .githooks`——init 会自动挂好。

## English

agentic-flow-kit installs a self-contained AI workflow into a repository: stage commands, role contracts, git hooks, and an intent → spec → plan → incident trail. After `init`, the project does not need this package at runtime. Node ≥ 18 is enough.

The product is the hook, not another prompt pack. Five rules always block a bad push: paired docs, checked acceptance, a confirmation ledger, secret scanning, and the managed/owned ledger. Other hygiene checks are warnings, and a fresh install sets `audit: false` so only those five stay in the way. Omit `audit` on an older ledger and the full check set stays on.

Hosts: `zcode`, `opencode`, `trae`, `omp`, `claude`, `cursor`, `codex`. Claude Code loads `.claude/commands` and `.claude/agents`. Cursor loads `.cursor/commands`. Codex reads the repo `AGENTS.md` and `.codex/skills/flow-kit`; the `.codex/commands` files are the same thin forwards for explicit reference.

```bash
npx agentic-flow-kit init --stack node --hosts claude,cursor
npx agentic-flow-kit doctor
```

## 60 秒路径

```bash
npx agentic-flow-kit init --stack node --hosts claude
# 按 .agents/commands/plan.md 写一份 L1 intent 与同名 plan（状态先保持 draft）
node .agents/scripts/confirm-doc.mjs workflow/intents/<文件>.md   # 终端里键入「可以」
# 改代码，git add，然后提交。配对没齐、验收没勾、确认指纹对不上，钩子会拒绝这次提交。
```

## 五条硬规则

新装的 `kit.json` 写 `audit: false` 与 `policyVersion: 2`：check-loop 只阻断配对、验收勾验、确认留痕，外加发版提交树上仍未收口的文档。敏感信息在 pre-commit，双源和台账在 doctor / sync。`audit` 缺省（升级来的旧台账）保持全量卫生警告；自己装一份 dogfood 时可显式置 `audit: true`。豁免日期只在 `.agents/scripts/policy.mjs` 的 `policyVersion` 表里改。

可选红线用 `add-gate`：`dotnet-ca`、`node-layer`、`py-import`、`generated-readonly`。约定见 `modules/gates/README.md`。

**关于「确认门」的诚实边界**：确认门是**留痕机制，不是防伪机制**。`confirm-doc.mjs` 把确认事件写进 `.agents/confirmations.jsonl`（append-only，入 git），check-loop 据此对账——但台账是本地可写文件，**刻意手改台账仍可伪造**。门禁的实际作用是把「顺手绕过」抬到「主动伪造」（两者性质不同、可事后对质），而非关闭通道。引擎注释对此有完整声明（见包源 `templates/_agents/scripts/stage-gates.mjs` 头部信任边界段；装户径同份在 `.agents/scripts/stage-gates.mjs`）。委托代录（`--delegated`）的台账行如实记 `source` 与用户原话供事后对质，永不伪装 TTY 确认。

## 快速开始

```bash
cd <你的项目根>
npx agentic-flow-kit init                        # 交互模式：宿主 → 技术栈 → 端口 → 显式确认安装
# 或直接给参数
npx agentic-flow-kit init --stack node --hosts zcode,opencode

# 体检（布局 / git 钩子 / managed 台账 / 索引漂移 / check-loop）
npx agentic-flow-kit doctor

# 包出新版后升级（未改动→覆盖；本地已改→跳过并报告，--force 才覆盖；owned 永不触碰）
npx agentic-flow-kit sync

# 后补宿主 / 装门禁（dotnet-ca：Clean Architecture 红线守卫，装后归项目）
npx agentic-flow-kit add-host opencode
npx agentic-flow-kit add-gate dotnet-ca
```

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
.agents/            阶段命令×8 / 角色契约×3 / 门禁钩子 / 引擎脚本（检索·索引·看板·预算·聚合）/ 技能×2 / settings.json / kit.json 台账
.githooks/          pre-commit（通用门禁编排+项目门禁挂载点）/ pre-push（闭环断档）/ commit-msg / post-commit / pre-merge-commit
workflow/           intents/specs/plans/incidents 模板×4 + README 协议 + 台账三件（delegations/papercuts/regression-checklist）
wiki/               INDEX 骨架 + 知识沉淀总览 + drafts-archive
AGENTS.md           项目规范骨架（项目段占位待填）
modules/gates/      可选门禁模块（dotnet-ca：Clean Architecture 参考实现，装进项目后归项目）
```

**两态文件模型**：`.agents/kit.json` 记录 managed（引擎件，随包升级）与 owned（项目内容，永不覆盖）清单及 sha256；`doctor` 会校验漂移。已存在的文件 init 保守跳过（`--force` 覆盖）。

**升级语义（sync）**：managed 文件三方比对（台账 sha / 磁盘 sha / 新版渲染 sha）——未改动 → 直接覆盖新版；本地已改 → 跳过并报告（`--force` 才覆盖，git diff 自查差异；跳过件的台账保持包侧基线，后续每次 sync 持续报告，不会在下次升级被静默覆盖——消除报告的办法：`--force` 覆盖，或把本地内容改回与新版一致）；改动恰好等于新版 → 视为已最新。包内新增文件自动安装；包内已删文件仅报告不删盘；缺失的 managed 文件自动恢复。INDEX / wiki 看板等生成器目标不比对 sha，收尾重跑生成器走锚点重写。门禁模块（add-gate 装入）归项目所有，sync 永不覆盖。add-host 对已存在的宿主文件保守跳过且不入台账——后续 sync 不升级（仅报告「已存在未入台账」），要纳入包管理用 `--force` 覆盖。owned 件归项目所有、sync 永不覆盖；其台账哈希仅记账不约束，sync 每次按盘面自愈刷新（手改后无须手工对账），add-gate 接线 local-pre-commit 后同步刷新其记账。

## 设计原则

- **权威单源**：角色行为只在 `.agents/roles/`，流程只在 `.agents/commands/`，宿主适配层是纯转发薄层——换宿主不换流程。
- **门禁即 git 钩子**：不依赖任何 agent 客户端自觉；项目专属门禁挂 `.agents/hooks/local-pre-commit`。
- **中文优先**：文档协议、命令、检查输出全中文；frontmatter 受限子集供机器断言。
- 抽取自真实项目长期运转的引擎（某真实项目），dogfooding 是后续路线（sync 升级 / add-host / add-gate / npm 发布）的一部分。
- **威胁模型（2026-09-27 init-p1-batch）**：勿在不可信仓库运行 `init` / `doctor` / `sync`——三命令在执行目标侧 `.agents/scripts/` 脚本（生成器 / 校验器）前有供应链防线：脚本内容与包源渲染值（LF 归一 sha）一致才执行，失配即显式跳过提示，不执行不下结论。**防线不覆盖 git 钩子面**：预植的 `.githooks/`、`.agents/hooks/` 仍会被保留挂载，并在你自己的首次 git 操作时执行——不可信仓库请先审查/清除预置件再 init。

## 当前能力

**能力清单的单一真相源是 `CHANGELOG.md`**——每个已发布版本带什么、为什么这么带，都在那里。本节只讲当前语义，不重复枚举版本特性（此前列举导致 README 与实际发布内容长期漂移，2026-10-08 已收敛到单源）。

当前语义三点：

- **门禁面**：check-loop 20 项检查 + `.githooks/` 五个钩子（pre-commit / pre-push / commit-msg / post-commit / pre-merge-commit），门禁逻辑不依赖 agent 客户端自觉。
- **闭环面**：intents → specs → plans → incidents 四态文档链 + 确认台账（`.agents/confirmations.jsonl`）+ 逐阶段前置门（起草门 / 确认门 / done 前置门）。
- **观测面**：`workflow/INDEX.md`（检索索引）、`workflow/DASHBOARD.md`（红绿灯仪表盘）、`workflow/metrics.md`（月度快照）——**观测面非门禁**，红灯是「看」的不是「拦」的。

版本号与已发布能力看 `package.json` 的 `version` 与 `CHANGELOG.md`；仓库当前工作流实况看 `workflow/INDEX.md`。
