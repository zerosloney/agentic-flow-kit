---
状态: done
级别: L2
日期: 2026-09-26
模块: pipeline
备注: check-loop sh→node 迁移的实现契约。判定语义以 sh 版（含 2026-09-25 enum-single-source 后状态）为基线冻结，fixture 套件全量移植为对齐证明。
---

# SPEC — check-loop sh→node 迁移

## 功能行为

- **判定冻结**：14 检查项的分级（hard-block / warning）、触发条件、消息文案（含 fixture 断言关键词）与 sh 版逐条一致；banner 文案不变（hard：`闭环骨架断档（check-loop.sh）— HARD-BLOCK:`，warn：`check-loop.sh WARN（advisory,不阻断）:`）——「check-loop.sh」字样为稳定输出契约保留（doctor 侧以 WARN 行计数、pre-push 以 exit 码判定）。
- **运行模式**：`CHECK_LOOP_ROOT` 注入 fixture 根（全扫不过滤、非 git 场景 10/14 跳过）；缺省 = git 仓库根（`git rev-parse --show-toplevel`，不在 git 仓库 → stderr 提示 exit 0 跳过）；已提交过滤 = `git ls-tree -r --name-only HEAD -- workflow` 失败退化为全扫。
- **枚举单源**：经 workflow-enums.mjs 的 `loadEnums(<root>/.agents/workflow-enums.txt)`——缺文件/缺键 fail-loud exit 1（fixture 契约保持）；node 侧 CRLF 天然容忍（parseEnums split(/\r?\n/)）。
- **frontmatter 解析**（fm_get 语义）：首行 `---`（尾随空白容忍）进入，至下一 `---` 闭合；键在行首（`key:`）；首个命中；值两侧去空白；无 frontmatter/键缺失 → 空串。
- **检查 13（常驻面预算）**：经 `sh .agents/scripts/rule-budget.sh --all` 调用——无 sh 环境（ENOENT）静默跳过（advisory 降级；pre-commit 侧在 git 钩子 sh 环境照常硬拦）。
- **检查 10/14**：git 交互经 execSync（shell 解析，Windows 兼容，maxBuffer 32MB）；非 git 仓库整体跳过（沿用）。

## 数据流

- 调用方：`.githooks/pre-push`（sh shim → node）、`verify.mjs` 第 2 步（直连 node）、`doctor` §7（直连 node）、CI/人工（shim 或直连均可）。
- gate-checklist.mjs：解析面从 check-loop.sh `# N.` 注释改为 check-loop.mjs `// N.` 头部清单（编号/标题/severity 沿用；fallback 读 .sh——旧装户 sync 前不误报）。
- 上游输入：workflow/ 文档 + .agents/ 结构 + git 历史 + 枚举/模块单源文件；输出：stderr（hard/warn）+ exit 码。

## 系统改动

- 新增 `templates/_agents/scripts/check-loop.mjs`（14 检查项 + 头部 `// N.` 清单）与 `check-loop.test.mjs`（37+ 场景）。
- `templates/_agents/scripts/check-loop.sh` → 4 行 shim（exec node 同目录 check-loop.mjs "$@"；头部注释指向 .mjs）。删除旧 sh 测试 `check-loop.test.sh`（被 .test.mjs 取代，出双源）。
- `src/run-tests.mjs`：撤 bash 套件特判块（check-loop.test.mjs 由既有 node 套件 glob 自动发现）。
- `src/doctor.mjs`：§2 布局 + check-loop.mjs；§7 直连 node（撤 sh 探测，注释更新留 incident 史注）。
- `templates/_agents/scripts/verify.mjs`：第 2 步直连 node；撤「环境无 sh」fail-closed 分支（node 即运行时）。
- `templates/_agents/scripts/gate-checklist.mjs`：parseCheckLoopChecks 支持 `// N.`（.mjs 优先，.sh fallback）；命令文档口径行同步。
- `.agents/commands/test.md` + templates 同件：「闭环门禁 `sh …check-loop.test.sh`」→ `node …check-loop.test.mjs`。

## 约束遵守映射

- 零依赖（node:fs/path/url/child_process/process）：是。
- 判定契约零变化：fixture 37 场景关键词断言全量保留 + 真实仓库输出对照。
- 双源纪律 / source-sync-check 0 差异：是（sh 删除件出台账，mjs 入台账）。
- 常驻面预算中性：AGENTS.md 零改动；commands 仅 test.md 一行路径更新。
- 枚举单源不破坏：node 版经 loadEnums 读同一文件（不再有 sed/in_set sh 副本——sh 消费面随迁移清零）。

## 风险评估

- **移植行为漂移**：37 场景 fixture 全量移植 + 真实仓库双跑对照（迁移前 sh 输出 vs 迁移后 node 输出逐类比对）双保险；关键词断言锁死消息文案。
- **旧装户 sync 前撕裂**：shim 保留 check-loop.sh 文件名（pre-push 不断）；shim exec node check-loop.mjs——旧装户无 .mjs 时 shim 报缺文件指引 sync（升级路径单一）。
- **gate-checklist 解析面切换**：.mjs 优先 + .sh fallback + 登记表 1-14 不动，S10-S12 真实仓库断言沿用。
- **无 sh 环境的检查 13 空档**：advisory 级且 pre-commit 硬拦兜底（git 钩子自带 sh）；风险可接受并在头部注明。
