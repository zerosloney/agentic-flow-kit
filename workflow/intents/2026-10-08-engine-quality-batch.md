---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-08
模块: pipeline
备注: 引擎源码质量审查三项 P2 改进：lint 工具链 + check-loop 头部判据下沉 + pipeline-run 拆分
确认指纹: c562d28a8751d036
---
# INTENT — engine-quality-batch

## 背景与问题

2026-10-08 对引擎源码（src/ 3.3k 行 + templates/_agents/scripts/ 18k 行 + modules/ 0.6k 行，配套 75 份测试套件）做了质量审查：总体质量高（零空 catch、零 TODO/FIXME、测试:实现比健康、判据决策可追溯），但存在三项 P2 级改进点，用户在对话内拍板按序执行（原话复述审查结论：「是补 lint 工具链（P2-1，半小时的事），其次随 check-hygiene 拆分收尾把头部注释判据下沉到各模块（P2-2），pipeline-run 拆分（P2-3）」）：

- **P2-1 无 lint / 静态检查工具链**：约 18k 行纯 JS 无任何 lint 配置（eslint/biome 均无），风格一致性与低级错误（未用变量、拼写）无机器兜底；test.md 的质量门口径（lint / 类型检查 / vet）在本仓自己是空转的。
- **P2-2 check-loop.mjs 头部清单注释承载已迁出检查项的判据**：检查项 2/9/11/12/13 实现已迁 check-hygiene.mjs（2026-10-08 selfmeasure-and-modularize），但判据详注仍留在 check-loop.mjs 头部——注释与实现分离的双源漂移风险。
- **P2-3 pipeline-run.mjs 单文件 1,001 行**：五子命令（start/next/status/watch/abort）+ 工单协议 + 事件流全在一个文件；check-loop 已有 check-hygiene 拆分先例，pipeline-run 尚无拆分。

## 历史教训/防复发

- 检索结果：`kb-search "check-hygiene"` 命中 `2026-10-08-selfmeasure-and-modularize`（done · L2 · pipeline）与 `2026-10-08-gate-roi-metrics`（done · L2 · pipeline）——同模块同级别先例两单，本单判级沿用 L2。
- 避坑 1（selfmeasure 实测教训——拆分后段落归属错账）：check-hygiene 的 5 段曾错记在 check-loop **全局**收集器上（模块实际产出**局部** warnings 数组），gate-seg 插桩断言红 4 条抓回。本次 pipeline-run 拆分后须核对 gate-seg 段归属与收集器接线。
- 避坑 2（gate-checklist 解析面）：check-loop 头部清单 `// N. 标题 [severity]` 是 gate-checklist PAIRS 按 id 消费的解析面——判据下沉**只搬续行注**，清单行（编号 + 标题 + severity）逐字保留，改完跑 `gate-checklist.mjs --diff` 验「登记完整」。
- 避坑 3（双源纪律，incidents/2026-09-25-wf-runtime）：引擎改动一律改 `templates/` 包源 → `flow-kit sync` 刷装副本与台账，禁直改 `.agents/`；本单为 2026-10-08 常驻面重构返工（先直改装副本被 doctor FAIL 拦、全量回滚重做）后的第一单引擎改动，纪律刚被实测强化。
- 避坑 4（本次起草实测发现）：fill-intent 产出的骨架在「影响面/触达红线」节含坏字符 `$ightarrow$`（`\r` 被吞的渲染链问题）——本 intent 填实时已清除；根因另记 `workflow/papercuts.md`，不当场顺手修模板。

## 目标

- **G1（P2-1）**：引入 eslint 9（flat config），`npm run lint` exit 0 并入 npm test 编排（run-tests.mjs 首步）；lint 范围 = 包源四区（src / bin / templates/_agents/scripts / modules），排除装副本与生成物（.agents/、modules/hosts/、cache、workflow/、wiki/）；CI（.github/workflows/ci.yml，owned）补 install 步骤使 runner 可跑 lint。
- **G2（P2-2）**：check-loop.mjs 头部清单中已迁出检查项（2/9/11/12/13）的判据详注下沉至 check-hygiene.mjs 对应实现处；头部清单行精简为「N. 标题 [severity]（实现已迁 check-hygiene.mjs）」；判据语义与文案零变化。
- **G3（P2-3）**：pipeline-run.mjs 按职责层拆分（文档纯函数层 / run 存储层 / CLI 编排层），CLI 入参、输出、exit 码、PIPELINE_RUN_* 测试注入契约、run 文件 schema 零变化。

## 非目标

- 不改任何检查项判据 / 文案 / severity / 编号（gate-checklist 契约不变量）。
- 不改 pre-commit 提交门构成（commit-check.config.json 保持空——lint 进 test/CI 层，不进提交门，遵循「测试不放提交门」分层）。
- 不做 lint 规则定制深水区（先 recommended 基线 + 最少豁免；风格类规则收紧后续单独立单）。
- 不拆 runCheckLoop 巨石函数本体（P2-2 仅头部注释下沉；函数级拆分是另一单的事，头部清单不变量在那之前不动）。

## 约束

- 零运行时依赖红线不破：eslint 仅 devDependency，`files` 打包面不变（装户 init 不带 node_modules / eslint）。
- check-loop 头部清单行格式与编号逐字保留（gate-checklist 按 id 消费的解析面，「不得增删改号」）。
- 测试不 weakening：允许改 import 路径，不允许改断言语义；新增模块按 selfmeasure 先例带同名 .test.mjs（检查 20 扫描「无测试脚本」）。
- 双源纪律：一律改 `templates/` 包源 → `flow-kit sync`；（如触 .md 权威源）→ `sync-hosts --apply`。
- 提交遵循 Conventional Commits 中文；L2 三段式闭环链（docs approved 留痕 → 代码 → 关单 docs）。

## 影响面

- 模块：pipeline
- 数据库：无
- 文件面：package.json（+eslint devDep +lint script）/ package-lock.json（新增，入库）/ eslint.config.mjs（新增）/ .github/workflows/ci.yml（owned，+install 步骤）/ src/run-tests.mjs（+lint 首步）/ templates/_agents/scripts/check-loop.mjs（头部注释下沉）/ check-hygiene.mjs（接收判据注）/ pipeline-run.mjs + 新拆模块 + pipeline-run.test.mjs（import 路径随迁）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [x] 引入新依赖 / 新构建步骤（STOP 级）——eslint devDependency + CI install 步骤；用户 2026-10-08 对话内拍板「补 lint 工具链」，本 intent 即留痕
- [x] 规则 / 契约变更——check-loop 头部清单注释（gate-checklist 消费面）与 CI 工作流步骤 → 至少 L2（已定 L2，spec 写不变量清单与满足方式）
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3——未触及，不勾

## 验收标准（可测试）

- [ ] G1：本地 `npm run lint` exit 0；npm test 编排含 lint 首步且全量 exit 0（证据：命令输出）
- [ ] G1：CI 工作流具备可跑性——ci.yml 补 install 步骤后本地等价推演通过（实际 runner 绿在 push 后补证）（证据：ci.yml diff + 推演说明）
- [ ] G2：`node .agents/scripts/gate-checklist.mjs --diff` 输出「登记完整（0 断档 / 0 未登记）」（证据：命令输出）
- [ ] G2：check-loop 头部清单 15 项的编号 / 标题 / severity 与 HEAD 逐字一致，仅续行判据注迁移（证据：git diff 对照）
- [ ] G2：check-loop.test.mjs + check-hygiene.test.mjs + gate-seg.test.mjs 全绿（证据：npm test 输出）
- [ ] G3：pipeline-run.test.mjs 全绿且断言未改（证据：git diff 显示仅 import 路径与夹具路径变化）
- [ ] G3：五子命令冒烟行为不变——`start/status/next`（夹具环境）输出与拆分前一致（证据：冒烟对照）
- [ ] 全量门：npm test exit 0；doctor 0 WARN 0 FAIL；source-sync-check 0 漂移；rule-budget --all exit 0；装副本 shipped 视角全绿（sync 后两侧一致）（证据：命令输出）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：intent 全文（背景 / 三目标 / 非目标 / 约束 / 验收标准）
- 复核：L2 防御道——spec / plan 确认后方可动手；不强制新会话独立复核（L3 才强制）
