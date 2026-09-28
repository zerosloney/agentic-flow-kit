---
状态: approved
级别: L2
日期: 2026-09-28
模块: pipeline
备注: 对应 intent/plan 同名主题 ledger-precommit-gate
确认指纹: 09f72f8c8944bca4
---
# SPEC — ledger-precommit-gate

## 功能行为

**变更前**：pre-commit 门禁序 = 闭环配对 → wiki 台账 → 规则面预算 → 双源一致性 → local-pre-commit → 敏感信息扫描与条件构建。台账↔盘面一致性只在手动 `flow-kit doctor` 全量跑时检查（§4，modified=WARN / 缺失=FAIL），提交时刻无人查——「台账 sha 预 landing」（台账记了盘面尚不存在的内容 sha）随常规提交静默落 main，三次实录见 intent。

**变更后**：双源一致性之后插入「managed 台账快检」增量门禁：

- 触发：包源环境（`templates/_agents/` 存在）即恒跑，不设暂存触发；装户环境自然跳过（2026-09-28 独立复核 P2-2 采纳：预 landing 是仓态而非暂存态，暂存 grep 有前缀缝——如 `.githooks/*` managed 件单边漂移不命中——恒跑仅毫秒级 80 份 hash）
- 检查：`node .agents/scripts/check-ledger.mjs`——遍历 `.agents/kit.json` `managed` 列表，逐份以 LF 归一 sha256（同 doctor §4 口径）比对盘面工作树；漂移（盘面≠台账）与缺失逐份列出 rel，非零出口阻断提交，提示跑 sync 成对后原路重试
- 比较工作树而非暂存区（沿双源门禁口径）：分两笔提交但最终一致时不拦

**边界与异常**：

- 无 `.agents/kit.json`（非 flow-kit 安装）→ skip、exit 0
- kit.json 解析失败 → fatal、exit 1（与 doctor §4 同为 FAIL）
- kit.json JSON 合法但 `managed` 缺失/非数组 → fatal、exit 1（独立复核 P2-3 采纳：fail-loud 不静默「全对齐」，同 doctor Array.isArray 口径）
- 装户环境 managed 手改不触发本门禁（走 doctor WARN 口径，不硬拦）
- managed 删除即拦：sync 对 removed 只报不删——删包源 managed 件须手动同步装副本并重跑 sync 刷台账，否则持续拦截（有意为之：缺失比漂移更危险）

## 数据流

无运行时数据流（纯提交时刻静态校验）。读路径：`.agents/kit.json`（台账）→ 逐 rel 读盘面文件 → LF 归一 sha256 → 与台账 sha 比对 → 出口码。不写盘、无网络、无第三方。

## 系统改动

- 新增 `templates/_agents/scripts/check-ledger.mjs`（权威源）：`ledgerDrift(target)` 导出（单测用）+ CLI 出口（`isMain` 探测，沿 source-sync-check 先例）；头部注释交叉引用 doctor §4 / render.mjs shaText 口径
- 新增 `templates/_agents/scripts/check-ledger.test.mjs`：fixture + CLI 出口码 + 真实仓 baseline 全套件
- 修改 `templates/_githooks/pre-commit`（权威源）：头部门禁序注释 + 双源一致性块后插入台账快检块
- 装副本经 `node bin/flow-kit.mjs sync` 刷新：`.agents/scripts/check-ledger{,.test}.mjs`、`.githooks/pre-commit`、`.agents/kit.json` 台账
- 根 `AGENTS.md` + `templates/AGENTS.md`：门禁序括注补「双源一致性 / managed 台账快检」（原括注漏双源，一并补齐）

与 plan §改动面 一一对应。

## 约束遵守映射

- **引擎双源纪律**：权威源全部落 `templates/`（scripts + _githooks），装副本由 sync 生成，不直改 `.agents/`/`.githooks/`；owned 的两份 AGENTS.md 手动双侧同步（incident 2026-09-25-wf-runtime 教训）
- **sha 口径单源**：LF 归一 utf8 与 doctor §4 / render.mjs 写盘归一同口径；装户自包含约束（.agents/scripts 不能 import src/）决定第三份物理实现不可避免，头注释交叉引用——沿 source-sync-check 同款先例
- **门禁只加不绕**：增量门禁（不触发即 skip），非包源环境零开销；不改动既有门禁语义
- **根因不扩散**：修复收敛在「提交时刻查台账↔盘面」一个检查器，不在各门禁处逐个加补丁

## 风险评估

- **误拦风险（中）**：包源环境内 managed 直改会被拦——本仓纪律本就禁止直改 managed（doctor 漂移告警口径），拦截即纪律执行；缓解：阻断文案直接给出 sync 命令
- **装户影响（低）**：装户环境门禁自然跳过，doctor §4 WARN 语义不变
- **性能（低）**：约 65 份 hash（毫秒级），仅暂存触及 .agents/templates 时跑
- **回滚（低）**：删 pre-commit 一个块 + 删两份脚本即完全回退；台账无 schema 变更

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核
