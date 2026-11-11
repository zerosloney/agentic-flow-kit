# New Task · 闭环总入口

> **⛔ 顺序**：先定级 → 先落三件套 → 逐份确认 → 才写代码。禁「先改后补档」（= 绕过确认门；违者双落 incident+papercuts）。细则与强度说明：`.agents/notes/process-order-rule.md`。

## 1. 风险定级 (Step 0: 先定级再路由)

| 泳道 | 级别 | 判据 | 确认与审计口径 |
|---|---|---|---|
| **协作道** | **L1** 实现级 | 未命中 L2/L3 的实现级改动 | 一份 plan 即入口（来源 / 目标 / 红线 / 改动 / 验证 / 验收）。不另立 intent。独立复核不设同步前置；`--batch` 仅 L1 |
| **防御道** | **L2** 规则/契约 | 见 §L2 触达面闭集 | 同步确认门：spec 确认 $\rightarrow$ plan 确认 $\rightarrow$ 动手 |
| | **L3** 数据/运行时结构 | schema / 迁移 SQL / DI 链 / 认证与中间件管线 | 同 L2 + spec 新会话独立复核，未确认不放行 |

> **两问定级**：结构面（schema / 迁移 SQL / DI / 认证管线）→ L3；契约或共享口径 → L2；两者都没有 → L1。不要按严重程度从 L1 往上滑。
> **提问分型**：能跑出来/查出来的（行为/时序/布局/输出/存量/eval 可区分）先原型/查库/跑 eval，禁停下来问；只有产品/偏好判断才升级确认。与 STOP 线正交（可实验不豁免红线）。
> **落位**: L1 写在 plan frontmatter `级别`；L2/L3 写在 intent。
> **判低拦截**: L1 plan 或 intent 勾触达红线 → check-loop「红线判低」hard 拦 → 升到 L2/L3 并补同名 spec。

### L2 触达面 (闭集，命中任一即 L2)

| # | 类别 | 判据 |
|---|---|---|
| 1 | **编码权威** | 一处生成、多处消费的编码/命名/取号规则 |
| 2 | **共享契约** | 跨模块共享的基类 / DTO 形状 / 公共接口签名 |
| 3 | **既有接口语义** | 既有参数或端点的行为变化（失效变生效、默认值/钳制口径改变） |
| 4 | **全局横切口径** | 错误响应出口、分页与校验口径、聚合投影键 |

> **负例 (落 L1)**: 纯页面表现/文案/布局/交互实现；纯新增端点或参数且行为不变；单模块内部重构且无对外契约变化；纯新增页面/路由且无共享契约；单模块内部组件拆分；模块内新增类型/常量且不跨模块消费。
> **自查句**: 能否列出 $\ge 2$ 个实际行为受影响的消费方（模块/端点/页面；仅签名可见、行为不变不算）？能 $\rightarrow$ L2。
> **默认档**: 红线全不勾即 L1。判级只回答「是否命中 L2 四类或 L3 结构面」。

## 1b. todo 播种

定级后、动手前，把所选命令的步骤标题**逐字复制**到 todo 列表首项；不另写摘要。跳过的步骤保留在列表里并写 `skip: <理由>`。todo 是执行契约，命令文件是 playbook——本页不复制步骤正文（单源）。

## 1c. 阶段联动协议（进入即装载 + 自动衔接）

- **进入即装载**：进入任一阶段指令时，先读该阶段绑定技能的 SKILL.md（正文单源在技能侧，本表只放指针）：

| 阶段 | 进入即装载 |
|---|---|
| Plan（intent） | `grilling`（追问压实背景/目标/非目标） |
| Design（spec） | `grilling`（歧义清单 / 方案压力测试）；按需 `codebase-design` / `domain-modeling`；分叉比选 `arena`；必读输入见 `stages.md` Design §2 |
| Build | 无强制技能（实现委派走 `implementer` 角色） |
| Test | 涉前端改动 `verify-ui`；L2/L3 独立复核 `review-method` |
| Deploy | 无（走清单与上线授权门） |
| Maintain | `why`（根因证据链） |
| Review（横切） | `review-method`；高风险 diff `interrogate`；影响面 `blast-radius` |

- **自动衔接**：阶段完成（确认门通过 + 留痕提交入库）后**自动进入 frontmatter `next` 指向的下一阶段指令**，不等用户催促。
- **人件门不自动越过**：自动流转仅指阶段衔接与技能装载——每阶段的 HALT 确认、pipeline-run 的 `await-confirm`、上线授权（deploy 的「上」）到点即停，等用户放行原话。

## L0 极简道

判据（全机器可判）：产品面 ≤5 文件；未命中 §1 L2 闭集/L3 结构面；非数据维护 SQL 执行；不新增依赖/构建步骤（引擎/wiki 面本就豁免）。
判据重叠取 L0。
流程：定级 → 改码 → `node .agents/scripts/verify.mjs --face`/`--scope` 绿 → 单笔 commit；消息体含一行 `L0: <判据>`（机器可 grep）。

## L1 快速道

命中 L2 或 L3 就离开本页。L1 做到下面 6 步为止，不打开 `stages.md`。

> **接手/恢复**：先读 `.agents/skills/session-resume/SKILL.md` 重建当前态，再走下面 6 步。

1. **定级**：用 §1 两问和 L2 闭集。未命中即 L1，`级别` 写在 plan frontmatter。完成标准：plan 头里的级别与两问结论一致。
2. **检索**：`node .agents/scripts/kb-search.mjs --scope workflow --module <token> "<关键词>"`。命中的 incident 根因写进下一步 plan 的自查。完成标准：命令跑过；命中根因备写进 plan，无命中粘贴脚本输出即可（免另写说明）。命中同功能 spec / features $\rightarrow$ 按 `workflow/README.md`「同功能续作」改原件不新建。
3. **立 plan**：`node .agents/scripts/fill-plan.mjs --level L1 --topic <主题> --output workflow/plans/<YYYY-MM-DD>-<主题>.md`。可加 `--lite`（三节：入口 / 改动方案 / 验证与验收；条件：第 2 步检索无 incident 命中且红线全不勾），缺省仍为五节。填实入口（来源、目标、红线）、改动方案、约束与风险、验证计划、验收标准，并把第 2 步的检索结果写进自查。frontmatter `模块` 改成主导模块。不写 intent，不写预判字段。完成标准：所选模板各节有正文（五节或 lite 三节）、检索结论已入 plan；验收写不出可测试判据就停；红线要么勾中升 L2/L3，要么明确不勾。
4. **确认后动手**：`node .agents/scripts/confirm-doc.mjs <plan> --delegated "<用户原话>"` 把 draft 收到 approved（确认门口径单源：逐件调用禁并录、逐件原话禁复用、逐跳迁移禁单跳），然后再改代码。只改 plan 列出的文件。四条红线：不提交密钥或 `.env`、不用 `--no-verify`、最小改动、偏离 plan 先停。**承诺面锁定**：approved 之后改「承诺面」（验收判据文本 / 红线 / 目标 / 改动方案）须先让用户重新点头并重录承诺面指纹——重确认口令见 `workflow/README.md`「承诺面绑定」；否则关单被拒、推送被检查 15 hard 拦（勾验收 + 证据回填不算改承诺）。改完不单独提交：验证（第 5 步）绿后按第 6 步连跳 done 并与代码同笔提交。改码前开 /tour 全景，每批刷新（skills/dev-tour）。完成标准：改动留在工作区，plan 仍是 approved。
5. **验证**：`node .agents/scripts/verify.mjs --scope`（口径见头注）。有前端改动再打开 `.agents/skills/verify-ui/SKILL.md`。失败就改代码，不在本页改门禁。完成标准：命令退出码 0，前端改动另有实测证据。
6. **关单＝单笔提交**：`node .agents/scripts/confirm-doc.mjs <plan> --delegated "<用户原话>"` 连续再跳一次把 approved 收到 done，随后单笔提交——plan(done) + 代码 + 确认分片 + verify 凭证同一笔入库，L1 无独立关单提交。仅 plan 独立关单场景（代码已在前笔入库）才打开 `.agents/skills/shipyard-workflow-closeout/SKILL.md`。完成标准：plan 为 done，单笔提交已入库。

下面才打开别的文件：委派 implementer → `stages.md` Build §3；改了库连接 → `stages.md` Test §2；全量首跑红、隔离重跑转绿 → `stages.md` Test §1；L2/L3 独立复核 → `stages.md` Test §4。

## 2. 级别子路由（纯指针）

任务类型路由**单源** = 根 `AGENTS.md` §4。修复类按级别分流**单源** = `.agents/commands/maintain.md` §3（L1 立档后回本页 §L1 快速道；L2/L3 走 `stages.md` Design → Build → Test 章；根因属门禁/规范缺位另立同名 intent）。

## 3. intent 豁免规则

| 场景 | 判据 | 处理 |
|---|---|---|
| **AI-Native 引擎面** | 根 `AGENTS.md` §4 引擎面豁免口径 | 豁免三件套（intent/spec/plan 与确认门），Conventional Commits 直接 commit；触及业务代码的部分按其级别走 |
| **wiki 文档调整** | 根 `AGENTS.md` §4「wiki 豁免」 | 豁免三件套（intent/spec/plan 与确认门），`docs(wiki)` 直接 commit；数据维护 SQL 执行与业务代码不豁免 |
| **bootstrap 类改动** | 引入规则本身 | 豁免 intent，commit message 显式声明 `bootstrap` |

## 4. 闭环兜底

- **门禁清单**: 以 `.githooks/` / `.agents/hooks/` / `.agents/scripts/check-loop.mjs` 头部注释为准（本文不复述）。
- **hard-block**: 清单单源 = check-loop 头注；配对断裂与回路断档已降 WARN，自查走 closeout skill §0。
- **禁令**: 本地钩子是本地机器门，禁 `--no-verify`（见根 `AGENTS.md`）。
