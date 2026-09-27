---
状态: done
级别: L2
日期: 2026-09-27
模块: pipeline
配对: ../intents/2026-09-27-confirm-gate-delegated.md
备注: 契约语义：确认事件的两形态与台账来源标记。指纹对账与 frontmatter 机制零变更——本 spec 只加「对话委托代录」这一来源形态。
确认指纹: 95848c0f51fcf81e
---

# SPEC — 确认门对话委托代录模式

对应入口：../intents/2026-09-27-confirm-gate-delegated.md

## 功能行为

### 一、CLI 两形态（`confirm-doc.mjs`）

| | TTY 模式（既有） | 委托代录模式（新增） |
|---|---|---|
| 调用 | `confirm-doc.mjs <doc...>` | `confirm-doc.mjs <doc...> --delegated "<用户对话原话>"` |
| 前置 | `stdin/stdout` 须为 TTY，否则 exit 1（AI 会话被拒） | **无 TTY 要求**（AI 会话内合法）；原话参数必填非空，空缺 exit 1 用法提示 |
| 确认语义 | 用户逐份过目全文、逐份键入「可以」 | 用户已在对话中明确放行（原话入账为证）；脚本不再逐份询问，直接落态 |
| 展示 | 打印全文 + 逐份问答 | 打印每份 `doc 状态→目标 指纹16` + 代录警示横幅 |
| 台账行 | `{ts, doc, stage, fingerprint, prev, source:"tty"}` | `{ts, doc, stage, fingerprint, prev, source:"chat-delegated", quote:"<原话>"}` |
| 其余 | 跳转合法性（draft→approved / approved→done）、指纹算法（CRLF 归一 / 剔指纹行）、applyTransition 只动两行——两形态完全同款 | 同左 |

- `--root <路径>` 两形态通用；多文档一次传入逐份处理同款。
- 委托模式的调用纪律（不可机器强制的部分）：AI 必须先在对话中取得用户明确确认才可调用——AGENTS.md 确认门条款承载；台账 quote 字段供事后对质审计。

### 二、check-loop 检查项 15（零逻辑变更，口径声明）

- 配对判据不变：frontmatter 指纹存在 + 台账存在 `doc/stage/fingerprint` 三键匹配行——**与 source 字段无关**（tty 与 chat-delegated 行同等放行）。
- 头部注释与检查段注释补「两形态」口径说明。

### 三、AGENTS.md 确认门条款（root + templates 双写）

在「确认门」条目追加委托模式一句：用户对话内明确确认后，AI 可跑 `confirm-doc.mjs <path> --delegated "<用户原话>"` 代录，台账如实记 source 与原话；TTY 模式保留。

## 数据流

用户对话「可以/选 X」→（AI 判断为明确放行）→ AI spawn `confirm-doc <doc> --delegated "<原话>"` → 逐份：读文档 → frontmatter 取状态 → nextStage 合法性 → computeFingerprint（全文 sha256，剔指纹行）→ applyTransition（状态行 + 指纹行）→ appendLedger（含 source/quote）→ 终态提交入 git。事后：check 15 按 doc/stage/fingerprint 对账；审计者按 source 区分两形态、按 quote 对质对话。

## 系统改动

| 文件 | 改动 |
|---|---|
| `templates/_agents/scripts/confirm-doc.mjs` | argv 解析加 `--delegated`；TTY 门改为「非委托时」生效；委托路径免 readline 逐份问答；台账行两形态都带 source；头部注释更新 |
| `templates/_agents/scripts/confirm-doc.test.mjs` | S8 schema 扩展；新增 S11（委托落态+台账 source/quote）、S12（委托多文档/指纹正确性并入 S11）、S13（--delegated 空原话 exit 1） |
| `templates/_agents/scripts/check-loop.mjs` | 检查 15 段注释与头部清单行补两形态口径（逻辑零改动） |
| `templates/_agents/scripts/check-loop.test.mjs` | 检查 15 配对场景的台账行加 source/quote 字段变体（锁定「额外字段不破坏配对」） |
| `templates/AGENTS.md` + 根 `AGENTS.md` | 确认门条目追加委托模式句（owned 手动双写） |

## 约束遵守映射

- 双源纪律：包源改 → `flow-kit sync`（managed 4 份）；AGENTS.md owned 双写手动 + sync 刷 owned 台账
- 台账诚实性：delegated 行禁伪装（source/quote 缺一拒跑）；TTY 行为零回归（S9/S10 守住）
- L2 配对：intent/spec/plan 同名三件；确认走两形态（本单 approved=TTY 首单、done=委托首例）

## 风险评估

| 风险 | 应对 |
|---|---|
| 确认强度降级：从「人在键盘」到「可审计声明」 | 用户知情拍板（2026-09-27 对话「2选2」）；source+quote+ts 全留痕可对质；TTY 模式共存随时回归 |
| AI 未获用户确认即代录（滥用） | 纪律条款（AGENTS.md）+ quote 原话入账供事后对质 + 台账入 git 追溯；情节属流程违规，走 incident 复盘 |
| 台账 schema 变更破坏既有消费方 | check 15 只读 doc/stage/fingerprint 三键，source/quote 为新增可选字段——向后兼容，S8 扩展断言锁住 |
| 委托模式与 TTY 模式行为漂移 | 跳转/指纹/落态共用同一套纯函数（computeFingerprint/nextStage/applyTransition），仅「询问」与「台账来源」两处分叉 |
