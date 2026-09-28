---
状态: draft
级别: L2
日期: 2026-09-28
模块: pipeline
备注: 承接 `2026-09-28-metric-claim-gate` 真装端到端暴露的 P1（装户无法新增指标）。同名入口：../incidents/2026-09-28-adopter-derivers.md。同名 plan：../plans/2026-09-28-adopter-derivers.md。方案已由用户拍板：**分层（内置硬编码 + 装户模块可选）**。
---
# SPEC — 装户侧 derivers 动态载入（检查 16 扩展契约）

## 功能行为

### 要解决的问题

检查 16 的**登记表归装户**（`.agents/metric-claims.txt` 是 `owned`，可自由改），但**取数器归引擎**（`derivers` 硬编码在 `managed` 的 `check-loop.mjs` 里）。装户新增指标名后必然报「无对应取数器」，而唯一出路（改引擎）代价三连：`sync` 永久报「本地已改」+ `doctor` WARN + **`check-loop` 因供应链防线静默跳过执行（门禁停摆）**。

**即：一个 owned 的扩展面，配了一个 managed 的扩展点——装户一用就自断门禁。**

### 目标行为（分层）

1. **内置指标照旧**：引擎硬编码的 8 个指标（`ledger.lines` 等）行为**完全不变**，装户零配置即可用。
2. **装户可扩展**：装户新建 `.agents/metric-derivers.mjs`，导出 `derivers` 对象（指标名 → 同步取数函数）。检查 16 解析取数器时：**先查内置，未命中再查装户模块**。
3. **失败必须响亮**（见下「失败语义」）——绝不静默降级。

### 装户模块契约

**路径**：`.agents/metric-derivers.mjs`（与 registry 同目录；**归 `owned`**，装户自持）

**形态**：
```js
// .agents/metric-derivers.mjs —— 装户自持，sync 永不覆盖
export const derivers = {
  // 指标名（小写点分，须与 metric-claims.txt 登记的完全一致）→ 同步函数，返回 number
  'my.migrations': (ctx) => ctx.glob('backend/migrations/*.sql').length,
  'my.apiCount':   (ctx) => ctx.countFiles('src/api', (f) => f.endsWith('.controller.ts')),
};
```

**ctx 提供的辅助**（引擎注入，免装户重复造轮子；仅这几项，其余请自行用 `node:fs`）：
| 成员 | 作用 |
|---|---|
| `ctx.root` | 仓库根绝对路径 |
| `ctx.read(rel)` | 读文本文件（LF 归一），不存在返回 `''` |
| `ctx.glob(pattern)` | 极简 glob（`*` / `**` / 后缀匹配），返回相对路径数组 |
| `ctx.countFiles(dir, pred)` | 递归计数（可传谓词） |

**硬性约定**：
- **必须是同步函数**（返回 `number`，不得返回 `Promise`）——理由见下「为什么约定同步」
- 必须**确定性**：不得依赖网络、不得依赖当前时间（与本检查「本地确定性」前提一致）
- 返回值须为**有限数字**（`Number.isFinite`）；返回 `NaN` / 字符串 / Promise → **fail-loud**

### 失败语义（本 spec 最关键的一节）

| 情形 | 行为 |
|---|---|
| 装户模块**不存在** | **正常**——只用内置指标，零告警（绝大多数装户如此） |
| 模块存在但**语法错 / 载入抛异常** | **fail-loud**：明示文件路径 + 错误信息。**不得**降级为「只用内置指标」 |
| 模块存在但**未导出 `derivers`** 或导出非对象 | 同上 fail-loud |
| 某指标函数**抛异常** | fail-loud，明示指标名 + 错误 |
| 某指标函数**返回非有限数字**（NaN / 字符串 / Promise / undefined） | fail-loud，明示指标名 + 实际返回值类型 |
| 装户指标名**与内置同名** | **内置优先**，并出 advisory 提示「该名由引擎内置提供，装户定义被忽略」（防装户以为覆盖生效） |

**为什么载入失败必须 fail-loud 而非静默降级**（据实论证，非从严偏好）：若降级为「只用内置指标」，装户会看到「引用了 `my.metric` → 未登记」（因为该名没进 `declared`）——看起来像**自己忘了登记**，而真实原因是**模块坏了**。装户会去 registry 反复确认，问题永远查不到。这正是本仓已吃过两次亏的模式：**静默降级制造的假象比报错更贵**（沿 `claim-exceeds-fix`「假绿比红危险」与 `metric-claim-gate` 语法错教训）。

另：本检查是 **advisory 级**，故「fail-loud」在实现上表现为**明确的 WARN 条目**（含文件名 / 指标名 / 错误详情），从而 `check-loop` 仍 exit 0——但**引擎自身崩溃是另一回事，绝不允许**（见下）。

### 为什么约定「同步」而非 async（实测依据，设计取舍）

实现前实测（Node 24）：
- `check-loop.mjs` 现有 **876 行、0 个 `await`**，是**纯直线同步脚本**（9 个顶层块 + 6 个顶层 `for`）；末尾是函数声明 + `process.exit`。
- 若约定 async，需把主流程整体改造为 async 主函数 → 大范围结构改动，且与本检查「**零网络、本地确定性**」的前提**目标冲突**（异步的唯一真实收益是网络 / 并发 IO，而这里两样都不允许）。
- **同步完全够用**：装户用 `fs.readFileSync` / `readdirSync` 即可读任意本地文件；`ctx.glob` 由引擎用同步 API 实现。
- **载入机制实测**：`createRequire(import.meta.url)` 可**同步**载入 `.mjs`（实测**非 Promise**，直接拿到导出对象）；语法错抛出**可捕获**的 `SyntaxError`。故无须 `await import()`。

**结论**：契约定为**同步函数**。表达力无实质损失（仍是任意 JS、可读任意文件），换来引擎**零结构改造**。

## 数据流

```
.agents/metric-claims.txt（owned：指标名 = 指标名）
        │ 解析 → declared 集合（未命中取数器的报「无取数器」）
        ▼
检查 16 取数解析（分层）
        │
        ├─ 1) 内置 derivers（引擎硬编码 8 个）  ← 优先，行为与今完全一致
        │      命中 → 直接取数
        │
        └─ 2) 装户模块 .agents/metric-derivers.mjs（owned，可选）
               存在？
                 ├─ 否 → 无取数器（fail-loud，同今日）
                 └─ 是 → createRequire 同步载入
                          ├─ 抛异常 / 语法错 → fail-loud（明示文件+错误），**不降级**
                          ├─ 无 derivers 导出 / 非对象 → fail-loud
                          └─ 载入成功 → 查指标名
                                ├─ 命中且与内置同名 → 内置优先 + advisory
                                ├─ 命中 → 调用（try/catch）
                                │         ├─ 抛异常 → fail-loud（指标名+错误）
                                │         ├─ 返回非有限数字 → fail-loud（类型）
                                │         └─ 正常 → 用该值对账签名
                                └─ 未命中 → 无取数器（fail-loud）
        ▼
签名对账（既有逻辑不变）：活跃态文档 \\{{指标名}} → 与实时值比对
```

## 系统改动

| 件 | 改动 | 对应 plan 任务 |
|---|---|---|
| `templates/_agents/scripts/check-loop.mjs` | 检查 16 取数解析改分层：抽 `resolveDeriver(name)`（内置 → 装户模块）；新增装户模块**懒载入**（首次需要时载入一次并缓存结果，含失败态缓存）；载入与调用**全程 try/catch**，失败出 fail-loud 条目而非抛出；新增 `ctx`（`root` / `read` / `glob` / `countFiles`，全同步）；头注释检查 16 段补扩展契约与失败语义 | T1 |
| `templates/_agents/scripts/check-loop.test.mjs` | 新增装户模块场景（见 T3 清单） | T3 |
| `templates/_agents/metric-claims.txt` + `.agents/metric-claims.txt` | 头部「已知限制」段改写为**新契约**：装户可自增（写自家 `metric-derivers.mjs`）+ 写法示例 + 优先级 + 失败语义 + 同步 / 确定性 / 有限数字三条硬约定 | T2 |
| `src/profiles.mjs` | `isOwned` 登记 `.agents/metric-derivers.mjs`（**本单核心回归点**——不登记则落回 managed，重演原缺陷） | T4 |
| `workflow/README.md`（owned，手改即权威） | 「结论文档表述纪律」节 §1 补一句：装户扩展路径见 registry 头部（**只留指针不复述**，沿「常驻面不重复机器已保证内容」纪律） | T4 |
| `workflow/regression-checklist.md` | 「防复发验证」节追加本单条目 | T4 |
| 装副本 `.agents/scripts/check-loop.mjs`、`.agents/scripts/check-loop.test.mjs`、`.agents/metric-claims.txt`、`.agents/kit.json` | 经 `flow-kit sync` 下发，无手改 | T5 |

> 注：本次**不涉及** commands / roles 正文，故**不需要** `sync-hosts --apply`。

## 约束遵守映射

- **双源纪律**：引擎与 registry 改动一律改 `templates/`，随后 `flow-kit sync` 刷装副本 + kit.json 台账 sha；`source-sync-check --diff` 须 0 差异——T1/T2/T5 遵守
- **owned / managed 两态模型**：**本单的核心**——装户模块定为 `owned`（项目自持、sync 永不覆盖、哈希只记账不约束），故须在 `src/profiles.mjs#isOwned` 中登记 `.agents/metric-derivers.mjs`。**这是本单必须检查的回归点**（不登记即重演本单要修的同一个错）
- **装户零配置可用**：内置 8 指标不依赖任何装户文件；装户模块缺失是**正常态**而非错误——保证「不装即用」，避免本单修复把既有装户变成报错态
- **禁止假绿**（本仓既有红线，沿 `claim-exceeds-fix` / `metric-claim-gate` 两单教训）：载入失败、调用抛错、返回非法值一律**响亮出账**；引擎自身**绝不因装户代码崩溃**（全 try/catch），也**绝不静默降级**成「只用内置指标」
- **失败必须可诊断**：每条 fail-loud 须含**文件路径 + 指标名 + 实际错误 / 类型**——装户据此能直接定位（对照：只说「无取数器」会让装户去查 registry，方向错）
- **零网络 / 本地确定性**：契约明文禁止网络与时间依赖；`ctx` 只提供本地同步能力——与本检查既有前提一致
- **检查项编号不增删改号**：仍在检查 **16** 内改取数解析（不改编号、不动检查 1-15）；`gate-checklist` PAIRS **不动**
- **常驻面预算**：改动集不含 AGENTS.md / commands（`workflow/README.md` 为 owned 且不在预算表），不触预算
- **`--no-verify` 禁令**：门禁被拦时按提示修完原路重试
- **提交约定**：incident / spec / plan 随代码同一提交；确认后立即 `docs(workflow)` 单独提交留痕
- **存量不误伤**：本仓 `derivers` 与 registry 同在包源，行为须**逐条零差异**（本仓无 `metric-derivers.mjs`，路径 2 不激活）——复核须独立复现

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| **装户模块语法错导致 check-loop 崩溃 → 门禁停摆**（比本单要修的缺陷更糟） | **高** | 全流程 `try/catch`；载入失败转为**明确 WARN 条目**而非抛出；专用用例「注入语法错 → check-loop 仍 exit 0 且输出明示错误」（**不许可 exit≠0 或静默**） |
| **静默降级成「只用内置指标」→ 装户以为在查其实没查** | **高** | 失败语义表明确「不降级」；用例钉死「模块坏 + 引用了装户指标 → 必须出现 fail-loud 条目」（对照用例：模块缺失时不报错，二者行为必须可区分） |
| 装户模块**未登记进 `isOwned`** → 落回 managed，重演原缺陷 | **高** | 「约束遵守映射」列为必检回归点；用例断言 `isOwned('.agents/metric-derivers.mjs') === true`；真装端到端复验 |
| 装户取数器**低效 / 死循环**拖慢门禁 | 中 | 本单**不引入超时机制**（同步函数无法安全中断，强行超时需 worker 隔离——超出本单范围）；改为在 registry 头部**明文声明**「取数器应轻量、秒级；本检查不设超时」，并列入未验证范围。**据实标注而非假装已解决** |
| 装户指标名与内置同名，误以为覆盖成功 | 低 | 内置优先 + 专用 advisory 明示「被忽略」；用例覆盖 |
| 装户返回 Promise（误写 async） | 低 | 返回值校验 `Number.isFinite` 直接拦下（Promise 非有限数字）→ fail-loud 且提示「须同步函数」 |
| 缓存失败态导致「修好模块需重启进程」 | 低 | 失败态与成功态均缓存于**单次运行内**（check-loop 是短命进程，每次跑都重新载入）；不跨进程缓存 |
| 回滚难度 | 低 | 单文件新增解析分支 + registry 头部文档 + 测试；`git revert` 即回；装户模块为纯新增文件，不存在时行为与今完全一致 |
| **本单修完仍可能有装户不可达面** | 中 | 真实装户需求未知（用户未明确回答「装户会数什么」）——故本单**以「表达力无上限」兜底**（任意 JS），不预设需求；未验证范围如实声明 |

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核（`independent-reviewer` 子代理，独立上下文）——须独立验证：① 本仓行为**逐条零差异**（无装户模块时路径 2 不激活）；② 装户模块**语法错 / 抛异常 / 返回非法值**三种失败均 fail-loud 且 **check-loop 不崩、不静默**；③ `isOwned('.agents/metric-derivers.mjs')` 为真；④ **真装端到端**：临时 `flow-kit init` → 写模块 → 取数正确 → `sync`/`doctor` 零漂移（对照修复前：此路径使 check-loop 静默停摆）；⑤ 检查 1-15 与 registry 解析逻辑未被触碰
