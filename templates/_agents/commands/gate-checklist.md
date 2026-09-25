---
description: 三处口径一致性检查（doctor §检查项 ↔ check-loop §检查项，显式配对登记表 + 断档/未登记告警）
stage: helper（横向工具，不占 6 阶段）
triggers:
  - "三处口径对账"
  - "改了 doctor 后跑这个"
  - "改了 check-loop 后跑这个"
  - "扫一下口径一致性"
delegation:
  - role: implementer
    instructions: .agents/roles/implementer.md
    when: 用户已确认同步范围（发现断档/未登记后修 doctor / check-loop / 登记表时）
    required: false
    fallback: main
approval_required: true
next: .agents/commands/build.md（缺点属 build 改 doctor / check-loop 未对账导致的，修复后回 build）
---

# Gate-Checklist · 三处口径一致性（显式配对登记表）

> `src/doctor.mjs` § 检查项 ↔ `.agents/scripts/check-loop.sh` § 检查项，按脚本内 **PAIRS 登记表**对照。
> 任何一处加新检查项，另一处不会自动同步——本工具报「未登记」；检查项被删/改号而登记未跟报「断档」。
> 只报告不修复（B-b 决策）：缺点暴露给用户拍板，本工具不自动同步；exit 恒 0。

## 何时跑

- 改 `src/doctor.mjs` 加新 § 检查项后（同时须登记 PAIRS）
- 改 `.agents/scripts/check-loop.sh` 加新 § 检查项后（同时须登记 PAIRS）
- 怀疑两处口径不一致时
- 不跑：仅改既有检查项的提示文案（不动 § 项与登记表）

## 登记表纪律（契约）

`templates/_agents/scripts/gate-checklist.mjs` 内 **PAIRS** 是配对单源，三选一登记：

| 形态 | 写法 | 含义 |
|------|------|------|
| 直接配对 | `{ doctor: 'N', cl: 'M' }` | 同一检查两处实现 |
| 声明独有 | `{ doctor: 'N', cl: null }` | doctor 装户体检面，无 check-loop 对应（原 intent 拍板只报告不修复） |
| 经 §7 覆盖 | `{ doctor: '7', cl: 'M' }` | doctor §7 整体运行 check-loop，#M 自动流入 doctor |

- 加新 § 检查项不登记 → 工具报「未登记」（新检查项没对账——核心信号）
- 删/改检查项不动登记表 → 工具报「断档」
- 关键词匹配已退役（2026-09-25 registry 重写：实测 18×14 项只匹配 2、28 条噪声缺点，真漏点不可见）

## 怎么跑

```bash
node .agents/scripts/gate-checklist.mjs --diff   # 人类可读（默认）
node .agents/scripts/gate-checklist.mjs --json   # 机器可读
```

输出四段：总览计数 → 对照表（登记表展开）→ 断档（如有）→ 未登记（如有）；全绿时输出「登记完整」。

### 输出示例

```
▶ flow-kit gate-checklist --diff（显式配对登记表）
  doctor §检查项: 12  |  check-loop §检查项: 14  |  直接配对 2 + 经 §7 覆盖 12 + 声明独有 9
  对照表（登记表展开）:
    ✓ §5 占位符残留 ↔ #2 模板字段占位符残留(YYYY-MM-DD / <主题> 等…)（占位符残留）
    ● §1 Node 版本（声明独有：Node 版本——装户体检独有）
    ✓ §7 check-loop ↔ #1 入口文档/spec/plan 同名配对(…（经 §7 整体运行覆盖）
  ✅ 登记完整（0 断档 / 0 未登记）
```

### 自验

```bash
node .agents/scripts/gate-checklist.test.mjs   # 13 场景全过
npm test                                       # 含 gate-checklist 套件
```

## 边界（不要做）

- 不要把「登记完整」当作强制门 —— B-b 决策「只报告不修复」：断档/未登记暴露给 follow-up，exit 恒 0
- 不要改 doctor / check-loop 检查项来消音 —— 登记表才是该改的地方（配对 / 独有 / 经 §7 三选一）
- 不要扩展到看板告警 —— 看板当前无告警规则（gen-wiki-board.mjs 不做判定），扩展超出范围
- 不要绕过登记直接改解析正则 —— 解析面只认 doctor `// N.` 节注释与 check-loop `# N.` 项注释（既有稳定结构）

## 不在本次同步范围

- `.agents/board/` 看板告警（无告警规则）
- `wiki/知识沉淀总览.html` 渲染（数据来源是 workflow/INDEX.md 与 wiki 目录，非本工具对照）
- `flow-kit sync` managed 台账追踪（gate-checklist 不在 managed 范围）

## 相关留痕

- intent（登记表重写）：`workflow/intents/2026-09-25-gate-checklist-registry.md`
- intent（工具首建）：`workflow/intents/2026-09-25-gate-checklist.md`
- 父 incident：`workflow/incidents/2026-09-25-wf-runtime.md`（owned 漂移未对账，催生本工具）
