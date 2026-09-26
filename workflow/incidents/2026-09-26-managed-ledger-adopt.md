---
状态: open
级别: L2
发现: 2026-09-26
模块: pipeline
配对: ../specs/2026-09-26-managed-ledger-adopt.md /../plans/2026-09-26-managed-ledger-adopt.md
备注: 本单为「装户面 managed 文件未入台账」缺陷：15 份 managed 类文件在盘上存在但从未登记进 `.agents/kit.json`，sync 走「已存在未入台账」分支跳过，故包源改动不会同步到装副本。incident 即 intent 等价入口（AGENTS.md 修复类口径），L2 配对 spec/plan 收口。契约语义变更（sync 新增收养分支）→ L2。
---

# INCIDENT — 2026-09-26 managed 文件未入台账（升级通道静默断裂）

## 时间线
- 2026-09-26 拉取 v0.5.0 后跑 doctor，报 `managed 本地改动 10 份`；逐份核对发现磁盘内容 == 新版渲染产物，属 `kit.json` 台账自指滞后（`8bbd173` 提交模板改动时台账快照未跟），跑 `flow-kit sync` 走既有「台账自愈」分支清零（`disk sha == fresh sha` → 仅刷台账）
- 同次核对暴露第二条：另有 15 份 managed 类文件在盘上存在、但**根本不在台账**（`git log -S <文件名> -- .agents/kit.json` 返回空 → 从未登记）
- 逐份 sha 核对：15/15 磁盘内容 == 渲染后 sha（非包源原文），即内容当前一致、仅登记缺失
- 临时克隆隔离实验：改包源 `templates/_agents/scripts/source-sync-check.mjs` 加标记 → 跑 `flow-kit sync` → 装副本 sha 纹丝不动（`C50F0C2A` 前后不变），sync 报「已存在未入台账」跳过 + 「无变化 57 份」
- 用户对话内拍板「改B+A」（sync 收养分支 + doctor 台账覆盖率检查），立本 incident 当入口

## 影响面
- 15 份受影响文件（全部为活跃迭代核心件）：
  - 命令文档：`.agents/commands/gate-checklist.md`、`.agents/commands/source-sync-check.md`、`.agents/commands/sync-hosts.md`
  - 引擎脚本：`.agents/scripts/fill-intent.mjs` / `fill-plan.mjs` / `fill-spec.mjs` 及各自 `.test.mjs`、`.agents/scripts/gate-checklist.mjs` 及其 `.test.mjs`、`.agents/scripts/source-sync-check.mjs` 及其 `.test.mjs`
  - 编排脚本：`.agents/workflows/pipeline-closing.md`、`.agents/workflows/source-sync-repair.md`
- 直接后果：包源 `templates/_agents/` 对应文件改动后，装副本 `.agents/` 与宿主目录**不会跟上**（实证见时间线）；且 sync 每次只报「已存在未入台账」而不修复，无自动收敛通道
- 装机面：任何装户若以「手动双写」方式补过 managed 类文件（非经 init/sync 登记），均处于同一盲区
- 当前无内容级损害（15/15 内容与包源一致），但一旦有人改动其中任一份，装副本将静默落后且无任何门禁报出

## 根因
`src/sync.mjs` 对「台账外 + 盘上已存在」的文件只做 `skipped.push()` 保守跳过（`fs.existsSync(disk) && !force` 早退），**不区分「本地真改动」与「内容恰好等于新版」**——后者本可像台账内文件那样走「改动恰好等于新版」分支被收养登记，却因不在台账而永远进不了三方比对。
深层原因：`kit.json` 生成于 2026-09-23（init 时点），而 15 份是 09-25 后经**手动双写**进仓（同提交内 `.agents/` 与 `templates/_agents/` 成对出现：`f4d7d25` / `52a5e6f` / `3cc10d6` / `160535a`），绕过了 init/sync 的登记逻辑；而系统对「盘上有 managed 类文件但台账无」这一状态**无任何检测**——`doctor` 只遍历台账条目做双向比对，从不反向问「盘上还有谁没登记」。

## 为什么之前没拦住
- **门禁**：`src/doctor.mjs` §4 仅遍历 `kit.managed` 条目逐一校验 sha（覆盖与缺失），**无「台账覆盖率」检查**（盘上 managed 类文件 vs 台账条目差集）；`pre-commit` 调 check-pairing/create-wiki-ledger/rule-budget/commit-check，不调 doctor 也不调 source-sync-check
- **测试**：`src/sync.test.mjs` fixture 的 v1 安装态把每个盘上文件都写了台账条目，**未构造「盘上有文件但台账缺条目」场景**——收养分支的行为无任何用例锁定
- **规范**：`.agents/commands/build.md:81` 已要求「改 `templates/_agents/*` 包源后 → 跑 `node .agents/scripts/source-sync-check.mjs --diff` 看装副本是否同步」，但该工具**是手动步骤、未接门禁**，且它比的是实际内容——09-26 当天跑全绿（64/64 无差异），因为内容确实一致，**盲区在登记侧不在内容侧**，工具语义天然看不见
- **检测工具定位缺口**：`source-sync-check.mjs` 头部自述「sync.mjs 不扫、doctor.mjs §6.6 不扫」而它只补「包源有装副本无 / 孤儿 / 漂移」三类，**「两者都有内容相同但装副本未登记」不在其三类差异内**

## 复盘三件套（缺一不可）

1. 结构性修复（已实装）
   - 修复动作 1：`src/sync.mjs` 台账外文件分支新增**收养判定**——`diskSha === freshFile.sha` 时登记入台账 + 报告新列「收养登记」；内容不等仍走「已存在未入台账」跳过且不登记；`--force` 下保持原有覆盖并归入「新增安装」列
   - 修复动作 2：`src/doctor.mjs` 新增 §4.5「台账覆盖率」检查 + 导出 `checkLedgerCoverage(target, pkgRoot)`；本仓跑出**缺口 15 份（与目标集逐一对应，无多余噪音）**；首次 WARN（存量装户版本偏斜期不误挂）
   - 修复动作 3：`src/render.mjs` 新增导出 `listTree(srcRoot)`（与 `renderTree` 同 relOf 映射；实测 rel 集合 98/98 一致）
   - 修复动作 4：跑 `node bin/flow-kit.mjs sync` → **收养登记 15 份**，台账 62 → 77，doctor 报「✅ 台账覆盖率完整（77 份 managed 全在册）」→ **12 PASS / 0 WARN / 0 FAIL**
   - 修复动作 5：`templates/_agents/commands/build.md` 双源纪律段补一行（禁手动双写绕过台账）+ 同步装副本；`workflow/papercuts.md` 对应行标注已修；`workflow/regression-checklist.md` 追一行
   - 影响环境：dev（包源 CLI 源码 `src/`，无装副本；装副本 `.agents/` 仅经 sync 收编台账，15 份源文件字节未变）
   - 是否需要新 intent：否 → 理由：incident 即 intent 等价入口（AGENTS.md「L1 以上立 incident，修复中即 intent 等价入口，L2/L3 与 spec/plan 同名配对」）；本单根因含门禁缺位，其结构性落点即动作 1+2 新增的收养分支与覆盖率检查，无需另立 intent 重复承载

2. 防复发验证（已落到自动化用例）
   - 自动化用例 1：`src/sync.test.mjs` 场景 S14（收养三态）——① 内容==新版 → 收养登记 + 入台账 + 不改盘面；② 内容!=新版 → 不收养 / 本地改动幸存 / 台账不登记 / 报「已存在未入台账」；③ 盘上无 → 新增安装（既有行为不回归）。**实跑 PASS 56 / FAIL 0**（含 S1-S13 全部存量场景无回归）
   - 自动化用例 2：`templates/_agents/scripts/doctor.test.mjs` 场景 15-18 —— ① 差集含未登记项且 owned 类不入差集；② 登记齐全 → 差集空；③ 无包源模板 → skipped；④ 无 kit.json → skipped。**实跑 PASS 21 / FAIL 0**
   - 回归清单：`workflow/regression-checklist.md`「防复发验证」节已追加 2026-09-26-managed-ledger-adopt 一行
   - 额外安全边界实证（临时克隆隔离实验）：把台账外文件改成「本地独有内容」后跑 sync → sha 保持 `80095DB7CA01` 不变、台账仍不登记、报「已存在未入台账」→ **真本地改动不会被误收养**

3. 规范条目（已落到可追溯位置）
   - 落点 1：`src/sync.mjs` 文件头注释补「台账外文件收养」语义（判据同源与「本地真改动仍保守跳过」边界）
   - 落点 2：`src/doctor.mjs` §4.5 节注释写明检查目的、补的是「盘上有台账无」一侧、与 §4 的互补关系、首次 WARN 理由
   - 落点 3：`templates/_agents/commands/build.md`（双源，装副本同件）双源纪律段补「禁手动双写绕过台账」（见本 incident）
   - 落点 4：`templates/_agents/scripts/gate-checklist.mjs` PAIRS 登记表补 `{ doctor: '4.5', cl: null }` 声明独有——**该登记由门禁自身抓出**（新增 §4.5 后 `npm test` 报 S10 未登记），已对账至 0 断档 / 0 未登记
   - 引用：本次修复 commit SHA（修复完成后回填）+ `workflow/incidents/2026-09-26-managed-ledger-adopt.md`（本单）
