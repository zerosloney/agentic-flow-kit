---
状态: approved
级别: L1
日期: 2026-09-23
模块: pipeline
备注: L1 极简 plan（改动面 + 验证方式两节起步）；方案全文（切分清单 / 两态文件模型 / M1-M5 分期）见 2026-09-23 对话确认稿
---
# PLAN — agentic-flow-kit M1+M2

## 改动面
- 新建外部仓库 `E:\Demo\cli-tools\agentic-flow-kit`（package.json：name=agentic-flow-kit、bin=flow-kit、type=module、engines node>=18、files=bin/src/templates/modules、零运行时依赖）；本仓库仅本 plan + 同名 intent 两文档，零代码改动。
- 切分三类（权威源 = 本仓库当前引擎）：
  - A 直接通用：引擎脚本（gen-workflow-index / gen-wiki-board / gen-workflow-metrics / kb-search / kb-cache-evict / wiki-search / verify-wiki-consistency / agg-delegations / rule-budget / workflow-board-server / ensure-board 及各自测试）、看板 board/、通用钩子（commit-msg / post-commit / pre-push / pre-merge-commit / check-pairing-incremental / check-wiki-ledger）、new-task.md、implementer.md、wiki skill、.opencode/ 与 .trae/commands/ 薄适配、.omp/agents/ 薄适配。
  - B 参数化：pre-commit（通用编排 + local-pre-commit 项目挂载点）、commit-check.js（构建命令与敏感模式改读 .agents/hooks/commit-check.config.json）、check-loop.sh（目录级 AGENTS.md 清单改 glob）、settings.json / workflow-modules.txt / rule-budgets.txt（profile 初值）、workflow/README.md（去项目历史注记）、根 AGENTS.md 骨架、7 个阶段命令（项目示例段参数化）。
  - C 不进包：业务脚本（e2e/verify-*/regression-smoke/api-local/check-query-contract）、项目门禁（check-architecture/audit-fields/delete-guard/notify-guard）、全部 workflow 与 wiki 内容、runtime-env.md。
- 占位符约定：`{{PROJECT_NAME}}` `{{PROJECT_DESC}}` `{{BUILD_CMD}}` `{{TEST_CMD}}` `{{TYPECHECK_CMD}}` `{{BOARD_PORT}}`；init 按 profile（dotnet/node/python/go/none）填充，managed 清单（path+sha256）落 `.agents/kit.json`。
- 宿主模块：opencode / trae / zcode / omp（生成后 `.zcode/` `.omp/` 进 .gitignore，沿用现行约定）。
- 2026-09-23 修订（用户对话内确认）：init 参数砍至 `--hosts/--board-port/--dir/--force`；裸跑无参数进入交互确认环节（readline，显式 y 才装）；AGENTS.md 模板改为「AI工作流 + Wiki」两章骨架 + 「项目适配区」；命令文档 `{{BUILD_CMD}}` 等占位符改中性文字（「项目构建命令」等），全包仅剩 `{{BOARD_PORT}}` 由 init 填充；profiles 删技术栈表，settings.json / commit-check.config.json 只生成空基线。
- 2026-09-23 三次修订（用户对话内确认）：`--stack` 恢复（dotnet/node/python/go/none，默认 none）——技术栈只作用于门禁配置三处（commit-check builds 编译检查、settings.json allow 自检验命令权限、AGENTS.md 项目适配区命令预填 `{{BUILD_CMD}}/{{TEST_CMD}}/{{TYPECHECK_CMD}}` 三变量随栈填充），命令文档保持中性文字不回退占位符；交互环节增至三问（宿主→技术栈→端口→确认）。
- 2026-09-23 四次修订（用户对话内确认）：commit-check 新增 `checks` 质量检测层（与 builds 并列）——只放秒级确定性检查（node=tsc+eslint、python=ruff、go=vet、dotnet=format），`when` 数组按配置文件存在条件启用（支持尾部 `*` 一层通配如 `*.sln`），无配置自动跳过提示；`--full` 时全跑；测试不放提交门（关单在 test.md 阶段门 + done 勾验 + 独立复核兜底）。

## 验证方式
- 引擎测试：新仓库内跑各 `*.test.mjs` 全绿。
- 端到端：临时 git 仓库跑 `flow-kit init --yes` → doctor 全绿 → gen-index `--check` / check-loop / kb-search / 看板 `/api/board` 探活 / 模拟 L1 闭环（done 勾验放行 vs 未勾验拦截）。
- 清洗扫描：rg 项目 token 于 templates/、modules/ 输出为空。
