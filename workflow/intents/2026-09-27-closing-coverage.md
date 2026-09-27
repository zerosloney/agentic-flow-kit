---
状态: done
级别: L2
日期: 2026-09-27
模块: pipeline
备注: 闭环收尾批（用户拍板「继续收」）：superseded/cancelled 终态确认门入口（confirm-doc --to + check-loop 15 终态绑定扩展）+ managed sha 全链路 LF 归一（五处口径联动，papercuts 2026-09-27 立项项）。同日四项子系统审查（kb/init/看板/wiki 生成器）已在后台并行跑，发现另行立项，不入本批
确认指纹: 3ca7930f3e6928a1
---
# INTENT — closing-coverage

## 背景与问题

审查「未覆盖能力」清单收口进行到最后一层，剩两个已立项或已定性的缺口：

1. **superseded / cancelled 无入口无留痕**（清单一、2）：`nextStage()` 只有前向两跳（docs 与 incidents），放弃态只能手改 frontmatter——而 check-loop 15 的 confirmed 集合**信任** superseded/cancelled（视为已确认不拦）。即「放弃」比「完成」的机器约束还松：AI 可直接把任何文档改成 cancelled 出账，无指纹、无台账、无对质材料。
2. **managed sha CRLF 跨机漂移**（papercuts 2026-09-27 立项）：经 Edit 工具改动的模板件在开发机盘面为 CRLF，sync 照抄字节记 sha；克隆检出 LF → doctor §4 报「managed 本地改动 13 份」WARN。owned 侧已随 2a40afb 以 LF 归一修复，managed 侧涉及 renderTree/sync 三态/doctor §4/source-sync-check/sync-hosts（含 doctor §6.7 adapter bodySha）多处口径联动，当时判定改动面大、单独立项——即本批。

## 目标

- superseded/cancelled 获得与 done/closed 同标准的机器入口：confirm-doc 显式 `--to` 跳转 + 指纹 + 台账；check-loop 15 对两态配对（既有 confirmed 集合已含，补的是合法产生通道）+ 终态绑定
- managed/adapter 的 sha 记账与比对全链路 LF 归一：跨 checkout 字节稳定，克隆 doctor 0 WARN（managed 侧）

## 非目标

- 不改 done/closed/incidents 既有跳转语义与绑定口径
- 不做「放弃理由」结构化字段（理由写备注/正文，台账 quote 可承载用户原话）
- 不处理后台四项子系统审查的发现（另行立项）
- 不动 renderTree 写盘字节（渲染产物本就 LF——归一只动「读取比对/记账」侧）

## 约束

- 检查项编号不动：15 仍为原位扩展（绑定目标集从 {done,closed} 扩为四终态）
- 生效口径：superseded/cancelled 配对沿既有日期门（docs 2026-09-27 起 / incidents 2026-09-28 起——confirmed 集合早已信任，本批只加通道，存量无这两态新档零影响）；终态绑定 ts 锚 ≥2026-09-28
- sha 归一统一约定：`readFileSync(p,'utf8').replace(/\r\n/g,'\n')` 后哈希（文本件面；与 owned 2a40afb、rule-budgets「索引字节」同口径）
- 引擎件走 templates/ → sync + sync-hosts；src/ 侧直接改（包源本体）

## 影响面

- 模块：pipeline
- 数据库：无
- 前端页面：无

## 触达红线

- [x] 规则 / 契约变更（confirm-doc 状态机加 --to 分叉 + 15 终态绑定集 + sha 记账口径）→ L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → L3

## 验收标准（可测试）

- [x] confirm-doc `--to` 跳转：非终态（draft/approved/open/fixed）→ cancelled、已确认态（approved/done/fixed/closed）→ superseded 合法；draft→superseded / open→superseded / 终态→终态 拒绝；默认（无 --to）行为不变（测试断言 + CLI 场景）（证据：commit 2968441——confirm-doc.test 19/0：S4 合法表 8 条全通 + 非法组合（draft/open→superseded、done→cancelled、cancelled→cancelled、非法目标值）全拒 + resolveTransition(s,null)≡nextStage(s) 默认不变；S16 CLI --to cancelled 委托代录（stage=cancelled/prev=draft/quote）+ S17 非法组合拒跑不落台账；实现期发现并补第六处：render.mjs 渲染写盘侧同步 LF 归一（否则 fresh sha 仍 CRLF，五处闭合不成立）——复核确认六处同口径闭合）
- [x] check-loop 15 终态绑定扩展：superseded/cancelled（ts 锚后）篡改 → hard「确认内容漂移」；配对缺记录 → hard「确认未对账」（场景 ≥3）（证据：check-loop.test 65/0——场景 61-63（superseded 无台账拦 / superseded 篡改终态绑定拦 / cancelled 配对+绑定一致过）；本仓无存量 superseded/cancelled 档（grep 实证）零误伤；场景 55 夹具改用 2026-09-26 避开新配对门，焦点语义不变）
- [x] managed sha LF 归一：改后跑 sync 重记，开发机 doctor §4 0 WARN（managed 本地改动清零）；临时克隆 doctor 全绿（13 份 WARN 消失）（证据：sync「无变化 77 份」自愈重记（首跑 23 份暂跳、render 归一补齐后二次清零）+ 开发机 doctor 12 PASS / 0 WARN / 0 FAIL；独立复核临时克隆实证 managed 77 份校验通过、13 份 WARN 清零（基线对照），克隆唯一 FAIL=hooksPath 未配置属 fresh clone 必然项与本批无关）
- [x] source-sync-check / sync-hosts（含 doctor §6.7 adapter bodySha）比对 LF 归一：CRLF 盘面 vs LF 包源不误报漂移（测试场景）（证据：source-sync-check.test 21/0——S13 同内容 LF vs CRLF → 0 漂移 / S14 内容差异（甲 vs 乙）照常报漂移；sync-hosts --apply 后 34 对 0 漂移、doctor §6.7 对齐）
- [x] 既有回归零破坏：npm test 全绿、check-loop advisory 不增、gate-checklist 0 断档、workflows-check 干净（证据：verify.mjs 全绿（confirm-doc 19/0 + check-loop 65/0 + source-sync-check 21/0 + 全套 23 套件，开发机与临时克隆双侧）；advisory 扩面前后逐条一致（复核克隆对照实证）；gate-checklist 登记完整；rule-budget --all exit 0（AGENTS.md 7380/7680））
- [x] 文案同步：AGENTS.md（根+模板）确认门条款补 --to 口径；maintain/test 相关行（预算内）（证据：commit 2968441——根+templates/AGENTS.md 同句补 --to；maintain/test 无冲突表述（复核确认 test.md「修订走 superseded」与新通道相容）；复核 P2-1 三处措辞（spec/注释/用法「终态互跳」过宽）随 a526a7f 收口为「仅允许 done/closed→superseded」）

> **闭环对账**：关单在 test 阶段。intent 置 done 前逐条勾验，每条勾选项后补证据。

## 确认与复核

- 确认日期：2026-09-27
- 确认人：用户（对话内一句"可以"即确认）
- 确认范围：三件套全文
- 复核：L2 独立复核已执行（2026-09-27，independent-reviewer 子代理，基准 08cd70e → 2968441，含临时克隆对照实证）——判「通过」：0 P0 / 0 P1，P2×4（终态互跳措辞过宽→随 a526a7f 收口；init/add-gate owned 记账 raw sha 与克隆 INDEX --check 未归一→属范围外既有缺口，git blame 证实非本批引入，移交审查发现批立项）。复核实证亮点：六处 sha 归一口径闭合表逐处验证 + 克隆 managed WARN 13→0 基线对照 + 全部 98 个模板文件 UTF-8 文本面确认（归一无失真面）
