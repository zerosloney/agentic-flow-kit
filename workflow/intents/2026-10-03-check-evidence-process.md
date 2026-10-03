---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-03
模块: pipeline
备注: check-loop 证据真相校验支持过程证据形态（执行器驱动提交）——2026-10-03 用户拍板方案 A；源起 pipeline-run 关单后 37b552a 证据无关 hard-block
确认指纹: 1e03da068dc150dd
---
# INTENT — check-evidence-process

## 背景与问题

- 需求来源：pipeline-run（2026-10-02 关单）引入了新的验收证据形态——**过程证据**：验收标准要求「演练矩阵真实穿越」，其证据是执行器自己驱动产生的提交（如 L0 演练 run 的 37b552a，动 runtime-env.md），天然不在本任务 plan 改动面内。
- 冲突实证：check-loop 检查 8 的 `verifyEvidenceTruth`（.agents/scripts/check-loop.mjs:570-615）要求证据 SHA 须触及同名 plan「改动面/任务拆解」声明文件——过程证据被判 `[证据无关]` hard-block；而修订已 done 文档又触发检查 15「确认内容漂移」hard（防确认后篡改，行为正确）。两头 hard，系统出口仅 superseded 重立或门禁增强。
- 用户拍板（2026-10-03 对话，方案 A）：门禁增强——按闭环规则 4，根因属「门禁缺位」须立本 intent 系统性改进。

## 历史教训/防复发

- 检索结果：`kb-search "证据 校验" --type intents` 命中 25 份（claim-exceeds-fix / audit-gate-hardening 等证据对账线），无「过程证据形态」先例。
- 避坑指南：
  1. 判据必须机器可判、与 run 事件流同源——执行器提交信息统一带 `（pipeline-run <runId>）` 标记（docsCommit 既有格式），不引入 prose 约定。
  2. 豁免只放行「irrelevant」不放行「forged」（SHA 不存在仍拦）——防复发线不放松。
  3. 本事件另一根因：**勾验后、done 前未重跑 check-loop**（verify 顺序跑反）——防复发以测试钉住「证据含外部 SHA 的 done 档在勾验后即被校验」场景；test.md 侧顺序提示属文档面，若触常驻面预算则改落 regression-checklist（择轻落点）。

## 目标

- check-loop `verifyEvidenceTruth` 新增过程证据判据：证据 SHA 与 plan 声明文件无交集时，`git log -1 --format=%s <sha>` 提交信息匹配执行器标记格式（`（pipeline-run <runId>）`，docsCommit 既有产物）→ 判 `type: 'process'` 放行，hard-block 消除。
- 存量修复：2026-10-02-pipeline-run.md 的 37b552a 证据在新判据下合法（该提交信息含「pipeline-run 20261002-1819-runtime-env-md-c2ju」标记，格式实证吻合），npm test / verify / check-loop / doctor 恢复全绿。
- 测试：check-loop 测试套件补过程证据正反例（有标记放行 / 无标记仍拦 / SHA 不存在仍拦）。

## 非目标（防范围蔓延）

- 不改检查 15 内容绑定（防篡改语义不动）。
- 不改证据写法规范（不要求用户改证据措辞）。
- 不做执行器标记的防伪加固（git 历史本身即证据，伪造提交信息等同伪造提交，已有 forged 拦截兜底）。

## 约束

- 复用：verifyEvidenceTruth 既有结构（irrelevant 分支前插 process 判定）；改动落包源 `templates/_agents/scripts/check-loop.mjs` 再 sync 装副本。
- 不许动：检查 8 的勾验/缺证据判据、检查 15 全部、证据行捕获逻辑。

## 影响面

- 模块：pipeline
- 数据库：无
- 门禁判据面：check-loop 检查 8 语义核验新增一类放行（新消费方=所有 done 档验收证据）

## 触达红线（对照 AGENTS.md）

- [x] 规则 / 契约变更：check-loop 门禁判据扩展（检查 8 证据核验语义）→ L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → L3（不触及）

> 同名 spec：workflow/specs/2026-10-03-check-evidence-process.md

## 验收标准（可测试）

- [ ] check-loop 测试套件新增过程证据三例全绿（有标记放行 / 无标记 irrelevant 仍拦 / 不存在 SHA forged 仍拦），既有用例零回归
- [ ] 真实仓实证：`node .agents/scripts/check-loop.mjs` exit 0（2026-10-02-pipeline-run 的 37b552a 证据放行，hard-block 消除）
- [ ] 全量门恢复：npm test 全部套件通过 + verify.mjs 全绿 + doctor 0 FAIL
- [ ] 双源：source-sync-check --diff 0 命中（仅既有孤儿）
- [ ] p2-pool-batch3 incident 在全量绿后按两跳关单（本 intent 不含其内容，仅顺序依赖）

> **闭环对账**：关单在 test 阶段。intent 置 done 前逐条勾验补证据。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：intent 全文
- 复核：L2 不强制独立复核；实现后 test 阶段由用户届时拍板是否补
