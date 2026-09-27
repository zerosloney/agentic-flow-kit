---
状态: done
级别: L2
日期: 2026-09-27
模块: pipeline
备注: 动因与拍板：2026-09-27 确认门 TTY 形态首日实战（sync-hosts backlog 单），用户连续要求 AI 代跑被门拦（含两次实跑演示拒绝），随后问「为啥要终端跑」「合理吗」，在「终端跑一次 vs 改设计」两选项中明确拍板「2选2」——选改设计（加对话委托确认模式）。规则面变更就高 L2，三件套配对。
确认指纹: dda141abdba12144
---

# INTENT — 确认门对话委托代录模式（--delegated：用户对话确认，AI 代录，台账如实记来源）

## 背景与问题
- 2026-09-26 确认门机器化（8bbd173）以「用户终端 TTY 亲手键入可以」为唯一确认形态，换来「人在键盘」的不可伪造性；2026-09-27 首日实战即暴露摩擦：单人 + AI 协作形态下每单至少 2 次确认（approved + done）× L2 三件套 ≈ 6 次切终端粘贴，用户 5 次要求 AI 代跑（被我以「台账不可说谎」拒绝 4 次）
- 摩擦的实质：用户要的是「我拍板」这个决策事实被记录，而不是「我的手指碰过键盘」这个物理事实——两者在 TTY-only 形态下被捆绑了
- 原则不变：**被确认方（AI）不能自证**。要降摩擦，正路不是绕门，而是给「用户对话内明确确认」一个如实记账的机器形态

## 目标
- `confirm-doc.mjs` 增加 `--delegated "<用户对话原话>"` 委托代录模式：无 TTY 环境可跑（AI 会话内合法执行），确认语义 = 用户已在对话中明确放行，AI 代为落态记账
- 台账诚实性：delegated 行如实记 `source: "chat-delegated"` + `quote: <用户原话>`；TTY 行补记 `source: "tty"`——两种来源机器可区分，永不混淆
- check 15 对账语义零变更（指纹 + 台账按 doc/stage/fingerprint 配对，与 source 无关）；frontmatter 机制零变更（状态行 + 指纹行同款）
- TTY 模式原样保留（想用随时用，两种形态共存）

## 非目标
- 不削弱指纹对账（内容绑定不变——确认后偷改仍被拦）
- 不删不改 TTY 模式的任何行为
- 不做「AI 自动检测用户语气即代录」——调用前置条件是用户对话内明确确认，这是纪律条款（AGENTS.md），不做成机器强制

## 约束
- 台账行禁止伪装：delegated 行必须带 source 与 quote，缺一 exit 1；`--delegated` 缺原话参数 = 用法错误拒绝执行
- 双源纪律：templates/_agents/scripts/confirm-doc{,.test}.mjs 包源改 → sync 同步装副本
- AGENTS.md 为 owned：root + templates 两份手动双写
- 本单自身闭环吃狗粮：approved = 用户 TTY 一次（新规则首单，门还在）；done = 对话委托模式（新规则首个正式用例）

## 影响面
- `templates/_agents/scripts/confirm-doc.mjs` + `.test.mjs`（装副本经 sync 同步）
- `templates/AGENTS.md` + 仓库根 `AGENTS.md` 确认门段（owned 双写）
- `templates/_agents/scripts/check-loop.mjs` 检查 15 注释口径（逻辑零改动）+ `.test.mjs` 补一 delegated 行配对场景
- `.agents/confirmations.jsonl` 行 schema 增可选字段（向后兼容：check 15 只读 doc/stage/fingerprint）

## 触达红线
- 确认门规则面变更（L2 就高）；不改数据与运行时结构（无 schema/迁移/DI）；不动 6 阶段路由

## 验收标准（可测试）
- [x] `--delegated "<原话>"` 非 TTY 环境（spawnSync 管道 stdin）可跑：draft→approved 落态 + frontmatter 指纹行 + 台账行含 source=chat-delegated 与 quote 原话（证据：confirm-doc.test.mjs 新增 S11/S12 场景）
- [x] `--delegated` 缺原话（空值）→ exit 1 用法提示，不落任何文件（证据：S13 场景）
- [x] TTY 模式行为与既有完全一致（非 TTY 无 --delegated 照拒，S9/S10 不回归），台账行补 source: tty（证据：既有 10 场景全绿 + S8 schema 扩展）
- [x] check 15 对 delegated 行照常配对放行、缺指纹照拦（证据：check-loop.test.mjs 检查 15 场景扩展一行 delegated 台账）
- [x] AGENTS.md root + templates 确认门段双写更新；npm test 全部套件全绿 + doctor 12 PASS + check-loop exit 0（证据：实跑输出）
- [x] 本单三件套确认全程用户终端 TTY 亲跑双跳（00:48 approved → 00:50 done，台账 source=tty）——原拟 done 走委托模式吃狗粮，实操中用户连跑两跳，委托模式正式首用顺延至同日 sync-hosts backlog 关单（证据：.agents/confirmations.jsonl 6 行 tty 记录 + backlog 关单的 chat-delegated 行）
