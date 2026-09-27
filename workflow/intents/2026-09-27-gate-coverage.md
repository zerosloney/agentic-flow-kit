---
状态: done
级别: L2
日期: 2026-09-27
模块: pipeline
备注: 机器门覆盖面补齐（审查「未覆盖能力」清单一、1/一、3 + 三.shell 实据）：incidents 确认门（confirm-doc + check-loop 15 扩覆盖，open→fixed / fixed→closed 两跳）+ CI 服务端兜底门四道 + check-pairing 补 core.quotepath=off。用户对话内拍板「可以动手」
确认指纹: 78ad42ad56d68c3f
---
# INTENT — gate-coverage

## 背景与问题

audit-gate-hardening 关单后用户追问「还有哪些能力没覆盖审查」，产出四层缺口清单；用户拍板按优先级动手收前两项 + 一处 shell 实据：

1. **incidents 无确认门**：confirm-doc 路径正则只认 intents/specs/plans，incident 的 open→fixed→closed 全程无机器放行、无指纹、无台账——AI 可直接改状态关掉修复单；而修复类流量占闭环近半（incidents 13 份 vs intents 28 份，含本日新增——复核 P2-3 更正立项时 11/27 旧计数），恰是确认门覆盖最薄弱路径。
2. **CI 无服务端兜底**：ci.yml 只跑 npm test（fixture 测试），不跑真实仓库的 check-loop / doctor / source-sync-check / workflows-check；pre-push 头部自认「本钩子是唯一机器门，无服务端兜底」——`--no-verify` 或未配 hooksPath 的克隆推 main，全部 hard-block 失效。
3. **check-pairing 漏 quotepath**：`check-pairing-incremental.sh` 的 `git diff --cached --name-only` 管道没加 `-c core.quotepath=off`（check-wiki-ledger 加了并写明原因）——非 ASCII 文件名被 git 引号转义后静默跳过配对门，规则 9（英文名）是 advisory 拦不住。

不在本批（后续按需立项）：superseded/cancelled 入口与留痕、kb-search / init / 看板 / wiki 生成器本体审查、并发失败模式、规模退化、secret 扫描面扩展。

## 目标

- incident 的 fixed / closed 终态跳转与 intents/specs/plans 同标准机器放行（指纹 + 台账配对；closed 加内容绑定）
- CI（push main + 全部 PR）服务端复跑四道真实仓库门，本地钩子被绕过时仍有拦截
- 配对门禁对非 ASCII 文件名不再静默跳过

## 非目标

- 不改 intents/specs/plans 既有确认语义（两跳、绑定锚、delegated 形态均不动）
- 不给 incident 的 open 态加确认门（open ≈ 新需求 draft 起草态，创建即对话确认，maintain.md 既有口径）
- 不做 open→closed 单跳（强制经 fixed 两跳，留痕更完整）
- 不给装户模板分发 CI 配置（.github/workflows 为本仓自有件，非 templates 管理面）

## 约束

- 检查项编号不增删改号：#15 只扩覆盖面（docs + incidents），gate-checklist PAIRS 不动
- 生效日 2026-09-28 起（ts 锚同口径）：存量 incidents 无台账全豁免；本单自身的 incident 关单（ts 2026-09-27）天然豁免
- 引擎件改 templates/ 后 sync + sync-hosts --apply；AGENTS.md / maintain.md / test.md 文案同步（AGENTS.md 预算 7109/7680 内）
- CI 步骤须秒级（四个脚本均无构建），不拖慢矩阵

## 影响面

- 模块：pipeline
- 数据库：无
- 前端页面：无

## 触达红线

- [x] 规则 / 契约变更（confirm-doc 状态机扩 incidents 两跳 + check-loop 15 覆盖面 + CI 门禁面）→ L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → L3

## 验收标准（可测试）

- [x] confirm-doc 支持 incidents：DOC_RE 收 `workflow/incidents/`，nextStage 增 open→fixed / fixed→closed（closed 无前向）；TTY/delegated 两形态同语义（测试：nextStage 断言 + 台账 stage 取 fixed/closed）（证据：commit 4652309 + 2a40afb——confirm-doc.test.mjs 15/0，S4 incidents 跳转表断言（open→fixed / fixed→closed / closed→null / 无单跳）+ S15 incidents 委托代录 CLI 场景（落态 fixed + 指纹行 + 台账 stage=fixed / prev=open / quote 原话）——复核 P2-4 所指验收承诺缺口已补）
- [x] check-loop 15 扩覆盖：incident 状态 fixed/closed（生效日起）无指纹/台账 → hard「确认未对账」；closed 内容绑定（ts 锚 + 保分隔符复原，同 done 口径）；open 态不受影响（测试场景 ≥4）（证据：check-loop.test.mjs 62/0——场景 57-60：closed 无台账拦 / 配对+绑定一致过 / closed 篡改拦 / open 不拦；本仓实跑 advisory 与扩面前逐行一致，存量 13 份（P2-3 更正）零新增告警；告警文案随 st 动态（复核 P2-2 已修））
- [x] CI 服务端门：ci.yml 增「机器门」步骤跑 check-loop / doctor / source-sync-check --gate / workflows-check 四道，任一非零即红（留 yaml 证据；本仓推 main 前本地全绿）（证据：commit 4652309 + 2a40afb——复核 P1-1 临时克隆实证原始三根因（hooksPath 未配 / .zcode managed 被 gitignore / owned CRLF 漂移）后逐一修复：ci.yml 补 git config core.hooksPath、.zcode 三份入库（gitignore 摘除）、owned sha LF 归一（doctor §6.6 + sync 记账）；修复后临时克隆四道门 + npm test 全部实跑绿（doctor 11 PASS / 0 FAIL），CI 可推）
- [x] check-pairing quotepath：管道加 `-c core.quotepath=off`（对齐 check-wiki-ledger 同款修法，注释引用其教训）（证据：commit 4652309——非 ASCII 文件名探针（2026-09-28-quotepatch探针.md 无 plan 暂存）实跑配对门 BLOCK exit 1（此前被引号转义静默跳过），探针已清理）
- [x] 文案同步：AGENTS.md 确认门条款 + maintain.md §确认后 + test.md 关单 bullet 补 incidents 确认门口径（预算内）（证据：commit 4652309——根 AGENTS.md + templates/AGENTS.md（装户模板）双处 + maintain/test 两命令（sync + sync-hosts 后 34 对对齐）；复核 P2-1 所指 confirm-doc 两处用户可见跳过提示同步补 incidents 口径（2a40afb）；AGENTS.md 7153B ≤ 7680 预算）
- [x] 全套回归：npm test 全绿（含新场景）、doctor 0 FAIL、check-loop 无新增 hard-block、advisory 不增、双源 0 差异（证据：verify.mjs 全绿（confirm-doc 15/0 + check-loop 62/0 + 全套 23 套件）；doctor 12 PASS / 0 WARN / 0 FAIL（开发机）+ 11 PASS / 0 FAIL（临时克隆，managed CRLF 跨机 WARN 已记 papercuts 2026-09-27 立项后续）；gate-checklist 登记完整 0 断档 / 0 未登记；rule-budget --all exit 0；source-sync-check 0 差异）

> **闭环对账**：关单在 test 阶段。intent 置 done 前逐条勾验，每条勾选项后补证据。

## 确认与复核

- 确认日期：2026-09-27
- 确认人：用户（对话内一句"可以"即确认）
- 确认范围：三件套全文
- 复核：L2 独立复核已执行（2026-09-27，independent-reviewer 子代理，基准 b8defc7 → 4652309，临时克隆实证）——初判「有条件通过」：P1-1（CI 机器门在 runner 克隆必红：hooksPath 未配 + .zcode 三份 managed 被 gitignore + owned CRLF 漂移）+ P2×4（文案陈旧 ×2 / 口径 11→13 / S15 场景缺）；全部随 2a40afb 收口（P1 三根因逐一修复 + 临时克隆复跑四道门 + npm test 全绿实证），P2-3 口径误差已在本文与 spec 更正、managed CRLF 跨机 WARN 记 papercuts 立项后续
