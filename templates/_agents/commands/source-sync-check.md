---
description: 装户面同步一致性检查（包源 templates/_agents/ vs 装副本 .agents/ 三类差异：缺失 / 孤儿 / 漂移）
stage: helper（横向工具，不占 6 阶段）
triggers:
  - "改了包源同步了吗"
  - "装了装副本同步了吗"
  - "扫一下装户面漂移"
  - "source-sync 跑一下"
delegation:
  - role: implementer
    instructions: .agents/roles/implementer.md
    when: 用户已确认同步范围（发现漂移后修包源或装副本时）
    required: false
    fallback: main
approval_required: true
next: .agents/commands/build.md（漂移属 build 改包源未同步导致的，修复后回 build）
---

# Source-Sync-Check · 装户面同步一致性

> `templates/_agents/` 包源 vs `.agents/` 装副本——三类差异报告：缺失 / 孤儿 / 漂移。
> managed 文件由 `flow-kit sync` 跟踪；owned 文件由 `flow-kit doctor` §6.6 校验——本工具补"两者都没扫"的真空地带（结构级差异）。

## 何时跑

- 改 `templates/_agents/*` 包源后
- 怀疑装副本未跟包源更新
- 体检装副本完整性（清理前 / 发版前）
- 不跑：仅改装副本 `.agents/*`（B-b 决策「只报告」+ 不反向同步）

## 怎么跑

### 默认 `--diff`（仅报告）

```
node .agents/scripts/source-sync-check.mjs --diff
node .agents/scripts/source-sync-check.mjs --json                       # 机器可读
node .agents/scripts/source-sync-check.mjs --pkg-root <path> --target <path>   # 自定义路径
```

输出三类：
- **缺失**（missing）——包源有 / 装副本无（如新增文件 init 未执行）
- **孤儿**（orphan）——包源无 / 装副本有（如历史残留 / 用户本地添加）
- **漂移**（drift）——两者都有但 sha 不一致（如包源改了装副本未跟）

**排除**：
- `templates/_agents/cache/`（运行时缓存，与 `flow-kit sync` 既有约定一致）
- `.agents/kit.json` / `.agents/settings.json`（init 渲染产物，不属双源）

### 输出示例

```
▶ flow-kit source-sync-check --diff
  包源 (templates/_agents/) 49 份  |  装副本 (.agents/) 49 份
  缺失（包源有 / 装副本 无）1：
    - scripts/source-sync-check.mjs
  孤儿（包源无 / 装副本 有）1：
    - hooks/commit-check.config.json
  漂移（包源装副本都有但 sha 不一致）3：
    - commands/maintain.md  pkg=3782b695…  tgt=26203f7b…
    - notes/runtime-env.md  pkg=aedde1ba…  tgt=ad08441e…
    - scripts/ensure-board.mjs  pkg=e66653b0…  tgt=b6f3cc9b…
```

### 自验

```
node .agents/scripts/source-sync-check.test.mjs   # 11 场景全过
npm test                                            # 含 source-sync-check 套件
flow-kit doctor                                     # 10/0/0
```

## 边界（不要做）

- 不要自动化同步（B-b 决策「只报告不修复」——与 `gate-checklist` 同源）
- 不改 managed 台账跟踪逻辑（`sync.mjs` 不动）
- 不改 owned 漂移校验（`doctor.mjs` §6.6 不动）
- 不反向同步——装副本独自有文件（如 hooks/commit-check.config.json）可能是装户配置，不应被删
- 不检查 4 宿主 `modules/hosts/` 薄适配漂移（那是 `flow-kit sync-hosts` 范围）

## 当前已识别的真实漂点（首次实测，2026-09-25）

- **缺失**：本工具写完后未同步装副本（预期内——随本次 commit 解决）
- **孤儿**：`.agents/hooks/commit-check.config.json`（装副本独有，疑似装户配置）
- **漂移**：`commands/maintain.md` / `notes/runtime-env.md` / `scripts/ensure-board.mjs`

修复留后续 incident / intent 跟踪（不在本次范围）。

## 与既有工具的关系

| 工具 | 作用域 | 算法 |
|---|---|---|
| `flow-kit sync` | managed 文件（kit.json 台账跟踪）| 三态覆盖 + 加新 + 报错缺 |
| `flow-kit doctor` §6.6 | owned 文件（kit.owned 哈希比对）| 盘面 sha vs 台账哈希 |
| **`flow-kit source-sync-check`** | **所有文件结构（包源 ↔ 装副本全集）** | **sha 全量比对 + 缺失/孤儿分类** |

三者互补，不重叠。

## 相关留痕

- intent：`workflow/intents/2026-09-25-source-sync-check.md`
- plan：`workflow/plans/2026-09-25-source-sync-check.md`
- 父 incident：`workflow/incidents/2026-09-25-wf-runtime.md`（包源改了装副本未同步——本工具预防性体检）