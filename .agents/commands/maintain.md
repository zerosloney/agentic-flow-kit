---
description: Maintain 阶段:立 incident + 复盘三件套(修复 / 防复发 / 规范条目)
stage: Maintain
triggers:
  - "立个 incident"
  - "线上出事了"
  - "记一笔 incident"
  - "出事了,根因 xxx"
delegation:
  - role: implementer
    instructions: .agents/roles/implementer.md
    when: 用户已选定止血或结构性修复方案,复现路径与授权文件均明确,且任务满足角色契约
    required: false
    fallback: main
approval_required: true
next: .agents/commands/plan.md(若复盘需要新 intent)
---

# Maintain · 立 incident + 复盘三件套

> 修复走 incident 流程;incident 在 L1+ 即 **intent 等价物**(check-loop 已认 incident≡intent),不必另造 intent。spec/plan 与 incident 同名即闭环。

> 事故回到 Plan。复盘三件套缺一不可,防复发承诺不留在文档里。

## 执行

> **任务入口动作**：先跑 powershell -NoProfile -File .agents/scripts/ensure-board.ps1（幂等：探活 / 旧代码自动重启 / 全新启动才弹浏览器），完成后在对话贴看板链接 http://127.0.0.1:8933 。

### 0. 紧急止血(仍在事故中时)

1. AI 先诊断:读日志 + 代码,给出止血选项(版本回退 / 数据回滚 / 热修 / 降级 / 暂不处理)与各自影响面、耗时
   - **版本回退**(代码 / 配置,无数据影响):回退到上一 `release/<日期>` tag——运行时 / 管线类事故(认证管线 / DI 注册 / 中间件)的首选,须确认上一 tag 可复现构建
   - **数据回滚**(库侧):按 `deploy.md` §5 的回滚预案执行——须有备份点、回滚 SQL 已在 dev 演练过;涉及数据安全,不得委派子智能体判断
2. 止血方案由用户拍板;AI 只执行选定方案,不自行推送修复
3. 热修代码后仍须补跑 `test.md` 静态门;止血完成再进下面的复盘流程(时间线从本节记起)

### 1. 起草 incident

1. **先检索同类 incident**：`node .agents/scripts/kb-search.mjs "<关键词>" --scope workflow --type incidents`——命中同类先读其「根因 / 复盘三件套」，本次三件套须引用其防复发条目（review.md P2 对账项）
2. 复制 `workflow/incidents/_TEMPLATE.md` → `workflow/incidents/YYYY-MM-DD-<主题>.md`（frontmatter 填 `模块:`，词表见 `.agents/workflow-modules.txt`）
3. 填 4 节:时间线(发现→定位→止血→恢复,带时刻) / 影响面(页面/接口/数据范围) / 根因(一句话+深层原因) / 为什么之前没拦住(门禁/测试/规范各查一遍)

### 2. 起草复盘三件套(缺一不可)

> 目的:让事故真正回到 Plan,不让「防复发」承诺停留在文档里。

**1. 结构性修复**
- 修复 commit:<SHA + 改动文件清单>
- 影响环境:dev / staging / prod(已上线模块若波及 prod,需附影响用户数 / 持续时长 / 是否回滚)
- 是否需要新 intent(本 incident 即 intent 等价物,check-loop 已认 incident≡intent,spec/plan 与 incident 同名即闭环):
  - 否 → 理由:<根因属实现 bug、单点修复已完成,incident 已含目标/约束,等同 intent>
  - 是 → 根因属「门禁缺位 / 规范未落地 / 系统性问题」时强制立 `workflow/intents/YYYY-MM-DD-<主题>.md` 追踪(即使结构性修复已完成)

**2. 防复发验证**(必须落到自动化用例或回归条目,禁止只写「已人工验证」)
- 自动化用例:项目测试套件 `<文件>`(`<用例名 / 数量>`)
- 或 verify 步骤:`.agents/commands/test.md` + <具体操作>
- 或回归清单条目:`workflow/regression-checklist.md` 防复发验证节(追加一行)

**3. 规范条目**(必须有可追溯落点)
- 落点优先级(取最前者可行即止):`workflow/regression-checklist.md` 回归条目 / `.agents/hooks/` 或 `tests/` 断言(机器门)→ `.agents/skills/`、`.agents/notes/` → `workflow/` 文档 → `.agents/commands/`
- **根 `AGENTS.md` 不再是落点**;**入册门槛**:已由机器门强制的内容只留一行指针,禁止在常驻面复述;**一进一出**:落点为常驻面时须在本 commit 内删除或下沉一条被取代条目
- 常驻面体积预算由 pre-commit 硬拦(`sh .agents/scripts/rule-budget.sh --staged`,表 `.agents/rule-budgets.txt`)——超限先删再增
- 引用:commit <SHA> / 文件:<路径>#L<行>;若无新增条目,理由:<已有条目覆盖,说明条目位置>

### 3. 起草后停下

输出草稿全文给用户过目;确认后才执行三件套落地。**确认点不合并**：incident 草稿、spec、plan 各自过目确认（plan 的两道门见 `build.md`）；确认后立即留痕（spec/plan 状态 `approved` + 「确认与复核」节，incident 时间线补「用户确认」条目），`done` 只在关单出现。

### 4. 确认后落地

1. **开工前先配 plan**：复制 `workflow/plans/_TEMPLATE.md` 建 incident 同名 plan（L1 极简形态填「改动面 + 验证方式」两节即可）——incident≡intent 免掉的是 intent，**plan 不可免**（pre-commit 增量配对门禁与 pre-push check-loop 均按同名硬拦）
2. 结构性修复:L1 走 `build.md` → `test.md`;L2/L3 先走 `design.md` 再进 `build.md` → `test.md`
3. 三件套落地:防复发验证按 §2②、规范条目按 §2③ 落点优先级逐条落
4. 若选「需要新 intent」→ 进 `next: .agents/commands/plan.md` 立新 intent 追踪

## 技能辅助(可选,宿主级 skills)

- 根因诊断:难复现/跨层问题用 `diagnosing-bugs` 走诊断循环(红→最小化→假设→插桩→修复→回归)
- 事故定性/分级:参考 `triage` 技能的状态机思路;产出仍落 incident 模板,不引外部 tracker
- 处置决策需用户离线拍板:用 `to-questionnaire` 生成问卷

## 子代理调用约定

- 事故诊断、止血选项、根因定性、incident 与三件套起草均由主智能体负责,不委派;用户选定止血方案后,仅有明确复现路径、授权文件与验收条件的局部热修可委派 `implementer`(数据 / Schema / 权限 / 安全 / 破坏性操作不得委派)。
- 常规结构性修复按级别回流(L1 走 `build.md`;L2/L3 走 `design.md`),不在 Maintain 绕过前置门禁;子智能体返回后由主智能体检查 diff 并补跑 `test.md`。

## 确认后

- incident 状态 → fixed(三件套全落地)
- 防复发用例通过后 → closed
- 若需新 intent → 进 `next: .agents/commands/plan.md`
