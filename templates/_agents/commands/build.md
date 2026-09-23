---
description: Build 阶段:起 plan + 实现代码 + 自验(确认后才动代码)
stage: Build
triggers:
  - "起个 plan"
  - "spec 没问题"
  - "开始写吧"
  - "动手吧"
  - "计划可以了"
delegation:
  - role: implementer
    instructions: .agents/roles/implementer.md
    when: plan 与改动文件清单均已确认,且工作包边界满足角色契约
    required: false
    fallback: main
approval_required: true
next: .agents/commands/test.md
---

# Build · 起 plan + 写代码

> AI 起草 plan,用户确认;进计划模式列改动,用户确认;最后才动代码。两道确认门。

## 执行

### 起草 plan

1. 确认同名入口文档（approved intent 或已确认的 incident）+ spec（若 L2/L3）均已确认；否则拒绝，回上一阶段
2. 起草 plan:
   - 复制 `workflow/plans/_TEMPLATE.md` → `workflow/plans/YYYY-MM-DD-<主题>.md`(与入口文档同名)
   - L2/L3 按 4 节填写:任务拆解(每个任务有判据) / 风险评估 / 执行顺序 / 遗留项
   - L1 默认极简两节:改动面(逐条文件+做什么) / 验证方式(一行静态门+按需 UI 实测)；仅多文件多步骤时再加任务拆解/执行顺序
   - 仍须与入口文档同名落盘
3. 停下,输出 plan 草稿全文给用户过目,一句"可以"即确认。**逐件确认**:入口文档 / spec / plan 各自的确认点不得并作一次,plan 草稿须全文过目(不接受摘要代替)
4. 确认后 → plan 状态 draft → approved,并在 plan 内补「确认与复核」节(确认结果 + 日期)。确认环节须在文档留痕:`approved` 是确认的机器可见态,`done` 只在关单出现,禁从 `draft` 直跳 `done`

### 进计划模式列改动

5. **不要直接动代码**。先进「计划模式」:
   - **先拉同模块历史坑**：按入口文档 `模块:` 跑 `node .agents/scripts/kb-search.mjs --scope workflow --module <token> "<关键词>"`——命中 incident 的根因 / 防复发条目列入改动自查
   - 列改动文件清单(读后改 vs 新建)
   - 列步骤(改 X 文件做 Y → 改 Z 文件做 W)
   - 标注触达红线(对照根 `AGENTS.md`「Working rules」+ 改动域目录级 `AGENTS.md`（如有）)
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

## 子代理调用约定

- plan 起草、风险判断、改动清单与两道确认门由主智能体负责;仅两道确认后范围明确的工作包可委派 `implementer`,公共接口 / Schema / 依赖 / 安全 / 权限 / 破坏性操作不得委派。
- 子智能体返回后,主智能体须检查 diff 与授权文件范围、确认未覆盖既有修改并重跑相关验证;不支持子智能体时 `fallback: main`,验收标准不变。

## 确认后

- plan 状态 → done（实现完成；intent / spec 关单在 test）
- commit：L1+ 入口文档 / spec / plan 随代码同一提交（Conventional Commits 中文 feat/fix/refactor/perf）；docs 豁免与 bootstrap 可单独 `docs(*)`
- 进 `next: .agents/commands/test.md`
