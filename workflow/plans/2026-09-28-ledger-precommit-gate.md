---
状态: approved
级别: L2
模块: pipeline
确认指纹: 3c49f5e4195460a2
---
# PLAN — ledger-precommit-gate

对应入口：../intents/2026-09-28-ledger-precommit-gate.md
对应 spec：../specs/2026-09-28-ledger-precommit-gate.md

## 改动面

- `templates/_agents/scripts/check-ledger.mjs`（新增）：`ledgerDrift(target)` 读 `.agents/kit.json` managed 列表，LF 归一 sha256（同 doctor §4 口径）逐份比对盘面工作树，返回 `{skipped|fatal|modified[]|gone[]|total|version}`；CLI（isMain 探测）skip/fatal/漂移/缺失分行输出，非零即阻断
- `templates/_agents/scripts/check-ledger.test.mjs`（新增）：S1 全对齐 / S2 内容漂移 / S3 缺失 / S4 CRLF×LF 归一 / S5 无 kit.json skip / S6 解析失败 fatal / S7-S8 CLI 出口码（spawnSync fixture cwd）/ S9 真实仓 baseline（装户环境 SKIP 不计失败）
- `templates/_githooks/pre-commit`：头部门禁序注释补「managed 台账快检(增量)」；双源一致性块后插入台账快检块（同触发条件 grep，node 直调 + 失败提示 sync，沿双源块先例）
- 装副本（`node bin/flow-kit.mjs sync` 刷新）：`.agents/scripts/check-ledger{,.test}.mjs`、`.githooks/pre-commit`、`.agents/kit.json`
- 根 `AGENTS.md` + `templates/AGENTS.md`：门禁序括注补「双源一致性 / managed 台账快检」

## 任务拆解

1. check-ledger.mjs + 测试套件（权威源 templates/_agents/scripts/）
   - 判据：`node templates/_agents/scripts/check-ledger.test.mjs` 全 PASS
   - 风险：低（自包含、无 git 依赖）
2. pre-commit 挂载（权威源 templates/_githooks/）
   - 判据：负例实测——工作树弄脏 managed 件 + 暂存触及 .agents/ → commit 被拦；还原后放行
   - 风险：中（触发条件写错会常拦/漏拦——grep 与双源块同款抄写，降为低）
3. sync 刷装副本 + AGENTS.md 双侧括注
   - 判据：doctor 12 PASS / 0 WARN / 0 FAIL；`npm test` 全部套件通过
   - 风险：低

## 执行顺序

1 → 2 → 3（2 依赖 1 的脚本落位；3 依赖 1/2 权威源定稿）。负例实测在 3 之后做——门禁脚本须先经 sync 落到 `.agents/scripts/` 且 kit.json 登记齐全，拦的是「预 landing」实态。

## 验证方式

- 静态门：`node templates/_agents/scripts/check-ledger.test.mjs` + `npm test`（全部套件）
- L2 追加：负例实测（工作树弄脏 managed 件 → commit 拦 / 还原 → 放行）；`flow-kit sync` 后 doctor 12 PASS / 0 WARN / 0 FAIL；`source-sync-check --gate` exit 0

## 确认与复核

- 确认结果：
- 复核：L2 推荐独立复核
