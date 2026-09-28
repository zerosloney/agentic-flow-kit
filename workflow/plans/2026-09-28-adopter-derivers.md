---
状态: draft
级别: L2
日期: 2026-09-28
模块: pipeline
备注: 同名入口：../incidents/2026-09-28-adopter-derivers.md；同名 spec：../specs/2026-09-28-adopter-derivers.md。L2 四节。
---
# PLAN — 装户侧 derivers 动态载入

## 任务拆解

### T1 分层取数解析：`templates/_agents/scripts/check-loop.mjs`

**判据**：检查 16 内取数器解析改为「内置优先 → 装户模块」；装户模块缺失时行为与今**逐条零差异**；任何装户代码失败均转为明确 WARN 条目，**引擎自身绝不抛出/崩溃**。

- T1.1 抽 `resolveDeriver(name)`：返回取数函数或 `{ error }`（不抛）
- T1.2 装户模块**懒载入**：首次未命中内置时才 `createRequire` 载入 `.agents/metric-derivers.mjs`；结果（成功 / 失败）**单次运行内缓存**
- T1.3 载入路径全 `try/catch`：语法错 / 抛异常 → fail-loud 条目（含**文件路径 + 错误首行**）
- T1.4 导出校验：非对象 / 缺 `derivers` → fail-loud（含实际导出形态）
- T1.5 调用校验：`try/catch` + `Number.isFinite` 检查 → 抛错或非有限数字均 fail-loud（含**指标名 + 实际类型**）
- T1.6 同名优先级：内置优先；装户定义了内置同名 → advisory 明示「被忽略」
- T1.7 新增 `ctx`（全同步）：`root` / `read(rel)`（LF 归一，缺则 `''`）/ `glob(pattern)`（极简 `*` `**` 后缀）/ `countFiles(dir, pred)`
- T1.8 头注释检查 16 段补：扩展契约 + 失败语义 + 为什么同步（实测依据）

**自查**：本仓实跑 advisory **改前改后逐条一致**（本仓无 `metric-derivers.mjs`）；`exit 0`

### T2 登记表文档：`templates/_agents/metric-claims.txt` + 装副本

**判据**：原「已知限制」段（现写明「装户无法新增指标」）改写为**新契约**——不再声称限制，写明：装户可自增、模块路径与形态、ctx 能力、内置优先、失败语义、三条硬约定（同步 / 确定性 / 有限数字）、**不设超时**的如实声明。

- T2.1 与 T1 实现一致（含 `ctx` 成员表）
- T2.2 保留「为什么只查显式签名」的既有论证（那是另一件事，不因本单删除）

### T3 测试：`templates/_agents/scripts/check-loop.test.mjs`

**判据**：新增场景全绿；三条**假绿防线**用例必须钉死。

- T3.1 【正向】装户模块存在 + 自定义指标 → 取数正确（`实时值 = N`）
- T3.2 【假绿防线】模块**语法错** → 出现 fail-loud 条目（明示文件）+ **check-loop 仍正常退出**（不崩）
- T3.3 【假绿防线】指标函数**抛异常** → fail-loud（明示指标名）
- T3.4 【假绿防线】返回**非有限数字**（字符串 / `NaN` / Promise）→ fail-loud（明示类型）
- T3.5 【区分性】模块**不存在** → 零告警（与「模块坏」必须行为可区分）
- T3.6 【优先级】装户定义内置同名 → 内置值生效 + advisory 明示被忽略
- T3.7 【未导出】模块存在但无 `derivers` 导出 → fail-loud
- T3.8 【ctx】`ctx.glob` / `ctx.countFiles` / `ctx.read` 取数正确（fixture 内建目录文件）
- T3.9 【存量零差异】无装户模块时，内置 8 指标取数与改前一致

### T4 归属登记与文档

**判据**：`isOwned('.agents/metric-derivers.mjs')` 为真（**本单核心回归点**）；README 留指针；回归清单追加本单行。

- T4.1 `src/profiles.mjs`：`isOwned` 登记 `.agents/metric-derivers.mjs`（附理由注释：与 registry 同属项目自持，否则落 managed 重演原缺陷）
- T4.2 `workflow/README.md`：纪律节 §1 补一句指针（不复述契约）
- T4.3 `workflow/regression-checklist.md`：追加本单条目

### T5 双源同步与真装端到端

**判据**：三项静态门全绿 + **真装端到端走通**（缺陷只在真装可见，故此项为本单验收核心）。

- T5.1 `flow-kit sync`；`source-sync-check --diff` 0 差异
- T5.2 `doctor` 0 FAIL/0 WARN；`gate-checklist --diff` 0 断档
- T5.3 `check-loop.test.mjs` 全绿
- T5.4 **真装端到端**：临时目录 `flow-kit init` → 确认 `metric-derivers.mjs` 若存在则在 owned 侧 → 写装户模块加自有指标 → 检查 16 正确取数 → `sync`/`doctor` **零漂移**（对照修复前：此路径使 check-loop 静默停摆）

## 风险评估

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **装户模块坏 → check-loop 崩溃**（比原缺陷更糟） | 语法错 / 抛异常未被捕获 | T1.3/T1.5 全 try/catch；T3.2 钉死「仍正常退出」；复核独立注入验证 |
| **静默降级 → 假绿** | 为「稳」而吞掉失败 | T1.4-T1.5 明确 fail-loud；T3.5 用「模块缺失零告警」作对照，二者必须可区分 |
| **忘记登记 `isOwned`** → 重演原缺陷 | 只改引擎忘了 profiles | T4.1 单列 + 用例断言 + T5.4 真装复验 |
| 装户模块性能（死循环）拖慢门禁 | 装户写坏取数 | **本单不引入超时**（同步无法安全中断）；registry 明文声明「应轻量、不设超时」+ 列入未验证范围。**据实标注，不假装解决** |
| 误伤存量 | 改动触及检查 16 主路径 | T3.9 + T1 自查（本仓 advisory 逐条零差异） |
| 回滚难度 | — | 单文件新增解析分支 + 文档 + 测试；`git revert` 即回 |

## 执行顺序

1. T1 → T3（判据 + 测试同提交）
2. T2（registry 契约文档）
3. T4（`isOwned` 登记 + README + 回归清单）
4. T5（sync + 三项门 + 真装端到端）
5. L2 独立复核（基准 = 本单首个 commit）
6. 关单：逐条勾验 → 逐件 `confirm-doc`

## 验证方式

- 静态门：`npm test`（纯 JS，无构建 / 无类型检查）
- 门禁：`check-loop` exit 0 ｜ `doctor` 12 PASS / 0 WARN / 0 FAIL ｜ `gate-checklist --diff` 0 断档 ｜ `source-sync-check --diff` 0 差异
- **假绿防线**（本单核心）：三项失败用例（语法错 / 抛异常 / 非有限数字）必须**响亮出账**；对照用例（模块缺失）零告警——两组行为可区分即通过
- **真装端到端**：临时 `flow-kit init` → 写装户模块 → 取数正确 → `sync`/`doctor` 零漂移
- **存量零误伤**：本仓实跑 advisory 逐条一致（无装户模块，路径 2 不激活）
- L2 追加：口径对账——检查项编号 1-15 未动、registry 解析逻辑未被触碰、`gate-checklist` PAIRS 未动

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 `draft → approved` 并回填本节，`done` 只在关单出现。

- 确认结果：<待填>
- 确认门记录：spec 草稿全文过目 + plan 草稿全文过目（两道门，逐次，不合并）
