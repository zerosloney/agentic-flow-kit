---
状态: done
级别: L1
模块: pipeline
---
# PLAN — 三处口径一致性检查（gate-checklist.mjs）

<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 极简形态（2026-09-13 瘦身，L1 默认）：单/少文件微改动只填「改动面」+「验证方式」两节——改动面逐条列改哪个文件做什么（判据细节直接写进条目），验证一行静态门 + 按需 UI 实测；任务拆解/执行顺序仅 L1 多文件多步骤时保留 -->

对应入口：../intents/2026-09-25-gate-checklist.md
对应 spec：（L1 略）

## 改动面（L1 极简形态主节）

> 共 5 类改动，下文每条带 `文件:做什么 — 判据` 三件套。引擎双源纪律（owned 手动同步）按 2026-09-25-wf-runtime 复盘单列。

**1. gate-checklist 工具脚本（包源 + 装副本双写）**

- `templates/_agents/scripts/gate-checklist.mjs`（包源）：新增。导出 `gateChecklist({ doctorSrc, checkLoopSrc })` 纯函数 + CLI 入口。
  - 扫 `src/doctor.mjs` 文本：grep `add\('(PASS|WARN|FAIL)'` 调用，按上下文提取 § 检查项标题（如「目录布局」「owned 漂移 N 份」「跨宿主薄适配」）
  - 扫 `.agents/scripts/check-loop.sh` 文本：grep `^\s*#\s*\d+\.\s` 注释行 + `[hard-block]` / `[warning]` 标记
  - 输出对照表：doctor §项 × check-loop §项；匹配 = 关键字重合（如"配对"、"INDEX"、"占位符"）；不匹配 = 缺点
  - CLI 选项 `--diff`（默认）输出人类可读报告；`--json` 输出机器可读
  - 零依赖：仅 `node:fs` / `node:path`
  - 判据：跑 `node .agents/scripts/gate-checklist.mjs --diff` 输出含 doctor 与 check-loop 两栏对照表
- `.agents/scripts/gate-checklist.mjs`（装副本）：与包源完全一致；按双源纪律手动同步

**2. 套件（包源 + 装副本双写）**

- `templates/_agents/scripts/gate-checklist.test.mjs`（包源）：仿 sync-hosts.test.mjs 模式
  - 场景 1：doctor 至少 7 项检查被识别（PASS/WARN/FAIL 加 add 调用）
  - 场景 2：check-loop 至少 11 项检查被识别（#1-#13 注释行）
  - 场景 3：对照表含匹配条目（"配对" / "INDEX 漂移" / "占位符残留" 等关键字）
  - 场景 4：缺 doctor 仅有的项（如「跨宿主薄适配」）报"check-loop 缺对应"
  - 场景 5：缺 check-loop 仅有的项（如「intent 验收标准对账」）报"doctor 缺对应"
  - 场景 6：--json 输出可解析且含 doctorCount / checkLoopCount / matched / gaps 字段
  - 判据：跑 `node .agents/scripts/gate-checklist.test.mjs` 全绿（≥6 PASS）
- `.agents/scripts/gate-checklist.test.mjs`（装副本）：同步

**3. 阶段命令文件（双源纪律）**

- `templates/_agents/commands/gate-checklist.md`（包源）：新增
  - frontmatter：`description: 三处口径一致性检查（doctor ↔ check-loop 对照表）；stage: helper；triggers: 改 doctor 后/改 check-loop 后/三处口径对账；approval_required: true`
  - 正文 3 节：何时跑 / 怎么跑 / 输出格式
  - 判据：grep "gate-checklist" 命中 .agents/commands/ + templates/_agents/commands/
- `.agents/commands/gate-checklist.md`（装副本）：同步

**4. build.md 流程嵌入（包源 + 装副本同步）**

- `.agents/commands/build.md`：末尾加一行——「改 `src/doctor.mjs` 或 `.agents/scripts/check-loop.sh` 后必跑 `node .agents/scripts/gate-checklist.mjs --diff` 看两处口径是否一致；详见 `.agents/commands/gate-checklist.md`」
- `templates/_agents/commands/build.md`：同步
- 判据：grep "gate-checklist" 命中 build.md

**5. 双源纪律 + 台账**

- `.agents/kit.json`：新增 4 份 managed（2 工具 + 2 套件）；按 `flow-kit sync` 自愈规则
- 判据：sync 后 `kit.json` 含 gate-checklist 4 份条目；doctor 报「managed 56 份校验通过」（原 52 + 新 4）

## 验证方式

- 静态门：
  - `node src/sync-hosts.test.mjs` + `node templates/_agents/scripts/doctor.test.mjs` + `node src/sync.test.mjs` + `node src/init.test.mjs`：既 113 PASS（与 cross-host-sync 关单后一致）
  - `node .agents/scripts/fill-{intent,spec,plan}.test.mjs`：3 套件 PASS（与 doc-fill-tools 关单后一致）
  - `node .agents/scripts/gate-checklist.test.mjs`：新套件 ≥ 6 PASS
  - `node bin/flow-kit.mjs doctor`：10 PASS / 0 WARN / 0 FAIL（含新 gate-checklist 套件登记）
  - `npm test` 全部 8 套件 ≥ 175 PASS
- 端到端冒烟：
  - 跑 `node .agents/scripts/gate-checklist.mjs --diff` → 输出对照表 + 缺点告警（缺对应项）
  - 跑 `node .agents/scripts/gate-checklist.mjs --json` → 解析返回 JSON 对象
- 跨平台：CI 跑 Linux；Windows / macOS 由 README 备注口径
- L1 不要求独立复核（intent §确认与复核）

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 `draft → approved` 并回填本节（确认环节的机器可见态），`done` 只在关单出现——禁从 `draft` 直跳 `done`（2026-09-22 papercut）。
- 确认结果：approved（2026-09-25 用户对话内确认；用户对 5 段改动面 + 验证方式通过「按这个走」二字）；done（2026-09-25 关单随入口 intent 置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（`build.md` 两道门，逐次，不合并）
- 复核：L1 不要求独立复核