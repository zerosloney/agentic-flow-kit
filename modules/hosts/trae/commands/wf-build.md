---
name: wf-build
description: Build 阶段 · 起 plan + 实现代码 + 自验（两道确认门，确认后才动代码）
---

# Build · 起 plan + 写代码

> AI 起草 plan,用户确认;进计划模式列改动,用户确认;最后才动代码。两道确认门。

## 执行

### 起草 plan

1. 确认同名入口文档（approved intent 或已确认的 incident）+ spec（若 L2/L3）均已确认；否则回上一阶段（fill/confirm 未过即拒）
2. 起草 plan:
   - 复制 `workflow/plans/_TEMPLATE.md` → `workflow/plans/YYYY-MM-DD-<主题>.md`(与入口文档同名)
   - L2/L3 按 4 节填写:改动方案 / 任务拆解(每个任务有判据) / 执行顺序 / 验证计划（与 fill-plan.mjs 单源一致）
   - L1 使用 Quick-Plan 极简三节:改动方案 / 约束与风险(原 Spec 核心) / 验证计划；多文件多步骤时可补任务拆解/执行顺序
3. 停下,输出 plan 草稿全文给用户过目,一句"可以"即确认。**逐件确认**:入口文档 / spec / plan 各自的确认点不得并作一次,plan 草稿须全文过目(不接受摘要代替)。**逐件配逐件原话**:`--delegated` 每次传当次实际放行的措辞,不复用同句——复用同句使台账 quote 失去分辨力(事后对质看不出放行的是哪一件);原因与根治见 workflow/papercuts.md 2026-09-28
**确认落态唯一入口**（2026-09-27 起）：用户在终端跑 `node .agents/scripts/confirm-doc.mjs <path>` 键入「可以」（draft→approved / approved→done；对话内明确确认后 AI 可 `--delegated "<原话>"` 代录，台账如实记 source/quote——**逐件调用 + 逐件原话**（一次一份，build.md「逐件确认」口径；多份并录被 confirm-doc 拒绝。--delegated 每次传当次实际放行的措辞，不复用同句——复用同句使台账 quote 失去分辨力））。check-loop 15 如实口径：缺记录/指纹不配对 → hard-block 拦截；伪造台账本地不可机器防，留痕供事后对质；done 内容绑定（2026-09-28 起）——关单编辑（勾验/回填）先于 done 确认、confirm-doc 是最后一次写入，此后修订走 superseded 或新 intent。
4. 确认后 → plan 状态 draft → approved,并在 plan 内补「确认与复核」节(确认结果 + 日期)。确认环节须在文档留痕:`approved` 是确认的机器可见态,`done` 只在关单出现,禁从 `draft` 直跳 `done`;确认后立即 `docs(workflow)` 单独提交留痕(根 `AGENTS.md` 提交约定;check-loop 检查 14 口径)

### 进计划模式列改动

5. **不要直接动代码**。先进「计划模式」:
   - **先拉同模块历史坑**：按入口文档 `模块:` 跑 `node .agents/scripts/kb-search.mjs --scope workflow --module <token> "<关键词>"`——命中 incident 的根因 / 防复发条目列入改动自查
   - 列改动文件清单(读后改 vs 新建)
   - 列步骤(改 X 文件做 Y → 改 Z 文件做 W)
   - **owned 文件同步**：kit.owned 列表文件（AGENTS.md / workflow 模板等）sync 不动，须列「手动同步装副本」步骤（见 incidents/2026-09-25-wf-runtime 复盘）
   - 标注触达红线(对照根 `AGENTS.md` 红线/约束相关节（如「项目适配区」「门禁与提交」）+ 改动域目录级 `AGENTS.md`（如有）)
6. 停下,等用户确认改动清单

### 实现

7. 确认后按 plan 顺序推进;每个任务对照判据自验。若任务满足 `.agents/roles/implementer.md` 的边界,主智能体可将单个工作包连同必读材料、授权文件和验收条件委派给 `implementer`;否则由主智能体执行
8. 自验:按改动域跑 `项目构建命令` / `项目类型检查命令` / `项目测试命令`(对应编译 / 前端类型检查 / 自动化测试;静态门全集见 `test.md` §1)
9. **项目架构红线**:数据访问模式、公共字段写入等以根与目录级 `AGENTS.md`(如有)红线为准,不自创旁路
10. **L3 且含 schema 变更时**:schema 变更走项目约定的维护方式(人工 SQL / 迁移工具,以目录级 `AGENTS.md` 或 spec 约束为准),不得擅自引入项目未采用的迁移机制（仅运行时 / 管线类 L3 无此约束）
11. 实现中若需偏离已确认的 plan(改公共接口 / 动 plan 未列文件 / 引新依赖 / 影响任务判据)→ 停下,向用户说明原因与影响,确认后再继续

## 技能辅助(可选,宿主级 skills)

- plan 任务多、依赖复杂时:用 `to-tickets` 拆 tracer-bullet 任务单(每张带阻塞边);结果回填 plan「任务拆解」节,不发布外部 tracker
- 后端逻辑改动:有测试基建的用 `tdd` 测试先行(红→绿→重构);整体实现纪律可用 `implement` 驱动
- 遇合并冲突:用 `resolving-merge-conflicts` 按意图逐 hunk 处理
- 技能不改变两道确认门、红线检查与委派边界

## 红线提示(本阶段高频踩)

- 红线(架构 / 数据 / 安全等)正文与豁免见根与目录级 `AGENTS.md`(如有)——已由 pre-commit 机器门强制的部分以钩子为准，写代码前先过一遍目录级 AGENTS

## 改权威源后必跑（薄适配同步防漏）

- 改 `templates/_agents/{commands,roles}/*.md` 正文后跑 `node bin/flow-kit.mjs sync-hosts --diff` → 拍板 → `--apply` 单向同步（只动正文段，frontmatter 不动）；口径与边界详见 `.agents/commands/sync-hosts.md`

## 改 doctor / check-loop 后必跑（三处口径对账）

- 改 `src/doctor.mjs` 加新 § 检查项 → 跑 `node .agents/scripts/gate-checklist.mjs --diff` 看 doctor ↔ check-loop 对照表
- 改 `.agents/scripts/check-loop.sh` 加新 § 检查项 → 同上
- 任一处有而另一边无 → 工具报"缺点"，由用户拍板是否补齐（不自动同步，B-b 决策）；详见 `.agents/commands/gate-checklist.md`

## 改包源后必跑（装户面同步一致性）

- 改 `templates/_agents/*` 包源后 → 跑 `node .agents/scripts/source-sync-check.mjs --diff` 看装副本 `.agents/` 是否同步（缺失 / 孤儿 / 漂移三类差异）
- 漂移说明包源改了装副本未跟；缺失说明新增文件 init 未执行；孤儿说明装副本独有（可能是装户配置，不删）
- **新增 managed 类文件须经 init/sync 登记，禁手动双写绕过台账**——手工同时写 `templates/_agents/` 与 `.agents/` 会绕过台账登记，使该文件永远不被 sync 升级（`doctor` 台账覆盖率检查会拦；见 incidents/2026-09-26-managed-ledger-adopt 复盘）
- 门禁边界（pre-commit 双源一致性）：比较工作树非暂存区——两侧改好、分两笔提交不拦（最终一致即可）；包源删除文件退化为「孤儿」只报告不拦，删包源须手动清理装副本残件（复核 P2-2 声明，2026-09-27 gate-hardening-p2-batch）
- B-b 决策「只报告不修复」；详见 `.agents/commands/source-sync-check.md`

## 子代理调用约定

- plan 起草、风险判断、改动清单与两道确认门由主智能体负责;仅两道确认后范围明确的工作包可委派 `implementer`,公共接口 / Schema / 依赖 / 安全 / 权限 / 破坏性操作不得委派。
- 多工作包并行 / 链式推进:编排机制(声明随 plan 草稿一并确认;确认后读 `.agents/workflows/` 按机制文档执行,`steps/` 为项目自定义步骤扩展点);详见 `.agents/workflows/_TEMPLATE.md`。
- 子智能体返回后,主智能体须检查 diff 与授权文件范围、确认未覆盖既有修改并重跑相关验证;不支持子智能体时 `fallback: main`,验收标准不变。

## 确认后

- plan 状态 → done（实现完成；intent / spec 关单在 test）
- commit：L1+ 入口文档 / spec / plan 随代码同一提交（Conventional Commits 中文 feat/fix/refactor/perf）；docs 豁免与 bootstrap 可单独 `docs(*)`
- 进 `next: .agents/commands/test.md`
