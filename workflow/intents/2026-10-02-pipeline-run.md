---
状态: done
级别: L2
risk_level: L2
日期: 2026-10-02
模块: pipeline
备注: 跨宿主全自动闭环执行器——独立 Node 脚本 pipeline-run.mjs（双源，不进 .zcode）+ 命令封装；2026-10-02 会话四轮方案修订后批准（先 ZCode 动态工作流→改独立脚本跨宿主）
确认指纹: a6b3153957bf5b35
---
# INTENT — pipeline-run

## 背景与问题

- 需求来源：用户 2026-10-02 会话委托——「构建一套全自动的工作流功能，编写完整脚本以覆盖当前 AI 工作流的全部执行路径，使其能够执行任意需求」，要求先调研后方案、方案批准后编码。
- 方案经四轮修订定稿：①ZCode 动态工作流载体 → ②用户纠偏「不用 ZCode 动态工作流脚本，单独写工作流脚本，目录不在 .zcode，可给不同宿主使用」→ 独立脚本版 → ③补可视化观测面 → ④补命令封装（`.agents/commands/pipeline-run.md`，会话内 `/pipeline-run <需求>` 一键进入驱动循环）。方案已批准（本 intent 附 Plan 面板留痕）。
- 现状缺口：六阶段闭环的确定性骨架（fill-* → confirm-doc → docs commit → verify.mjs → check-loop → 关单）已全部存在但散在各命令文档里，由宿主 AI 读 prose 自觉串联——阶段路由、门序列、修复环、查重喂给起草等全靠 AI 纪律；编排 DSL（.agents/workflows/）执行层同为 prose，journal 为自报态。
- 目标形态：把「怎么走」代码化为独立状态机脚本，AI 只在工单槽位干活（判级/起草/实现/修复/勾验），人件门到点即停原话代录——任意宿主（ZCode/Claude Code/Cursor/Codex/OpenCode/Trae/人工终端）同一命令同一协议驱动。

## 历史教训/防复发

- 检索结果：`kb-search "执行器"/"编排 自动" --type intents` 命中 4 份先例——2026-09-25-subagent-orchestration（headless runner 当天废弃）、2026-09-25-wf-runtime（编排定稿为目录约定+宿主 AI 执行）、2026-09-26-orchestration-journal-human（journal 自报非验证态）、2026-09-27-audit-gate-hardening P5（编排执行层为 prose）。
- 避坑指南：
  1. **绝不 spawn AI 会话 / 无 provider 注册表 / 不引 LLM API 依赖**（2026-09-25 废弃案红线）——脚本只做确定性状态机，AI 槽位经工单协议交还宿主执行。
  2. **凡靠 prose 纪律的环节必被绕过**（2026-09-27 confirm-gate-one-per-call / 2026-09-30 stage-gate-machine 主线）——路由/重试/门判据全部代码化；AI 不跑 next 状态不推进，跳步被 fill/confirm 前置门 exit 2 打回。
  3. **run 状态必须是脚本亲写的机器事实**（反自报 journal）——事件流含真实 gate 退出码；权威仍在 workflow/ 文档 + confirmations.jsonl，run 文件丢了可按文档现状重建。
  4. **防线双层**（2026-10-01 v09-review-defects）：命令文档管入口纪律 + 脚本机器门管绕不过；官方工具永不编造用户原话。
  5. **实现完成 ≠ 闭环完成**（2026-10-01 hybrid-governance 捆带事故）：sync 收养、sync-hosts、文档互引、测试入套件全部纳入验收。

## 目标

- 新增 `templates/_agents/scripts/pipeline-run.mjs`（装副本 `.agents/scripts/`）：`start|next|status|watch|abort` 五子命令，驱动任意需求走完六阶段闭环（triage 定级 → kb-search 查重 → 立档起草 → 确认 → L2/L3 spec+独立复核 → plan 确认 → 改动清单确认 → 实现 → 静态门修复环 → L2/L3 独立复核 → 勾验收关单 → 台账记行 → 报告），覆盖 incident 回灌与 verify-only/review 短路径、deploy-prep 到授权门。
- 工单协议：停机点写工单（目标/约束/授权文件/验收判据/kb 命中/stderr 反馈）落 stdout + run 文件；宿主按单干活；脚本机器校验产出（frontmatter 完整/无占位符/必填节非空/gate 退出码）不过不放行。
- 人件门：停机明示待确认文档与要点；`next --delegated "<原话>"` 内部逐份走 confirm-doc（source=chat-delegated，原话入账）；驳回走 `abort --to superseded|cancelled` 显式留档。
- 观测面：stdout 阶段条（每次 next 尾部）+ `watch` 轮询重绘终端视图 + `status` 全量事件流水（命令+真实退出码）；ensure-board「执行器」面板为第二优先。
- 命令封装：`templates/_agents/commands/pipeline-run.md`（frontmatter triggers/fallback + 正文驱动协议），sync-hosts 搬运至各宿主薄适配；与 new-task.md 互引一行。
- 测试：`pipeline-run.test.mjs`（CHECK_LOOP_ROOT 式根注入 + 假命令注入）进 npm test（templates 侧）与 CI shipped 套件（.agents 侧）。

## 非目标（防范围蔓延）

- 不替用户按确认门（L2/L3 与 incident 确认、上线授权、闭环宣告永远人件——fail-closed 设计使然）。
- 不 spawn AI 会话、不引 LLM API 依赖、不做 provider 注册表（红线）。
- 不修改既有脚本契约（fill-*/confirm-doc/check-loop 等只调用不改行为）。
- 不做跨宿主图形界面；ensure-board 面板为只读预警层增强，不做新看板体系。
- 定时/闲时触发（Cron/OffPeak 包装）不在本期，机制预留（start+next 循环可外包）。
- trust-mode 提级不做（本仓维持 Strict；L0/L1 无人值守属后续治理决策）。

## 约束

- 复用：既有机器门全套原样序列化（kb-search/fill-intent/fill-spec/fill-plan/confirm-doc/verify.mjs/check-loop/doctor/gen-workflow-index/git）；wf-journal 不复用（自报态语义不符，run 文件另行）。
- 不许动：既有 .agents/scripts/ 脚本行为、git hooks 判据、workflow 文档协议（frontmatter 枚举/单源）。
- 双源纪律：一切改动落包源 `templates/_agents/`，随后 `bin/flow-kit.mjs sync` 收养装副本；命令正文改动后 `sync-hosts --apply`；AGENTS.md/new-task.md 为 owned 手动同步。
- 引擎红线：新增引擎脚本必带 `.test.mjs`（check 20）；git 提交永不 `--no-verify`；Conventional Commits 中文。

## 影响面

- 模块：pipeline
- 数据库：无
- 新增宿主面契约：工单协议 schema + run 事件流 schema + 命令文档驱动协议（新消费方=各宿主 AI 与人工终端，L2 依据）
- 看板（第二优先）：ensure-board.mjs HTML 生成物加只读「执行器」面板

## 触达红线（对照 AGENTS.md）

- [x] 规则 / 契约变更：新增宿主面共享契约（工单协议 / run 事件流 / 命令文档进入跨宿主权威源 templates/_agents/commands/）→ L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → L3（不触及；run 文件为 gitignored 缓存态非数据契约）

> 同名 spec 说明如何满足：workflow/specs/2026-10-02-pipeline-run.md

## 验收标准（可测试）

- [x] pipeline-run.test.mjs 全绿并纳入 npm test 与 CI shipped 套件——覆盖状态机主路径（L0/L1/L2/incident/verify-only/review-only/deploy——仅 L3 spec-review 未在本批用例）、门退出码路径（confirm-doc exit 1/2 正确停不绕）、工单 schema、观测输出（证据：双侧各 27 组断言全绿（复核后增 4 组回归 + deploy 2 组 + managed 3 组；二轮复核 P2-A 勘误）——templates 侧与 .agents 装副本侧同跑；npm test 全套件通过；d176321）
- [x] 演练矩阵每路径≥1 次真实穿越（L0 docs / L1 小改 / L2 含 spec / incident / verify-only），每次核对四件事：文档状态迁移正确、confirmations.jsonl 台账行存在、git 提交链完整（docs 提交+代码提交）、verify.mjs 全绿（证据：L0 本仓真实穿越提交 37b552a；verify-only 本仓 run 20261002-1814-task-ulev 真实 verify.mjs exit 0；L1/L2/incident 于沙箱以真实 fill-*/confirm-doc/git 完整穿越——L2 与 L1 各成三笔链（approved→feat→关单，如沙箱 2fb1021→559bcfa→18be202）、incident 两跳至 closed（fe3c6df）；沙箱确认 quote 均明示演练性质）
- [x] 跨宿主演练：ZCode 会话经命令文档自驱一轮 + 人工终端裸 CLI 手驱一轮（模拟无宿主 AI 场景），协议一致（证据：全程会话内自驱；L0/verify-only/负例均以裸 CLI 直跑（无命令文档加载）达成 done/拦截，输出协议一致（PIPELINE-STOP 末行）——同一脚本同一协议）
- [x] 负例：前置未过正确停（如入口未确认时 fill-spec exit 2 被拦截透传）；确认驳回走 abort --to 显式放弃留档（证据：本仓 run 20261002-1814-task-8c45——跳级 --delegated 被挡仍停 triage 工单、无效枚举 gate-fail exit 2、abort 收尾；沙箱实证 spec 备注占位/intent 模块占位/越权 diff/勾验时序各拦截一次；测试套件钉住 confirm exit 1/2 透传）
- [x] 不变量核查：全程零 --no-verify；台账新增行 source 全部为 chat-delegated/tty（无伪造原话）；文档状态迁移全部经 confirm-doc（无直改）（证据：git log 全链无 --no-verify 痕迹（钩子全程在跑）；本仓台账新增 3 行（intent/spec/plan approved）均 chat-delegated + 用户原话「确认」；状态迁移唯一入口 confirm-doc，run 文件仅记事实）
- [x] 双源与适配：source-sync-check --diff 0 命中；sync-hosts --diff 0 漂移；new-task.md / AGENTS.md 互引落位（证据：source-sync-check 仅既有孤儿 trust-mode.json（gitignore 本地态）；sync-hosts 81 对对齐 0 漂移（五宿主 wf-pipeline-run.md 薄适配新建 + wf-new-task.md 正文同步）；互引随 6f1ff3e）
- [x] 终门：verify.mjs + check-loop + doctor 全绿（证据：verify.mjs 2/2 通过（npm test 全套件 + check-loop exit 0）；doctor 13 PASS/0 WARN/0 FAIL；d176321 后实跑）

> **闭环对账**：关单在 test 阶段。intent 置 done 前逐条勾验补证据。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：intent 全文（目标/非目标/约束/红线/验收标准）
- 复核：L2 不强制独立复核（L3 才要求）；spec 确认前可选 independent-reviewer 预审
