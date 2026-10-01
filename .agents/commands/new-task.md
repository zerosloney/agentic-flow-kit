---
description: AI-Native 闭环总入口:6 阶段指令索引(Plan→Design→Build→Test→Deploy→Maintain)
stage: entry
triggers:
  - "开工"
  - "发个任务"
  - "走闭环"
  - "从头跑"
approval_required: true
next: 按阶段路由
---

# New Task · 闭环总入口

> 6 阶段指令索引。AI 读 AGENTS.md 后按阶段路由,不并阶段、不跳阶段。

## 6 阶段指令索引

| 阶段 | 指令 | 触发短语 | 可委派子智能体 | 确认点 |
|------|------|---------|----------------|--------|
| **Plan** | [.agents/commands/plan.md](.agents/commands/plan.md) | "起个 intent" / "要做个 <功能>" | 无 | intent 要点确认 |
| **Design** | [.agents/commands/design.md](.agents/commands/design.md) | "起个 spec" / "intent 看过了" | `independent-reviewer`(L3) | spec 草稿确认(L3 加独立复核) |
| **Build** | [.agents/commands/build.md](.agents/commands/build.md) | "起个 plan" → "动手吧" | `implementer`(确认后、范围明确时) | plan 确认 + 动手前确认 |
| **Test** | [.agents/commands/test.md](.agents/commands/test.md) | "改完了" / "跑下 verify" | `ui-verifier`、`independent-reviewer` | 测试全过(L2/L3 独立复核)+ 关单；L1 结束 |
| **Deploy** | [.agents/commands/deploy.md](.agents/commands/deploy.md) | "可以上了" / "过 release 清单" | 无 | 仅 prod：用户确认 + release tag |
| **Maintain** | [.agents/commands/maintain.md](.agents/commands/maintain.md) | "线上出事了" / "记一笔 incident" | `implementer`(方案确认后) | 三件套要点确认 |
| **Review**(横切,不占 6 阶段) | [.agents/commands/review.md](.agents/commands/review.md) | "评审一下" / "过 review 标准" | `independent-reviewer`(L2/L3 必须独立复核) | 问题定性与合入时机确认 |

## 风险定级(第 0 步,先定级再路由)

动工前先按下表定风险级 L0-L3(就高不就低;判据细则见下节「级别判断」),级别即风险级,决定走哪条泳道——确认放事前,还是审计补事后:

| 泳道 | 级别 | 确认与审计口径 |
|------|------|---------------|
| **协作道**(敏捷优先,审计异步补) | L0 例行 / L1 实现级 | L0 直接 commit,豁免 intent;L1 快车道(intent 一句话确认 + 极简 plan)即动工。独立复核不设同步前置,check-loop 与事后 review 兜底;确认/代录可 `--batch` 批量(仅 L0/L1) |
| **防御道**(严谨优先,确认同步拦) | L2 规则/契约 / L3 数据与运行时结构 | 同步确认门:spec 确认通过方可起草 plan,plan 确认后方可动手;L3 加新会话独立复核,未确认不放行 |

> 定级结果落 intent frontmatter `risk_level`(=级别,`fill-intent.mjs` 自动写入,机器选道用);协作道勾触达红线会被 check-loop 判「红线判低」hard 拦(就高升级 L2/L3 并补同名 spec)。

## 路由判断

- **新需求 / 功能**:从 `plan.md` 进,立 **intent**(`workflow/intents/`)
- **修复类任务 / 事故**:从 `maintain.md` 进,立 **incident**(`workflow/incidents/`);incident 在 L1+ 即 **intent 等价物**(check-loop 认 incident≡intent),不必另立 intent。先检索同类历史(`node .agents/scripts/kb-search.mjs "<关键词>" --scope workflow --type incidents,plans`),有同类先读其历史三件套;再按级别走:
  - L0 → 直接修复;L1 → 立 incident 后进 `build.md` 起草并确认同名 Quick-Plan → `test.md`
 - L2/L3 → 立 incident 后进 `design.md` 起草并确认同名 spec,再进 `build.md` 起草并确认同名 plan → `test.md`
 - 仅当根因属系统性 / 门禁缺位(maintain.md 三件套「是否需要新 intent」选"是")才另立 `workflow/intents/` 同名 intent
- **改完代码要验证**:直接进 `test.md`（验证通过即关单；L1 到此结束）
- **合入前评审**:直接进 `review.md`(横切,P0/P1/P2 分级清单 + L2/L3 独立复核)
- **准备上线**:直接进 `deploy.md`（仅 prod；文档应已在 test 关单）

## 级别判断(AGENTS.md 第 3 条)

| 级别 | 改什么 | 流程 |
|------|--------|------|
| L0 | 文档/样式微调(无行为影响) | 直接 commit,豁免 intent |
| L1 | **实现级改动**(未命中 L2/L3) | 快车道:液态草稿(.zcode/drafts) $\rightarrow$ 实现 $\rightarrow$ 一键固化(`solidify-task.mjs`) |
| L2 | **规则 / 契约**(一处改、多处依赖) | 入口文档(intent / incident) + spec + plan 三件套 |
| L3 | **数据与运行时结构**(schema / 迁移 SQL / DI 链 / 认证与中间件管线) | 同 L2 + spec 新会话独立复核 |

> 级别判定同上表"改什么"列;混合改动按最高档定级。

**L2 触达面**(闭集,命中任一即 L2;本体不改但改其输入域 / 调用点校验同样命中):

1. **编码权威**:项目内「一处生成、多处消费」的编码 / 命名 / 取号规则(编码模板、序列发生器、命名空间与去重约束——具体清单按项目 AGENTS.md)
2. **共享契约**:跨模块共享的基类 / DTO 形状、跨模块公共接口签名
3. **既有接口语义**:既有参数或端点的行为变化(由失效变生效、默认值或钳制口径改变)
4. **全局横切口径**:错误响应出口、分页与校验口径、聚合投影键

> **负例(落 L1)**:纯页面表现 / 文案 / 布局 / 交互实现;纯新增端点或参数且既有行为不变;单模块内部重构且无对外契约变化。
> **自查句**:能否列出 ≥2 个受影响的消费方(模块 / 端点 / 页面)?能 → L2。
> 先例:本仓 `workflow/specs/`、`workflow/intents/` 下同类历史(kb 检索主题词)。

> **L1 是默认档**:红线全不勾即 L1,无需正列举——判级只回答「是否命中 L2 四类或 L3 结构面」。
> **L3 的「DI 链」按组合根与运行时管线理解**:DI 注册、中间件/认证管线、服务构造器依赖变更(先例:本仓 workflow/ 留痕中无 schema 变更仍定 L3 的同类历史)。

## intent 豁免(避免小改动也走完整闭环)

- **L0 新需求**:可直接处理；**L1 新需求**:立轻量 intent + plan(不必 spec)
- **docs 级改动**(AGENTS.md / workflow/ 模板 / .agents/ 脚本与 commands / yaml):豁免 intent,走 Conventional Commits 直接 commit;若同时触及代码,按代码部分级别立 intent
- **bootstrap 类改动**(引入规则本身):豁免 intent,commit message 显式声明 `bootstrap`

## 闭环兜底

- 门禁清单与判据以 `.githooks/` / `.agents/hooks/` / `check-loop.sh` 头部注释为准(本文件不复述、不写项数);hard-block = 配对断裂 / 回路断档 / 新建 done 未勾验。本地机器门只有本地钩子,禁 `--no-verify`(见根 `AGENTS.md`)。
