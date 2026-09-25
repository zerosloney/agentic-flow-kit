---
状态: approved
级别: L1
日期: 2026-09-25
模块: pipeline
备注: 审查报告改进方向第 1 条。L1 极简两节（改动面 + 验证方式）。
---

# PLAN — workflows 编排脚本机器 linter

## 改动面

1. **新增 `templates/_agents/scripts/workflows-check.mjs`**：lint 纯函数 export（`lintWorkflows({ root })`，roles/steps 词表从 `.agents/roles/*.md`、`.agents/workflows/steps/*.md` 读）+ CLI（`--root` / `--json`，error exit 1，advisory 告警不阻断）；空值规范 `—`/`-`/空串统一为空；表头按列名识别（task / params、files（授权）等别名归一）。
2. **新增 `templates/_agents/scripts/workflows-check.test.mjs`**：fixture 临时目录 + 真实仓库自扫 baseline，≥13 场景（error 10 类 / advisory 3 类 / `_` 前缀排除）。
3. **`src/doctor.mjs`**：§2 required 布局清单补 `.agents/workflows/_TEMPLATE.md`；新增 §6.8（spawn 跑 `node .agents/scripts/workflows-check.mjs`，exit 0 → PASS（数 ⚠️ 告警条数），非零 → WARN 首次引入；脚本或目录缺失自然跳过）。
4. **`templates/_agents/workflows/pipeline-closing.md`**：gate-doc 行 `fill-{intent,plan}.test.mjs` → `fill-intent.test.mjs && fill-plan.test.mjs`（消除花括号展开的 PowerShell/cmd 不可移植）。
5. **`node bin/flow-kit.mjs sync`**：装副本 `.agents/` 同步 1/2/4（新文件入 managed 台账 + kit.json 刷新）。

## 验证方式

- `node .agents/scripts/workflows-check.mjs`：本仓库自扫 exit 0、0 error 0 warning（pipeline-closing 修复后）。
- `npm test`：全部套件绿（含新增 workflows-check.test.mjs）。
- `node bin/flow-kit.mjs doctor`：0 FAIL、§6.8 出现且 PASS、§2 布局含 workflows 模板。
- `node .agents/scripts/source-sync-check.mjs --diff`：0 差异。

## 确认与复核

- 确认结果：approved（2026-09-25 用户对话内确认「从1开始改进」）
- 确认时间：2026-09-25
- 复核：L1 不要求独立复核；关单勾验见同名 intent
