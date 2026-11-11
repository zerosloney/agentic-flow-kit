---
name: papercut-fix
description: 修 workflow/papercuts.md 里指定的未升级 papercut 条目（把存量债降到 0 的回路执行器）。按指令/台账给的行号定位症状、照「拟修」列改权威文件、回写台账并跑验证门；也用于同一错误反复出现时的错类挖掘与执法层级选择。
---

# papercut-fix — 单条 papercut 升级执行器

## 目标
将 `workflow/papercuts.md` 中指定的一条 papercut 条目状态更新为「已消债」。

## 触发条件
- 用户指令：`跑一轮 papercut 回路` / `清 papercut 存量` / `修第 N 条 papercut`。
- 用户指令：`跑一轮错题回路` / `同一类错又犯了` / `把这类错固化` → 先走 §0，再逐条走 §1–§4。

## 0. 错题回路（批量模式，与单条模式互斥）

只治**引擎面**反复犯的错（业务代码债按 incident 走，不进本回路）。四源取数，默认窗口近 3 个自然月：

| 源 | 读法 |
|---|---|
| `.agents/judgments.jsonl` | `node .agents/scripts/agg-judgments.mjs --retire-candidates`（per-rule 计数与候选） |
| `workflow/delegations.md` | 返工原因枚举分布 + 月度聚合快照 |
| `workflow/reviews.d/<YYYY-MM>.md` | 意见级采纳/拒绝/误报，按根因方向归并 |
| `workflow/incidents/` | 根因枚举（仅引擎面条目） |

**聚类阈值**：同一错类 ≥3 次才立规则；单次只记 papercut（若可操作），不立规则——避免对单例过拟合。

> 数据面注意：`judgments.jsonl` / `verifications.jsonl` 是 gitignore 的本地运行态，新 clone / 新 worktree 可能只有零星行。缺源时以 `delegations.md`、`reviews.d/`、`incidents/` 为准，**不因缺源造错类**；窗口内不足 3 次就写「数据不足」，不立规则。

**落点阶梯**（选最高可行层；降层必须写明不可行理由）：

| 层 | 手段 | 不可行信号 |
|---|---|---|
| 1 | 类型 / 编译期（类型、schema、枚举、契约） | 约束表达不出来 |
| 2 | 门禁脚本或钩子（check-loop 段、commit-check、verify 门） | 误报压不住，或触发频率撑不起 |
| 3 | 自动化用例（dotnet test / vitest / 引擎 `*.test.mjs`） | 环境不可达、非确定性 |
| 4 | 冒烟脚本（`regression-smoke.mjs` 脚本组） | 断言不了（纯视觉/交互） |
| 5 | 命令 / 技能 / 角色文本（prompt-only） | 无（最后手段） |

- 落到第 5 层：在 `workflow/papercuts.d/` 新增行的**症状列**前缀 `[prompt-only]`，挂债待后续升层。
- 落到第 2 层新增门禁：必须同时登记 `mechanism-registry.md`（含退役阈值），并遵守 `rule-budgets.txt` 一进一出。
- 与既有口径的关系：`workflow/regression-checklist.md` 规则 5/7 是本阶梯在回归条目上的特化（第 3–5 层顺序 + 执法者列），不另立第二套。

**输出**（先给表，再动手）：`错类 | 次数 | 证据位置 | 现执法者 | 缺口 | 选定层 | 拟改文件`。确认后逐条进入 §1–§4，每轮仍只处理一条。

## 约束与红线
- **单一目标**：每轮执行仅处理一条目标，禁止顺手修复相邻条目或夹带其他改动。
- **范围限制**：改动仅限文档面（`.agents/commands/`, `.agents/roles/`, `.agents/skills/`, `.githooks/`, `.agents/scripts/`, `workflow/`）。
- **绝对禁区**：禁止修改 `backend/`, `frontend/`, `tests/`, `wiki/`，禁止连接数据库。超出范围时必须停止并报告用户。
- **验证优先**：禁止凭台账描述臆测现状。必须先读权威文件验证症状是否成立。
- **编辑规范**：改 `workflow/` 文档用 `node .agents/scripts/rewrite-file.mjs <文件> --find <字面串> --replace <字面串>`（与 `stages.md` Build §4 相同）。
- **消债判定**：分支 A（修复）与分支 B（暂缓/失效）**均**满足 `debt -1` 不变量（debt = 台账待修
  行数，人工清点：触碰行带终态标记且不新增待修行；原定时报债传感器已退役 2026-11-08）。

## 工作流

### 1. 定位与预检
- 从指令给定提取：`行号` (Lxx), `位置` (路径), `症状`, `拟修`。
- 使用 Read 工具读取该行及其上下文。

### 2. 现状验证
- 读取「位置」列指定的权威文件。
- **判定结论**：
    - **缺陷仍在** $\rightarrow$ 进入分支 A。
    - **已失效** (已被其他改动修复/文件已删除) $\rightarrow$ 进入分支 B。
    - **方向相反/描述有误** $\rightarrow$ 重新定性后再执行。

### 3. 执行修复
- **分支 A (缺陷仍在)**：
    1. 对权威文件执行最小化修复。
    2. 在 `workflow/papercuts.md` 该行末尾追加：`✅ 已升级修复(YYYY-MM-DD): <改动描述> <commit>`。
    3. 若原「拟修」描述已不适用，在追加记录中写明实际修法。
- **分支 B (已失效)**：
    1. 在 `workflow/papercuts.md` 该行末尾追加：`⏸ 暂缓(YYYY-MM-DD): <失效理由>`。理由必须明确。
    2. **核实纪律**：
        - 检查用户级路径 (`~/.workbuddy/skills/` 等) 确认文件是否仅是迁移而非删除。
        - 区分「环境约束」与「代码缺陷」。
        - 针对「跨环境」症状，使用 `git worktree` 构建真实检出态实验证伪。
        - 针对「已落地」症状，使用 `git log -S` 追溯引入提交日期。
- **分支 C (越界)**：停止执行，报告理由并请求授权。

### 4. 验证与收尾
- **备份**：修改台账前强制 `cp workflow/papercuts.md tmp/papercuts.wip-backup.md`。
- **运行检查**：
    - 触碰行已带终态标记（`✅ 已升级修复` / `⏸ 暂缓`），且本轮未新增待修行（`debt -1`，人工清点）。
    - 检查 `workflow/papercuts.md` 的总行数、列数分布及是否存在超长行（压行信号）。
- **体积检查**：若修改了 `.agents/commands/` 或根 `AGENTS.md`，跑 `node .agents/scripts/rule-budget.mjs --all`，以其退出码为准。

## 回报要求
- 参照 `references/response-template.md` 输出。
- 包含：行号、位置、分支结论(A/B/C)、改动文件、验证结果（触碰行终态标记 / debt 前后值人工清点）、待决策事项。
- **禁令**：禁止自动 commit 或 push。
