---
状态: done
级别: L2
日期: 2026-10-01
模块: pipeline
备注: 引擎脚本测试覆盖门（v09-review-defects 门禁缺位追踪）；入口 intents/2026-10-01-gate-script-test-coverage.md
确认指纹: e1394ffbab9d3e2b
---
# SPEC — gate-script-test-coverage（引擎脚本测试覆盖门）

> 对应 intent：`intents/2026-10-01-gate-script-test-coverage.md`。把 v09-review-defects 复盘的三件套承诺落地为机器检查 + trust-mode 补测 + 豁免机制。

## 功能行为

### 检查 20：引擎脚本测试覆盖（warning 级，仅包源环境）

| 场景 | 行为 |
|------|------|
| 包源环境（`templates/_agents/scripts/` 存在） | 扫描 `templates/_agents/scripts/*.mjs`（排除 `*.test.mjs` 自身）——每脚本须有**同名兄弟 `.test.mjs`**，或在豁免文件 `.agents/scripts-test-exempt.txt` 中登记 |
| 兄弟测试缺失且未登记豁免 | `warning`：`[WARN 脚本测试缺失] <脚本> 缺同名 .test.mjs——新增引擎脚本默认必须带测试；库件/工具可在 .agents/scripts-test-exempt.txt 登记豁免` |
| 已登记豁免 | 不告警（豁免行 = 脚本名 | 理由 | 覆盖证据，如套件名或「无」） |
| 装户环境（无 templates/） | 检查整体跳过（覆盖规则是包源开发纪律，非装户运行时要求） |

检查按 check-loop 既有扫描节奏运行（不新增调用点），退出码不因 warning 变非零——warning 级。

### trust-mode.test.mjs（首个达标样本）

| 场景 | 断言 |
|------|------|
| 缺 trust-mode.json | 读取回落 `{enabled:false, level:0, name:'Strict'}`（fail-closed） |
| 三级语义 | `NAME_BY_LEVEL={0:'Strict',1:'Standard',2:'Trusted'}` 与 `LEVEL_BY_NAME` 双向正确 |
| `--level Trusted` 写入 | 配置落盘 enabled/level/name 正确 |
| 与 confirm-doc `--auto` e2e | Strict（缺文件）下 `confirm-doc --auto` 拒绝不落账；Trusted（注入 trust-mode.json）下 L0/L1 放行（source=ai-auto-trust-L2） |

### 豁免文件

- 路径：`.agents/scripts-test-exempt.txt`（managed，经 `templates/_agents/scripts-test-exempt.txt` sync 下发；装户同样存在）
- 格式：`<脚本名> | <理由> | <覆盖证据（套件名，无则「无」）>`；`#` 注释行；空行忽略
- 初始内容 6 行（基于 2026-10-01 grep 实据）：
  - `check-metric-claims.mjs | 经 check-loop.mjs 消费 | 由 check-loop.test.mjs 间接覆盖其调用路径`
  - `ensure-board.mjs | 看板启动器（需真实端口/进程环境） | 无（工具豁免，后续批次评估补测）`
  - `policy.mjs | 库件 | 被 check-loop.test.mjs 直接 import 覆盖`
  - `stage-gates.mjs | 库件 | 被 check-loop.test.mjs 直接 import 覆盖（fill-*/confirm-doc.test 消费其行为）`
  - `verify-wiki-consistency.mjs | wiki 一致性校验工具 | 无（工具豁免，后续批次评估补测）`
  - `wiki-search.mjs | 检索库件 | 无（工具豁免，后续批次评估补测）`

## 数据流

```
check-loop 扫描工作区
  → 若 templates/_agents/scripts 不存在 → 跳过（装户）
  → 读 .agents/scripts-test-exempt.txt 豁免集合
  → 列 templates/_agents/scripts/*.mjs（排除 *.test.mjs 与豁免集合）
  → 缺同名兄弟 .test.mjs → warning 行（不阻断）
npm test → run-tests.mjs glob 自动收集 trust-mode.test.mjs
```

## 系统改动

| # | 文件（双源：templates/ ↔ .agents） | 类型 | 内容 |
|---|------|------|------|
| 1 | `templates/_agents/scripts/check-loop.mjs` | 修改 | 新增检查 20（包源环境扫描脚本测试覆盖，warning）+ 头注释检查清单同步 |
| 2 | `templates/_agents/scripts/check-loop.test.mjs` | 修改 | 检查 20 fixture：缺测试→warning / 有测试→不报 / 豁免登记→不报 / 无 templates→跳过 |
| 3 | `templates/_agents/scripts/trust-mode.test.mjs` | 新增 | 三级语义 + 缺文件 fail-closed + `--level` 写入 + confirm-doc `--auto` e2e（Strict 拒/Trusted 放行） |
| 4 | `templates/_agents/scripts-test-exempt.txt` | 新增 | 6 行豁免登记（managed，sync 下发） |
| 5 | `templates/workflow/README.md` + `workflow/README.md`（owned 对） | 修改 | 硬规则/闭环规则增补「新增引擎脚本默认必须带 `.test.mjs`，缺失由检查 20 列出；库件/工具须登记豁免」 |
| 6 | `.agents/kit.json` | 自动 | sync 登记新文件 |
| 7 | gate-checklist 登记表（如存在检查项登记） | 修改 | 检查 20 条目同步 |

## 约束遵守映射

- **只增不松**：新检查只读目录结构 + 登记文件，不触碰既有判据；warning 级不改变既有阻断面 ✓
- **双源纪律**：检查/豁免文件先落 templates/ 再 sync；装户侧 .agents/ 不直改 ✓
- **测试覆盖真实性（batch-ledger-audit 教训）**：trust-mode.test 断言行为而非实现自洽；豁免文件如实登记「无」覆盖的脚本，不假装有 ✓
- **装户兼容**：无 templates/ 环境整体跳过，零新告警 ✓
- **非平凡逻辑留可运行检查**：新检查自带 fixture；trust-mode 补测纳入 npm test ✓

## 风险评估

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| R1 | 豁免机制被滥用（无覆盖脚本大量进豁免，检查形同虚设） | 低 | 豁免文件是 managed 受控文件 + warning 会因新增脚本再暴露；README 规范条目明确「登记豁免 ≠ 免责，须写明理由与证据」 |
| R2 | 新检查对存量脚本产生 warning 噪声（7 个中 6 个登记后剩 0 噪声；未来新增脚本若漏测会即时列出） | 低 | 豁免登记覆盖存量 6 个；trust-mode 补测后无存量告警，验收断言零 warning |
| R3 | gate-checklist 登记表同步遗漏导致口径分叉 | 低 | 实现时对照 `gate-checklist.mjs --diff` 补齐检查 20 |
| R4 | 回归 | 低 | 全量 npm test + verify.mjs + fresh-clone 门禁复跑 |

## 确认与复核

- 确认日期：2026-10-01（用户对话内「确认」代录，台账 source=chat-delegated）
- 复核：已完成（independent-reviewer 新上下文两轮）——0 P0 / 0 P1 / 2 P2；检查 20 判据（gate-checklist 0 断档/0 未登记、真仓零告警）、豁免真实性（grep 实据）、trust-mode.test 有效性（8/8 行为断言）、范围纪律（13 文件全在 spec 清单）均核实；P2-1 随 `2fd70ae` 收口，P2-2 留后续