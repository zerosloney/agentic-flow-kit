---
状态: approved
级别: L2
日期: 2026-09-27
模块: pipeline
备注: 机器门覆盖面补齐（审查「未覆盖能力」清单一、1/一、3 + 三.shell 实据）：incidents 确认门（confirm-doc + check-loop 15 扩覆盖，open→fixed / fixed→closed 两跳）+ CI 服务端兜底门四道 + check-pairing 补 core.quotepath=off。用户对话内拍板「可以动手」
确认指纹: 38497ee09a062582
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

- [ ] confirm-doc 支持 incidents：DOC_RE 收 `workflow/incidents/`，nextStage 增 open→fixed / fixed→closed（closed 无前向）；TTY/delegated 两形态同语义（测试：nextStage 断言 + 台账 stage 取 fixed/closed）
- [ ] check-loop 15 扩覆盖：incident 状态 fixed/closed（生效日起）无指纹/台账 → hard「确认未对账」；closed 内容绑定（ts 锚 + 保分隔符复原，同 done 口径）；open 态不受影响（测试场景 ≥4）
- [ ] CI 服务端门：ci.yml 增「机器门」步骤跑 check-loop / doctor / source-sync-check --gate / workflows-check 四道，任一非零即红（留 yaml 证据；本仓推 main 前本地全绿）
- [ ] check-pairing quotepath：管道加 `-c core.quotepath=off`（对齐 check-wiki-ledger 同款修法，注释引用其教训）
- [ ] 文案同步：AGENTS.md 确认门条款 + maintain.md §确认后 + test.md 关单 bullet 补 incidents 确认门口径（预算内）
- [ ] 全套回归：npm test 全绿（含新场景）、doctor 0 FAIL、check-loop 无新增 hard-block、advisory 不增、双源 0 差异

> **闭环对账**：关单在 test 阶段。intent 置 done 前逐条勾验，每条勾选项后补证据。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内一句"可以"即确认）
- 确认范围：三件套全文
- 复核：L2 推荐独立复核（independent-reviewer，diff 固定后执行）
