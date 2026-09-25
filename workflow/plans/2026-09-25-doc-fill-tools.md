---
状态: done
级别: L1
模块: pipeline
---
# PLAN — 文档闭环填空工具（fill-{intent,spec,plan}.mjs）

<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 极简形态（2026-09-13 瘦身，L1 默认）：单/少文件微改动只填「改动面」+「验证方式」两节——改动面逐条列改哪个文件做什么（判据细节直接写进条目），验证一行静态门 + 按需 UI 实测；任务拆解/执行顺序仅 L1 多文件多步骤时保留 -->

对应入口：../intents/2026-09-25-doc-fill-tools.md
对应 spec：（L1 略）

## 改动面（L1 极简形态主节）

> 共 5 类改动，下文每条带 `文件:做什么 — 判据` 三件套。引擎双源纪律（owned 手动同步）按 2026-09-25-wf-runtime 复盘单列。

**1. 3 个填空工具脚本（包源 + 装副本双写，共 6 份）**

- `templates/_agents/scripts/fill-intent.mjs`（包源）：新增。读 `workflow/intents/_TEMPLATE.md` + 用户回答（命令行参数或 stdin），输出 7 节正文 + frontmatter（状态 draft / 级别 L1 / 日期今日 / 模块 / 备注）的 intent 草稿到 `workflow/intents/YYYY-MM-DD-<主题>.md`。判据：跑 `node .agents/scripts/fill-intent.mjs --module pipeline --topic test --output /tmp/x.md` → 生成文件含 frontmatter 5 字段 + 7 节标题。
- `templates/_agents/scripts/fill-spec.mjs`（包源）：新增。读 `workflow/specs/_TEMPLATE.md`，输出 5 节 spec 草稿。判据：跑 `node .agents/scripts/fill-spec.mjs --output /tmp/x.md` → 5 节标题齐。
- `templates/_agents/scripts/fill-plan.mjs`（包源）：新增。读 `workflow/plans/_TEMPLATE.md`，输出 L1 极简 2 节（默认 `--level L1`）或 L2/L3 完整 4 节。判据：`--level L1` 输出 2 节、`--level L2` 输出 4 节。
- `.agents/scripts/fill-{intent,spec,plan}.mjs`（装副本 3 份）：与包源完全一致；按双源纪律手动同步装副本。
- 判据：3 工具双写；`flow-kit sync` 不报"本地已改"（除非日后用户改）。

**2. 3 个套件（包源 + 装副本双写，共 6 份）**

- `templates/_agents/scripts/fill-intent.test.mjs`（包源）：仿 sync-hosts.test.mjs 模式。断言：①必填 frontmatter 字段都在 ②状态枚举合法 ③7 节标题齐 ④空模板不崩。判据：跑 `node .agents/scripts/fill-intent.test.mjs` 全绿。
- `templates/_agents/scripts/fill-spec.test.mjs`（包源）：同上断言 5 节齐 + frontmatter 协议。
- `templates/_agents/scripts/fill-plan.test.mjs`（包源）：断言 `--level L1` 2 节、`--level L2` 4 节。
- `.agents/scripts/fill-{intent,spec,plan}.test.mjs`（装副本 3 份）：同步。

**3. 流程嵌入（plan.md / design.md）**

- `.agents/commands/plan.md`：「起草新 plan」段加一行——「起草前先跑 `node .agents/scripts/fill-plan.mjs --level L1 --output /tmp/<plan>.md` 拿结构化清单与模板句」。判据：grep "fill-plan" 命中 plan.md。
- `.agents/commands/design.md`：加同样一行 `fill-spec.mjs`。判据：grep "fill-spec" 命中 design.md。
- 装副本手动同步（按双源纪律）。
- **不修改两道确认门**：仅嵌入填空工具作为起草阶段。

**4. 双源纪律与台账**

- `.agents/kit.json`：新增 6 份 managed（3 工具 + 3 套件）；按 `flow-kit sync` 自愈规则。
- 判据：sync 后 `kit.json` 含 fill-* 6 份 managed 条目；doctor 报「managed 58 份校验通过」（原 52 + 新 6）。

**5. AGENTS.md / README 备注（轻量挂载点）**

- `AGENTS.md`「引擎双源纪律」段加一句：起草 intent/spec/plan 时用对应 fill 工具拿清单；详见 `.agents/scripts/fill-*.mjs` 与 plan.md / design.md 嵌入步骤。判据：grep "fill-" 命中 AGENTS.md。
- `README.md`：路线段补 v0.6.0 备注（可选，本次不强制）。
- 装副本手动同步。

## 验证方式

- 静态门：
  - `node src/sync-hosts.test.mjs` + `node templates/_agents/scripts/doctor.test.mjs` + `node src/sync.test.mjs` + `node src/init.test.mjs`：既 113 PASS（与 cross-host-sync 关单后一致）。
  - `node .agents/scripts/fill-intent.test.mjs` + `node .agents/scripts/fill-spec.test.mjs` + `node .agents/scripts/fill-plan.test.mjs`：3 新套件 PASS。
  - `node bin/flow-kit.mjs doctor`：10 PASS / 0 WARN / 0 FAIL（含新 fill-* 套件登记）；exit 0。
- 端到端冒烟（一次性脚本）：
  - 临时目录跑 `node .agents/scripts/fill-intent.mjs --module pipeline --topic test --output /tmp/intent.md` → 读 `/tmp/intent.md` 断言 frontmatter 5 字段 + 7 节齐
  - 跑 `node .agents/scripts/fill-spec.mjs --output /tmp/spec.md` → 5 节齐
  - 跑 `node .agents/scripts/fill-plan.mjs --level L1 --output /tmp/plan.md` → 2 节齐；`--level L2` → 4 节齐
- 跨平台：CI 跑 Linux；Windows / macOS 由 README 备注口径（与 cross-host-sync 同源）。
- L1 不要求独立复核（intent §确认与复核）。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 `draft → approved` 并回填本节（确认环节的机器可见态），`done` 只在关单出现——禁从 `draft` 直跳 `done`（2026-09-22 papercut）。
- 确认结果：approved（2026-09-25 用户对话内确认；用户对 5 段改动面 + 验证方式通过「开始」二字）；done（2026-09-25 关单随入口 intent 置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（`build.md` 两道门，逐次，不合并）
- 复核：L1 不要求独立复核