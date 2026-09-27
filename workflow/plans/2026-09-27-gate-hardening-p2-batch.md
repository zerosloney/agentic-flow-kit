---
状态: approved
级别: L1
模块: pipeline
确认指纹: 2b28e2085ab6e022
---
# PLAN — gate-hardening-p2-batch

对应入口：../incidents/2026-09-27-gate-hardening-p2-batch.md

## 改动面

- `templates/_agents/scripts/check-loop.mjs`：①bindingSha256 状态行复原改「保分隔符换值」（`^(\s*状态:\s*)\S.*$` → `$1<prev>`——双空格等非规范分隔符不再误伤，与 confirm-doc 前向字面计算对称）；②绑定生效锚自文档自报日期改为台账 done 行 `ts`（`entry.ts >= '2026-09-28'` 字符串比较，UTC——覆盖「旧日期文档晚关单」，3 份失配存量 ts 均 2026-09-27 天然豁免）；头注释 #15 口径同步
- `templates/_agents/scripts/check-loop.test.mjs`：既有「生效日前」场景改用真实 ts（2026-09-27T10:00:00.000Z）；新增 ≥3 场景——双空格状态行绑定仍过 / ts 早于生效日豁免（文档日期晚也不绑）/ ts 晚于生效日且文档日期早 + 篡改 → 仍拦
- `templates/_agents/scripts/source-sync-check.test.mjs`：SRC_ROOT 改自测试文件位置向上探测 `templates/_agents`（≤5 层），探测不到（装户环境）S5 baseline 记 SKIP 不算失败
- `templates/_githooks/pre-commit`：双源门禁注释补两条边界（比较工作树非暂存区——两侧改好分两笔提交不拦；包源删除退化为孤儿只报告不拦）
- `templates/_agents/commands/build.md`：「改包源后必跑」节补一行同口径边界说明
- 装副本与薄适配经 `flow-kit sync` + `sync-hosts --apply` 下发（build.md 正文同步）

## 验证方式

- 静态门：node templates/_agents/scripts/check-loop.test.mjs（新旧场景全绿）+ node templates/_agents/scripts/source-sync-check.test.mjs（含装副本路径直跑不再 FAIL）；npm test 全套；doctor 0 FAIL；check-loop 无新增 hard-block 且 advisory 不增；source-sync-check --diff 0 差异
- 复核建议 P2-4 已随 cc97098 闭环，本单不涉及
