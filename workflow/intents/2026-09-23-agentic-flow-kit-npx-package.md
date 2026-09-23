---
状态: approved
级别: L1
日期: 2026-09-23
模块: pipeline
备注: 工具级（新外部仓库 E:\Demo\cli-tools\agentic-flow-kit，本仓库零产品代码改动）。2026-09-23 用户对话内确认方案与四决策点（目录 E:\Demo\cli-tools\agentic-flow-kit、bin 命令名 flow-kit、公共 npm、本仓库 dogfooding 另立 L2 intent）后开工；同日用户明示旧 workflow-skeleton 作废由用户自行删除，不迁移不参考其代码。本 intent 范围 = M1（建包+模板清洗）+ M2（init/doctor CLI）；M3（sync/add-host/add-gate）、M4（dogfooding 迁移，另立 L2）、M5（npm 发布）后续推进。2026-09-23 同日二次修订（用户对话内确认）：init 砍去 --name/--desc/--stack——AGENTS.md 只生成「AI工作流+Wiki」两章骨架与「项目适配区」，命令文档占位符改中性文字，profiles 只留基线配置；裸跑无参数进入交互确认环节（宿主→看板端口→显式 y 确认，EOF/非 y 安全取消）。同日三次修订（用户对话内确认）：--stack 恢复——技术栈承载门禁能力（commit-check 条件编译检查 builds / settings.json 自检验命令 allow / AGENTS.md 项目适配区命令预填三处），默认 none=不配置；交互环节增至三问（宿主→技术栈→端口）。同日四次修订（用户对话内确认「门禁加入质量检测」方案）：commit-check 新增 checks 质量检测层——只放秒级确定性检查（lint/类型检查/vet：node=tsc+eslint、python=ruff、go=vet、dotnet=format），带 when 配置文件条件启用（tsconfig/eslint/ruff/go.mod/*.sln 存在才跑，否则跳过不误拦）；测试不放提交门（关单在 test.md 阶段门），分层不变。
---
# INTENT — agentic-flow-kit：AI 工作流+wiki 引擎抽离为 npx 脚手架包（flow-kit init）

## 背景与问题
- 本仓库的 AI 闭环工作流（`.agents/` 阶段命令 / 角色契约 / 门禁钩子 / kb 检索 / 看板 / 规则面预算 + `workflow/` 文档协议闭环 + `wiki/` 知识层）已适配多个 agent 宿主稳定运行，但全部内容绑定本项目；换新项目需逐文件手工拷贝改造，无分发与升级通道。
- 旧尝试 `E:\Demo\cli-tools\workflow-skeleton`（2026-09-03 快照）覆盖面小（无 wiki 层 / 看板 / 检索 / 预算层）且引擎已漂移，用户已确认作废删除。
- 目标：以本仓库当前引擎为唯一权威源，把通用部分抽成独立 npx 包 `agentic-flow-kit`（bin 命令 `flow-kit`），新项目一条命令 `flow-kit init` 装好项目级 AI 工作流 + wiki；scaffold 型——装完自包含，包不成为项目运行时依赖。

## 目标
- M1：包仓库建立，通用件按三类切分清单清洗入模板（A 直接通用 / B 参数化 / C 项目专属不进包），清洗后模板不含本项目业务信息（库名 / 端口 / 密钥模式 / 业务脚本名）。
- M1 验收：临时 git 仓库手工装模板后，check-loop / gen-workflow-index / kb-search / 看板探活可用。
- M2：`flow-kit init`（flags 模式）+ `flow-kit doctor` 一条命令完成安装（渲染占位符 / 挂 core.hooksPath / 追加 .gitignore / 写 .agents/kit.json managed 清单）。
- M2 验收：临时 git 仓库 init 后 doctor 全绿；模拟 L1 闭环（intent→plan→done）验证 check-loop 拦 / 放行为。

## 非目标
- M3（sync 升级三态文件策略、add-host / add-gate 子命令）、M4（本仓库 dogfooding 迁移为包消费者，另立 L2 intent）、M5（npm 发布）——本期不做。
- 不迁移 / 不参考 workflow-skeleton 旧代码；不动本仓库任何产品代码、门禁与引擎现状。

## 影响面
- 模块：pipeline（纯工具级；本仓库仅新增本 intent 与同名 plan 两份文档）
- 数据库：无；前端页面：无

## 触达红线
- 不触及（零产品代码改动；不修改既有引擎文件——模板均为新仓库内的清洗副本）

## 验收标准（可测试）
- [ ] M1：包仓库落于 `E:\Demo\cli-tools\agentic-flow-kit`，package.json bin=`flow-kit`，零运行时依赖（证据：package.json 内容）
- [ ] 模板清洗后零本项目业务残留：rg 扫描 templates/ 与 modules/ 无 船厂/Shipyard/8932/5203/POC_MM/DEVE_CSS/MM_SYS/JAMTCUser 等项目 token（证据：扫描输出为空）
- [ ] M1：临时 git 仓库手工安装后 gen-workflow-index 生成 INDEX 且 `--check` 通过、check-loop 干净退出、kb-search 可执行不报错、看板 server `/api/board` 探活 200（证据：验证输出）
- [ ] M2：init 后目录布局完整（.agents/.githooks/workflow/wiki + 所选宿主适配层）且 `core.hooksPath=.githooks` 已配置、`.agents/kit.json` 含 managed 清单（证据：命令输出）
- [ ] M2：模拟闭环——intent(approved)→plan→done 全勾验时 check-loop 通过；done 留未勾验项时被 hard-block（证据：两次运行退出码对比）
- [ ] 引擎自带测试在新仓库全绿（gen-workflow-index / gen-wiki-board / kb-search 等各 *.test.mjs）（证据：测试输出）
