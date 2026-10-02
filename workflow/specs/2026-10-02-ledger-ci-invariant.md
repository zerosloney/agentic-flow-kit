---
状态: done
级别: L2
日期: 2026-10-02
模块: pipeline
备注: 台账提交不变量——历史全扫（前缀单调 + 行级校验）+ --staged 前置 + CI/pre-commit 接线；入口 intents/2026-10-02-ledger-ci-invariant.md
确认指纹: edf4c9363bd0487c
---
# SPEC — ledger-ci-invariant（台账提交不变量）

> 对应 intent：`intents/2026-10-02-ledger-ci-invariant.md`。补齐能力评审「审计不可抵赖性」唯一扣分项：台账伪造从对质级升为机器可检出级。

## 功能行为

### 模式一：历史全扫（CI 机器门）

| 场景 | 行为 |
|------|------|
| 运行 | `node .agents/scripts/check-ledger-invariant.mjs [--root <仓库根>]`——遍历 `.agents/confirmations.jsonl` 的全部提交历史（`git log --follow --format=%H -- <file>` 逐提交取 blob） |
| 每次历史变更 | 新 blob 必须**以旧 blob 为逐字节前缀**（允许纯追加；禁止删行/改行/重排）。blob 比较发生在 git 对象库（入库 LF 归一口径），不受工作树 autocrlf 影响 |
| 首次出现 | 该文件首次入库即基线，不判 |
| 行级校验（最终树） | 逐行：① `ts` ISO 字符串且**非降序**（追加时序单调）② `fingerprint` 64 位 hex ③ `source=chat-delegated` 行必有非空 `quote` ④ `doc` 匹配 `workflow/(intents\|specs\|plans\|incidents)/[^/]+\.md` 且当前树存在 ⑤ `stage` ∈ 合法跳转集（approved/done/fixed/closed/superseded/cancelled） |
| 台账不存在 / 零提交历史 | 静默过（装户/新仓无台账面） |
| 违例 | exit 1，stderr 逐条指明：违规提交 SHA + 不变量类型（前缀破坏：删 N 行 / 改写首差异偏移）或行号 + 行级违例类型；修法指引 = 「台账历史不可改写——误写只能追加补偿行，篡改须 revert 整个提交并重新追加」 |
| 全过 | exit 0 静默 |

### 模式二：--staged 前置（pre-commit）

| 场景 | 行为 |
|------|------|
| 暂存含台账变更 | `--staged`：暂存 blob 必须**以 HEAD blob 为前缀**（git show :file vs HEAD:file，对象库口径同上）→ 过；删改历史行 → exit 1 指明差异类型 |
| 暂存未触台账 / 无 HEAD 版本（首次入库） | 静默过 |

### 接线

- **ci.yml**：机器门步骤追加 `node .agents/scripts/check-ledger-invariant.mjs`；checkout `fetch-depth: 0`（全史）——若克隆深度不足取不到全史，脚本输出警告并按可得的最早提交为基线（fail-open 于深度、fail-closed 于内容，CI 配全深故实际全覆盖）
- **pre-commit**（templates/_githooks + 装副本）：敏感信息扫描前、guard `[ -f .agents/scripts/check-ledger-invariant.mjs ]` + `git diff --cached --name-only` 含台账才调 `--staged`（毫秒级）
- **README 硬规则**：5 条后追加第 6 条「台账不可变：confirmations.jsonl 历史行禁删改（机器门=CI 全扫 + pre-commit --staged）；修正走追加补偿行」

## 数据流

```
CI（push/PR）
  → checkout fetch-depth:0 → check-ledger-invariant（历史全扫 + 终树行级校验）→ 违例即标红
git commit
  → pre-commit 检测暂存触台账 → check-ledger-invariant --staged（暂存 vs HEAD 前缀）→ 违例拦提交
合法追加（confirm-doc appendLedger）
  → 新行 append → 两种模式均前缀扩展 → 放行
```

## 系统改动

| # | 文件（双源成对） | 类型 | 内容 |
|---|------|------|------|
| 1 | `templates/_agents/scripts/check-ledger-invariant.mjs` | 新增 | 双模式校验本体（--root 注入；头注释载判据、不可变原则与 CRLF 口径说明） |
| 2 | `templates/_agents/scripts/check-ledger-invariant.test.mjs` | 新增 | fixture：真 git 仓注入——合法追加 ×2 过 / 删历史行拦 / 改历史行拦 / 非前缀改写拦 / ts 乱序拦 / 伪指纹拦 / 空 quote 拦 / doc 路径缺失拦 / staged 双态 / 首次入库过 / 空台账过 |
| 3 | `templates/_githooks/pre-commit`（+装副本） | 修改 | --staged 接线（guard + 暂存触发） |
| 4 | `.github/workflows/ci.yml` | 修改 | fetch-depth:0 + 机器门步骤追加 |
| 5 | `workflow/README.md` + `templates/workflow/README.md`（owned 对） | 修改 | 硬规则第 6 条（台账不可变） |
| 6 | `.agents/kit.json` | 自动 | sync 登记新脚本与测试 |

## 约束遵守映射

- **只增不松**：纯新增校验面与接线，零既有判据变化 ✓
- **双源纪律**：脚本/测试/hook 改包源先行 + sync；ci.yml 与根 hook 为仓内单侧（无对侧）✓
- **判据一手事实（batch-ledger-audit 判准）**：直接比较 git 对象库 blob（写入时的确定事实），不猜工作树状态；行级校验只读结构字段不做行为推断 ✓
- **检查 20 合规**：新脚本带兄弟测试 ✓
- **装户兼容**：无台账/旧副本无脚本均静默跳过，零新告警 ✓

## 风险评估

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| R1 | 真仓历史存在既有违例（如早期手工修正/CRLF 归一提交）导致全扫即红 | 中 | 实现第一步先对真仓跑历史全扫；若存在历史违例：属「生效日前存量」——以 policy 锚（invariantSince）豁免锚前提交、只判锚后（沿 repo 生效日惯例），锚定值随实现定并在 spec/README 声明 |
| R2 | CI 浅克隆取不全史 | 低 | fetch-depth:0 显式配置；脚本对深度不足输出警告并声明覆盖边界（fail-open 于深度由 CI 配置兜住） |
| R3 | `--follow` 在文件重命名历史上取史不全 | 低 | 台账自创建未重命名（单一路径）；脚本注释声明边界 |
| R4 | 误拦合法操作（如用户手动整理台账尾部未提交行） | 低 | 前缀不变量允许追加与不动，仅拦删改已提交内容——正是要拦的面；修法指引明确 |
| R5 | 回滚 | 低 | 删两处接线 + sync 即回退；纯增量校验面 |

## 确认与复核

- 确认日期：2026-10-02（用户对话内「确认」代录，台账 source=chat-delegated）
- **实现前置实测（R1 排除）**：真仓台账全历史预检——90 个相关提交、时间正序逐字节前缀零违例、现 207 行——append-only 事实成立，无需生效日锚，门上线即绿
- 复核：已完成（independent-reviewer 新上下文）——0 P0 / 0 P1 / 1 P2（删除提交 `continue` 可作「删除→重加」绕基线），建议放行；P2 已收口升级为**任一提交删除台账即 hard fail**（比 skip 更严），随 `6ad4446` 落地。**已知边界声明**：台账重命名未用 `--follow`（自创建单一路径）；克隆深度不足仅扫可得历史（CI `fetch-depth: 0` 兜全史）；force-push 全史重写属无签名方案固有边界（非目标）