---
状态: approved
级别: L2
日期: 2026-09-28
模块: pipeline
备注: 同名 incident：../incidents/2026-09-28-check8-git-anchor.md（检查 8 生效日锚取文件名，hard 门可被平凡绕过）。L2：改 hard 门判据 + 新增共享 git 索引；检查项编号不变。
确认指纹: b00f9253ee288079
---
# SPEC — 检查 8 生效日锚改 git 首次加入日期

## 功能行为

### 生效日锚：文件名前 10 字符 → 文件首次加入 git 的日期

检查 8（验收标准对账，**hard-block**）的受管判定改为：

- **旧**：`filedate = base.slice(0, 10)`（文件名前 10 字符）→ `isNew = filedate >= '2026-09-12'`
- **新**：`adddate = addedDateOf(intent)`（该文件**首次加入仓库**的提交日期，`YYYY-MM-DD`）→ `isNew = adddate !== '' && adddate >= accCutoff`

**为什么换**：文件名 `YYYY-MM-DD-` 前缀是项目命名规范的**强制组成部分**，作者每次建档都在写它——「写早」零成本、顺手即发生，而检查 8 是 hard 门（有未勾验项即拦 push），等于一条 hard 门可被平凡绕过。git 首次加入日期**不可手填**，该通道关闭。

**为什么是这个字段而非其他**：
- 不用台账（`confirmations.jsonl`）：检查 8 覆盖的是 **all done intent**，而台账只覆盖走过确认门的文档（存量大量无行）——覆盖面对不上
- 不用 frontmatter 日期：同样可手填，只是成本高于文件名
- 用 git 首次加入：**唯一不可手填且全覆盖**的事实；且**已有现成先例**——检查 10 早已用 `git log --diff-filter=A` 取「加入提交」

### 共享索引 `addedDates`（新增，供检查 8 与检查 10 复用）

现状：检查 10 内联了一份 `git log --diff-filter=A --format=@%H --name-only` 的解析逻辑（文件 → 首次加入 commit）。本次**提为模块级共享索引**，避免两处各查一遍 git：

```js
const addedDates = (() => {
  if (gitOut(['rev-parse', '--git-dir']) === null) return null;      // 非 git → null
  const log = gitOut(['log', '--diff-filter=A', '--format=@%aI', '--name-only']);
  if (log === null) return null;                                      // 命令失败 → null
  const m = new Map();
  let cur = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@')) { cur = line.slice(1); continue; }
    if (line.trim() && cur && !m.has(line.trim())) m.set(line.trim(), cur);  // 新→旧序首遇 = 最早
  }
  return m;
})();
const addedDateOf = (absDoc) => {                       // 不可判定返回 ''
  if (!addedDates) return '';
  const iso = addedDates.get(path.relative(ROOT, absDoc).split(path.sep).join('/'));
  return iso ? iso.slice(0, 10) : '';
};
```

**性能**：一次 git 调用全量建表（实测本仓 `git log --diff-filter=A --name-only -- workflow` ≈ 0.08s），不逐文件 fork ——沿用检查 10 的既有成本特征（它本来就在跑这条命令）。

### 边界与异常

- **非 git 环境**（fixture / 非仓库）：`addedDates === null` → `addedDateOf` 返回 `''` → `isNew = false` → **走存量口径**（不 hard 拦、计入存量聚合 warning）。这是**有意的 fail-open**：不可判定时宁可放过（advisory 层），不放 hard——与检查 8 既有「存量聚合 warning」语义一致，不引入新的误拦
- **文件已提交但不在 `--diff-filter=A` 结果里**（理论边界：历史重写 / 从别处 rename 进来）：`addedDateOf` 返回 `''` → 同上走存量口径，不误报
- **`git log` 失败**（超时 / 非仓库边界）：返回 `null` → 同上，不 fail-loud
- **未提交的新档**（工作区有、HEAD 无）：git 查不到 → `''` → 存量口径。**注意**：仓库模式下 `docFiles()` 本就只扫 HEAD 已提交内容，而 check-loop 的仓库模式又只扫 tracked——故该情形在正常流程下不出现

### 检查 10 的复用（不改判据，仅去掉重复实现）

检查 10 原内联的 `git log --diff-filter=A` 解析**改为复用 `addedDates`**（取其 commit 号仍需 `%H` 与文件清单的对应——**注意**：`addedDates` 存的是**日期** `%aI`，检查 10 需要的是 **commit 号** `%H` 以比对「同一提交触及的迁移文件」）。

**因此两者不能共用同一份 Map**：
- `addedDates`：`文件 → 首次加入日期`（检查 8 用）
- 检查 10 需要：`文件 → 首次加入 commit` 且还要 `commit → 文件清单`（判断同提交是否有迁移 SQL）

**决策**：**本次不为检查 10 做重构**——它的逻辑（`addpath` + `cfiles` 两份 Map）与检查 8 的需求不同构，硬合并会引入耦合且无收益。故 `addedDates` 仅服务检查 8，新增一次 `--format=@%aI --name-only` 查询；检查 10 保持原样。

> 权衡说明：这意味着检查 8 新增一次 git 查询（实测 ~0.08s）。相对于 check-loop 已有的多次 git 调用（检查 10 / 14 各一次 `git log`），增量可接受；换取的是两处判据互不耦合、改动面最小。

## 数据流

```
git log --diff-filter=A --format=@%aI --name-only      （一次，模块级）
   └─→ addedDates: Map<repo相对路径, ISO 时间>
          └─→ addedDateOf(doc): 取前 10 字符 → 'YYYY-MM-DD'（不可判定 → ''）
                 └─→ 检查 8: isNew = adddate >= accCutoff
                        ├─ true  + 未勾验/缺验收节 → hard-block（既有逻辑）
                        └─ false / '' → 存量口径（既有聚合 warning）
```

纯只读，无写入、无台账交互。

## 系统改动

| 件 | 改动 | 对应 plan 任务 |
|---|---|---|
| `templates/_agents/scripts/check-loop.mjs` | 新增模块级 `addedDates` + `addedDateOf`；检查 8 的 `isNew` 锚改为 `addedDateOf`；头注释检查 8 段改写（**不改编号**）；检查 10 **保持原样** | T1 |
| `templates/_agents/scripts/check-loop.test.mjs` | 既有 4 条检查 8 场景改造为真 git fixture（意图与断言强度不变）；新增 3 条：核心回归 / 非 git 退化 / 对照 | T2 |
| `workflow/README.md`（owned，手改即权威） | 「审计边界」节：检查 8 移出「未收窄」清单并写明新锚；12/14 两条 **advisory** 与 hard 门**分档表述** | T3 |
| 装副本 `.agents/scripts/check-loop.mjs`、`.agents/scripts/check-loop.test.mjs`、`.agents/kit.json` | 经 `flow-kit sync` 下发，无手改 | T4 |

> 注：本次**不涉及** commands / roles 正文，故**不需要** `sync-hosts --apply`。

## 约束遵守映射

- **双源纪律**：引擎改动一律改 `templates/`，随后 sync 刷装副本 + kit.json 台账 sha；改后 `source-sync-check --diff` 须 0 差异——T1/T2/T4 遵守
- **检查项编号不增删改号**：只在 8 内改判据，头注释文字同步；`gate-checklist` PAIRS 登记表**不动**（id 不变）
- **常驻面预算**：改动集不含 AGENTS.md / commands（`workflow/README.md` 为 owned 且不在预算表），不触预算
- **`--no-verify` 禁令**：门禁被拦时按提示修完原路重试
- **提交约定**：incident / spec / plan 随代码同一提交；各确认点确认后立即 `docs(workflow)` 单独提交留痕
- **存量不误伤**：换锚后非 git / 不可判定一律走存量口径（fail-open 于 hard 层），与既有「存量聚合 warning」语义一致

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| **换锚导致本仓存量 done intent 被误 hard 拦** | 中 | 本仓全部 workflow 文档均已提交（仓库模式只扫 HEAD tracked），故都能取到加入日期；**实测改后 advisory 条数须与改前逐条一致（8 条）**，任何新增都要能逐条解释。T1 自查列此为硬要求 |
| 既有 4 条检查 8 用例改造后**失去"非 git 环境"覆盖** | 中 | 专门新增一条「非 git 仓 → 不可判定走存量口径（不误报 hard）」用例补上；并在测试注释说明改造理由（意图不变，只是让"新建"由 git 事实判定） |
| 实现时「顺手」把既有用例断言放宽（换锚后它们会红，容易改成"改到绿"） | 中 | T2 硬要求：**只改 fixture 与注释、不放宽断言强度**；核心回归用例必须在旧锚下变红（变异自验） |
| 新增一次 git 查询拖慢 check-loop | 低 | 一次全量调用（实测 ~0.08s），不逐文件 fork；相较 check-loop 既有多次 git 调用增量可接受 |
| `--diff-filter=A` 对「rename 进来」的文档取不到加入记录 → 该档走存量口径 | 低 | fail-open 于 hard 层（不误拦）；本仓无此类历史 |
| 回滚难度 | 低 | 单文件判据段 + 测试 + 一处文档；`git revert` 单提交即回；无数据迁移 |

## 确认与复核

- 确认日期：（待回填）
- 复核：L2 强制独立复核（`verifier` 子代理，独立上下文，读 incident + spec + diff；**重点复核核心回归用例是否真能证伪旧锚**，以及换锚是否引入存量误拦）
