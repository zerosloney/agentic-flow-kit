---
状态: approved
级别: L2
日期: 2026-09-26
模块: pipeline
备注: 确认门机器化的实现契约。生效日 = 本机制 feat 提交次日（2026-09-27）；存量豁免不追溯。2026-09-26 用户对话内确认草稿（bootstrap——机制落地前按对话确认）。
---

# SPEC — 确认门机器化

## 功能行为

### F1 confirm-doc.mjs（唯一确认入口）
- **TTY 门**：`process.stdin.isTTY !== true` → stderr「确认门须由用户在终端亲手运行（node .agents/scripts/confirm-doc.mjs <文档>...）——AI 会话内不可代确认」exit 1。此为设计核心：AI 的 spawnSync 无 TTY，确认事件无法由 AI 产生。
- **多文档逐份处理**：`node .agents/scripts/confirm-doc.mjs <path> [<path>...]`（限 workflow/{intents,specs,plans} 下文档）。每份依次：清屏后打印头部（路径 / 当前状态 → 目标状态 / 指纹前 16 位）+ 文档全文 → 提示「键入"可以"确认本份，其他任意输入跳过：」→ 仅精确匹配「可以」才落状态；跳过的进入下一份。
- **合法跳转仅两条**：draft→approved（起草确认）、approved→done（关单确认）。当前状态为其他值（含无 frontmatter / 无状态键）→ 报错跳过该份，不写任何内容。
- **落盘三件事**（仅「可以」后）：① frontmatter `状态:` 行改目标值；② `确认指纹: <16hex>` 行新增或覆盖（同一文档两次确认各记各的，frontmatter 始终存最近一次跳转的指纹）；③ 台账追加一行。
- **指纹算法**：文件内容 `\r\n`→`\n` 归一 → 剔除匹配 `/^确认指纹:/m` 的行（避免自引用）→ sha256 hex。frontmatter 存前 16 位，台账存 64 位。
- **frontmatter 改写规则**：只动 `状态:` 行的值与 `确认指纹:` 行，其余字节原样保留；无 frontmatter → 报错跳过。
- **路径解析**：文档路径与台账（`.agents/confirmations.jsonl`）相对 `process.cwd()`；`--root <dir>` 可注入（测试用）。

### F2 台账 .agents/confirmations.jsonl
- 入 git（.gitignore 不覆盖）、追加式（只 append 不重写）；每行 `{ts(ISO), doc(仓库相对路径), stage(approved|done), fingerprint(64hex), prev}`。
- 回答两问：确认事件发生过没有；确认的是哪一版内容（配合 git history 可 diff 确认后改动）。

### F3 check-loop 检查项 15「确认指纹对账」
- **对象**：intents/specs/plans（superseded/cancelled 与 incidents 不在 v1 范围）状态 ∈ {approved, done}。
- **生效日**：文件名前 10 位日期（回退 frontmatter 日期/发现）≥ 2026-09-27 才受管；之前一律豁免（存量不追溯）。
- **判定**：frontmatter `确认指纹` 非空 **且** 台账存在行满足 doc 匹配 + stage == 当前状态 + fingerprint 前 16 位 == frontmatter 值。台账文件不存在视为空台账。
- **违例**：hard-block，消息 `- [确认未对账] <base> 状态 <st> 无用户确认记录——AI 不得代确认，用户在终端跑 node .agents/scripts/confirm-doc.mjs <path> 后重试`（与配对断裂同级）。
- **头部清单**：check-loop.mjs 头部 `// N.` 清单加第 15 条；gate-checklist PAIRS 登记 `{doctor:'7', cl:'15', note:'经 §7 整体运行覆盖'}`。

### F4 口径接线
- build.md / design.md / plan.md / test.md：「确认后 → 状态 draft → approved/done」的表述统一改为「停下贴全文 → 用户跑 confirm-doc.mjs（唯一入口，AI 不得直接改状态做确认跳转）」。
- AGENTS.md「门禁与提交」节加一句（≤120B，须过 7680B rule-budget 门；超限则精简或下沉命令文档）。
- doctor §2 布局清单 + `.agents/scripts/confirm-doc.mjs`。

## 数据流

用户终端（TTY）→ confirm-doc.mjs（全文过目 + 键入「可以」）→ 文档（状态 + 指纹）+ 台账（追加行）→ git commit（台账随代码入库）→ pre-push check-loop 检查 15 逐份对账 → 放行/拦截。
AI 侧职责收窄为：起草（draft）→ 贴全文 + 给出确认命令 → 停；关单前勾验完 → 同样停。AI spawnSync 无 TTY，F1 的门对 AI 恒关。

## 系统改动

- 新增 `templates/_agents/scripts/confirm-doc.mjs`（纯函数导出：computeFingerprint / nextStage / applyTransition / appendLedger；CLI 薄壳）+ `confirm-doc.test.mjs`（纯函数逐项断言 + CLI 非 TTY spawn 拒绝断言）。
- `check-loop.mjs`：检查 15 实现 + 头部清单 +15；`check-loop.test.mjs`：+4 场景（无指纹拦 / 配对齐过 / 指纹不符拦 / 生效日前豁免），mkfix 增台账辅助。
- `gate-checklist.mjs`：PAIRS +1（登记表自举首例）。
- `.agents/commands/{build,design,plan,test}.md` + `templates/AGENTS.md`（口径句）+ `AGENTS.md`（装副本，owned 手动同步）。
- `src/doctor.mjs`：§2 布局 +1。
- 装副本：sync 自动（managed）+ AGENTS.md 手动（owned）。

## 约束遵守映射

- 零依赖（node:fs/path/crypto/readline/url/child_process）：是。
- 判定分级：检查 15 = hard-block（唯一新增 hard 类）。
- 双源纪律 / source-sync-check 0 差异：是。
- 预算中性偏正：AGENTS.md +≤120B 须实测过门；命令文档 4 处为等长口径替换。
- 兼容：frontmatter 受限子集新增 `确认指纹` 键（仅检查 15 消费）；check 8/12/14 既有判定零变化；`确认指纹` 行不参与检查 2 占位符判定（正则不含该词，天然无冲突）。

## 风险评估

- **AGENTS.md 预算溢出** → rule-budget --staged 实测；超限缩句或下沉（plan 任务拆解列分支）。
- **用户侧摩擦**（每确认跳一条命令）→ 拦截消息内嵌完整命令行，照抄即跑；多文档一次传参逐份过目。
- **TTY 正路径无自动化测试**（无伪终端）→ 纯函数全覆盖 + 非 TTY 拒绝路径断言；正路径留 bootstrap 后首单人工实跑验证（验收项）。
- **台账被 git autocrlf 转 CRLF** → 解析按行 split(/\r?\n/)（既有惯例，rule-budgets.txt 同约定）。
- **蓄意伪造**（AI 手写台账行）→ 显性越线、git diff 可见，与 --no-verify 同级；不做密码学防（非目标）。
