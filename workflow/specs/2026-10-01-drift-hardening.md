---
状态: approved
级别: L2
日期: 2026-10-01
模块: pipeline
备注: 自报制漂移加固批——触达面判低拦截 + 探索泳道漏标记拦截；入口 intents/2026-10-01-drift-hardening.md
确认指纹: d9427ff3709b40d2
---
# SPEC — drift-hardening

## 功能行为

新增 pre-commit 泳道完整性门禁（单一脚本承载两段检查），堵两类自报制漂移：

**检查 A：触达面判低拦截**（堵判级漂移——根因项）

| 场景 | 行为 |
|------|------|
| 暂存 diff 命中项目 L2 触达面模式，且存在活跃（draft/approved；incident 为 open/fixed）L2/L3 入口 | 放行（归因歧义接受为已知边界，见风险评估 R2） |
| 命中面模式，活跃入口**全为** L0/L1 | **hard-block**：`[触达面判低]` 命中文件清单 + 最新关联入口名 + 修法三选（升级级别并补同名 spec / 关单或放弃残留入口 / 面清单误配则修配置） |
| 命中面模式，无任何活跃入口 | 仅 advisory 一行（可能是 docs/bootstrap 豁免类改动），放行 |
| 未命中面模式 / 配置文件缺失或为空 | 静默跳过（装户无感升级） |
| experiment/* 分支上 | 检查 A 降级 advisory（报告不阻断，与该泳道既有哲学一致；转正由 pre-push 加固门兜底） |

**检查 B：探索标记拦截**（堵探索泳道漏标记——README 明文的诚实边界）

| 场景 | 行为 |
|------|------|
| experiment/* 分支上暂存新建/修改的 `workflow/intents/*.md`（排除 `_TEMPLATE`），frontmatter 无 `阶段: exploring` 且无 `状态: exploring`（口径同 check-loop 加固门 check-loop.mjs:1118） | **hard-block**：补一行 frontmatter 零成本，不与泳道 advisory 哲学冲突（advisory 免的是闭环纪律负担，不免标记本身——标记是加固门覆盖率的前提） |
| 同上但已带任一标记 | 放行 |
| 非 experiment/* 分支 / detached HEAD | 检查 B 不触发 |

**通用边界**：路径读取一律 `-c core.quotepath=off`（非 ASCII 路径教训，同 check-pairing-incremental.sh:15）；frontmatter 读取容忍 CRLF（显式去 `\r`，同 rule-budgets 教训）；暂存清单用 `--diff-filter=ACMR`；`_TEMPLATE.md` 排除。

**判据设计原则**（incidents/2026-09-28-batch-ledger-audit 教训的直接应用）：只用写入时确定已知的一手事实（暂存文件清单、工作区 frontmatter 字段、当前分支名），不用可规避信号反推过程事实。

## 数据流

纯只读检查，无持久化、无网络、无第三方调用：

```
git commit → .githooks/pre-commit（门禁编排）
  → node .agents/scripts/check-lane-surface.mjs
      读取① git -c core.quotepath=off diff --cached --name-only --diff-filter=ACMR（暂存清单）
      读取② git rev-parse --abbrev-ref HEAD（当前分支——检查 A 泳道模式 / 检查 B 触发条件）
      读取③ .agents/lane-surfaces.txt（L2 触达面模式表；ERE 逐行，# 注释与空行忽略；缺失/空 = 检查 A 跳过）
      读取④ workflow/{intents,incidents}/*.md frontmatter（状态 / 级别 / 阶段）
      判定 → exit 0（放行/advisory）或 exit 1（阻断，stderr 出 [标签] 消息）
  → run_gate 非零即阻断提交
```

配置表经 `node bin/flow-kit.mjs sync` 作为 managed 文件下发（沿 rule-budgets.txt 先例）；包源为 `templates/_agents/lane-surfaces.txt`。

## 系统改动

| # | 文件 | 类型 | 内容 |
|---|------|------|------|
| 1 | `templates/_agents/scripts/check-lane-surface.mjs` | 新增 | 两段检查本体；头注释写判据、教训引用（batch-ledger-audit 判准 / quotepath / CRLF）与已知边界 |
| 2 | `templates/_agents/scripts/check-lane-surface.test.mjs` | 新增 | fixture 用例：S1–S6 全场景正反例 + 平台边界（CRLF frontmatter、quotepath） |
| 3 | `templates/_agents/lane-surfaces.txt` | 新增 | 配置模板：格式说明注释 + 本仓默认面清单（`templates/`、`.agents/(scripts\|hooks\|commands\|roles)/`、`.githooks/`、`bin/`、`modules/`——本仓的引擎/契约面） |
| 4 | `templates/_githooks/pre-commit` | 修改 | 泳道完整性门禁接线（pairing 门之后）：guard `[ -f .agents/scripts/check-lane-surface.mjs ]`，存在即 `run_gate` 调 node；装副本经 sync 下发 |
| 5 | 根 `AGENTS.md` + `templates/AGENTS.md`（owned 对，手动双改） | 修改 | 「门禁与提交」pre-commit 括号枚举补「泳道完整性」；措辞受 7680 字节预算约束 |
| 6 | `workflow/README.md` + `templates/workflow/README.md`（owned 对，手动双改） | 修改 | 「探索泳道」节：删「漏标记不被加固门覆盖」诚实边界的"裸奔"表述，改为已由 pre-commit 拦截的口径；「使用方式·验证」提及新门禁 |
| 7 | `.agents/kit.json`（managed 台账） | 自动 | sync 纳管新增文件（sha 注册），非手改 |

不改：check-loop.mjs 及其判据（含加固门转正判据——非目标）、pre-push、confirm-doc、fill-* 脚本。

**已知边界（声明不修）**：检查 A 为 commit-time 门禁，CI/pre-push 复跑面暂无对应全量检查（push 时刻无暂存 diff 一手事实，树级反推违背判据原则）——沿「增量门禁 pre-commit-only」既有先例（check-pairing-incremental 亦无 push 面等价物之外尚有 check-loop 全量兜底，本项无，接受并声明）。

## 约束遵守映射

- **引擎双源纪律（根 AGENTS.md 项目适配区）**：全部引擎改动落 `templates/`（#1–#4），随后 `sync` 下发装副本；`.agents/`/`.githooks/` 不直改 ✓
- **owned 文件手动同步**：#5/#6 两对 owned 文件逐字双改（sync 不覆盖 owned）✓
- **跨宿主适配层（B-b）**：不触及 commands/roles 正文，无需 sync-hosts ✓
- **常驻面体积预算**：`.agents/scripts/` 无预算行（预算只覆盖 AGENTS.md 与 .agents/commands/）；#5 的 AGENTS.md 改动受 7680 字节上限——改动控制在净增一句话内，超余量则先下沉措辞 ✓（风险 R3）
- **装户兼容 / 只增不松**：门禁接线 guard 存在性检查（旧装副本无脚本自然跳过）；配置缺失 = 检查 A 静默跳过，零新噪声（沿「不可消除噪声淹没真漏点」判准）✓
- **门禁消息约定**：`[标签]` 前缀 + 具体修法指引（同既有门禁文案体例）✓
- **判据一手事实原则**（intent 引入，源自 batch-ledger-audit 复盘）：三处读取均为一手事实（暂存清单 / 分支名 / frontmatter），无任何时间戳或字符串相等反推 ✓
- **Conventional Commits 中文提交**：plan 阶段落实（docs 留痕单独提交）✓

## 风险评估

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| R1 | 误拦合法提交：L2 工作进行中 + 残留未关单的 L0/L1 活跃入口 → 全 L0/L1 判定误命中 | 中低 | 判据含「存在活跃 L2/L3 即放行」豁免；命中残留件时消息点名该件——关单/放弃残留件本身是卫生要求，三选修法明确；worst case 一条 `docs` 提交先关掉残留件 |
| R2 | 归因歧义：活跃 L2 存在时，实际干 L2 面的是那个 L0/L1 入口（豁免被蹭） | 中 | 机器无法归因主题（反推即违背判据原则）——声明为已知边界；check-loop 既有「红线判低」仍拦自勾红线的件；探索分支另有加固门 |
| R3 | AGENTS.md 预算超限（当前上限 7680 字节） | 低 | 净增控制在一行枚举内；提交前 `rule-budget.sh --staged` 实测，超限先精简既有措辞再增 |
| R4 | 装户升级差异（旧装副本无脚本/无配置） | 低 | guard + 配置缺失跳过 = 行为完全向后兼容；无 schema、无迁移 |
| R5 | 平台坑：CRLF frontmatter / 非 ASCII 路径 / detached HEAD | 低 | 三者均有既有教训与先例处理（显式去 `\r`、quotepath=off、detached 按 strict 走沿 pairing 先例），fixture 覆盖 |
| R6 | 回滚 | 低 | 删接线一段 + sync 即整体回退；纯增量门禁，无数据、无状态 |

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核；本 spec 关键判据（关联规则 / 豁免边界）建议 test 阶段由 independent-reviewer 按 L2 口径复核 diff 与判据一致性
