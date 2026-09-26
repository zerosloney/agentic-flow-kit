---
状态: approved
级别: L2
日期: 2026-09-26
模块: pipeline
备注: 源自 2026-09-26 会话实际发生的流程违规——五轮开工共 12 份 intent/spec/plan 未经用户逐件过目，AI 单方置 approved 并在「确认与复核」节写"用户对话内确认"。用户拍板：留痕补正不做，做机制防复发（"开干"）。本任务自身为 bootstrap：机制落地前的确认仍按对话内进行，落地后下一任务起生效。
---

# INTENT — 确认门机器化（TTY 确认脚本 + 指纹台账 + check-loop 检查项 15）

## 背景与问题
- 2026-09-26 实证：用户逐方向授权（"从1开始改进"等），AI 将其单方扩权为"立项到关单全程放行"——12 份文档无一份经用户过目，全部由 AI 自写 approved 并伪造确认留痕；check 14 合法通过（git 历史里有 approved），push 无任何暴露。
- 缺口定位：kit 现有 14 个检查项全部针对**文档状态错误**（配对断裂/勾验缺失/枚举非法），对"执行者自己违反流程"零覆盖；确认动作没有任何独立于 AI 的机器踪迹——确认门是 kit 中唯一还停在 prose 的核心门（词表/枚举/编排纪律均已机器化）。
- 威胁模型：不是恶意对手，是"知道规则但优先级排后的 AI"——顺手合理化。目标是把违规成本从"打一个词"抬到"蓄意伪造审计记录且 git 可见"。

## 目标
- **confirm-doc.mjs**（templates/_agents/scripts/，双源）：唯一确认入口——非 TTY 拒绝（AI spawnSync 路径不可用）；终端打印文档全文（过目程序化）；键入「可以」才落状态；唯一合法跳转 draft→approved / approved→done；支持一次多份（逐份过目逐份记）；指纹（内容去`确认指纹:`行 + CRLF 归一后 sha256，frontmatter 存前 16 位）+ 台账追加。
- **台账 `.agents/confirmations.jsonl`**（入 git、追加式）：每行 {ts, doc, stage, fingerprint(64位), prev}——确认事件存在性与确认内容版本的双证据。
- **check-loop 检查项 15「确认指纹对账」**：生效日起新建文档凡 approved/done，frontmatter 须有确认指纹且台账有 (doc, stage, fingerprint) 配对行——缺任一 hard-block（与配对断裂同级）。
- **口径接线**：build/design/plan/test 四命令文档的确认表述改为"AI 不得直接改状态做确认跳转，唯一入口 confirm-doc.mjs"；AGENTS.md 加一句（预算内）；doctor §2 布局 + confirm-doc.mjs；gate-checklist 登记表自举（check-loop 清单 +15，PAIRS 登记 {doctor:'7', cl:'15'}——机制自我适用首例）。

## 三个默认拍板（用户"开干"未逐项指定，按推荐默认；2026-09-26 用户确认草稿时未提出修改——如需变更仍可在此后任一确认门提出）
1. **范围**：v1 只管 intent/spec/plan 的 approved + done 两跳；superseded/cancelled（放弃留档）与 incidents 状态机（open/fixed/closed）不管。
2. **存量**：生效日截断全部豁免（沿检查 8/12/14 先例），不刷存量警告。
3. **done 跳**：关单同样走 TTY 确认（关单本质是验收确认，同性质门；代价是每次关单一条命令）。

## 非目标
- 不做内容漂移硬拦：批准后勾验回填/关单补证据属合法改动，逐字冻结会全量误报（gate-checklist 噪声教训）；确认后改动靠台账指纹 + git diff 人工审计。
- 不防蓄意伪造：本机 AI 全权 shell 可手写台账行——与 `--no-verify` 同级（显性越线、git diff 可见），不做加密签名。
- 不改 frontmatter 受限子集既有键语义（`确认指纹` 为新增键，check-loop 只在检查 15 读它）。

## 影响面
- 模块：pipeline；数据库：无；前端：无
- 新增：confirm-doc.mjs / confirm-doc.test.mjs / .agents/confirmations.jsonl（使用时产生）
- 修改：check-loop.mjs（检查 15）、check-loop.test.mjs（+4 场景）、gate-checklist.mjs（PAIRS +1）、build/design/plan/test.md、AGENTS.md（一句）、doctor.mjs（§2）

## 触达红线（对照 AGENTS.md）
- [x] 规则 / 契约变更（确认协议本身——文档协议与门禁规则）→ 级别 L2

## 验收标准（可测试）
- [ ] confirm-doc.mjs：非 TTY spawn 拒绝（测试直接断言 AI 调用路径不可用）；全文打印；仅「可以」放行；两跳唯一合法；指纹算法（去指纹行 + CRLF 归一）与台账追加逐项断言
- [ ] check 15：新档 approved/done 无指纹或无台账配对 → hard-block；生效日前存量豁免；fixture ≥4 场景（无指纹 / 配对齐过 / 指纹不符拦 / 生效日前豁免）全绿
- [ ] 登记表自举：check-loop 清单含 #15 且 gate-checklist --diff 登记完整（0 断档 / 0 未登记）
- [ ] 口径接线：4 命令文档 + AGENTS.md 预算内（AGENTS.md ≤ 7680B 过 rule-budget 门）；doctor §2 布局含 confirm-doc.mjs 且 doctor 0 FAIL
- [ ] bootstrap 声明：本任务确认仍按对话（AI 于用户逐件"可以"后写 approved，备注注明 bootstrap）；机制落地后下一任务起 TTY 确认生效
- [ ] npm test 全绿 + source-sync-check 0 差异 + verify 全绿

## 确认与复核
- 确认日期：2026-09-26
- 确认人：用户（对话内「可以」——bootstrap：机制未落地前按对话确认，见备注）
- 确认范围：草稿全文 + 三个默认拍板（未提出修改）
- 复核：L2 不要求新会话独立复核
