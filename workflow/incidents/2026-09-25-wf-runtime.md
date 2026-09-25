---
状态: closed
级别: L2
发现: 2026-09-25
模块: pipeline
配对: ../intents/2026-09-25-wf-runtime.md（done 回溯收口）/../specs/2026-09-25-wf-runtime.md /../plans/2026-09-25-wf-runtime.md
备注: 本单为 wf-runtime intent 关单条件不满足的回溯闭环：intent 标 done 但三处实装/门禁未对账，doctor hard-block + 1 WARN + 装副本引擎双源漂移。incident 即 intent 等价入口，不另立新 intent；同 L2 配对 spec/plan 收口。单笔 commit 收口（fix(workflow+engine)）；doctor 加 owned 漂移校验规则留后续 incident 跟进（不阻断本单）。
---

# INCIDENT — 2026-09-25 wf-runtime intent done 后未对账（双源漂移 + 验收未勾 + INDEX 未刷新）

## 时间线
- 2026-09-25 第四轮定稿：orchestrate.md 废止 + AGENTS.md 常驻指令 + workflows/ 机制文档 + steps/ 扩展点
- intent / spec / plan 三件套先后置 done（plan 第 40 行关单随 intent/spec 置终态）
- 2026-09-25 用户令审查当前脚本编排 workflows（mvs_fa21e85df36e418080c40137ca82922a）
- 审查产出三个未收口问题：① 装副本 AGENTS.md 缺常驻指令行 ② intent 验收末项未勾 + doctor hard-block + 1 WARN ③ workflow/INDEX.md 未刷新
- 用户对话内拍板立 incident 收口（incident 即入口，按 AGENTS.md 修复类任务等价入口口径）

## 影响面
- 仓库根 AGENTS.md（装副本）缺常驻指令行 → 任何装户宿主 AI 读 AGENTS.md 时拿不到「读 `.agents/workflows/` 编排脚本按机制文档执行」自动加载通道，编排机制运行时不可用；本仓库 dogfooding 受影响
- workflow/INDEX.md 活跃层缺 wf-runtime 三件 → workflow/INDEX.md 看板/检索对 wf-runtime 流程不可见；档案计数已含但活跃层未列
- doctor hard-block（`[验收未对账] done intent 验收标准有未勾验项:2026-09-25-wf-runtime.md`）→ `git commit` 经闭环配对门被拦，无法正常提交 wf-runtime 之后的修复（任何提交都会触发该 hard）
- doctor 1 WARN（`workflow/intents/2026-09-25-wf-runtime.md:16` 含 `<主题>` 模板占位符）= spec 表格语义占位符被 doctor 误抓为协议违反（仅噪音，不阻断）

## 根因
wf-runtime 这一轮在包源 `templates/AGENTS.md:22` 末尾追加了「多工作包编排（自动加载）：……」常驻指令，但 AGENTS.md 在 `kit.owned`（项目自持）—— `src/sync.mjs` 只动 managed 台账（51 份不含 AGENTS.md），`src/init.mjs` 仅首次 init 时合并一次骨架，后续包源加行**需手动同步装副本**，属引擎设计行为；spec 第 71 行系统改动清单列了「AGENTS.md 常驻指令」为必做项，但 plan 任务拆解（1→2→3→4）漏写「手动同步 AGENTS.md 装副本」步骤——计划阶段即漏。深层原因：AGENTS.md 双源同步机制**仅 init 时一锤子合并，无后续增量同步通道**，且 doctor 台账漂移校验不覆盖 owned 文件（本仓库现有 doctor 台账校验未触及 AGENTS.md，本次即未报）。

## 为什么之前没拦住
- **门禁**：`src/sync.mjs` 三态判定仅覆盖 managed 文件（kit.managed），owned（项目自持）按 `src/profiles.mjs#isOwned` 跳过——AGENTS.md 加行无机器强制
- **测试**：doctor 仅校验台账 51 份 managed 文件，不校验 owned 漂移；本仓库装副本 vs 包源 AGENTS.md 漂移无测试用例
- **规范**：「引擎双源纪律」AGENTS.md 第 50 行表述含糊——「引擎改动一律改 templates/，随后 sync 更新 .agents/」未点名 owned 文件需手动同步的特例；spec/plan 任务拆解模板未强制要求「列出手动同步 owned 装副本」检查项
- **plan 阶段把关**：本轮 plan 任务拆解 1→2→3→4 漏步骤 3.5「手动同步 AGENTS.md 装副本」；build.md 委派约定 / review.md 横切评审未兜住此漏

## 复盘三件套（缺一不可）

1. 结构性修复（最小集，按依赖顺序）
   - 修复动作 1：手动同步 AGENTS.md 装副本 —— 把 `templates/AGENTS.md:22` 末尾「多工作包编排（自动加载）：跑编排 / plan 执行多工作包时，读 `.agents/workflows/` 编排脚本按机制文档执行——stages 表（依赖分层 / 并行 / 重试 / gate）+ `steps/` 自定义步骤扩展点，见 `.agents/workflows/_TEMPLATE.md`。」整段原文追加到仓库根 `AGENTS.md:21` 末尾；同步刷 `kit.json` owned AGENTS.md 的 sha256
   - 修复动作 2：`node .agents/scripts/gen-workflow-index.mjs` 重生成 workflow/INDEX.md（活跃层增加 wf-runtime 三件 + 档案计数核增）
   - 修复动作 3：intent 验收末项补勾 + 补证据 —— `workflow/intents/2026-09-25-wf-runtime.md:40` 末项改 `[x]`，备注键附 commit SHA + `init.test.mjs ⑥ 3 例 PASS` 输出 + orchestrate grep 结果
   - 修复动作 4：可选 doctor 误报清理 —— 给 `<主题>` 加注释明确语义示意，或 doctor 规则豁免示例文件（`templates/_agents/workflows/_TEMPLATE.md` 第 9 行 + spec/intent 表格）
   - 影响环境：dev（本仓库装副本；templates 包源已落，无需改）
   - 是否需要新 intent：否（incident 即入口，L2 修复中即等价入口；不回退已 done 的 intent/spec/plan）

2. 防复发验证（必须落到自动化用例或回归清单条目）
   - 自动化用例：`templates/_agents/scripts/doctor.test.mjs`（或 doctor.mjs 现有套件）新增 —— ① owned 漂移校验：包源 owned 文件 vs 装副本 owned 文件 sha 比对，漂移即 FAIL；② workflow/INDEX.md 状态变更后必跑 gen 校验；③ 验收未对账 hard-block 已就位（`check-loop.test.sh PASS 新建 done 无 approved 历史 → WARN 确认态缺失 且 exit 0` 等用例覆盖）
   - 或回归清单条目：`workflow/regression-checklist.md`「防复发验证」节追加一行——AGENTS.md 装副本必须含包源 AGENTS.md:22 末尾的常驻指令行（regex 锚定）
   - 或 test 步骤：`.agents/commands/test.md` + 「AGENTS.md owned 漂移检查」单条

3. 规范条目（必须有可追溯的落点）
   - 落点 1：AGENTS.md 第 50 行「引擎双源纪律」段补一句 owned 例外 ——「`templates/` 改后 `node bin/flow-kit.mjs sync` 更新 managed 装副本；owned 文件（AGENTS.md / workflow 模板等）按本仓库情况手动同步——见 incident 2026-09-25-wf-runtime 复盘」
   - 落点 2：`.agents/commands/build.md`（或 plan.md）任务拆解模板追加「owned 装副本手动同步」强制检查项
   - 落点 3：`.agents/scripts/doctor.mjs` 加 owned 漂移校验规则（与防复发用例同源）
   - 引用：本次修复 commit SHA（修复完成后回填）+ `workflow/incidents/2026-09-25-wf-runtime.md`（本单）