---
name: papercut-fix
description: 修 workflow/papercuts.md 里指定的未升级 papercut 条目（把存量债降到 0 的回路执行器）。按控制器给的行号定位症状、照「拟修」列改权威文件、回写台账并跑验证门。
---

# papercut-fix — 单条 papercut 升级执行器

## 目标
将 `workflow/papercuts.md` 中指定的一条 papercut 条目状态更新为「已消债」。

## 触发条件
- 用户指令：`跑一轮 papercut 回路` / `清 papercut 存量` / `修第 N 条 papercut`。

## 约束与红线
- **单一目标**：每轮执行仅处理一条目标，禁止顺手修复相邻条目或夹带其他改动。
- **范围限制**：改动仅限文档面（`.agents/commands/`, `.agents/roles/`, `.agents/skills/`, `.githooks/`, `.agents/scripts/`, `workflow/`）。
- **绝对禁区**：禁止修改 `backend/`, `frontend/`, `tests/`, `wiki/`，禁止连接数据库——与控制器 scope gate（`OUT_OF_SCOPE` 正则）同一清单，命中即停。超出范围时必须停止并报告用户。
- **验证优先**：禁止凭台账描述臆测现状。必须先读权威文件验证症状是否成立。
- **编辑规范**：修改 `workflow/` 文档必须使用 Edit 工具。禁止使用 `node -e` 或脚本批量替换（CRLF 环境下会静默失败）。
- **消债判定**：分支 A（修复）与分支 B（暂缓/失效）**均**满足 `debt -1` 不变量。

## 工作流

### 1. 定位与预检
- 从控制器输出提取：`行号` (Lxx), `位置` (路径), `症状`, `拟修`。
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
    2. 在 `workflow/papercuts.md`（或承载该条目的 `workflow/papercuts.d/` 分片）该行末尾追加：`✅ 已升级修复(YYYY-MM-DD): <改动描述> <commit>`。
    3. 若原「拟修」描述已不适用，在追加记录中写明实际修法。
- **分支 B (已失效)**：
    1. 在 `workflow/papercuts.md`（或承载该条目的分片）该行末尾追加：`⏸ 暂缓(YYYY-MM-DD): <失效理由>`。理由必须明确。
    2. **核实纪律**：
        - 检查用户级技能目录（`~/.claude/skills/`、`~/.trae/skills/` 等宿主适配目录）确认文件是否仅是迁移而非删除。
        - 区分「环境约束」与「代码缺陷」。
        - 针对「跨环境」症状，使用 `git worktree` 构建真实检出态实验证伪。
        - 针对「已落地」症状，使用 `git log -S` 追溯引入提交日期。
- **分支 C (越界)**：停止执行，报告理由并请求授权。

### 4. 验证与收尾
- **备份**：修改台账（主台账或分片）前强制 `cp <台账文件> tmp/papercuts.wip-backup.md`。
- **运行检查**：
    - `node .agents/scripts/papercut-debt-sensor.mjs` $\rightarrow$ `debt` 必须恰好减少 1。
    - `node .agents/scripts/papercut-debt-controller.mjs` $\rightarrow$ 确认目标推进。
    - 检查台账（主台账 ∪ 分片）的总行数（`total` 不得减少——`debt` 符合预期 ≠ 文件没被压行）、列数分布及是否存在超长行（压行信号）。
- **体积检查**：若修改了 `.agents/commands/`，跑 `node .agents/scripts/rule-budget.mjs --staged` 对比 `.agents/rule-budgets.txt` 上限（一进一出；禁用工作区 `wc -c` 核对——CRLF 膨胀会误报）。

## 回报要求
- 参照 `references/response-template.md` 输出。
- 包含：行号、位置、分支结论(A/B/C)、改动文件、验证结果(debt 前后值)、待决策事项。
- **禁令**：禁止自动 commit 或 push。
