---
状态: approved
级别: L2
模块: pipeline
确认指纹: 58109347e91ca417
---
# PLAN — pipeline-run

对应入口：../intents/2026-10-02-pipeline-run.md（approved）
对应 spec：../specs/2026-10-02-pipeline-run.md（approved）

## 改动方案

- `templates/_agents/scripts/pipeline-run.mjs`（新增，零依赖，约 600-800 行）：五子命令状态机（start/next/status/watch/abort）+ 工单协议 + run 事件流（原子写）+ 六类工单校验 + `PIPELINE_RUN_ROOT/BIN/GIT_BIN/NPM_BIN` 注入点（全部子进程经 `runGate()` 收口）+ stdout 阶段条与 `PIPELINE-STOP` 末行；状态机迁移表按 spec §功能行为实现
- `templates/_agents/scripts/pipeline-run.test.mjs`（新增）：夹具树（假 fill-*/confirm-doc/git/npm + 最小 workflow/ 目录）驱动——路径分支（L0/L1/L2/L3/incident/verify-only）、门退出码（confirm-doc 假件 exit 1/2 透传停机）、工单 schema、校验规则（占位符拦截/diff 越权拦截/勾验拦截）、事件流 append 语义、--adopt 重建
- `templates/_agents/commands/pipeline-run.md`（新增）：frontmatter（description/stage: entry/triggers: ["pipeline-run","跑执行器","全自动跑"]/approval_required: true/fallback: 主智能体亲自做 AI 槽位）+ 正文驱动协议（循环步骤/代录纪律「永不编造原话」/偏离即停/abort 协议/与 new-task 互引）
- `templates/_agents/commands/new-task.md`（修改一行）：阶段路由表前加互引——pipeline-run 为自动化驱动并列入口
- 根 `AGENTS.md`（owned，手动同步）：项目适配区加一行入口说明
- 同步动作（不产生新文件）：`bin/flow-kit.mjs sync`（装副本收养入台账）→ `bin/flow-kit.mjs sync-hosts --apply`（命令文档至各宿主薄适配）

## 任务拆解（L2）

1. **pipeline-run.mjs 主体**：命令面解析 + run 文件读写（原子写）+ 事件流 + 状态机内核（迁移表/停机点/幂等重入）+ runGate() 收口与注入点
   - 判据：夹具上 `start→…→abort` 与 `start→…→done` 全路径可走；重跑 next 幂等（不重复 fill/confirm）；事件流含真实退出码
   - 风险：中（状态机边角多——靠测试矩阵钉住）
2. **六类工单校验器**：triage 枚举/draft frontmatter+占位符/implement diff⊆授权/review 结论在节/closeout 全勾+证据/deploy-prep 三件 done
   - 判据：测试夹具逐类正例+负例（占位符残留、越权文件、未勾验各拦截一次）
   - 风险：低
3. **观测面**：stdout 阶段条 + PIPELINE-STOP 末行 + status（--adopt/--json）+ watch 轮询 reprint
   - 判据：测试断言末行格式；watch 手测（Git Bash）可退出不残留进程
   - 风险：低
4. **命令文档 + 互引**：pipeline-run.md 驱动协议；new-task.md/AGENTS.md 各一行
   - 判据：workflows-check/lint 类检查通过；sync-hosts --diff 0 漂移
   - 风险：低
5. **pipeline-run.test.mjs**：夹具树 + 用例矩阵（与任务 1-3 判据一一对应）
   - 判据：`node templates/_agents/scripts/pipeline-run.test.mjs` 独立全绿；进 npm test（run-tests.mjs 通配发现）；CI shipped 套件同绿
   - 风险：中（Windows 路径/换行差异——沿用既有 *.test.mjs 的跨平台处理惯例）
6. **同步与收尾**：sync 收养 → sync-hosts --apply → doctor/source-sync-check 全绿
   - 判据：source-sync-check --diff 0 命中；doctor 无新增 FAIL/WARN
   - 风险：低

## 执行顺序

1 → 2 → 3 →（4 可与 5 并行）→ 5 → 6；2 依赖 1 的工单结构，5 依赖 1-3 的判据面，6 最后（收养后不再改包源，否则重跑 sync）。
实现本体走本仓 build 规则：委派 implementer 不可行（主体为单文件大状态机，边界在单文件内由主智能体实现更可控）——本任务主智能体自做，delegations.md 记自做行。

## 验证计划

- 静态门：`npm test`（含新 pipeline-run.test.mjs，templates 侧）+ CI shipped 套件（.agents 侧同字节验证）
- 引擎门：`node .agents/scripts/verify.mjs`（npm test + check-loop）
- 双源门：`bin/flow-kit.mjs doctor` + `.agents/scripts/source-sync-check.mjs --diff`（0 命中）+ `sync-hosts --diff`（0 漂移）
- **演练矩阵（真实穿越，每路径≥1）**：L0 docs（真实小改）/ L1 小改 / L2 含 spec / incident / verify-only——每次核对：文档状态迁移正确、confirmations.jsonl 有行、git 提交链完整、verify.mjs 全绿
- **跨宿主**：人工终端裸 CLI 手驱一轮（模拟无宿主 AI）
- **负例**：前置未过（入口未确认即 next 到 spec 段）正确停机透传 exit 2；确认驳回走 abort --to 显式留档；占位符残留/越权 diff/未勾验三类校验拦截
- L2 契约比对：工单 schema 与 run 事件流字段在测试中断言键集（防悄悄漂移）；命令文档 frontmatter 过 sync-hosts 对齐检查

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现——禁从 draft 直跳 done。
- 确认结果：approved（2026-10-02 用户对话内确认）；done（2026-10-02 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门）——2026-10-02 用户对话内一句「确认」合并放行，台账 plan approved（58109347）+ 改动清单对话留痕
- 复核：L2 推荐独立复核（用户已选择跳过 spec 预审；实现后 test 阶段是否补独立复核由用户届时拍板）
