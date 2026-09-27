---
状态: approved
级别: L2
日期: 2026-09-27
模块: pipeline
备注: 外部审查复核后用户拍板的 6 项门禁体系加固（P1 确认门 done 内容绑定+文案改口 / P2 source-sync-check 接 pre-commit / P3 引用扫描收窄活跃态 / P4 配对门禁补 spec / P5 journal 边界声明 / P6 审计边界声明）；审查结论与逐条复核见本日对话（含「确认门审计锚惰性」「doctor §4 实证抓不到双源滞后」两条验证记录）
确认指纹: 4287b19f3edadcc3
---
# INTENT — audit-gate-hardening

## 背景与问题

用户委托对本仓 AI 工作流做三轴审查（流程正确性 / 可控性 / 脚本编排性），审查后经第二轮逐条复核修正定性，确认 6 项真实缺口并拍板动手：

1. **P1 确认门审计锚惰性**：check-loop #15 只验「frontmatter 16 位指纹 ↔ 台账 64 位前缀」配对，从不重算文档内容哈希——确认后篡改正文（如改验收标准）无法被机器发现；且 plan/design/test 三处命令文案「check-loop 15 对账拦截」口径强于实现（缺记录能拦，伪造不能防，应表述为「留痕可对质」）。
2. **P2 source-sync-check 零触发点**：doctor §4 台账 sha 比对在「包源改了、装副本没跟」时与盘面一致即 PASS（复核实证），§4.5 只抓未登记——本仓被咬过两次的故障模式（2026-09-25 wf-runtime incident、2026-09-26 managed-ledger-adopt papercut）当前无任何自动防线；唯一 detector source-sync-check 为纯手动工具，papercut 中「评估接进 pre-commit」至今未落地。
3. **P3 引用有效性扫描含终态文档 → 永久噪声**：check-loop #4 对 done/superseded 文档也扫引用，历史文档提及已改名/已废脚本（orchestrate.md、wf-run.mjs、doctor.mjs 等 3 条现存告警）产生不可消除的 advisory 噪声，真漏点会被淹没（与 gate-checklist 头部记录的「18×14 关键词匹配噪声淹没真漏点」教训同构）。
4. **P4 commit 期配对口径不全**：check-pairing-incremental.sh 只查 intent/incident→plan，漏 L2/L3 intent→spec（pre-push 侧 check-loop #1 对缺 spec 是 hard-block）——发现时机又推回 push，正是该门禁立项（papercut 2026-09-15）要消灭的摩擦类。
5. **P5 编排 journal 语义边界未声明**：编排执行层为 prose，concurrency/retry/续跑语义靠宿主 AI 自觉，journal 由执行者自己记（自报非验证态）；_TEMPLATE.md 未写明此边界。
6. **P6 审计边界未声明**：#14 恒 advisory → 2026-09-23~26 的 6 份 draft 直跳 done 文档永久不可审计（刻意豁免但无面向用户的声明）；台账 confirmations.jsonl schema 同日演进未回填（首批 2 行缺 source 字段），阅读需知。

复核中明确**不做**的：人工在场无法本地机器验证（delegated 模式已是正确妥协，不再加防）、verify.mjs --test-cmd 注入面（测试专用旗标，无实际风险）、check-loop #10 迁移启发式惰性（advisory 无害）。

## 目标

- done 文档的最终内容与确认台账可机器对账（内容绑定：篡改即 hard-block）
- 双源滞后（包源改 / 装副本滞）获得 commit 期自动拦截
- advisory 噪声面收敛（终态文档退出引用扫描），现存 3 条归档断链告警消失
- commit 期与 push 期配对口径一致（补 spec 配对）
- 三处命令文案、_TEMPLATE.md、workflow/README.md 的保证口径与实现对齐

## 非目标

- 不改 confirm-doc.mjs 的两形态协议（TTY / --delegated 记账语义不动）
- 不做编排运行时派发器（wf-run 已废，执行层维持宿主 AI 语义执行）
- 不回填 2026-09-27 前存量文档的确认台账（历史不可审计为已接受事实，只声明不追改）
- 不动 #14「恒 advisory」定性（只补声明）

## 约束

- 双源纪律：P1/P2/P3/P4 涉及的引擎件一律改 `templates/`（templates/_agents/scripts/check-loop.mjs、templates/_agents/hooks/check-pairing-incremental.sh、templates/_githooks/pre-commit、templates/_agents/commands/{plan,design,test}.md、templates/_agents/workflows/_TEMPLATE.md），随后 `node bin/flow-kit.mjs sync` 刷装副本 + 台账，`node bin/flow-kit.mjs sync-hosts --apply` 同步薄适配正文
- check-loop 检查项编号不增删不改号（gate-checklist 配对登记表按 id 消费）；#15 扩展为「配对 + 内容绑定」两段判定，登记表不破
- 新判定一律带生效日期 + 存量豁免口径（沿 #8/#14/#15 既有版本化迁移模式）
- workflow/README.md 为 owned 文件，手动改装副本即权威（无包源同步问题）
- 测试就位：check-loop.test.mjs / commit-check-trigger.test.mjs（如涉）先加场景后改实现

## 影响面

- 模块：pipeline
- 数据库：无
- 前端页面：无

## 触达红线

- [x] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2（改门禁判定契约：#15 新增内容绑定段、pre-commit 新增门禁、#4 扫描面收窄——定级 L2 依据）
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3
- [x] 常驻面体积预算：plan/design/test 三处文案改口须控制在预算内（改写不增量）；pre-commit 新增段落注意 .agents/commands/ 与 AGENTS.md 预算不受影响（githooks 不在预算表内）

## 验收标准（可测试）

- [ ] P1-绑定生效：fixture 中 done 文档被确认后篡改正文 → check-loop 报 hard-block（新测试场景：S 系列「内容绑定」≥3 条——篡改拦 / 还原通过 / 台账缺 prev 或多行取末次）
- [ ] P1-存量不误伤：本仓现存 2026-09-27 起 done 三件套（sync-hosts-adapter-backlog intent+plan、confirm-gate-delegated 三件）经内容绑定校验全通过（如个别不绑定，按实际拍板豁免并在 README 声明，不静默放行）
- [ ] P1-文案改口：templates/_agents/commands/{plan,design,test}.md 三处「对账拦截」口径改为「缺记录/配对失败拦截；伪造不可机器防，台账留痕供对质；done 后内容绑定」；sync 后装副本与 sync-hosts --apply 后薄适配正文一致（source-sync-check 0 差异 + doctor §6.7 对齐）
- [ ] P2-接线生效：仅动 templates/_agents/** 或仅动 .agents/** 的单边暂存提交被 pre-commit 拦截；成对（或都不触）提交通过（新增测试场景或手工留证）
- [ ] P2-exit 语义核实：source-sync-check 孤儿（orphan）是否计失败先核实并记录结论，接线按核实后语义（孤儿不入 fail 则在门禁文案中注明只拦缺失/漂移）
- [ ] P3-收窄生效：终态（done/superseded/cancelled/fixed/closed）文档退出 #4 引用扫描；现存 3 条归档断链告警消失；活跃文档断链仍报（新测试场景 ≥2 条）
- [ ] P4-补齐生效：暂存 L2/L3 intent 无同名 spec 的提交被 check-pairing-incremental.sh 拦截；L1 及成对提交不受影响（测试或手工留证）
- [ ] P5/P6 声明落位：_TEMPLATE.md 纪律节含 journal 自报语义边界一句；workflow/README.md 含审计边界声明（#14 恒 advisory 的历史豁免 + 台账 schema 演进说明）
- [ ] 全套回归：npm test 全绿（含新增场景）、node bin/flow-kit.mjs doctor 0 FAIL、check-loop 无新增 hard-block 且 advisory 条数不增

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。

## 确认与复核

- 确认日期：2026-09-27
- 确认人：用户（对话内一句"可以"即确认）
- 确认范围：三件套全文（intent / spec / plan）
- 复核：L2 推荐独立复核（independent-reviewer，新会话或子智能体；复核意见采纳/驳回由用户定性）——关单前于 diff 固定后执行
