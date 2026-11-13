---
description: L2/L3 阶段流(四并一):Plan 立 intent → Design 起 spec → Build 起 plan + 实现代码 → Test 静态门 + UI 实测 + 复核 + 关单;L1 走 new-task.md 快速道
stage:
  - Plan
  - Design
  - Build
  - Test
triggers:
  - "起个 intent"
  - "立 intent"
  - "起个 spec"
  - "接着起 spec"
  - "intent 看过了"
  - "spec 走一下"
  - "起个 plan"
  - "spec 没问题"
  - "开始写吧"
  - "动手吧"
  - "计划可以了"
  - "跑下 verify"
  - "改完了"
  - "跑下 verify 看看"
  - "验证一下"
delegation:
  - role: independent-reviewer
    instructions: .agents/roles/independent-reviewer.md
    when: L2 / L3 spec 草稿完成且用户确认前(Design §3);L2 或 L3 改动完成且 diff 已固定(Test §4)
    required: true
    attach:
      - 同名 spec 的验收判据
      - 固定 git range：git rev-parse <基准> 可解析，且 git diff <基准>...<HEAD> 非空
      - 级别为 L2 或 L3
      - 新会话，不与实现同上下文
      - 结论首行 reviewed by <模型名>
      - 落盘行按 .agents/roles/independent-reviewer.md 由主智能体写入文档「确认与复核」
      - 不改任何仓库文件
  - role: ui-verifier
    instructions: .agents/roles/ui-verifier.md
    when: 涉及 UI 改动且静态门已通过
    required: true
    fallback: main
  - role: implementer
    instructions: .agents/roles/implementer.md
    when: plan 与改动文件清单均已确认,且工作包边界满足角色契约
    required: false
    fallback: main
approval_required: true
next: 章序 Plan → Design → Build → Test;Test 后 L2/L3 合入（PR 审查合并）→ .agents/commands/deploy.md;L1 → .agents/commands/new-task.md §L1 快速道
---

<!-- 2026-11-08 档 2-F 四并一（原 plan/design/build/test.md），历史查 git -->

L1 的立档、实现、验证与关单都在 `.agents/commands/new-task.md` §L1 快速道；本文件 Plan → Design → Build → Test 四章只服务 L2/L3 阶段流。L1 只在 Plan §1 发现已有同名在途档时打开对齐进度，然后回快速道。

# Plan · L2/L3 立 intent

级别已由 `new-task.md` 定；本章按级别分叉执行，禁重新定级。

## 1. 准入与捷径
**Input**: 用户需求原文 + 已定级别
**Process**:
1. **捷径检查（兼会话重入，session-context）**: L1 看 `workflow/plans/` 是否已有同名 plan；L2/L3 看 `workflow/intents/` 是否已有 approved intent。已有且**终态** → 按 `next` 跳；已有且**在途**（draft/approved，勾选≠完成）→ 这是重入不是新建：读 plan 勾选态和 `git status` 对齐后续作，禁另立新档。L1 回到快速道，不进 Build 章。
2. **同类检索**: `flow-kit run kb-search.mjs "<关键词>" --scope workflow --type intents,plans,specs` $\rightarrow$ 命中同类先读结论与验收
**Output**: 确认无同类入口 / 已有 approved 入口

## 3. L2/L3：起草 intent
**Process**:
1. **生成草稿**: `flow-kit run fill-intent.mjs --module <模块> --level <L2|L3> --topic <主题> --output workflow/intents/<date>-<主题>.md --notes "<备注>"`
2. **填实**: 背景与问题 / 历史教训防复发 / 目标 / 非目标 / 约束 / 影响面 / 触达红线 / 验收标准
3. **红线核对**: 对照根 `AGENTS.md` 及目录级 `AGENTS.md`。没碰到不勾。
**Output**: `workflow/intents/{name}.md` (Status: Draft)
**Next**: Design 章

## 4. 确认与落态
**Process**:
1. **HALT**: 输出草稿全文 $\rightarrow$ 等待用户确认
2. **状态迁移**: $\text{draft} \rightarrow \text{approved}$（口径见 `new-task.md` 快速道第 4 步）
3. **留痕提交**: L2/L3 立即 `docs(workflow)` 单独提交；**L1 单笔提交**——验证绿后连跳 done，plan(done)+代码+确认分片+凭证同笔入树，无独立关单提交（口径单源 `new-task.md` 快速道第 4/6 步）。
**Next**: L1 $\rightarrow$ `.agents/commands/new-task.md` §L1 快速道 / L2,L3 $\rightarrow$ Design 章

## 🚫 禁止项
| 操作 | 机器行为 | 例外 |
|---|---|---|
| 硬填红线 | check-loop 判「红线判低」 | 必须实测触达才勾 |
| 硬填判据 | 验收标准不可测试 | 想不清楚必须 HALT 澄清 |
| 直改状态 | 状态迁移失效 | 必须通过 `confirm-doc` |

## 🛠️ 辅助工具
- **需求拷问**: `grilling` (答完回填 6 节)

# Design · 起 spec

## 1. 准入与级别判断
**Input**: `workflow/intents/{name}.md` (Approved) 或已确认的 incident 草稿。级别为 L2 或 L3。
**Process**:
1. **L1 禁入本阶段**: 遇到 L1 $\rightarrow$ **HALT** $\rightarrow$ 回 `.agents/commands/new-task.md` §L1 快速道。本阶段只起草 L2/L3 spec
2. **前置校验**: 若入口文档未过确认门 $\rightarrow$ **HALT** $\rightarrow$ 回 Plan 章 / `maintain.md` (exit 2)
3. **级别判定** (对照 `new-task.md` 两问):
   - **L2** (规则/契约): 必须起草 spec $\rightarrow$ **强制独立复核**（独立子智能体或新会话）
   - **L3** (结构/Schema): 必须起草 spec $\rightarrow$ **强制独立复核**（同上，跨模型优先）
**Output**: 确定的设计级别 (L2/L3)

## 2. 起草 spec
**Input**: 选定的级别 + 入口文档
**必读输入（起草前完成，缺一即 HALT 回本节补读；对照结果落「约束遵守映射」与「假设与推断」）**:
1. `wiki/INDEX.md` 检索本主题相关任务文档（产品需求 / 开发方案 / 项目规范 / 数据字典 / 用户功能）——命中即通读，依据以路径引用写进 spec 相关节（功能行为 / 数据流的口径来源）；无命中写明检索词与结论
2. `backend/AGENTS.md` 全文（§6 硬约束 / §7 机器门清单）——**无论本次改动面是否触及后端**
3. `frontend/AGENTS.md` 全文（门禁 G-2~G-3 / 契约规则 / 列表页状态规则）
**Process**:
0. **先查后建**: 同功能已有 spec（含归档）/ `verify-ui/features` $\rightarrow$ 原件修订不新建（单源 `workflow/README.md`「同功能续作」）
1. **生成草稿**: 运行 `flow-kit run fill-spec.mjs --level <L2|L3> --topic <主题> --output workflow/specs/<date>-<主题>.md`
2. **填实内容**: 复制 `_TEMPLATE.md` $\rightarrow$ 填写 [功能行为 / 数据流 / 系统改动 / 约束遵守映射 / 风险评估]
3. **约束核对**: 对照根 `AGENTS.md` 及目录级 `AGENTS.md` 红线逐条说明满足方式
4. **交互确认**: 明确标注入口形态 (表单/选择器/弹窗)，禁自行推定
5. **入口验证**: [前端专有] 搜按钮事件 $\rightarrow$ 追 router/Drawer $\rightarrow$ 定位真实渲染文件 $\rightarrow$ 在「系统改动清单」标注 **入口证据 (文件+行号)**
6. **方案取舍**: 多方案时 $\rightarrow$ 列出 [方案对照表(取舍+建议)] $\rightarrow$ **HALT** $\rightarrow$ 用户选定。分叉真实且推理定不了（契约形状 / 数据流 / 性能取舍）时，先开 **2 路并行方案**（子代理各一方案，只读仓库、产物落对话或 `tmp/`，禁改仓库文件），按「方案 | 关键取舍 | 风险 | 证据」比选；2 路封顶，推理能定夺的不跑，不占实现面委派并发额度
7. **歧义扫描**: 写「歧义清单」，6 维各一行——状态与边界 / 数据口径 / 失败路径 / 契约对称 / 存量数据 / 验收可测性。列序 `维度 | 结论 | 依据 | 状态`。
   - 可实验 → 先实验，依据写实验结果，**禁问用户**。
   - 实验定不了 → 状态写 `待澄清`，当轮问清。
   - 上界：每维 ≤2 行、合计 ≤12、单轮问询 ≤5。
   - 推断类结论 → 另记「假设与推断」。
   - 缺节 / 缺维 / 待澄清 ≠ 0 / 依据空 / 超界 → 确认门拒。
8. **前提质询**: 写「前提质询」表——列出 spec 立论的解读性前提（如「展示诉求 vs 存储改写」），逐条反问对立解读并写选定依据；无解读风险的小件写一行「无关键前提」+ 理由。缺节 / 空表 / 占位 / 缺反问或缺依据 → 确认门拒（锚 premiseSince 起；10-23 identity-overwrite 三层同源失效的堵口）
**Output**: `workflow/specs/{name}.md` (Status: Draft)

## 3. 独立复核 (L2/L3 强制)
L2/L3 强制：委派 `independent-reviewer`；触发、形态、必填输入与落盘口径以 `.agents/roles/independent-reviewer.md`「复核口径」为准（本文不复述）
**Output**: 复核未过 $\rightarrow$ 回 §2 改 spec

## 4. 确认与落态
**Process**:
1. **HALT**: 输出 spec 全文 $\rightarrow$ 等待用户确认。确认前自查歧义清单与前提质询：待澄清归零、6 维齐、每行有依据、前提有反问有选定依据（不满足则落态被拒）
2. **状态迁移**: $\text{draft} \rightarrow \text{approved}$
3. **落态入口**: 运行 `flow-kit run confirm-doc.mjs <path>`（口径见 `new-task.md` 快速道第 4 步，本文不复述）
4. **留痕提交**: 立即 `docs(workflow)` 单独提交
**Next**: Build 章

## 🚫 禁止项
| 操作 | 后果 / 机器行为 | 例外 |
|---|---|---|
| 路由认定入口 | → 整轮返工 | 必须提供文件+行号的实测证据 |
| 自行推定交互 | → UI 与需求不符 | 必须由用户确认形态 |
| L3 自查冒充 | `.agents/skills/shipyard-workflow-closeout/SKILL.md` §0.3 HALT。check-loop 对缺复核上下文只 WARN | 必须由 `independent-reviewer` 执行 |
| 带着「待澄清」走确认门 | `confirm-doc` 拒（歧义未清，exit 2，不落盘不记账）；缺维 / 依据为空同样拒 | 先问用户拿判定再落态 |
| 前提不经质询进事实源 | `confirm-doc` 拒（前提质询缺节 / 空 / 占位 / 缺反问或缺依据，exit 2） | 无解读风险须写「无关键前提」行并给理由 |
| 把可实验项问用户 | 多一轮确认税，且答案本就跑得出来 | 先查库 / 跑 eval / 原型，依据写实验结论 |
| 「已定」不写依据 | `confirm-doc` 拒（等于没想过） | 依据须可指认（节号 / 代码路径 / 查库结果） |
| 跳过必读输入 / 约束映射缺 backend/frontend AGENTS 条目 | → 独立复核驳回返工（映射缺源视同未做约束核对） | 两份目录规范是全仓契约基准，与本次改动面无关；wiki 无命中可豁免第 1 项（须写明检索词） |

# Build · 起 plan + 写代码

L1 不在本章起草 plan，回 `.agents/commands/new-task.md` §L1 快速道第 4 步；本章只为 L2/L3 实现，或委派 implementer（§3）、处理偏离 plan。

## 1. 起草 plan
**Input**: `workflow/intents/{name}.md` (Approved) + `workflow/specs/{name}.md` (Approved)
**Process**:
1. **创建文档**: 复制 `_TEMPLATE.md` $\rightarrow$ `workflow/plans/{name}.md`，填写改动方案 / 任务拆解（每步带「文件」与判据）/ 执行顺序 / 验证计划
2. **HALT**: 输出刚起草的 plan 全文 $\rightarrow$ 等待用户逐件确认。
**Output**: `workflow/plans/{name}.md` (Status: Approved)
**Gates**:
- **确认门 (confirm-doc)**: $\text{draft} \rightarrow \text{approved}$（口径见 `new-task.md` 快速道第 4 步）
- **依据**: `workflow/papercuts.md`

## 2. 进计划模式列改动
**Input**: `workflow/plans/{name}.md` (Approved)
**Process**:
1. **坑点检索**: `flow-kit run kb-search.mjs --scope workflow --module <token> "<关键词>"` $\rightarrow$ 提取 incident 根因入自查项
2. **列清单**: 明确 [读后改/新建] 文件清单 + [动作 $\rightarrow$ 对象] 执行步骤
3. **同步审计**: 改动命中 `.agents/commands/` 或 `.agents/roles/` 时，正文只改权威源，宿主壳保持指针（见 §🛠️ 辅助与同步）
4. **红线核对**: 对照根 `AGENTS.md` 及目录级 `AGENTS.md` 标注触达红线
5. **生成全景 + 拉起看板**: 先 `flow-kit run gen-dev-tour.mjs workflow/plans/{name}.md --strict` 过每步文件门（实现步骤缺 `- 文件：` 拒产；纯验证步骤标「验证步骤」），再 `flow-kit run auto-tour.mjs workflow/plans/{name}.md` 拉起看板（幂等，失败只告警）。需要快照另跑 gen-dev-tour；核对「文档外实际改动」，越界先回填/回滚；口径见 dev-tour/SKILL.md。层兜底（直认 0）= 标题失约，规范后重生成
6. **HALT**: 输出改动清单 $\rightarrow$ 等待用户确认
**Output**: 确认的改动清单 $\rightarrow$ **回填 plan「改动面/任务拆解」落盘**（session-context：对话留痕仅供当次，重入以 plan 为准——改动面 + 任务勾选态 + git status = 会话重入三锚）。**落盘后重跑 `flow-kit run auto-tour.mjs workflow/plans/{name}.md`**——真实目的是确保看板进程在跑（幂等，已在跑即复用）；在跑则实时页自动重绘（SSE 推送 + 5s 兜底轮询），落盘后的改动面自会进图

## 3. 实现与自验
**Input**: `workflow/plans/{name}.md` (Approved，含落盘的改动面与任务清单)
**Process**:
1. **会话重入**（压缩 / 新会话 / 交接续作必走）: 读 plan 任务清单勾选态 + `git status` / `git diff` 现场比对 $\rightarrow$ 重建进度再继续。勾选态与工作树不符（勾了未提交 / 提交了未勾）$\rightarrow$ 先对齐再写新代码；改动清单只在对话里时，以 plan 改动面 + 工作树为准并回填 plan
2. **推进实现**: 按依赖执行任务——**frontier = 任务拆解中「依赖」行无未决阻塞的任务**，可并行派发（多 worktree 各自分支 / 委派「新开+合并范围」），纯顺序链即自上而下；**每完成一项立刻回填任务清单勾选与留痕**（commit SHA / 测试名 / 实测输出），并解锁依赖它的下游任务（每完成一项顺手刷新 `/tour?file=workflow/plans/{name}.md`，确认没有「文档外实际改动」）。满足 `.agents/roles/implementer.md` 边界时可委派 `implementer`（模型取 `model-roles.json`，本地覆盖优先，皆空 = 宿主默认）
3. **架构约束**: 严禁自创旁路数据访问，必须遵循根/目录级 `AGENTS.md` 红线
4. **L3 专项**: Schema 变更必须走项目约定维护方式，禁擅自引入迁移机制
5. **变更管控**: 若需偏离 plan (改公共接口 / 动未列文件 / 引新依赖) $\rightarrow$ **HALT** $\rightarrow$ 确认后继续
6. **自验闭环**: 运行 [项目构建 / 类型检查 / 自动化测试] (详见 Test 章 §1)；范围对账 `flow-kit run check-scope.mjs workflow/plans/{name}.md`——越界件即收口（回填 plan 或回滚）；**L2/L3 关单前必须 `--strict` 通过**，L1 保持 advisory（推送时刻另有 check-scope-range 按 old..new 范围硬门兜底）
**Output**: 实现的代码变更 + 自验通过证据

## 4. 确认后收尾
**Process**:
1. **状态迁移**: plan 保持 `approved`，不在此置 `done`。关单在 Test 章 §5，经 confirm-doc 置 `done`。
2. **提交留痕**: intent/spec 在 design 确认后单独 `docs(workflow)`。plan 确认后同样单独 `docs(workflow)`，不与代码同一提交。Conventional Commits 中文。
3. **脚本化改写**：改 workflow 文档或台账用 `flow-kit run rewrite-file.mjs <文件> --find <字面串> --replace <字面串>`。禁止 `node -e` 配 `writeFileSync`（CRLF 检出上会静默没改到还打印成功）。
**Next**: Test 章

## 🚫 禁止项
| 操作 | 机器行为 | 例外 |
|---|---|---|
| 直改 frontmatter | 状态迁移失效 | 必须通过 `confirm-doc` |
| draft $\rightarrow$ done | check-loop 15 拦截 | 必须经 approved 中转 |
| 摘要确认 | confirm-doc 拒绝 | 必须全文过目 |

## 🛠️ 辅助与同步
- **宿主是指针壳**：改 `.agents/commands/` 或 `.agents/roles/` 不要把正文抄进 opencode / trae / codebuddy。壳只保留宿主 frontmatter，并写明权威路径。机器检查仅 check-loop hard 五段，不覆盖宿主壳；人工核对壳是否断线/过厚。
- **改动面纪律**: plan 改动面列权威源路径。宿主壳未改就不要把 `wf-*.md` 写进改动面。
- **自检**: 改 check-loop 后跑 `flow-kit run check-loop.mjs`

# Test · 静态门 + UI 实测

本章留给 L2/L3、切库冒烟、flaky 和独立复核。

## 1. 静态门 (Static Gates)
**Input**: 待验证代码变更
**Process**:
1. **执行门禁**: `flow-kit run verify.mjs`（档位口径以 verify.mjs 头注为准，本文不复述）。项目构建、测试、类型检查的命令清单单源是 `.agents/hooks/commit-check.config.json`。
2. **故障处置**: 任一失败 $\rightarrow$ **HALT**。L1 回 `.agents/commands/new-task.md` 快速道第 5 步改代码。L2/L3 回 Build 章修复。偶发/跨层问题用 `diagnosing-bugs` 诊断。全量首跑红、隔离重跑转绿不算绿：按 flaky 立项（papercut/incident）后修复，禁以重跑绿直接关单。
3. **档位按任务小类**: 纯文档/业务面 → 默认档（产品门按 diff 面裁）；跨面或发版前 → `--full`。引擎面无测试门，`*.test.mjs` 不入库不自动跑（2026-10-29 清库）；手动工具——合并语义探针 `flow-kit run check-loop-rev-semantics.mjs`（FULL 模式末尾自动跑）。
4. **行为评测（引擎面/模型面）**: 本批改动触及 `.agents/skills/**`、`.agents/commands/**`、`.agents/roles/**` 或模型配置时，跑 `flow-kit run agent-eval.mjs check`。无当前内容签名的凭证 → 按 `.agents/skills/eval/SKILL.md` 跑任务集，再 `agent-eval.mjs record`。**修复类**在动手前 `flow-kit run fix-task.mjs start`，关单后 `stop`——窗口内修改既有测试会被写前门拒绝（新建复现测试放行）。
**Output**: 静态门全绿证据 +（引擎面/模型面）行为评测凭证
**Note**: 运行环境细节见 `.agents/notes/runtime-env.md` §1, §2；长门禁命令（verify 全量/`dotnet test`）**分段等 + 每段回报进度**，不阻塞到 timeout 上限——口径 §6.4「后台长任务取结果」

## 2. 切库冒烟 (DB Smoke Test)
**Trigger**: 改了项目数据库连接配置或新增目标库
**Process**:
1. **Schema 比对**: 目标库实际 Schema $\leftrightarrow$ 代码期望（近期变更脚本 + 基础表）
2. **接口探活**: 运行冒烟脚本 $\rightarrow$ 验证 6 个核心端点 $\text{HTTP 200}$
**Output**: 探活通过证据
**Fact**: 探活脚本路径见 `.agents/notes/runtime-env.md` §6.1
**Fail**: 任一非 200 $\rightarrow$ **HARD-BLOCK** $\rightarrow$ 停在此步，禁部署。

## 3. UI 实测 (UI Verification)
**Trigger**: 涉及前端改动 $\text{AND}$ 静态门已通过
**Process**:
1. **调用技能**: 使用 `.agents/skills/verify-ui/SKILL.md` 执行实测。
2. **环境配置**: 详情见 `.agents/notes/runtime-env.md` §4 与 §6.3
**Output**: UI 验证报告 (截图/DOM 证据)

## 4. 独立复核 (Independent Review - L2/L3 强制)
1. **委派复核**: 交 `independent-reviewer`（必附文首该角色的 `attach`，缺一项不派；本节场景=关单前独立复核）。触发、形态、评审包、落盘、意见级台账与跨模型口径以 `.agents/roles/independent-reviewer.md`「复核口径」为准（本文不复述）
2. **评审定性**: 根据复核意见 $\rightarrow$ 采纳 $\rightarrow$ 回 Build 章修改 $\rightarrow$ 重跑本阶段
**Output**: 复核结论 (Approved / Reject) + 意见级台账行；署名与落盘口径见 role「复核口径」

## 5. 确认后关单 (Closure)
L1 关单即 `.agents/commands/new-task.md` 快速道第 6 步的单笔提交（默认不开关单技能，仅 plan 独立关单场景打开——口径单源 new-task.md 第 6 步）；本节从 L2/L3 新需求和修复类起。
**Process**:
1. **验证与关单**: 按 `.agents/skills/shipyard-workflow-closeout/SKILL.md`。
2. **验收勾验**:
   - **L2/L3 新需求**: 逐条勾验 intent「验收标准」 $\rightarrow$ 补证据 $\rightarrow$ intent $\text{approved} \rightarrow \text{done}$
   - **修复类**: 验证防复发落地 $\rightarrow$ incident $\text{open} \rightarrow \text{fixed} \rightarrow \text{closed}$
3. **同族清理**: L2/L3 与修复类的同名 plan 一并置 `done`。不留 `approved` 孤儿。
4. **留痕记录**: 委派任务记入 `workflow/delegations.md` 委派结果表；L2/L3 自做记入自做任务结果表。自做 L1 不写。写了行才跑 `flow-kit run agg-delegations.mjs --write`。
5. **顺事回灌（advisory）**: 有摩擦记 `workflow/papercuts.md`，没有就在关单回复写「无候选」。
**Next**: L2/L3 $\rightarrow$ `.agents/commands/deploy.md`

## 🚫 禁止项
| 操作 | 机器行为 | 例外 |
|---|---|---|
| 顺手改代码 | 违反 Test 阶段定义 | 必须回 Build 章修复 $\rightarrow$ 重跑 Test |
| 部分通过 | `ui-verifier` 报告阻塞 | 禁将部分通过项标记为已通过 |
| 缺证据勾选 | check-loop 拦截 | 必须提供具体证据 (截图/SHA/Log) |
