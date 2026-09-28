---
状态: done
级别: L2
日期: 2026-09-28
模块: pipeline
备注: 同名 incident：../incidents/2026-09-28-check8-git-anchor.md（检查 8 生效日锚取文件名，hard 门可被平凡绕过）。L2：改 hard 门判据 + 新增共享 git 索引；检查项编号不变。
确认指纹: 3d2d644be92898fb
---
# SPEC — 检查 8 生效日锚改 git 首次加入日期

## 功能行为

### 生效日锚：文件名前 10 字符 → 文件首次加入 git 的日期

检查 8（验收标准对账，**hard-block**）的受管判定改为：

- **旧**：`filedate = base.slice(0, 10)`（文件名前 10 字符）→ `isNew = filedate >= '2026-09-12'`
- **新**：`adddate = addedDateOf(intent)`（该文件**首次加入仓库**的提交日期，`YYYY-MM-DD`）→ `isNew = adddate !== '' && adddate >= accCutoff`

**为什么换**：文件名 `YYYY-MM-DD-` 前缀是项目命名规范的**强制组成部分**，作者每次建档都在写它——「写早」零成本、顺手即发生，而检查 8 是 hard 门（有未勾验项即拦 push），等于一条 hard 门可被平凡绕过。

**本改动的准确收益（复核 P1 更正）**：关掉「**改文件名日期**（日常必写、零成本）即整段跳过 hard 门」这条通道，把伪造成本抬到「**主动加参数伪造时间戳**」。**但锚并非不可手填**——它取 `git log --diff-filter=A --format=@%aI`，即 **author date（作者自报时间戳）**，**不是** commit 时刻；`git commit --date=<过去>` 一条参数即可伪造（复核实证：文件名 09-01 + `--date=2026-09-01` → `%aI`=09-01 → 静默放行）。该残余通道与「伪造台账」同属**本地信任边界内不可机器防**的范畴，事后对质靠 git 历史与台账。**故不宣称「通道已关闭」**。

**为什么是这个字段而非其他**：
- 不用台账（`confirmations.jsonl`）：检查 8 覆盖的是 **all done intent**，而台账只覆盖走过确认门的文档（存量大量无行）——覆盖面对不上
- 不用 frontmatter 日期：同样可手填，只是成本高于文件名
- 用 git 首次加入：**全覆盖**（不受「是否走过确认门」限制，与检查 8 的覆盖面吻合）且**日常不可顺手改动**（需主动伪造时间戳，而非改个文件名）；且**已有现成先例**——检查 10 早已用 `git log --diff-filter=A` 取「加入提交」

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
- **`--diff-filter=A` 结果取决于 git 的重命名检测**（复核 P2 更正）：`git mv` 若被 git 识别为重命名，则目标路径**不产生** `A` 记录 → `''` → 存量口径；若未识别（如 `git mv --force`，或改名同时改内容超阈值），git 记作 **D+A** → 目标路径**取到重命名日** → 按该日判定（可能拉入 hard，方向**偏严**）。两种取向都不违反硬约束，但**不是**原文所写的「rename 一律取不到 → 存量口径」
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
| `templates/_agents/scripts/workflow-board-server.test.mjs` | **实现期新增**（原表未列）：双跑断言场景补 `gitInit`+`gitCommitAll` 前置——换锚后其非 git fixture 使「验收未对账」hard 不再产出、四类覆盖少一类。**断言文案与强度未变**（用户拍板方案 A） | T2 |
| 装副本 `.agents/scripts/check-loop.mjs`、`.agents/scripts/check-loop.test.mjs`、`.agents/scripts/workflow-board-server.test.mjs`、`.agents/kit.json` | 经 `flow-kit sync` 下发，无手改 | T4 |

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
| **换锚导致本仓存量 done intent 被误 hard 拦** | 中 | 本仓全部 workflow 文档均已提交（仓库模式只扫 HEAD tracked），故都能取到加入日期；**实测改后 advisory 须与改前逐条一致**（复核独立复现：同一工作区改前/改后**逐条零差异**）。**口径说明**：既有归档 advisory 为 8 条；工作区因本单新增 2 份文档的「模板未填」实跑为 10 条——「8 条」指前者，非工作区实跑值 |
| 既有 4 条检查 8 用例改造后**失去"非 git 环境"覆盖** | 中 | 专门新增一条「非 git 仓 → 不可判定走存量口径（不误报 hard）」用例补上；并在测试注释说明改造理由（意图不变，只是让"新建"由 git 事实判定） |
| 实现时「顺手」把既有用例断言放宽（换锚后它们会红，容易改成"改到绿"） | 中 | T2 硬要求：**只改 fixture 与注释、不放宽断言强度**；核心回归用例必须在旧锚下变红（变异自验） |
| 新增一次 git 查询拖慢 check-loop | 低 | 一次全量调用（实测 ~0.08s），不逐文件 fork；相较 check-loop 既有多次 git 调用增量可接受 |
| **锚并非不可手填：`%aI` 是 author date，可被 `git commit --date=` 伪造**（复核 P1 更正） | 中 | **不声称"通道已关闭"**（原立项措辞已更正）。准确收益 = 关掉「改文件名（日常必写、零成本）」通道，把成本抬到「主动伪造时间戳」；后者与伪造台账同属**本地信任边界内不可机器防**，事后对质靠 git 历史。已在 spec/README/代码注释三处如实声明 |
| `--diff-filter=A` 的 rename 取向不定（识别为重命名 → 无 A 记录 → 存量口径；未识别 → D+A → 按重命名日，偏严） | 低 | 两取向均不违反硬约束；已在「边界与异常」如实写明，不再宣称「rename 一律取不到」 |
| 回滚难度 | 低 | 单文件判据段 + 测试 + 一处文档；`git revert` 单提交即回；无数据迁移 |

## 确认与复核

- 确认日期：2026-09-28（用户对话内逐件确认：incident / spec / plan 各自「可以」）
- 复核：L2 独立复核**已执行**（`verifier` 子代理，独立上下文，基准 `66cb220` → `2fe605c`；含绕过对照实验 / 锚值全量比对 / 存量零差异复现 / 变异测试 / 性能与退化实测 / 双源与编号核对）——判 **0 P0**，核心修复成立。提出 **P1×1 + P2×2**，**全部采纳并修复**（`87bb788`）：
  - **P1** 原称「锚不可手填／通道关闭」为**不实陈述**（锚取 `%aI` = author date，`git commit --date=` 可伪造）→ 更正为「关掉『改文件名』零成本通道，成本抬到『主动伪造时间戳』，属本地信任边界内」，不宣称通道关闭；原则表述同步更正为「锚须取**日常不可顺手改动**的事实」
  - **P2** rename 取向（取决 git 重命名检测，未识别时记 D+A、偏严）；advisory「8 条」口径未写明（既有归档 8 / 工作区含本单新增 2 份文档实跑 10）
- 复核者的独立实证：① 同 fixture **NEW=exit 1 / OLD=exit 0 静默放行**（绕过确已关闭）；② 本仓 **138 份文档**锚值 100% 一致；③ 同工作区改前/改后 advisory **逐条零差异**（无存量误拦）；④ 检查 15 段**逐字节未动**；⑤ 非 git 仅 +1 次 `rev-parse`，**不跑 `git log`**
- **未验证范围（据实声明）**：① **跨时区团队**场景（本仓 177 commit 作者时区全为 `+08:00`，该边界在本仓不可达，未实测多时区暴露面）；② 同一路径 **3+ 次 `A`**（含 merge）未穷举；③ 经 sync 下发到其它宿主/装户环境的行为（本仓为包源环境，§7.x 检查被 doctor 跳过）
