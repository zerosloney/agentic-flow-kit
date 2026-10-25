---
状态: done
级别: L2
日期: 2026-10-25
模块: infra
确认指纹: b295598c361eb5b6
---
# SPEC — 关单执法点前移批

对应入口：../intents/2026-10-26-closeout-enforcement.md

## 功能行为

### ① 验收勾验前置门（confirm-doc）
→done（docs：intents/specs/plans）且正文含「## 验收标准」节：节内存在行首 `- [ ]` 未勾行 →
拒绝落账（提示逐条勾验补证据，与检查 8 文案口径互引）。节边界 = 「## 验收标准」行到下一
「## 」行或文末；无该节不拦（沿检查 8「含节才判」）；incidents 不在门面。存量终态零回溯。

### ② 放弃态×结构配对豁免（check-loop 检查 1/3）
intent/spec/plan/incident 的结构配对判定（缺同名 plan/spec/入口 → hard）前，st ∈
{superseded, cancelled} → 跳过结构配对（放弃件结构不齐是常态：立了入口就取消）。
「状态未确认」检查口径不变（abandoned 本在 confirmed 集合法）；红线判低、L3 复核等随族
检查不动。incidents 的放弃态（2026-10-25 audit-fixes 枚举收口已认）同步豁免其 plan 配对。

### ③ v12 装户形态测试冒烟（confirm-doc.test）
新组 S56：夹具带 kit.json{policyVersion:12}，L2 intent 两跳全链——approved→done 均落
confirmations.d/ 分片；done 行 doc 链 prevHash 接续 approved 行；在场门按 v12 链行为
（无 delegationSince 键=全量对账）照常执法。confirm-doc.mjs 头注补纪律一行：
「跨形态改动（分片/链/锚）须带 v12 装户形态用例——夹具裸仓=v1 是已知盲区（补偿行首用实证）」。

## 系统改动清单
- 引擎（双落）：confirm-doc.mjs（勾验门 + 头注）、check-loop.mjs（检查 1/3 放弃态豁免）、
  confirm-doc.test.mjs（S1 组 + S56 组）、check-loop.test.mjs（S3 组）
- 数据库：无；前端：无

## 验收判据
| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 |
|---|---|---|
| 勾验门+豁免+v12 冒烟全绿 | npm test | 覆盖 |
| 八门全绿 | node .agents/scripts/verify.mjs | 覆盖 |

## 风险评估
- 勾验门拦住合法关单（节内有意保留未勾项）｜应对：协议本就要求全勾（检查 8 hard 同判据），门只前移时点；文案指向检查 8 修法
- 放弃态豁免被用于逃配对｜应对：放弃态自身不可逆且检查 15 绑定照常（内容漂移拦篡改）；豁免只免「结构不齐」这一类

## 确认与复核
- 确认结果 / 确认时间写在文件头 frontmatter。
