---
状态: approved
级别: L2
模块: pipeline
确认指纹: dfa41678aa4fde2e
---
# PLAN — checkloop-importable

对应入口：../incidents/2026-10-08-checkloop-importable.md
对应 spec：../specs/2026-10-08-checkloop-importable.md

## 改动方案

- `templates/_agents/scripts/check-loop.mjs`（机械包裹变换，codemod 执行；`git diff -w` 实质 ≈40 行）：
  1. 流程段 `:127`（`const { rev: REV_ARG, hardening: HARDENING } = takeOpts();`）至 `:1411`（`process.exit(0);`）整体缩进 2 空格并包进 `export function runCheckLoop(opts = {}) { ... }`；
  2. 段首插 `const REV_ARG = opts.rev ?? null;` + `const HARDENING = !!opts.hardening;`；
  3. 根解析段插 `opts.root` 最高优先分支（不可访问 → 同款报错 + return 1）；互斥检查 `REV_ARG && env` → `REV_ARG && (opts.root || env)`（文案扩展提及 root 参数）；
  4. 退出点改写：`const blockers = [];`（:278）声明之前的 6 处 `process.exit(N);` → `return { exitCode: N, blockers: [], warnings: [] };`；其后 3 处（含 blockers exit(1) 与末尾 exit(0)）→ `return { exitCode: N, blockers, warnings };`；
  5. `export` 加到 delegationResultRows / versionGreater / fmStatus / bindingSha256 四函数；
  6. 文件头注释补 import 契约 + 稳定输出契约声明；末尾加 isMain 主守卫 CLI 入口（`process.exit(runCheckLoop(takeOpts()).exitCode)`）。
- `templates/_agents/scripts/check-loop-unit.test.mjs`：**新建**——runCheckLoop 进程内直测（fixture 注入 root：干净 fixture exit 0 / 构造 blocker exit 1 / rev+root 互斥 return 1 且零副作用）+ 四零件单测（表头签名识别、节标题漂移仍解析、semver 边界、frontmatter 状态形态、bindingSha256 prev 复原与 confirm-doc 前向指纹对称）。
- `templates/_agents/scripts/check-loop.test.mjs`：仅改头部注释（:20）——断言零改动。
- `workflow/papercuts.md`：2026-10-04 isMain 行处置标注（关单提交批）。

## 任务拆解（L2/L3 必填）

1. **前置留痕**：重构前本仓实跑 check-loop 输出存档（stdout+stderr，`node .agents/scripts/check-loop.mjs > before.log 2>&1`）。
   - 判据：before.log 落 /tmp；exit 码记录。
   - 风险：低
2. **codemod 包裹变换**（node 一次性脚本，用后即删）：定位流程段边界 → 缩进 +2 → 退出点改写（按 blockers 声明行分段）→ 段首 REV_ARG/HARDENING 替换 → 根解析插分支 → 头注释 + isMain 入口 + 纯零件 export。
   - 判据：`node --check` 语法过；`git diff -w` 实质变更仅计划清单所列；9 处退出点全改写（grep 验证流程段内零残留 process.exit，takeOpts 的 2 处除外）。
   - 风险：中（机械变换漏项——三重验证网兜底）
3. **unit 套件 + 回归**：check-loop-unit.test.mjs 落地；`node templates/_agents/scripts/check-loop.test.mjs` 219 断言全绿。
   - 判据：新套件全绿；既有套件 FAIL 0。
   - 风险：低
4. **输出逐字节对账**：sync 装副本后本仓实跑（同 :127 前置条件）→ before.log 与 after diff 为空。
   - 判据：diff 为空；exit 码一致。
   - 风险：低
5. **复核 + 提交 + 关单**：independent-reviewer（diff -w 主视图）；三段式提交；incident fixed/closed 逐份代录；papercuts 标注；delegations 落账。
   - 判据：复核零 P0/P1；全套 npm test exit 0；verify 凭证。
   - 风险：低

## 执行顺序（L2/L3 必填）

1 → 2 → 3 → 4 → 5（1 是 4 的对照基线；2 是 3 的被测对象；5 收口）。

## 验证计划

- 静态门：`npm test` 全套（check-loop 219 断言端到端回归网 + 新 unit 套件，templates/ + shipped 双份）。
- L2 追加（契约 / 口径对账）：输出逐字节对账（before/after diff 空）；`git diff -w` 实质变更清单核对；流程段零残留 process.exit 验证；四零件自足性（unit 直测即证）。
- 无前端、无 UI、无 schema（相关行不适用）。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节；done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-10-08 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 独立复核——independent-reviewer 复核接缝变换与退出点改写（任务 5，提交前，diff -w 主视图）
