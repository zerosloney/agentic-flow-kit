---
状态: approved
级别: L2
模块: pipeline
确认指纹: aa91dd70d932150f
---
# PLAN — verify-evidence

对应入口：../intents/2026-10-07-verify-evidence.md
对应 spec：../specs/2026-10-07-verify-evidence.md

## 改动面

- templates/_agents/scripts/policy.mjs：POLICIES 增 5（= v2 全键 + `verifySince: '2026-10-07'`，注释含锚语义与缺键回退）
- templates/_agents/scripts/verify.mjs：npm test 绿后 append 绿行到 `<repoRoot>/.agents/verifications.jsonl`——计数正则抓输出尾「合计: PASS (\d+) / FAIL (\d+)」（stdio inherit 模式改为先 pipe 收集再透传，或复用 spawnSync 返回输出；抓不到省略两键）；runId 取 env `PIPELINE_RUN_ID`（缺省省略）；append IO 失败 stderr 出账不阻断；头注「无状态」表述修订（append-only 落账，仍不读不裁）；**check-loop 步骤失败不落账**（fail-fast exit 在后，天然满足）
- templates/_agents/scripts/confirm-doc.mjs：主流程 :322（applyTransition 写盘前）增前置——target 为 done 且 policy v5 且正文含 `/^##\s*[^#]*验收标准/` 节 → 读 verifications.jsonl 判 24h 窗口绿行，无则 `⚠️` advisory（exit 0 不变）；窗口判定函数独立可测
- templates/_agents/scripts/check-loop.mjs：verifyEvidenceTruth 无 SHA 分支前插 verify 分支——证据串命中关键词表 `测试通过|测试全绿|全绿|测试绿` 且 intent 的 addedDateOf ≥ kitPolicy.verifySince → 窗口对账（同 24h 判定单源复用）→ 有绿行 `warnEvidenceExempt('verify')` + `{ok:true, type:'verify'}`；无绿行 `{ok:true, type:'verify-missing'}` 且检查 8 聚合段出 warning（非 blocker）
- .agents/kit.json：policyVersion 2 → 5（本仓自装自吃狗粮；sync 后核对）
- 测试：verify.test.mjs +3（假命令绿 → 绿行落盘含计数；红 → 无落账；输出无汇总行 → 计数键省略）；confirm-doc.test.mjs +2（v5 + 验收节 + 无凭证 → ⚠️ 且落账成功；有近期凭证 → 静默）；check-loop.test.mjs +2（锚后无凭证「测试全绿」声明 → warning；有凭证 → verify 型豁免出账 + exit 不变）
- 版本收尾：package.json / kit.json version → 1.2.0（机制级新增，功能版本）+ CHANGELOG

## 任务拆解

1. policy v5
   - 判据：loadKitPolicy({policyVersion:5}) 返回含 verifySince；v1-v4 返回对象无该键（既有测试口径不破）
   - 风险：低（纯数据）
2. verify.mjs 落账
   - 判据：verify.test.mjs 三场景（--test-cmd 注入先例）；实仓跑一次后 verifications.jsonl 出现合法 JSON 行
   - 风险：低（append-only，IO 失败不阻断）
3. confirm-doc 门前置
   - 判据：confirm-doc.test.mjs 两场景；无验收节文档置 done 零输出（不误伤 specs/plans）
   - 风险：中（动关单主流程——保守点：判定全部前置且只读，任何读取异常降级静默，不改变 exit 语义）
4. 检查 8 verify 分支
   - 判据：check-loop.test.mjs 两场景（fixture 注入 verifications.jsonl）；既有 text 豁免场景（无关键词证据）零变化
   - 风险：中（证据分类点——保守点：仅无 SHA 证据进分支，有 SHA 优先级不变；关键词表从最小集起步）
5. 装回 + 版本收尾
   - 判据：sync 装回零漂移；npm test 全绿；实仓 check-loop 告警数与改前持平（存量零新增）
   - 风险：低

## 执行顺序

1 → 2 → 3 → 4 → 5（3/4 依赖 1 的 v5 开关与 2 的台账格式；2 与 1 可并行，串行控制审阅面）

## 验证方式

- 静态门：`npm test` 全绿（新增 7 场景 + 既有套件零回归）
- 实仓冒烟：跑一次 `node .agents/scripts/verify.mjs` → 台账行落盘且含计数；随后 confirm-doc 关单演练（或实仓下批关单时观察 advisory 行为）；check-loop 实仓跑告警数改前改后对比（存量零新增）

## 确认与复核

- 确认结果：approved（2026-10-07 用户对话内代录「确认」）；done（关单时随入口文档置终态）
- 确认门记录：spec 落账点/窗口/灰度方案已在对话内过目并 approved；plan 为其函数级落点拆解，无新增行为决策
- 复核：L2 推荐独立复核（实现完成后 independent-reviewer 横切）
