---
状态: approved
级别: L2
模块: pipeline
确认指纹: 0cede3b7fed15187
---
# PLAN — audit-gate-hardening

对应入口：../intents/2026-09-27-audit-gate-hardening.md
对应 spec：../specs/2026-09-27-audit-gate-hardening.md

## 改动面

- `templates/_agents/scripts/check-loop.mjs`：#15 增内容绑定段（done 文档按台账 prev 复原跳转前文本重算 sha256 比对，缺 prev 降级 warning）；#4 增活跃态过滤（终态文档退出引用扫描）；头注释检查项口径同步，编号不动
- `templates/_agents/scripts/check-loop.test.mjs`：+5 场景（绑定：篡改拦/复原过/无 prev 降级；收窄：终态不报/活跃报）
- `templates/_agents/commands/{plan,design,test}.md`：确认门文案三段式改口（缺记录拦截 / 伪造留痕可对质 / done 内容绑定）
- `templates/_githooks/pre-commit`：新增「双源一致性（增量）」门禁（暂存触及 templates/_agents/** 或 .agents/** → 跑 source-sync-check --diff，非零阻断）
- `templates/_agents/scripts/source-sync-check.mjs`（按核实结论）：orphan/装户运行态（confirmations.jsonl 等）白名单补齐 + 测试同步
- `templates/_agents/hooks/check-pairing-incremental.sh`：补 L2/L3 intent→spec 配对档（与 check-loop #1 同口径）
- `templates/_agents/workflows/_TEMPLATE.md`：纪律节补 journal 自报语义边界一句
- `workflow/README.md`：补「审计边界」小节（owned 手改）
- 装副本与薄适配：`node bin/flow-kit.mjs sync` + `node bin/flow-kit.mjs sync-hosts --apply` 下发，不手改

## 任务拆解

1. **T1 P1 确认门内容绑定 + 文案改口**
   - 判据：check-loop.test.mjs 新增 3 场景全绿（篡改 fixture done 文档正文 → hard-block；未篡改 → 过；台账行缺 prev → warning 降级）；对现存 2026-09-27 done 三件套实跑绑定校验并记录结果（全过或逐份拍板豁免）；三处命令文案改口完成
   - 风险：中（存量误伤——先实跑后定豁免，不静默放行）
2. **T2 P2 双源门禁接线**
   - 判据：先读 source-sync-check.mjs 全文核实 orphan 是否计 fail（记录结论进 spec/README）；白名单按结论补齐（.mjs + 测试双处）；手工构造单边暂存验证被拦、成对提交通过，留终端输出为证
   - 风险：中（误拦两段式提交习惯——文案给修复命令兜底）
3. **T3 P3 引用扫描收窄**
   - 判据：新增 2 场景全绿（终态文档断链不报 / 活跃文档断链仍报）；本仓 check-loop 实跑，3 条归档断链告警消失，advisory 总数 10 → ≤7
   - 风险：低
4. **T4 P4 配对门禁补 spec**
   - 判据：手工构造暂存 L2 intent 无 spec → 被拦；有 spec（或 L1）→ 过；留终端输出为证
   - 风险：低
5. **T5 P5/P6 边界声明**
   - 判据：_TEMPLATE.md 纪律节含边界句；workflow/README.md 含「审计边界」小节（含台账 schema 演进与生效日自报边界）
   - 风险：低
6. **T6 双源同步 + 全套回归**
   - 判据：`flow-kit sync`（装副本 + kit.json 刷新，owned 不动）→ `sync-hosts --apply`（commands 正文对齐）→ `source-sync-check --diff` 0 差异 → npm test 全绿 → doctor 0 FAIL → check-loop 无新增 hard-block 且 advisory 不增
   - 风险：低

## 执行顺序

T1 → T2 → T3 → T4 → T5 → T6（T1-T5 相互独立可并行；T6 收口依赖全部完成）。T2 内部：核实 exit 语义 → 白名单 → 接线 → 手工验证。

## 验证方式

- 静态门：npm test（全套 22 套件 + 新增场景）；node bin/flow-kit.mjs doctor（0 FAIL）；node .agents/scripts/check-loop.mjs（无 hard-block，advisory ≤7）
- L2 追加：门禁契约对账——gate-checklist --diff 登记表 0 断档 0 未登记（检查项编号未动）；单边/成对提交行为差异实测留证（T2/T4）；三处文案与薄适配正文一致性（source-sync-check + doctor §6.7）
- 回滚预案：单 feat 提交，git revert 即回；无 schema/数据迁移

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现——禁从 draft 直跳 done。
- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 推荐独立复核（independent-reviewer；采纳/驳回由用户定性）
