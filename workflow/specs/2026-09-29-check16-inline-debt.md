---
状态: done
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 对应 intent / plan 同名主题 check16-inline-debt（2026-09-28 双轴审查 4 条判断性 smell 收口）
确认指纹: a1fa35d907f49a60
---
# SPEC — check16-inline-debt

## 功能行为

### 1. 检查 16 拆出独立模块（Divergent Change 收口）

**变更前**：检查 16（264 行：glob 状态机、walkFiles 防环遍历、装户 CJS 模块加载、签名扫描、对账）整体内联于 `check-loop.mjs`（约 1050 行），与检查 1-15 同文件；指标子系统的每次演进（6 提交 / 4 天）都在门禁主脚本里手术。

**变更后**：全部逻辑迁入新文件 `check-metric-claims.mjs`（与 `workflow-enums.mjs` 同层的 managed 脚本），导出单入口 `runCheck16(ctx)`。`check-loop.mjs` 检查 16 块缩为：头注释（判据摘要 + 指向模块）+ `import` + 一次调用。`ctx` 显式注入外层依赖闭包符号（`ROOT` / `ENUMS` / `docFiles` / `fmGet` / `inSet` / `isTracked` / `linesOf` / `readdirOrNull` / `warnings`，共 9 个——实现期修正：起草按预 grep 计 8 个，迁移时以实际引用集为准补入 `inSet`，复核 P2-2 采纳）——依赖全部显式，无隐式全局耦合。

**对外判据语义零变化**：签名形态（小写点分）、转义约定（逐个出现豁免）、失败语义档位（登记表缺失静默跳过 / 取数器缺失与取数非法 fail-loud）、装户分层契约（内置优先 → `.cjs` 装户模块）、检查项编号 16——均不动。

### 2. 扫描 / 取数口径单源（口径分裂收口）

**变更前**：`scanFiles16` 自建遍历（仅排 `_TEMPLATE.md`，**不滤 tracked**）；取数侧 `countDocs`/`docFiles` 滤 tracked（`.md` ∧ 数字前缀 ∧ `isTracked`）。头注释声称「扫描看得到的文档集 == 取数统计的文档集」，对签名扫描自身不成立。

**变更后（口径决策：统一 tracked-only）**：

- 签名扫描集 = `docFiles(sub)`（四子目录，过滤链本体仅 `docFiles` 一份）∪ 根级 `workflow/*.md`（tracked ∧ `.md`，排除集维持现状不含数字前缀约束）
- 取数集 = `docFiles(sub).length` 派生，**`countDocs` 删除**（Duplicated Code 收口：`.md ∧ 数字前缀 ∧ tracked` 过滤链全仓仅 `docFiles` 一处定义）
- 「同一物理文档是否纳入」两侧一致：未跟踪档（并行会话半成品）既不进签名扫描也不进取数

**为什么 tracked-only（而非保留含未跟踪）**：① 取数必须 tracked-only 才可复现（2026-09-28 复核 P2-2 已论证钉死，不可反向迁就）；② 对账语义要求两侧同集，否则「签名按盘面填对却与 tracked-only 取数值不符」的假告警；③ 与检查 2 先例一致（既有用例：未跟踪 draft intent 不进扫描）；④ 代价（新档 git add 前不提醒签名回填）可接受——add 后首次 check-loop 即纳入。

**行为变化声明（有意）**：未跟踪文档中的未回填签名不再出 warning。双向测试钉住（未跟踪 → 不出账；git add 后 → 出账）。

### 3. confirm-doc TTY 测试逃生门收紧（信任边界收口）

**变更前**：`ttyForced = (CONFIRM_DOC_TEST_TTY === '1')`——任何进程（含 AI 会话内 shell）设此单变量即可绕 TTY 门，并以生产语义落 `source:"tty"` 台账行。

**变更后（双条件）**：`ttyForced = (CONFIRM_DOC_TEST_TTY === '1' && process.env.NODE_ENV === 'test')`；测试注入 env 同步补 `NODE_ENV=test`（两处）。

**论证（措辞按「成本位移」纪律，不称「关闭」）**：本仓威胁模型的核心是 **AI 会话伪装用户亲手确认**——AI 能设环境变量，单条件逃生门在 AI 手里是**顺手可绕**的（无声明、无痕迹区分）。双条件后：无意/顺手滥用不可能；有意伪装需同时伪造两个环境信号，成本等同「直接伪造台账行」（append-only jsonl、无签名无鉴权）——与后者同属**本地信任边界内不可机器防**（沿 check8-git-anchor spec 同款诚实声明）。测试语义不受影响：逃生门本就仅改 `isTTY` 判定、不改落态/记账语义，测试在 `NODE_ENV=test` 下测到的 batch/seq/of 行为与生产 TTY 路径一致。

### 边界与异常

- 非 git 环境（装户无 `.git` / `isTracked` 恒真）：`docFiles` 既有降级语义不变，口径统一自然继承
- `check-metric-claims.mjs` 与装户 `.cjs` 取数模块**同名不冲突**（装户模块名为 `metric-derivers.cjs`，引擎模块为 `check-metric-claims.mjs`）
- 根级 `workflow/INDEX.md`（生成物）：进签名扫描集（现状如此，tracked），无数字前缀约束维持

## 数据流

纯只读，无新数据源、无写入：

```
check-loop.mjs 检查 16 位点
  └─ import runCheck16 → ctx 注入 8 个闭包符号
       ├─ 扫描集：ctx.docFiles(四子目录) ∪ 根级 tracked *.md
       ├─ 登记表 .agents/metric-claims.txt（owned，缺失 → 静默跳过）
       ├─ 取数：内置 derivers ∪ 装户 .agents/metric-derivers.cjs（.cjs 契约不动）
       └─ 对账 → ctx.warnings（[warning] 级，exit 0 语义不变）

confirm-doc.mjs TTY 门
  └─ delegated？→ 是：委托路径（不动）
       └─ 否：isTTY ∨ (CONFIRM_DOC_TEST_TTY ∧ NODE_ENV=test)，否则拒绝
```

## 系统改动

| 件 | 改动 | 对应 plan 任务 |
|---|---|---|
| `templates/_agents/scripts/check-metric-claims.mjs` | **新增**：检查 16 全部逻辑迁入，导出 `runCheck16(ctx)`；`scanFiles16` 改用 `ctx.docFiles` + 根级 tracked 扩展；`countDocs` 不复存在（取数器改 `ctx.docFiles(sub).length`） | T1 |
| `templates/_agents/scripts/check-loop.mjs` | 检查 16 块（:735-998）缩为头注释摘要 + import + 调用；外层 8 符号组装 ctx | T1 |
| `templates/_agents/scripts/check-loop.test.mjs` | 既有检查 16 用例适配；**新增口径双向用例**（未跟踪档签名不出账 / add 后出账，git 仓库模式沿场景 23/24 先例）；**新增口径单源用例**（构造过滤链第二实现即红——或以检索断言替代，取实现顺手者） | T2 |
| `templates/_agents/scripts/confirm-doc.mjs` | `ttyForced` 双条件；注释补信任边界声明（本地信任边界不可机器防，沿 check8 口径） | T3 |
| `templates/_agents/scripts/confirm-doc.test.mjs` | :288/:309 两处 env 注入补 `NODE_ENV: 'test'`；**新增用例**：仅设 `CONFIRM_DOC_TEST_TTY` 不设 `NODE_ENV` → 非 TTY 拒绝路径不受逃生门影响 | T3 |
| `workflow/regression-checklist.md` | 追加本单条目 | T4 |
| 装副本 `.agents/scripts/*`、`.agents/kit.json` | 经 `flow-kit sync` 下发（新 managed 件 `check-metric-claims.mjs` 入台账），无手改 | T5 |

> 注：不涉及 commands / roles 正文，不需要 `sync-hosts --apply`；AGENTS.md 门禁序括注无变化。

## 约束遵守映射

- **引擎双源纪律**：全部改动先落 `templates/` 包源，随后 `flow-kit sync` 刷装副本 + kit.json 台账；`source-sync-check --diff` 0 差异、`check-ledger` 全对齐——T1/T2/T3/T5 遵守
- **装户自包含**：新模块只 import 同目录件（`workflow-enums.mjs` 先例）与 `node:*`，不 import `src/`
- **检查项编号不增删改号**：仍为检查 16，gate-checklist PAIRS 不动；检查 1-15 输出须逐字节不变（迁移前后全量输出 diff 为空）
- **禁止假绿 / 无判定依据不产噪声**：口径变化（未跟踪签名不出账）为有意行为变更、双向测试钉住并在此声明，非静默放宽
- **措辞纪律（claim-exceeds-fix）**：TTY 收紧的收益表述为「从顺手可绕到需刻意伪造双信号」的成本位移，不称「通道关闭」
- **存量不回填 / 不误伤**：本仓无未跟踪 workflow 档场景变化；非 git 装户 `isTracked` 恒真，行为与今一致

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 迁移引入行为漂移（检查 16 或 1-15 输出变化） | 中 | 迁移前后全仓 check-loop 输出逐字节 diff 为空作为门；npm test 全绿 |
| 口径统一后「未跟踪档签名」静默面（新档 add 前无提醒） | 低 | 有意取舍（本节已声明）；add 后首次 check-loop 即纳入；与检查 2 先例一致 |
| 新 managed 件收编遗漏 / 装户 shipped 套件因新 import 崩 | 中 | sync 台账 + check-ledger 门禁拦；真装环境跑 shipped 套件（adopter-derivers P1 教训） |
| `NODE_ENV=test` 双条件破坏既有测试或与其他工具链语义冲突 | 低 | 仅两处测试 env 注入同步补；`NODE_ENV` 不被本仓其他脚本读取（实现时 grep 复核） |
| AI 侧仍可双信号伪装 TTY | 低（接受） | 本地信任边界内不可机器防（与伪造台账同级）；spec 声明 + 注释留痕 |
| 回滚难度 | 低 | git revert 单提交：删新文件 + 还原 4 件 + sync；台账无 schema 变更 |

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核（结构迁移 + 口径变更，回归面大——迁移等价性是复核重点）
