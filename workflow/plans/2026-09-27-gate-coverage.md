---
状态: approved
级别: L2
模块: pipeline
确认指纹: daef3e22b5280ce8
---
# PLAN — gate-coverage

对应入口：../intents/2026-09-27-gate-coverage.md
对应 spec：../specs/2026-09-27-gate-coverage.md

## 改动面

- `templates/_agents/scripts/confirm-doc.mjs`：DOC_RE 收 incidents；nextStage 增 open→fixed / fixed→closed；头注释与用法文案
- `templates/_agents/scripts/confirm-doc.test.mjs`：新跳断言（open→fixed / fixed→closed / closed→null）
- `templates/_agents/scripts/check-loop.mjs`：15 循环扩 incidents——配对（fixed/closed，生效 2026-09-28）+ closed 内容绑定（ts 锚 + 保分隔符，同 done）；头注释口径
- `templates/_agents/scripts/check-loop.test.mjs`：+4 场景（closed 无台账拦 / 配对+绑定一致过 / closed 篡改拦 / open 态不拦）
- `.github/workflows/ci.yml`：test 后加「机器门（服务端兜底）」步骤——check-loop / doctor / source-sync-check --gate / workflows-check 四道串跑
- `templates/_agents/hooks/check-pairing-incremental.sh`：git 管道加 `-c core.quotepath=off` + 注释（引 check-wiki-ledger 教训）
- `AGENTS.md`（owned 手改）：确认门条款补「incidents 的 fixed/closed 同入口」
- `templates/_agents/commands/maintain.md` / `test.md`：确认后 / 关单 bullet 补 incidents 两跳口径
- 装副本与薄适配：`flow-kit sync` + `sync-hosts --apply` 下发

## 任务拆解

1. **T1 incidents 确认门**（confirm-doc + check-loop 15 + 测试 + 文案四处）
   - 判据：confirm-doc.test / check-loop.test 新场景全绿；本仓实跑 check-loop 对存量 incidents 零新增告警
   - 风险：中（状态机扩面——生效日门住存量）
2. **T2 CI 机器门**（ci.yml 四道）
   - 判据：本地按同序四道全绿（与 CI runner 同命令）；yaml 语法过（actionlint 或本地 node yaml 无——以推送前本地实跑为准）
   - 风险：低
3. **T3 quotepatch**（check-pairing 一行）
   - 判据：构造非 ASCII 文件名暂存探针，配对门不再静默跳过（能命中 plan 检查路径）
   - 风险：低
4. **T4 双源同步 + 全套回归**
   - 判据：sync + sync-hosts --apply 后 source-sync-check 0 差异；npm test 全绿；doctor 0 FAIL；check-loop advisory 不增
   - 风险：低

## 执行顺序

T1 → T3 → T2 → T4（T1/T2/T3 相互独立；T4 收口）。

## 验证方式

- 静态门：npm test 全套；doctor 0 FAIL；check-loop 无新增 hard-block 且 advisory 不增；source-sync-check 0 差异
- L2 追加：四道 CI 门本地同序实跑留证；quotepatch 探针留证；AGENTS.md 预算复核（rule-budget --all）
- 回滚：单 feat 提交 git revert 即回；无 schema/数据迁移

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现。
- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 推荐独立复核（independent-reviewer；采纳/驳回由用户定性）
