---
状态: done
级别: L1
模块: pipeline
---
# PLAN — 装户面同步一致性检查（source-sync-check.mjs）

<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 极简形态（2026-09-13 瘦身，L1 默认）：单/少文件微改动只填「改动面」+「验证方式」两节——改动面逐条列改哪个文件做什么（判据细节直接写进条目），验证一行静态门 + 按需 UI 实测；任务拆解/执行顺序仅 L1 多文件多步骤时保留 -->

对应入口：../intents/2026-09-25-source-sync-check.md
对应 spec：（L1 略）

## 改动面（L1 极简形态主节）

> 共 5 类改动，下文每条带 `文件:做什么 — 判据` 三件套。引擎双源纪律（owned 手动同步）按 2026-09-25-wf-runtime 复盘单列。

**1. source-sync-check 工具脚本（包源 + 装副本双写）**

- `templates/_agents/scripts/source-sync-check.mjs`（包源）：新增。导出 `sourceSyncCheck({ pkgRoot, target })` 纯函数 + CLI 入口。
  - 扫 `templates/_agents/` 下所有 .md / .mjs / .json / .txt 文件（**排除 `cache/` 目录**，与 sync.mjs 既有约定一致）
  - 与 `<target>/.agents/` 对应路径对比：
    - **缺失**（missing）：包源有 / 装副本无
    - **孤儿**（orphan）：包源无 / 装副本有
    - **漂移**（drift）：两者都有但 sha 不一致
  - 排除装副本独有文件：`kit.json` / `settings.json`（init 渲染产物，不属双源）
  - CLI 选项 `--diff`（默认）输出人类可读报告；`--json` 输出机器可读；`--pkg-root <path>` 与 `--target <path>`（默认 cwd）
  - 零依赖：仅 `node:fs` / `node:path` / `node:crypto`
  - 判据：跑 `node .agents/scripts/source-sync-check.mjs --diff` 输出三类差异报告（含文件路径 + sha 对比）
- `.agents/scripts/source-sync-check.mjs`（装副本）：与包源完全一致；按双源纪律手动同步

**2. 套件（包源 + 装副本双写）**

- `templates/_agents/scripts/source-sync-check.test.mjs`（包源）：仿 gate-checklist.test.mjs 模式
  - 场景 1：fixture 含 3 类差异各 1 个 → 报告 3 类齐全
  - 场景 2：排除 cache/ 目录（fixture 含 `templates/_agents/cache/foo.md`，不计入）
  - 场景 3：排除装副本独有 kit.json / settings.json
  - 场景 4：sha 一致文件不出现在漂移列表
  - 场景 5：实际仓库扫描 → ≥ 100 个包源文件被识别（baseline）
  - 场景 6：--json 输出可解析
  - 判据：跑 ≥ 6 PASS
- `.agents/scripts/source-sync-check.test.mjs`（装副本）：同步

**3. 阶段命令文件（双源纪律）**

- `templates/_agents/commands/source-sync-check.md`（包源）：新增
  - frontmatter：`description: 装户面同步一致性检查（包源 templates/_agents/ vs 装副本 .agents/ 三类差异）；stage: helper；triggers: 改了包源/改了装副本/扫一下双源漂移；approval_required: true`
  - 正文 3 节：何时跑 / 怎么跑 / 输出格式
  - 判据：grep "source-sync-check" 命中 .agents/commands/ + templates/_agents/commands/
- `.agents/commands/source-sync-check.md`（装副本）：同步

**4. build.md 流程嵌入（双源同步）**

- `.agents/commands/build.md`：在「改权威源后必跑（薄适配同步防漏）」段后追加——「改 `templates/_agents/*` 包源后必跑 `node .agents/scripts/source-sync-check.mjs --diff` 看装副本是否同步；详见 `.agents/commands/source-sync-check.md`」
- `templates/_agents/commands/build.md`：同步
- 判据：grep "source-sync-check" 命中 build.md

**5. 双源纪律 + 台账**

- `.agents/kit.json`：新增 4 份 managed（2 工具 + 2 套件）；按 `flow-kit sync` 自愈规则
- 判据：sync 后 kit.json 含 source-sync-check 4 份条目；doctor 报「managed 56 份校验通过」

## 验证方式

- 静态门：
  - 既 8 套件 180 PASS（sync-hosts / doctor / sync / init / fill-intent / fill-spec / fill-plan / gate-checklist）
  - `node .agents/scripts/source-sync-check.test.mjs`：新套件 ≥ 6 PASS
  - `node bin/flow-kit.mjs doctor`：10 PASS / 0 WARN / 0 FAIL（含新 source-sync-check 套件登记）
  - `npm test` 全部 9 套件 ≥ 186 PASS
- 端到端冒烟：
  - 跑 `node .agents/scripts/source-sync-check.mjs --diff` → 输出三类差异报告
  - 跑 `node .agents/scripts/source-sync-check.mjs --json` → 解析返回 JSON 对象
- 跨平台：CI 跑 Linux；Windows / macOS 由 README 备注口径
- L1 不要求独立复核（intent §确认与复核）

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 `draft → approved` 并回填本节（确认环节的机器可见态），`done` 只在关单出现——禁从 `draft` 直跳 `done`（2026-09-22 papercut）。
- 确认结果：approved（2026-09-25 用户对话内确认；用户对 5 段改动面 + 验证方式通过「可以」二字）；done（2026-09-25 关单随入口 intent 置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（`build.md` 两道门，逐次，不合并）
- 复核：L1 不要求独立复核