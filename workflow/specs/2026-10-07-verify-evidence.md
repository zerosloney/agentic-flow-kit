---
状态: approved
级别: L2
日期: 2026-10-07
模块: pipeline
备注: 对应 intent 2026-10-07-verify-evidence（done 前测试绿机器凭证）；方案 = verify.mjs 落账点 × confirm-doc 门前置 × 检查 8 凭证对账，policyVersion v5
确认指纹: f339ee677ef5d2c9
---
# SPEC — verify-evidence

## 功能行为

**落账点选型**：`verify.mjs` 是 pipeline-run 与手动关单的共用编排（npm test → check-loop，fail-fast，`--test-cmd` 注入口供测试）——绿行落账放它的「1/2 测试通过」之后，两条路径自然同构；直接裸跑 `npm test` 不落账（凭证语义 = 「按门跑了 verify」，本身就是对齐引导）。

场景 1｜verify 留痕（机器事实的产生）
- verify.mjs 的 npm test 步骤 `exitCode === 0` 时，向 `<repoRoot>/.agents/verifications.jsonl` append 一行：
  `{"ts":"<ISO>","exitCode":0,"suite":"npm test","passed":<n>,"failed":<n>,"runId":"<可选>"}`
  —— passed/failed 从输出尾部正则抓「合计: PASS (\d+) / FAIL (\d+)」（run-tests.mjs 汇总行），抓不到则两键省略（exitCode 才是硬事实，解析失败不阻塞落账）；runId 取 env `PIPELINE_RUN_ID`（pipeline-run 路径自动绑定，手动路径省略）
- `exitCode !== 0` **不落账**（红不产生凭证；消费方只关心「近期有没有绿」，红行无消费方不存）
- check-loop 步骤失败同样不落账（verify fail-fast 在 check-loop 前置的 npm test 已拦；若 npm test 绿而 check-loop 红，exit 1 无落账——凭证定义 = 测试绿，check-loop 门另有自己的拦截）
- 台账 append-only，坏行容忍跳过（confirmations.jsonl 同口径）；落账失败（IO 异常）不阻断 verify 主流程，stderr 出账

场景 2｜done 门前置（advisory，灰度第一档）
- confirm-doc 将文档置 **done** 且该文档正文含「验收标准」节（判据 `/^##\s*[^#]*验收标准/`，检查 8 同款）且 kit.json `policyVersion ≥ 5` 时：读 verifications.jsonl，若**不存在 ts 距今 ≤ 24h 且 exitCode=0 的行** → `⚠️ 告警`（不拦退出码，文案提示「跑 node .agents/scripts/verify.mjs 后重新关单」）；存在 → 静默
- 覆盖面只含 **intents 侧 done**（验收标准节按文档协议只出现在 intent；specs/plans 无此节自然不触发；incidents 的 closed 不要求——其防复发验证走复盘三件套，属另一条线）
- 窗口 24h：覆盖「跑 verify → 跨会话/隔夜 → 次日关单」的真实节奏；1h 级短窗误伤慢流程。升 hard 条件（装户吃过警告后）留 policyVersion 演进，本批不做

场景 3｜检查 8 证据对账（声明式豁免收口）
- `verifyEvidenceTruth` 对**无 SHA** 的证据串，现状一律 `text` 豁免；本 spec 增一分支：证据串命中测试绿关键词（`测试通过|测试全绿|全绿|测试绿|npm test.*绿`，形态表实现期可扩）且 intent 首次加入 git 日期 ≥ `verifySince`（v5 生效日锚）时 → 凭证对账：窗口 24h 内有绿行 → 豁免成立，出账 `verify` 型留痕（process 先例同款）；无绿行 → **warning**（非 hard——灰度第一档）+ 提示跑 verify
- 有 SHA 的证据照旧优先走 SHA 核验，不进此分支（防误伤既有形态）

场景 4｜向后兼容
- policyVersion v1–v4（缺 `verifySince` 键）→ 场景 2/3 整体跳过（stageGateSince 先例），存量装户零行为变化
- 存量 done 文档：场景 3 以「intent 首次加入 git 日期」为生效锚（addedDates 既有索引），锚前文档零新增 advisory
- 本仓自装 kit.json policyVersion 2 → 5（自吃狗粮；v5 键集 = v2 全键 + verifySince: 2026-10-07）

边界与异常：verifications.jsonl 不存在 → 视为无凭证（首次按门跑 verify 前的正常态，不是错误）；台账行缺 ts/exitCode → 坏行跳过；多仓并行（CHECK_LOOP_ROOT fixture）→ confirm-doc 的 --root 参数天然隔离，测试走此口。

**S18 类断链覆盖论证**：不适用（本机制是新增证据层，无装户模板依赖）；装户收货路径 = 引擎包随版发布 → sync 装回 → 下次关单起 advisory 生效。

## 数据流

纯本地：`npm test`（verify.mjs 编排）→ `.agents/verifications.jsonl`（append-only 绿行）→ 两个消费方（confirm-doc 门前置 / check-loop 检查 8 对账）读窗口内行。无外部服务 / 表 / 网络。kit.json policyVersion 是生效开关单源（policy.mjs POLICIES v5）。

## 系统改动

1. `templates/_agents/scripts/verify.mjs`：npm test 绿后 append 绿行（含正则抓计数 + env runId + IO 失败不阻断）；头注「无状态」表述同步修订（append-only 落账，仍不读不裁）
2. `templates/_agents/scripts/confirm-doc.mjs`：主流程 transition 为 done 且 policy v5 且文档含验收节 → 窗口判定 + ⚠️ advisory
3. `templates/_agents/scripts/check-loop.mjs`：verifyEvidenceTruth 增 verify 分支（关键词表 + addedDates 锚 + 窗口对账 + warnEvidenceExempt('verify') 出账）
4. `templates/_agents/scripts/policy.mjs`：POLICIES v5（v2 全键 + verifySince）
5. `.agents/kit.json`：policyVersion 2 → 5（本仓自装）
6. 测试：verify.test.mjs（--test-cmd 假命令注入先例）+3 场景（绿行落含计数 / 红不落 / 解析失败缺键省略）；confirm-doc.test.mjs +2（无凭证 done → ⚠️ 且 exit 0；有凭证 → 静默）；check-loop.test.mjs +2（锚后无凭证「测试全绿」声明 → warning；有凭证 → verify 型豁免出账）
7. 版本收尾 + CHANGELOG（随 plan §改动面对齐）

## 约束遵守映射

- **引擎双源纪律**：全部改动落 `templates/` → `node bin/flow-kit.mjs sync` 装回；本仓 kit.json policyVersion 升 5 属 owned 台账维护 ✓
- **「无判定依据不产出告警」红线**：三处消费全部可消退（跑 verify 即消；存量锚前跳过；v1-v4 整体跳过）✓
- **append-only 台账纪律**：verifications.jsonl 只增不删、坏行容忍跳过、IO 失败不阻断主流程（stderr 出账）——confirmations.jsonl 同口径 ✓
- **「先 WARN 后 hard」渐进路径**：confirm-doc 前置与检查 8 对账均 advisory 起步（workflows-linter / cross-host-sync 先例）；升 hard 走后续 policyVersion 演进 ✓
- **verify.mjs「只编排不裁决」语义**：落账是事实记录不是裁决（不读旧账、不判窗口、不改退出码）；裁决在两个消费方 ✓
- **常驻面预算**：命令文档零增行，口径走脚本注释 ✓

## 风险评估

- 误伤面：关键词表可能误伤非测试类「全绿」表述（如「CI 全绿」）——缓解：仅对**无 SHA** 证据生效（有 SHA 优先核验）+ warning 不拦 + 形态表实现期实证再扩（check2-datetime 先例：只豁免/命中实证形态）
- 时钟信任：窗口判定用本机时钟，与既有台账 ts 同信任边界（本地边界内不可机器防，git/台账对质兜底）——与 check-loop 自认边界一致，无新增暴露
- 成本：关单前跑一次 verify（分钟级）是既有 test.md 要求的显式化，无新增负担；confirm-doc 读台账为毫秒级
- 兼容：v1-v4 装户零变化；存量 done 零新增 advisory（锚前跳过）；verifications.jsonl 缺失 = 无凭证正常态
- 回滚：revert 提交即完整回滚（新文件 + advisory 层，无迁移无破坏）；kit.json 降 policyVersion 即关闸
- 安全：本地文件读写，不触信任边界外输入

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核（independent-reviewer，实现完成后横切）
