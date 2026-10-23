# 当前生效规则视图（生成物，勿手改）

> 生成器 `node .agents/scripts/gen-effective-policy.mjs`（policy.mjs 单源渲染；漂移由 verify.mjs `effective-policy` 门 --check 把关——改 policy 后须重生成并随同提交）。
> 当前生效：**policyVersion 12**（kit.json 声明 12）；视图日期 2026-10-23。

| 锚键 | 生效日/锚 | 消费检查项 | 语义 | 分级 | 现状 |
|---|---|---|---|---|---|
| `moduleSince` | 2026-09-22 | 检查 12 | frontmatter「模块:」枚举合法性（词表单源 .agents/workflow-modules.txt） | advisory | 已生效 |
| `check14Since` | 2026-09-26 | 检查 14 | 新 done 的 spec/plan 须有 approved git 历史（kit 口径恒 advisory 永不升级 hard） | advisory | 已生效 |
| `confirmDocsEffective` | 2026-09-27 | 检查 15 | docs 确认台账两条件准入（台账行 ∪ 自报日期≥锚） | hard | 已生效 |
| `confirmIncidentsEffective` | 2026-09-28 | 检查 15 | incidents 档确认阈值（fixed/closed 配对） | hard | 已生效 |
| `bindingTs` | 2026-09-28 | 检查 15 | 四终态内容绑定（台账行 ts≥锚 才比对 sha256） | hard | 已生效 |
| `check17UnclosedAfter` | 0.8.0 | 检查 17 | 发版提交树未收口三件套——版本 tag 锚（非日期） | hard | 生效（版本锚） |
| `stageGateSince` | 2026-09-29 | 检查 19 | 逐阶段审计（起草先于入口确认 / 台账顺序） | advisory | 已生效 |
| `riskLevelSince` | 2026-10-01 | 检查 1 | intent risk_level 双字段协议（laneOfEntry 判道的生效锚——锚前建档单字段口径不判高） | hard | 已生效 |
| `verifySince` | 2026-10-07 | 检查 8 | 测试绿声明对账（无 SHA 声明「测试绿」须 24h 内凭证）+ confirm-doc →done 前置 | advisory | 已生效 |
| `verifyDocSince` | 2026-10-08T09:37:35Z | 检查 8 | 凭证按 doc 精确绑定的生效时刻（→done 前置与对账按 doc 匹配，不带 --doc 的行不给任何单背书） | advisory | 生效（版本锚） |
| `scopeSince` | 2026-10-09T11:24:43Z | 检查 15 | scope 子项（机器派生改动面 scope{files,sha256}——缺 scope 灰度 warning、摘要不符 hard） | hard | 生效（版本锚） |
| `ledgerDocChainSince` | 2026-10-12T07:20:00Z | 检查 15 | 台账哈希链域从物理序改为按 doc 逻辑序（写入侧 confirm-doc 同批生效） | hard | 生效（版本锚） |
| `incidentRegrSince` | 2026-10-14 | 检查 3x | incident 防复发验证证据门（fixed/closed 须落自动化用例/回归清单引用） | hard | 已生效 |
| `specVerifSince` | 2026-10-13 | 检查 21 | spec 验证落地核查（验证节无测试文件/命令引用——advisory） | advisory | 已生效 |
| `attributionSince` | 2026-10-13 | 检查 24 | incident 归因字段（来源/影响环境必填且在枚举——advisory） | advisory | 已生效 |
| `convergenceSince` | 2026-10-13 | 检查 23 | 判据级收敛对账 advisory 档（证据无效 WARN） | advisory | 已生效 |
| `convergenceHardSince` | 2026-10-14 | 检查 23 | 判据级收敛对账 hard 档（证据无效 HARD-BLOCK） | hard | 已生效 |
| `reviewerSince` | 2026-10-14 | 检查 1 | 独立复核上下文标识（复核行缺「复核上下文：」——advisory） | advisory | 已生效 |

<!-- GENERATED:BEGIN — gen-effective-policy.mjs 整段重写，手工说明写在本行之前 -->
