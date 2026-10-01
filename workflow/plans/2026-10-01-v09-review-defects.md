---
状态: approved
级别: L2
模块: pipeline
确认指纹: 5257a389642e6175
---
# PLAN — v09-review-defects（审查缺陷批修复）

对应入口：../incidents/2026-10-01-v09-review-defects.md
对应 spec：../specs/2026-10-01-v09-review-defects.md

## 改动方案

- `templates/_agents/scripts/solidify-task.mjs`（修改）：移除自动 `--delegated` 伪造 quote；新增 `--delegated "<原话>"` 显式转发与 `--auto` 显式旗标；确认失败计数 + 退出码传播；索引更新失败传播；清理死代码（targetName / 空 if / targetKebab 恒等函数）
- `templates/_agents/scripts/solidify-task.test.mjs`（新增）：fixture 测试（默认不落账 / quote 原样 / 缺主题 exit1 / 非文档跳过 / 失败退出码）
- `templates/_githooks/pre-push`（修改）：判定键 `$local_ref` → `$remote_ref`，三态分派（main→`--hardening` / experiment→advisory / 其他→normal）；头注与 message 口径同步
- pre-push 决策 fixture 测试（新增或并入既有套件）：注入桩 `check-loop.sh` 断言三种 refspec 的 `--hardening` 附加
- `workflow/README.md` + `templates/workflow/README.md`（owned 对，手动双改）：规范条目「确认门不得被自动化脚本隐式调用」
- 快车道文档（build/new-task 或相关命令文档，owned 对）：solidify 需显式确认后带参执行
- `.agents/kit.json`：sync 自动登记新测试文件
- `.agents/confirmations.jsonl`：零伪造行，无需动作

## 任务拆解（L2/L3 必填）

1. solidify 修复 + 死代码清理
   - 判据：`node templates/_agents/scripts/solidify-task.mjs --topic <不存在> --root <fixture>` exit 1；fixture 下无参运行零台账新增行；`--delegated "<原话>"` 运行后台账行 quote 原样
   - 风险：中（确认门契约敏感面，测试断言必须覆盖）
2. solidify-task.test.mjs
   - 判据：用例全绿（默认不落账 / quote 原样 / 缺主题 exit1 / 非文档跳过 / 失败退出码传播）
   - 风险：低
3. pre-push 修复 + fixture 测试
   - 判据：`experiment/x:main` → 桩记录含 `--hardening`；`experiment/x:experiment/y` → 不含；`main:main` → 含；三态用例全绿
   - 风险：中（门禁顺序敏感，直推漏口回归）
4. owned 双改（README + 快车道文档）
   - 判据：两对逐字一致；README 含「确认门不得被自动化脚本隐式调用」规范条目
   - 风险：低
5. sync + 全量验证
   - 判据：sync 后 source-sync-check --diff 无缺失/漂移；`npm test` 全绿（含新 solidify 套件与 hook fixture）；`verify.mjs` 全绿；fresh-clone check-ledger/doctor 复跑无新增
   - 风险：低

## 执行顺序（L2/L3 必填）

1 → 2（固化判据）→ 3 → 4（与 3 可并行）→ 5 收口；实现前先读 `.agents/commands/build.md` 的同步/台账步骤。

## 验证计划

- 静态门：测试 = `npm test`（含新增 solidify-task.test.mjs 与 pre-push fixture）；构建 = 无
- L2 追加：确认门契约对账（台账零伪造行复核 + fixture 断言）；pre-push 三态 refspec 用例对账；独立复核复核 diff 与 spec/incident 判据一致性
- 前端 / UI / L3 追加：不适用

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done。
- 确认结果：approved（2026-10-01 用户对话内确认，原话「确认」——plan 全文过目）；done（关单时随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2——independent-reviewer 复核两项修复与 spec 判据一致（防复发用例真实性）