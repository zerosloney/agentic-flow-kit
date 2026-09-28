---
状态: done
级别: L2
日期: 2026-09-28
模块: pipeline
备注: 同名 incident：../incidents/2026-09-28-batch-ledger-audit.md（并录审计判据方向性失效）。L2：改判据 + 台账 schema 纯增字段（向后兼容）。
确认指纹: da6834b4c8ad198a
---
# SPEC — 并录审计改读 batch 事实

## 功能行为

### 并录判据：从「猜时间戳模式」改为「读调用事实」

**问题**（详见同名 incident）：现判据「同 quote + 相邻 ts 差 < 2s」是用两个间接信号反推「这次落态是几次调用产生」。该事实在写入时确定已知，判据却去猜，导致合规逐件调用（复用同句）必然误报，而并录时给每份换不同 quote 即零告警。

**改动**：`confirm-doc` 在**每次进程调用**开始时生成一个 `batch` id，并为该次调用内的每份文档记 `seq`（件序，从 1）与 `of`（本次调用总份数）。审计判据改为**读字段**：

- **同 `batch` 且 `of > 1`** → 该批为「一次调用落的多份态」→ 报并录
- `of === 1` → 逐件调用，无论 quote 是否相同、无论 ts 是否接近 → **不报**
- 无 `batch` 字段（schema 演进前的历史行） → **降级出账**，不猜、不回溯

`quote` 字段**归还单一职责**：只记用户原话供事后对质，不再兼任「并录指纹」。

### 台账 schema 演进（纯增字段，向后兼容）

`.agents/confirmations.jsonl` 每行新增三个字段：

```jsonl
{"ts":"...","doc":"workflow/plans/x.md","stage":"approved",
 "batch":"a7f3c1","seq":1,"of":1, ...}
```

兼容性论证（**这是本方案不需要动存量的关键**）：
- 台账是 **append-only**（只追加不重写）
- check-loop 对台账行 **坏行容忍跳过**（`try { JSON.parse } catch {}`）
- 配对判据（doc/stage/fingerprint 三键）**与新增字段无关**

⇒ 历史 61 行无 `batch` 不导致任何解析失败，**不回填、不改写、不迁移**。

`batch` 生成方式（实现约束，非契约）：进程内 `crypto.randomBytes` 取短十六进制串即可；唯一性要求仅为「同一台账内不同调用不碰撞」，不要求全局唯一、不含时间语义。

## 数据流

```
用户逐件确认（N 次调用）
  └─ 每次调用：生成 batch → 对该次传入的每份 doc 写 seq=1..n, of=n
       （现有入口已强制 docs.length ≤ 1，故正常路径恒 of=1）
            ↓
     .agents/confirmations.jsonl（append-only）
            ↓
check-loop 检查 15 并录段：
  读 batch/of（不再读 quote 相等、不再比 ts 差）
    ├─ 同 batch 且 of>1 → warning「确认并录」（读事实，不可伪装）
    ├─ of=1            → 不报
    └─ 无 batch        → 降级出账（明示"schema 演进前，无可判定"）
```

无新数据源、无写入副作用；confirm-doc 仅多写两个整数与一个短串。

## 系统改动

| 件 | 改动 | 对应 plan 任务 |
|---|---|---|
| `templates/_agents/scripts/confirm-doc.mjs` | 调用开始生成 `batch`；`appendLedger` 落 `batch`/`seq`/`of` 三字段；头注释 schema 说明同步 | T1 |
| `templates/_agents/scripts/check-loop.mjs` | 检查 15 并录段：旧判据（同 quote + 2s 聚组）**退役**，改读「同 batch 且 of>1」；无 batch 行走降级；头注释检查项 15 段同步（**不改编号**） | T2 |
| `templates/_agents/scripts/check-loop.test.mjs` | 新判据场景 ≥5：**换 quote 的并录仍被拦**（现判据盲区，核心回归）/ 同 batch of>1 报 / of=1 复用同句不报 / 延迟跨 2s 仍拦 / 无 batch 降级 | T3 |
| `templates/_agents/scripts/confirm-doc.test.mjs` | 单次调用落 N 份时 batch 相同、seq 递增、of=N；单份 of=1 | T3 |
| `workflow/README.md`（owned，手改即权威） | 「审计边界」节：台账 schema 演进声明（新增 batch/seq/of；历史行降级口径；append-only 故不回填） | T4 |
| 装副本 `.agents/scripts/*`、`.agents/kit.json` | 经 `flow-kit sync` 下发，无手改 | T5 |

> 注：本次**不涉及** commands / roles 正文，故**不需要** `sync-hosts --apply`。

## 约束遵守映射

- **双源纪律**：引擎改动一律改 `templates/`，随后 sync 刷装副本 + kit.json 台账 sha；改后 `source-sync-check --diff` 须 0 差异——T1/T2/T3/T5 遵守
- **检查项编号不增删改号**：只在 15 的并录子检查内改判据，头注释文字同步；`gate-checklist` PAIRS 登记表**不动**（id 不变）
- **常驻面预算**：改动集不含 AGENTS.md / commands（`workflow/README.md` 为 owned 且不在预算表），不触预算
- **`--no-verify` 禁令**：门禁被拦时按提示修完原路重试
- **提交约定**：incident / spec / plan 随代码同一提交；各确认点确认后立即 `docs(workflow)` 单独提交留痕
- **存量不回填**：沿「生效日 + 存量豁免」既有版本化迁移模式；本方案靠 schema 纯增 + 降级路径天然成立，**不需逐份豁免清单**

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| **旧判据退役后历史并录告警全消失**（本仓 13 条 → 0），真违规也一并沉底 | 中 | 这是**有意的取舍**：现判据的假阴性比假阳性更危险（换 quote 即静默漏报），留着它等于保留一条漏报通道。历史 13 条本就是"不可区分、不含新信息"的噪声（其自身文案已承认）；退役后降级出账为「schema 演进前无可判定」，**如实可见**而非静默删除 |
| 新增字段被下游消费方误读（kb-search / 看板 / agg 等读台账的件） | 中 | 纯增字段、不改既有键语义；实现时逐一核对台账消费方（`grep confirmations.jsonl`）确认无严格 schema 校验 |
| 实现时「顺手放宽」既有并录测试断言（判据变了就改测试） | 中 | plan T3 显式要求：既有场景**只改判定依据与注释、不放宽断言强度**；新增「换 quote 并录」场景必须在旧判据下变红（变异自验） |
| `batch` 碰撞导致两批被误并 | 低 | 唯一性要求仅限单台账内不碰撞；短随机串足够。用例可加"不同 batch 的 of>1 各自成组、不互并" |
| 回滚难度 | 低 | 改判据段 + 写字段 + 测试 + 一处文档；`git revert` 单提交即回。已写入的 batch 字段对回滚后的旧代码无害（旧代码不读该字段） |

## 确认与复核

- 确认日期：2026-09-28（用户对话内逐件确认：incident / spec / plan 各自「可以」）
- 复核：L2 独立复核**已执行**（`verifier` 子代理，独立上下文，基准 `6f81ad4` → `f194428`，含 4 变异体 + fixture 边界实测 + 新旧判据对照）——判 **0 P0 / 0 P1 / P2×4**，未发现阻断问题。四项 P2 **全部采纳并修复**（`acf93b6` + `583f31a`）：
  - P2-1 文档量化数字与实况不符（13/21/23 条、61 行）→ 实测钉正为 **14 条并录 / 22 条 advisory / 67 行**，五处文件同步；`.mjs` 内自相矛盾的「13/23」一并消除
  - P2-2 plan 承诺的「单次调用 N 份」测试未落地 → 补 S18b/c/d，且 S18c 经**应答注入**真正端到端（上版误用 `spawnSync(input:)` 驱动 TTY 多文档，只跑通首份，且根因误记；真实机制为管道写完即关导致 readline 吞掉第二行 + stdin EOF，**与有无 TTY 无关**）
  - P2-3 判据取 `rows[0].of` 使结论依赖行序 → 改 `rows.some(of>1)` + of 取组内最大值；两条对称用例钉住顺序无关性
  - P2-4 revert-draft 场景失去「可报组与注记行并存」组合 → 补回（断言恰报 1 次）
- 复核者的独立实证：**同 fixture 对照新旧判据 → NEW 报 1 / OLD 报 0**（盲区确已关闭，非仅"测试能打红"）
- **未验证范围（据实声明）**：① 经 sync 下发到其它宿主/装户环境（`.opencode/`、`.trae/`、`.zcode/`）后的行为——本仓为包源环境，§7.x 检查被 doctor 跳过；② POSIX（Linux/macOS）实机行为——仅 Windows 实跑；③ `randomBytes(3)` 的 6 位短串在台账**无限增长**下的长程碰撞（spec 已接受「单台账内不碰撞即可」，未构造亿级台账验证）
