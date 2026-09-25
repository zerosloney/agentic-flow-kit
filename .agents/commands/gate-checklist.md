---
description: 三处口径一致性检查（doctor §检查项 ↔ check-loop §检查项对照表 + 缺点告警）
stage: helper（横向工具，不占 6 阶段）
triggers:
  - "三处口径对账"
  - "改了 doctor 后跑这个"
  - "改了 check-loop 后跑这个"
  - "扫一下口径一致性"
delegation:
  - role: implementer
    instructions: .agents/roles/implementer.md
    when: 用户已确认同步范围（发现缺点后修 doctor / check-loop 时）
    required: false
    fallback: main
approval_required: true
next: .agents/commands/build.md（缺点属 build 改 doctor / check-loop 未对账导致的，修复后回 build）
---

# Gate-Checklist · 三处口径一致性

> `src/doctor.mjs` § 检查项 ↔ `.agents/scripts/check-loop.sh` § 检查项 一一对照表 + 缺点告警。
> 任何一处加新检查项，另一处不会自动同步——本工具报告缺点，由用户拍板是否补齐。
> 装户侧：`flow-kit doctor` / `git commit` 时跑本工具可作为附加门禁（未启用）。

## 何时跑

- 改 `src/doctor.mjs` 加新 § 检查项后
- 改 `.agents/scripts/check-loop.sh` 加新 § 检查项后
- 怀疑两处口径不一致时
- 不跑：仅改既有检查项的细节（标题 / 提示文案）；不改 §项 数

## 怎么跑

### 默认 `--diff`（仅报告）

```
node .agents/scripts/gate-checklist.mjs --diff
node .agents/scripts/gate-checklist.mjs --json   # 机器可读
```

输出三类：
- **doctor §检查项 N | check-loop §检查项 M | 匹配 K** —— 总览
- **对照表**：每个匹配条目 + 「by 关键字」（如 `[Node]`、`[占位符]`、`[INDEX]`）
- **缺点（任一处有而另一边无）**：
  - `⚠️ doctor 仅有：...` —— check-loop 缺对应检查项
  - `⚠️ check-loop 仅有：...` —— doctor 缺对应检查项

### 输出示例

```
▶ flow-kit gate-checklist --diff
  doctor §检查项: 10  |  check-loop §检查项: 14  |  匹配: 1
  对照表:
    ✓ 占位符残留  处 (WARN)  ↔  #2 模板字段占位符残留 [占位符]
  缺点（任一处有而另一边无）:
    ⚠️  doctor 仅有: FAIL Node 过低（Node ${process.versions.node} 过低）
    ⚠️  doctor 仅有: FAIL 布局缺失：${m...
    ⚠️  check-loop 仅有: #1 [hard-block] 入口文档/spec/plan 同名配对
```

### 自验

```
node .agents/scripts/gate-checklist.test.mjs   # 10 场景全过
npm test                                       # 含 gate-checklist 套件
```

## 边界（不要做）

- 不要把"匹配率高"当作目标 —— B-b 决策「只报告不修复」：缺点暴露给 follow-up，本工具不做强制同步
- 不要扩展到看板告警 —— 看板当前无告警规则（gen-wiki-board.mjs 不做判定），扩展超出范围
- 不要修改 doctor / check-loop 既有检查项 —— 本工具只读不改两处源码
- 不要加新关键字到 KEYWORD_ALIASES 而不更新本文件 —— 关键字表是契约，新增需 plan 流程

## 不在本次同步范围

- `.agents/board/` 看板告警（无告警规则，gen-wiki-board.mjs 不做判定）
- `wiki/知识沉淀总览.html` 渲染（数据来源是 workflow/INDEX.md 与 wiki 目录，非本工具对照）
- `flow-kit sync` managed 台账追踪（gate-checklist 不在 managed 范围）

## 当前已识别的真实漏点（intent 决策 2：只报告不修复）

基于工具首次跑（2026-09-25）：
- **doctor 独有** 8 项：Node 版本 / 目录布局 / git 仓库 / managed / delegations / owned 漂移 / 跨宿主薄适配 / check-loop 干净
- **check-loop 独有** 12 项：配对断裂 / incidents 复盘 / 引用有效 / 状态字段 / Adapter / 阶段索引 / 验收对账 / 文件名 / 级别 vs 迁移 / INDEX / 模块合法性 / 预算

修复留后续 incident / intent 跟踪。

## 相关留痕

- intent：`workflow/intents/2026-09-25-gate-checklist.md`
- plan：`workflow/plans/2026-09-25-gate-checklist.md`
- 父 incident：`workflow/incidents/2026-09-25-wf-runtime.md`（owned 漂移未对账，催生本工具）